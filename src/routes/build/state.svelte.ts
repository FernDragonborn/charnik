/*
 * The Build (character creation) view-model: one typed, reactive class like CombatVM. Holds the
 * draft choices ($state), derives the assembled Character + its live sheet ($derived via
 * deriveSheet), and saves through the character store. A single shared instance (`build`) is
 * imported by +page.svelte.
 *
 * Rules are applied LENIENTLY (see the "Free" vs "Strict" toggle): point-buy caps only bind in
 * point-buy mode; nothing hard-blocks creation except an empty name. We render what we can and
 * let the player fix the rest — matching the app's "everything doable, nothing enforced to a
 * dead end" stance.
 */
import { toast } from 'svelte-sonner';
import { getContentGraph } from '$lib/content/provider';
import { deriveSheet, type CharacterSheet, SKILL_ABILITY } from '$lib/character/derive';
import { ABILITIES, type Character } from '$lib/character/schema';
import { assembleCharacter } from '$lib/character/assemble';
import { saveCharacterToStore, openCharacter } from '$lib/character/store.svelte';
import { app, type SystemId } from '$lib/stores/app.svelte';
import type { ContentGraph, LoadedRow } from '$lib/content/loader';
import type { Ability } from '$lib/rules/core';
import {
	baseAbilities,
	pointsSpent,
	pointBuyCost,
	canRaise,
	canLower,
	boostCarrier,
	allocateBackgroundBoost,
	asiFeatLevels,
	POINT_BUY_BUDGET,
	STANDARD_ARRAY,
	type StatMethod,
	type BoostShape
} from '$lib/build/rules';
import { parseEffect, EFFECT_KIND } from '$lib/effects/index';
import { splitList } from '$lib/content/schemas';

const csv = splitList;

/** Localised display name for a content row (falls back to EN). */
export function rowName(row: LoadedRow | undefined, locale = app.activeLocale): string {
	if (!row) return '';
	return String(row.data[`name_${locale}`] || row.data.name_en || row.id);
}

/** Sentinel a feat slot holds when the choice is an Ability Score Improvement (not a feat). */
export const ASI = '__asi__';

const slugify = (s: string): string =>
	s
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'hero';

/** One class row in the draft (pre-resolution: nullable ids while the user is still choosing). */
interface DraftClass {
	classId: string | null;
	subclassId: string | null;
	level: number;
}

/** Every user-editable build choice, as ONE typed object (single source of the field set — adding a
 *  field means editing `DraftState` + the two factories below, never three scattered places). */
interface DraftState {
	name: string;
	system: SystemId;
	/** Strict (rules-enforced) vs Free (lenient) authoring. */
	strict: boolean;
	speciesId: string | null;
	speciesOptionId: string | null;
	/** Abilities the user picked for a 5e species floating ASI. */
	speciesBoostPicks: Ability[];
	backgroundId: string | null;
	classes: DraftClass[];
	method: StatMethod;
	abilities: Record<Ability, number>;
	arrayPick: Partial<Record<Ability, number>>;
	boostShape: BoostShape;
	boostPicks: Ability[];
	skills: string[];
	expertise: string[];
	selectedLanguages: string[];
	slotFeats: Record<string, string>;
	slotAsi: Record<string, { shape: '2' | '1-1'; picks: Ability[] }>;
	selectedSpells: string[];
	inventory: { item: string; qty: number; equipped: boolean }[];
}

/** A blank new-character draft. The one source of default choices (reset + the initial state). */
function blankDraft(): DraftState {
	return {
		name: '',
		system: app.activeSystem,
		strict: true,
		speciesId: null,
		speciesOptionId: null,
		speciesBoostPicks: [],
		backgroundId: null,
		classes: [{ classId: null, subclassId: null, level: 1 }],
		method: 'point-buy',
		abilities: baseAbilities(),
		arrayPick: {},
		boostShape: '2-1',
		boostPicks: [],
		skills: [],
		expertise: [],
		selectedLanguages: [],
		slotFeats: {},
		slotAsi: {},
		selectedSpells: [],
		inventory: []
	};
}

/** Load an existing character into a fresh draft (edit / level-up). Straightforward fields map
 *  directly; abilities become manual with prior boosts/feats carried separately (see hydrate). New
 *  per-level picks (slotFeats/slotAsi/boost*) start blank so a prior session can't leak in. */
function draftFromCharacter(char: Character): DraftState {
	return {
		...blankDraft(),
		name: char.build.name,
		system: char.system,
		strict: char.ui.strict,
		speciesId: char.build.species ?? null,
		speciesOptionId: char.build.speciesOption ?? null,
		backgroundId: char.build.background ?? null,
		classes: char.build.classes.length
			? char.build.classes.map((c) => ({
					classId: c.class,
					subclassId: c.subclass ?? null,
					level: c.level
				}))
			: [{ classId: null, subclassId: null, level: 1 }],
		method: 'manual',
		abilities: { ...char.build.abilities },
		skills: [...char.build.skills],
		expertise: [...char.build.expertise],
		selectedLanguages: [...char.build.languages],
		selectedSpells: char.build.spells.map((s) => s.spell),
		inventory: char.build.inventory.map((i) => ({
			item: i.item,
			qty: i.qty,
			equipped: i.equipped
		}))
	};
}

class BuildVM {
	graph = $state<ContentGraph | null>(null);

	// --- draft choices: ONE reactive object (field set defined in DraftState / blankDraft) --------
	draft = $state<DraftState>(blankDraft());

	toggleLanguage = (ref: string) => {
		this.draft.selectedLanguages = this.draft.selectedLanguages.includes(ref)
			? this.draft.selectedLanguages.filter((x) => x !== ref)
			: [...this.draft.selectedLanguages, ref];
	};
	addInventoryItem = (ref: string) => {
		if (!ref || this.draft.inventory.some((i) => i.item === ref)) return;
		this.draft.inventory = [...this.draft.inventory, { item: ref, qty: 1, equipped: false }];
	};
	removeInventoryItem = (ref: string) => {
		this.draft.inventory = this.draft.inventory.filter((i) => i.item !== ref);
	};
	bumpItemQty = (ref: string, d: number) => {
		this.draft.inventory = this.draft.inventory.map((i) =>
			i.item === ref ? { ...i, qty: Math.max(1, i.qty + d) } : i
		);
	};
	toggleItemEquipped = (ref: string) => {
		this.draft.inventory = this.draft.inventory.map((i) =>
			i.item === ref ? { ...i, equipped: !i.equipped } : i
		);
	};
	/** Can this item be equipped (armor / shield / weapon)? */
	itemEquippable = (ref: string): boolean =>
		['armor', 'shield', 'weapon'].includes(String(this.row(ref)?.data.category));

	saving = $state(false);

	load = async () => {
		this.graph = await getContentGraph();
		this.draft.system = app.activeSystem;
	};

	// --- edit / level-up: hydrate the draft from an existing character --------------------------
	/** Set when editing an existing character (level-up). Save overwrites this id + keeps its play
	 *  state, instead of creating a new character. */
	editId = $state<string | null>(null);
	/** Boosts + feats carried over verbatim from the loaded character (we don't reverse-engineer
	 *  which pick/slot produced them — they pass through, and NEW picks at the new level add on top). */
	hydratedBoosts = $state<Partial<Record<Ability, number>>>({});
	hydratedFeats = $state<string[]>([]);
	/** Spells / skills the character already had at hydrate — in Strict edit they can't be undone
	 *  (you don't unlearn a spell or drop a trained skill at level-up); new picks stay removable. */
	private hydratedSpells = new Set<string>();
	private hydratedSkills = new Set<string>();
	private editPlay: Character['play'] | null = null;
	private editUi: Character['ui'] | null = null;

	/** Reset the draft to a blank new-character state (the BuildVM is a shared singleton, so opening
	 *  "New character" after a level-up must clear the prior edit/hydrated state). Keeps the graph. */
	reset = () => {
		this.editId = null;
		this.editPlay = null;
		this.editUi = null;
		this.hydratedBoosts = {};
		this.hydratedFeats = [];
		this.hydratedSpells = new Set();
		this.hydratedSkills = new Set();
		this.draft = blankDraft();
	};

	/** Load an existing character into the draft (for level-up / editing). Straightforward fields map
	 *  directly (via `draftFromCharacter`); abilities become manual (base scores) with boosts carried
	 *  in `hydratedBoosts`, and the existing feats/skills/spells carried for Strict-edit locking. */
	hydrate = (char: Character) => {
		this.editId = char.id;
		this.editPlay = char.play;
		this.editUi = char.ui;
		this.draft = draftFromCharacter(char);
		this.hydratedBoosts = { ...(char.build.abilityBoosts as Partial<Record<Ability, number>>) };
		this.hydratedFeats = [...char.build.feats];
		this.hydratedSkills = new Set(char.build.skills);
		this.hydratedSpells = new Set(this.draft.selectedSpells);
	};

	// --- content option lists (filtered by the draft's system) -----------------
	private list(type: Parameters<ContentGraph['list']>[0]): LoadedRow[] {
		if (!this.graph) return [];
		return [...this.graph.list(type, { system: this.draft.system })].sort((a, b) =>
			rowName(a).localeCompare(rowName(b))
		);
	}
	speciesList = $derived(this.list('species'));
	backgroundList = $derived(this.list('background'));
	classList = $derived(this.list('class'));
	featList = $derived(this.list('feat'));
	languageList = $derived(this.list('language'));
	itemList = $derived(this.list('item'));

	private row(id: string | null): LoadedRow | undefined {
		return id && this.graph ? this.graph.get(id) : undefined;
	}
	/** Subclasses available for a given class ref (per multiclass row). */
	subclassesFor = (classId: string | null): LoadedRow[] => {
		const cls = this.row(classId);
		if (!cls) return [];
		return this.list('subclass').filter((r) => String(r.data.class_id) === String(cls.id));
	};

	speciesRow = $derived(this.row(this.draft.speciesId));
	backgroundRow = $derived(this.row(this.draft.backgroundId));

	/** Sub-options (subrace / lineage) for the chosen species, in the draft's edition. */
	speciesOptions = $derived.by<LoadedRow[]>(() => {
		const sp = this.speciesRow;
		if (!sp) return [];
		return this.list('species_option').filter((r) => String(r.data.species_id) === String(sp.id));
	});
	speciesOptionRow = $derived(this.row(this.draft.speciesOptionId));
	/** Label for the sub-picker (e.g. "Subrace" 2014 / "Lineage" 2024), from the options' data. */
	speciesOptionLabel = $derived(
		String(this.speciesOptions[0]?.data.option_label ?? 'Lineage')
	);
	/** Pick a species; clears the now-stale sub-option + free-boost choices. */
	pickSpecies = (id: string | null) => {
		this.draft.speciesId = id;
		this.draft.speciesOptionId = null;
		this.draft.speciesBoostPicks = [];
	};

	// --- species "+N to M of your choice" ASI (5e Half-Elf) --------------------
	/** The free-choice ASI shape from the species or its sub-option, if any (e.g. `1x2`). */
	speciesBoostChoice = $derived.by<{ amount: number; count: number } | null>(() => {
		const raw = String(
			this.speciesOptionRow?.data.boost_choice || this.speciesRow?.data.boost_choice || ''
		).trim();
		const m = /^(\d+)x(\d+)$/.exec(raw);
		return m ? { amount: Number(m[1]), count: Number(m[2]) } : null;
	});
	/** Abilities already raised by the species' FIXED ASI (its effects) — excluded from the choice
	 *  (5e Half-Elf's +1/+1 goes to two abilities OTHER than the +2 CHA). */
	speciesFixedAbilities = $derived.by<Set<Ability>>(() => {
		const set = new Set<Ability>();
		for (const src of [this.speciesRow, this.speciesOptionRow]) {
			const eff = Array.isArray(src?.data.effects) ? (src!.data.effects as string[]) : [];
			for (const t of eff) {
				const p = parseEffect(t);
				if (p.kind === EFFECT_KIND.flatBonus && p.target && (ABILITIES as readonly string[]).includes(p.target))
					set.add(p.target as Ability);
			}
		}
		return set;
	});
	/** Abilities offered for the free choice (all six minus the fixed-boosted ones). */
	speciesBoostAbilities = $derived<Ability[]>(
		ABILITIES.filter((a) => !this.speciesFixedAbilities.has(a))
	);
	toggleSpeciesBoostPick = (ab: Ability) => {
		const cap = this.speciesBoostChoice?.count ?? 0;
		if (this.draft.speciesBoostPicks.includes(ab))
			this.draft.speciesBoostPicks = this.draft.speciesBoostPicks.filter((a) => a !== ab);
		else if (this.draft.speciesBoostPicks.length < cap)
			this.draft.speciesBoostPicks = [...this.draft.speciesBoostPicks, ab];
	};

	// --- multiclass rows -------------------------------------------------------
	primaryClassId = $derived<string | null>(this.draft.classes[0]?.classId ?? null);
	classId = $derived<string | null>(this.primaryClassId); // primary drives saves/skills/ASI
	classRow = $derived(this.row(this.primaryClassId));
	/** Total character level = sum of all class levels (drives prof, HP, feat slots). */
	totalLevel = $derived(
		this.draft.classes.reduce((n, c) => n + (c.classId ? c.level : 0), 0) || 1
	);
	/** Character level is capped at 20 total across all classes. */
	canRaiseLevel = $derived(this.totalLevel < 20);
	addClass = () => {
		if (!this.canRaiseLevel) return; // a new class starts at 1 → would exceed 20
		this.draft.classes = [...this.draft.classes, { classId: null, subclassId: null, level: 1 }];
	};
	removeClass = (i: number) => {
		if (i === 0) return; // keep the primary row
		this.draft.classes = this.draft.classes.filter((_, idx) => idx !== i);
	};
	setClass = (i: number, id: string | null) => {
		this.draft.classes = this.draft.classes.map((c, idx) =>
			idx === i ? { ...c, classId: id, subclassId: null } : c
		);
	};
	setSubclass = (i: number, id: string | null) => {
		this.draft.classes = this.draft.classes.map((c, idx) => (idx === i ? { ...c, subclassId: id } : c));
	};
	bumpClassLevel = (i: number, dir: 1 | -1) => {
		if (dir === 1 && !this.canRaiseLevel) return; // total character level cap
		this.draft.classes = this.draft.classes.map((c, idx) =>
			idx === i ? { ...c, level: Math.max(1, Math.min(20, c.level + dir)) } : c
		);
	};

	isCaster = $derived.by(() =>
		this.draft.classes.some((c) => {
			const caster = this.row(c.classId)?.data.caster;
			return caster && caster !== 'none';
		})
	);
	/**
	 * Spell picker, PER caster class (one section each — single-class collapses to one). Strict
	 * shows only legally-pickable spells (via the access map, cantrips always + leveled ≤ the
	 * class's max spell level); Free lifts every gate. Mirrors the skills Strict/Free toggle.
	 */
	spellPicker = $derived.by(() => {
		const graph = this.graph;
		const sheet = this.sheet;
		if (!graph || !sheet) return [];
		const allSpells = this.list('spell');
		const levelOf = (s: LoadedRow) => Number(s.data.level ?? 0);
		return sheet.spellcasting.classes.map((profile) => {
			const access = new Set(profile.accessSpellIds);
			const inClass = (id: string) => !this.draft.strict || access.has(id);
			const pool = allSpells.filter((s) => {
				const lvl = levelOf(s);
				if (!this.draft.strict) return true;
				if (lvl > 0 && !access.has(s.effectiveId)) return false; // access gate
				return lvl <= profile.maxSpellLevel; // cantrips (0) always pass
			});
			const byLevel = new Map<number, LoadedRow[]>();
			for (const s of pool) (byLevel.get(levelOf(s)) ?? byLevel.set(levelOf(s), []).get(levelOf(s))!).push(s);
			const groups = [...byLevel.keys()]
				.sort((a, b) => a - b)
				.map((lvl) => ({ level: lvl, label: lvl === 0 ? 'Cantrips' : `Level ${lvl}`, spells: byLevel.get(lvl)! }));
			const selectedInClass = this.draft.selectedSpells.filter(inClass);
			const cantripsChosen = selectedInClass.filter((id) => Number(graph.get(id)?.data.level ?? 0) === 0).length;
			const leveledChosen = selectedInClass.filter((id) => Number(graph.get(id)?.data.level ?? 0) > 0).length;
			return { profile, groups, cantripsChosen, leveledChosen };
		});
	});
	toggleSpell = (ref: string) => {
		if (this.draft.selectedSpells.includes(ref)) {
			if (this.editId && this.draft.strict && this.hydratedSpells.has(ref)) {
				toast("Strict: you can't unlearn a known spell — switch to Free to remove it.");
				return;
			}
			this.draft.selectedSpells = this.draft.selectedSpells.filter((s) => s !== ref);
			return;
		}
		// Strict: block picking past the cantrip / prepared cap of any class this spell counts for
		if (this.draft.strict) {
			const lvl = Number(this.graph?.get(ref)?.data.level ?? 0);
			for (const pc of this.spellPicker) {
				if (!pc.profile.accessSpellIds.includes(ref)) continue; // doesn't count for this class
				const [chosen, cap, what] =
					lvl === 0
						? ([pc.cantripsChosen, pc.profile.cantripCap, 'cantrips'] as const)
						: ([pc.leveledChosen, pc.profile.preparedCap, 'prepared spells'] as const);
				if (chosen >= cap) {
					const who = this.spellPicker.length > 1 ? `${pc.profile.className} ` : '';
					toast(`${who}${what} full (${cap}) — remove one first, or switch to Free.`);
					return;
				}
			}
		}
		this.draft.selectedSpells = [...this.draft.selectedSpells, ref];
	};

	// --- skills: class picks (choose N) + background grants (auto) --------------
	classSkillCount = $derived(Number(this.classRow?.data.skills_choose ?? 0));
	classSkillOptions = $derived.by<string[]>(() => {
		const from = csv(this.classRow?.data.skills_from);
		if (from.length === 1 && from[0]?.toLowerCase() === 'any') return Object.keys(SKILL_ABILITY);
		return from;
	});
	backgroundSkills = $derived(csv(this.backgroundRow?.data.skills));
	/** Skills granted for free by the background (always proficient). */
	autoSkills = $derived(this.backgroundSkills);
	/** How many free "of your choice" languages the background grants (display only). */
	backgroundLangCount = $derived(Number(this.backgroundRow?.data.languages ?? 0));

	toggleSkill = (skill: string) => {
		if (this.autoSkills.includes(skill)) return; // background-granted, locked on
		if (this.draft.skills.includes(skill)) {
			if (this.editId && this.draft.strict && this.hydratedSkills.has(skill)) {
				toast("Strict: you can't drop a trained skill — switch to Free to remove it.");
				return;
			}
			this.draft.skills = this.draft.skills.filter((s) => s !== skill);
			return;
		}
		if (!this.draft.strict) {
			this.draft.skills = [...this.draft.skills, skill]; // Free: any skill, no cap
			return;
		}
		// Strict: cap counts only NON-background picks (a background overlap frees a slot)
		if (this.classSkillCount === 0 || this.skillChosenCount < this.classSkillCount)
			this.draft.skills = [...this.draft.skills, skill];
	};
	skillChosenCount = $derived(this.draft.skills.filter((s) => !this.autoSkills.includes(s)).length);
	/** Proficient = chosen or background-granted (a prerequisite for expertise). */
	isProficient = (skill: string): boolean =>
		this.autoSkills.includes(skill) || this.draft.skills.includes(skill);
	/** Toggle expertise (×2) on a proficient skill. */
	toggleExpertise = (skill: string) => {
		if (!this.isProficient(skill)) return;
		this.draft.expertise = this.draft.expertise.includes(skill)
			? this.draft.expertise.filter((s) => s !== skill)
			: [...this.draft.expertise, skill];
	};
	/** A skill is pickable when Free, or (Strict) it's on the class list / the class has no list. */
	skillPickable = (skill: string): boolean =>
		this.autoSkills.includes(skill) ||
		!this.draft.strict ||
		this.classSkillCount === 0 ||
		this.classSkillOptions.includes(skill);

	// --- ability scores --------------------------------------------------------
	setMethod = (m: StatMethod) => {
		this.draft.method = m;
		if (m === 'standard-array') this.draft.arrayPick = {};
		if (m === 'point-buy') this.draft.abilities = baseAbilities();
	};
	pointsUsed = $derived(pointsSpent(this.draft.abilities));
	pointsLeft = $derived(POINT_BUY_BUDGET - this.pointsUsed);

	bumpAbility = (ab: Ability, dir: 1 | -1) => {
		// editing an existing character in Strict: base scores are locked (you don't re-roll them at
		// level-up — increases come only from ASI slots). Free lets you edit anything.
		if (this.editId && this.draft.strict) return;
		const cur = this.draft.abilities[ab];
		if (this.draft.method === 'point-buy' && !this.draft.strict) {
			// lenient point-buy still respects budget/caps to keep the counter meaningful
		}
		if (this.draft.method === 'point-buy') {
			if (dir === 1 && !canRaise(this.draft.abilities, ab)) return;
			if (dir === -1 && !canLower(this.draft.abilities, ab)) return;
		} else {
			// manual: 1..30 (Free) or 3..20 (Strict-ish) — stay lenient, just clamp sane bounds
			const lo = this.draft.strict ? 3 : 1;
			const hi = this.draft.strict ? 20 : 30;
			if (cur + dir < lo || cur + dir > hi) return;
		}
		this.draft.abilities = { ...this.draft.abilities, [ab]: cur + dir };
	};

	/** Standard array: assign the next unused value to an ability, or clear it. */
	assignArray = (ab: Ability, value: number | null) => {
		const next = { ...this.draft.arrayPick };
		// remove this value from any other ability first (each value used once)
		if (value != null) for (const k of ABILITIES) if (next[k] === value) delete next[k];
		if (value == null) delete next[ab];
		else next[ab] = value;
		this.draft.arrayPick = next;
		this.draft.abilities = { ...this.draft.abilities, [ab]: value ?? 8 };
	};
	/** Standard-array values not yet assigned to an ability. */
	arrayRemaining = $derived.by(() => {
		const used = new Set(Object.values(this.draft.arrayPick));
		return STANDARD_ARRAY.filter((v) => !used.has(v));
	});

	// --- ability boosts (5.5e background choice; 5e species flows via effects) --
	boostCarrier = $derived(boostCarrier(this.draft.system));
	backgroundBoostChoices = $derived.by<Ability[]>(() =>
		csv(this.backgroundRow?.data.ability_choices).filter((a): a is Ability =>
			(ABILITIES as readonly string[]).includes(a)
		)
	);
	/** JUST the 5.5e background boost allocation (for the background chips — so an ASI boost doesn't
	 *  leak into them). Empty unless a 5.5e background offers a choice. */
	backgroundBoosts = $derived.by<Partial<Record<Ability, number>>>(() =>
		this.draft.system === '5.5e' && this.backgroundBoostChoices.length
			? allocateBackgroundBoost(this.draft.boostShape, this.draft.boostPicks, this.backgroundBoostChoices)
			: {}
	);
	/** All ability boosts folded together: 5.5e background choice + every ASI slot allocation. */
	abilityBoosts = $derived.by<Partial<Record<Ability, number>>>(() => {
		const out: Partial<Record<Ability, number>> = {};
		const add = (m: Partial<Record<Ability, number>>) => {
			for (const a of ABILITIES) if (m[a]) out[a] = (out[a] ?? 0) + (m[a] as number);
		};
		add(this.hydratedBoosts); // boosts carried over from a loaded character (level-up)
		if (this.draft.system === '5.5e' && this.backgroundBoostChoices.length)
			add(allocateBackgroundBoost(this.draft.boostShape, this.draft.boostPicks, this.backgroundBoostChoices));
		// species free-choice ASI (5e Half-Elf +1/+1)
		if (this.speciesBoostChoice)
			for (const ab of this.draft.speciesBoostPicks)
				out[ab] = (out[ab] ?? 0) + this.speciesBoostChoice.amount;
		for (const s of this.featSlots) if (this.draft.slotFeats[s.key] === ASI) add(this.asiBoostFor(s.key));
		return out;
	});
	toggleBoostPick = (ab: Ability) => {
		const cap = this.draft.boostShape === '2-1' ? 2 : 3;
		if (this.draft.boostPicks.includes(ab)) this.draft.boostPicks = this.draft.boostPicks.filter((a) => a !== ab);
		else if (this.draft.boostPicks.length < cap) this.draft.boostPicks = [...this.draft.boostPicks, ab];
	};

	// --- feats: one ASI/feat slot per qualifying level, PER CLASS (RAW-correct for multiclass:
	// each class grants its ASIs at its own class levels — Fighter +6/14, Rogue +10) ------------
	featSlots = $derived.by<{ key: string; level: number; className: string }[]>(() => {
		const out: { key: string; level: number; className: string }[] = [];
		this.draft.classes.forEach((c, i) => {
			if (!c.classId) return;
			const row = this.row(c.classId);
			const className = rowName(row);
			const asiLevels = row?.data.asi_levels as number[] | undefined;
			for (const level of asiFeatLevels(c.level, asiLevels))
				out.push({ key: `${i}:${level}`, level, className });
		});
		return out;
	});
	/** The background's granted origin feat (5.5e), resolved to a ref — auto, not a slot. */
	originFeatRef = $derived.by<string | null>(() => {
		const id = this.backgroundRow?.data.origin_feat;
		if (!id) return null;
		return this.featList.find((f) => f.id === String(id))?.effectiveId ?? null;
	});
	/** Feat options that make sense for a slot at `level`: origin feats are background-only, and
	 *  epic boons only unlock at level 19+. (Not a hard block — just the right menu per slot.) */
	featOptionsFor = (level: number): LoadedRow[] =>
		this.featList.filter((f) => {
			// the plain ASI is offered as its own dedicated slot option, not as a feat row
			if (f.id === 'ability-score-improvement') return false;
			const cat = String(f.data.category ?? 'general');
			if (cat === 'origin') return false;
			if (cat === 'epic-boon') return level >= 19;
			return true;
		});
	// ASI may be taken in every slot; a feat is repeatable iff its row says so.
	isRepeatable = (ref: string): boolean =>
		ref === ASI || Boolean(this.graph?.get(ref)?.data.repeatable);
	/** Feat refs already spent on slots (repeatable ones may recur). */
	usedFeatRefs = $derived<string[]>(Object.values(this.draft.slotFeats));
	/** A feat option is blocked for a slot if it's non-repeatable and already taken elsewhere. */
	featOptionBlocked = (ref: string, slotKey: string): boolean =>
		!this.isRepeatable(ref) && this.draft.slotFeats[slotKey] !== ref && this.usedFeatRefs.includes(ref);
	setSlotFeat = (key: string, ref: string) => {
		const next = { ...this.draft.slotFeats };
		if (ref) next[key] = ref;
		else delete next[key];
		this.draft.slotFeats = next;
		// initialise / clear this slot's ASI allocation as needed
		if (ref === ASI && !this.draft.slotAsi[key])
			this.draft.slotAsi = { ...this.draft.slotAsi, [key]: { shape: '2', picks: [] } };
		if (ref !== ASI && this.draft.slotAsi[key]) {
			const asi = { ...this.draft.slotAsi };
			delete asi[key];
			this.draft.slotAsi = asi;
		}
	};
	filledSlots = $derived(this.featSlots.filter((s) => this.draft.slotFeats[s.key]).length);

	// --- per-slot ASI allocation (+2 to one ability, or +1 to two) --------------
	asiBoostFor = (key: string): Partial<Record<Ability, number>> => {
		const a = this.draft.slotAsi[key];
		if (!a) return {};
		const out: Partial<Record<Ability, number>> = {};
		if (a.shape === '2') {
			if (a.picks[0]) out[a.picks[0]] = 2;
		} else {
			for (const ab of a.picks.slice(0, 2)) out[ab] = (out[ab] ?? 0) + 1;
		}
		return out;
	};
	setAsiShape = (key: string, shape: '2' | '1-1') => {
		const cur = this.draft.slotAsi[key] ?? { shape, picks: [] };
		const cap = shape === '2' ? 1 : 2;
		this.draft.slotAsi = { ...this.draft.slotAsi, [key]: { shape, picks: cur.picks.slice(0, cap) } };
	};
	toggleAsiPick = (key: string, ab: Ability) => {
		const cur = this.draft.slotAsi[key] ?? { shape: '2' as const, picks: [] as Ability[] };
		const cap = cur.shape === '2' ? 1 : 2;
		const picks = cur.picks.includes(ab)
			? cur.picks.filter((a) => a !== ab)
			: cur.picks.length < cap
				? [...cur.picks, ab]
				: cur.picks;
		this.draft.slotAsi = { ...this.draft.slotAsi, [key]: { ...cur, picks } };
	};

	// --- assembled character + live sheet --------------------------------------
	assembled = $derived.by<Character>(() => {
		const build = {
			name: this.draft.name || 'Unnamed',
			species: this.draft.speciesId ?? undefined,
			// only persist the sub-option if it's valid for the chosen species (guards a stale pick)
			speciesOption: this.speciesOptions.some((o) => o.effectiveId === this.draft.speciesOptionId)
				? (this.draft.speciesOptionId ?? undefined)
				: undefined,
			background: this.draft.backgroundId ?? undefined,
			classes: this.draft.classes
				.filter((c) => c.classId)
				.map((c) => ({
					class: c.classId as string,
					level: c.level,
					subclass: c.subclassId ?? undefined
				})),
			abilities: { ...this.draft.abilities },
			abilityBoosts: this.abilityBoosts as Record<string, number>,
			skills: [...new Set([...this.autoSkills, ...this.draft.skills])],
			expertise: this.draft.expertise.filter((s) => this.isProficient(s)),
			saves: csv(this.classRow?.data.saves) as Ability[],
			// origin feat (auto) + each filled slot that holds a real feat (ASI is not a feat —
			// its ability boost flows through abilityBoosts instead)
			feats: [
				...new Set([
					// carried over from a loaded character (level-up), else the auto origin feat
					...(this.editId ? this.hydratedFeats : this.originFeatRef ? [this.originFeatRef] : []),
					...this.featSlots.map((s) => this.draft.slotFeats[s.key]).filter((r) => r && r !== ASI)
				])
			],
			languages: [...this.draft.selectedLanguages],
			inventory: this.draft.inventory.map((i) => ({ ...i, attuned: false })),
			// cantrips are always-prepared; leveled spells start prepared (tweak in the Spellbook)
			spells: this.draft.selectedSpells.map((ref) => {
				const lvl = Number(this.graph?.get(ref)?.data.level ?? 0);
				return { spell: ref, prepared: lvl > 0, alwaysPrepared: lvl === 0 };
			}),
			notes: ''
		};
		// editing keeps the original id + play/ui; creating derives a fresh id from the name
		return assembleCharacter(build, {
			id: this.editId ?? slugify(this.draft.name),
			system: this.draft.system,
			strict: this.draft.strict,
			play: this.editPlay,
			ui: this.editUi
		});
	});
	sheet = $derived.by<CharacterSheet | null>(() =>
		this.graph ? deriveSheet(this.assembled, this.graph) : null
	);

	// --- validation --------------------------------------------------------------
	// Free is lenient (only a name is required). Strict adds allocation checks that BLOCK create.
	issues = $derived.by<string[]>(() => {
		const out: string[] = [];
		if (!this.draft.name.trim()) out.push('Give your character a name.');
		if (!this.classId) out.push('Pick a class (you can change it later).');
		if (this.draft.method === 'point-buy' && this.pointsLeft > 0)
			out.push(`${this.pointsLeft} ability points unspent.`);
		if (this.draft.strict) {
			const needSkills = this.classSkillCount - this.skillChosenCount;
			if (needSkills > 0)
				out.push(`Choose ${needSkills} more skill${needSkills > 1 ? 's' : ''}.`);
			for (const pc of this.spellPicker) {
				const dc = pc.profile.cantripCap - pc.cantripsChosen;
				const dp = pc.profile.preparedCap - pc.leveledChosen;
				const who = this.spellPicker.length > 1 ? `${pc.profile.className} ` : '';
				if (dc > 0) out.push(`Choose ${dc} more ${who}cantrip${dc > 1 ? 's' : ''}.`);
				if (dc < 0) out.push(`Remove ${-dc} ${who}cantrip${dc < -1 ? 's' : ''} (over cap).`);
				if (dp > 0) out.push(`Choose ${dp} more ${who}spell${dp > 1 ? 's' : ''}.`);
				if (dp < 0) out.push(`Remove ${-dp} ${who}spell${dp < -1 ? 's' : ''} (over cap).`);
			}
		}
		return out;
	});
	// Free: name only. Strict: everything above must be resolved.
	canCreate = $derived(
		this.draft.name.trim().length > 0 && (!this.draft.strict || this.issues.length === 0)
	);

	save = async (): Promise<string | null> => {
		if (!this.canCreate) return null;
		this.saving = true;
		try {
			const character = this.assembled;
			// new character: start play HP at max so it's playable immediately. Editing/level-up:
			// keep the character's current play state (HP, effects, spent slots…).
			if (!this.editId) character.play.hp.current = this.sheet?.maxHp.value ?? 0;
			await saveCharacterToStore(character);
			// make the freshly-created character the active one so Combat opens IT, not the demo
			await openCharacter(character.id);
			return character.id;
		} finally {
			this.saving = false;
		}
	};

	/** Provenance sub-line for an ability row: base + boost + species/effect bonus. */
	abilityNote = (ab: Ability): string => {
		const base = this.draft.abilities[ab];
		const boost = this.abilityBoosts[ab] ?? 0;
		const total = this.sheet?.abilities[ab].score ?? base;
		const extra = total - base - boost; // species / effect contribution
		const parts: string[] = [`base ${base}`];
		if (boost) parts.push(`boost +${boost}`);
		if (extra) parts.push(`${this.boostCarrier === 'species' ? 'species' : 'other'} ${extra > 0 ? '+' : ''}${extra}`);
		return parts.join(' · ');
	};
	abilityCost = (ab: Ability): number => pointBuyCost(this.draft.abilities[ab]);
}

/** The single shared Build view-model instance. */
export const build = new BuildVM();

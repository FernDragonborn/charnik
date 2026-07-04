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
import { getContentGraph } from '$lib/content/provider';
import { deriveSheet, type CharacterSheet, SKILL_ABILITY } from '$lib/character/derive';
import { characterSchema, ABILITIES, type Character } from '$lib/character/schema';
import { CHARACTER_SCHEMA_VERSION } from '$lib/schema/version';
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

const csv = (v: unknown): string[] =>
	Array.isArray(v)
		? v.map(String)
		: v == null || v === ''
			? []
			: String(v).split(/[,;]/).map((s) => s.trim()).filter(Boolean);

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

class BuildVM {
	graph = $state<ContentGraph | null>(null);

	// --- draft choices ---------------------------------------------------------
	name = $state('');
	system = $state<SystemId>(app.activeSystem);
	// Strict by default so the spell picker (and manual-score bounds) follow the rules —
	// showing every spell to a level-1 caster was confusing. Free is one click away for homebrew.
	strict = $state(true);
	speciesId = $state<string | null>(null);
	/** Chosen species sub-option (subrace / lineage) ref, when the species offers any. */
	speciesOptionId = $state<string | null>(null);
	backgroundId = $state<string | null>(null);
	/** One or more classes (multiclass). classes[0] is the primary — it grants saves + the
	 *  starting skill choices; extra classes add levels (and their own subclass). */
	classes = $state<{ classId: string | null; subclassId: string | null; level: number }[]>([
		{ classId: null, subclassId: null, level: 1 }
	]);

	method = $state<StatMethod>('point-buy');
	abilities = $state<Record<Ability, number>>(baseAbilities());
	/** Standard-array assignment: ability → which array value it holds (or undefined). */
	arrayPick = $state<Partial<Record<Ability, number>>>({});

	boostShape = $state<BoostShape>('2-1');
	boostPicks = $state<Ability[]>([]);

	skills = $state<string[]>([]);
	/** Skill ids with expertise (×2 proficiency). Must be a proficient skill. */
	expertise = $state<string[]>([]);
	/** What fills each ASI/feat slot, keyed by `${classIndex}:${classLevel}` (per-class, so two
	 *  classes granting an ASI at the same class level don't collide): the `ASI` sentinel or a feat
	 *  ref. Repeatable feats (Skilled, Magic Initiate…) and ASI may fill several slots. */
	slotFeats = $state<Record<string, string>>({});
	/** Per-slot ASI allocation (only when that slot's choice is `ASI`): +2 to one, or +1 to two. */
	slotAsi = $state<Record<string, { shape: '2' | '1-1'; picks: Ability[] }>>({});
	/** Spell refs the character knows/prepares (leveled + cantrips), chosen from its class list. */
	selectedSpells = $state<string[]>([]);

	saving = $state(false);

	load = async () => {
		this.graph = await getContentGraph();
		this.system = app.activeSystem;
	};

	// --- content option lists (filtered by the draft's system) -----------------
	private list(type: Parameters<ContentGraph['list']>[0]): LoadedRow[] {
		if (!this.graph) return [];
		return [...this.graph.list(type, { system: this.system })].sort((a, b) =>
			rowName(a).localeCompare(rowName(b))
		);
	}
	speciesList = $derived(this.list('species'));
	backgroundList = $derived(this.list('background'));
	classList = $derived(this.list('class'));
	featList = $derived(this.list('feat'));

	private row(id: string | null): LoadedRow | undefined {
		return id && this.graph ? this.graph.get(id) : undefined;
	}
	/** Subclasses available for a given class ref (per multiclass row). */
	subclassesFor = (classId: string | null): LoadedRow[] => {
		const cls = this.row(classId);
		if (!cls) return [];
		return this.list('subclass').filter((r) => String(r.data.class_id) === String(cls.id));
	};

	speciesRow = $derived(this.row(this.speciesId));
	backgroundRow = $derived(this.row(this.backgroundId));

	/** Sub-options (subrace / lineage) for the chosen species, in the draft's edition. */
	speciesOptions = $derived.by<LoadedRow[]>(() => {
		const sp = this.speciesRow;
		if (!sp) return [];
		return this.list('species_option').filter((r) => String(r.data.species_id) === String(sp.id));
	});
	speciesOptionRow = $derived(this.row(this.speciesOptionId));
	/** Label for the sub-picker (e.g. "Subrace" 2014 / "Lineage" 2024), from the options' data. */
	speciesOptionLabel = $derived(
		String(this.speciesOptions[0]?.data.option_label ?? 'Lineage')
	);
	/** Pick a species; clears the now-stale sub-option + free-boost choices. */
	pickSpecies = (id: string | null) => {
		this.speciesId = id;
		this.speciesOptionId = null;
		this.speciesBoostPicks = [];
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
				const m = /^flat-bonus:([a-z]{3})[+-]/.exec(t);
				if (m && (ABILITIES as readonly string[]).includes(m[1])) set.add(m[1] as Ability);
			}
		}
		return set;
	});
	/** Abilities offered for the free choice (all six minus the fixed-boosted ones). */
	speciesBoostAbilities = $derived<Ability[]>(
		ABILITIES.filter((a) => !this.speciesFixedAbilities.has(a))
	);
	speciesBoostPicks = $state<Ability[]>([]);
	toggleSpeciesBoostPick = (ab: Ability) => {
		const cap = this.speciesBoostChoice?.count ?? 0;
		if (this.speciesBoostPicks.includes(ab))
			this.speciesBoostPicks = this.speciesBoostPicks.filter((a) => a !== ab);
		else if (this.speciesBoostPicks.length < cap)
			this.speciesBoostPicks = [...this.speciesBoostPicks, ab];
	};

	// --- multiclass rows -------------------------------------------------------
	primaryClassId = $derived<string | null>(this.classes[0]?.classId ?? null);
	classId = $derived<string | null>(this.primaryClassId); // primary drives saves/skills/ASI
	classRow = $derived(this.row(this.primaryClassId));
	/** Total character level = sum of all class levels (drives prof, HP, feat slots). */
	totalLevel = $derived(
		this.classes.reduce((n, c) => n + (c.classId ? c.level : 0), 0) || 1
	);
	/** Character level is capped at 20 total across all classes. */
	canRaiseLevel = $derived(this.totalLevel < 20);
	addClass = () => {
		if (!this.canRaiseLevel) return; // a new class starts at 1 → would exceed 20
		this.classes = [...this.classes, { classId: null, subclassId: null, level: 1 }];
	};
	removeClass = (i: number) => {
		if (i === 0) return; // keep the primary row
		this.classes = this.classes.filter((_, idx) => idx !== i);
	};
	setClass = (i: number, id: string | null) => {
		this.classes = this.classes.map((c, idx) =>
			idx === i ? { ...c, classId: id, subclassId: null } : c
		);
	};
	setSubclass = (i: number, id: string | null) => {
		this.classes = this.classes.map((c, idx) => (idx === i ? { ...c, subclassId: id } : c));
	};
	bumpClassLevel = (i: number, dir: 1 | -1) => {
		if (dir === 1 && !this.canRaiseLevel) return; // total character level cap
		this.classes = this.classes.map((c, idx) =>
			idx === i ? { ...c, level: Math.max(1, Math.min(20, c.level + dir)) } : c
		);
	};

	isCaster = $derived.by(() =>
		this.classes.some((c) => {
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
			const inClass = (id: string) => !this.strict || access.has(id);
			const pool = allSpells.filter((s) => {
				const lvl = levelOf(s);
				if (!this.strict) return true;
				if (lvl > 0 && !access.has(s.effectiveId)) return false; // access gate
				return lvl <= profile.maxSpellLevel; // cantrips (0) always pass
			});
			const byLevel = new Map<number, LoadedRow[]>();
			for (const s of pool) (byLevel.get(levelOf(s)) ?? byLevel.set(levelOf(s), []).get(levelOf(s))!).push(s);
			const groups = [...byLevel.keys()]
				.sort((a, b) => a - b)
				.map((lvl) => ({ level: lvl, label: lvl === 0 ? 'Cantrips' : `Level ${lvl}`, spells: byLevel.get(lvl)! }));
			const selectedInClass = this.selectedSpells.filter(inClass);
			const cantripsChosen = selectedInClass.filter((id) => Number(graph.get(id)?.data.level ?? 0) === 0).length;
			const leveledChosen = selectedInClass.filter((id) => Number(graph.get(id)?.data.level ?? 0) > 0).length;
			return { profile, groups, cantripsChosen, leveledChosen };
		});
	});
	toggleSpell = (ref: string) => {
		this.selectedSpells = this.selectedSpells.includes(ref)
			? this.selectedSpells.filter((s) => s !== ref)
			: [...this.selectedSpells, ref];
	};

	// --- skills: class picks (choose N) + background grants (auto) --------------
	classSkillCount = $derived(Number(this.classRow?.data.skills_choose ?? 0));
	classSkillOptions = $derived.by<string[]>(() => {
		const from = csv(this.classRow?.data.skills_from);
		if (from.length === 1 && from[0].toLowerCase() === 'any') return Object.keys(SKILL_ABILITY);
		return from;
	});
	backgroundSkills = $derived(csv(this.backgroundRow?.data.skills));
	/** Skills granted for free by the background (always proficient). */
	autoSkills = $derived(this.backgroundSkills);
	/** How many free "of your choice" languages the background grants (display only). */
	backgroundLangCount = $derived(Number(this.backgroundRow?.data.languages ?? 0));

	toggleSkill = (skill: string) => {
		if (this.autoSkills.includes(skill)) return; // background-granted, locked on
		if (this.skills.includes(skill)) {
			this.skills = this.skills.filter((s) => s !== skill);
			return;
		}
		if (!this.strict) {
			this.skills = [...this.skills, skill]; // Free: any skill, no cap
			return;
		}
		// Strict: cap counts only NON-background picks (a background overlap frees a slot)
		if (this.classSkillCount === 0 || this.skillChosenCount < this.classSkillCount)
			this.skills = [...this.skills, skill];
	};
	skillChosenCount = $derived(this.skills.filter((s) => !this.autoSkills.includes(s)).length);
	/** Proficient = chosen or background-granted (a prerequisite for expertise). */
	isProficient = (skill: string): boolean =>
		this.autoSkills.includes(skill) || this.skills.includes(skill);
	/** Toggle expertise (×2) on a proficient skill. */
	toggleExpertise = (skill: string) => {
		if (!this.isProficient(skill)) return;
		this.expertise = this.expertise.includes(skill)
			? this.expertise.filter((s) => s !== skill)
			: [...this.expertise, skill];
	};
	/** A skill is pickable when Free, or (Strict) it's on the class list / the class has no list. */
	skillPickable = (skill: string): boolean =>
		this.autoSkills.includes(skill) ||
		!this.strict ||
		this.classSkillCount === 0 ||
		this.classSkillOptions.includes(skill);

	// --- ability scores --------------------------------------------------------
	setMethod = (m: StatMethod) => {
		this.method = m;
		if (m === 'standard-array') this.arrayPick = {};
		if (m === 'point-buy') this.abilities = baseAbilities();
	};
	pointsSpent = $derived(pointsSpent(this.abilities));
	pointsLeft = $derived(POINT_BUY_BUDGET - this.pointsSpent);

	bumpAbility = (ab: Ability, dir: 1 | -1) => {
		const cur = this.abilities[ab];
		if (this.method === 'point-buy' && !this.strict) {
			// lenient point-buy still respects budget/caps to keep the counter meaningful
		}
		if (this.method === 'point-buy') {
			if (dir === 1 && !canRaise(this.abilities, ab)) return;
			if (dir === -1 && !canLower(this.abilities, ab)) return;
		} else {
			// manual: 1..30 (Free) or 3..20 (Strict-ish) — stay lenient, just clamp sane bounds
			const lo = this.strict ? 3 : 1;
			const hi = this.strict ? 20 : 30;
			if (cur + dir < lo || cur + dir > hi) return;
		}
		this.abilities = { ...this.abilities, [ab]: cur + dir };
	};

	/** Standard array: assign the next unused value to an ability, or clear it. */
	assignArray = (ab: Ability, value: number | null) => {
		const next = { ...this.arrayPick };
		// remove this value from any other ability first (each value used once)
		if (value != null) for (const k of ABILITIES) if (next[k] === value) delete next[k];
		if (value == null) delete next[ab];
		else next[ab] = value;
		this.arrayPick = next;
		this.abilities = { ...this.abilities, [ab]: value ?? 8 };
	};
	/** Standard-array values not yet assigned to an ability. */
	arrayRemaining = $derived.by(() => {
		const used = new Set(Object.values(this.arrayPick));
		return STANDARD_ARRAY.filter((v) => !used.has(v));
	});

	// --- ability boosts (5.5e background choice; 5e species flows via effects) --
	boostCarrier = $derived(boostCarrier(this.system));
	backgroundBoostChoices = $derived.by<Ability[]>(() =>
		csv(this.backgroundRow?.data.ability_choices).filter((a): a is Ability =>
			(ABILITIES as readonly string[]).includes(a)
		)
	);
	/** All ability boosts folded together: 5.5e background choice + every ASI slot allocation. */
	abilityBoosts = $derived.by<Partial<Record<Ability, number>>>(() => {
		const out: Partial<Record<Ability, number>> = {};
		const add = (m: Partial<Record<Ability, number>>) => {
			for (const a of ABILITIES) if (m[a]) out[a] = (out[a] ?? 0) + (m[a] as number);
		};
		if (this.system === '5.5e' && this.backgroundBoostChoices.length)
			add(allocateBackgroundBoost(this.boostShape, this.boostPicks, this.backgroundBoostChoices));
		// species free-choice ASI (5e Half-Elf +1/+1)
		if (this.speciesBoostChoice)
			for (const ab of this.speciesBoostPicks)
				out[ab] = (out[ab] ?? 0) + this.speciesBoostChoice.amount;
		for (const s of this.featSlots) if (this.slotFeats[s.key] === ASI) add(this.asiBoostFor(s.key));
		return out;
	});
	toggleBoostPick = (ab: Ability) => {
		const cap = this.boostShape === '2-1' ? 2 : 3;
		if (this.boostPicks.includes(ab)) this.boostPicks = this.boostPicks.filter((a) => a !== ab);
		else if (this.boostPicks.length < cap) this.boostPicks = [...this.boostPicks, ab];
	};

	// --- feats: one ASI/feat slot per qualifying level, PER CLASS (RAW-correct for multiclass:
	// each class grants its ASIs at its own class levels — Fighter +6/14, Rogue +10) ------------
	featSlots = $derived.by<{ key: string; level: number; className: string }[]>(() => {
		const out: { key: string; level: number; className: string }[] = [];
		this.classes.forEach((c, i) => {
			if (!c.classId) return;
			const className = rowName(this.row(c.classId));
			for (const level of asiFeatLevels(c.classId, c.level))
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
	usedFeatRefs = $derived<string[]>(Object.values(this.slotFeats));
	/** A feat option is blocked for a slot if it's non-repeatable and already taken elsewhere. */
	featOptionBlocked = (ref: string, slotKey: string): boolean =>
		!this.isRepeatable(ref) && this.slotFeats[slotKey] !== ref && this.usedFeatRefs.includes(ref);
	setSlotFeat = (key: string, ref: string) => {
		const next = { ...this.slotFeats };
		if (ref) next[key] = ref;
		else delete next[key];
		this.slotFeats = next;
		// initialise / clear this slot's ASI allocation as needed
		if (ref === ASI && !this.slotAsi[key])
			this.slotAsi = { ...this.slotAsi, [key]: { shape: '2', picks: [] } };
		if (ref !== ASI && this.slotAsi[key]) {
			const asi = { ...this.slotAsi };
			delete asi[key];
			this.slotAsi = asi;
		}
	};
	filledSlots = $derived(this.featSlots.filter((s) => this.slotFeats[s.key]).length);

	// --- per-slot ASI allocation (+2 to one ability, or +1 to two) --------------
	asiBoostFor = (key: string): Partial<Record<Ability, number>> => {
		const a = this.slotAsi[key];
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
		const cur = this.slotAsi[key] ?? { shape, picks: [] };
		const cap = shape === '2' ? 1 : 2;
		this.slotAsi = { ...this.slotAsi, [key]: { shape, picks: cur.picks.slice(0, cap) } };
	};
	toggleAsiPick = (key: string, ab: Ability) => {
		const cur = this.slotAsi[key] ?? { shape: '2' as const, picks: [] as Ability[] };
		const cap = cur.shape === '2' ? 1 : 2;
		const picks = cur.picks.includes(ab)
			? cur.picks.filter((a) => a !== ab)
			: cur.picks.length < cap
				? [...cur.picks, ab]
				: cur.picks;
		this.slotAsi = { ...this.slotAsi, [key]: { ...cur, picks } };
	};

	// --- assembled draft + live sheet ------------------------------------------
	draft = $derived.by<Character>(() => {
		const build = {
			name: this.name || 'Unnamed',
			species: this.speciesId ?? undefined,
			// only persist the sub-option if it's valid for the chosen species (guards a stale pick)
			speciesOption: this.speciesOptions.some((o) => o.effectiveId === this.speciesOptionId)
				? (this.speciesOptionId ?? undefined)
				: undefined,
			background: this.backgroundId ?? undefined,
			classes: this.classes
				.filter((c) => c.classId)
				.map((c) => ({
					class: c.classId as string,
					level: c.level,
					subclass: c.subclassId ?? undefined
				})),
			abilities: { ...this.abilities },
			abilityBoosts: this.abilityBoosts as Record<string, number>,
			skills: [...new Set([...this.autoSkills, ...this.skills])],
			expertise: this.expertise.filter((s) => this.isProficient(s)),
			saves: csv(this.classRow?.data.saves) as Ability[],
			// origin feat (auto) + each filled slot that holds a real feat (ASI is not a feat —
			// its ability boost flows through abilityBoosts instead)
			feats: [
				...(this.originFeatRef ? [this.originFeatRef] : []),
				...this.featSlots.map((s) => this.slotFeats[s.key]).filter((r) => r && r !== ASI)
			],
			inventory: [],
			// cantrips are always-prepared; leveled spells start prepared (tweak in the Spellbook)
			spells: this.selectedSpells.map((ref) => {
				const lvl = Number(this.graph?.get(ref)?.data.level ?? 0);
				return { spell: ref, prepared: lvl > 0, alwaysPrepared: lvl === 0 };
			}),
			notes: ''
		};
		// parse leniently: fall back to a minimal valid character if a field is off
		const res = characterSchema.safeParse({
			schemaVersion: CHARACTER_SCHEMA_VERSION,
			id: slugify(this.name),
			system: this.system,
			build,
			play: { hp: { current: 0, temp: 0 } },
			ui: {}
		});
		if (res.success) return res.data;
		// last-resort: a bare valid character so the preview never crashes
		return characterSchema.parse({
			schemaVersion: CHARACTER_SCHEMA_VERSION,
			id: slugify(this.name),
			system: this.system,
			build: { name: build.name, abilities: build.abilities },
			play: { hp: { current: 0, temp: 0 } },
			ui: {}
		});
	});
	sheet = $derived.by<CharacterSheet | null>(() =>
		this.graph ? deriveSheet(this.draft, this.graph) : null
	);

	// --- validation --------------------------------------------------------------
	// Free is lenient (only a name is required). Strict adds allocation checks that BLOCK create.
	issues = $derived.by<string[]>(() => {
		const out: string[] = [];
		if (!this.name.trim()) out.push('Give your character a name.');
		if (!this.classId) out.push('Pick a class (you can change it later).');
		if (this.method === 'point-buy' && this.pointsLeft > 0)
			out.push(`${this.pointsLeft} ability points unspent.`);
		if (this.strict) {
			const needSkills = this.classSkillCount - this.skillChosenCount;
			if (needSkills > 0)
				out.push(`Choose ${needSkills} more skill${needSkills > 1 ? 's' : ''}.`);
			for (const pc of this.spellPicker) {
				const dc = pc.profile.cantripCap - pc.cantripsChosen;
				const dp = pc.profile.preparedCap - pc.leveledChosen;
				const who = this.spellPicker.length > 1 ? `${pc.profile.className} ` : '';
				if (dc > 0) out.push(`Choose ${dc} more ${who}cantrip${dc > 1 ? 's' : ''}.`);
				if (dp > 0) out.push(`Choose ${dp} more ${who}spell${dp > 1 ? 's' : ''}.`);
			}
		}
		return out;
	});
	// Free: name only. Strict: everything above must be resolved.
	canCreate = $derived(
		this.name.trim().length > 0 && (!this.strict || this.issues.length === 0)
	);

	save = async (): Promise<string | null> => {
		if (!this.canCreate) return null;
		this.saving = true;
		try {
			const character = this.draft;
			// start play HP at max so the sheet is playable immediately
			const max = this.sheet?.maxHp.value ?? 0;
			character.play.hp.current = max;
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
		const base = this.abilities[ab];
		const boost = this.abilityBoosts[ab] ?? 0;
		const total = this.sheet?.abilities[ab].score ?? base;
		const extra = total - base - boost; // species / effect contribution
		const parts: string[] = [`base ${base}`];
		if (boost) parts.push(`boost +${boost}`);
		if (extra) parts.push(`${this.boostCarrier === 'species' ? 'species' : 'other'} ${extra > 0 ? '+' : ''}${extra}`);
		return parts.join(' · ');
	};
	abilityCost = (ab: Ability): number => pointBuyCost(this.abilities[ab]);
}

/** The single shared Build view-model instance. */
export const build = new BuildVM();

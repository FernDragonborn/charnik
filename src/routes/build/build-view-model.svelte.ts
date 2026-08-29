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
import { content, loadContentStore } from '$lib/content/store.svelte';
import { isRowActive } from '$lib/content/sources.svelte';
import { deriveSheet, type CharacterSheet, SKILL_ABILITY } from '$lib/character/derive';
import { plugins } from '$lib/effects/plugin-store.svelte';
import { ABILITIES, type Character } from '$lib/character/schema';
import { assembleCharacter } from '$lib/character/assemble';
import { classCasts } from '$lib/character/spellcasting';
import { saveCharacterToStore, openCharacter } from '$lib/character/store.svelte';
import { uniqueCharacterId } from '$lib/character/repository';
import { getUserStorage } from '$lib/storage/provider';
import type { LoadedRow, LoadedRowByType } from '$lib/content/loader';
import type { Ability } from '$lib/rules/core';
import {
	parseSpeciesBoostChoice,
	speciesFixedAbilities as fixedAbilitiesFromRows,
	buildSpellPicker,
	buildTodos,
	expertiseBudget,
	openSubclassChoices,
	type BuildTodo,
} from '$lib/build/derive';
import { Inspector, targetForTodo } from './inspector.svelte';
import { splitList, type ContentType } from '$lib/content/schemas';
import { slugify } from '$lib/util/slug';
import { FeatSlots } from './feat-slots.svelte';
import { AbilityAllocation } from './ability-allocation.svelte';
import { ASI, rowName, rowOfType } from './rows';
import { resolveItem, type ResolvedItem } from '$lib/content/resolved-item';
import {
	addItem,
	bumpQty,
	isEquippable,
	removeItem,
	toggleEquipped
} from '$lib/character/inventory';
// re-exported so every existing `from '../build-view-model.svelte'` import keeps working
export { ASI, rowName, rowOfType };
import {
	toggleCapped,
	blankDraft,
	draftFromCharacter,
	draftSummary,
	isDraftWorthKeeping,
	type DraftState,
	type EditContext
} from './draft';
import { saveDraft, deleteDraft, type DraftRecord } from '$lib/character/draft-repository';
import { switchClass, type ClassScopedPicks } from './class-picks-cache';

const csv = splitList;


/**
 * Under the 400-line lint since the ability scores and their boosts moved to `AbilityAllocation`.
 * Already out before that: the draft model + factories → `build/draft.ts`; every pure derivation
 * (spell picker, `assembleCharacter`, `draftFromCharacter`, issues) → `build/derive.ts`; the ASI/feat
 * slot machinery → `feat-slots.svelte.ts`.
 *
 * **The `bind:`-ed draft is what makes further splits expensive**, and two prior sessions stopped
 * here for that reason. It is one `$state` object whose fields are bound across `build/blocks/*`, so
 * relocating any of it moves `bind:` surface across the component↔VM seam — where a reactivity break
 * escapes unit tests and only the running UI shows it. The ability carve worked because it moved
 * DERIVATIONS over the draft, never the draft itself: not one `bind:` target changed.
 *
 * Apply that test to the next candidate (the option lists, the spell picker, skills+expertise). If it
 * would move a bound field, verify live via `shot.mjs` and a driven browser, never blind.
 */
class BuildVM {
	// read the shared reactive content store → a live content refresh re-derives options with no reload
	graph = $derived(content.graph);

	// --- draft choices: ONE reactive object (field set defined in DraftState / blankDraft) --------
	draft = $state<DraftState>(blankDraft());

	toggleLanguage = (ref: string) => {
		this.draft.selectedLanguages = this.draft.selectedLanguages.includes(ref)
			? this.draft.selectedLanguages.filter((x) => x !== ref)
			: [...this.draft.selectedLanguages, ref];
	};
	// the list semantics are shared with the combat sheet's inventory panel ($lib/character/inventory);
	// what differs between the two is only where the list lives.
	addInventoryItem = (ref: string) => (this.draft.inventory = addItem(this.draft.inventory, ref));
	removeInventoryItem = (ref: string) =>
		(this.draft.inventory = removeItem(this.draft.inventory, ref));
	bumpItemQty = (ref: string, d: number) =>
		(this.draft.inventory = bumpQty(this.draft.inventory, ref, d));
	toggleItemEquipped = (ref: string) =>
		(this.draft.inventory = toggleEquipped(this.draft.inventory, ref));
	/** Can this item be equipped (armor / shield / weapon)? */
	itemEquippable = (ref: string): boolean => isEquippable(this.resolvedItem(ref));

	saving = $state(false);

	load = async () => {
		await loadContentStore(); // populate the shared graph; `this.graph` derives from it
	};

	// --- edit / level-up: hydrate the draft from an existing character --------------------------
	/** Set when editing an existing character (level-up). Save overwrites this id + keeps its play
	 *  state, instead of creating a new character. */
	/** Level-up / edit context, or null when creating a new character. Groups the loaded character's
	 *  identity + play/ui to preserve, and the boosts/feats/spells/skills carried over verbatim (new
	 *  picks at the new level add on top; carried spells/skills lock in Strict edit). */
	edit = $state<EditContext | null>(null);

	/** Reset the draft to a blank new-character state (the BuildVM is a shared singleton, so opening
	 *  "New character" after a level-up must clear the prior edit/hydrated state). Keeps the graph. */
	reset = () => {
		this.edit = null;
		this.draft = blankDraft();
		this.classPicks.clear();
		this.draftGuid = crypto.randomUUID();
	};

	// --- the draft as a thing that survives leaving -----------------------------------------------
	/** Identity of the unfinished build on disk. A GUID because a draft has no name to be keyed by
	 *  and may never get one (AGENTS.md: identify anything shareable with a GUID). */
	draftGuid = $state<string>(crypto.randomUUID());

	/** Write the draft, or remove it once there is nothing left worth keeping. Called debounced by
	 *  the page; safe to call at any time. */
	persistDraft = async (): Promise<void> => {
		if (this.edit) return; // editing a real character — its own save is the record
		const storage = getUserStorage();
		if (!isDraftWorthKeeping(this.draft)) return deleteDraft(storage, this.draftGuid);
		await saveDraft(storage, {
			guid: this.draftGuid,
			savedAt: new Date().toISOString(),
			summary: draftSummary(this.draft),
			draft: $state.snapshot(this.draft),
			classPicks: [...this.classPicks]
		});
	};

	/** Resume an unfinished build, cache and all. */
	hydrateDraft = (record: DraftRecord): void => {
		this.edit = null;
		this.draft = record.draft as DraftState;
		this.classPicks = new Map(record.classPicks as [string, ClassScopedPicks][]);
		this.draftGuid = record.guid;
	};

	/** Load an existing character into the draft (for level-up / editing). Straightforward fields map
	 *  directly (via `draftFromCharacter`); abilities become manual (base scores) with boosts carried
	 *  in `hydratedBoosts`, and the existing feats/skills/spells carried for Strict-edit locking. */
	hydrate = (char: Character) => {
		this.draft = draftFromCharacter(char); // restores the per-slot picks (UBUG-13)
		// The restored slots now RE-DERIVE their own ASI/half-feat boosts, so carrying those flat too
		// would double-count. Carry only the residue (species/background boosts + old saves that stored
		// no slots → nothing subtracts, so their whole flat boost survives, unchanged old behaviour).
		const carried: Partial<Record<Ability, number>> = { ...char.build.abilityBoosts };
		for (const [ab, n] of Object.entries(this.abilities.slotBoosts)) {
			const left = (carried[ab as Ability] ?? 0) - (n);
			if (left > 0) carried[ab as Ability] = left;
			else delete carried[ab as Ability];
		}
		this.edit = {
			id: char.id,
			play: char.play,
			ui: char.ui,
			boosts: carried,
			// slot feats re-derive from the restored slots; carry only NON-slot feats (origin/auto) so
			// they aren't lost. (Feats dedup via Set, so this is belt-and-braces vs the boost double.)
			feats: char.build.feats.filter((f) => !Object.values(char.build.slotPicks.feats).includes(f)),
			featSkills: [...(char.build.featSkills ?? [])],
			skills: new Set(char.build.skills),
			spells: new Set(this.draft.selectedSpells)
		};
	};

	// --- content option lists (filtered by the draft's system) -----------------
	// B5: every builder picker (species/class/feat/spell/item/language/subclass/species_option)
	// flows through here, so the two-dimensional source filter (disabled file OR disabled `source`
	// tag, plus the losing side of a resolved collision) is applied at this one choke point — a
	// disabled row must not be offerable for a NEW build, same as it's hidden from the compendium.
	// Reactive: isRowActive reads the reactive source config, so a live toggle re-derives the lists.
	/** RV3: the refs currently picked for a content type. `list()` keeps these even when their source
	 *  is disabled, so a selection the user made BEFORE turning a source off never vanishes from its own
	 *  picker (and stays re-pickable) — mirroring how the spellbook keeps the character's own spells
	 *  regardless of the source filter. Refs are stored as `effectiveId` (the picker option values). */
	private selectedIdsFor(type: ContentType): Set<string> {
		const d = this.draft;
		const idsByType: Partial<Record<ContentType, (string | null)[]>> = {
			species: [d.speciesId],
			species_option: [d.speciesOptionId],
			background: [d.backgroundId],
			class: d.classes.map((c) => c.classId),
			subclass: d.classes.map((c) => c.subclassId),
			feat: Object.values(d.slotFeats),
			language: d.selectedLanguages,
			item: d.inventory.map((i) => i.item),
			spell: d.selectedSpells,
		};
		return new Set((idsByType[type] ?? []).filter((x): x is string => !!x));
	}

	private list<T extends ContentType>(type: T): LoadedRowByType<T>[] {
		if (!this.graph) return [];
		const keep = this.selectedIdsFor(type); // RV3: never drop a currently-picked ref
		return [...this.graph.list(type, { system: this.draft.system })]
			.filter((r) => isRowActive(r) || keep.has(r.effectiveId))
			.sort((a, b) => rowName(a).localeCompare(rowName(b)));
	}
	speciesList = $derived(this.list('species'));
	backgroundList = $derived(this.list('background'));
	classList = $derived(this.list('class'));
	featList = $derived(this.list('feat'));
	languageList = $derived(this.list('language'));
	itemList = $derived(this.list('item'));

	row(id: string | null): LoadedRow | undefined {
		return id && this.graph ? this.graph.get(id) : undefined;
	}
	/** An inventory item as the sheet reads it — tags, plus whatever it inherits from its base item.
	 *  The graph lives here, so a component never resolves an item itself and gets a +1 plate's AC
	 *  from its own (empty) tags. */
	resolvedItem = (id: string | null): ResolvedItem | undefined => {
		const row = rowOfType(this.row(id), 'item');
		return row && this.graph ? resolveItem(this.graph, row) : undefined;
	};
	/** Subclasses available for a given class ref (per multiclass row). */
	subclassesFor = (classId: string | null): LoadedRow[] => {
		const cls = this.row(classId);
		if (!cls) return [];
		return this.list('subclass').filter((r) => String(r.data.class_id) === String(cls.id));
	};

	speciesRow = $derived(rowOfType(this.row(this.draft.speciesId), 'species'));
	backgroundRow = $derived(rowOfType(this.row(this.draft.backgroundId), 'background'));

	/** Sub-options (subrace / lineage) for the chosen species, in the draft's edition. */
	speciesOptions = $derived.by(() => {
		const sp = this.speciesRow;
		if (!sp) return [];
		return this.list('species_option').filter((r) => String(r.data.species_id) === String(sp.id));
	});
	speciesOptionRow = $derived(rowOfType(this.row(this.draft.speciesOptionId), 'species_option'));
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
	speciesBoostChoice = $derived(
		parseSpeciesBoostChoice(
			String(this.speciesOptionRow?.data.boost_choice || this.speciesRow?.data.boost_choice || '')
		)
	);
	/** Abilities already raised by the species' FIXED ASI (its effects) — excluded from the choice
	 *  (5e Half-Elf's +1/+1 goes to two abilities OTHER than the +2 CHA). */
	speciesFixedAbilities = $derived(fixedAbilitiesFromRows([this.speciesRow, this.speciesOptionRow]));
	/** Abilities offered for the free choice (all six minus the fixed-boosted ones). */
	speciesBoostAbilities = $derived<Ability[]>(
		ABILITIES.filter((a) => !this.speciesFixedAbilities.has(a))
	);
	toggleSpeciesBoostPick = (ab: Ability) => {
		this.draft.speciesBoostPicks = toggleCapped(
			this.draft.speciesBoostPicks,
			ab,
			this.speciesBoostChoice?.count ?? 0
		);
	};

	// --- multiclass rows -------------------------------------------------------
	primaryClassId = $derived<string | null>(this.draft.classes[0]?.classId ?? null);
	classId = $derived<string | null>(this.primaryClassId); // primary drives saves/skills/ASI
	classRow = $derived(rowOfType(this.row(this.primaryClassId), 'class'));
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
	/** Change the class in row `i`, stashing what the outgoing one owned under its own ref and handing
	 *  it straight back if it returns — so trying a class costs nothing (see `class-picks-cache`). */
	setClass = (i: number, id: string | null) => switchClass(this.draft, i, id, this.classPicks);
	/** Class-scoped picks by class ref, for as long as this draft lives. */
	classPicks = new Map<string, ClassScopedPicks>();
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
			const row = rowOfType(this.row(c.classId), 'class');
			return !!row && classCasts(row);
		})
	);
	/**
	 * Spell picker, PER caster class (one section each — single-class collapses to one). Strict
	 * shows only legally-pickable spells (via the access map, cantrips always + leveled ≤ the
	 * class's max spell level); Free lifts every gate. Mirrors the skills Strict/Free toggle.
	 */
	spellPicker = $derived.by(() =>
		this.graph && this.sheet
			? buildSpellPicker({
					allSpells: this.list('spell'),
					sheet: this.sheet,
					graph: this.graph,
					strict: this.draft.strict,
					selectedSpells: this.draft.selectedSpells
				})
			: []
	);
	toggleSpell = (ref: string) => {
		if (this.draft.selectedSpells.includes(ref)) {
			if (this.edit && this.draft.strict && this.edit.spells.has(ref)) {
				toast("Strict: you can't unlearn a known spell — switch to Free to remove it.");
				return;
			}
			this.draft.selectedSpells = this.draft.selectedSpells.filter((s) => s !== ref);
			return;
		}
		// Strict: block picking past the cantrip / prepared cap of any class this spell counts for
		if (this.draft.strict) {
			const lvl = Number(rowOfType(this.graph?.get(ref), 'spell')?.data.level ?? 0);
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
			if (this.edit && this.draft.strict && this.edit.skills.has(skill)) {
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
	/** N4a: expertise slots the drafted classes' features unlock (Rogue L1+L6, Bard L3+L10). */
	expertiseCap = $derived(
		this.graph ? expertiseBudget(this.draft.classes, this.graph, this.draft.system) : 0
	);
	expertiseUsed = $derived(this.draft.expertise.filter((s) => this.isProficient(s)).length);
	/** Toggle expertise (×2) on a proficient skill. Strict enforces the class-granted cap (Free lets
	 *  you exceed it — same policy as skill picks); removing is always allowed. */
	toggleExpertise = (skill: string) => {
		if (!this.isProficient(skill)) return;
		const has = this.draft.expertise.includes(skill);
		if (!has && this.draft.strict && this.expertiseUsed >= this.expertiseCap) return;
		this.draft.expertise = has
			? this.draft.expertise.filter((s) => s !== skill)
			: [...this.draft.expertise, skill];
	};
	/** A skill is pickable when Free, or (Strict) it's on the class list / the class has no list. */
	skillPickable = (skill: string): boolean =>
		this.autoSkills.includes(skill) ||
		!this.draft.strict ||
		this.classSkillCount === 0 ||
		this.classSkillOptions.includes(skill);

	/** Feat / ASI slots (which levels grant one, what fills it, the choices it then asks for) — see
	 *  feats.svelte.ts. */
	feats = new FeatSlots(() => this);
	/** Ability scores + every boost layered on them — see ability-allocation.svelte.ts. Read as
	 *  `b.abilities.*`: unlike the combat subsystems this one has a single consumer component, so it
	 *  is addressed directly instead of behind a dozen forwarding accessors. */
	abilities = new AbilityAllocation(() => this);

	// --- assembled character + live sheet --------------------------------------
	/** Carried over from a loaded character (level-up), else the auto origin feat. */
	private get carriedFeats(): string[] {
		if (this.edit) return this.edit.feats;
		return this.feats.originFeatRef ? [this.feats.originFeatRef] : [];
	}

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
			abilityBoosts: this.abilities.abilityBoosts as Record<string, number>,
			skills: [...new Set([...this.autoSkills, ...this.draft.skills])],
			// §C feat-granted skills (Skilled) kept in their OWN field so the class-skill cap counter isn't
			// inflated on edit; carried verbatim on edit (like abilityBoosts) + new slot picks on top
			featSkills: [...new Set([...(this.edit?.featSkills ?? []), ...this.feats.featSkillPicks])],
			expertise: this.draft.expertise.filter((s) => this.isProficient(s)),
			saves: this.classRow?.data.saves ?? [],
			// origin feat (auto) + each filled slot that holds a real feat (ASI is not a feat —
			// its ability boost flows through abilityBoosts instead)
			feats: [
				...new Set([
					...this.carriedFeats,
					...this.feats.featSlots.map((s) => this.draft.slotFeats[s.key]).filter((r) => r && r !== ASI)
				])
			],
			// persist the per-slot picks so a later level-up restores filled slots (UBUG-13)
			slotPicks: {
				feats: { ...this.draft.slotFeats },
				asi: { ...this.draft.slotAsi },
				featAbility: { ...this.draft.slotFeatAbility },
				featSkills: { ...this.draft.slotFeatSkills }
			},
			languages: [...this.draft.selectedLanguages],
			inventory: this.draft.inventory.map((i) => ({ ...i })),
			// cantrips are always-prepared; leveled spells start prepared (tweak in the Spellbook)
			spells: this.draft.selectedSpells.map((ref) => {
				const lvl = Number(rowOfType(this.graph?.get(ref), 'spell')?.data.level ?? 0);
				return { spell: ref, prepared: lvl > 0, alwaysPrepared: lvl === 0 };
			}),
			notes: this.draft.notes
		};
		// editing keeps the original id + play/ui; creating derives a fresh id from the name
		return assembleCharacter(build, {
			id: this.edit?.id ?? (slugify(this.draft.name) || 'hero'),
			system: this.draft.system,
			strict: this.draft.strict,
			shortRestMode: this.draft.shortRestMode,
			play: this.edit?.play ?? null,
			ui: this.edit?.ui ?? null
		});
	});
	sheet = $derived.by<CharacterSheet | null>(() => {
		void plugins.version; // a plugin enable/disable re-derives the preview live
		return this.graph ? deriveSheet(this.assembled, this.graph, isRowActive) : null;
	});

	// --- the inspector (right pane) -------------------------------------------------------------
	/** The choice currently open in the right pane, and the flow that commits it. */
	inspector = new Inspector(() => this);

	/**
	 * The sheet the draft WOULD produce with `mutate` applied — the real pipeline, on a trial draft,
	 * then put back. Derived reads are pull-based, so the whole `assembled → sheet` chain recomputes
	 * inside this synchronous window and again when the draft is restored; nothing outside ever
	 * observes the trial state. Deliberately expensive (a full `deriveSheet`) — call it for the ONE
	 * option a player is reading, never per row of a list.
	 *
	 * Running the REAL pipeline is the point: a hand-written "what a background gives you" summary
	 * would drift from what the engine actually applies, and the drift would be invisible.
	 *
	 * The sharp edge: this writes to `this.draft` from inside a `$derived` (`Inspector.changes`),
	 * which `docs/internals/ui.md` otherwise forbids. It is safe because the write is undone in the
	 * same synchronous frame, so no consumer ever sees the trial value and the dependency graph ends
	 * where it started. If Svelte ever makes that a hard error, the upgrade is to move `changes` into
	 * an `$effect` that writes a `$state` — one tick of lag, same output.
	 */
	previewSheet = (mutate: () => void): CharacterSheet | null => {
		const restore = $state.snapshot(this.draft); // already a deep clone
		try {
			mutate();
			return this.sheet;
		} finally {
			this.draft = restore;
		}
	};

	// --- what is still unfinished ----------------------------------------------------------------
	/** Every empty required field, in fix-it order — the "still to do" bar, each line a link into the
	 *  inspector. Built at ANY starting level: each level's subclass and feat slot is its own line. */
	todos = $derived.by<BuildTodo[]>(() =>
		buildTodos({
			name: this.draft.name,
			method: this.draft.method,
			strict: this.draft.strict,
			hasSpecies: !!this.draft.speciesId,
			needsSpeciesOption: this.speciesOptions.length > 0 && !this.draft.speciesOptionId,
			hasBackground: !!this.draft.backgroundId,
			hasClass: !!this.classId,
			openSubclasses: this.openSubclasses,
			pointsLeft: this.abilities.pointsLeft,
			classSkillCount: this.classSkillCount,
			skillChosenCount: this.skillChosenCount,
			openFeatSlots: this.feats.featSlots.filter((s) => !this.draft.slotFeats[s.key]),
			spellPicker: this.spellPicker
		})
	);

	openSubclasses = $derived(
		this.graph ? openSubclassChoices(this.draft.classes, this.graph, (r) => rowName(r)) : []
	);

	/** The inspector target that fixes a todo — so clicking the line opens the control, not a page. */
	todoTarget = targetForTodo;

	/** Blocking todos — what stands between the draft and a playable character, and the ONLY gate on
	 *  creating one. Each carries the inspector target that resolves it (`todoTarget`). */
	blocking = $derived(this.todos.filter((t) => t.required));
	canCreate = $derived(this.blocking.length === 0);

	save = async (): Promise<string | null> => {
		if (!this.canCreate) return null;
		this.saving = true;
		try {
			const character = this.assembled;
			// new character: start play HP at max so it's playable immediately, AND stamp a
			// collision-free id (slug + suffix) so two same-named builds don't overwrite (D14).
			// Editing/level-up: keep the existing id + play state (HP, effects, spent slots…).
			if (!this.edit) {
				character.id = await uniqueCharacterId(getUserStorage(), slugify(this.draft.name) || 'hero');
				character.play.hp.current = this.sheet?.maxHp.value ?? 0;
			}
			await saveCharacterToStore(character);
			// the draft became a character, so the unfinished copy has nothing left to be
			await deleteDraft(getUserStorage(), this.draftGuid);
			// make the freshly-created character the active one so Combat opens IT, not the demo
			await openCharacter(character.id);
			return character.id;
		} finally {
			this.saving = false;
		}
	};

}

/** The single shared Build view-model instance. */
export const build = new BuildVM();

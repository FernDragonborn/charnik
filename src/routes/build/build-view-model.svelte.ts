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
import { t } from '$lib/i18n';
import { content, loadContentStore } from '$lib/content/store.svelte';
import { isRowActive } from '$lib/content/sources.svelte';
import { deriveSheet, type CharacterSheet } from '$lib/character/derive';
import { plugins } from '$lib/effects/plugin-store.svelte';
import type { Character } from '$lib/character/schema';
import { assembleCharacter } from '$lib/character/assemble';
import { saveCharacterToStore, openCharacter } from '$lib/character/store.svelte';
import {
	removeCharacterPhotos,
	uniqueCharacterId,
	writeCharacterPhoto,
} from '$lib/character/repository';
import {
	downscalePhoto,
	type PickedPhoto,
	type PortraitSource,
} from '$lib/character/photo';
import { getUserStorage } from '$lib/storage/provider';
import type { LoadedRow, LoadedRowByType } from '$lib/content/loader';
import {
	buildTodos,
	openSubclassChoices,
	type BuildTodo,
} from '$lib/build/derive';
import { Inspector, targetForTodo } from './inspector.svelte';
import { ClassRows } from './class-rows.svelte';
import { SkillPicks } from './skill-picks.svelte';
import { SpellPicks } from './spell-picks.svelte';
import type { ContentType } from '$lib/content/schemas';
import type { SystemId } from '$lib/stores/app.svelte';
import { slugify } from '$lib/util/slug';
import { FeatSlots } from './feat-slots.svelte';
import { AbilityAllocation } from './ability-allocation.svelte';
import { ASI, rowName, rowOfType } from './rows';
import { DraftInventory } from './draft-inventory';
// the blocks reach these through the view-model they already import, so `rows` stays a leaf nobody
// has to know about to print a name
export { ASI, rowName, rowOfType };
import {
	blankDraft,
	draftFromCharacter,
	selectedRefs,
	allSelectedRefs,
	parseDraftState,
	type DraftState,
	type EditContext
} from './draft';
import type { DraftRecord } from '$lib/character/draft-repository';
import { DraftSession } from './draft-session.svelte';
import { DraftHistory } from './draft-history.svelte';
import { parseClassPicks, switchClass, type ClassScopedPicks } from './class-picks-cache';

/** The id a character with no usable name gets. Not copy — an id, and one the user never reads. */
const FALLBACK_SLUG = 'hero';


/**
 * What is left here is the draft itself and the derivations that read all of it. Everything with a
 * narrower job lives beside it: `ClassRows`, `SkillPicks`, `SpellPicks`, `AbilityAllocation`,
 * `FeatSlots`, `DraftInventory`, `DraftSession`, `DraftHistory`, `Inspector`, and the pure model in
 * `draft.ts` / `derive.ts`.
 *
 * **The `bind:`-ed draft is what makes a further split expensive.** It is one `$state` object whose
 * fields are bound across `build/blocks/*`, so moving any of it moves `bind:` surface across the
 * component↔view-model seam — where a broken binding passes every unit test and only the running UI
 * shows it. A carve that moves DERIVATIONS over the draft is cheap; one that moves a bound field is
 * not, and is verified in a driven browser rather than reasoned about.
 */
/** One id for the Create failure, so a disk that stays full replaces its notice rather than stacking
 *  one per press. Same pattern as the draft autosave's. */
const CREATE_FAILED_TOAST = 'build-create-failed';

export class BuildVM {
	// read the shared reactive content store → a live content refresh re-derives options with no reload
	graph = $derived(content.graph);

	// --- draft choices: ONE reactive object (field set defined in DraftState / blankDraft) --------
	draft = $state<DraftState>(blankDraft());

	toggleLanguage = (ref: string) => {
		this.draft.selectedLanguages = this.draft.selectedLanguages.includes(ref)
			? this.draft.selectedLanguages.filter((x) => x !== ref)
			: [...this.draft.selectedLanguages, ref];
	};
	/** Carrying, equipping and resolving items — see `draft-inventory`. */
	inventory = new DraftInventory(() => this);

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
		this.pickedPhoto = null; // bytes belong to the build they were picked for, not to the next one
		this.draft = blankDraft();
		this.classPicks.clear();
		this.drafts.renew();
		this.history.reset();
		this.inspector.close(); // a pane open on a slot the blank draft does not have
	};

	/** The unfinished build on disk — autosave, resume, discard. See `draft-session`. */
	drafts = new DraftSession(() => ({
		draft: this.draft,
		classPicks: this.classPicks,
		isEditing: !!this.edit
	}));

	/** Undo / redo over the draft — see `draft-history`. The page records a step on the autosave's
	 *  debounce, so one settled change is one step. */
	history = new DraftHistory({
		read: () => ({ draft: this.draft, classPicks: [...this.classPicks] }),
		write: (step) => {
			this.draft = step.draft;
			this.classPicks = new Map(step.classPicks);
		}
	});

	/** Resume an unfinished build, cache and all. */
	hydrateDraft = (record: DraftRecord): void => {
		this.edit = null;
		this.pickedPhoto = null; // see `reset`
		// parsed, not cast: the record is a file the user can edit and an older Charnik may have written
		this.draft = parseDraftState(record.draft);
		this.classPicks = parseClassPicks(record.classPicks);
		this.drafts.adopt(record);
		this.history.reset();
		this.inspector.close();
	};

	/** Load an existing character into the draft (for level-up / editing). Straightforward fields map
	 *  directly (via `draftFromCharacter`); abilities become manual (base scores) with boosts carried
	 *  in `hydratedBoosts`, and the existing feats/skills/spells carried for Strict-edit locking. */
	hydrate = (char: Character) => {
		const loaded = draftFromCharacter(char); // restores the per-slot picks (UBUG-13)
		// copied BEFORE the draft takes it: `draftFromCharacter` mints a row id for a save made before
		// rows had one, so reading the character twice would produce two sets of keys
		const settled = structuredClone(loaded);
		this.draft = loaded;
		// This view-model is a singleton, so everything the PREVIOUS build left behind is still here.
		// The portrait is the sharpest of those: `portraitSource` prefers a pick over the stored file,
		// so an abandoned build's face would show on this character AND be written over their own.
		this.pickedPhoto = null;
		// The stash is keyed by class ref alone: left in place, taking a class this character never had
		// hands it the level and the skills another character stashed under that same ref.
		this.classPicks.clear();
		// A new identity for the same reason: the guid in the session belongs to the unfinished build
		// this edit navigated away from, and saving discards whatever guid it is holding.
		this.drafts.renew();
		this.inspector.close();
		this.edit = {
			id: char.id,
			play: char.play,
			ui: char.ui,
			// verbatim: the restored slots re-derive their own share of this, and `abilityBoosts` is
			// where the two are reconciled — see the note there for why it cannot happen at this line
			boosts: { ...char.build.abilityBoosts },
			// slot feats re-derive from the restored slots; carry only NON-slot feats (origin/auto) so
			// they aren't lost. (Feats dedup via Set, so this is belt-and-braces vs the boost double.)
			feats: char.build.feats.filter((f) => !Object.values(char.build.slotPicks.feats).includes(f)),
			featSkills: [...(char.build.featSkills ?? [])],
			skills: new Set(char.build.skills),
			spells: new Set(this.draft.selectedSpells),
			spellFlags: new Map(
				char.build.spells.map((s) => [
					s.spell,
					{ prepared: s.prepared, alwaysPrepared: s.alwaysPrepared },
				]),
			),
			loaded: settled
		};
		this.history.reset();
	};

	// --- content option lists (filtered by the draft's system) -----------------
	// B5: every builder picker (species/class/feat/spell/item/language/subclass/species_option)
	// flows through here, so the two-dimensional source filter (disabled file OR disabled `source`
	// tag, plus the losing side of a resolved collision) is applied at this one choke point — a
	// disabled row must not be offerable for a NEW build, same as it's hidden from the compendium.
	// Reactive: isRowActive reads the reactive source config, so a live toggle re-derives the lists.
	private list<T extends ContentType>(type: T): LoadedRowByType<T>[] {
		if (!this.graph) return [];
		const keep = selectedRefs(this.draft, type); // RV3: never drop a currently-picked ref
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
	/** Read by the spell picker, which needs the whole pool before it sections it per caster class. */
	spellList = $derived(this.list('spell'));

	row(id: string | null): LoadedRow | undefined {
		return id && this.graph ? this.graph.get(id) : undefined;
	}
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
	/** The CONTENT's own word for this choice ("Subrace" 2014, "Lineage" 2024). A pack that names
	 *  none falls back to the catalog's word rather than to an English one written here. */
	speciesOptionLabel = $derived(
		String(this.speciesOptions[0]?.data.option_label ?? t('build.spec.lineageFallback'))
	);
	/** Pick a species; clears the now-stale sub-option + free-boost choices. */
	pickSpecies = (id: string | null) => {
		this.draft.speciesId = id;
		this.draft.speciesOptionId = null;
		this.draft.speciesBoostPicks = [];
	};

	// --- the edition this character is built in --------------------------------
	/**
	 * What switching to `system` would drop: every pick whose row does not exist in that edition.
	 *
	 * A ref that resolves to nothing at all is left out — that pick is already broken, and switching
	 * is not what broke it.
	 */
	picksLostBySwitching = (system: SystemId): { type: ContentType; ref: string; name: string }[] => {
		const graph = this.graph;
		if (!graph) return [];
		return allSelectedRefs(this.draft).flatMap(({ type, ref }) => {
			const row = graph.get(ref);
			return row && !row.systems.includes(system) ? [{ type, ref, name: rowName(row) }] : [];
		});
	};

	/**
	 * Change the edition, taking the picks the new one has no row for with it.
	 *
	 * Leaving them in place is what made a 5e Half-Elf keep applying its +1/+1 after a flip to 5.5e:
	 * the species still RESOLVED by id, so the boost was still allocated, while the chips that let
	 * you see or clear it were gone with the edition that offered them. A pick the current edition
	 * cannot show is a pick nobody can undo.
	 */
	switchSystem = (system: SystemId) => {
		const dropped = new Set(this.picksLostBySwitching(system).map((p) => p.ref));
		this.draft.system = system;
		if (!dropped.size) return;
		if (this.draft.speciesId && dropped.has(this.draft.speciesId)) this.pickSpecies(null);
		if (this.draft.speciesOptionId && dropped.has(this.draft.speciesOptionId))
			this.draft.speciesOptionId = null;
		if (this.draft.backgroundId && dropped.has(this.draft.backgroundId))
			this.draft.backgroundId = null;
		this.draft.classes.forEach((row, i) => {
			if (row.subclassId && dropped.has(row.subclassId)) this.classRows.setSubclass(i, null);
			// through `switchClass`, so the row's slot picks and its stash are handled the one way
			if (row.classId && dropped.has(row.classId)) switchClass(this.draft, i, null, this.classPicks);
		});
		for (const [key, ref] of Object.entries(this.draft.slotFeats))
			if (dropped.has(ref)) this.feats.setSlotFeat(key, '');
		this.draft.selectedLanguages = this.draft.selectedLanguages.filter((r) => !dropped.has(r));
		this.draft.selectedSpells = this.draft.selectedSpells.filter((r) => !dropped.has(r));
		this.draft.inventory = this.draft.inventory.filter((i) => !dropped.has(i.item));
	};

	// --- what a played character has already settled ---------------------------------------------
	/**
	 * The draft as the level-up loaded it, when Strict says those decisions are made — `null` while
	 * creating a character, and `null` in Free, which lifts every lock here.
	 *
	 * A level-up ADDS levels to a character that has been played. Re-picking its species or unmaking
	 * the class it reached level 5 in is not levelling up, it is rewriting history — which is exactly
	 * what Free is for, and why the toggle is the way out rather than a per-control override.
	 */
	settledDraft = $derived<DraftState | null>(
		this.edit && this.draft.strict ? this.edit.loaded : null
	);

	// --- multiclass rows -------------------------------------------------------
	/** Which class each row holds, at what level, and the guards over changing that — see
	 *  class-rows.svelte.ts. */
	// annotated, unlike its siblings: `classRow` below reads back out of it, so leaving the type to be
	// inferred asks TypeScript for a member of BuildVM while it is still working out what BuildVM is
	classRows: ClassRows = new ClassRows(() => this);
	/** Class-scoped picks by class ref, for as long as this draft lives. */
	classPicks = new Map<string, ClassScopedPicks>();
	classRow = $derived(rowOfType(this.row(this.classRows.primaryClassId), 'class'));

	/** Which spells are chosen, and the Strict caps over them — see spell-picks.svelte.ts. */
	spellPicks = new SpellPicks(() => this);

	/** How many free "of your choice" languages the background grants (display only). */
	backgroundLangCount = $derived(Number(this.backgroundRow?.data.languages ?? 0));

	/** Skill proficiencies and expertise — the class list, the background's grants, and the two capped
	 *  pickers over them. See skill-picks.svelte.ts. */
	skillPicks: SkillPicks = new SkillPicks(() => this);

	/** Feat / ASI slots (which levels grant one, what fills it, the choices it then asks for) — see
	 *  feats.svelte.ts. */
	feats: FeatSlots = new FeatSlots(() => this);
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
			name: this.draft.name || t('build.unnamed'),
			// the file, not the bytes: a portrait picked this session is written when the character gets
			// a folder, and `save` puts its name here (and on the draft) once it has one
			photo: this.draft.photo ?? undefined,
			species: this.draft.speciesId ?? undefined,
			// only persist the sub-option if it's valid for the chosen species (guards a stale pick)
			speciesOption: this.speciesOptions.some((o) => o.effectiveId === this.draft.speciesOptionId)
				? (this.draft.speciesOptionId ?? undefined)
				: undefined,
			background: this.draft.backgroundId ?? undefined,
			classes: this.draft.classes
				.flatMap((c) =>
					c.classId
						? [{
								// the row id travels with the row: `slotPicks` is keyed by it, so a level-up
								// that minted fresh ids would restore every slot under a key nothing looks up
								rowId: c.rowId,
								class: c.classId,
								level: c.level,
								subclass: c.subclassId ?? undefined
							}]
						: [],
				),
			abilities: { ...this.draft.abilities },
			// dropped rather than cast: a `Partial` asserted to be total is a lie about the six keys,
			// and only the abilities that were actually boosted belong in the saved record
			abilityBoosts: Object.fromEntries(
				Object.entries(this.abilities.abilityBoosts).flatMap(([ab, n]) => (n ? [[ab, n]] : []))
			),
			skills: [...new Set([...this.skillPicks.autoSkills, ...this.draft.skills])],
			// §C feat-granted skills (Skilled) kept in their OWN field so the class-skill cap counter isn't
			// inflated on edit; carried verbatim on edit (like abilityBoosts) + new slot picks on top
			featSkills: [...new Set([...(this.edit?.featSkills ?? []), ...this.feats.featSkillPicks])],
			expertise: this.draft.expertise.filter((s) => this.skillPicks.isProficient(s)),
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
			customLanguages: [...this.draft.customLanguages],
			customTools: [...this.draft.customTools],
			inventory: this.draft.inventory.map((i) => ({ ...i })),
			// A spell the character ALREADY had keeps the flags it had: unpreparing one is the player's
			// decision and an always-prepared domain spell is the class's, and recomputing both from the
			// level re-prepared what they put away and demoted what they never chose — which also moved
			// the prepared tally against `preparedCap`. The default is for a NEWLY picked spell only:
			// cantrips are always-prepared, leveled spells start prepared (tweak in the Spellbook).
			spells: this.draft.selectedSpells.map((ref) => {
				const had = this.edit?.spellFlags.get(ref);
				if (had) return { spell: ref, ...had };
				const lvl = Number(rowOfType(this.graph?.get(ref), 'spell')?.data.level ?? 0);
				return { spell: ref, prepared: lvl > 0, alwaysPrepared: lvl === 0 };
			}),
			notes: this.draft.notes
		};
		// editing keeps the original id + play/ui; creating derives a fresh id from the name
		return assembleCharacter(build, {
			id: this.edit?.id ?? (slugify(this.draft.name) || FALLBACK_SLUG),
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
	 * The sheet `mutate` would produce — the real pipeline, run on a view-model of its own.
	 *
	 * Running the REAL pipeline is the point: a hand-written "what a background gives you" summary
	 * would drift from what the engine actually applies, and the drift would be invisible.
	 *
	 * It is a SEPARATE view-model rather than this one trial-mutated and put back. Mutating this one
	 * meant writing `$state` from inside a `$derived` (`Inspector.changes`), which `ui.md` forbids
	 * and Svelte guards against — and it meant the restore had to be perfect, which it was not: a
	 * snapshot that is not a copy made every preview permanent outside the browser. A draft nobody
	 * else holds cannot be restored wrongly, because it is never put back.
	 *
	 * The clone is explicit for the reason `draft-history` states: `$state.snapshot` copies a PROXY,
	 * and outside the browser there is none, so it hands back the object itself.
	 *
	 * Deliberately expensive (a full `deriveSheet` over a copied draft) — call it for the ONE option a
	 * player is reading, never per row of a list.
	 */
	previewSheet = (mutate: (trial: BuildVM) => void): CharacterSheet | null => {
		// ONE throwaway view-model, reused. A fresh one per call mints a GUID, a history and a
		// storage-capable draft session, none of which a trial has any use for — and this runs again
		// on every keystroke anywhere in the draft while an option is being read.
		const trial = (this.trialVM ??= new BuildVM());
		// the graph is taken, never re-derived: a preview must read the same content this view-model
		// does, including a graph handed in directly rather than loaded from the shared store
		trial.graph = this.graph;
		trial.draft = structuredClone($state.snapshot(this.draft));
		trial.edit = this.edit;
		// the cache too: taking a class hands back what that class owned, so a preview that ignored it
		// would show a swap costing picks the real one keeps. Deep, because `restoreClassPicks` writes
		// the stashed slot maps into the trial draft — a shallow copy hands it the real ones.
		trial.classPicks = new Map(
			[...this.classPicks].map(([ref, picks]) => [ref, structuredClone(picks)]),
		);
		mutate(trial);
		return trial.sheet;
	};
	private trialVM: BuildVM | null = null;

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
			hasClass: !!this.classRows.primaryClassId,
			openSubclasses: this.openSubclasses,
			pointsLeft: this.abilities.pointsLeft,
			classSkillCount: this.skillPicks.classSkillCount,
			skillChosenCount: this.skillPicks.chosenCount,
			openFeatSlots: this.feats.featSlots.filter((s) => !this.draft.slotFeats[s.key]),
			originFeat: {
				name: rowName(this.row(this.feats.originFeatRef)),
				owed: this.feats.originChoicesOwed,
			},
			spellPicker: this.spellPicks.picker
		})
	);

	openSubclasses = $derived(
		this.graph
			? openSubclassChoices(
					this.draft.classes,
					this.graph,
					(r) => rowName(r),
					(classId) => this.subclassesFor(classId).length > 0
				)
			: []
	);

	/** The inspector target that fixes a todo — so clicking the line opens the control, not a page. */
	todoTarget = targetForTodo;

	/** Blocking todos — what stands between the draft and a playable character, and the ONLY gate on
	 *  creating one. Each carries the inspector target that resolves it (`todoTarget`). */
	blocking = $derived(this.todos.filter((t) => t.required));
	canCreate = $derived(this.blocking.length === 0);

	/** A portrait the player picked but has not saved: downscaled bytes with nowhere to land yet,
	 *  because a character has no folder until it is created. Cleared once written. */
	pickedPhoto = $state<PickedPhoto | null>(null);

	/** What the sheet's portrait shows: the unsaved pick if there is one, else the file an EDITED
	 *  character already has. A new build has neither until it is saved. */
	portraitSource = $derived.by<PortraitSource | null>(() => {
		if (this.pickedPhoto) return { kind: 'picked', photo: this.pickedPhoto };
		const name = this.draft.photo;
		return this.edit && name ? { kind: 'stored', id: this.edit.id, name } : null;
	});

	/** Take the file the picker handed over: downscale it now (a phone photo is megabytes, and the
	 *  sheet shows a thumbnail), then hold the bytes until the character has somewhere to keep them.
	 *  Returns false when the file is not an image this webview can decode — the caller says so. */
	setPhoto = async (file: Blob): Promise<boolean> => {
		try {
			this.pickedPhoto = await downscalePhoto(file);
			return true;
		} catch {
			return false;
		}
	};

	/** The way out of having a portrait. The file (if any) goes at the next save, so removing one and
	 *  then abandoning the edit leaves the saved character untouched. */
	clearPhoto = () => {
		this.pickedPhoto = null;
		this.draft.photo = null;
	};

	/** Write the portrait alongside the character being saved, and put its NAME in the save. Both
	 *  branches touch the folder, never the JSON only: a picked photo replaces whatever is there, and
	 *  a cleared one removes the file, so the folder never keeps a portrait nothing references. */
	private async persistPhoto(character: Character): Promise<void> {
		const storage = getUserStorage();
		if (this.pickedPhoto) {
			const name = await writeCharacterPhoto(storage, character.id, this.pickedPhoto);
			character.build.photo = name;
			this.draft.photo = name;
			this.pickedPhoto = null;
		} else if (!this.draft.photo) {
			await removeCharacterPhotos(storage, character.id);
		}
	}

	save = async (): Promise<string | null> => {
		if (!this.canCreate) return null;
		this.saving = true;
		try {
			const character = this.assembled;
			// new character: start play HP at max so it's playable immediately, AND stamp a
			// collision-free id (slug + suffix) so two same-named builds don't overwrite (D14).
			// Editing/level-up: keep the existing id + play state (HP, effects, spent slots…).
			if (!this.edit) {
				character.id = await uniqueCharacterId(getUserStorage(), slugify(this.draft.name) || FALLBACK_SLUG);
				character.play.hp.current = this.sheet?.maxHp.value ?? 0;
			}
			await this.persistPhoto(character);
			await saveCharacterToStore(character);
			// the draft became a character, so the unfinished copy has nothing left to be — and the
			// session gives up its identity with it, or the autosave landing after Create (the photo
			// write above is itself a draft mutation, which arms one) writes the draft back under the
			// same guid and resurrects it in the roster
			await this.drafts.discard();
			this.drafts.renew();
			// make the freshly-created character the active one so Combat opens IT, not the demo
			await openCharacter(character.id);
			return character.id;
		} catch (e) {
			// a full disk, a renamed data folder, a permission error — the one button that creates a
			// character used to answer a rejected promise into an `onclick`: no toast, no error, and
			// "Saving…" back to "Create" as if nothing had been asked of it
			toast(t('build.notice.createFailed'), {
				id: CREATE_FAILED_TOAST,
				description: e instanceof Error ? e.message : String(e),
			});
			return null;
		} finally {
			this.saving = false;
		}
	};

}

/** The single shared Build view-model instance. */
export const build = new BuildVM();

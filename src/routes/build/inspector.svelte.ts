/*
 * The builder's Inspector — the right pane of the sheet+inspector layout.
 *
 * The sheet on the left is the whole character, always live. Clicking any unfinished or changeable
 * thing on it opens a TARGET here: what the choice is, every option with its compendium prose, and
 * — the point of the whole pane — what taking it would do to the six numbers the player cares about,
 * computed by really running the pipeline on a trial draft (`BuildVM.previewSheet`).
 *
 * Two shapes of target, because a builder only ever asks two kinds of question:
 *   **pick** — choose one content row (species, background, class, subclass, a feat for a slot).
 *              Shared list → prose → diff → Take flow, driven entirely by the target descriptor.
 *   **edit** — a control surface that is its own thing (ability allocation, skills, spells,
 *              languages, inventory, notes). The pane just names it; the component renders it.
 *
 * Nothing here computes D&D math. It selects, previews, and commits.
 */
import type { ContentType } from '$lib/content/schemas';
import type { LoadedRow, LoadedRowByType } from '$lib/content/loader';
import type { DetailModel } from '$lib/content/detail';
import { diffSheets, type SheetChange } from '$lib/build/sheet-diff';
import type { BuildTodo } from '$lib/build/derive';
import type { CharacterSheet } from '$lib/character/derive';
import { filterByName, rowDetail, rowName, ASI } from './rows';
import type { DraftState } from './draft';
import type { FeatSlots } from './feat-slots.svelte';

/**
 * What the inspector needs from the build view-model around it — a STRUCTURAL host, like FeatsHost
 * next door. The view-model owns the draft and every derivation; this pane only reads option lists,
 * writes single choices, and asks for a trial derive. Declaring the surface here rather than
 * importing `BuildVM` also keeps the two modules acyclic (§7.4b).
 */
export interface InspectorHost {
	draft: DraftState;
	sheet: CharacterSheet | null;
	/** Derive the sheet `mutate` would produce, on a draft of its own. The host handed to `mutate`
	 *  is a THROWAWAY: writing to it is how a preview stays a preview. */
	previewSheet(mutate: (trial: InspectorHost) => void): CharacterSheet | null;
	row(id: string | null): LoadedRow | undefined;

	speciesList: LoadedRowByType<'species'>[];
	speciesRow: LoadedRowByType<'species'> | undefined;
	speciesOptions: LoadedRow[];
	speciesOptionLabel: string;
	backgroundList: LoadedRowByType<'background'>[];
	classList: LoadedRowByType<'class'>[];
	subclassesFor(classId: string | null): LoadedRow[];
	/** Picked off the real class rather than re-described: a hand-written twin of three methods is a
	 *  second declaration of a shape that has one owner, and it drifts silently when that owner
	 *  changes. `feat-slots` imports nothing from here, so the type-only reference adds no cycle. */
	feats: Pick<FeatSlots, 'featOptionsFor' | 'featOptionBlocked' | 'setSlotFeat'>;

	pickSpecies(id: string | null): void;
	setClass(index: number, id: string | null): void;
	setSubclass(index: number, id: string | null): void;
}

/** Which thing on the sheet the inspector is currently about. */
export type InspectorTarget =
	| { id: 'species' }
	| { id: 'speciesOption' }
	| { id: 'background' }
	| { id: 'class'; index: number }
	| { id: 'subclass'; index: number }
	| { id: 'feat'; slotKey: string; level: number }
	| { id: EditPane };

/**
 * Every `edit` target — a control surface that is its own thing, so the pane only has to name it.
 *
 * ONE entry per pane, because everything else about a pane is derived from this: the id it answers
 * to, the two lines of copy above it, and whether it brings its own scroll region.
 *
 * `ownsScroll` marks a picker whose list scrolls under a fixed search box and section rail. For
 * everything else the shell's body is the scroll region, which is how a pane ends up with exactly
 * one either way (ui.md §1: never a scroll container around another).
 */
const EDIT_PANES = {
	abilities: { titleKey: 'abilitiesTitle', blurbKey: 'abilitiesBlurb', ownsScroll: false },
	skills: { titleKey: 'skillsTitle', blurbKey: 'skillsBlurb', ownsScroll: false },
	languages: { titleKey: 'languagesTitle', blurbKey: 'languagesBlurb', ownsScroll: false },
	spells: { titleKey: 'spellsTitle', blurbKey: 'spellsBlurb', ownsScroll: true },
	inventory: { titleKey: 'inventoryTitle', blurbKey: 'inventoryBlurb', ownsScroll: true },
	notes: { titleKey: 'notesTitle', blurbKey: 'notesBlurb', ownsScroll: false },
} as const satisfies Record<string, { titleKey: string; blurbKey: string; ownsScroll: boolean }>;

/** The `edit` targets, as the pane names them — read off the table, so a pane cannot exist in the
 *  type and be missing from the copy, or the other way round. */
export type EditPane = keyof typeof EDIT_PANES;

/** The words a target is described with: catalog KEYS under `build.spec`, not sentences — this
 *  module has no locale, and the shell that renders it does. */
interface SpecCopy {
	titleKey: string;
	blurbKey: string;
	/** ICU values both keys may interpolate. */
	values?: Record<string, string | number>;
}

/** How a `pick` target behaves: what it is called, what it chooses from, what it writes. */
interface PickSpec extends SpecCopy {
	kind: 'pick';
	type: ContentType;
	options: LoadedRow[];
	currentId: string | null;
	/** Write the pick into a host's draft. `null` clears it. The host is a PARAMETER because the same
	 *  spec is applied twice over: for real when you take an option, and to a throwaway when the pane
	 *  works out what taking it would do. */
	apply: (host: InspectorHost, id: string | null) => void;
	/** Can this choice be un-made? A class row cannot (removing it is a different control). */
	clearable: boolean;
}

interface EditSpec extends SpecCopy {
	kind: 'edit';
	pane: EditPane;
}

type Spec = PickSpec | EditSpec;

/** The inspector target that fixes a todo, so every "still to do" line is a link into the control
 *  that resolves it. `null` for the name, whose field is always on screen in the header. */
export function targetForTodo(todo: BuildTodo): InspectorTarget | null {
	switch (todo.kind) {
		case 'name':
			return null;
		case 'class':
			return { id: 'class', index: todo.index ?? 0 };
		case 'subclass':
			return { id: 'subclass', index: todo.index ?? 0 };
		case 'feat':
			return { id: 'feat', slotKey: todo.slotKey ?? '', level: todo.level ?? 1 };
		default:
			return { id: todo.kind };
	}
}

/** Is this target one of the edit panes? A predicate over the table rather than a cast, so the table
 *  stays the only list of them. */
const isEditPane = (id: InspectorTarget['id']): id is EditPane => id in EDIT_PANES;

function editSpecFor(t: InspectorTarget): EditSpec | null {
	if (!isEditPane(t.id)) return null;
	const { titleKey, blurbKey } = EDIT_PANES[t.id];
	return { kind: 'edit', pane: t.id, titleKey, blurbKey };
}

/**
 * The classes a class row may take: every class except the ones the OTHER rows already hold.
 *
 * Two rows of one class is not a table variant to leave open — it is `Rogue 3 / Rogue 1` where the
 * character means `Rogue 4`, and previewing it reports things like "spell save DC 9 → 0" that are
 * true of the broken shape and true of nothing anyone wants. Moving a class between rows is done by
 * removing the row that holds it, which its own ✕ does.
 */
function classesOfferedTo(b: InspectorHost, row: number): LoadedRow[] {
	const heldElsewhere = new Set(
		b.draft.classes.flatMap((c, i) => (i !== row && c.classId ? [c.classId] : [])),
	);
	return b.classList.filter((r) => !heldElsewhere.has(r.effectiveId));
}

/**
 * One class row's picker.
 *
 * A row that already holds a class SWAPS it. That has to be said out loud, because the control is
 * the same shape as the one that adds a class and its diff is not: swapping the first class moves
 * the saving throws and the spellcasting with it — RAW they come from the first class alone — so a
 * player who thought they were multiclassing reads "INT save +1 → −1" as the app getting the rule
 * wrong. Adding a class is the "+ Multiclass" button, and the blurb points at it.
 */
function classPickSpec(b: InspectorHost, index: number): PickSpec {
	const held = b.draft.classes[index]?.classId ?? null;
	return {
		kind: 'pick',
		titleKey: index === 0 ? 'classTitle' : 'classTitleExtra',
		// spread rather than `values: held ? … : undefined` — `exactOptionalPropertyTypes` reads an
		// explicit `undefined` as a value, not as an absent key
		...(held
			? { blurbKey: 'classReplaceBlurb', values: { class: rowName(b.row(held)) } }
			: { blurbKey: 'classBlurb' }),
		type: 'class',
		options: classesOfferedTo(b, index),
		currentId: held,
		apply: (host, id) => host.setClass(index, id),
		clearable: index > 0,
	};
}

/** How each `pick` target behaves. Separate from the class so the descriptor stays a plain function
 *  of (target, draft) — and so neither this nor the class grows past what one screen can hold. */
function pickSpecFor(t: InspectorTarget, b: InspectorHost): PickSpec | null {
	switch (t.id) {
		case 'species':
			return {
				kind: 'pick',
				titleKey: 'speciesTitle',
				blurbKey: 'speciesBlurb',
				type: 'species',
				options: b.speciesList,
				currentId: b.draft.speciesId,
				apply: (host, id) => host.pickSpecies(id),
				clearable: true,
			};
		case 'speciesOption':
			return {
				kind: 'pick',
				// the label is the CONTENT's own word for this choice ("Subrace" / "Lineage"), which no
				// UI catalog can know — it is data, so it passes through as a value, not a key
				titleKey: 'lineageTitle',
				blurbKey: 'speciesOptionBlurb',
				values: { label: b.speciesOptionLabel, species: rowName(b.speciesRow) },
				type: 'species_option',
				options: b.speciesOptions,
				currentId: b.draft.speciesOptionId,
				apply: (host, id) => (host.draft.speciesOptionId = id),
				clearable: true,
			};
		case 'background':
			return {
				kind: 'pick',
				titleKey: 'backgroundTitle',
				blurbKey: 'backgroundBlurb',
				type: 'background',
				options: b.backgroundList,
				currentId: b.draft.backgroundId,
				apply: (host, id) => (host.draft.backgroundId = id),
				clearable: true,
			};
		case 'class':
			return classPickSpec(b, t.index);
		case 'subclass': {
			const cls = b.draft.classes[t.index];
			return {
				kind: 'pick',
				titleKey: 'subclassTitle',
				blurbKey: 'subclassBlurb',
				values: { class: rowName(b.row(cls?.classId ?? null)) },
				type: 'subclass',
				options: b.subclassesFor(cls?.classId ?? null),
				currentId: cls?.subclassId ?? null,
				apply: (host, id) => host.setSubclass(t.index, id),
				clearable: true,
			};
		}
		case 'feat':
			return {
				kind: 'pick',
				titleKey: 'featTitle',
				blurbKey: 'featBlurb',
				values: { level: t.level },
				type: 'feat',
				// same rule as a class: a feat another slot already spent is not offered again, unless
				// its row says it repeats. Taking one twice grants its benefit once and reads as a bug.
				options: b.feats
					.featOptionsFor(t.level)
					.filter((r) => !b.feats.featOptionBlocked(r.effectiveId, t.slotKey)),
				currentId: b.draft.slotFeats[t.slotKey] ?? null,
				apply: (host, id) => host.feats.setSlotFeat(t.slotKey, id ?? ''),
				clearable: true,
			};
		default:
			return null;
	}
}

export class Inspector {
	constructor(private host: () => InspectorHost) {}

	/** `null` = the pane is closed and the sheet has the full width. */
	target = $state<InspectorTarget | null>(null);
	/** Search inside the current pick list. Reset whenever the target changes. */
	query = $state('');
	/** The option being READ (not yet taken) — what the prose and the diff are about. */
	previewId = $state<string | null>(null);
	/**
	 * What the last commit actually did. A pick lands on click, so by the time you look there is no
	 * "before" left to preview against — but the answer is the same one moment later, phrased in the
	 * past tense. Walking the list with ↑/↓ still previews, so reading before committing is intact
	 * for the keyboard; the mouse trades that for one click instead of two.
	 */
	applied = $state<SheetChange[]>([]);

	open = (target: InspectorTarget) => {
		this.target = target;
		this.query = '';
		this.applied = [];
		this.previewId = this.spec?.kind === 'pick' ? this.spec.currentId : null;
	};
	close = () => {
		this.target = null;
		this.previewId = null;
		this.applied = [];
	};
	/** Same target twice = a toggle, so the thing you clicked also closes the pane. */
	toggle = (target: InspectorTarget) => {
		if (this.isOpen(target)) this.close();
		else this.open(target);
	};
	isOpen = (target: InspectorTarget): boolean =>
		!!this.target && JSON.stringify(this.target) === JSON.stringify(target);

	// --- the target descriptor -----------------------------------------------------------------
	spec = $derived.by<Spec | null>(() => {
		const t = this.target;
		if (!t) return null;
		return editSpecFor(t) ?? pickSpecFor(t, this.host());
	});

	pick = $derived<PickSpec | null>(this.spec?.kind === 'pick' ? this.spec : null);

	/** Should the shell's body be the scroll region? Every pick target builds its own (the grid
	 *  scrolls under a fixed search box), and so do the two big edit pickers. */
	bodyScrolls = $derived(this.spec?.kind === 'edit' && !EDIT_PANES[this.spec.pane].ownsScroll);

	// --- the option list ------------------------------------------------------------------------
	/** The current target's options, narrowed by the search box. Case-insensitive substring on the
	 *  displayed name — the SRD lists are long enough that a picker without this is unusable (N5·6). */
	options = $derived.by<LoadedRow[]>(() =>
		this.pick ? filterByName(this.pick.options, this.query) : [],
	);

	/** The row the pane is reading — the preview if one is highlighted, else what is already taken. */
	previewRow = $derived.by<LoadedRow | undefined>(() => {
		const id = this.previewId ?? this.pick?.currentId ?? null;
		return id && id !== ASI ? this.host().row(id) : undefined;
	});

	detail = $derived.by<DetailModel | null>(() => {
		const type = this.pick?.type;
		return type ? rowDetail(this.previewRow, type) : null;
	});

	/** Is the previewed option the one already taken? Then there is nothing to commit. */
	previewIsCurrent = $derived(
		!!this.pick && (this.previewId ?? this.pick.currentId) === this.pick.currentId,
	);

	// --- what taking it would do ------------------------------------------------------------------
	/**
	 * The heart of the pane: the draft with the previewed option applied, derived for real, diffed
	 * against the draft as it stands. Empty while nothing new is highlighted — an unchanged sheet and
	 * "no preview" both mean "no rows", and both are correctly silent.
	 */
	changes = $derived.by<SheetChange[]>(() => {
		const spec = this.pick;
		const id = this.previewId;
		if (!spec || id === null || id === spec.currentId) return [];
		const b = this.host();
		return diffSheets(b.sheet, b.previewSheet((trial) => spec.apply(trial, id)));
	});

	// --- committing --------------------------------------------------------------------------------
	/**
	 * Take an option. This is what a click on the row does — there is no confirm step, because a pick
	 * here is already undone by picking something else or by Clear, and a button to confirm a
	 * reversible act is a button that only ever costs a click.
	 *
	 * The pane stays open on targets that cascade (species → lineage), because the next question is
	 * the one the player now needs.
	 */
	take = (id: string) => {
		const spec = this.pick;
		if (!spec || id === spec.currentId) return;
		const host = this.host();
		const before = host.sheet; // deriveSheet returns a fresh object, so this stays valid after apply
		spec.apply(host, id);
		this.previewId = id;
		this.applied = diffSheets(before, host.sheet);
	};
	/** Un-make the choice. The way out of every way in. */
	clear = () => {
		const spec = this.pick;
		if (!spec?.clearable) return;
		const host = this.host();
		const before = host.sheet;
		spec.apply(host, null);
		this.previewId = null;
		this.applied = diffSheets(before, host.sheet);
	};
}

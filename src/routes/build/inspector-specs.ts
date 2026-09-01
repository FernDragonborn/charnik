/*
 * What each inspector target IS: the table of `edit` panes, and the descriptor every `pick` target
 * is driven by.
 *
 * Split from the `Inspector` class because none of it is reactive — it is a pure function of
 * `(target, host) → Spec`, which is the half worth unit-testing and the half the class kept it from
 * being. What is left next door needs runes; this does not.
 */
import type { ContentType } from '$lib/content/schemas';
import type { LoadedRow } from '$lib/content/loader';
import type { BuildTodo } from '$lib/build/derive';
import { rowName } from './rows';
import type { BuildVM } from './build-view-model.svelte';

/**
 * What the inspector needs from the build view-model around it. The view-model owns the draft and
 * every derivation; this pane only reads option lists, writes single choices, and asks for a trial
 * derive — so the surface is worth naming, but naming it TWICE is what drifts. A `Pick` says the
 * same thing and cannot disagree with the class it came from.
 *
 * `import type` is erased, so this costs no runtime cycle — and `madge` is configured to measure
 * runtime cycles, which is the thing a cycle check is for.
 */
export type InspectorHost = Pick<
	BuildVM,
	| 'draft'
	| 'sheet'
	| 'previewSheet'
	| 'row'
	| 'speciesList'
	| 'speciesRow'
	| 'speciesOptions'
	| 'speciesOptionLabel'
	| 'backgroundList'
	| 'classList'
	| 'subclassesFor'
	| 'feats'
	| 'pickSpecies'
	| 'setClass'
	| 'setSubclass'
>;

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
export const EDIT_PANES = {
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
export interface PickSpec extends SpecCopy {
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
	/**
	 * Why an option cannot be taken here, as a catalog KEY — this module has no locale.
	 *
	 * An option nothing can be done with is shown and explained rather than dropped from the list:
	 * a feat quietly missing from the menu is a player searching for it and concluding the app has
	 * lost it (ui.md §10 — dimmed and disabled is a statement, an absence is a silence).
	 */
	blockedKey?: (id: string) => string | null;
}

interface EditSpec extends SpecCopy {
	kind: 'edit';
	pane: EditPane;
}

export type Spec = PickSpec | EditSpec;

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

export function editSpecFor(t: InspectorTarget): EditSpec | null {
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
export function pickSpecFor(t: InspectorTarget, b: InspectorHost): PickSpec | null {
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
				// a feat another slot already spent stays in the list and says so, unless its row says it
				// repeats. Taking one twice grants its benefit once and reads as a bug.
				options: b.feats.featOptionsFor(t.level),
				blockedKey: (id) =>
					b.feats.featOptionBlocked(id, t.slotKey) ? 'build.feats.takenElsewhere' : null,
				currentId: b.draft.slotFeats[t.slotKey] ?? null,
				apply: (host, id) => host.feats.setSlotFeat(t.slotKey, id ?? ''),
				clearable: true,
			};
		default:
			return null;
	}
}

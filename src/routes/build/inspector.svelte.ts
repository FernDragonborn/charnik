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
import { buildDetail, type DetailModel } from '$lib/content/detail';
import { diffSheets, type SheetChange } from '$lib/build/sheet-diff';
import type { BuildTodo } from '$lib/build/derive';
import type { CharacterSheet } from '$lib/character/derive';
import { app } from '$lib/stores/app.svelte';
import { rowName, ASI } from './rows';
import type { DraftState } from './draft';

/**
 * What the inspector needs from the build view-model around it — a STRUCTURAL host, like FeatsHost
 * next door. The view-model owns the draft and every derivation; this pane only reads option lists,
 * writes single choices, and asks for a trial derive. Declaring the surface here rather than
 * importing `BuildVM` also keeps the two modules acyclic (§7.4b).
 */
export interface InspectorHost {
	draft: DraftState;
	sheet: CharacterSheet | null;
	/** Derive the sheet a trial mutation would produce, then put the draft back. */
	previewSheet(mutate: () => void): CharacterSheet | null;
	row(id: string | null): LoadedRow | undefined;

	speciesList: LoadedRowByType<'species'>[];
	speciesRow: LoadedRowByType<'species'> | undefined;
	speciesOptions: LoadedRow[];
	speciesOptionLabel: string;
	backgroundList: LoadedRowByType<'background'>[];
	classList: LoadedRowByType<'class'>[];
	subclassesFor(classId: string | null): LoadedRow[];
	feats: {
		featOptionsFor(level: number): LoadedRow[];
		setSlotFeat(key: string, ref: string): void;
	};

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
	| { id: 'abilities' }
	| { id: 'skills' }
	| { id: 'languages' }
	| { id: 'spells' }
	| { id: 'inventory' }
	| { id: 'notes' };

/** The `edit` targets, as the pane names them — the value the shell switches on to render a control
 *  surface. A union so a new pane can't be spelled wrong. */
type EditPane = 'abilities' | 'skills' | 'languages' | 'spells' | 'inventory' | 'notes';

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
	/** Write the pick into the draft. `null` clears it. */
	apply: (id: string | null) => void;
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

/** The `edit` targets: a control surface that is its own thing, so the pane only has to name it.
 *  A flat table because none of them needs the draft to describe itself. */
const EDIT_SPECS: Record<EditPane, EditSpec> = {
	abilities: { kind: 'edit', pane: 'abilities', titleKey: 'abilitiesTitle', blurbKey: 'abilitiesBlurb' },
	skills: { kind: 'edit', pane: 'skills', titleKey: 'skillsTitle', blurbKey: 'skillsBlurb' },
	languages: { kind: 'edit', pane: 'languages', titleKey: 'languagesTitle', blurbKey: 'languagesBlurb' },
	spells: { kind: 'edit', pane: 'spells', titleKey: 'spellsTitle', blurbKey: 'spellsBlurb' },
	inventory: { kind: 'edit', pane: 'inventory', titleKey: 'inventoryTitle', blurbKey: 'inventoryBlurb' },
	notes: { kind: 'edit', pane: 'notes', titleKey: 'notesTitle', blurbKey: 'notesBlurb' },
};

/** The edit targets, narrowed by their own id — a lookup rather than a cast, so adding a pane to the
 *  union without adding it here is a type error, not a blank pane. */
function editSpecFor(t: InspectorTarget): EditSpec | null {
	switch (t.id) {
		case 'abilities':
		case 'skills':
		case 'languages':
		case 'spells':
		case 'inventory':
		case 'notes':
			return EDIT_SPECS[t.id];
		default:
			return null;
	}
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
				apply: (id) => b.pickSpecies(id),
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
				apply: (id) => (b.draft.speciesOptionId = id),
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
				apply: (id) => (b.draft.backgroundId = id),
				clearable: true,
			};
		case 'class':
			return {
				kind: 'pick',
				titleKey: t.index === 0 ? 'classTitle' : 'classTitleExtra',
				blurbKey: 'classBlurb',
				type: 'class',
				options: b.classList,
				currentId: b.draft.classes[t.index]?.classId ?? null,
				apply: (id) => b.setClass(t.index, id),
				clearable: t.index > 0,
			};
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
				apply: (id) => b.setSubclass(t.index, id),
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
				options: b.feats.featOptionsFor(t.level),
				currentId: b.draft.slotFeats[t.slotKey] ?? null,
				apply: (id) => b.feats.setSlotFeat(t.slotKey, id ?? ''),
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

	open = (target: InspectorTarget) => {
		this.target = target;
		this.query = '';
		this.previewId = this.spec?.kind === 'pick' ? this.spec.currentId : null;
	};
	close = () => {
		this.target = null;
		this.previewId = null;
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

	// --- the option list ------------------------------------------------------------------------
	/** The current target's options, narrowed by the search box. Case-insensitive substring on the
	 *  displayed name — the SRD lists are long enough that a picker without this is unusable (N5·6). */
	options = $derived.by<LoadedRow[]>(() => {
		const spec = this.pick;
		if (!spec) return [];
		const q = this.query.trim().toLowerCase();
		if (!q) return spec.options;
		return spec.options.filter((r) => rowName(r).toLowerCase().includes(q));
	});

	/** The row the pane is reading — the preview if one is highlighted, else what is already taken. */
	previewRow = $derived.by<LoadedRow | undefined>(() => {
		const id = this.previewId ?? this.pick?.currentId ?? null;
		return id && id !== ASI ? this.host().row(id) : undefined;
	});

	detail = $derived.by<DetailModel | null>(() => {
		const row = this.previewRow;
		const type = this.pick?.type;
		return row && type ? buildDetail(row, type, undefined, app.activeLocale) : null;
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
		return diffSheets(b.sheet, b.previewSheet(() => spec.apply(id)));
	});

	// --- committing --------------------------------------------------------------------------------
	/** Take the previewed option. Leaves the pane open on `pick` targets that cascade (species →
	 *  lineage), because the next question is the one the player now needs. */
	take = () => {
		const spec = this.pick;
		if (!spec || this.previewId === null) return;
		spec.apply(this.previewId);
	};
	/** Un-make the choice. The way out of every way in. */
	clear = () => {
		const spec = this.pick;
		if (!spec?.clearable) return;
		spec.apply(null);
		this.previewId = null;
	};
}

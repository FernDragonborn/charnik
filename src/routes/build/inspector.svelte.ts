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
 * WHAT each target IS lives next door in `inspector-specs.ts` — a pure table with no runes in it.
 * This is the half that needs them: what is open, what is highlighted, and what a take just did.
 *
 * Nothing here computes D&D math. It selects, previews, and commits.
 */
import type { LoadedRow } from '$lib/content/loader';
import type { DetailModel } from '$lib/content/detail';
import { diffSheets, type SheetChange } from '$lib/build/sheet-diff';
import { filterByName, rowDetail, ASI } from './rows';
import {
	editSpecFor,
	pickSpecFor,
	sameTarget,
	EDIT_PANES,
	type InspectorHost,
	type InspectorTarget,
	type PickSpec,
	type Spec,
} from './inspector-specs';
export { targetForTodo, targetKey } from './inspector-specs';
export type { EditPane, InspectorHost, InspectorTarget } from './inspector-specs';

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
	isOpen = (target: InspectorTarget): boolean => sameTarget(this.target, target);

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

	// --- what taking it would do ------------------------------------------------------------------
	/**
	 * The heart of the pane: the draft with the previewed option applied, derived for real, diffed
	 * against the draft as it stands.
	 *
	 * `null` means nothing is being previewed, which is NOT the same as an option that moves no
	 * number — and an empty array said both. The consumer falls back to "what the last take did"
	 * when there is no preview, so conflating them printed the previous commit's rows beside an
	 * option that changes nothing.
	 */
	changes = $derived.by<SheetChange[] | null>(() => {
		const spec = this.pick;
		const id = this.previewId;
		if (!spec || id === null || id === spec.currentId) return null;
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
		// a blocked option is readable but not takeable — the double-click shortcut reaches it too
		if (!spec || id === spec.currentId || spec.blockedKey?.(id)) return;
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

/*
 * Undo and redo over the whole draft.
 *
 * The draft is one plain `$state` object, so a step of history is a snapshot of it — the same
 * `$state.snapshot` the autosave and the trial-derive already take. Nothing here knows what a class
 * or a spell is, which is why a new field on `DraftState` is undoable the moment it exists.
 *
 * Steps are recorded on the autosave's debounce rather than on every mutation: a name being typed
 * is one step you can take back, not twenty, and a pick that lands in one click is still its own.
 */
import type { DraftState } from './draft';

/** How far back you can go. Deep enough to cover a session's worth of picks, bounded because each
 *  entry is a full draft and a builder left open for an hour should not grow without end. */
const DEPTH = 50;

/** Snapshots compare by value — the draft is plain data, so this is both correct and cheap enough at
 *  one call per settled change. */
const same = (a: DraftState, b: DraftState) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A step of history, detached from the live draft.
 *
 * `$state.snapshot` alone is not enough: it returns a deep copy of a state PROXY, and outside the
 * browser — the node test project — there is no proxy to copy, so it hands back the object itself
 * and every "snapshot" silently tracks the draft it came from. The explicit clone costs one pass
 * over plain data, once per settled change, and makes the module mean the same thing in both.
 */
const freeze = (draft: DraftState): DraftState => structuredClone($state.snapshot(draft));

/** The one seam onto the draft: read it to record a step, write it to apply one. Declared here, like
 *  `DraftSessionHost` next door, so this module and the view-model stay acyclic. */
export interface DraftHistoryHost {
	read: () => DraftState;
	write: (draft: DraftState) => void;
}

export class DraftHistory {
	constructor(private host: DraftHistoryHost) {}

	// `$state.raw`, not `$state`: both stacks are only ever REPLACED, never edited in place, so the
	// deep proxying buys nothing — and it costs correctness, because a proxied entry is not something
	// `structuredClone` will take, which is how a step leaves here.
	/** Settled states before the current one, oldest first. */
	private past = $state.raw<DraftState[]>([]);
	/** States undone out of, newest first — emptied by any fresh change. */
	private future = $state.raw<DraftState[]>([]);
	/** The draft as of the last settled point, and what `record` compares against. */
	private present: DraftState | null = null;

	canUndo = $derived(this.past.length > 0);
	canRedo = $derived(this.future.length > 0);

	/** Start over from the draft as it stands — a new build, a resumed one, a character loaded to
	 *  level up. Nothing before it is yours to take back. */
	reset = (): void => {
		this.past = [];
		this.future = [];
		this.present = freeze(this.host.read());
	};

	/** Note where the draft has settled. A no-op when nothing moved, which is also what makes
	 *  applying an undo not count as a new change: `undo` leaves `present` as the state it restored. */
	record = (): void => {
		const next = freeze(this.host.read());
		if (this.present && same(this.present, next)) return;
		if (this.present) {
			this.past = [...this.past, this.present].slice(-DEPTH);
			this.future = [];
		}
		this.present = next;
	};

	/** Go back one settled step. */
	undo = (): void => this.step('past');
	/** Go forward one, as far as the last change you made. */
	redo = (): void => this.step('future');

	/** Both directions are the same move: take the end off one stack, push `present` onto the other.
	 *  `past` is oldest-first and `future` newest-first, so each takes from its own near end. */
	private step(from: 'past' | 'future'): void {
		const target = from === 'past' ? this.past.at(-1) : this.future.at(0);
		if (!target || !this.present) return;
		if (from === 'past') {
			this.past = this.past.slice(0, -1);
			this.future = [this.present, ...this.future];
		} else {
			this.future = this.future.slice(1);
			this.past = [...this.past, this.present];
		}
		this.present = target;
		// a fresh copy, because it becomes the LIVE draft and every edit after that would otherwise
		// write through to the entry it came from
		this.host.write(structuredClone(target));
	}
}

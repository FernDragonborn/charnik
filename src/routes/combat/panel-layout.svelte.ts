/*
 * The panel-layout subsystem of the Combat view-model: the two drag-reorderable panel columns, the
 * collapse state, and the svelte-dnd-action handlers. Split out of CombatVM so the layout concern is
 * one cohesive unit; CombatVM composes it as `combat.layout` and wires persistence (the column order
 * round-trips onto the character's `ui.panelColumns`) via the constructor callback.
 */
import { movedOrder, orderRows } from '$lib/combat/row-order';

/** Which way a keyboard move goes. Up/down reorders inside a column; left/right hands the panel to
 *  the other one — between them they reach every arrangement a drag can. */
export const PANEL_MOVE = {
	up: 'up',
	down: 'down',
	left: 'left',
	right: 'right',
} as const;
export type PanelMove = (typeof PANEL_MOVE)[keyof typeof PANEL_MOVE];

export class PanelLayout {
	collapsed = $state<Record<string, boolean>>({});
	// two independent column arrays (svelte-dnd-action items need an id)
	columns = $state<{ id: string }[][]>([
		[{ id: 'skills' }, { id: 'spells' }, { id: 'features' }],
		[{ id: 'attacks' }, { id: 'effects' }, { id: 'actions' }, { id: 'inventory' }],
	]);
	flipDurationMs = 150;

	/** `persist` is called with the flattened column id layout whenever a drag finalizes, so the owner
	 *  (CombatVM) can store it on the character. */
	/** `persist` stores the column layout; `rows` reaches the character's own row-order map, which is
	 *  written in place (it is `$state` on the character, and saving is the store's business). */
	constructor(
		private persist: (columns: string[][]) => void = () => {},
		private rows: () => Record<string, string[]> | undefined = () => undefined,
	) {}

	toggle = (k: string) => (this.collapsed[k] = !this.collapsed[k]);

	/**
	 * Restore a saved layout (from the character's ui.panelColumns), if any — RECONCILED against the
	 * panels that actually exist, in both directions.
	 *
	 * A layout is saved the first time a character's panels are dragged and then outlives the app that
	 * wrote it. Without this, a panel added later would be invisible forever to every character that
	 * had ever reordered anything (there is no UI to add one back), and a panel since removed would
	 * leave a card with no title and no body. Neither is something a user could fix from the app.
	 */
	restore = (saved?: string[][]) => {
		if (!saved?.length) return;
		const known = new Set(this.columns.flat().map((panel) => panel.id));
		const kept = saved.map((col) => col.filter((id) => known.has(id)).map((id) => ({ id })));
		const seen = new Set(kept.flat().map((panel) => panel.id));
		const added = [...known].filter((id) => !seen.has(id)).map((id) => ({ id }));
		const last = kept[kept.length - 1];
		if (last) last.push(...added);
		this.columns = kept;
	};

	/**
	 * Move one panel with the keyboard — the same reorder the drag performs, for the people the drag
	 * excludes. Arranging your own combat screen had a pointer path and no other, which is
	 * `AGENTS.md` ▸ Reverse states applied to an affordance: a layout a keyboard user did not choose
	 * is one they cannot get back out of.
	 *
	 * Persists through the same callback a finalized drag does, so a keyboard arrangement survives a
	 * reload exactly as a dragged one does.
	 */
	movePanel = (pid: string, dir: PanelMove): void => {
		const ci = this.columns.findIndex((col) => col.some((panel) => panel.id === pid));
		const next = this.columns.map((col) => [...col]);
		const from = next[ci];
		if (!from) return;
		const at = from.findIndex((panel) => panel.id === pid);
		const moving = from[at];
		if (!moving) return;
		if (dir === PANEL_MOVE.up || dir === PANEL_MOVE.down) {
			const to = at + (dir === PANEL_MOVE.up ? -1 : 1);
			const swap = from[to];
			if (!swap) return; // the end of the column — nowhere further to go
			from[to] = moving;
			from[at] = swap;
		} else {
			const target = next[dir === PANEL_MOVE.left ? ci - 1 : ci + 1];
			if (!target) return;
			from.splice(at, 1);
			// same height in the other column, so the panel lands where the eye expects it
			target.splice(Math.min(at, target.length), 0, moving);
		}
		this.columns = next;
		this.persist(this.columns.map((col) => col.map((panel) => panel.id)));
	};

	// svelte-dnd-action: sync each column on drag consider + finalize. Arming the grip is the
	// library's own `dragHandle`/`dragHandleZone` pair, not ours — see PanelCard.
	dndConsider = (ci: number, e: CustomEvent<{ items: { id: string }[] }>) => {
		this.columns[ci] = e.detail.items;
	};
	dndFinalize = (ci: number, e: CustomEvent<{ items: { id: string }[] }>) => {
		this.columns[ci] = e.detail.items;
		this.persist(this.columns.map((col) => col.map((x) => x.id)));
	};

	/**
	 * The order of the rows INSIDE a panel, for the panels whose rows are derived — attacks come from
	 * what you wield, actions from what you can do, so there is no array to reorder and the order is
	 * stored beside them on the character's `ui`. (The inventory needs none of this: its rows are
	 * `build.inventory`, so the array IS the order.)
	 *
	 * Lives here rather than on CombatVM because it is the same concern the columns are: which thing
	 * sits where on this player's screen.
	 */
	rowOrder = (panel: string): string[] | undefined => this.rows()?.[panel];
	/** Apply this panel's saved order to the rows it has right now — the one call a panel's list
	 *  makes, so no view-model has to remember both halves of the reconciliation. */
	ordered = <T>(panel: string, rows: readonly T[], idOf: (row: T) => string): T[] =>
		orderRows(rows, idOf, this.rowOrder(panel));
	setRowOrder = (panel: string, ids: string[]) => {
		const stored = this.rows();
		if (stored) stored[panel] = ids;
	};
	/** The same reorder by keyboard — one step, for the people a drag excludes. */
	moveRow = (panel: string, ids: readonly string[], id: string, by: -1 | 1) =>
		this.setRowOrder(panel, movedOrder(ids, id, by));
}

/*
 * The panel-layout subsystem of the Combat view-model: the two drag-reorderable panel columns, the
 * collapse state, and the svelte-dnd-action handlers. Split out of CombatVM so the layout concern is
 * one cohesive unit; CombatVM composes it as `combat.layout` and wires persistence (the column order
 * round-trips onto the character's `ui.panelColumns`) via the constructor callback.
 */
export class PanelLayout {
	collapsed = $state<Record<string, boolean>>({});
	// two independent column arrays (svelte-dnd-action items need an id)
	columns = $state<{ id: string }[][]>([
		[{ id: 'skills' }, { id: 'spells' }, { id: 'features' }],
		[{ id: 'attacks' }, { id: 'effects' }, { id: 'actions' }, { id: 'inventory' }],
	]);
	dragDisabled = $state(true); // drag only after the ⠿ grip arms it (handle-only)
	flipDurationMs = 150;

	/** `persist` is called with the flattened column id layout whenever a drag finalizes, so the owner
	 *  (CombatVM) can store it on the character. */
	constructor(private persist: (columns: string[][]) => void = () => {}) {}

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

	// svelte-dnd-action: sync each column on drag consider + finalize; re-lock the grip.
	dndConsider = (ci: number, e: CustomEvent<{ items: { id: string }[] }>) => {
		this.columns[ci] = e.detail.items;
	};
	dndFinalize = (ci: number, e: CustomEvent<{ items: { id: string }[] }>) => {
		this.columns[ci] = e.detail.items;
		this.dragDisabled = true;
		this.persist(this.columns.map((col) => col.map((x) => x.id)));
	};
	releaseDrag = () => (this.dragDisabled = true); // window pointerup
}

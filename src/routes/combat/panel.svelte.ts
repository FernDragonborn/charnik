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
		[{ id: 'skills' }, { id: 'spells' }, { id: 'effects' }],
		[{ id: 'attacks' }, { id: 'actions' }]
	]);
	dragDisabled = $state(true); // drag only after the ⠿ grip arms it (handle-only)
	flipDurationMs = 150;

	/** `persist` is called with the flattened column id layout whenever a drag finalizes, so the owner
	 *  (CombatVM) can store it on the character. */
	constructor(private persist: (columns: string[][]) => void = () => {}) {}

	toggle = (k: string) => (this.collapsed[k] = !this.collapsed[k]);

	/** Restore a saved layout (from the character's ui.panelColumns), if any. */
	restore = (saved?: string[][]) => {
		if (saved?.length) this.columns = saved.map((col) => col.map((id) => ({ id })));
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

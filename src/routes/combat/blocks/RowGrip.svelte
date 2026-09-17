<script lang="ts">
	// The ⠿ that moves one row of a panel — a drag for a pointer, the arrow keys for everyone else.
	//
	// It is NOT a `<button>`: `svelte-dnd-action` discards a press whose target carries a `value`, and
	// every button does (`PanelCard`'s grip carries the whole story). It also sits BESIDE the row
	// rather than inside it, because a combat row is itself one big button and a control nested in a
	// control is what cost the keyboard its walk the last time this shape was built.
	import { tick } from 'svelte';
	import { dragHandle } from 'svelte-dnd-action';
	import { _ } from '$lib/i18n';

	let {
		panel,
		id,
		name,
		onmove,
	}: {
		/** Which panel this row belongs to — half of the grip's DOM id, so focus can find it again. */
		panel: string;
		id: string;
		/** What the row is called, for the label a screen reader reads. */
		name: string;
		onmove: (by: -1 | 1) => void;
	} = $props();

	const label = $derived($_('combat.moveRow', { values: { name } }));
	const ARROW_MOVE: Record<string, -1 | 1> = { ArrowUp: -1, ArrowDown: 1 };

	function moveOnArrow(event: KeyboardEvent): void {
		const by = ARROW_MOVE[event.code];
		if (!by) return;
		event.preventDefault(); // the panel would scroll instead
		onmove(by);
		// the library rebuilds the row's nodes, so the grip holding the caret is gone by the time the
		// move lands — a reorder must not cost the keyboard its place
		void tick().then(() => document.getElementById(`${panel}-grip-${id}`)?.focus());
	}
</script>

<span
	id="{panel}-grip-{id}"
	class="row-grip"
	use:dragHandle
	role="button"
	tabindex="0"
	aria-label={label}
	title={label}
	onkeydown={moveOnArrow}>⠿</span
>

<style>
	/* quiet until the row is under the pointer, so a list of things you own does not read as a list of
	   handles — and always visible once the keyboard is on it */
	.row-grip {
		display: flex;
		align-items: center;
		flex: none;
		padding: 0 2px;
		color: var(--color-text-muted);
		opacity: 0.35;
		cursor: grab;
		line-height: 1;
	}
	:global(.row-wrap:hover) .row-grip,
	:global(.inv-row:hover) .row-grip,
	.row-grip:focus-visible {
		opacity: 1;
	}
</style>

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
	/* INVISIBLE at rest. A list of things you own is not a list of handles, and a ⠿ on every row was
	   a mark on every line of the panel for an act most players do once. Its box stays — the target
	   and the layout are the same — and the glyph appears where a hand or the keyboard already is. */
	.row-grip {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: var(--space-3);
		/* it hangs into the panel's own padding instead of pushing the row: the rows used to start on
		   the same line as the panel's title, and a handle that moved every one of them 20px right
		   would be paid for by every row for the sake of a control that is invisible at rest. */
		margin-inline-start: calc(-1 * (var(--space-3) + var(--space-1)));
		color: var(--color-text-muted);
		opacity: 0;
		cursor: grab;
		line-height: 1;
	}
	:global(.row-wrap:hover) .row-grip,
	:global(.inv-row:hover) .row-grip,
	.row-grip:focus-visible {
		opacity: 1;
	}
	/* where there is no hover there is no reveal, so the grip has to be its own affordance — quiet,
	   but present, or a phone cannot reorder at all */
	@media (hover: none) {
		.row-grip {
			opacity: 0.4;
		}
	}
</style>

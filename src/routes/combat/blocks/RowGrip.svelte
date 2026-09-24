<script lang="ts">
	// The handle that moves one row of a panel — a drag for a pointer, the arrow keys for everyone else.
	//
	// It is NOT a `<button>`: `svelte-dnd-action` discards a press whose target carries a `value`, and
	// every button does (`PanelCard`'s grip carries the whole story). It sits BESIDE a row that is
	// itself one big button, because a control nested in a control is what cost the keyboard its walk
	// the last time this shape was built — and INSIDE one that is not, so that a row which expands
	// anchors the handle to its header rather than to everything the header opens. Hence the swallowed
	// click: inside a <summary>, a press on the handle would otherwise toggle the row.
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
	onkeydown={moveOnArrow}
></span>

<style>
	/* INVISIBLE at rest. A list of things you own is not a list of handles, and a mark on every row was
	   a mark on every line of the panel for an act most players do once. Its box stays — the target
	   and the layout are the same — and the spine appears where a hand or the keyboard already is.

	   OUT OF FLOW, because the gutter is smaller than it looks: the card's padding is 17px but the row
	   bleeds 8px of it (`.combat-row` in components.css), so a handle in the flex flow can only clear
	   the row by pushing it — the margin that keeps the row still is exactly `width + gap`, which puts
	   the handle back under the row's own hover fill. Absolute takes the handle out of that arithmetic:
	   the row does not move and the 6px that are genuinely free are the handle's alone.

	   DRAWN, never typed: a font character is at the mercy of whatever font resolves it, brings its own
	   metrics and sits off the baseline (`Icon.svelte` ▸ UBUG-19). A 2px rule needs no glyph anyway. */
	.row-grip {
		position: absolute;
		/* just outside the row's visible edge — `--row-bleed` is how far that edge overhangs its box */
		inset-inline-start: calc(-1 * (var(--row-bleed, var(--space-2)) + var(--space-1-5)));
		top: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		/* the mark sits OUTWARD in its box (see `::before`), so it breathes against the row while the
		   6px target keeps its distance from the card's border */
		justify-content: flex-start;
		width: var(--space-1-5);
		/* a quiet line, not a piece of text: dimmer than the row it belongs to in either theme */
		color: var(--color-border-strong);
		opacity: 0;
	}
	/* the spine itself: the target is the full height of the row, the mark is a hairline inside it */
	.row-grip::before {
		content: '';
		/* fractions of the target box, never pixels: `--space-1-5` is a rem, so the mark scales with
		   the root font the same way the row it marks does */
		width: calc(var(--space-1-5) / 3);
		margin-inline-start: calc(var(--space-1-5) / 6);
		/* a proportion, not a subtraction: these rows range from one line to an expanded card, and a
		   fixed inset that reads right on a 36px row is a full-height bar on a tall one */
		height: 70%;
		border-radius: var(--radius-full);
		background: currentColor;
	}
	/* whatever row HOSTS the handle reveals it — one rule instead of a list that grows a line every
	   time a panel gets a different wrapper */
	:global(:hover) > .row-grip,
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

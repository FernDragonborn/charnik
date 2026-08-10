<script lang="ts">
	// The dice-roll toast — CHROME around a `RollRow`, nothing more. The roll itself (label, the grid
	// with a line per attack, the provenance note) is rendered by the shared component so the toast,
	// the Playbar, the roll log and the dice tray all show a roll identically (UBUG-20). What lives
	// here is what only a toast has: the card is the dismiss target and sonner needs its own sizing.
	// It mounts RollRow with NO action props, so every pill is inert: a toast announces, the Playbar
	// and the log control (UX-3) — which is also why it no longer has to stay open indefinitely.
	import type { RollToastModel } from '$lib/dice/roll-toast';
	import RollRow from './RollRow.svelte';

	// `closeToast` is injected by svelte-sonner for a custom-component toast — which is also why it
	// drops its own close button, so the card itself has to be the dismiss affordance.
	let { model, closeToast }: { model: RollToastModel; closeToast?: () => void } = $props();
</script>

<div class="rolltoast">
	<!-- the roll itself is a real <button>, not a div with a role: it IS the dismiss target (see
	     closeToast above), which is exactly why no control may live inside it. -->
	<button
		type="button"
		class="rt-card"
		class:dismissible={closeToast}
		aria-label="{model.label} — {model.total}{closeToast ? '. Dismiss' : ''}"
		title={closeToast ? 'Dismiss' : undefined}
		onclick={closeToast}
	>
		<RollRow {model} />
	</button>
</div>

<style>
	/* sonner only sizes toasts it styles itself, and a custom component opts out of that — the <li>
	   shrink-wraps, so a card that sizes to its own content would drift to the left edge of the
	   toaster column. Give the li a band to centre the card in. The band is the design's 400px max,
	   wider than sonner's own column, so pull it back half the difference and the roll toasts stay
	   centred on the same axis as every other toast. */
	:global([data-sonner-toast]:has(> .rolltoast)) {
		display: flex;
		justify-content: center;
		width: 400px;
		margin-left: calc((var(--width) - 400px) / 2);
	}
	/* under 600px sonner takes the li full-width itself — don't fight it, just stop shifting */
	@media (max-width: 600px) {
		:global([data-sonner-toast]:has(> .rolltoast)) {
			width: 100%;
			margin-left: 0;
		}
	}
	/* the card sizes to its content: a bare check stays narrow, a three-attack flurry grows */
	.rolltoast {
		display: flex;
		flex-direction: column;
		width: max-content;
		min-width: 260px;
		max-width: 100%;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-2);
		overflow: hidden;
	}
	.rt-card {
		display: flex;
		flex-direction: column;
		padding: 0;
		font: inherit;
		text-align: left;
		background: transparent;
		border: 0;
		border-radius: inherit;
		color: inherit;
	}
	.rt-card.dismissible {
		cursor: pointer;
	}
	.rolltoast:has(.rt-card.dismissible:hover) {
		border-color: var(--color-border-strong);
	}
</style>

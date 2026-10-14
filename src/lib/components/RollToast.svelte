<script lang="ts">
	// The dice-roll toast — CHROME around a `RollRow`, nothing more. The roll itself (label, the grid
	// with a line per attack, the provenance note) is rendered by the shared component so the toast,
	// the Playbar, the roll log and the dice tray all show a roll identically (UBUG-20). What lives
	// here is what only a toast has: the card is the dismiss target and sonner needs its own sizing.
	// It mounts RollRow with NO action props, so every pill is inert: a toast announces, the Playbar
	// and the log control (UX-3) — which is also why it no longer has to stay open indefinitely.
	import { rollNameOf, sayRollName } from '$lib/combat/roll';
	import type { RollToastModel } from '$lib/dice/roll-toast';
	import { _ } from '$lib/i18n';
	import { ADVANTAGE_MODE } from '$lib/rules/dice';
	import { TOAST_TONE, type ToastNote } from '$lib/toast/toast';
	import Icon from './Icon.svelte';
	import RollRow from './RollRow.svelte';

	// `closeToast` is injected by svelte-sonner for a custom-component toast — which is also why it
	// drops its own close button, so the card itself has to be the dismiss affordance.
	// It carries one action's whole say (ui.md ▸ rule 20 — one action, one toast): the rolls, then the
	// notices the same action left. A lone notice never comes here; the toaster's own card says it.
	let {
		models,
		notes = [],
		closeToast,
	}: { models: RollToastModel[]; notes?: ToastNote[]; closeToast?: () => void } = $props();

	// HOW the d20 was rolled is the one thing you can't read off the numbers, and on a toast — which
	// you glance at once — it belongs to the whole card rather than to a frame around two dice. The
	// row's own cue (the triangle in the d20) still says it inside. The FIRST attack decides it: a
	// volley whose throws were read differently has no single card colour anyway.
	const advantage = $derived(models[0]?.attacks[0]?.advantageMode);

	// The card IS the labelled dismiss control — deliberately, because no control may live INSIDE it
	// (it is itself the dismiss target). So the label has to carry both what the roll was and what a
	// click does; a screen reader gets one button that says both, not an unnamed region plus an ✕.
	const cardLabel = $derived(
		[
			...models.map((model) =>
				$_(closeToast ? 'combat.log.rollAriaDismiss' : 'combat.log.rollAria', {
					values: { label: sayRollName(rollNameOf(model), $_), total: model.total },
				}),
			),
			...notes.map((note) => note.title),
		].join('. '),
	);
	const noteIcon = {
		[TOAST_TONE.warning]: 'triangle-alert',
		[TOAST_TONE.error]: 'circle-x',
	} as const;
</script>

<div
	class="roll-toast"
	class:advantage={advantage === ADVANTAGE_MODE.advantage}
	class:disadvantage={advantage === ADVANTAGE_MODE.disadvantage}
>
	<!-- the roll itself is a real <button>, not a div with a role: it IS the dismiss target (see
	     closeToast above), which is exactly why no control may live inside it. -->
	<button
		type="button"
		class="roll-card"
		class:dismissible={closeToast}
		aria-label={cardLabel}
		title={closeToast ? $_('combat.log.dismiss') : undefined}
		onclick={closeToast}
	>
		{#each models as model, index (index)}
			<RollRow {model} />
		{/each}
		{#each notes as note, index (index)}
			<span class="toast-note {note.tone}">
				{#if note.tone === TOAST_TONE.warning || note.tone === TOAST_TONE.error}
					<Icon name={noteIcon[note.tone]} size={14} />
				{/if}
				<span class="toast-note-text">
					<b>{note.title}</b>
					{#if note.description}<span>{note.description}</span>{/if}
				</span>
			</span>
		{/each}
	</button>
</div>

<style>
	/* sonner only sizes toasts it styles itself, and a custom component opts out of that — the <li>
	   shrink-wraps, so a card that sizes to its own content would drift to the left edge of the
	   toaster column. Give the li a band to centre the card in. The band is the design's 460px max,
	   wider than sonner's own column, so pull it back half the difference and the roll toasts stay
	   centred on the same axis as every other toast. */
	:global([data-sonner-toast]:has(> .roll-toast)) {
		display: flex;
		justify-content: center;
		width: 460px;
		margin-inline-start: calc((var(--width) - 460px) / 2);
	}
	/* under 600px sonner takes the li full-width itself — don't fight it, just stop shifting */
	@media (max-width: 600px) {
		:global([data-sonner-toast]:has(> .roll-toast)) {
			width: 100%;
			margin-inline-start: 0;
		}
	}
	/* the card sizes to its content: a bare check stays narrow, a three-attack flurry grows */
	.roll-toast {
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
	.roll-card {
		display: flex;
		flex-direction: column;
		padding: 0;
		font: inherit;
		text-align: start;
		background: transparent;
		border: 0;
		border-radius: inherit;
		color: inherit;
	}
	.roll-card.dismissible {
		cursor: pointer;
	}
	/* a notice under the roll that caused it: the sentence the toaster would have said on a card of
	   its own, said on this one instead */
	.toast-note {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		line-height: 1.4;
		color: var(--color-text);
	}
	.roll-card > * + * {
		border-top: 1px solid var(--color-border);
	}
	.toast-note-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.toast-note-text > span {
		color: var(--color-text-muted);
	}
	.toast-note.warning {
		color: var(--color-warning);
	}
	.toast-note.error {
		color: var(--color-danger);
	}
	.toast-note b {
		color: var(--color-text);
	}
	/* an advantaged/disadvantaged roll wears its colour on the card edge — 2px, so it reads at a glance
	   without a second frame inside the row. The hover cue stands down for it: the colour says
	   something about the roll, and hover would overwrite it with a state of the pointer. */
	.roll-toast.advantage {
		border: 2px solid var(--color-good);
	}
	.roll-toast.disadvantage {
		border: 2px solid var(--color-danger);
	}
	.roll-toast:not(.advantage, .disadvantage):has(.roll-card.dismissible:hover) {
		border-color: var(--color-border-strong);
	}
</style>

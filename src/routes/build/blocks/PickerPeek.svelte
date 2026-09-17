<script lang="ts">
	// The first tier of reading an option (ui.md §7): a teaser, so scanning a long list does not cost
	// a click per row. `pointer-events: none` is deliberate — there is nothing to click in it, so it
	// needs no hover-bridge to survive the trip and can never be the thing you try to scroll. Reading
	// in full is the click, and that opens PickerCard.
	import { placeCard, entryElement } from '../card-placement';
	import { floatInBody } from '$lib/actions/floatInBody';

	let {
		picker,
		entryId,
		title,
		meta,
		text,
		hint,
	}: {
		picker: HTMLElement;
		entryId: string;
		title: string;
		meta: string;
		/** Plain prose, already stripped of markdown — the peek clamps it, it does not render it. */
		text: string;
		/** What the pointer can do to this row. Supplied by the picker, because a list whose rows have
		 *  a take toggle offers more than one whose rows do not. */
		hint: string;
	} = $props();

	let peek = $state<HTMLElement | null>(null);

	// re-placed on scroll and resize as well as on a move to another row: the teaser is `position:
	// fixed` and the row it points at is not, so a wheel leaves it pinned beside nothing
	$effect(() => {
		void entryId;
		const place = () => {
			if (peek) placeCard(peek, entryElement(picker, entryId), picker);
		};
		place();
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		return () => {
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
		};
	});
</script>

<div class="picker-peek" bind:this={peek} use:floatInBody>
	<header>
		<b>{title}</b>
		{#if meta}<span class="pmeta">{meta}</span>{/if}
	</header>
	<p class="ptext">{text}</p>
	<span class="pmore">{hint}</span>
</div>

<style>
	.picker-peek {
		position: fixed;
		z-index: 38;
		width: min(320px, calc(100vw - 24px));
		padding-bottom: var(--space-2);
		pointer-events: none;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		box-shadow: 0 14px 38px var(--color-overlay);
		overflow: hidden;
	}
	header {
		padding: var(--space-2) var(--space-3) var(--space-1-5);
		border-bottom: 1px solid var(--color-border);
	}
	header b {
		display: block;
		font-family: var(--font-display);
		font-size: var(--font-size-sm);
	}
	.pmeta {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-resource);
	}
	.ptext {
		margin: var(--space-2) var(--space-3) 0;
		font-size: var(--font-size-xs);
		line-height: 1.5;
		color: var(--color-text-muted);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}
	.pmore {
		display: block;
		margin: var(--space-2) var(--space-3) 0;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-accent-bright);
	}
</style>

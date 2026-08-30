<script lang="ts">
	// The second tier of reading an option: the full compendium article, beside the picker, opened by
	// a click (ui.md §7). The SAME WikiDetail the compendium renders — a builder-only summary would
	// drift from the article a player checks elsewhere.
	//
	// Taking is repeated here because this is where the eyes are once you have read the thing. It is
	// the same act as the toggle in the list, not a confirm step over it.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import type { DetailModel } from '$lib/content/detail';
	import { placeCard, entryElement } from '../card-placement';

	let {
		picker,
		entryId,
		title,
		detail,
		taken,
		ontake,
		onclose,
	}: {
		/** The list or grid this card belongs to — what it is anchored to, and the region a click
		 *  inside must NOT be read as "outside" (the picker's own handlers decide those). */
		picker: HTMLElement;
		entryId: string;
		/** Only the accessible name: the article inside prints its own title. */
		title: string;
		detail: DetailModel | null;
		taken: boolean;
		/** Absent when the card is read-only (nothing here to commit). */
		ontake?: () => void;
		onclose: () => void;
	} = $props();

	let card = $state<HTMLElement | null>(null);

	// Re-placed whenever the card moves to another entry: ↑/↓ walk the list with the card open, and a
	// card left behind at the old row would be pointing at the wrong thing.
	$effect(() => {
		void entryId;
		void detail;
		if (card) placeCard(card, entryElement(picker, entryId), picker);
	});

	// Any click outside closes, plus Escape (ui.md §9). Clicks inside the PICKER are left alone on
	// purpose: the picker's own handler then reads them as "open that one instead" — or, on the entry
	// that is already open, as "close" — so swapping and toggling need no special case here.
	$effect(() => {
		const away = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (card?.contains(target) || picker.contains(target)) return;
			onclose();
		};
		const key = (event: KeyboardEvent) => {
			if (event.code === 'Escape') onclose();
		};
		document.addEventListener('click', away, true);
		document.addEventListener('keydown', key);
		return () => {
			document.removeEventListener('click', away, true);
			document.removeEventListener('keydown', key);
		};
	});
</script>

<div class="picker-card" bind:this={card} role="dialog" aria-label={title}>
	<!-- No title bar of its own: the article already opens with its type and its name, and printing
	     them a second time an inch above would just be the same words twice. -->
	<button class="close icon-button" aria-label={$_('build.picker.close')} onclick={onclose}>
		<Icon name="x" size={14} />
	</button>

	<!-- WikiDetail's own `.detail-body` is already the scroll region; wrapping it in a second one
	     would be the nested pair this whole picker exists to remove. -->
	<div class="cbody"><WikiDetail {detail} /></div>

	{#if ontake}
		<footer>
			<button class="btn take" class:taken onclick={ontake}>
				<Icon name={taken ? 'check' : 'plus'} size={13} />
				{$_(taken ? 'build.picker.taken' : 'build.picker.take')}
			</button>
		</footer>
	{/if}
</div>

<style>
	.picker-card {
		position: fixed;
		z-index: 40;
		width: min(470px, calc(100vw - 24px));
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border: 1px solid var(--color-accent-deep);
		border-radius: var(--radius-lg);
		box-shadow: 0 24px 64px var(--color-overlay);
		overflow: hidden;
	}
	/* over the article rather than above it — the head is the article's own, and a strip holding one
	   button would cost a row of height on every card for the sake of it */
	.close {
		position: absolute;
		top: 8px;
		right: 10px;
		z-index: 1;
		padding: 4px;
		border-radius: var(--radius-full);
		background: var(--color-surface-2);
	}
	.close:hover {
		color: var(--color-text);
	}
	.cbody {
		display: flex;
		min-height: 0;
	}
	.cbody :global(.detail-body) {
		flex: 1;
		padding: 4px 14px 10px;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border-strong) transparent;
	}
	footer {
		display: flex;
		padding: 9px 14px;
		border-top: 1px solid var(--color-border);
	}
	.take {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.take.taken {
		background: var(--color-resource-soft);
		border-color: var(--color-resource-line);
		color: var(--color-resource);
	}
</style>

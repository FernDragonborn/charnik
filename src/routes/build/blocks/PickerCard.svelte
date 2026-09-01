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
	//
	// …and on scroll and resize, for the same reason one step further out: the card is `position:
	// fixed` and its row is not, so a wheel over the list slides the row out from under a card that
	// stays pinned to the viewport. Being level with the entry is the whole point of where it lands.
	$effect(() => {
		void entryId;
		void detail;
		const place = () => {
			if (card) placeCard(card, entryElement(picker, entryId), picker);
		};
		place();
		// capture, because the thing that scrolls is an element inside the pane, not the window
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		return () => {
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
		};
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
		// CAPTURE, and it stops there: the pane behind this listens for Escape too, and one press
		// closing the card AND dropping the highlight empties the diff and loses your place in the list.
		// Capture runs before any bubble handler, so the outer one never sees the key at all.
		const key = (event: KeyboardEvent) => {
			if (event.code !== 'Escape') return;
			event.stopPropagation();
			onclose();
		};
		document.addEventListener('click', away, true);
		document.addEventListener('keydown', key, true);
		return () => {
			document.removeEventListener('click', away, true);
			document.removeEventListener('keydown', key, true);
		};
	});
</script>

<!-- A labelled group, NOT a dialog: a dialog owes focus moved into it, a trap and a restore, and all
     three fight the contract this picker is built on — the caret stays in the search box, which is
     the only thing naming the highlighted option to a screen reader while the arrows walk. -->
<div class="picker-card" bind:this={card} role="group" aria-label={title}>
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
			<button class="btn take" class:is-taken={taken} onclick={ontake}>
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
		inset-inline-end: 10px;
		z-index: 1;
		padding: var(--space-1);
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
		padding: var(--space-1) 14px var(--space-2-5);
		scrollbar-width: thin;
		scrollbar-color: var(--color-border-strong) transparent;
	}
	footer {
		display: flex;
		padding: var(--space-2) 14px;
		border-top: 1px solid var(--color-border);
	}
	.take {
		margin-inline-start: auto;
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
	}
	.take.is-taken {
		color: var(--color-resource);
	}
</style>

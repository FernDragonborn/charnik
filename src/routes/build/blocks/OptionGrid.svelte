<script lang="ts">
	// "Choose one content row" for the six pickers that are small (background 5, subclass ~4, species
	// 18, feat 18, class 24, language 35 — ui.md §3). A GRID, not a list: 24 classes are six rows of
	// four instead of twenty-four, which removes the reason to scroll rather than managing it.
	// Baldur's Gate 3 is the reference.
	//
	// There is no hover teaser here on purpose. What a teaser would carry — the hit die, the saves,
	// the size and speed — is short enough to live in the cell, so a card on hover would add nothing
	// but flicker under a moving pointer. Clicking a cell opens the full article beside the grid.
	//
	// Keyboard-first (ui.md §5): ↑/↓ move the highlight, Home/End jump, Enter is a left click. Walking
	// only ever highlights — an open card follows the highlight, but nothing commits on the way past.
	import { _ } from '$lib/i18n';
	import type { LoadedRow } from '$lib/content/loader';
	import type { DetailModel } from '$lib/content/detail';
	import { pickerMeta, rowName } from '../rows';
	import { walkOptions } from '../option-walk';
	import PickerSearch from './PickerSearch.svelte';
	import PickerCard from './PickerCard.svelte';

	let {
		options,
		query = $bindable(''),
		previewId,
		takenIds,
		onpreview,
		ontake,
		detail,
		placeholder,
	}: {
		options: LoadedRow[];
		query?: string;
		/** The highlighted option — what the diff below the grid, and any open card, are about. */
		previewId: string | null;
		/** Already chosen. A list because the same control serves a one-of pick and a many-of one. */
		takenIds: string[];
		/** Highlight. Never commits anything. */
		onpreview: (id: string) => void;
		/** Commit, from the card's own take button — reading and taking are separate acts (ui.md §6). */
		ontake: (id: string) => void;
		/** The article for `previewId`, rendered by the card. */
		detail: DetailModel | null;
		placeholder: string;
	} = $props();

	const taken = $derived(new Set(takenIds));
	let grid = $state<HTMLElement | null>(null);
	/** Is the article card up? It always reads `previewId`, so the highlight and the card can never
	 *  disagree about which option is being talked about. */
	let reading = $state(false);
	const previewRow = $derived(options.find((o) => o.effectiveId === previewId));

	/** A click on a cell reads it; a click on the cell already being read puts the card away. */
	function activate(id: string) {
		if (reading && id === previewId) {
			reading = false;
			return;
		}
		onpreview(id);
		reading = true;
	}

	const walk = (event: KeyboardEvent) =>
		walkOptions(event, {
			ids: options.map((o) => o.effectiveId),
			previewId,
			onpreview,
			onenter: activate,
		});
</script>

<PickerSearch bind:query {placeholder} count={options.length} onkeydown={walk} />

<div
	class="ogrid"
	role="listbox"
	tabindex="-1"
	aria-label={$_('build.inspector.options')}
	bind:this={grid}
	onkeydown={walk}
>
	{#each options as row (row.effectiveId)}
		{@const meta = pickerMeta(row, $_)}
		<button
			class="cell"
			data-entry={row.effectiveId}
			role="option"
			aria-selected={row.effectiveId === previewId}
			class:preview={row.effectiveId === previewId}
			class:taken={taken.has(row.effectiveId)}
			onclick={() => activate(row.effectiveId)}
		>
			<span class="cname">{rowName(row)}</span>
			{#if meta}<span class="cmeta">{meta}</span>{/if}
		</button>
	{:else}
		<p class="subtext nomatch">{$_('build.inspector.noMatch', { values: { query } })}</p>
	{/each}
</div>

{#if reading && grid && previewId && previewRow}
	<PickerCard
		picker={grid}
		entryId={previewId}
		title={rowName(previewRow)}
		{detail}
		taken={taken.has(previewId)}
		ontake={() => ontake(previewId)}
		onclose={() => (reading = false)}
	/>
{/if}

<style>
	/* auto-fill rather than a fixed column count: the inspector takes a share of the window, so the
	   same grid is four across at 1280 and six on a wide screen.

	   It shrinks before it scrolls (`flex: 0 1 auto`), so the twelve classes that fit simply fit and
	   nothing here has a magic height — a pack that ships two hundred feats gets a scrollbar, and it
	   is the pane's ONLY one. */
	.ogrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		align-content: start;
		gap: 6px;
		margin-top: 9px;
		flex: 0 1 auto;
		min-height: 96px;
		overflow: auto;
		padding: 2px;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border-strong) transparent;
	}
	.nomatch {
		grid-column: 1 / -1;
		margin: 4px 0;
	}
	.cell {
		all: unset;
		box-sizing: border-box;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 9px 5px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		text-align: center;
	}
	.cell:hover {
		border-color: var(--color-border-strong);
		background: var(--color-surface-2);
	}
	.cell:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.cname {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		line-height: 1.2;
	}
	.cmeta {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		line-height: 1.3;
	}
	.cell.preview {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
	.cell.preview .cname {
		color: var(--color-accent-bright);
	}
	/* gold fill wins the cell, because "this is the one you have" outranks "this is the one you are
	   reading" — but the accent outline stays, so the card still points somewhere visible. */
	.cell.taken {
		border-color: var(--color-resource-line);
		background: var(--color-resource-soft);
	}
	.cell.taken .cname {
		color: var(--color-resource);
	}
	.cell.taken.preview {
		border-color: var(--color-accent);
	}
</style>

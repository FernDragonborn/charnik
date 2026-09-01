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
	import type { Snippet } from 'svelte';
	import type { LoadedRow } from '$lib/content/loader';
	import type { DetailModel } from '$lib/content/detail';
	import { pickerMeta, rowName } from '../rows';
	import { PickerReading } from '../picker-reading.svelte';
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
		blocked,
		below,
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
		/** Why an option cannot be taken, already in the reader's language — or `null` when it can.
		 *  A blocked option still opens its article; only the take is refused. */
		blocked?: (id: string) => string | null;
		/** Whatever the pane shows under the options — the diff, a taken pick's own sub-choices. It
		 *  renders INSIDE the scroll region with the grid, because the pane gets one and this is it:
		 *  two shrinkable boxes each with their own scrollbar is the failure this control exists to
		 *  remove, not a shape to reproduce a level down. */
		below?: Snippet;
	} = $props();

	const taken = $derived(new Set(takenIds));
	let grid = $state<HTMLElement | null>(null);
	const previewRow = $derived(options.find((o) => o.effectiveId === previewId));

	// reading + the keyboard walk are the same contract in both pickers — see `picker-reading`.
	// The id scopes this picker's DOM ids: the spell pane renders one per caster class.
	const pickerId = $props.id();
	const picker = new PickerReading(
		() => ({ ids: options.map((o) => o.effectiveId), previewId, onpreview, ontake }),
		pickerId,
	);
</script>

<PickerSearch
	bind:query
	bind:element={picker.search}
	{placeholder}
	count={options.length}
	onkeydown={picker.fromSearch}
	listId={picker.listId}
	activeId={picker.activeId}
/>

<div class="oscroll scrolly">
	<div
		class="ogrid"
		id={picker.listId}
		role="listbox"
		tabindex="-1"
		aria-label={$_('build.inspector.options')}
		bind:this={grid}
		onkeydown={picker.fromOptions}
	>
		{#each options as row (row.effectiveId)}
			{@const meta = pickerMeta(row, $_)}
			{@const why = blocked?.(row.effectiveId) ?? null}
			<!-- the double-click takes it outright, the same gesture the sectioned list uses. It skips
			     the diff, which is the one thing this pane exists to show — so it is a shortcut for
			     someone who already knows what they want, and Ctrl+Z is the way back.
			     A double-click delivers its two clicks first, and `read` toggles: without the `detail`
			     guard and the close below, the same gesture left the card open or shut depending on
			     which row you happened to be reading when you started. -->
			<button
				class="cell"
				id={picker.optionId(row.effectiveId)}
				data-entry={row.effectiveId}
				role="option"
				aria-selected={taken.has(row.effectiveId)}
				aria-disabled={why ? true : undefined}
				title={why}
				class:is-active={row.effectiveId === previewId}
				class:is-taken={taken.has(row.effectiveId)}
				class:is-blocked={!!why}
				onclick={(event) => event.detail < 2 && picker.read(row.effectiveId)}
				ondblclick={() => {
					ontake(row.effectiveId);
					picker.close();
				}}
			>
				<span class="cname">{rowName(row)}</span>
				{#if meta}<span class="cmeta">{meta}</span>{/if}
			</button>
		{:else}
			<p class="subtext nomatch">{$_('build.inspector.noMatch', { values: { query } })}</p>
		{/each}
	</div>

	{#if below}{@render below()}{/if}
</div>

{#if picker.reading && grid && previewId && previewRow}
	<PickerCard
		picker={grid}
		entryId={previewId}
		title={rowName(previewRow)}
		{detail}
		taken={taken.has(previewId)}
		ontake={() => ontake(previewId)}
		onclose={picker.close}
	/>
{/if}

<style>
	/* The pane's ONE scroll region, holding the options and whatever the pane puts under them. They
	   scroll together on purpose: as two boxes that each shrink and scroll, a short pane gives both a
	   scrollbar and clips both, which is the defect this control exists to remove. */
	.oscroll {
		display: flex;
		flex-direction: column;
		gap: var(--space-2-5);
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 2px;
	}
	/* auto-fill rather than a fixed column count: the inspector takes a share of the window, so the
	   same grid is four across at 1280 and six on a wide screen. */
	.ogrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		align-content: start;
		gap: var(--space-1-5);
		margin-top: var(--space-1-5);
		flex: none;
	}
	.nomatch {
		grid-column: 1 / -1;
		margin: var(--space-1) 0;
	}
	.cell {
		all: unset;
		box-sizing: border-box;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		text-align: center;
		/* `all: unset` puts text selection back, and a cell's second click is a double-click that
		   takes the option — highlighting its name on the way is not what that gesture meant */
		user-select: none;
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
	/* the two state fills come from `.is-active` / `.is-taken` in build.css; what is the cell's own
	   is how its NAME reads in each state */
	.cell.is-active .cname {
		color: var(--color-accent-bright);
	}
	.cell.is-taken .cname {
		color: var(--color-resource);
	}
	/* gold fill wins the cell, because "this is the one you have" outranks "this is the one you are
	   reading" — but the accent outline stays, so the card still points somewhere visible. */
	.cell.is-taken.is-active {
		border-color: var(--color-accent);
	}
	/* readable, and visibly not takeable — its `title` says why. Dropping it from the list instead
	   reads as the app having lost it. */
	.cell.is-blocked {
		opacity: 0.45;
	}
	.cell.is-blocked:hover {
		border-color: var(--color-border);
		background: none;
	}
</style>

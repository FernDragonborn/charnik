<script lang="ts">
	// The searchable option list every "pick one content row" target uses. Keyboard-first (ui.md §5):
	// ↑/↓ move the highlight, Home/End jump, Enter is identical to a left click. Highlighting an
	// option previews it — the prose and the diff below follow the highlight, not the commit.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import type { Snippet } from 'svelte';
	import type { LoadedRow } from '$lib/content/loader';
	import { rowName } from '../rows';
	import { entryMeta } from '$lib/content/detail';

	let {
		options,
		query = $bindable(''),
		previewId,
		takenIds,
		onpreview,
		onactivate,
		placeholder,
		lead,
		groupOf
	}: {
		options: LoadedRow[];
		query?: string;
		previewId: string | null;
		/** Already chosen. A list, because the same control serves a one-of pick (species, a feat) and
		 *  a many-of one (spells) — one is the other with a single element. */
		takenIds: string[];
		/** Highlight — what the prose and the diff follow. Never commits anything. */
		onpreview: (id: string) => void;
		/**
		 * Commit, when the target has nothing to confirm. A many-of list (spells, equipment) toggles
		 * the row you clicked and is undone by clicking it again, so a separate Take button would be a
		 * confirmation step over an already-reversible act. A one-of pick leaves this unset: there the
		 * click has to stay a preview, because the whole point is reading the diff before taking it.
		 * Arrow keys only ever preview — walking a list must not commit six things on the way down.
		 */
		onactivate?: (id: string) => void;
		placeholder: string;
		/** An extra row above the content rows (the ASI pseudo-option on a feat slot). */
		lead?: Snippet;
		/** Section label for a row. A label that differs from the row above starts a new section, so a
		 *  pre-sorted list (spells by level) keeps its structure inside one flat, walkable list. */
		groupOf?: (row: LoadedRow) => string;
	} = $props();

	const taken = $derived(new Set(takenIds));

	/** ↑/↓ walk the rendered order and preview as they go, so the keyboard reads exactly what the
	 *  mouse would. */
	function walk(event: KeyboardEvent) {
		const ids = options.map((o) => o.effectiveId);
		if (!ids.length) return;
		const at = previewId ? ids.indexOf(previewId) : -1;
		// Enter is a left click on the highlighted row (ui.md §5) — the walk happens from the search
		// box, so the row itself never has focus for the browser's own Enter-on-a-button to fire.
		if (event.code === 'Enter' && previewId && onactivate) {
			event.preventDefault();
			onactivate(previewId);
			return;
		}
		let next: number | null = null;
		if (event.code === 'ArrowDown') next = Math.min(ids.length - 1, at + 1);
		else if (event.code === 'ArrowUp') next = at <= 0 ? 0 : at - 1;
		else if (event.code === 'Home') next = 0;
		else if (event.code === 'End') next = ids.length - 1;
		if (next === null) return;
		event.preventDefault();
		const id = ids[next];
		if (id) onpreview(id);
	}
</script>

<div class="lsearch">
	<span class="search-icon"><Icon name="search" size={13} /></span>
	<input {placeholder} bind:value={query} onkeydown={walk} />
	<span class="count">{options.length}</span>
</div>

<div class="rows scrolly" role="listbox" tabindex="-1" aria-label={$_('build.inspector.options')} onkeydown={walk}>
	{#if lead}{@render lead()}{/if}
	{#each options as row, i (row.effectiveId)}
		{@const meta = entryMeta(row)}
		{@const group = groupOf?.(row)}
		{@const prev = options[i - 1]}
		{#if group && (!prev || group !== groupOf?.(prev))}
			<div class="glabel">{group}</div>
		{/if}
		<button
			class="orow"
			role="option"
			aria-selected={row.effectiveId === previewId}
			class:preview={row.effectiveId === previewId}
			class:current={taken.has(row.effectiveId)}
			onclick={() => {
				onpreview(row.effectiveId);
				onactivate?.(row.effectiveId);
			}}
		>
			<b>{rowName(row)}</b>
			{#if taken.has(row.effectiveId)}<span class="taken">{$_('build.inspector.taken')}</span>{/if}
			{#if meta}<span class="ometa">{meta}</span>{/if}
		</button>
	{:else}
		<p class="subtext">{$_('build.inspector.noMatch', { values: { query } })}</p>
	{/each}
</div>

<style>
	.lsearch {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		padding: 0 11px;
	}
	.lsearch input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: 0;
		color: var(--color-text);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		padding: 8px 0;
	}
	.lsearch input:focus {
		outline: none;
	}
	.lsearch:focus-within {
		border-color: var(--color-accent);
	}
	.search-icon {
		color: var(--color-text-muted);
		display: grid;
		place-items: center;
	}
	.count {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 3px;
		max-height: 340px;
		overflow: auto;
		padding: 8px 2px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		margin-top: 9px;
	}
	.glabel {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 6px 8px 2px;
		position: sticky;
		top: -8px;
		background: var(--color-bg);
	}
	.orow {
		all: unset;
		box-sizing: border-box;
		cursor: pointer;
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
		padding: 5px 10px;
		margin: 0 6px;
		border: 1px solid var(--color-border);
		border-radius: 9px;
		background: var(--color-surface);
	}
	.orow:hover {
		border-color: var(--color-border-strong);
	}
	.orow.current {
		border-color: var(--color-resource-line);
		background: var(--color-resource-soft);
	}
	.orow.preview {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
	.orow:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.orow b {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.orow.preview b {
		color: var(--color-accent-bright);
	}
	.taken {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-resource);
	}
	.ometa {
		flex: 1;
		text-align: right;
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
</style>

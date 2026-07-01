<script lang="ts">
	// Compendium — a live browser over the shipped content graph (both editions). Pick a
	// type, search, click a row to see its detail. Real 4000+ rows via getContentGraph().
	import { onMount } from 'svelte';
	import { getContentGraph } from '$lib/content/provider';
	import type { ContentGraph, LoadedRow } from '$lib/content/loader';
	import type { ContentType } from '$lib/content/schemas';

	let graph = $state<ContentGraph | null>(null);
	let types = $state<ContentType[]>([]);
	let selectedType = $state<ContentType>('spell');
	let query = $state('');
	let selected = $state<LoadedRow | null>(null);

	onMount(async () => {
		const g = await getContentGraph();
		graph = g;
		types = [...g.byType.keys()].sort();
		if (!types.includes(selectedType)) selectedType = types[0];
	});

	const rows = $derived.by(() => {
		if (!graph) return [];
		const q = query.trim().toLowerCase();
		const list = graph.list(selectedType);
		return (q ? list.filter((r) => String(r.data.name_en).toLowerCase().includes(q)) : list).slice(
			0,
			400
		);
	});

	const total = $derived(graph ? graph.list(selectedType).length : 0);

	// non-empty, non-common fields for the detail panel
	const COMMON = new Set([
		'id',
		'systems',
		'source',
		'name_en',
		'name_uk',
		'text_en',
		'text_uk',
		'effects'
	]);
	function detailFields(row: LoadedRow): [string, string][] {
		return Object.entries(row.data)
			.filter(
				([k, v]) => !COMMON.has(k) && v !== '' && v != null && !(Array.isArray(v) && v.length === 0)
			)
			.map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]);
	}
	function pick(type: ContentType) {
		selectedType = type;
		selected = null;
	}
</script>

<svelte:head><title>Compendium — Charnik</title></svelte:head>

{#if !graph}
	<p class="loading">Loading content…</p>
{:else}
	<header class="head">
		<h1>Compendium</h1>
		<nav class="types">
			{#each types as t (t)}
				<button type="button" class:active={t === selectedType} onclick={() => pick(t)}>
					{t.replace(/_/g, ' ')} <span class="n">{graph.list(t).length}</span>
				</button>
			{/each}
		</nav>
		<input class="search" type="search" placeholder="Filter {selectedType}…" bind:value={query} />
	</header>

	<div class="cols">
		<ul class="list" aria-label="{selectedType} list">
			{#each rows as row (row.effectiveId)}
				<li>
					<button
						type="button"
						class:active={selected?.effectiveId === row.effectiveId}
						onclick={() => (selected = row)}
					>
						<span class="nm">{row.data.name_en}</span>
						<span class="ed">{(row.data.systems as string[]).join('/')}</span>
					</button>
				</li>
			{:else}
				<li class="empty">No matches.</li>
			{/each}
			{#if total > rows.length}
				<li class="more">…and {total - rows.length} more — narrow the filter</li>
			{/if}
		</ul>

		<article class="detail">
			{#if selected}
				<p class="d-src">{selected.source} · {(selected.data.systems as string[]).join(' / ')}</p>
				<h2>{selected.data.name_en}</h2>
				{#if detailFields(selected).length}
					<dl class="fields">
						{#each detailFields(selected) as [k, v] (k)}
							<dt>{k.replace(/_/g, ' ')}</dt>
							<dd>{v}</dd>
						{/each}
					</dl>
				{/if}
				{#if selected.data.text_en}
					<p class="text">{selected.data.text_en}</p>
				{/if}
			{:else}
				<p class="pick">Select an entry to see its detail.</p>
			{/if}
		</article>
	</div>
{/if}

<style>
	.loading {
		color: var(--color-text-muted);
		padding: var(--space-6);
		text-align: center;
	}
	.head h1 {
		font-family: var(--font-display);
		font-size: var(--font-size-2xl);
		margin: 0 0 var(--space-2);
	}
	.types {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}
	.types button {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: capitalize;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-muted);
		border-radius: var(--radius-full);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}
	.types button.active {
		color: var(--color-accent-text, var(--color-accent));
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
	.types .n {
		opacity: 0.6;
	}
	.search {
		width: 100%;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		margin-bottom: var(--space-4);
		outline: none;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(220px, 340px) 1fr;
		gap: var(--space-4);
		align-items: start;
	}
	@media (max-width: 640px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 70vh;
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.list button {
		width: 100%;
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		align-items: center;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		text-align: left;
	}
	.list button:hover {
		background: var(--color-surface-2);
	}
	.list button.active {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}
	.nm {
		font-family: var(--font-display);
	}
	.ed {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.empty,
	.more {
		padding: var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}
	.detail {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		background: var(--color-surface);
		min-height: 40vh;
	}
	.d-src {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--color-accent);
		margin: 0;
	}
	.detail h2 {
		font-family: var(--font-display);
		font-size: var(--font-size-xl);
		margin: var(--space-1) 0 var(--space-3);
	}
	.fields {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 2px var(--space-3);
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-sm);
	}
	.fields dt {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		color: var(--color-text-muted);
		align-self: center;
	}
	.fields dd {
		margin: 0;
	}
	.text {
		white-space: pre-wrap;
		line-height: 1.5;
		color: var(--color-text);
	}
	.pick {
		color: var(--color-text-muted);
	}
</style>

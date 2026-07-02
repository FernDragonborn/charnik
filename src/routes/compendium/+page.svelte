<script lang="ts">
	// Compendium — the same two-pane shape as the Spellbook (d-spellmgr), read-only: a grouped
	// list of every content row + the wiki detail from its CSV. Reuses EntryList + WikiDetail.
	import { onMount } from 'svelte';
	import { getContentGraph } from '$lib/content/provider';
	import type { ContentGraph, LoadedRow } from '$lib/content/loader';
	import type { ContentType } from '$lib/content/schemas';
	import { buildDetail, entryMeta, groupEntries, type Entry } from '$lib/content/detail';
	import EntryList from '$lib/components/EntryList.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import Chip from '$lib/components/Chip.svelte';

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
		return q ? list.filter((r) => String(r.data.name_en).toLowerCase().includes(q)) : list;
	});
	const total = $derived(graph ? graph.list(selectedType).length : 0);

	const groups = $derived(
		groupEntries(rows.slice(0, 500), selectedType).map((g) => ({
			label: g.label,
			entries: g.rows.map((r): Entry<LoadedRow> => ({
				id: r.effectiveId,
				name: String(r.data.name_en),
				meta: entryMeta(r, selectedType),
				row: r
			}))
		}))
	);
	const detail = $derived(selected ? buildDetail(selected, selectedType) : null);

	function pick(type: ContentType) {
		selectedType = type;
		selected = null;
		query = '';
	}
</script>

<svelte:head><title>Compendium — Charnik</title></svelte:head>

{#if !graph}
	<p class="loading">Loading content…</p>
{:else}
	<div class="mgrhead">
		<h1>Compendium</h1>
		<span class="count">{total} {selectedType.replace(/_/g, ' ')}</span>
	</div>
	<nav class="types">
		{#each types as t (t)}
			<Chip active={t === selectedType} onclick={() => pick(t)}>
				{t.replace(/_/g, ' ')} <span class="n">{graph.list(t).length}</span>
			</Chip>
		{/each}
	</nav>

	<div class="two">
		<EntryList
			{groups}
			bind:searchValue={query}
			searchPlaceholder="Search {selectedType.replace(/_/g, ' ')}…"
			selectedId={selected?.effectiveId ?? null}
			onselect={(e) => (selected = e.row)}
		/>
		<WikiDetail {detail} />
	</div>
{/if}

<style>
	.loading {
		color: var(--color-text-muted);
		padding: var(--space-6);
		text-align: center;
	}
	.mgrhead {
		display: flex;
		align-items: baseline;
		gap: 14px;
		/* pull up under the nav so the two-pane gets the vertical room, not the title */
		margin: calc(-1 * var(--space-3)) 0 10px;
		flex-wrap: wrap;
	}
	.mgrhead h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-2xl);
		margin: 0;
	}
	.count {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.types {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 14px;
	}
	.types .n {
		opacity: 0.55;
	}
	.two {
		display: grid;
		grid-template-columns: minmax(300px, 390px) 1fr;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		/* definite height so each pane's grid track is bounded → panes scroll internally */
		height: calc(100vh - 175px);
		min-height: 560px;
	}
	@media (max-width: 700px) {
		.two {
			grid-template-columns: 1fr;
			height: auto;
		}
	}
</style>

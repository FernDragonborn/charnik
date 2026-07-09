<script lang="ts">
	// Compendium — the same two-pane shape as the Spellbook (d-spellmgr), read-only: a grouped
	// list of every content row + the wiki detail from its CSV. Reuses EntryList + WikiDetail.
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { content, loadContentStore, reloadContent } from '$lib/content/store.svelte';
	import type { LoadedRow } from '$lib/content/loader';
	import { isBrowsable, type ContentType } from '$lib/content/schemas';
	import {
		buildDetail,
		entryMeta,
		editionLabel,
		sourceLabel,
		type Entry
	} from '$lib/content/detail';
	import { getSpellAccess } from '$lib/content/spellAccess';
	import { groupingsFor, facetFor, groupRows, distinctValues } from '$lib/content/grouping';
	import EntryList from '$lib/components/EntryList.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import EditContentForm from '$lib/components/EditContentForm.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { app } from '$lib/stores/app.svelte';

	// row is shown if any of its editions is currently active. Use the STAMPED `r.systems` (from the
	// file's `#content-systems:` header / pack default), NOT the raw `r.data.systems` column — the SRD
	// files declare editions in the header, so the column is absent and filtered everything out.
	const inEdition = (r: LoadedRow) =>
		r.systems.some((s) => app.activeEditions.includes(s as (typeof app.activeEditions)[number]));
	const showEdition = $derived(app.activeEditions.length > 1);

	// shared reactive store → a live content refresh re-renders every derived list below, no reload
	const graph = $derived(content.graph);
	const types = $derived(graph ? [...graph.byType.keys()].filter(isBrowsable).sort() : []);
	let selectedType = $state<ContentType>('spell');
	let query = $state('');
	let selected = $state<LoadedRow | null>(null);
	let groupBy = $state('level');
	let groupOpen = $state(false);
	let sourceFilter = $state<Set<string>>(new Set()); // empty = all sources
	let facetFilter = $state<Set<string>>(new Set()); // empty = all facet values
	let adding = $state(false); // right pane shows the homebrew authoring form
	let pickerOpen = $state(false); // the "Edit compendium" mode menu (translate / editor / add)

	onMount(async () => {
		await loadContentStore();
		if (!types.includes(selectedType)) selectedType = types[0] ?? selectedType;
		groupBy = groupingsFor(selectedType)[0]?.key ?? groupBy;
	});

	// deep-link: /compendium/<type>/<source>/<id> opens that entry (rest-param route served by
	// the 404.html SPA fallback). Source is in the path because a slug is unique only per TYPE,
	// not across editions/sources ("fireball" exists in both 5e and 5.5e) → type:source:id is
	// the unique effectiveId. Depends only on the URL param + graph (untrack the rest) so
	// clicking a type chip isn't reverted by this effect.
	const entryParam = $derived(page.params.entry ?? '');
	// clicking a row updates the URL so the current entry is shareable (no history spam)
	function openEntry(row: LoadedRow) {
		adding = false;
		selected = row;
		goto(`${base}/compendium/${row.type}/${encodeURIComponent(row.source)}/${row.data.id}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
	$effect(() => {
		const g = graph;
		const parts = entryParam.split('/').filter(Boolean);
		if (!g || parts.length < 2) return;
		const t = parts[0];
		const id = parts[parts.length - 1];
		const source = parts.slice(1, -1).join('/'); // "" for legacy type/id links
		untrack(() => {
			if (!types.includes(t as ContentType)) return;
			if (selectedType !== t) {
				selectedType = t as ContentType;
				groupBy = groupingsFor(selectedType)[0]?.key ?? groupBy;
				sourceFilter = new Set();
				facetFilter = new Set();
			}
			const rows = g.list(t as ContentType);
			selected =
				(source && g.get(`${t}:${source}:${id}`)) || rows.find((r) => r.data.id === id) || null;
		});
	});

	// all rows of the type in the active editions — the pool the filters/facets draw from
	const pool = $derived(graph ? graph.list(selectedType).filter(inEdition) : []);
	const groupings = $derived(groupingsFor(selectedType));
	const facet = $derived(facetFor(selectedType));
	const sources = $derived([...new Set(pool.map((r) => r.source))].sort());
	const facetValues = $derived(facet ? distinctValues(pool, facet.key) : []);

	const rows = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return pool.filter((r) => {
			if (sourceFilter.size && !sourceFilter.has(r.source)) return false;
			if (facet && facetFilter.size) {
				// facet.key is a runtime config string; scan entries to read the cell off the union (no cast)
				const v = Object.entries(r.data).find(([k]) => k === facet.key)?.[1];
				if (!facetFilter.has(v == null ? '' : String(v))) return false;
			}
			return !q || String(r.data.name_en).toLowerCase().includes(q);
		});
	});

	const groups = $derived(
		groupRows(rows.slice(0, 500), groupBy, selectedType).map((g) => ({
			label: g.label,
			entries: g.rows.map((r): Entry<LoadedRow> => ({
				id: r.effectiveId,
				name: String(r.data.name_en),
				meta: entryMeta(r),
				edition: editionLabel(r.systems),
				row: r
			}))
		}))
	);
	// spell "Available to" comes from the reverse UNION access index (inline classes ∪ spell_lists),
	// NOT the raw column — so a class that gained the spell class-side still shows, with provenance.
	const availableTo = $derived.by(() => {
		if (!graph || !selected || selected.type !== 'spell') return undefined;
		const seen = new Set<string>();
		return getSpellAccess(graph)
			.classesForSpell(selected.effectiveId)
			.map((e) => ({
				name: String(graph!.get(e.classEffectiveId)?.data.name_en ?? e.classId),
				homebrew: e.via === 'spell-list'
			}))
			.filter((x) => (seen.has(x.name) ? false : seen.add(x.name)));
	});
	const detail = $derived(
		selected ? buildDetail(selected, selectedType, availableTo, app.activeLocale) : null
	);
	const groupLabel = $derived(groupings.find((g) => g.key === groupBy)?.label ?? '');
	const activeFilters = $derived(sourceFilter.size + facetFilter.size);

	function pick(type: ContentType) {
		selectedType = type;
		selected = null;
		adding = false;
		query = '';
		groupBy = groupingsFor(type)[0]?.key ?? groupBy;
		sourceFilter = new Set();
		facetFilter = new Set();
	}

	// homebrew authoring: open a blank editable article for the current type; on save reload the
	// graph (so the new row is merged in) and open it.
	async function onSaved(id: string) {
		adding = false;
		const g = await reloadContent(); // merge the new homebrew row + rotate guid → lists recompute
		const row = g.get(`${selectedType}:Homebrew:${id}`);
		if (row) openEntry(row);
	}
	function toggle(set: Set<string>, v: string) {
		const next = new Set(set);
		if (next.has(v)) next.delete(v);
		else next.add(v);
		return next;
	}
</script>

<svelte:head><title>Compendium — Charnik</title></svelte:head>

{#if !graph}
	<p class="loading">Loading content…</p>
{:else}
	<div class="page">
		<nav class="types">
			{#each types as t (t)}
				<Chip active={t === selectedType} onclick={() => pick(t)}>
					{t.replace(/_/g, ' ')} <span class="count">{graph.list(t).length}</span>
				</Chip>
			{/each}
		</nav>

		<div class="controls">
			<details class="disclosure" bind:open={groupOpen}>
				<summary>Group · <b>{groupLabel}</b></summary>
				<div class="dropdown-menu">
					{#each groupings as g (g.key)}
						<button
							class="dropdown-option"
							class:on={groupBy === g.key}
							onclick={() => {
								groupBy = g.key;
								groupOpen = false;
							}}>{g.label}</button
						>
					{/each}
				</div>
			</details>

			{#if sources.length > 1 || facetValues.length}
				<details class="disclosure">
					<summary>Filter{activeFilters ? ` · ${activeFilters}` : ''}</summary>
					<div class="dropdown-menu wide">
						{#if sources.length > 1}
							<div class="dropdown-section">Source</div>
							<div class="ddchips">
								{#each sources as s (s)}
									<Chip
										active={sourceFilter.has(s)}
										onclick={() => (sourceFilter = toggle(sourceFilter, s))}>{sourceLabel(s)}</Chip
									>
								{/each}
							</div>
						{/if}
						{#if facet && facetValues.length}
							<div class="dropdown-section">{facet.label}</div>
							<div class="ddchips scroll">
								{#each facetValues as v (v)}
									<Chip
										active={facetFilter.has(v)}
										onclick={() => (facetFilter = toggle(facetFilter, v))}>{v}</Chip
									>
								{/each}
							</div>
						{/if}
						{#if activeFilters}
							<button
								class="ddclear"
								onclick={() => {
									sourceFilter = new Set();
									facetFilter = new Set();
								}}>Clear filters</button
							>
						{/if}
					</div>
				</details>
			{/if}

			<details class="mode-picker" bind:open={pickerOpen}>
				<summary>✎ Edit compendium</summary>
				<!-- One entry for all content-authoring modes; each opens the same 2-pane structure.
				     Translate is live; Editor (edit every field in place) is still WIP. -->
				<div class="mode-menu">
					<button
						class="mode-item"
						onclick={() => {
							pickerOpen = false;
							goto(`${base}/translate`);
						}}
					>
						<b>Translate</b><small>side-by-side prose translation</small>
					</button>
					<button
						class="mode-item"
						onclick={() => {
							pickerOpen = false;
							adding = true;
						}}
					>
						<b>Add</b><small>author a new {selectedType.replace(/_/g, ' ')}</small>
					</button>
					<button class="mode-item wip" disabled>
						<b>Editor</b><small>edit all fields <span class="wip-tag">WIP</span></small>
					</button>
				</div>
			</details>
		</div>

		<div class="two-column">
			<EntryList
				{groups}
				bind:searchValue={query}
				{showEdition}
				searchPlaceholder="Search {selectedType.replace(/_/g, ' ')}…"
				selectedId={selected?.effectiveId ?? null}
				onselect={(e) => openEntry(e.row)}
			/>
			{#if adding}
				{#key selectedType}
					<EditContentForm type={selectedType} onsave={onSaved} oncancel={() => (adding = false)} />
				{/key}
			{:else}
				<WikiDetail {detail} />
			{/if}
		</div>
	</div>
{/if}

<style>
	.types {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		/* no page title — pull the type tabs up under the nav for max content room */
		margin: calc(-1 * var(--space-3)) 0 12px;
	}
	.types .count {
		opacity: 0.55;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.disclosure {
		position: relative;
	}
	.disclosure summary {
		list-style: none;
		cursor: pointer;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 5px 11px;
	}
	.disclosure summary::-webkit-details-marker {
		display: none;
	}
	.disclosure summary:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
	.disclosure summary b {
		color: var(--color-text);
	}
	.disclosure[open] summary {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
	.dropdown-menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 5px);
		left: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 10px;
		padding: 6px;
		box-shadow: var(--shadow-2);
		min-width: 160px;
	}
	.dropdown-menu.wide {
		width: max(320px, 100%);
		max-width: 460px;
	}
	.dropdown-option {
		display: block;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 0;
		color: var(--color-text);
		font: inherit;
		padding: 6px 9px;
		border-radius: 6px;
		cursor: pointer;
	}
	.dropdown-option:hover {
		background: var(--color-surface-2);
	}
	.dropdown-option.on {
		color: var(--color-accent-bright);
	}
	.dropdown-section {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 6px 4px 5px;
	}
	.ddchips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		padding: 0 4px;
	}
	.ddchips.scroll {
		max-height: 168px;
		overflow: auto;
	}
	.ddclear {
		margin: 8px 4px 2px;
		background: transparent;
		border: 0;
		color: var(--color-accent-bright);
		font-family: var(--font-mono);
		font-size: 11px;
		cursor: pointer;
	}
	.mode-picker {
		margin-left: auto;
		position: relative;
	}
	.mode-picker > summary {
		list-style: none;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		color: var(--color-accent-bright);
		background: var(--color-accent-soft);
		border: 1px solid var(--color-accent);
		border-radius: 7px;
		padding: 5px 12px;
		cursor: pointer;
	}
	.mode-picker > summary::-webkit-details-marker {
		display: none;
	}
	.mode-picker[open] > summary {
		background: var(--color-accent);
		color: #fff;
	}
	.mode-menu {
		position: absolute;
		right: 0;
		z-index: 20;
		margin-top: 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 230px;
		padding: 6px;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 10px;
		box-shadow: 0 10px 30px rgb(0 0 0 / 40%);
	}
	.mode-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		text-align: left;
		padding: 8px 11px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}
	.mode-item:hover:not(:disabled) {
		background: var(--color-surface-2);
	}
	.mode-item b {
		font-family: var(--font-display);
		font-size: 14px;
	}
	.mode-item small {
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.mode-item.wip {
		opacity: 0.5;
		cursor: default;
	}
	.wip-tag {
		font-family: var(--font-mono);
		font-size: 8px;
		letter-spacing: 0.1em;
		border: 1px solid var(--color-border-strong);
		border-radius: 20px;
		padding: 0 5px;
		margin-left: 4px;
		color: var(--color-resource);
	}
	.page {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.two-column {
		display: grid;
		grid-template-columns: minmax(240px, 300px) 1fr;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		/* fills the remaining page height; each pane scrolls internally (min-height:0) */
		flex: 1;
		min-height: 0;
	}
	@media (max-width: 700px) {
		.two-column {
			grid-template-columns: 1fr;
			min-height: 480px;
		}
	}
</style>

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
	import DraftsPane from '$lib/components/DraftsPane.svelte';
	import OrphanDialog from '$lib/components/OrphanDialog.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { getUserStorage } from '$lib/storage/provider';
	import { findOrphanDrafts, type DraftEnvelope } from '$lib/drafts/store';
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
	let adding = $state(false); // right pane shows the homebrew authoring form (new entry)
	let editRow = $state<LoadedRow | null>(null); // right pane edits THIS existing row (editor mode)
	let showDrafts = $state(false); // right pane shows the pending-drafts list
	let pickerOpen = $state(false); // the "Edit compendium" mode menu (translate / editor / add)
	// resuming a pending add-draft: the form is handed the GUID + saved fields to restore
	let resumeAdd = $state<{ guid: string; data: Record<string, string> } | undefined>(undefined);
	// orphan reassign: a non-empty queue shows the step-through dialog (starting at `orphanStart`)
	let orphanQueue = $state<DraftEnvelope[]>([]);
	let orphanStart = $state<DraftEnvelope | null>(null);

	onMount(async () => {
		await loadContentStore();
		if (!types.includes(selectedType)) selectedType = types[0] ?? selectedType;
		groupBy = groupingsFor(selectedType)[0]?.key ?? groupBy;
		void detectOrphans();
	});

	// on load, surface any draft whose target row is gone (deleted / renamed / source disabled) — the
	// only way an orphan is reachable, since auto-restore-on-open never fires for a vanished target.
	async function detectOrphans() {
		const g = graph;
		if (!g) return;
		const orphans = await findOrphanDrafts(getUserStorage(), (eid) => !!g.get(eid));
		if (orphans.length) openOrphans(orphans, orphans[0]);
	}
	function openOrphans(orphans: DraftEnvelope[], startAt: DraftEnvelope | undefined) {
		if (!startAt) return;
		orphanQueue = orphans;
		orphanStart = startAt;
	}
	function closeOrphans(resume?: DraftEnvelope) {
		orphanQueue = [];
		orphanStart = null;
		if (resume) resumeDraft(resume);
	}

	// route a resumed draft to the right editor: translate → /translate preselected; add → the edit form.
	function resumeDraft(env: DraftEnvelope) {
		const t = env.target;
		if (t.kind === 'translate') {
			const qs = new URLSearchParams({
				type: t.type,
				source: t.source,
				id: t.id,
				locale: t.locale
			});
			goto(`${base}/translate?${qs.toString()}`);
		} else if (t.kind === 'add') {
			resumeAdd = { guid: t.addGuid, data: env.data as Record<string, string> };
			selectedType = t.type;
			showDrafts = false;
			adding = true;
			editRow = null;
		} else if (t.kind === 'editor') {
			const row = graph?.get(`${t.type}:${t.source}:${t.id}`);
			if (row) openEditor(row);
		}
	}

	// open editor mode for a row (edit all its fields in place; a shipped row forks to homebrew on save)
	function openEditor(row: LoadedRow) {
		selectedType = row.type;
		showDrafts = false;
		adding = false;
		resumeAdd = undefined;
		editRow = row;
	}

	// deep-link: /compendium/<type>/<source>/<id> opens that entry (rest-param route served by
	// the 404.html SPA fallback). Source is in the path because a slug is unique only per TYPE,
	// not across editions/sources ("fireball" exists in both 5e and 5.5e) → type:source:id is
	// the unique effectiveId. Depends only on the URL param + graph (untrack the rest) so
	// clicking a type chip isn't reverted by this effect.
	const entryParam = $derived(page.params.entry ?? '');
	// clicking a row updates the URL so the current entry is shareable (no history spam)
	function openEntry(row: LoadedRow) {
		adding = false;
		editRow = null;
		showDrafts = false;
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
				name: String(graph?.get(e.classEffectiveId)?.data.name_en ?? e.classId),
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
		editRow = null;
		showDrafts = false;
		resumeAdd = undefined;
		query = '';
		groupBy = groupingsFor(type)[0]?.key ?? groupBy;
		sourceFilter = new Set();
		facetFilter = new Set();
	}

	// homebrew authoring: open a blank editable article for the current type; on save reload the
	// graph (so the new row is merged in) and open it.
	async function onSaved(id: string) {
		adding = false;
		editRow = null;
		resumeAdd = undefined;
		const g = await reloadContent(); // merge the new/edited homebrew row + rotate guid → lists recompute
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
				<!-- One entry for all content-authoring modes; each opens in the right pane. Editor edits
				     the currently-selected entry (a shipped row forks to homebrew on save). -->
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
							resumeAdd = undefined;
							showDrafts = false;
							adding = true;
						}}
					>
						<b>Add</b><small>author a new {selectedType.replace(/_/g, ' ')}</small>
					</button>
					<button
						class="mode-item"
						disabled={!selected}
						onclick={() => {
							pickerOpen = false;
							if (selected) openEditor(selected);
						}}
					>
						<b>Editor</b>
						<small>
							{selected ? `edit “${selected.data.name_en}” — all fields` : 'select an entry first'}
						</small>
					</button>
					<button
						class="mode-item"
						onclick={() => {
							pickerOpen = false;
							adding = false;
							editRow = null;
							showDrafts = true;
						}}
					>
						<b>Drafts</b><small>resume unfinished edits</small>
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
			{#if showDrafts && graph}
				<DraftsPane
					{graph}
					onResume={resumeDraft}
					onResolveOrphans={(orphans, startAt) => openOrphans(orphans, startAt)}
				/>
			{:else if editRow}
				{#key editRow.effectiveId}
					<EditContentForm
						type={editRow.type}
						editRow={editRow ?? undefined}
						onsave={onSaved}
						oncancel={() => (editRow = null)}
					/>
				{/key}
			{:else if adding}
				{#key resumeAdd?.guid ?? selectedType}
					<EditContentForm
						type={selectedType}
						onsave={onSaved}
						oncancel={() => {
							adding = false;
							resumeAdd = undefined;
						}}
						resumeGuid={resumeAdd?.guid}
						resumeDraft={resumeAdd?.data}
					/>
				{/key}
			{:else}
				<WikiDetail {detail} />
			{/if}
		</div>
	</div>

	{#if orphanQueue.length && orphanStart && graph}
		<OrphanDialog
			orphans={orphanQueue}
			startAt={orphanStart}
			{graph}
			onDone={(resume) => closeOrphans(resume)}
		/>
	{/if}
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
	.mode-item:disabled {
		opacity: 0.5;
		cursor: default;
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

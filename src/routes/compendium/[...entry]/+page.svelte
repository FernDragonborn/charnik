<script lang="ts">
	// Compendium — the same two-pane shape as the Spellbook (d-spellmgr), read-only: a grouped
	// list of every content row + the wiki detail from its CSV. Reuses EntryList + WikiDetail.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { content, loadContentStore, reloadContent } from '$lib/content/store.svelte';
	import type { LoadedRow } from '$lib/content/loader';
	import { hasProse, type ContentType } from '$lib/content/schemas';
	import {
		buildDetail,
		sourceLabel,
		compendiumEntryPath,
		toEntryGroups,
		localizedName,
	} from '$lib/content/detail';
	import { getSpellAccess } from '$lib/content/spellAccess';
	import {
		groupingsFor,
		facetFor,
		groupRows,
		distinctValues,
		byDisplayName,
	} from '$lib/content/grouping';
	import EntryList from '$lib/components/EntryList.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import Loading from '$lib/components/Loading.svelte';
	import LanguagePicker from '$lib/components/LanguagePicker.svelte';
	import EditContentForm from '$lib/components/EditContentForm.svelte';
	import LinkedRows from '$lib/components/LinkedRows.svelte';
	import DraftsPane from '$lib/components/DraftsPane.svelte';
	import OrphanDialog from '$lib/components/OrphanDialog.svelte';
	import SchemaDiscardDialog from '$lib/components/SchemaDiscardDialog.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { getUserStorage } from '$lib/storage/provider';
	import { removeHomebrewRow, rowToDraft, HOMEBREW_SOURCE } from '$lib/content/homebrew';
	import {
		findOrphanDrafts,
		findStaleDrafts,
		findUnreadableDrafts,
		discardDrafts,
		deleteDraftFiles,
		writeDraft,
		type DraftEnvelope,
	} from '$lib/drafts/store';
	import { isRowActive } from '$lib/content/sources.svelte';
	import { app, inActiveEdition } from '$lib/stores/app.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { readStored, writeStored } from '$lib/util/persist';

	const inEdition = (r: LoadedRow) => inActiveEdition(r.systems);
	const showEdition = $derived(app.activeEditions.length > 1);

	// shared reactive store → a live content refresh re-renders every derived list below, no reload
	const graph = $derived(content.graph);
	// Every type that carries a NAME, which is one more than the article types: `resource` and
	// `resource_option` are data tables rather than articles, but authoring one is only possible where
	// its rows are listed, and "everything is doable from the UI" is a shipped invariant. Translate
	// already lists exactly this set. The pure lookup tables (slot matrices, join rows) have no name
	// to show and stay out. Search is still article-only, so the palette does not surface a spend row.
	const types = $derived(graph ? [...graph.byType.keys()].filter(hasProse).sort() : []);

	// CONTENT language — independent of the app UI language: a picker over the locales that actually
	// exist in the CSVs (graph.locales). Persisted; defaults to the UI locale on first run, then sticks.
	const LOCALE_KEY = 'charnik:compendium-locale';
	let contentLocale = $state(readStored<string>(LOCALE_KEY) ?? app.activeLocale);
	const contentLocales = $derived(graph?.locales ?? ['en']);
	$effect(() => writeStored(LOCALE_KEY, contentLocale));
	// localized display name for a row (the chosen content locale, English fallback)
	const localName = (r: LoadedRow) => localizedName(r, contentLocale);
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
	// drafts from an older content schema that can't be migrated → warn before discarding
	let staleDrafts = $state<DraftEnvelope[]>([]);
	/** Draft files that no longer parse — surfaced through the SAME dialog as the stale ones. */
	let unreadableDrafts = $state<string[]>([]);

	onMount(async () => {
		await loadContentStore();
		if (!types.includes(selectedType)) selectedType = types[0] ?? selectedType;
		groupBy = groupingsFor(selectedType)[0]?.key ?? groupBy;
		void detectStaleDrafts();
		void detectOrphans();
	});

	// on load, warn if any cached draft was saved under a different content schema (it will be dropped —
	// surface it so the user's unsaved work doesn't vanish silently).
	async function detectStaleDrafts() {
		const storage = getUserStorage();
		staleDrafts = await findStaleDrafts(storage);
		// a damaged file is the same news to the user as an unmigratable one: unfinished work that
		// cannot come back. It used to be skipped in silence (NULL-1).
		unreadableDrafts = await findUnreadableDrafts(storage);
	}
	async function discardStale() {
		const storage = getUserStorage();
		await discardDrafts(storage, staleDrafts);
		await deleteDraftFiles(storage, unreadableDrafts);
		staleDrafts = [];
		unreadableDrafts = [];
	}

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
				locale: t.locale,
			});
			void goto(`${base}/translate?${qs.toString()}`);
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
		void goto(compendiumEntryPath(base, row.type, row.source, row.data.id), {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
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
	// browse pool = rows of the type, in an active edition, AND active per the Settings source/collision
	// config (two-dimensional filtering + collision resolution; live via the reactive sourceConfig).
	const pool = $derived(
		graph
			? graph
					.list(selectedType)
					.filter(inEdition)
					.filter((r) => isRowActive(r))
			: [],
	);
	const groupings = $derived(groupingsFor(selectedType));
	const facet = $derived(facetFor(selectedType));
	const sources = $derived([...new Set(pool.map((r) => r.source))].sort());
	const facetValues = $derived(facet ? distinctValues(pool, facet.key) : []);

	const rows = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return pool
			.filter((r) => {
				if (sourceFilter.size && !sourceFilter.has(r.source)) return false;
				if (facet && facetFilter.size) {
					// facet.key is a runtime config string; scan entries to read the cell off the union (no cast)
					const v = Object.entries(r.data).find(([k]) => k === facet.key)?.[1];
					if (!facetFilter.has(v == null ? '' : String(v))) return false;
				}
				return !q || localName(r).toLowerCase().includes(q);
			})
			.sort(byDisplayName(localName, contentLocale));
	});

	const groups = $derived(
		toEntryGroups(groupRows(rows.slice(0, 500), groupBy, selectedType, $_), localName, $_),
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
				homebrew: e.via === 'spell_list',
			}))
			.filter((x) => (seen.has(x.name) ? false : seen.add(x.name)));
	});
	const detail = $derived(
		selected ? buildDetail(selected, selectedType, availableTo, contentLocale) : null,
	);
	// editor mode = a two-panel BEFORE | AFTER: the current rendered article (read-only) beside the
	// editable form, so you see the original next to your changes.
	const editorBefore = $derived(
		editRow ? buildDetail(editRow, editRow.type, undefined, contentLocale) : null,
	);
	// the editor is a 3-column view — ask the shell for the full viewport width (like translate);
	// cleared when editing ends or the page unmounts.
	$effect(() => {
		ui.fullBleed = !!editRow;
		return () => {
			ui.fullBleed = false;
		};
	});

	// homebrew rows (the user's own) can be deleted or pulled back into a draft; shipped rows can't.
	const isHomebrew = (r: LoadedRow | null) => r?.source === HOMEBREW_SOURCE;
	let confirmDelete = $state<LoadedRow | null>(null); // non-null → the delete-confirm dialog is open

	// remove the row from its homebrew CSV, reload, and clear the view. (A fork coexists with the
	// shipped original — sort, not hide — so deleting it doesn't affect the original.)
	async function deleteRow(row: LoadedRow) {
		await removeHomebrewRow(getUserStorage(), row.type, `${row.root}/${row.file}`, row.id);
		confirmDelete = null;
		selected = null;
		editRow = null;
		await reloadContent();
	}

	// "not ready yet" → move the homebrew row back to an unfinished DRAFT (a new add-draft seeded from
	// it) and remove it from the compendium, so it can be finished + re-saved later from Drafts.
	async function convertToDraft(row: LoadedRow) {
		const storage = getUserStorage();
		await writeDraft(
			storage,
			{ kind: 'add', type: row.type, addGuid: crypto.randomUUID() },
			rowToDraft(row),
		);
		await removeHomebrewRow(storage, row.type, `${row.root}/${row.file}`, row.id);
		selected = null;
		editRow = null;
		await reloadContent();
		showDrafts = true; // land in the drafts list so the user sees where it went
	}

	// in any authoring mode (editor / add / drafts), the "Edit compendium" picker becomes a single
	// "back to compendium" action that returns to plain browsing.
	const inMode = $derived(!!editRow || adding || showDrafts);
	function exitMode() {
		editRow = null;
		adding = false;
		showDrafts = false;
		resumeAdd = undefined;
	}
	const groupLabel = $derived(groupings.find((g) => g.key === groupBy)?.labelKey ?? '');
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
	async function onSaved(id: string, savedType: ContentType) {
		adding = false;
		editRow = null;
		resumeAdd = undefined;
		const g = await reloadContent(); // merge the new/edited homebrew row + rotate guid → lists recompute
		if (!g) return; // load failed — the error surfaces via the content store
		// the TYPE the form saved, not `selectedType`: the deep-link effect re-runs on the new graph
		// and restores the browsed entry's type, so the picker's type can have moved on by now
		const row = g.get(`${savedType}:Homebrew:${id}`);
		if (row) openEntry(row);
	}
	// HOMEBREW-LINKED: author a row of the linked table the article being read owns (a subclass's
	// features, a species' lineages). The join columns are ids nobody can guess, so the form opens
	// with them filled — without this a homebrew subclass is a row that can never be given a feature.
	function addLinkedRow(type: ContentType, prefill: Record<string, string>) {
		pick(type);
		resumeAdd = { guid: crypto.randomUUID(), data: prefill };
		adding = true;
	}

	function toggle(set: Set<string>, v: string) {
		const next = new Set(set);
		if (next.has(v)) next.delete(v);
		else next.add(v);
		return next;
	}

	// close an open <details> dropdown when the user clicks/taps anywhere outside it (native <details>
	// stays open otherwise). Capture-phase so it fires before inner handlers.
	function autoClose(node: HTMLDetailsElement) {
		const onDown = (e: Event) => {
			if (node.open && !node.contains(e.target as Node)) node.open = false;
		};
		document.addEventListener('pointerdown', onDown, true);
		return { destroy: () => document.removeEventListener('pointerdown', onDown, true) };
	}
</script>

<svelte:head><title>{$_('nav.compendium')} — Charnik</title></svelte:head>

{#if !graph}
	<Loading message={$_('compendium.loading')} error={content.error} />
{:else if types.length === 0}
	<div class="loading empty-content">
		<h2>{$_('compendium.emptyTitle')}</h2>
		<p>{$_('compendium.emptyBody')}</p>
		<!-- the section's name is bold, so it stays its own element rather than markup inside a key -->
		<p class="muted">
			{$_('compendium.emptyWhere')} <b>{$_('compendium.settingsData')}</b>.
		</p>
	</div>
{:else}
	<div class="page">
		<nav class="types">
			{#each types as t (t)}
				<Chip active={t === selectedType} onclick={() => pick(t)}>
					{$_(`contentType.${t}`, { default: t.replace(/_/g, ' ') })}
					<span class="count">{graph.list(t).length}</span>
				</Chip>
			{/each}
		</nav>

		<div class="controls">
			<details class="disclosure" bind:open={groupOpen} use:autoClose>
				<summary class="pill-btn"
					>{$_('compendium.grouping')} · <b>{groupLabel ? $_(groupLabel) : ''}</b></summary
				>
				<div class="dropdown-menu">
					{#each groupings as g (g.key)}
						<button
							class="dropdown-option"
							class:on={groupBy === g.key}
							onclick={() => {
								groupBy = g.key;
								groupOpen = false;
							}}>{$_(g.labelKey)}</button
						>
					{/each}
				</div>
			</details>

			{#if sources.length > 1 || facetValues.length}
				<details class="disclosure" use:autoClose>
					<summary class="pill-btn"
						>{$_('compendium.filter')}{activeFilters ? ` · ${activeFilters}` : ''}</summary
					>
					<div class="dropdown-menu wide">
						{#if sources.length > 1}
							<div class="dropdown-section eyebrow">{$_('contentField.source')}</div>
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
							<div class="dropdown-section eyebrow">{$_(facet.labelKey)}</div>
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
								}}>{$_('compendium.clearFilters')}</button
							>
						{/if}
					</div>
				</details>
			{/if}

			{#if contentLocales.length > 1}
				<label class="lang-control">
					<span class="lang-label eyebrow">{$_('settings.language')}</span>
					<LanguagePicker bind:value={contentLocale} locales={contentLocales} />
				</label>
			{/if}

			{#if inMode}
				<button class="back-to-browse pill-btn accent" onclick={exitMode}
					><Icon name="arrow-left" size={13} /> {$_('compendium.backToBrowse')}</button
				>
			{:else}
				<details class="mode-picker" bind:open={pickerOpen} use:autoClose>
					<summary class="pill-btn accent"
						><Icon name="pencil" size={13} /> {$_('compendium.editMode')}</summary
					>
					<!-- One entry for all content-authoring modes; each opens in the right pane. Editor edits
				     the currently-selected entry (a shipped row forks to homebrew on save). -->
					<div class="mode-menu">
						<button
							class="mode-item"
							onclick={() => {
								pickerOpen = false;
								void goto(`${base}/translate`);
							}}
						>
							<b>{$_('compendium.modeTranslate')}</b><small
								>{$_('compendium.modeTranslateHint')}</small
							>
						</button>
						<button
							class="mode-item"
							onclick={() => {
								pickerOpen = false;
								resumeAdd = undefined;
								editRow = null;
								showDrafts = false;
								adding = true;
							}}
						>
							<b>{$_('compendium.modeAdd')}</b><small
								>{$_('compendium.modeAddHint', {
									values: {
										type: $_(`contentType.${selectedType}`, {
											default: selectedType.replace(/_/g, ' '),
										}),
									},
								})}</small
							>
						</button>
						<button
							class="mode-item"
							disabled={!selected}
							onclick={() => {
								pickerOpen = false;
								if (selected) openEditor(selected);
							}}
						>
							<b>{$_('compendium.modeEditor')}</b>
							<small>
								{selected
									? $_('compendium.modeEditorHint', {
											values: { name: String(selected.data.name_en) },
										})
									: $_('compendium.modeEditorEmpty')}
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
							<b>{$_('compendium.modeDrafts')}</b><small>{$_('compendium.modeDraftsHint')}</small>
						</button>
					</div>
				</details>
			{/if}
		</div>

		<div class="two-column">
			<EntryList
				{groups}
				bind:searchValue={query}
				{showEdition}
				searchPlaceholder={$_('compendium.searchType', {
					values: { type: $_(`contentType.${selectedType}`) },
				})}
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
					<div class="editor-2pane">
						<div class="epane before">
							<div class="epane-label eyebrow">{$_('compendium.paneCurrent')}</div>
							<WikiDetail detail={editorBefore} />
						</div>
						<div class="epane after">
							<div class="epane-label eyebrow edit">{$_('compendium.paneEdit')}</div>
							<EditContentForm
								type={editRow.type}
								editRow={editRow ?? undefined}
								onsave={onSaved}
								oncancel={() => (editRow = null)}
								ondelete={() => (confirmDelete = editRow)}
							/>
						</div>
					</div>
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
				<WikiDetail {detail}>
					{#snippet footer()}
						{#if graph && selected}
							<LinkedRows
								parent={selected}
								{graph}
								locale={contentLocale}
								onopen={openEntry}
								onadd={addLinkedRow}
							/>
						{/if}
						{#if isHomebrew(selected)}
							<!-- your own row: manage it from the bottom of its article -->
							<div class="homebrew-actions">
								<button class="hb-btn" onclick={() => selected && convertToDraft(selected)}>
									{$_('compendium.moveToDrafts')}
								</button>
								<button class="hb-btn danger" onclick={() => (confirmDelete = selected)}>
									{$_('compendium.deleteEntry')}
								</button>
							</div>
						{/if}
					{/snippet}
				</WikiDetail>
			{/if}
		</div>
	</div>

	{#if confirmDelete}
		<ConfirmDialog
			title={$_('compendium.deleteTitle', {
				values: { name: String(confirmDelete.data.name_en) },
			})}
			message={$_('compendium.deleteBody')}
			confirmLabel={$_('compendium.deleteConfirm')}
			danger
			onConfirm={() => confirmDelete && deleteRow(confirmDelete)}
			onCancel={() => (confirmDelete = null)}
		/>
	{/if}

	{#if staleDrafts.length || unreadableDrafts.length}
		<SchemaDiscardDialog
			drafts={staleDrafts}
			unreadable={unreadableDrafts}
			onDiscard={discardStale}
			onKeep={() => {
				staleDrafts = [];
				unreadableDrafts = [];
			}}
		/>
	{/if}

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
	/* reuses the global .loading (centred + muted + padding); only adds the heading + width cap */
	.empty-content {
		max-width: 560px;
		margin-inline: auto;
	}
	.empty-content h2 {
		font-family: var(--font-display);
		font-size: var(--font-size-h5);
		color: var(--color-text);
		margin: 0 0 var(--space-3);
	}
	.types {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
		/* no page title — pull the type tabs up under the nav for max content room */
		margin: calc(-1 * var(--space-3)) 0 var(--space-3);
	}
	.types .count {
		opacity: 0.55;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.disclosure {
		position: relative;
	}
	/* summaries carry .pill-btn for the shared pill look; only the summary-specific marker removal and
	   open-state accent stay local */
	.disclosure summary {
		list-style: none;
	}
	.disclosure summary::-webkit-details-marker {
		display: none;
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
		inset-inline-start: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		padding: var(--space-1-5);
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
		text-align: start;
		background: transparent;
		border: 0;
		color: var(--color-text);
		font: inherit;
		padding: var(--space-1-5) var(--space-2);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.dropdown-option:hover {
		background: var(--color-surface-2);
	}
	.dropdown-option.on {
		color: var(--color-accent-bright);
	}
	.dropdown-section {
		font-size: var(--font-size-micro);
		margin: var(--space-1-5) var(--space-1) var(--space-1);
	}
	.ddchips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		padding: 0 var(--space-1);
	}
	.ddchips.scroll {
		max-height: 168px;
		overflow: auto;
	}
	/* On a narrow window a 320px menu opened by a button that sits half-way across the row runs off the
	   right edge. Anchoring to the controls ROW instead of to the button drops it straight down the
	   width of the row, which is the only width guaranteed to fit. */
	@media (max-width: 800px) {
		.controls {
			position: relative;
		}
		.disclosure {
			position: static;
		}
		.dropdown-menu.wide {
			width: auto;
			inset-inline: 0;
		}
	}
	.ddclear {
		margin: var(--space-2) var(--space-1) 2px;
		background: transparent;
		border: 0;
		color: var(--color-accent-bright);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		cursor: pointer;
	}
	.homebrew-actions {
		display: flex;
		gap: var(--space-2-5);
		margin-top: 22px;
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.lang-control {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-inline-start: auto;
	}
	.lang-label {
		font-size: var(--font-size-micro);
	}
	/* both the back button and mode-picker summary use .pill-btn.accent for the crimson look; only
	   their right-alignment / marker-removal / open-state stay local */
	.back-to-browse {
		margin-inline-start: auto;
	}
	.mode-picker {
		margin-inline-start: auto;
		position: relative;
	}
	.mode-picker > summary {
		list-style: none;
	}
	.mode-picker > summary::-webkit-details-marker {
		display: none;
	}
	.mode-picker[open] > summary {
		background: var(--color-accent);
		color: var(--color-accent-text);
	}
	.mode-menu {
		position: absolute;
		inset-inline-end: 0;
		z-index: 20;
		margin-top: var(--space-1-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 230px;
		padding: var(--space-1-5);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-2);
	}
	.mode-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		text-align: start;
		padding: var(--space-2) var(--space-2-5);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}
	.mode-item:hover:not(:disabled) {
		background: var(--color-surface-2);
	}
	.mode-item b {
		font-family: var(--font-display);
		font-size: var(--font-size-body);
	}
	.mode-item small {
		font-size: var(--font-size-xs);
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
	/* editor mode = BEFORE | AFTER inside the content cell (each panel scrolls independently) */
	.editor-2pane {
		display: grid;
		grid-template-columns: 1fr 1fr;
		min-height: 0;
		overflow: hidden;
	}
	.epane {
		overflow: auto;
		min-height: 0;
		padding: var(--space-4) 18px;
	}
	.epane.before {
		border-inline-end: 1px solid var(--color-border);
	}
	.epane-label {
		font-size: var(--font-size-micro);
		margin-bottom: var(--space-2-5);
	}
	.epane-label.edit {
		color: var(--color-accent-bright);
	}
	@media (max-width: 900px) {
		.editor-2pane {
			grid-template-columns: 1fr;
		}
		.epane.before {
			border-inline-end: 0;
			border-bottom: 1px solid var(--color-border);
		}
	}
</style>

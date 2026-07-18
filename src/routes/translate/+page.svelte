<script lang="ts">
	// Translate mode — a compendium sub-mode: pick an entry, see the SOURCE-locale article (read-only
	// WikiDetail, exactly as the compendium renders it) on the left, edit the TARGET-locale prose on
	// the right (the SAME WikiDetail in `editable` mode, so a layout change hits both panes). FROM/TO
	// locales are chosen freely via two dropdowns above the panes + persisted across re-entries. Saves
	// write the localized columns into the row's own CSV + re-stamp its hash (see content/translate.ts).
	// Reuses EntryList + WikiDetail + the shared list helpers — only the shell is new.
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { content, loadContentStore, reloadContent } from '$lib/content/store.svelte';
	import { getUserStorage } from '$lib/storage/provider';
	import { isBrowsable, type ContentType } from '$lib/content/schemas';
	import { buildDetail, entryMeta, editionLabel, type Entry } from '$lib/content/detail';
	import { groupingsFor, groupRows } from '$lib/content/grouping';
	import { saveTranslation, saveLocStatus, locStatus } from '$lib/content/translate';
	import { LOC_STATUS, LOC_STATUS_ORDER, type LocStatus } from '$lib/content/schemas';
	import type { LoadedRow } from '$lib/content/loader';
	import EntryList from '$lib/components/EntryList.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import LanguagePicker from '$lib/components/LanguagePicker.svelte';
	import type { WikiEditDraft } from '$lib/components/wikiEdit';
	import { writeDraft, readDraft, deleteDraft, type DraftTarget } from '$lib/drafts/store';
	import { app, inActiveEdition } from '$lib/stores/app.svelte';
	import { isReadOnlyContent } from '$lib/config/demo';
	import { _ } from '$lib/i18n';

	// A demo build is read-only for content: browse + preview edits, but saving is blocked (the
	// shipped SRD isn't writable in the hosted demo). Not a bare platform gate — the real web build
	// writes; only a demo flag (never desktop) opts out.
	const demo = isReadOnlyContent();

	// persisted translate settings — the FROM/TO locales + type are restored when you re-enter the view.
	const TSTATE_KEY = 'charnik:translate';
	function loadTState(): { sourceLocale?: string; targetLocale?: string; selectedType?: string } {
		if (typeof localStorage === 'undefined') return {};
		try {
			return JSON.parse(localStorage.getItem(TSTATE_KEY) ?? '{}');
		} catch {
			return {};
		}
	}
	const savedT = loadTState();

	const graph = $derived(content.graph);
	// FROM (source) and TO (target) locales are freely chosen via the two dropdowns above the panes.
	let sourceLocale = $state(savedT.sourceLocale ?? 'en');
	let targetLocale = $state(
		savedT.targetLocale ?? (app.activeLocale === 'en' ? 'uk' : app.activeLocale)
	);
	const locales = $derived(graph?.locales ?? ['en']);
	const types = $derived(graph ? [...graph.byType.keys()].filter(isBrowsable).sort() : []);
	let selectedType = $state<ContentType>((savedT.selectedType as ContentType) ?? 'spell');
	let query = $state('');
	let selected = $state<LoadedRow | null>(null);
	let saving = $state(false);

	onMount(async () => {
		await loadContentStore();
		if (!types.includes(selectedType)) selectedType = types[0] ?? selectedType;
		resumeFromParams();
	});

	// persist the FROM/TO locales + type so re-entering the view restores them
	$effect(() => {
		const snapshot = { sourceLocale, targetLocale, selectedType };
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(TSTATE_KEY, JSON.stringify(snapshot));
		} catch {
			/* private mode / quota — settings just won't persist */
		}
	});

	// Resume a draft: /translate?type=&source=&id=&locale= (from the compendium Drafts list) preselects
	// that row + switches the target locale, so the reset effect prefills + restores its cached draft.
	function resumeFromParams() {
		const p = page.url.searchParams;
		const type = p.get('type');
		const source = p.get('source');
		const id = p.get('id');
		const locale = p.get('locale');
		if (!type || !source || !id || !content.graph) return;
		if (isBrowsable(type as ContentType)) selectedType = type as ContentType;
		if (locale) targetLocale = locale;
		selected = content.graph.get(`${type}:${source}:${id}`) ?? selected;
	}

	const inEdition = (r: LoadedRow) => inActiveEdition(r.systems);

	const pool = $derived(graph ? graph.list(selectedType).filter(inEdition) : []);
	const rows = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? pool.filter((r) => String(r.data.name_en).toLowerCase().includes(q)) : pool;
	});
	const groupBy = $derived(groupingsFor(selectedType)[0]?.key ?? '');
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
	// how many of the active pool are REVIEWED into the target locale (drives the header count)
	const reviewedCount = $derived(
		pool.filter((r) => locStatus(r.data, r.sourceLang, targetLocale) === LOC_STATUS.reviewed).length
	);

	// the two rendered models: English source (read-only) + target (editable draft binds to prose)
	const sourceDetail = $derived(
		selected ? buildDetail(selected, selectedType, undefined, sourceLocale) : null
	);
	const targetDetail = $derived(
		selected ? buildDetail(selected, selectedType, undefined, targetLocale) : null
	);

	// draft = the raw target-locale prose of the selected row; reset whenever the row or locale changes.
	// `baseline` is the draft as LOADED (from the row, or a restored cache) — the auto-save writes only
	// when the draft diverges from it, so merely VIEWING an entry never spawns a draft file.
	let draft = $state<WikiEditDraft>({ name: '', text: '' });
	let baseline = $state('');

	const translateTarget = (r: LoadedRow, loc: string): DraftTarget => ({
		kind: 'translate',
		type: r.type,
		source: r.source,
		id: r.id,
		locale: loc
	});

	$effect(() => {
		const r = selected;
		const loc = targetLocale;
		untrack(() => {
			const fromRow: WikiEditDraft = r
				? {
						name: String(r.data[`name_${loc}`] ?? ''),
						text: String(r.data[`text_${loc}`] ?? ''),
						material: String(r.data[`material_${loc}`] ?? ''),
						higher_level: String(r.data[`higher_level_${loc}`] ?? '')
					}
				: { name: '', text: '' };
			draft = fromRow;
			baseline = JSON.stringify(fromRow);
		});
		// then, async, restore a cached draft if one exists for this exact target (unless read-only)
		if (r && !demo) {
			void readDraft<Partial<WikiEditDraft>>(getUserStorage(), translateTarget(r, loc)).then(
				(env) => {
					if (!env || selected !== r || targetLocale !== loc) return; // selection moved on; ignore
					const d = env.data;
					const restored: WikiEditDraft = {
						name: String(d.name ?? ''),
						text: String(d.text ?? ''),
						material: String(d.material ?? ''),
						higher_level: String(d.higher_level ?? '')
					};
					draft = restored;
					baseline = JSON.stringify(restored); // a restored draft is the new clean baseline
				}
			);
		}
	});

	// auto-save the draft to disk (debounced) whenever it diverges from the loaded baseline
	let writeTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const current = JSON.stringify(draft);
		const r = selected;
		const loc = targetLocale;
		clearTimeout(writeTimer);
		if (demo || !r || current === baseline) return;
		const snapshot: WikiEditDraft = { ...draft };
		writeTimer = setTimeout(() => {
			void writeDraft(getUserStorage(), translateTarget(r, loc), snapshot);
		}, 600);
	});

	async function save() {
		if (!selected || saving) return;
		if (demo) {
			toast($_('demo.readonly'));
			return;
		}
		saving = true;
		try {
			const target = translateTarget(selected, targetLocale);
			await saveTranslation(getUserStorage(), selected, targetLocale, {
				name: draft.name,
				text: draft.text,
				...(draft.material !== undefined ? { material: draft.material } : {}),
				...(draft.higher_level !== undefined ? { higher_level: draft.higher_level } : {})
			});
			await deleteDraft(getUserStorage(), target); // saved → the cached draft is now redundant
			baseline = JSON.stringify(draft); // prevent the auto-save effect from re-spawning it
			await reloadContent();
			toast('Translation saved');
		} catch (e) {
			toast(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			saving = false;
		}
	}

	// list-marker glyph per tracked status. Extension recipe: a new LOC_STATUS member needs a glyph here
	// + a `translate.status.<x>` i18n key; colour comes from the `.loc-mark.<status>` class.
	const LOC_MARK: Record<LocStatus, string> = {
		[LOC_STATUS.notStarted]: '○',
		[LOC_STATUS.machine]: '⚙',
		[LOC_STATUS.started]: '◐',
		[LOC_STATUS.reviewed]: '✓'
	};

	// set the tracked status for the selected row + target locale, then reload + re-point `selected` at
	// the fresh row so the control highlight and the list marker reflect the new stored value.
	async function setStatus(status: LocStatus) {
		if (!selected || saving || demo) return;
		saving = true;
		try {
			await saveLocStatus(getUserStorage(), selected, targetLocale, status);
			await reloadContent();
			selected = content.graph?.get(selected.effectiveId) ?? selected;
		} catch (e) {
			toast(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Translate — Charnik</title></svelte:head>

{#if !graph}
	<p class="loading">Loading…</p>
{:else}
	<div class="page">
		<div class="subbar">
			<button class="pill-btn accent" onclick={() => goto(`${base}/compendium`)}>
				← Back to compendium
			</button>
			<span class="sep"></span>
			<select class="type-sel" bind:value={selectedType}>
				{#each types as t (t)}<option value={t}>{t}</option>{/each}
			</select>
			<span class="prog"><b>{reviewedCount}</b> / {pool.length} reviewed</span>
		</div>

		<div class="panes">
			<EntryList
				{groups}
				bind:searchValue={query}
				searchPlaceholder="Search…"
				selectedId={selected?.effectiveId ?? null}
				onselect={(e) => (selected = e.row)}
			>
				{#snippet leading(e)}
					{@const st = locStatus(e.row.data, e.row.sourceLang, targetLocale)}
					<span class="loc-mark {st}" title={$_(`translate.status.${st}`)}>{LOC_MARK[st]}</span>
				{/snippet}
			</EntryList>

			<div class="pane source">
				<div class="pane-head">
					<span class="panelabel">Translate from</span>
					<LanguagePicker bind:value={sourceLocale} {locales} />
				</div>
				<WikiDetail detail={sourceDetail} />
			</div>

			<div class="pane target">
				<div class="pane-head">
					<span class="panelabel target-label">Into</span>
					<LanguagePicker bind:value={targetLocale} {locales} allowAdd accent />
				</div>
				{#if targetLocale === sourceLocale}
					<p class="pick">
						The target language is the same as the source ({sourceLocale.toUpperCase()}). Pick a
						different language above to translate.
					</p>
				{:else if selected}
					{@const st = locStatus(selected.data, selected.sourceLang, targetLocale)}
					<div class="status-row">
						<span class="status-label">{$_('translate.status.label')}</span>
						<div class="status-seg" role="group" aria-label={$_('translate.status.label')}>
							{#each LOC_STATUS_ORDER as s (s)}
								<button
									class="status-opt {s}"
									class:cur={st === s}
									aria-pressed={st === s}
									disabled={saving || demo}
									onclick={() => setStatus(s)}
								>
									{$_(`translate.status.${s}`)}
								</button>
							{/each}
						</div>
					</div>
					<WikiDetail detail={targetDetail} editable={!demo} {draft} />
					<div class="save-row">
						{#if demo}
							<p class="demo-note">{$_('demo.readonly')}</p>
						{:else}
							<button class="save" onclick={save} disabled={saving}>
								{saving ? 'Saving…' : 'Save translation'}
							</button>
						{/if}
					</div>
				{:else}
					<p class="pick">Pick an entry to translate.</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.subbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 0 12px;
		flex-wrap: wrap;
	}
	.tlabel {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.pane-head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	.pane-head .panelabel {
		margin-bottom: 0;
	}
	.sep {
		width: 1px;
		height: 20px;
		background: var(--color-border);
	}
	.type-sel {
		font-family: var(--font-body);
		font-size: 13px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 5px 10px;
		color: var(--color-text);
	}
	.prog {
		margin-left: auto;
		font-size: 12px;
		color: var(--color-text-muted);
	}
	.prog b {
		color: var(--color-good);
	}
	.page {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.panes {
		display: grid;
		grid-template-columns: minmax(240px, 320px) 1fr 1fr;
		grid-template-rows: minmax(0, 1fr); /* single row fills the page → each column scrolls itself */
		gap: 12px;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.pane {
		border-left: 1px solid var(--color-border);
		padding-left: 14px;
		overflow: auto; /* source / target scroll independently of the list */
		min-height: 0;
	}
	.panelabel {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 10px;
	}
	.panelabel.target-label {
		color: var(--color-accent-bright);
	}
	.loc-mark {
		width: 15px;
		text-align: center;
		font-size: 12px;
	}
	.loc-mark.not_started {
		color: var(--color-text-muted);
	}
	.loc-mark.machine {
		color: var(--color-accent-bright);
	}
	.loc-mark.started {
		color: var(--color-resource);
	}
	.loc-mark.reviewed {
		color: var(--color-good);
	}
	.status-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 14px;
	}
	.status-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.status-seg {
		display: inline-flex;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		overflow: hidden;
	}
	.status-opt {
		font-family: var(--font-body);
		font-size: 12px;
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		border: 0;
		border-left: 1px solid var(--color-border);
		padding: 6px 12px;
		cursor: pointer;
	}
	.status-opt:first-child {
		border-left: 0;
	}
	.status-opt:hover:not(:disabled) {
		color: var(--color-text);
		background: var(--color-surface);
	}
	.status-opt.cur {
		color: var(--color-text);
		font-weight: 600;
		background: var(--color-surface);
	}
	.status-opt.cur.machine {
		color: var(--color-accent-bright);
	}
	.status-opt.cur.started {
		color: var(--color-resource);
	}
	.status-opt.cur.reviewed {
		color: var(--color-good);
	}
	.status-opt:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.save-row {
		margin-top: 14px;
	}
	.save {
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 14px;
		border-radius: 8px;
		padding: 9px 18px;
		border: 1px solid var(--color-accent-deep);
		background: var(--color-accent-deep);
		color: #fff;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.demo-note {
		font-size: 13px;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 10px 12px;
		margin: 0;
	}
	.pick,
	.loading {
		color: var(--color-text-muted);
		padding: 20px 0;
	}
</style>

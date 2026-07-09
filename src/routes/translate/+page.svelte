<script lang="ts">
	// Translate mode — a compendium sub-mode: pick an entry, see the English SOURCE (read-only
	// WikiDetail, exactly as the compendium renders it) on the left, edit the TARGET-locale prose on
	// the right (the SAME WikiDetail in `editable` mode, so a layout change hits both panes). Target
	// locale = the app's active locale (switch it in the topbar). Saves write the localized columns
	// into the row's own CSV + re-stamp its hash (see content/translate.ts). Reuses EntryList +
	// WikiDetail + the shared list helpers — only the shell is new.
	import { onMount, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { content, loadContentStore, reloadContent } from '$lib/content/store.svelte';
	import { getUserStorage } from '$lib/storage/provider';
	import { isBrowsable, type ContentType } from '$lib/content/schemas';
	import { buildDetail, entryMeta, editionLabel, type Entry } from '$lib/content/detail';
	import { groupingsFor, groupRows } from '$lib/content/grouping';
	import { saveTranslation, translationStatus } from '$lib/content/translate';
	import type { LoadedRow } from '$lib/content/loader';
	import EntryList from '$lib/components/EntryList.svelte';
	import WikiDetail, { type WikiEditDraft } from '$lib/components/WikiDetail.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { isReadOnlyContent } from '$lib/config/demo';
	import { _ } from '$lib/i18n';

	const SOURCE_LOCALE = 'en'; // fixed for now; a "translate from" picker comes later
	// A demo build is read-only for content: browse + preview edits, but saving is blocked (the
	// shipped SRD isn't writable in the hosted demo). Not a bare platform gate — the real web build
	// writes; only a demo flag (never desktop) opts out.
	const demo = isReadOnlyContent();

	const graph = $derived(content.graph);
	const targetLocale = $derived(app.activeLocale);
	const types = $derived(graph ? [...graph.byType.keys()].filter(isBrowsable).sort() : []);
	let selectedType = $state<ContentType>('spell');
	let query = $state('');
	let selected = $state<LoadedRow | null>(null);
	let saving = $state(false);

	onMount(async () => {
		await loadContentStore();
		if (!types.includes(selectedType)) selectedType = types[0] ?? selectedType;
	});

	const inEdition = (r: LoadedRow) =>
		r.systems.some((s) => app.activeEditions.includes(s as (typeof app.activeEditions)[number]));

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
				meta: entryMeta(r, selectedType),
				edition: editionLabel(r.systems),
				row: r
			}))
		}))
	);
	// coverage of the whole active pool into the target locale (drives the header count)
	const doneCount = $derived(
		pool.filter((r) => translationStatus(r.data, targetLocale) === 'done').length
	);

	// the two rendered models: English source (read-only) + target (editable draft binds to prose)
	const sourceDetail = $derived(
		selected ? buildDetail(selected, selectedType, undefined, SOURCE_LOCALE) : null
	);
	const targetDetail = $derived(
		selected ? buildDetail(selected, selectedType, undefined, targetLocale) : null
	);

	// draft = the raw target-locale prose of the selected row; reset whenever the row or locale changes
	let draft = $state<WikiEditDraft>({ name: '', text: '' });
	$effect(() => {
		const r = selected;
		const loc = targetLocale;
		untrack(() => {
			draft = r
				? {
						name: String(r.data[`name_${loc}`] ?? ''),
						text: String(r.data[`text_${loc}`] ?? ''),
						material: String(r.data[`material_${loc}`] ?? ''),
						higher_level: String(r.data[`higher_level_${loc}`] ?? '')
					}
				: { name: '', text: '' };
		});
	});

	async function save() {
		if (!selected || saving) return;
		if (demo) {
			toast($_('demo.readonly'));
			return;
		}
		saving = true;
		try {
			await saveTranslation(getUserStorage(), selected, targetLocale, {
				name: draft.name,
				text: draft.text,
				...(draft.material !== undefined ? { material: draft.material } : {}),
				...(draft.higher_level !== undefined ? { higher_level: draft.higher_level } : {})
			});
			await reloadContent();
			toast('Translation saved');
		} catch (e) {
			toast(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			saving = false;
		}
	}

	const MARK = { none: '○', partial: '~', done: '✓' } as const;
</script>

<svelte:head><title>Translate — Charnik</title></svelte:head>

{#if !graph}
	<p class="loading">Loading…</p>
{:else}
	<div class="page">
		<div class="subbar">
			<span class="tlabel">Target</span>
			<span class="tlang">{targetLocale.toUpperCase()}</span>
			<span class="sep"></span>
			<select class="type-sel" bind:value={selectedType}>
				{#each types as t (t)}<option value={t}>{t}</option>{/each}
			</select>
			<span class="prog"><b>{doneCount}</b> / {pool.length} translated</span>
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
					{@const st = translationStatus(e.row.data, targetLocale)}
					<span class="mark {st}" title={st}>{MARK[st]}</span>
				{/snippet}
			</EntryList>

			<div class="pane source">
				<div class="panelabel">Source · {SOURCE_LOCALE.toUpperCase()}</div>
				<WikiDetail detail={sourceDetail} />
			</div>

			<div class="pane target">
				<div class="panelabel target-label">Your translation · {targetLocale.toUpperCase()}</div>
				{#if targetLocale === SOURCE_LOCALE}
					<p class="pick">
						Target language is the same as the source ({SOURCE_LOCALE.toUpperCase()}). Switch the
						app language (top-right) to translate into another language.
					</p>
				{:else if selected}
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
	.tlang {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 14px;
		color: var(--color-accent-bright);
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
	.mark {
		width: 15px;
		text-align: center;
		font-size: 12px;
	}
	.mark.none {
		color: var(--color-text-muted);
	}
	.mark.partial {
		color: var(--color-resource);
	}
	.mark.done {
		color: var(--color-good);
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

<script lang="ts">
	// Spellbook manager (d-spellmgr) — same two-pane as the Compendium, plus per-spell
	// management: show-on-sheet (eye), pin, prepare (switch). Reuses EntryList + WikiDetail;
	// prepare + show-on-sheet edit the ACTIVE character (persisted: prepared on the spellEntry,
	// hidden in ui.spellsHidden — Issue #3); pin is still a local UI set (D3, no schema field yet).
	import { onMount } from 'svelte';
	import DiceIcon from '$lib/components/DiceIcon.svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { _ } from '$lib/i18n';
	import { sayText } from '$lib/util/say';
	import { content, loadContentStore } from '$lib/content/store.svelte';
	import { ensureActiveCharacter, saveCharacterGuarded } from '$lib/character/store.svelte';
	import { deriveSheet } from '$lib/character/derive';
	import { isRowActive } from '$lib/content/sources.svelte';
	import { preparedTalliesByClass, canTogglePreparedFor } from '$lib/combat/helpers';
	import PreparedCaps from '$lib/components/PreparedCaps.svelte';
	import { rowName, type LoadedRow } from '$lib/content/loader';
	import type { Character } from '$lib/character/schema';
	import { buildDetail, groupEntries, toEntryGroups } from '$lib/content/detail';
	import { app } from '$lib/stores/app.svelte';
	import EntryList from '$lib/components/EntryList.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import Loading from '$lib/components/Loading.svelte';
	import NoCharacter from '$lib/components/NoCharacter.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Switch from '$lib/components/Switch.svelte';
	import EyeToggle from '$lib/components/EyeToggle.svelte';
	import Pin from '$lib/components/Pin.svelte';

	type SpellEntry = Character['build']['spells'][number];

	const graph = $derived(content.graph); // shared reactive store → live refresh re-renders the list
	let character = $state<Character | null>(null);
	let query = $state('');
	let selected = $state<LoadedRow | null>(null);
	let pinned = $state<Set<string>>(new Set());
	let filter = $state<'all' | 'prepared' | 'pinned'>('all');
	// true once onMount resolves — lets the markup tell "still loading" apart from "loaded, no
	// character" (the user deleted the demo and has none of their own → the empty state).
	let loaded = $state(false);

	onMount(async () => {
		const g = await loadContentStore();
		if (!g) return; // content load failed — error surfaces via the content store
		// edit the ACTIVE character so show-on-sheet / prepare persist to the same save combat reads;
		// ensureActiveCharacter returns the persisted demo by default — the same instance combat edits.
		character = await ensureActiveCharacter();
		for (const s of character?.build.spells ?? []) {
			const row = g.get(s.spell);
			if (row && ['fire-bolt', 'shield'].includes(String(row.data.id))) pinned.add(row.effectiveId);
		}
		pinned = new Set(pinned);
		loaded = true;
	});

	// show-on-sheet = NOT hidden. The eye writes ui.spellsHidden (effectiveIds) and persists, so the
	// combat spell list (which filters on the same field) hides it live.
	const isHidden = (id: string) => character?.ui.spellsHidden.includes(id) ?? false;
	function toggleHidden(id: string) {
		if (!character) return;
		character.ui.spellsHidden = isHidden(id)
			? character.ui.spellsHidden.filter((x) => x !== id)
			: [...character.ui.spellsHidden, id];
		void saveCharacterGuarded(character);
	}

	// resolved {spellEntry, row} pairs + a lookup by effectiveId for the toggles
	const resolved = $derived.by(() => {
		if (!graph || !character) return [] as { entry: SpellEntry; row: LoadedRow }[];
		const g = graph;
		return character.build.spells
			.map((entry) => ({ entry, row: g.get(entry.spell) }))
			.filter((x): x is { entry: SpellEntry; row: LoadedRow } => !!x.row);
	});
	const entryOf = $derived(new Map(resolved.map((x) => [x.row.effectiveId, x.entry])));
	const isPrepared = (e: SpellEntry) => e.prepared || e.alwaysPrepared;

	const groups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const rows = resolved
			.filter(({ entry, row }) => {
				if (q && !rowName(row).toLowerCase().includes(q)) return false;
				if (filter === 'prepared' && !isPrepared(entry)) return false;
				if (filter === 'pinned' && !pinned.has(row.effectiveId)) return false;
				return true;
			})
			.map((x) => x.row);
		return toEntryGroups(groupEntries(rows, 'spell', $_), (r) => rowName(r), $_);
	});

	const detail = $derived(
		selected ? buildDetail(selected, 'spell', undefined, app.activeLocale) : null,
	);
	const selEntry = $derived(selected ? entryOf.get(selected.effectiveId) : undefined);
	const sheet = $derived(graph && character ? deriveSheet(character, graph, isRowActive) : null);
	// A18-tail: per-class prepared accounting (attribute each prepared spell to the class that grants
	// it). Single caster collapses to one row; multiclass shows + enforces a cap per class.
	const preparedTallies = $derived(preparedTalliesByClass(character?.build.spells ?? [], sheet));

	function togglePrepare(id: string) {
		const e = entryOf.get(id);
		const row = graph?.get(id);
		const isCantrip = row?.type === 'spell' && Number(row.data.level) === 0;
		// A18-tail: per-class cap gate via the ONE shared seam (identical in the combat sheet, D13)
		const res = canTogglePreparedFor({
			spells: character?.build.spells ?? [],
			sheet,
			entry: e,
			spellRef: id,
			isCantrip,
		});
		if (!res.ok) {
			if (res.message) toast(sayText(res.message, $_));
			return;
		}
		if (e) e.prepared = !e.prepared;
		if (character) void saveCharacterGuarded(character);
	}
	function toggleSet(set: Set<string>, id: string): Set<string> {
		const next = new Set(set);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		return next;
	}
	function cast() {
		if (selected) toast($_('spellbook.notice.cast', { values: { name: selected.data.name_en } }));
	}
</script>

<svelte:head><title>{$_('nav.spellbook')} — Charnik</title></svelte:head>

{#if loaded && !character}
	<NoCharacter />
{:else if !graph || !character}
	<Loading message={$_('spellbook.loading')} error={content.error} />
{:else}
	<div class="mgrhead">
		<h1>{$_('spellbook.title')}</h1>
		<span class="prepared-count"
			><PreparedCaps tallies={preparedTallies} /> · {$_('spellbook.known', {
				values: { count: resolved.length },
			})}</span
		>
		<span class="spacer"></span>
		<button class="cta" onclick={() => goto(`${base}/combat`)}>{$_('spellbook.done')}</button>
	</div>

	<div class="two-column">
		<EntryList
			{groups}
			bind:searchValue={query}
			searchPlaceholder={$_('spellbook.search')}
			selectedId={selected?.effectiveId ?? null}
			onselect={(e) => (selected = e.row)}
		>
			{#snippet filters()}
				<Chip active={filter === 'all'} onclick={() => (filter = 'all')}
					>{$_('spellbook.filterAll')}</Chip
				>
				<Chip active={filter === 'prepared'} onclick={() => (filter = 'prepared')}
					>{$_('spellbook.filterPrepared')}</Chip
				>
				<Chip active={filter === 'pinned'} onclick={() => (filter = 'pinned')}
					>{$_('spellbook.filterPinned')}</Chip
				>
			{/snippet}
			{#snippet leading(e)}
				<EyeToggle
					on={!isHidden(e.id)}
					title={$_('spellbook.showOnSheet')}
					onclick={() => toggleHidden(e.id)}
				/>
				<Pin
					on={pinned.has(e.id)}
					title={$_('spellbook.pinToBar')}
					onclick={() => (pinned = toggleSet(pinned, e.id))}
				/>
			{/snippet}
			{#snippet trailing(e)}
				{@const en = entryOf.get(e.id)}
				<Switch
					on={en ? isPrepared(en) : false}
					lock={en?.alwaysPrepared ?? false}
					title={$_(en?.alwaysPrepared ? 'spellbook.alwaysPrepared' : 'spellbook.prepare')}
					onclick={() => togglePrepare(e.id)}
				/>
			{/snippet}
		</EntryList>

		<WikiDetail {detail}>
			{#snippet actions()}
				<button class="cta" onclick={cast}><DiceIcon size={14} /> {$_('spellbook.cast')}</button>
				<span class="detail-toggle">
					{$_('spellbook.detailPrepared')}
					<Switch
						on={selEntry ? isPrepared(selEntry) : false}
						lock={selEntry?.alwaysPrepared ?? false}
						onclick={() => selected && togglePrepare(selected.effectiveId)}
					/>
				</span>
				<span class="detail-toggle">
					{$_('spellbook.showOnSheet')}
					<Switch
						on={selected ? !isHidden(selected.effectiveId) : false}
						onclick={() => selected && toggleHidden(selected.effectiveId)}
					/>
				</span>
				<span class="detail-toggle">
					{$_('spellbook.filterPinned')}
					<Switch
						on={selected ? pinned.has(selected.effectiveId) : false}
						onclick={() => selected && (pinned = toggleSet(pinned, selected.effectiveId))}
					/>
				</span>
			{/snippet}
		</WikiDetail>
	</div>
{/if}

<style>
	.mgrhead {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin: calc(-1 * var(--space-3)) 0 var(--space-3);
		flex-wrap: wrap;
	}
	.mgrhead h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-2xl);
		margin: 0;
	}
	.prepared-count {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.spacer {
		flex: 1;
	}
	/* display-font accent CTA — shared by the Done + Cast buttons (was two identical rules) */
	.cta {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-sm);
		border-radius: var(--radius);
		padding: var(--space-1-5) var(--space-4);
		cursor: pointer;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: var(--color-accent-text);
	}
	.two-column {
		display: grid;
		grid-template-columns: minmax(300px, 390px) 1fr;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		height: calc(100vh - 175px);
		min-height: 560px;
	}
	.detail-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}
	@media (max-width: 700px) {
		.two-column {
			grid-template-columns: 1fr;
			height: auto;
		}
	}
</style>

<script lang="ts">
	// Spellbook manager (d-spellmgr) — same two-pane as the Compendium, plus per-spell
	// management: show-on-sheet (eye), pin, prepare (switch). Reuses EntryList + WikiDetail. All of it
	// edits the ACTIVE character through the Combat view-model, so a pin, a prepared spell and a cast
	// here are the ones Combat shows: prepared on the spellEntry, hidden in ui.spellsHidden, pinned
	// in ui.spellsPinned, and Cast is Combat's own cast — a slot spent, the dice rolled.
	import { foldForSearch } from '$lib/util/search-fold';
	import { onMount } from 'svelte';
	import DiceIcon from '$lib/components/DiceIcon.svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { toast } from '$lib/toast/toast';
	import { _ } from '$lib/i18n';
	import { sayText } from '$lib/util/say';
	import { content, loadContentStore } from '$lib/content/store.svelte';
	import { saveCharacterGuarded } from '$lib/character/store.svelte';
	import { deriveSheet } from '$lib/character/derive';
	import { spellEntries } from '$lib/character/spellcasting';
	import { isRowActive } from '$lib/content/sources.svelte';
	import { preparedTalliesOf, canTogglePreparedFor } from '$lib/combat/helpers';
	import PreparedCaps from '$lib/components/PreparedCaps.svelte';
	import { rowName, type LoadedRow } from '$lib/content/loader';
	import type { Character } from '$lib/character/schema';
	import { buildDetail } from '$lib/content/detail';
	import { groupEntries, toEntryGroups } from '$lib/content/entry-list';
	import { app } from '$lib/stores/app.svelte';
	import EntryList from '$lib/components/EntryList.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import Loading from '$lib/components/Loading.svelte';
	import NoCharacter from '$lib/components/NoCharacter.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Switch from '$lib/components/Switch.svelte';
	import EyeToggle from '$lib/components/EyeToggle.svelte';
	import Pin from '$lib/components/Pin.svelte';
	import SlotPips from '$lib/components/SlotPips.svelte';
	import { combat } from '../combat/combat-view-model.svelte';
	import { prepState, spellRow } from '$lib/combat/spells';
	import { casterForSpell } from '$lib/character/spellcasting';
	import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';

	type SpellEntry = Character['build']['spells'][number];

	const graph = $derived(content.graph); // shared reactive store → live refresh re-renders the list
	let character = $state<Character | null>(null);
	let query = $state('');
	let selected = $state<LoadedRow | null>(null);
	let filter = $state<'all' | 'prepared' | 'pinned'>('all');
	// true once onMount resolves — lets the markup tell "still loading" apart from "loaded, no
	// character" (the user deleted the demo and has none of their own → the empty state).
	let loaded = $state(false);

	onMount(async () => {
		const g = await loadContentStore();
		if (!g) return; // content load failed — error surfaces via the content store
		// the ACTIVE character, held by the Combat view-model: the same instance Combat edits, so a
		// cast here spends the slot Combat shows
		await combat.load();
		character = combat.character;
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
		return spellEntries(character, sheet)
			.map((entry) => ({ entry, row: g.get(entry.spell) }))
			.filter((x): x is { entry: SpellEntry; row: LoadedRow } => !!x.row);
	});
	const entryOf = $derived(new Map(resolved.map((x) => [x.row.effectiveId, x.entry])));
	const isPrepared = (e: SpellEntry) => e.prepared || e.alwaysPrepared;

	const groups = $derived.by(() => {
		const q = foldForSearch(query.trim());
		const rows = resolved
			.filter(({ entry, row }) => {
				if (q && !foldForSearch(rowName(row)).includes(q)) return false;
				if (filter === 'prepared' && !isPrepared(entry)) return false;
				if (filter === 'pinned' && !isPinned(row.effectiveId)) return false;
				return true;
			})
			.map((x) => x.row);
		return toEntryGroups(groupEntries(rows, 'spell', $_), (r) => rowName(r), $_);
	});

	const detail = $derived(
		selected ? buildDetail(selected, 'spell', { locale: app.activeLocale }) : null,
	);
	const selEntry = $derived(selected ? entryOf.get(selected.effectiveId) : undefined);
	const sheet = $derived(graph && character ? deriveSheet(character, graph, isRowActive) : null);
	// A18-tail: per-class prepared accounting (attribute each prepared spell to the class that grants
	// it). Single caster collapses to one row; multiclass shows + enforces a cap per class.
	const preparedTallies = $derived(preparedTalliesOf(character, sheet));

	function togglePrepare(id: string) {
		const e = entryOf.get(id);
		const row = graph?.get(id);
		const isCantrip = row?.type === 'spell' && Number(row.data.level) === 0;
		// A18-tail: per-class cap gate via the ONE shared seam (identical in the combat sheet, D13)
		const res = canTogglePreparedFor({
			spells: character ? spellEntries(character, sheet) : [],
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
	const isPinned = (id: string) => character?.ui.spellsPinned.includes(id) ?? false;
	function togglePin(id: string) {
		if (!character) return;
		combat.togglePin(id);
		void saveCharacterGuarded(character);
	}
	/** Cast the selected spell the way Combat does: its row as Combat builds it, through Combat. */
	function cast(event: Event) {
		const entry = selected ? entryOf.get(selected.effectiveId) : undefined;
		if (!graph || !selected || !entry) return;
		const row = spellRow(graph, selected.effectiveId, prepState(entry), {
			charLevel: sheet?.level ?? 1,
			locale: app.activeLocale,
			caster: casterForSpell(sheet, selected.effectiveId),
		});
		if (row) combat.cast(row, event);
	}
	// the slot pools beside the prepared count, so the slot a cast takes is seen to go
	const slotPools = $derived(
		(sheet?.spellcasting.pools ?? []).flatMap((pool) =>
			pool.spellLevel === undefined
				? []
				: [
						{
							key: pool.forcedUpcast ? PACT_SLOT_KEY : String(pool.spellLevel),
							label: $_(pool.forcedUpcast ? 'combat.spells.pactMagic' : 'spellLevel.nth', {
								values: { level: pool.spellLevel },
							}),
							full: pool.max,
							spent:
								character?.play.spellSlotsSpent[
									pool.forcedUpcast ? PACT_SLOT_KEY : String(pool.spellLevel)
								] ?? 0,
						},
					],
		),
	);
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
		{#each slotPools as pool (pool.key)}
			<span class="slot-pool"
				>{pool.label}
				<SlotPips full={pool.full} spent={pool.spent} title={$_('combat.spells.slotPip')} /></span
			>
		{/each}
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
				<Pin on={isPinned(e.id)} title={$_('spellbook.pinToBar')} onclick={() => togglePin(e.id)} />
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
						on={selected ? isPinned(selected.effectiveId) : false}
						onclick={() => selected && togglePin(selected.effectiveId)}
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
	.slot-pool {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
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

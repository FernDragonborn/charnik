<script lang="ts">
	// Spellbook manager (d-spellmgr) — same two-pane as the Compendium, plus per-spell
	// management: show-on-sheet (eye), pin, prepare (switch). Reuses EntryList + WikiDetail;
	// prepare toggles the character's spellEntry, pin/show are UI sets (no schema field yet).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { getContentGraph } from '$lib/content/provider';
	import { demoCharacter } from '$lib/demo/sheet';
	import { deriveSheet } from '$lib/character/derive';
	import type { ContentGraph, LoadedRow } from '$lib/content/loader';
	import type { Character } from '$lib/character/schema';
	import {
		buildDetail,
		entryMeta,
		groupEntries,
		editionLabel,
		type Entry
	} from '$lib/content/detail';
	import EntryList from '$lib/components/EntryList.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Switch from '$lib/components/Switch.svelte';
	import EyeToggle from '$lib/components/EyeToggle.svelte';
	import Pin from '$lib/components/Pin.svelte';

	type SpellEntry = Character['build']['spells'][number];

	let graph = $state<ContentGraph | null>(null);
	let character = $state<Character | null>(null);
	let query = $state('');
	let selected = $state<LoadedRow | null>(null);
	let pinned = $state<Set<string>>(new Set());
	let shown = $state<Set<string>>(new Set());
	let filter = $state<'all' | 'prepared' | 'pinned'>('all');

	onMount(async () => {
		graph = await getContentGraph();
		character = demoCharacter();
		const g = graph;
		for (const s of character.build.spells) {
			const row = g.get(s.spell);
			if (!row) continue;
			if (s.prepared || s.alwaysPrepared) shown.add(row.effectiveId);
			if (['fire-bolt', 'shield'].includes(String(row.data.id))) pinned.add(row.effectiveId);
		}
		shown = new Set(shown);
		pinned = new Set(pinned);
	});

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
				if (q && !String(row.data.name_en).toLowerCase().includes(q)) return false;
				if (filter === 'prepared' && !isPrepared(entry)) return false;
				if (filter === 'pinned' && !pinned.has(row.effectiveId)) return false;
				return true;
			})
			.map((x) => x.row);
		return groupEntries(rows, 'spell').map((grp) => ({
			label: grp.label,
			entries: grp.rows.map((r): Entry<LoadedRow> => ({
				id: r.effectiveId,
				name: String(r.data.name_en),
				meta: entryMeta(r, 'spell'),
				edition: editionLabel(r.data.systems),
				row: r
			}))
		}));
	});

	const detail = $derived(selected ? buildDetail(selected, 'spell') : null);
	const selEntry = $derived(selected ? entryOf.get(selected.effectiveId) : undefined);
	const sheet = $derived(graph && character ? deriveSheet(character, graph) : null);
	// only LEVELED prepared spells count toward the cap — cantrips are always-known, not prepared
	const preparedCount = $derived(
		character ? character.build.spells.filter((s) => s.prepared && !s.alwaysPrepared).length : 0
	);
	const preparedCap = $derived(sheet?.spellcasting.classes[0]?.preparedCap ?? 0);

	function togglePrepare(id: string) {
		const e = entryOf.get(id);
		if (!e || e.alwaysPrepared) return;
		if (!e.prepared && preparedCount >= preparedCap) {
			toast(`Prepared spells full (${preparedCap}) — unprepare one first.`);
			return;
		}
		e.prepared = !e.prepared;
	}
	function toggleSet(set: Set<string>, id: string): Set<string> {
		const next = new Set(set);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		return next;
	}
	function cast() {
		if (selected) toast(`Cast ${selected.data.name_en}`);
	}
</script>

<svelte:head><title>Spellbook — Charnik</title></svelte:head>

{#if !graph || !character}
	<p class="loading">Loading spellbook…</p>
{:else}
	<div class="mgrhead">
		<h1>Manage spells</h1>
		<span class="prepared-count"
			>Prepared <b>{preparedCount}</b>/{preparedCap} · spellbook {resolved.length}</span
		>
		<span class="spacer"></span>
		<button class="done" onclick={() => goto(`${base}/combat`)}>Done</button>
	</div>

	<div class="two-column">
		<EntryList
			{groups}
			bind:searchValue={query}
			searchPlaceholder="Search spellbook…"
			selectedId={selected?.effectiveId ?? null}
			onselect={(e) => (selected = e.row)}
		>
			{#snippet filters()}
				<Chip active={filter === 'all'} onclick={() => (filter = 'all')}>All</Chip>
				<Chip active={filter === 'prepared'} onclick={() => (filter = 'prepared')}>Prepared</Chip>
				<Chip active={filter === 'pinned'} onclick={() => (filter = 'pinned')}>Pinned</Chip>
			{/snippet}
			{#snippet leading(e)}
				<EyeToggle
					on={shown.has(e.id)}
					title="Show on sheet"
					onclick={() => (shown = toggleSet(shown, e.id))}
				/>
				<Pin
					on={pinned.has(e.id)}
					title="Pin to quick bar"
					onclick={() => (pinned = toggleSet(pinned, e.id))}
				/>
			{/snippet}
			{#snippet trailing(e)}
				{@const en = entryOf.get(e.id)}
				<Switch
					on={en ? isPrepared(en) : false}
					lock={en?.alwaysPrepared ?? false}
					title={en?.alwaysPrepared ? 'always prepared' : 'prepare'}
					onclick={() => togglePrepare(e.id)}
				/>
			{/snippet}
		</EntryList>

		<WikiDetail {detail}>
			{#snippet actions()}
				<button class="cast-btn" onclick={cast}>🎲 Cast</button>
				<span class="dtog">
					Prepared
					<Switch
						on={selEntry ? isPrepared(selEntry) : false}
						lock={selEntry?.alwaysPrepared ?? false}
						onclick={() => selected && togglePrepare(selected.effectiveId)}
					/>
				</span>
				<span class="dtog">
					On sheet
					<Switch
						on={selected ? shown.has(selected.effectiveId) : false}
						onclick={() => selected && (shown = toggleSet(shown, selected.effectiveId))}
					/>
				</span>
				<span class="dtog">
					Pinned
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
		gap: 16px;
		margin: calc(-1 * var(--space-3)) 0 12px;
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
	.prepared-count b {
		color: var(--color-resource);
	}
	.spacer {
		flex: 1;
	}
	.done {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		border-radius: 8px;
		padding: 7px 16px;
		cursor: pointer;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: #fff;
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
	.cast-btn {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		border-radius: 8px;
		padding: 7px 14px;
		cursor: pointer;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: #fff;
	}
	.dtog {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
		color: var(--color-text);
	}
	@media (max-width: 700px) {
		.two-column {
			grid-template-columns: 1fr;
			height: auto;
		}
	}
</style>

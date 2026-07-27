<script lang="ts">
	// One draggable card in the combat panel grid. `pid` selects which panel body it renders — skills /
	// attacks / actions / effects / spells — under a shared collapsible head (title + per-panel toolbar
	// button + drag handle). A thin dispatcher: each body lives in ./panels/*; character + sheet come in
	// as props. The dnd grid that hosts these cards stays in the page.
	import { base } from '$app/paths';
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../state.svelte';
	import { PANEL_TITLE } from '$lib/combat/helpers';
	import PreparedCaps from '$lib/components/PreparedCaps.svelte';
	import SkillsPanel from './panels/SkillsPanel.svelte';
	import AttacksPanel from './panels/AttacksPanel.svelte';
	import ActionsPanel from './panels/ActionsPanel.svelte';
	import EffectsPanel from './panels/EffectsPanel.svelte';
	import SpellsPanel from './panels/SpellsPanel.svelte';

	let { pid, c, s }: { pid: string; c: Character; s: CharacterSheet } = $props();

	const collapsed = $derived(combat.layout.collapsed);
	const groupByLabel = $derived(combat.groupByLabel);
	const { openMenu, cycleGroupBy } = combat;
	const { toggle } = combat.layout;
</script>

<div class="panel-head">
	<button class="htoggle" onclick={() => toggle(pid)}>
		<span class="chevron">{collapsed[pid] ? '▸' : '▾'}</span>{PANEL_TITLE[pid]}
	</button>
	{#if pid === 'actions'}
		<button class="pill-btn" onclick={(e) => openMenu('showhide', e)}>👁 Show / hide</button>
	{:else if pid === 'effects'}
		<span class="head-btns">
			<button class="pill-btn" onclick={(e) => openMenu('condition', e)}>＋ Condition</button>
			<button class="pill-btn" onclick={(e) => openMenu('addeffect', e)}>＋ Add effect</button>
		</span>
	{:else if pid === 'spells' && s.spellcasting.classes.length}
		<span class="prepared-count"><PreparedCaps tallies={combat.preparedTallies} /></span>
		<button class="pill-btn" onclick={cycleGroupBy} title="Change grouping">{groupByLabel} ▾</button
		>
		<a class="pill-btn" href="{base}/spellbook">⛭ Manage all</a>
	{/if}
	<span
		class="drag-handle"
		role="button"
		tabindex="-1"
		aria-label="drag to reorder"
		title="drag to reorder"
		onpointerdown={() => (combat.layout.dragDisabled = false)}>⠿</span
	>
</div>
{#if !collapsed[pid]}
	{#if pid === 'skills'}
		<SkillsPanel {s} />
	{:else if pid === 'attacks'}
		<AttacksPanel />
	{:else if pid === 'actions'}
		<ActionsPanel />
	{:else if pid === 'effects'}
		<EffectsPanel {c} {s} />
	{:else if pid === 'spells'}
		<SpellsPanel {s} />
	{/if}
{/if}

<style>
	.head-btns {
		display: flex;
		gap: 6px;
	}
	.prepared-count {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>

<script lang="ts">
	// One draggable card in the combat panel grid. `pid` selects which panel body it renders — skills /
	// attacks / actions / effects / spells / inventory — under a shared collapsible head (title + toolbar
	// button + drag handle). A thin dispatcher: each body lives in ./panels/*; character + sheet come in
	// as props. The dnd grid that hosts these cards stays in the page.
	import { flushSync, tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EyeIcon from '$lib/components/EyeIcon.svelte';
	import { base } from '$app/paths';
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../combat-view-model.svelte';
	import { PANEL_MOVE, type PanelMove } from '../panel-layout.svelte';
	import { _ } from '$lib/i18n';
	import PreparedCaps from '$lib/components/PreparedCaps.svelte';
	import SkillsPanel from './panels/SkillsPanel.svelte';
	import AttacksPanel from './panels/AttacksPanel.svelte';
	import ActionsPanel from './panels/ActionsPanel.svelte';
	import EffectsPanel from './panels/EffectsPanel.svelte';
	import SpellsPanel from './panels/SpellsPanel.svelte';
	import InventoryPanel from './panels/InventoryPanel.svelte';
	import FeaturesPanel from './panels/FeaturesPanel.svelte';

	let { pid, c, s }: { pid: string; c: Character; s: CharacterSheet } = $props();

	// keyed on `e.code`, so it is the physical arrow key on every layout (AGENTS.md ▸ Taste)
	const ARROW_MOVE: Record<string, PanelMove> = {
		ArrowUp: PANEL_MOVE.up,
		ArrowDown: PANEL_MOVE.down,
		ArrowLeft: PANEL_MOVE.left,
		ArrowRight: PANEL_MOVE.right,
	};
	function moveOnArrow(event: KeyboardEvent): void {
		const dir = ARROW_MOVE[event.code];
		if (!dir) return;
		event.preventDefault(); // the page would scroll instead
		combat.layout.movePanel(pid, dir);
		// svelte-dnd-action rebuilds the column's nodes, so the button that had the caret is gone by
		// the time the move lands — a reorder must not cost the keyboard its place
		void tick().then(() => document.getElementById(`panel-grip-${pid}`)?.focus());
	}

	const collapsed = $derived(combat.layout.collapsed);
	const groupByLabel = $derived(combat.groupByLabel);
	const moveLabel = $derived(
		$_('combat.panel.moveHandle', { values: { panel: $_(`combat.panel.${pid}`) } }),
	);
	const { openMenu, cycleGroupBy } = combat;
	const { toggle } = combat.layout;
</script>

<div class="panel-head">
	<button class="htoggle" onclick={() => toggle(pid)}>
		<span class="chevron"
			><Icon name={collapsed[pid] ? 'chevron-right' : 'chevron-down'} size={13} /></span
		>{$_(`combat.panel.${pid}`)}
	</button>
	{#if pid === 'actions'}
		<button class="pill-btn" onclick={(e) => openMenu('showhide', e)}
			><EyeIcon on={true} /> {$_('combat.panel.showHide')}</button
		>
	{:else if pid === 'effects'}
		<span class="head-btns">
			<button class="pill-btn" onclick={(e) => openMenu('condition', e)}
				><Icon name="plus" size={13} /> {$_('combat.panel.condition')}</button
			>
			<button class="pill-btn" onclick={(e) => openMenu('addeffect', e)}
				><Icon name="plus" size={13} /> {$_('combat.panel.addEffect')}</button
			>
		</span>
	{:else if pid === 'inventory'}
		<button class="pill-btn" onclick={(e) => openMenu('coins', e)}
			><Icon name="coins" size={13} /> {$_('combat.panel.coins')}</button
		>
	{:else if pid === 'spells' && s.spellcasting.classes.length}
		<span class="prepared-count"><PreparedCaps tallies={combat.preparedTallies} /></span>
		<button class="pill-btn" onclick={cycleGroupBy} title={$_('combat.panel.changeGrouping')}
			>{$_(groupByLabel)} <Icon name="chevron-down" size={12} /></button
		>
		<a class="pill-btn" href="{base}/spellbook"
			><Icon name="settings" size={13} /> {$_('combat.panel.manageAll')}</a
		>
	{/if}
	<!-- a real button in the tab order, not a role nothing listens to: reordering your own combat
	     screen had a pointer path and no other. The arrows are the same reorder the drag performs —
	     up/down inside the column, left/right across to the other one. -->
	<button
		type="button"
		id="panel-grip-{pid}"
		class="drag-handle"
		aria-label={moveLabel}
		title={moveLabel}
		onpointerdown={() => {
			// FLUSHED, not just assigned: `dndzone` reads `dragDisabled` while handling the SAME press,
			// and a runes update lands on a microtask — so the library saw the old `true`, ignored the
			// gesture, and unblocking it afterwards did not bring that press back.
			flushSync(() => (combat.layout.dragDisabled = false));
		}}
		onkeydown={moveOnArrow}>⠿</button
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
	{:else if pid === 'inventory'}
		<InventoryPanel />
	{:else if pid === 'features'}
		<FeaturesPanel />
	{/if}
{/if}

<style>
	.head-btns {
		display: flex;
		gap: var(--space-1-5);
	}
	.prepared-count {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>

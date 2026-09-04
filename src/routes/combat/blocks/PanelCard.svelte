<script lang="ts">
	// One draggable card in the combat panel grid. `pid` selects which panel body it renders — skills /
	// attacks / actions / effects / spells / inventory — under a shared collapsible head (title + toolbar
	// button + drag handle). A thin dispatcher: each body lives in ./panels/*; character + sheet come in
	// as props. The dnd grid that hosts these cards stays in the page.
	import Icon from '$lib/components/Icon.svelte';
	import EyeIcon from '$lib/components/EyeIcon.svelte';
	import { base } from '$app/paths';
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../combat-view-model.svelte';
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

	const collapsed = $derived(combat.layout.collapsed);
	const groupByLabel = $derived(combat.groupByLabel);
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
	{:else if pid === 'spells' && s.spellcasting.classes.length}
		<span class="prepared-count"><PreparedCaps tallies={combat.preparedTallies} /></span>
		<button class="pill-btn" onclick={cycleGroupBy} title={$_('combat.panel.changeGrouping')}
			>{groupByLabel} <Icon name="chevron-down" size={12} /></button
		>
		<a class="pill-btn" href="{base}/spellbook"
			><Icon name="settings" size={13} /> {$_('combat.panel.manageAll')}</a
		>
	{/if}
	<span
		class="drag-handle"
		role="button"
		tabindex="-1"
		aria-label={$_('combat.panel.dragToReorder')}
		title={$_('combat.panel.dragToReorder')}
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

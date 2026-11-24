<script lang="ts">
	// The play screen under a finger (`work/play-layout.md` ▸ PHONE-PLAY,
	// `design-preview/narrow-combat-variants.html`): the character in one block on top, the controls
	// under it, one tab's content between, the last roll above the tab bar, and the tab bar under the
	// thumb. A tab with nothing in it is not drawn (P8).
	import type { Character } from '#lib/character/schema.ts';
	import type { CharacterSheet } from '#lib/character/derive.ts';
	import { _ } from '#lib/i18n/index.ts';
	import NarrowHead from './NarrowHead.svelte';
	import PlayStrip from './PlayStrip.svelte';
	import Playbar from '../blocks/Playbar.svelte';
	import PanelCard from '../blocks/PanelCard.svelte';
	import CombatStrip from '../blocks/CombatStrip.svelte';
	import Abilities from '../blocks/Abilities.svelte';
	import PluginNeeds from '#lib/components/PluginNeeds.svelte';
	import { combat } from '../combat-view-model.svelte';
	import { PLAY_LAYOUT } from '../play-layout.svelte';
	import { walkInlineOptions } from '#lib/util/option-walk.ts';
	import ArrangeTab from './ArrangeTab.svelte';

	let { c, s }: { c: Character; s: CharacterSheet } = $props();

	/** The tabs, in the mock's order, and the panels each one shows. Mine is the character's own set:
	 *  until any row can be pinned there (RESOURCE-PIN), it holds the attacks and what is on them. */
	const MINE = 'mine';
	const SPELLS = 'spells';
	const SKILLS = 'skills';
	const TABS = [
		{ id: MINE, panels: ['attacks', 'effects'] },
		{ id: 'actions', panels: ['actions'] },
		{ id: SPELLS, panels: ['spells'] },
		{ id: SKILLS, panels: ['skills'] },
		{ id: 'items', panels: ['inventory'] },
		{ id: 'bio', panels: ['features'] },
	] as const;
	type TabId = (typeof TABS)[number]['id'];

	const arranging = $derived(combat.layout.arranging);
	const tabs = $derived(
		TABS.filter(
			({ id }) =>
				(id !== SPELLS || s.spellcasting.classes.length > 0) &&
				(arranging || id === MINE || combat.layout.tabShown(PLAY_LAYOUT.phone, id)),
		),
	);
	const barShown = $derived(tabs.length > 1);
	let picked = $state<TabId>(MINE);
	const on = $derived(tabs.find((tab) => tab.id === picked) ?? tabs[0]);
	const tabName = (id: TabId) => $_(`combat.phone.tab.${id}`);
	const tabId = (id: TabId) => `phone-tab-${id}`;

	function walkTabs(event: KeyboardEvent, current: TabId): void {
		walkInlineOptions(event, {
			ids: tabs.map(({ id }) => id),
			previewId: current,
			onpreview: (next) => {
				const nextTab = tabs.find(({ id }) => id === next);
				if (!nextTab) return;
				picked = nextTab.id;
				document.getElementById(tabId(picked))?.focus();
			},
		});
	}
</script>

<div class="phone-play">
	<NarrowHead {c} {s} arrangeTab={on ? tabName(on.id) : ''} />
	{#if !arranging}<PlayStrip {c} />{/if}
	<PluginNeeds issues={s.deriveIssues} />

	<div
		class="phone-body"
		role="tabpanel"
		id="phone-body"
		data-region
		aria-labelledby={barShown && on ? tabId(on.id) : undefined}
		aria-label={!barShown && on ? tabName(on.id) : undefined}
	>
		{#if arranging && on && on.id !== MINE}
			<ArrangeTab layout={PLAY_LAYOUT.phone} id={on.id} name={tabName(on.id)} />
		{/if}
		{#if on?.id === SKILLS}<Abilities {s} /><CombatStrip {s} tiles={false} />{/if}
		{#each on?.panels ?? [] as pid (pid)}
			<div class="phone-panel"><PanelCard {pid} {c} {s} asTab phone /></div>
		{/each}
	</div>

	{#if !arranging}<div class="phone-last"><Playbar withDice /></div>{/if}

	{#if barShown}<div
			class="phone-tabs"
			role="tablist"
			data-region
			aria-label={$_('combat.phone.tabs')}
		>
			{#each tabs as tab (tab.id)}
				<button
					role="tab"
					id={tabId(tab.id)}
					class="phone-tab"
					class:on={tab.id === on?.id}
					aria-selected={tab.id === on?.id}
					aria-controls="phone-body"
					tabindex={tab.id === on?.id ? 0 : -1}
					onclick={() => (picked = tab.id)}
					onkeydown={(event) => walkTabs(event, tab.id)}>{tabName(tab.id)}</button
				>
			{/each}
		</div>{/if}
</div>

<style>
	/* the window's height: only the tab's content scrolls, the tab bar stays under the thumb */
	.phone-play {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		height: calc(100dvh - var(--column-play-top, 7rem));
		min-height: 24rem;
	}
	.phone-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	.phone-panel + .phone-panel {
		margin-top: var(--space-3);
	}
	.phone-last {
		flex: none;
	}
	.phone-last :global(.playbar),
	.phone-last :global(.last-roll) {
		width: 100%;
	}
	.phone-tabs {
		flex: none;
		display: flex;
		border-top: 1px solid var(--color-border);
		background: var(--color-surface);
	}
	/* the bar is the character's tabs spread evenly, each a finger's width at least (P8) */
	.phone-tab {
		flex: 1;
		min-height: 44px;
		padding: var(--space-2) 0;
		background: transparent;
		border: 0;
		border-top: 2px solid transparent;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		cursor: pointer;
	}
	.phone-tab.on {
		color: var(--color-text);
		font-weight: 600;
		border-top-color: var(--color-accent);
	}
</style>

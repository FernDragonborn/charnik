<script lang="ts">
	// The play screen under a finger (`work/play-layout.md` ▸ PHONE-PLAY,
	// `design-preview/narrow-combat-variants.html`): the character in one block on top, the controls
	// under it, one tab's content between, the last roll above the tab bar, and the tab bar under the
	// thumb. A tab with nothing in it is not drawn (P8).
	import type { Character } from '#lib/character/schema.ts';
	import type { CharacterSheet } from '#lib/character/derive.ts';
	import { _ } from '#lib/i18n/index.ts';
	import NarrowHead from './NarrowHead.svelte';
	import Controls from '../blocks/Controls.svelte';
	import Turnbar from '../blocks/Turnbar.svelte';
	import TimeSkip from '../blocks/TimeSkip.svelte';
	import Playbar from '../blocks/Playbar.svelte';
	import PanelCard from '../blocks/PanelCard.svelte';
	import CombatStrip from '../blocks/CombatStrip.svelte';
	import Abilities from '../blocks/Abilities.svelte';
	import PluginNeeds from '#lib/components/PluginNeeds.svelte';

	let { c, s }: { c: Character; s: CharacterSheet } = $props();

	/** The tabs, in the mock's order, and the panels each one shows. Mine is the character's own set:
	 *  until any row can be pinned there (RESOURCE-PIN), it holds the attacks and what is on them. */
	const TABS = [
		{ id: 'mine', panels: ['attacks', 'effects'] },
		{ id: 'actions', panels: ['actions', 'attacks'] },
		{ id: 'spells', panels: ['spells'] },
		{ id: 'skills', panels: ['skills'] },
		{ id: 'items', panels: ['inventory'] },
		{ id: 'bio', panels: ['features'] },
	] as const;
	type TabId = (typeof TABS)[number]['id'];

	const tabs = $derived(
		TABS.filter((tab) => tab.id !== 'spells' || s.spellcasting.classes.length > 0),
	);
	let picked = $state<TabId>('mine');
	const on = $derived(tabs.find((tab) => tab.id === picked) ?? tabs[0]);

	function step(from: TabId, by: number): void {
		const at = tabs.findIndex((tab) => tab.id === from);
		const next = tabs[(at + by + tabs.length) % tabs.length];
		if (!next) return;
		picked = next.id;
		document.getElementById(`phone-tab-${next.id}`)?.focus();
	}
</script>

<div class="phone-play">
	<NarrowHead {c} {s} />
	<div class="phone-strip">
		<Controls {c} />
		{#if c.play.inCombat}<Turnbar {c} />{:else}<TimeSkip />{/if}
	</div>
	<PluginNeeds issues={s.deriveIssues} />

	<div class="phone-body" role="tabpanel" id="phone-body" aria-labelledby={`phone-tab-${on?.id}`}>
		{#if on?.id === 'skills'}<Abilities {s} /><CombatStrip {s} tiles={false} />{/if}
		{#each on?.panels ?? [] as pid (pid)}
			<div class="phone-panel"><PanelCard {pid} {c} {s} asTab /></div>
		{/each}
	</div>

	<div class="phone-last"><Playbar /></div>

	<div class="phone-tabs" role="tablist" aria-label={$_('combat.phone.tabs')}>
		{#each tabs as tab (tab.id)}
			<button
				role="tab"
				id={`phone-tab-${tab.id}`}
				class="phone-tab"
				class:on={tab.id === on?.id}
				aria-selected={tab.id === on?.id}
				aria-controls="phone-body"
				tabindex={tab.id === on?.id ? 0 : -1}
				onclick={() => (picked = tab.id)}
				onkeydown={(e) => {
					const by = e.code === 'ArrowRight' ? 1 : e.code === 'ArrowLeft' ? -1 : 0;
					if (!by) return;
					e.preventDefault();
					step(tab.id, by);
				}}>{$_(`combat.phone.tab.${tab.id}`)}</button
			>
		{/each}
	</div>
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
	.phone-strip {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		overflow-x: auto;
	}
	.phone-strip > :global(*) {
		flex: none;
	}
	.phone-strip :global(.controls) {
		flex-wrap: nowrap;
		margin-bottom: 0;
	}
	.phone-strip :global(.combat-bar) {
		margin-bottom: 0;
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

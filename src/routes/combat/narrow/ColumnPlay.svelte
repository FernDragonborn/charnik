<script lang="ts">
	// The play screen in a desktop window dragged small (`work/play-layout.md` ▸ NARROW-DESKTOP): a top
	// that does not scroll — the character in one block, the controls, the turn or the passing of time
	// — the last roll at the bottom, and between them the panels dealt into columns, each a card whose
	// title is its tabs. How many columns stand side by side is the window's to decide.
	import type { Character } from '#lib/character/schema.ts';
	import type { CharacterSheet } from '#lib/character/derive.ts';
	import { _ } from '#lib/i18n/index.ts';
	import { playLayout } from '../play-layout.svelte';
	import NarrowHead from './NarrowHead.svelte';
	import PlayStrip from './PlayStrip.svelte';
	import Playbar from '../blocks/Playbar.svelte';
	import PanelCard from '../blocks/PanelCard.svelte';
	import CombatStrip from '../blocks/CombatStrip.svelte';
	import Abilities from '../blocks/Abilities.svelte';
	import PluginNeeds from '#lib/components/PluginNeeds.svelte';

	let { c, s }: { c: Character; s: CharacterSheet } = $props();

	/** Which tab each column shows, by the column's first panel — kept while the window re-deals. */
	let shown = $state<Record<string, string>>({});
	const current = (group: readonly string[]): string => {
		const first = group[0] ?? '';
		const picked = shown[first];
		return picked && group.includes(picked) ? picked : first;
	};
</script>

<div class="column-play">
	<NarrowHead {c} {s} />
	<PlayStrip {c} />

	<PluginNeeds issues={s.deriveIssues} />

	<div class="panes">
		{#each playLayout.groups as group (group.join())}
			{@const on = current(group)}
			<section class="pane" data-region aria-labelledby={`pane-tab-${on}`}>
				<div class="pane-tabs" role="tablist">
					{#each group as pid (pid)}
						<button
							role="tab"
							id={`pane-tab-${pid}`}
							class="pane-tab"
							class:on={pid === on}
							aria-selected={pid === on}
							aria-controls={`pane-body-${group[0] ?? ''}`}
							tabindex={pid === on ? 0 : -1}
							onclick={() => (shown = { ...shown, [group[0] ?? '']: pid })}
							onkeydown={(e) => {
								const step = e.code === 'ArrowRight' ? 1 : e.code === 'ArrowLeft' ? -1 : 0;
								if (!step) return;
								e.preventDefault();
								const next = group[(group.indexOf(pid) + step + group.length) % group.length];
								if (!next) return;
								shown = { ...shown, [group[0] ?? '']: next };
								document.getElementById(`pane-tab-${next}`)?.focus();
							}}>{$_(`combat.narrow.tab.${pid}`, { default: $_(`combat.panel.${pid}`) })}</button
						>
					{/each}
				</div>
				<div class="pane-body" role="tabpanel" id={`pane-body-${group[0] ?? ''}`}>
					<!-- what the wide screen stands above its panels — the passives, the defenses, the abilities
					     and their saves — is looked up with the skills, as the mock deals it -->
					{#if on === 'skills'}<Abilities {s} /><CombatStrip {s} tiles={false} />{/if}
					<PanelCard pid={on} {c} {s} asTab />
				</div>
			</section>
		{/each}
	</div>

	<div class="column-last"><Playbar withDice /></div>
</div>

<style>
	/* the whole play screen is the window's height: only the columns scroll, each on its own */
	.column-play {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		height: calc(100dvh - var(--column-play-top, 7rem));
		min-height: 24rem;
	}
	.panes {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: var(--space-1-5);
	}
	.pane {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.pane-tabs {
		flex: none;
		display: flex;
		gap: var(--space-3);
		padding: 0 var(--space-3);
		border-bottom: 1px solid var(--color-border);
		overflow-x: auto;
	}
	.pane-tab {
		padding: var(--space-2-5) 0 var(--space-2);
		margin-bottom: -1px;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted);
		white-space: nowrap;
		cursor: pointer;
	}
	.pane-tab.on {
		color: var(--color-text);
		font-weight: 600;
		border-bottom-color: var(--color-accent);
	}
	.pane-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0 var(--space-3) var(--space-2-5);
	}
	.column-last {
		flex: none;
	}
	.column-last :global(.playbar),
	.column-last :global(.last-roll) {
		width: 100%;
	}
</style>

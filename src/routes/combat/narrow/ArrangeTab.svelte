<script lang="ts">
	import Switch from '#lib/components/Switch.svelte';
	import type { CharacterUi } from '#lib/character/schema.ts';
	import { _ } from '#lib/i18n/index.ts';
	import { combat } from '../combat-view-model.svelte';

	let {
		layout,
		id,
		name,
	}: {
		layout: keyof CharacterUi['playTabsHidden'];
		id: string;
		name: string;
	} = $props();
	const label = $derived($_('combat.arrange.showTab', { values: { tab: name } }));
	const shown = $derived(combat.layout.tabShown(layout, id));
</script>

<div class="arrange-tab">
	<span>{label}</span>
	<Switch on={shown} title={label} onclick={() => combat.layout.toggleTabShown(layout, id)} />
</div>

<style>
	.arrange-tab {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		font-size: var(--font-size-sm);
	}
</style>

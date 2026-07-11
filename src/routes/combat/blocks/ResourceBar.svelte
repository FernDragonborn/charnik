<script lang="ts">
	// Resource tracker bar (shown when the character has any recharge-typed resources): a pip
	// tracker per resource (Ki, Rage, Channel Divinity…). Reads the `combat` view-model; the
	// resource definitions come from the derived sheet, passed in as a prop.
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../state.svelte';
	import { range } from '$lib/combat/helpers';

	let { s }: { s: CharacterSheet } = $props();
</script>

<section class="resource-bar">
	<span class="bar-label">Resources</span>
	{#each s.resources as r (r.id)}
		{@const spent = combat.resources.resourceSpent(r.id)}
		<span class="resource" title="{r.name} · recharges on {r.recharge} rest ({r.source})">
			{r.name}
			<span class="respips">
				{#each range(r.max) as i (i)}
					<button
						type="button"
						class="resource-pip"
						class:used={i >= r.max - spent}
						onclick={() => combat.resources.resourceClick(r.id, r.max, i)}
						aria-label="{r.name} {i + 1}"
					></button>
				{/each}
			</span>
			<small>{r.max - spent}/{r.max}</small>
		</span>
	{/each}
</section>

<style>
	.resource-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 9px 12px;
		margin-bottom: 12px;
	}
	.resource-bar .resource {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 5px 11px;
	}
	.resource-bar .resource small {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}
	.respips {
		display: inline-flex;
		gap: 4px;
	}
	.resource-pip {
		width: 12px;
		height: 12px;
		padding: 0;
		border: 1px solid var(--color-resource);
		border-radius: 50%;
		background: var(--color-resource);
		cursor: pointer;
	}
	.resource-pip.used {
		background: transparent;
		border-color: var(--color-border-strong);
	}
</style>

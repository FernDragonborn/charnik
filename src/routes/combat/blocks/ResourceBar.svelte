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
		<!-- the whole chip is the "use one" action (UBUG-8); the pips inside still set the count
		     manually and stop the chip's use-click -->
		<button
			type="button"
			class="resource"
			title="Use one {r.name} · recharges on {r.recharge} rest ({r.source})"
			onclick={() => combat.resources.useResource(r.id, r.max)}
		>
			{r.name}
			<span class="respips">
				{#each range(r.max) as i (i)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<span
						class="resource-pip"
						class:used={i >= r.max - spent}
						role="button"
						tabindex="-1"
						aria-label="{r.name} {i + 1}"
						onclick={(e) => {
							e.stopPropagation();
							combat.resources.resourceClick(r.id, r.max, i);
						}}
					></span>
				{/each}
			</span>
			<small>{r.max - spent}/{r.max}</small>
		</button>
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
	/* the whole chip is the "use one" button (UBUG-8) — clickable + highlighted on hover */
	.resource-bar .resource {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 5px 11px;
		cursor: pointer;
	}
	.resource-bar .resource small {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}
	.resource-bar .resource:hover {
		background: var(--color-border);
	}
	.respips {
		display: inline-flex;
		gap: 4px;
	}
	.resource-pip {
		display: inline-block;
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

<script lang="ts">
	// Actions panel body: standard actions (Show/hide-filtered), feature-granted rollables (Sneak
	// Attack, Bardic Inspiration…) and resource spend-options (Ki → Flurry) with a cost chip.
	import { combat } from '../../state.svelte';
	const visibleActions = $derived(combat.visibleActions);
</script>

{#each visibleActions as a (a.id)}
	<button class="combat-row" onclick={(e) => combat.actionClick(a, e)}>
		<span class="row-name">{a.name}</span><span class="combat-row-hint">{a.hint || '—'}</span>
		<span class="combat-row-desc">{a.desc}</span><span class="combat-row-marker">{a.marker}</span>
	</button>
{/each}
<!-- EFX-ROLL: feature-granted rollables (Sneak Attack Nd6, Bardic Inspiration die). The expr is
     already resolved to a formula in derive; tap opens the dice tray via the seam. -->
{#each combat.featureRolls as r (r.id + r.source)}
	<button class="combat-row" onclick={() => combat.rollFeature(r)}>
		<span class="row-name">{r.label}</span><span class="combat-row-hint">{r.formula}</span>
		<span class="combat-row-desc">{r.source}</span><span class="combat-row-marker">→ roll</span>
	</button>
{/each}
<!-- piece 3: resource spend-options (Ki → Flurry of Blows…) with a cost chip; disabled when the
     pool can't pay. Tap = afford-check + spend + surface the action. -->
{#each combat.resourceOptions as o (o.id)}
	<button
		class="combat-row"
		disabled={o.cost !== 'x' && o.left < o.cost}
		onclick={() => combat.resources.spendOption(o)}
	>
		<span class="row-name">{o.name}</span>
		<span class="combat-row-hint">
			<span class="cost-chip">{o.cost === 'x' ? 'X' : o.cost} {o.resourceId}</span>
		</span>
		<span class="combat-row-desc">{o.description}</span>
		<span class="combat-row-marker">{o.actionType.replace('_', ' ')}</span>
	</button>
{/each}

<style>
	/* piece 3: resource-option cost chip in the actions block */
	.cost-chip {
		display: inline-block;
		padding: 0 6px;
		border: 1px solid var(--color-accent);
		border-radius: 4px;
		color: var(--color-accent-bright);
		font-size: 0.8em;
		text-transform: capitalize;
	}
</style>

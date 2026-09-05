<script lang="ts">
	// Actions panel body: standard actions (Show/hide-filtered), feature-granted rollables (Sneak
	// Attack, Bardic Inspiration…) and resource spend-options (Ki → Flurry) with a cost chip.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { combat } from '../../combat-view-model.svelte';
	const visibleActions = $derived(combat.visibleActions);
</script>

{#each visibleActions as a (a.id)}
	<button class="combat-row" onclick={(e) => combat.actionClick(a, e)}>
		<span class="row-name">{$_(a.nameKey)}</span><span class="combat-row-hint">{a.hint || '—'}</span
		>
		<span class="combat-row-desc">{$_(a.descKey)}</span><span class="combat-row-marker"
			>{$_(a.markerKey)}</span
		>
	</button>
{/each}
<!-- EFX-ROLL: feature-granted rollables (Sneak Attack Nd6, Bardic Inspiration die). The expr is
     already resolved to a formula in derive; tap opens the dice tray via the seam. -->
{#each combat.featureRolls as r (r.id + r.source)}
	<button class="combat-row" onclick={() => combat.rollFeature(r)}>
		<span class="row-name">{r.label}</span><span class="combat-row-hint">{r.formula}</span>
		<span class="combat-row-desc">{r.source}</span><span class="combat-row-marker"
			>{$_('combat.panel.roll')} <Icon name="chevron-right" size={11} /></span
		>
	</button>
{/each}
<!-- piece 3: resource spend-options (Ki → Flurry of Blows…) with a cost chip; disabled when the
     pool can't pay. Tap = afford-check + spend + surface the action. -->
{#each combat.resourceOptions as o (o.id)}
	{@const broke = o.cost !== 'x' && o.left < o.cost}
	{@const blocked = !o.available || broke}
	<!-- blocked with `aria-disabled`, never `disabled`: the row's whole job when it can't be used is
	     to say WHY, and a disabled control takes neither hover nor focus, so its reason is unreadable
	     (ui.md ▸ rule 10). The click still lands — the executor refuses it with the same sentence. -->
	<button
		class="combat-row"
		class:is-blocked={blocked}
		aria-disabled={blocked}
		title={!o.available
			? $_('combat.actions.unavailable')
			: broke
				? $_('combat.actions.cantAfford', { values: { resource: o.resourceName } })
				: o.description}
		onclick={() => combat.activateResourceOption(o)}
	>
		<span class="row-name">{o.name}</span>
		<span class="combat-row-hint">
			<span class="cost-chip">{o.cost === 'x' ? 'X' : o.cost} {o.resourceName}</span>
		</span>
		<span class="combat-row-desc">{o.description}</span>
		<!-- a closed vocabulary reads from the catalog; `bonus_action` is not the word every language
		     uses, and it is not even the word English uses on the rest of this sheet -->
		<span class="combat-row-marker">{$_(`combat.actionType.${o.actionType}`)}</span>
	</button>
{/each}

<style>
	/* piece 3: resource-option cost chip in the actions block */
	.cost-chip {
		display: inline-block;
		padding: 0 var(--space-1-5);
		border: 1px solid var(--color-accent);
		border-radius: 4px;
		color: var(--color-accent-bright);
		font-size: 0.8em;
		text-transform: capitalize;
	}
</style>

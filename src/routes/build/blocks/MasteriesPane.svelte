<script lang="ts">
	// Weapon mastery (2024): which KINDS of weapon this character has drilled. The weapon's mastery
	// property is shipped data on every 2024 weapon and does nothing until a feature unlocks that
	// kind for you — so this is the pane that makes the property mean something, and the attack row
	// prints the mastery exactly when a pick here says it may be used.
	//
	// Chips, like every other capped grant in the builder: the cap comes from the class's own ladder
	// and at the cap a click replaces the oldest pick rather than doing nothing.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import { itemTagLabel } from '$lib/content/item-tags';
	const b = build;

	const cap = $derived(b.masteryPicks.cap);
	const picks = $derived(b.masteryPicks.picks);
	const options = $derived(b.masteryPicks.options);
</script>

{#if cap === 0}
	<p class="subtext">{$_('build.masteries.none')}</p>
{:else}
	<div class="counts">
		<span class={['tag', picks.length < cap && 'accent']}>
			{$_('build.masteries.picks', { values: { chosen: picks.length, cap } })}
		</span>
	</div>
	<p class="subtext">{$_('build.masteries.hint')}</p>
	{#if options.length}
		<div class="chips">
			{#each options as row (row.effectiveId)}
				{@const id = row.data.id}
				{@const mastery = b.masteryPicks.propertyOf(id)}
				<button class="pick-chip" class:on={picks.includes(id)} onclick={() => b.masteryPicks.toggle(id)}>
					{rowName(row)}<span class="prop gold">{itemTagLabel(mastery, $_)}</span>
				</button>
			{/each}
		</div>
	{:else}
		<p class="subtext">{$_('build.masteries.noWeapons')}</p>
	{/if}
{/if}

<style>
	/* the property is what the weapon is picked FOR, so it sits beside the name rather than under it —
	   the gap is the separator, because a punctuation mark between two nouns reads as a list */
	.prop {
		margin-inline-start: var(--space-1-5);
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
	}
</style>

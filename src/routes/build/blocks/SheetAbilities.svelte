<script lang="ts">
	// The six scores as the sheet shows them: score, modifier, and whether a save is proficient.
	// Clicking any of them opens the one allocator — they are never edited six different ways.
	// A score raised above what you rolled/bought reads in crimson, so a boost is visible at a glance.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { ABILITIES } from '$lib/character/schema';
	import { signed } from '$lib/util/format';
	import { why } from '$lib/combat/effects-view';
	import { provenance } from '$lib/actions/provenance';
	import { abilityProvenanceText } from '../ability-allocation.svelte';
	const b = build;

	const open = () => b.inspector.toggle({ id: 'abilities' });
	const active = $derived(b.inspector.isOpen({ id: 'abilities' }));
</script>

<div class="abilities">
	{#each ABILITIES as ab (ab)}
		{@const block = b.sheet?.abilities[ab]}
		{@const score = block?.score.value ?? b.draft.abilities[ab]}
		{@const boosted = score > b.draft.abilities[ab]}
		<button
			class="slot tile ability"
			class:active
			class:boosted
			use:provenance={block
				? why(block.score, $_)
				: abilityProvenanceText(b.abilities.provenance(ab, score), $_)}
			onclick={open}
		>
			<small>{ab}</small>
			<b>{score}</b>
			<span class="mod">{block ? signed(block.mod) : ''}</span>
			{#if block?.saveProficient}<span class="save" title={$_('build.vitals.saveProficient')}
					>{$_('build.vitals.save', { values: { mod: signed(block.save.value) } })}</span
				>{/if}
		</button>
	{/each}
</div>

<style>
	.abilities {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: var(--space-2);
	}
	.ability {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		background: var(--color-surface);
		border-color: var(--color-border);
		padding: var(--space-2-5) var(--space-1-5);
	}
	.ability.boosted b {
		color: var(--color-accent-bright);
	}
	.mod {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.save {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-resource);
	}

	@media (max-width: 620px) {
		.abilities {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>

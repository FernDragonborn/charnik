<script lang="ts">
	// A18-tail: the ONE prepared-spell cap readout, shared by the combat spells panel and the spellbook
	// so the two can't render the per-class figures differently. A single caster collapses to the plain
	// "Prepared X / Y"; a multiclass caster shows one "Class X/Y" chip per caster class. Renders purely
	// from the tallies (count + cap already attributed per class), so callers just pass them.
	import type { PreparedClassTally } from '$lib/combat/helpers';

	let { tallies }: { tallies: PreparedClassTally[] } = $props();
</script>

{#if tallies.length === 1 && tallies[0]}
	{@const only = tallies[0]}
	Prepared <b>{only.count}</b> / {only.cap}
{:else}
	{#each tallies as t (t.classId)}<span class="prep-cls"
			>{t.className} <b>{t.count}</b>/{t.cap}</span
		>{/each}
{/if}

<style>
	b {
		color: var(--color-resource);
	}
	.prep-cls + .prep-cls {
		margin-left: var(--space-2);
	}
</style>

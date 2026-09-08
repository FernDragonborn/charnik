<script lang="ts">
	// Everything countable this character owns: the pools their features granted (rage, ki, channel
	// divinity — whatever the class actually has, discovered from `grant_resource` effects, never a
	// hardcoded list). Read-only here; they are spent in the combat view.
	//
	// Hit dice are NOT a pool here. Every character has them, so a card per die type said nothing
	// about THIS character while taking a card's worth of room — and under the default ½-HP short
	// rest they are not even spent. They read as one tile in the vitals strip instead.
	import { _ } from '$lib/i18n';
	import { rechargeLabel } from '$lib/combat/helpers';
	import { sayText } from '$lib/util/say';
	import { build } from '../build-view-model.svelte';
	const b = build;

	const s = $derived(b.sheet);
	const resources = $derived(s?.resources ?? []);
	/** Above this many, a row of pips stops being countable at a glance and a number reads better. */
	const PIP_LIMIT = 12;
</script>

{#if resources.length}
	<div class="card">
		<div class="card-head">
			<span class="eyebrow">{$_('build.resources.title')}</span>
			<span class="spacer"></span>
			<span class="trail">{$_('build.resources.hint')}</span>
		</div>
		<div class="pools">
			{#each resources as r (r.id)}
				<div class="pool is-taken">
					<b>{r.name}</b>
					{#if r.max <= PIP_LIMIT}
						<div class="pips">
							{#each Array.from({ length: r.max }, (_, i) => i) as i (i)}<span class="pip"></span>{/each}
						</div>
					{:else}
						<span class="big">{r.max}</span>
					{/if}
					<small
							>{$_('build.resources.pool', {
								values: { max: r.max, recharge: sayText(rechargeLabel(r.recharge), $_), source: r.source }
							})}</small
						>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.pools {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: var(--space-2);
	}
	.pool {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		border-radius: var(--radius-md);
		padding: var(--space-2-5) var(--space-3);
	}
	.pool b {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.pool.is-taken b {
		color: var(--color-resource);
	}
	.pool small {
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.big {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-md);
		color: var(--color-resource);
	}
</style>

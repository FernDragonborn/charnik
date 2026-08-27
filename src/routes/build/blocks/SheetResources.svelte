<script lang="ts">
	// Everything countable this character owns: the pools their features granted (rage, ki, channel
	// divinity — whatever the class actually has, discovered from `grant_resource` effects, never a
	// hardcoded list) plus hit dice. Read-only here; they are spent in the combat view.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	const b = build;

	const s = $derived(b.sheet);
	const resources = $derived(s?.resources ?? []);
	/** The recharge vocabulary is a closed set in the effects grammar; the words for it are not. */
	const RECHARGE_KEY: Record<string, string> = {
		short: 'build.resources.rechargeShort',
		long: 'build.resources.rechargeLong',
		other: 'build.resources.rechargeOther'
	};
	const rechargeText = (r: string) => $_(RECHARGE_KEY[r] ?? 'build.resources.rechargeOther');
	/** Above this many, a row of pips stops being countable at a glance and a number reads better. */
	const PIP_LIMIT = 12;
</script>

{#if resources.length || s?.hitDice.length}
	<div class="card">
		<div class="card-head">
			<span class="eyebrow">{$_('build.resources.title')}</span>
			<span class="spacer"></span>
			<span class="trail">{$_('build.resources.hint')}</span>
		</div>
		<div class="pools">
			{#each resources as r (r.id)}
				<div class="pool gold">
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
								values: { max: r.max, recharge: rechargeText(String(r.recharge)), source: r.source }
							})}</small
						>
				</div>
			{/each}
			{#each s?.hitDice ?? [] as pool (pool.die)}
				<div class="pool">
					<b>{$_('build.resources.hitDice')}</b>
					{#if pool.max <= PIP_LIMIT}
						<div class="pips">
							{#each Array.from({ length: pool.max }, (_, i) => i) as i (i)}<span class="pip plain"></span>{/each}
						</div>
					{:else}
						<span class="big">{pool.max}</span>
					{/if}
					<small
							>{$_('build.resources.hitDicePool', {
								values: {
									max: pool.max,
									die: pool.die,
									recharge: $_(
										b.draft.shortRestMode === 'dice'
											? 'build.resources.spendOnShortRest'
											: 'build.resources.halfInstead'
									)
								}
							})}</small
						>
				</div>
			{/each}
		</div>
		{#if !resources.length}
			<p class="subtext note">
				{b.classRow
					? $_('build.resources.noneForClass', { values: { class: rowName(b.classRow) } })
					: $_('build.resources.needClass')}
			</p>
		{/if}
	</div>
{/if}

<style>
	.pools {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 9px;
	}
	.pool {
		display: flex;
		flex-direction: column;
		gap: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		border-radius: var(--radius-md);
		padding: 10px 12px;
	}
	.pool.gold {
		border-color: var(--color-resource-line);
		background: var(--color-resource-soft);
	}
	.pool b {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.pool.gold b {
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

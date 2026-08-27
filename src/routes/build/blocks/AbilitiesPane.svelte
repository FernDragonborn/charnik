<script lang="ts">
	// The one allocator: how the six scores are generated, the scores themselves, and every boost
	// layered on top of them (5.5e background choice, a 5e species' floating ASI). Each row shows its
	// own provenance line, so a total that isn't what you typed says why.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import { ABILITIES } from '$lib/character/schema';
	import { signed } from '$lib/util/format';
	import { POINT_BUY_BUDGET, type StatMethod } from '$lib/build/rules';
	import { abilityProvenanceText } from '../ability-allocation.svelte';
	const b = build;

	/** id → its two catalog keys. The method list is the closed vocabulary; the words are not. */
	const METHODS: { id: StatMethod; labelKey: string; hintKey: string }[] = [
		{ id: 'point_buy', labelKey: 'pointBuy', hintKey: 'pointBuyHint' },
		{ id: 'standard_array', labelKey: 'standardArray', hintKey: 'standardArrayHint' },
		{ id: 'manual', labelKey: 'manual', hintKey: 'manualHint' }
	];
	const method = $derived(METHODS.find((m) => m.id === b.draft.method));
</script>

<div class="methods">
	{#each METHODS as m (m.id)}
		<button class="pick-chip" class:on={b.draft.method === m.id} onclick={() => b.abilities.setMethod(m.id)}>
			{$_(`build.abilities.${m.labelKey}`)}
		</button>
	{/each}
	{#if b.draft.method === 'point_buy'}
		<span class="points">
			<b class:over={b.abilities.pointsLeft < 0}>{b.abilities.pointsLeft}</b>
			/ {POINT_BUY_BUDGET}
		</span>
	{/if}
</div>
<p class="subtext">
	{method ? $_(`build.abilities.${method.hintKey}`, { values: { budget: POINT_BUY_BUDGET } }) : ''}
</p>

<div class="rows">
	{#each ABILITIES as ab (ab)}
		{@const block = b.sheet?.abilities[ab]}
		<div class="arow">
			<span class="code">{ab}</span>
			{#if b.draft.method === 'standard_array'}
				<select
					class="bare"
					aria-label={$_('build.abilities.scoreLabel', { values: { ability: ab.toUpperCase() } })}
					value={b.draft.arrayPick[ab] ?? ''}
					onchange={(e) =>
						b.abilities.assignArray(ab, e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
				>
					<option value="">—</option>
					{#if b.draft.arrayPick[ab] != null}<option value={b.draft.arrayPick[ab]}>{b.draft.arrayPick[ab]}</option>{/if}
					{#each b.abilities.arrayRemaining as v (v)}<option value={v}>{v}</option>{/each}
				</select>
			{:else}
				<span class="stepper">
					<button aria-label={$_('build.abilities.lower', { values: { ability: ab.toUpperCase() } })} onclick={() => b.abilities.bumpAbility(ab, -1)}><Icon name="minus" size={12} /></button>
					<span class="base">{b.draft.abilities[ab]}</span>
					<button aria-label={$_('build.abilities.raise', { values: { ability: ab.toUpperCase() } })} onclick={() => b.abilities.bumpAbility(ab, 1)}><Icon name="plus" size={12} /></button>
				</span>
			{/if}
			<span class="note">{abilityProvenanceText(b.abilities.provenance(ab, block?.score.value), $_)}</span>
			<span class="total">
				{block?.score.value ?? b.draft.abilities[ab]}
				<small>{block ? signed(block.mod) : ''}</small>
			</span>
		</div>
	{/each}
</div>

{#if b.abilities.boostCarrier === 'background' && b.abilities.backgroundBoostChoices.length}
	<div class="boost">
		<span class="eyebrow"
			>{$_('build.abilities.backgroundBoost', { values: { background: rowName(b.backgroundRow) } })}</span
		>
		<div class="segment-group small" role="group" aria-label={$_('build.abilities.boostShape')}>
			<button class:on={b.draft.boostShape === '2-1'} onclick={() => (b.draft.boostShape = '2-1')}>{$_('build.abilities.shape21')}</button>
			<button class:on={b.draft.boostShape === '1-1-1'} onclick={() => (b.draft.boostShape = '1-1-1')}>{$_('build.abilities.shape111')}</button>
		</div>
		<div class="chips">
			{#each b.abilities.backgroundBoostChoices as ab (ab)}
				<button class="pick-chip" class:on={b.draft.boostPicks.includes(ab)} onclick={() => b.abilities.toggleBoostPick(ab)}>
					{ab.toUpperCase()}{#if b.abilities.backgroundBoosts[ab]}<span class="gold"> +{b.abilities.backgroundBoosts[ab]}</span>{/if}
				</button>
			{/each}
		</div>
	</div>
{:else if b.abilities.boostCarrier === 'species'}
	{#if b.speciesBoostChoice}
		<div class="boost">
			<span class="eyebrow">
				{$_('build.abilities.speciesChoice', {
					values: {
						species: rowName(b.speciesOptionRow) || rowName(b.speciesRow),
						count: b.speciesBoostChoice.count,
						amount: b.speciesBoostChoice.amount
					}
				})}
				<span class="gold">{b.draft.speciesBoostPicks.length}/{b.speciesBoostChoice.count}</span>
			</span>
			<div class="chips">
				{#each b.speciesBoostAbilities as ab (ab)}
					<button class="pick-chip" class:on={b.draft.speciesBoostPicks.includes(ab)} onclick={() => b.toggleSpeciesBoostPick(ab)}>
						{ab.toUpperCase()}
					</button>
				{/each}
			</div>
		</div>
	{:else}
		<p class="subtext note">{$_('build.abilities.speciesAutomatic')}</p>
	{/if}
{/if}

<style>
	.methods {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.points {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.points b {
		color: var(--color-good);
	}
	.points b.over {
		color: var(--color-danger);
	}
	.rows {
		display: flex;
		flex-direction: column;
	}
	.arow {
		display: grid;
		grid-template-columns: 34px 104px minmax(0, 1fr) 66px;
		align-items: center;
		gap: 9px;
		padding: 7px 0;
		border-top: 1px solid var(--color-border);
	}
	.arow:first-of-type {
		border-top: 0;
	}
	.code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--color-text-muted);
	}
	.note {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.total {
		text-align: right;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h6);
	}
	.total small {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-weight: 500;
		margin-left: 4px;
	}
	.boost {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 11px;
		border-top: 1px solid var(--color-border);
	}
</style>

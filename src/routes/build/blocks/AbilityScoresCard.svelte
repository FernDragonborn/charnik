<script lang="ts">
	// Ability scores card: stat-generation method (point buy / standard array / manual), the six
	// ability rows with live totals + provenance, and the ability-boost allocator (5.5e background
	// choice or the 5e species free-choice ASI).
	import { build, rowName } from '../state.svelte';
	import { ABILITIES } from '$lib/character/schema';
	import { signed } from '$lib/util/format';
	import type { StatMethod } from '$lib/build/rules';
	const b = build;
	const METHODS: { id: StatMethod; label: string }[] = [
		{ id: 'point_buy', label: 'Point buy' },
		{ id: 'standard_array', label: 'Standard array' },
		{ id: 'manual', label: 'Manual' }
	];
</script>

<div class="card">
	<div class="statgenhead">
		<div class="method">
			{#each METHODS as m (m.id)}
				<button class="method-seg" class:on={b.draft.method === m.id} onclick={() => b.setMethod(m.id)}>{m.label}</button>
			{/each}
		</div>
		{#if b.draft.method === 'point_buy'}
			<span class="points">Points <b class:over={b.pointsLeft < 0}>{b.pointsLeft}</b> / 27</span>
		{/if}
	</div>

	{#each ABILITIES as ab (ab)}
		{@const block = b.sheet?.abilities[ab]}
		<div class="stat-row">
			<span class="ability-code">{ab}</span>
			{#if b.draft.method === 'standard_array'}
				<select class="arraysel bare" value={b.draft.arrayPick[ab] ?? ''} onchange={(e) => b.assignArray(ab, e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}>
					<option value="">—</option>
					{#if b.draft.arrayPick[ab] != null}<option value={b.draft.arrayPick[ab]}>{b.draft.arrayPick[ab]}</option>{/if}
					{#each b.arrayRemaining as v (v)}<option value={v}>{v}</option>{/each}
				</select>
			{:else}
				<span class="stepper">
					<button aria-label="lower {ab}" onclick={() => b.bumpAbility(ab, -1)}>−</button>
					<span class="base">{b.draft.abilities[ab]}</span>
					<button aria-label="raise {ab}" onclick={() => b.bumpAbility(ab, 1)}>+</button>
				</span>
			{/if}
			<span class="bonus">{b.abilityNote(ab)}</span>
			<span class="total">{block?.score.value ?? b.draft.abilities[ab]} <small>{block ? signed(block.mod) : ''}</small></span>
		</div>
	{/each}

	{#if b.boostCarrier === 'background' && b.backgroundBoostChoices.length}
		<div class="boost">
			<p class="subtext">5.5e background boost — on your <b class="gold">{rowName(b.backgroundRow)}</b> abilities</p>
			<div class="segment-group small">
				<button class:on={b.draft.boostShape === '2-1'} onclick={() => (b.draft.boostShape = '2-1')}>+2 / +1</button>
				<button class:on={b.draft.boostShape === '1-1-1'} onclick={() => (b.draft.boostShape = '1-1-1')}>+1 / +1 / +1</button>
			</div>
			<div class="chips spaced">
				{#each b.backgroundBoostChoices as ab (ab)}
					<button class="pick-chip" class:on={b.draft.boostPicks.includes(ab)} onclick={() => b.toggleBoostPick(ab)}>
						{ab.toUpperCase()}{#if b.backgroundBoosts[ab]}<span class="gold"> +{b.backgroundBoosts[ab]}</span>{/if}
					</button>
				{/each}
			</div>
		</div>
	{:else if b.boostCarrier === 'species'}
		<p class="subtext note">5e species ability bonuses apply automatically from the species entry.</p>
		{#if b.speciesBoostChoice}
			<div class="boost">
				<p class="subtext">
					{rowName(b.speciesOptionRow) || rowName(b.speciesRow)} — choose
					<b class="gold">{b.speciesBoostChoice.count}</b> to raise by +{b.speciesBoostChoice.amount}
					<span class="count">{b.draft.speciesBoostPicks.length}/{b.speciesBoostChoice.count}</span>
				</p>
				<div class="chips spaced">
					{#each b.speciesBoostAbilities as ab (ab)}
						<button
							class="pick-chip"
							class:on={b.draft.speciesBoostPicks.includes(ab)}
							onclick={() => b.toggleSpeciesBoostPick(ab)}
						>
							{ab.toUpperCase()}{#if b.draft.speciesBoostPicks.includes(ab)}<span class="gold"> +{b.speciesBoostChoice.amount}</span>{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.statgenhead {
		display: flex;
		align-items: center;
		margin-bottom: 12px;
	}
	.method {
		display: flex;
		gap: 6px;
	}
	.method-seg {
		all: unset;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		padding: 6px 12px;
		border-radius: var(--radius);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.method-seg.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
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
	.stat-row {
		display: grid;
		grid-template-columns: 40px 108px 1fr 76px;
		align-items: center;
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid var(--color-border);
	}
	.stat-row:first-of-type {
		border-top: 0;
	}
	.ability-code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.arraysel {
		width: max-content;
	}
	.bonus {
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
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
</style>

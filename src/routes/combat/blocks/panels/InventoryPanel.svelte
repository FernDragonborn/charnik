<script lang="ts">
	// N1: what the character is carrying, at play time. The builder decides WHAT is owned; this panel
	// is the four things that change mid-session — equip, attune, how many, use one up — plus the load
	// bar, which is the only place carrying capacity has ever been shown (it was computed and never
	// rendered). Adding an item is still the builder's equipment pane: that is a search through
	// hundreds of rows, not a play action.
	import Icon from '$lib/components/Icon.svelte';
	import { base } from '$app/paths';
	import { combat } from '../../combat-view-model.svelte';
	import { ATTUNEMENT_CAP } from '$lib/character/inventory';
	import { kilograms } from '$lib/combat/constants';

	const inv = $derived(combat.inventory);
	const rows = $derived(inv.rows);
</script>

<div class="load">
	<span class="eyebrow">Load</span>
	<span class="load-figure">
		<b>{Math.round(inv.carriedLb)}</b> / {inv.capacityLb} lb
		<span class="metric">({kilograms(inv.carriedLb)} / {kilograms(inv.capacityLb)})</span>
	</span>
	<span class="spacer"></span>
	<span class="attune" class:full={inv.attunementFull}>
		attuned {inv.attuned}/{ATTUNEMENT_CAP}
	</span>
</div>
<div class="meter" class:good={!inv.overCapacity} class:over={inv.overCapacity}>
	<span style:width="{inv.load * 100}%"></span>
</div>
{#if inv.overCapacity}
	<p class="note">Over capacity — speed drops and every check that uses it suffers. Your call.</p>
{/if}

<div class="items">
	{#each rows as row (row.entry.item)}
		<div class="inv-row">
			<span class="nm">{row.name}</span>
			{#if row.entry.qty > 1}<span class="qty-tag">×{row.entry.qty}</span>{/if}
			<span class="meta">{row.meta}</span>
			{#if row.weightLb}<span class="wt">{row.weightLb} lb</span>{/if}
			<span class="acts">
				<span class="stepper">
					<button aria-label="One fewer {row.name}" onclick={() => inv.bump(row.entry.item, -1)}>
						<Icon name="minus" size={11} />
					</button>
					<span class="base">{row.entry.qty}</span>
					<button aria-label="One more {row.name}" onclick={() => inv.bump(row.entry.item, 1)}>
						<Icon name="plus" size={11} />
					</button>
				</span>
				{#if row.consumable}
					<button class="pill-btn" onclick={() => inv.use(row.entry.item)}>Use</button>
				{/if}
				{#if row.equippable}
					<button
						class="pill-btn"
						class:accent={row.entry.equipped}
						onclick={() => inv.equip(row.entry.item)}
						title={row.entry.equipped ? 'Take it off' : 'Wear or wield it'}
					>
						{row.entry.equipped ? 'Equipped' : 'Equip'}
					</button>
				{/if}
				{#if row.attunable}
					<button
						class="pill-btn"
						class:accent={row.entry.attuned}
						onclick={() => inv.attune(row.entry.item)}
						title={row.entry.attuned ? 'Break attunement' : 'Attune to it'}
					>
						{row.entry.attuned ? 'Attuned' : 'Attune'}
					</button>
				{/if}
			</span>
		</div>
	{:else}
		<p class="note">
			Nothing carried yet. Equipment is added in the builder — <a href="{base}/build">open it</a>.
		</p>
	{/each}
</div>

<style>
	.load {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 6px;
	}
	.spacer {
		flex: 1;
	}
	.load-figure {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.load-figure b {
		color: var(--color-text);
		font-size: var(--font-size-sm);
	}
	.metric {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
	}
	.attune {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.attune.full {
		color: var(--color-resource);
	}
	.meter.over > span {
		background: var(--color-danger);
	}
	.note {
		margin: 8px 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.items {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 10px;
	}
	.inv-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 9px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-2);
	}
	.nm {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}
	.qty-tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-resource);
	}
	.meta {
		flex: 1;
		min-width: 0;
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wt {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.acts {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.stepper button {
		width: 22px;
		height: 22px;
	}
	.stepper .base {
		font-size: var(--font-size-sm);
		min-width: 20px;
	}
</style>

<script lang="ts">
	// What the character carries, and whether they can carry it. Equipping is here rather than in the
	// inspector because it is a one-click state on a row you are already looking at; ADDING an item is
	// a search through hundreds of rows, which is what the inspector's equipment pane is for.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { build, rowName, rowOfType } from '../build-view-model.svelte';
	import { why } from '$lib/combat/effects-view';
	const b = build;

	const s = $derived(b.sheet);
	/** Carried weight — a number the sheet can show only because items carry one. */
	const carried = $derived(
		b.draft.inventory.reduce((lb, entry) => {
			const row = rowOfType(b.row(entry.item), 'item');
			return lb + Number(row?.data.weight_lb ?? 0) * entry.qty;
		}, 0)
	);
	const capacity = $derived(s?.carryingCapacity.value ?? 0);
	const load = $derived(capacity > 0 ? Math.min(1, carried / capacity) : 0);
</script>

<div class="card">
	<div class="card-head">
		<span class="eyebrow">{$_('build.inventory.title')}</span>
		<span class="spacer"></span>
		<span class="trail">{$_('build.inventory.itemCount', { values: { count: b.draft.inventory.length } })}</span>
		<button
			class="pill-btn"
			class:accent={b.inspector.isOpen({ id: 'inventory' })}
			onclick={() => b.inspector.toggle({ id: 'inventory' })}
		>
			<Icon name="plus" size={12} /> {$_('build.inventory.add')}
		</button>
	</div>

	<div class="split">
		<div class="items">
			{#each b.draft.inventory as entry (entry.item)}
				{@const row = rowOfType(b.row(entry.item), 'item')}
				<div class="item">
					<span class="iname">{rowName(row) || entry.item}</span>
					<span class="imeta">
						{#if row?.data.ac}AC {row.data.ac}{/if}
						{#if row?.data.damage}{row.data.damage}{/if}
					</span>
					<span class="stepper qty">
						<button aria-label={$_('build.inventory.fewer')} onclick={() => b.bumpItemQty(entry.item, -1)}><Icon name="minus" size={11} /></button>
						<span class="base">{entry.qty}</span>
						<button aria-label={$_('build.inventory.more')} onclick={() => b.bumpItemQty(entry.item, 1)}><Icon name="plus" size={11} /></button>
					</span>
					{#if b.itemEquippable(entry.item)}
						<button class="pick-chip" class:on={entry.equipped} onclick={() => b.toggleItemEquipped(entry.item)}>
							{$_(entry.equipped ? 'build.inventory.equipped' : 'build.inventory.equip')}
						</button>
					{/if}
					<button
						class="icon-button"
						aria-label={$_('build.inventory.remove', { values: { name: rowName(row) } })}
						onclick={() => b.removeInventoryItem(entry.item)}
					>
						<Icon name="x" size={11} />
					</button>
				</div>
			{:else}
				<p class="subtext">{$_('build.inventory.empty')}</p>
			{/each}
		</div>

		<div class="load">
			<div class="card-head"><span class="eyebrow">{$_('build.inventory.load')}</span></div>
			<div class="facts">
				<b>{$_('build.inventory.carrying')}</b><span
					>{$_('build.inventory.weight', {
						values: { lb: Math.round(carried), kg: Math.round(carried * 0.45) }
					})}</span
				>
				<b>{$_('build.inventory.capacity')}</b><span title={s ? why(s.carryingCapacity) : ''}
					>{$_('build.inventory.pounds', { values: { lb: capacity } })}</span
				>
			</div>
			<div class="meter good" style:margin-top="8px">
				<span style:width="{load * 100}%"></span>
			</div>
			<p class="subtext note">
				{#if capacity && carried > capacity}{$_('build.inventory.overCapacity')}
				{:else if capacity}{$_('build.inventory.encumbranceAt', {
						values: { lb: Math.round(capacity / 3) }
					})}
				{:else}{$_('build.inventory.needBasics')}{/if}
			</p>
		</div>
	</div>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 220px;
		gap: 16px;
		align-items: start;
	}
	.items {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 5px 9px;
	}
	.iname {
		flex: 1;
		min-width: 0;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.imeta {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.qty button {
		width: 22px;
		height: 22px;
	}
	.qty .base {
		font-size: var(--font-size-sm);
		min-width: 22px;
	}

	@media (max-width: 700px) {
		.split {
			grid-template-columns: 1fr;
		}
	}
</style>

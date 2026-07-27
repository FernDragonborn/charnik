<script lang="ts">
	// Inventory / starting-equipment card (creation only — managed in the play view afterwards):
	// add items, adjust qty, equip armor/shield/weapon, remove.
	import { build, rowName } from '../state.svelte';
	const b = build;
</script>

<div class="card">
	<h2>Inventory <span class="count">{b.draft.inventory.length}</span></h2>
	<label class="field">
		<span>Add item</span>
		<select
			value=""
			onchange={(e) => {
				b.addInventoryItem(e.currentTarget.value);
				e.currentTarget.value = '';
			}}
		>
			<option value="">— add an item —</option>
			{#each b.itemList as r (r.effectiveId)}<option value={r.effectiveId}>{rowName(r)}</option>{/each}
		</select>
	</label>
	{#if b.draft.inventory.length}
		<div class="invlist">
			{#each b.draft.inventory as it (it.item)}
				<div class="inventory-row">
					<span class="invname">{rowName(b.graph?.get(it.item))}</span>
					<span class="inventory-qty">
						<button onclick={() => b.bumpItemQty(it.item, -1)} aria-label="Fewer">−</button>
						<b>{it.qty}</b>
						<button onclick={() => b.bumpItemQty(it.item, 1)} aria-label="More">+</button>
					</span>
					{#if b.itemEquippable(it.item)}
						<button
							class="pick-chip"
							class:on={it.equipped}
							onclick={() => b.toggleItemEquipped(it.item)}
							>{it.equipped ? 'Equipped' : 'Equip'}</button
						>
					{/if}
					<button
						class="icon-button"
						onclick={() => b.removeInventoryItem(it.item)}
						aria-label="Remove">✕</button
					>
				</div>
			{/each}
		</div>
	{:else}
		<p class="subtext">No items yet — add starting equipment.</p>
	{/if}
</div>

<style>
	.invlist {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}
	.inventory-row {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 6px 10px;
	}
	.invname {
		flex: 1;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.inventory-qty {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}
	.inventory-qty button {
		width: 22px;
		height: 22px;
		border: 1px solid var(--color-border);
		border-radius: 5px;
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}
	.icon-button:hover {
		color: var(--color-danger);
	}
</style>

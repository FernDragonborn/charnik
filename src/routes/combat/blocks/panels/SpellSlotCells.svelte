<script lang="ts">
	import { rowGrid } from '#lib/actions/rowGrid.ts';
	import SlotPips from '#lib/components/SlotPips.svelte';
	import { _ } from '#lib/i18n/index.ts';
	import { PACT_SLOT_KEY } from '#lib/rules/spellcasting.ts';
	import { walkInlineOptions } from '#lib/util/option-walk.ts';
	import { combat } from '../../combat-view-model.svelte';

	const slots = $derived(combat.casting.slotReadings);
	const keys = $derived(slots.map((slot) => slot.key));
	let picked = $state('');
	const active = $derived(slots.find((slot) => slot.key === picked) ?? slots[0]);
	const cellId = (key: string) => `spell-slot-cell-${key}`;
	const rank = (level: number) => $_('spellLevel.nth', { values: { level } });

	function walkCells(event: KeyboardEvent, key: string): void {
		walkInlineOptions(event, {
			ids: keys,
			previewId: key,
			onpreview: (choice) => {
				picked = choice;
				document.getElementById(cellId(choice))?.focus();
			},
		});
	}
</script>

{#if active}
	<div class="spell-slot-cells" role="tablist" aria-label={$_('combat.spells.slotCells')}>
		{#each slots as slot (slot.key)}
			{@const name =
				slot.key === PACT_SLOT_KEY
					? $_('combat.spells.pactMagic', { values: { level: slot.level } })
					: rank(slot.level)}
			<button
				id={cellId(slot.key)}
				type="button"
				role="tab"
				aria-controls="spell-slot-line"
				aria-selected={active.key === slot.key}
				tabindex={active.key === slot.key ? 0 : -1}
				aria-label={$_('combat.spells.slotReading', {
					values: { name, left: slot.left, full: slot.full },
				})}
				onclick={() => (picked = slot.key)}
				onkeydown={(event) => walkCells(event, slot.key)}
			>
				<span>{slot.key === PACT_SLOT_KEY ? $_('combat.spells.pactRank') : rank(slot.level)}</span>
				<b>{slot.left}</b>
			</button>
		{/each}
	</div>
	<div
		class="spell-slot-line"
		id="spell-slot-line"
		role="tabpanel"
		aria-labelledby={cellId(active.key)}
		use:rowGrid={'.spell-slot-pips'}
	>
		<span class="eyebrow">
			{active.key === PACT_SLOT_KEY
				? $_('combat.spells.pactMagic', { values: { level: active.level } })
				: rank(active.level)}
		</span>
		<span class="spell-slot-pips">
			<SlotPips
				full={active.full}
				spent={active.spent}
				title={$_('combat.spells.slotPip')}
				onpick={(index) => combat.resources.slotClick(active.key, active.full, active.spent, index)}
			/>
		</span>
	</div>
{/if}

<style>
	.spell-slot-cells {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: var(--space-1);
		margin-block: var(--space-2);
	}
	.spell-slot-cells button {
		display: grid;
		justify-items: center;
		min-inline-size: 0;
		padding: var(--space-1) 0;
		border: thin solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		font-size: var(--font-size-micro);
		cursor: pointer;
	}
	.spell-slot-cells button[aria-selected='true'] {
		border-color: var(--color-good);
	}
	.spell-slot-cells b {
		color: var(--color-resource);
		font-size: var(--font-size-xs);
	}
	.spell-slot-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
</style>

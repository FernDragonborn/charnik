<script lang="ts">
	// What the character carries, and whether they can carry it. Equipping is here rather than in the
	// inspector because it is a one-click state on a row you are already looking at; ADDING an item is
	// a search through hundreds of rows, which is what the inspector's equipment pane is for.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { build, rowName, rowOfType } from '../build-view-model.svelte';
	import {
		asksWhichOne,
		type InstanceAnswers,
		type InstanceQuestions,
	} from '$lib/content/item-instance';
	import ItemInstanceAsk from './ItemInstanceAsk.svelte';
	import { askAgain, type InstanceAsk } from '../item-instance-picking.svelte';
	import type { DraftState } from '../draft';
	import { why } from '$lib/combat/effects-view';
	import { provenance } from '$lib/actions/provenance';
	import { kilograms } from '$lib/combat/constants';
	import { tagInt, ITEM_TAG } from '$lib/content/item-tags';
	import { resolveItem } from '$lib/content/resolved-item';
	import { purseSaid } from '../starting-kit-picks.svelte';
	const b = build;

	const s = $derived(b.sheet);
	/** Carried weight — a number the sheet can show only because items carry one. */
	const carried = $derived(
		b.draft.inventory.reduce((lb, entry) => {
			const row = rowOfType(b.row(entry.item), 'item');
			// through `resolveItem`: a magic weapon's own weight cell is blank and the weapon it IS
			// carries the pounds
			const weight = row && b.graph ? resolveItem(b.graph, row, entry.base ?? undefined).weightLb : 0;
			return lb + weight * entry.qty;
		}, 0)
	);
	const capacity = $derived(s?.carryingCapacity.value ?? 0);
	// the coins the taken kits hand over — the purse the character is created with
	const purse = $derived(purseSaid(b.kit.coins, $_));
	const load = $derived(capacity > 0 ? Math.min(1, carried / capacity) : 0);

	/** The question asked again from a carried row's name, and which row it is for. */
	let reasking = $state<{ ask: InstanceAsk; row: string } | null>(null);
	const reask = (
		entry: DraftState['inventory'][number],
		heading: string,
		questions: InstanceQuestions,
		anchor: HTMLElement,
	) => {
		reasking = { row: entry.iid, ask: askAgain(entry, heading, questions, anchor) };
	};
	const answerReask = (answers: InstanceAnswers) => {
		const row = reasking?.row;
		reasking = null;
		if (row) b.inventory.reanswer(row, answers);
	};
</script>

<div class="card">
	<div class="card-head">
		<span class="eyebrow">{$_('build.inventory.title')}</span>
		<span class="spacer"></span>
		<span class="trail">{$_('build.inventory.itemCount', { values: { count: b.draft.inventory.length } })}</span>
		{#if b.kit.kits.length}
			<button
				class="pill-btn"
				class:accent={b.inspector.isOpen({ id: 'startingEquipment' })}
				onclick={() => b.inspector.toggle({ id: 'startingEquipment' })}
			>
				{$_('build.spec.startingEquipmentTitle')}
			</button>
		{/if}
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
			{#each b.draft.inventory as entry (entry.iid)}
				{@const item = b.inventory.resolved(entry.item, entry.base)}
				{@const name = b.inventory.nameOf(entry)}
				{@const questions = b.inventory.questionsOf(entry.item)}
				{@const ac = item ? tagInt(item.tags, ITEM_TAG.ac) : null}
				<div class="item">
					<!-- asked which one it is when it was added, and asked again from its name -->
					{#if asksWhichOne(questions)}
						<button
							type="button"
							class="iname name-button"
							aria-haspopup="dialog"
							title={$_('combat.inventory.reask', { values: { name } })}
							onclick={(e) =>
								reask(entry, rowName(b.row(entry.item)) || name, questions, e.currentTarget)}
							>{name}</button
						>
					{:else}
						<span class="iname">{name}</span>
					{/if}
					<span class="imeta">
						{#if ac !== null}{$_('build.vitals.ac')}&nbsp;{ac}{/if}
						{#if item?.damage}{item.damage}{/if}
					</span>
					<span class="stepper qty">
						<button aria-label={$_('build.inventory.fewer')} onclick={() => b.inventory.bumpQty(entry.iid, -1)}><Icon name="minus" size={11} /></button>
						<span class="base">{entry.qty}</span>
						<button aria-label={$_('build.inventory.more')} onclick={() => b.inventory.bumpQty(entry.iid, 1)}><Icon name="plus" size={11} /></button>
					</span>
					{#if b.inventory.equippable(entry.item)}
						<button class="pick-chip" class:on={entry.equipped} onclick={() => b.inventory.toggleEquipped(entry.iid)}>
							{$_(entry.equipped ? 'build.inventory.equipped' : 'build.inventory.equip')}
						</button>
					{/if}
					<button
						class="icon-button"
						aria-label={$_('build.inventory.remove', { values: { name } })}
						onclick={() => b.inventory.remove(entry.iid)}
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
						values: { lb: Math.round(carried), kg: kilograms(carried) }
					})}</span
				>
				{#if purse}<b>{$_('build.inventory.purse')}</b><span>{purse}</span>{/if}
				<b>{$_('build.inventory.capacity')}</b><span use:provenance={s ? why(s.carryingCapacity, $_) : ''}
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

{#if reasking}
	<ItemInstanceAsk ask={reasking.ask} onanswer={answerReask} oncancel={() => (reasking = null)} />
{/if}

<style>
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 220px;
		gap: var(--space-4);
		align-items: start;
	}
	.items {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-1) var(--space-2);
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

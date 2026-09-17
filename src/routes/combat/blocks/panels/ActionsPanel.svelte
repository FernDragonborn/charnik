<script lang="ts">
	// Actions panel body: standard actions (Show/hide-filtered), feature-granted rollables (Sneak
	// Attack, Bardic Inspiration…) and resource spend-options (Ki → Flurry) with a cost chip.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { combat } from '../../combat-view-model.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import RowGrip from '../RowGrip.svelte';
	import { ROW_PANEL } from '$lib/combat/row-order';
	import type { StandardAction } from '$lib/combat/helpers';
	const visibleActions = $derived(
		combat.layout.ordered(ROW_PANEL.actions, combat.visibleActions, (a) => a.id),
	);

	/* Only the STANDARD actions are the player's to order. The two lists below them are what the
	   character's own features and resources grant: their order follows the thing that granted them,
	   and a hand-sorted Sneak Attack floating above the action that fires it would be saying something
	   the sheet does not mean. */
	let dragging = $state<{ id: string; a: StandardAction }[] | null>(null);
	/* the item carries its ROW — see `AttacksPanel` for what a lookup by id cost the shadow item */
	const items = $derived(dragging ?? visibleActions.map((a) => ({ id: a.id, a })));
</script>

<div
	class="dnd-rows"
	use:dndzone={{
		items,
		type: 'action-row',
		flipDurationMs: 150,
		dropTargetStyle: {},
		morphDisabled: true,
	}}
	onconsider={(e) => (dragging = e.detail.items)}
	onfinalize={(e) => {
		dragging = null;
		combat.layout.setRowOrder(
			ROW_PANEL.actions,
			e.detail.items.map((i) => i.id),
		);
	}}
>
	{#each items as item (item.id)}
		{@const a = item.a}
		{#if a}
			<div class="row-wrap">
				<RowGrip
					panel={ROW_PANEL.actions}
					id={a.id}
					name={$_(a.nameKey)}
					onmove={(by) =>
						combat.layout.moveRow(
							ROW_PANEL.actions,
							visibleActions.map((x) => x.id),
							a.id,
							by,
						)}
				/>
				<button class="combat-row" onclick={(e) => combat.actionClick(a, e)}>
					<span class="row-name">{$_(a.nameKey)}</span><span class="combat-row-hint"
						>{a.hint || '—'}</span
					>
					<span class="combat-row-desc">{$_(a.descKey)}</span><span class="combat-row-marker"
						>{$_(a.markerKey)}</span
					>
				</button>
			</div>
		{/if}
	{/each}
</div>
<!-- EFX-ROLL: feature-granted rollables (Sneak Attack Nd6, Bardic Inspiration die). The expr is
     already resolved to a formula in derive; tap opens the dice tray via the seam. -->
{#each combat.featureRolls as r (r.id + r.source)}
	{@const used = combat.economy.isRollUsed(r.id)}
	<div class="combat-row feature-roll" class:is-blocked={used}>
		<button class="roll-part" onclick={() => combat.rollFeature(r)}>
			<span class="row-name">{r.label}</span><span class="combat-row-hint">{r.formula}</span>
			<span class="combat-row-desc">{r.source}</span>
		</button>
		<!-- "used this turn" is the PLAYER's mark: only some granted rolls are once-per-turn (Sneak
		     Attack is), the content does not say which, and a marker that set itself would invent a
		     limit. Shown only while a turn is being tracked, because that is what clears it. -->
		{#if combat.character?.play.inCombat}
			<button
				class="used-mark"
				class:on={used}
				aria-pressed={used}
				title={$_('combat.panel.usedThisTurn')}
				onclick={() => combat.economy.toggleRollUsed(r.id)}
			>
				{$_('combat.panel.usedThisTurn')}
			</button>
		{:else}
			<span class="combat-row-marker"
				>{$_('combat.panel.roll')} <Icon name="chevron-right" size={11} /></span
			>
		{/if}
	</div>
{/each}
<!-- piece 3: resource spend-options (Ki → Flurry of Blows…) with a cost chip; disabled when the
     pool can't pay. Tap = afford-check + spend + surface the action. -->
{#each combat.resourceOptions as o (o.id)}
	{@const broke = o.cost !== 'x' && o.left < o.cost}
	{@const blocked = !o.available || broke}
	<!-- blocked with `aria-disabled`, never `disabled`: the row's whole job when it can't be used is
	     to say WHY, and a disabled control takes neither hover nor focus, so its reason is unreadable
	     (ui.md ▸ rule 10). The click still lands — the executor refuses it with the same sentence. -->
	<button
		class="combat-row"
		class:is-blocked={blocked}
		aria-disabled={blocked}
		title={!o.available
			? $_('combat.actions.unavailable')
			: broke
				? $_('combat.actions.cantAfford', { values: { resource: o.resourceName } })
				: o.description}
		onclick={() => combat.activateResourceOption(o)}
	>
		<span class="row-name">{o.name}</span>
		<span class="combat-row-hint">
			<span class="cost-chip">{o.cost === 'x' ? 'X' : o.cost} {o.resourceName}</span>
		</span>
		<span class="combat-row-desc">{o.description}</span>
		<!-- a closed vocabulary reads from the catalog; `bonus_action` is not the word every language
		     uses, and it is not even the word English uses on the rest of this sheet -->
		<span class="combat-row-marker">{$_(`combat.actionType.${o.actionType}`)}</span>
	</button>
{/each}

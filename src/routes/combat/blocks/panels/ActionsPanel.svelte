<script lang="ts">
	// Actions panel body: one ordered list of everything the character can DO on a turn — standard
	// actions (Show/hide-filtered), feature-granted rollables (Sneak Attack, Bardic Inspiration…) and
	// resource spend-options (Ki → Flurry) with a cost chip. Three kinds, one order the player owns.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { combat } from '../../combat-view-model.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { dragMotion } from '$lib/actions/dragMotion';
	import RowGrip from '../RowGrip.svelte';
	import { ROW_PANEL } from '$lib/combat/row-order';
	import type { StandardAction } from '$lib/combat/helpers';
	/** The three things this panel lists. A player sees one list of things they can do, so they order
	 *  one list: a spend-option that opens the character's whole turn has as much claim to the top as
	 *  Dash does. The kind rides on the row because each renders differently, not because each sorts
	 *  differently. */
	const ROW_KIND = { action: 'action', roll: 'roll', spend: 'spend' } as const;
	type FeatureRoll = (typeof combat.featureRolls)[number];
	type SpendOption = (typeof combat.resourceOptions)[number];
	type ActionRow =
		| { kind: typeof ROW_KIND.action; id: string; a: StandardAction }
		| { kind: typeof ROW_KIND.roll; id: string; r: FeatureRoll }
		| { kind: typeof ROW_KIND.spend; id: string; o: SpendOption };

	/* A standard action keeps its bare id, so an order saved before the other two joined it still
	   applies; the newcomers carry their kind, since nothing guarantees a resource option and an
	   action do not share a name. */
	const rows = $derived(
		combat.layout.ordered(
			ROW_PANEL.actions,
			[
				...combat.visibleActions.map((a): ActionRow => ({ kind: ROW_KIND.action, id: a.id, a })),
				...combat.featureRolls.map((r): ActionRow => ({
					kind: ROW_KIND.roll,
					id: `roll:${r.id}:${r.source}`,
					r,
				})),
				...combat.resourceOptions.map((o): ActionRow => ({
					kind: ROW_KIND.spend,
					id: `spend:${o.id}`,
					o,
				})),
			],
			(row) => row.id,
		),
	);
	let dragging = $state<ActionRow[] | null>(null);
	/* the item carries its ROW — see `AttacksPanel` for what a lookup by id cost the shadow item */
	const items = $derived(dragging ?? rows);
	const nameOf = (row: ActionRow) =>
		row.kind === ROW_KIND.action
			? $_(row.a.nameKey)
			: row.kind === ROW_KIND.roll
				? row.r.label
				: row.o.name;
</script>

<div
	class="dnd-rows"
	use:dragMotion
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
	{#each items as row (row.id)}
		<div class="row-wrap">
			<RowGrip
				panel={ROW_PANEL.actions}
				id={row.id}
				name={nameOf(row)}
				onmove={(by) =>
					combat.layout.moveRow(
						ROW_PANEL.actions,
						rows.map((x) => x.id),
						row.id,
						by,
					)}
			/>
			{#if row.kind === ROW_KIND.action}
				{@const a = row.a}
				<button class="combat-row" onclick={(e) => combat.actionClick(a, e)}>
					<span class="row-name">{$_(a.nameKey)}</span><span class="combat-row-hint"
						>{a.hint || '—'}</span
					>
					<span class="combat-row-desc">{$_(a.descKey)}</span><span class="combat-row-marker"
						>{$_(a.markerKey)}</span
					>
				</button>
				<!-- EFX-ROLL: feature-granted rollables (Sneak Attack Nd6, Bardic Inspiration die). The expr
				     is already resolved to a formula in derive; tap opens the dice tray via the seam. -->
			{:else if row.kind === ROW_KIND.roll}
				{@const r = row.r}
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
				<!-- a resource spend-option (Ki → Flurry of Blows…) with a cost chip; blocked when the pool
				     cannot pay. Tap = afford-check + spend + surface the action. -->
			{:else}
				{@const o = row.o}
				{@const broke = o.cost !== 'x' && o.left < o.cost}
				{@const blocked = !o.available || broke}
				<!-- blocked with `aria-disabled`, never `disabled`: the row's whole job when it can't be used
				     is to say WHY, and a disabled control takes neither hover nor focus, so its reason is
				     unreadable (ui.md ▸ rule 10). The click still lands — the executor refuses it with the
				     same sentence. -->
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
					<!-- a closed vocabulary reads from the catalog; `bonus_action` is not the word every
					     language uses, and it is not even the word English uses on the rest of this sheet -->
					<span class="combat-row-marker">{$_(`combat.actionType.${o.actionType}`)}</span>
				</button>
			{/if}
		</div>
	{/each}
</div>

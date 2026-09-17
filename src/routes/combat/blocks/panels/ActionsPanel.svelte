<script lang="ts">
	// Actions panel body: standard actions (Show/hide-filtered), feature-granted rollables (Sneak
	// Attack, Bardic Inspiration…) and resource spend-options (Ki → Flurry) with a cost chip.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { combat } from '../../combat-view-model.svelte';
	import { dndzone, dragHandle } from 'svelte-dnd-action';
	import { tick } from 'svelte';
	const visibleActions = $derived(combat.visibleActions);

	/* Only the STANDARD actions are the player's to order. The two lists below them are what the
	   character's own features and resources grant: their order follows the thing that granted them,
	   and a hand-sorted Sneak Attack floating above the action that fires it would be saying something
	   the sheet does not mean. */
	const PANEL = 'actions';
	let dragging = $state<{ id: string }[] | null>(null);
	const items = $derived(dragging ?? visibleActions.map((a) => ({ id: a.id })));
	const actionOf = (id: string) => visibleActions.find((a) => a.id === id);
	const ARROW_MOVE: Record<string, -1 | 1> = { ArrowUp: -1, ArrowDown: 1 };
	function moveOnArrow(event: KeyboardEvent, id: string): void {
		const by = ARROW_MOVE[event.code];
		if (!by) return;
		event.preventDefault(); // the panel would scroll instead
		combat.moveRow(
			PANEL,
			visibleActions.map((a) => a.id),
			id,
			by,
		);
		void tick().then(() => document.getElementById(`actions-grip-${id}`)?.focus());
	}
</script>

<div
	class="rows"
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
		combat.setRowOrder(
			PANEL,
			e.detail.items.map((i) => i.id),
		);
	}}
>
	{#each items as item (item.id)}
		{@const a = actionOf(item.id)}
		{#if a}
			<div class="row-wrap">
				<!-- NOT a <button>: the library discards a press whose target carries a `value`, and every
				     button does. The row beside it stays one button, so nothing is nested. -->
				<span
					id="actions-grip-{a.id}"
					class="row-grip"
					use:dragHandle
					role="button"
					tabindex="0"
					aria-label={$_('combat.moveRow', { values: { name: $_(a.nameKey) } })}
					title={$_('combat.moveRow', { values: { name: $_(a.nameKey) } })}
					onkeydown={(e) => moveOnArrow(e, a.id)}>⠿</span
				>
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

<style>
	/* the list is a zone, so it owns the stacking its rows used to get from the panel */
	.rows {
		display: flex;
		flex-direction: column;
	}
	.row-wrap {
		display: flex;
		align-items: stretch;
		gap: var(--space-1);
	}
	.row-wrap :global(.combat-row) {
		flex: 1;
		min-width: 0;
	}
	.row-grip {
		display: flex;
		align-items: center;
		flex: none;
		padding: 0 2px;
		color: var(--color-text-muted);
		opacity: 0.35;
		cursor: grab;
		line-height: 1;
	}
	.row-wrap:hover .row-grip,
	.row-grip:focus-visible {
		opacity: 1;
	}

	/* the feature roll is TWO controls now — roll it, and say it is spent for this turn — so the row
	   is a box with the roll filling it rather than a button that is the whole row */
	.feature-roll {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.roll-part {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 1px var(--space-2-5);
		flex: 1;
		min-width: 0;
		background: transparent;
		border: 0;
		padding: 0;
		color: inherit;
		text-align: start;
		cursor: pointer;
	}
	.used-mark {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px var(--space-1-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.used-mark.on {
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	/* piece 3: resource-option cost chip in the actions block */
	.cost-chip {
		display: inline-block;
		padding: 0 var(--space-1-5);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-xs);
		color: var(--color-accent-bright);
		font-size: 0.8em;
		text-transform: capitalize;
	}
</style>

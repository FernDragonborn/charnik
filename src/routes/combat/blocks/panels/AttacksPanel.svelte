<script lang="ts">
	// Attacks panel body: each weapon/attack row rolls to-hit (with adv/dis via modifier keys) and
	// shows damage + meta. Uses the shared global `.combat-row` layout — no scoped CSS.
	import { _ } from '$lib/i18n';
	import { combat } from '../../combat-view-model.svelte';
	import { signed } from '$lib/combat/helpers';
	import { attackMeta, attackName, attackNotes, formatDamageParts } from '$lib/combat/attacks';
	import { why } from '$lib/combat/helpers';
	import { provenance } from '$lib/actions/provenance';
	import { dndzone } from 'svelte-dnd-action';
	import { dragMotion } from '$lib/actions/dragMotion';
	import RowGrip from '../RowGrip.svelte';
	import { ROW_PANEL } from '$lib/combat/row-order';
	import type { Attack } from '$lib/combat/attacks';
	// the player's own order, applied where it is a view concern; the VM hands over the rows the
	// character actually has, and this reconciles them against what was arranged
	const attacks = $derived(combat.layout.ordered(ROW_PANEL.attacks, combat.attacks, (a) => a.id));

	/* The order of these rows is the player's — the list itself is derived from what they wield, so
	   the order lives on `ui.rowOrder` and is reconciled against the live rows on every read. The
	   zone's own list stands in mid-drag; the drop is what the character hears about. */
	let dragging = $state<{ id: string; at: Attack }[] | null>(null);
	/* The item carries its ROW. `svelte-dnd-action` inserts a copy of the dragged item as its shadow,
	   and a copy brings the row with it — where a lookup by id found nothing for the shadow, rendered
	   no child for it, and left the library marking a NEIGHBOUR as the placeholder: the row beside the
	   one you picked up went invisible for the length of the drag. */
	const items = $derived(dragging ?? attacks.map((at) => ({ id: at.id, at })));
	// one Attack action, N attacks — a property of the character, so it is stated once above the
	// rows rather than repeated on each. Silent at one, which is everybody without the feature.
	const perAction = $derived(combat.sheet?.attacksPerAction);
</script>

{#if perAction && perAction.value > 1}
	<div class="eyebrow" use:provenance={why(perAction, $_)}>
		{$_('combat.attacksPerAction', { values: { count: perAction.value } })}
	</div>
{/if}

<div
	class="dnd-rows"
	use:dragMotion
	use:dndzone={{
		items,
		type: 'attack-row',
		flipDurationMs: 150,
		dropTargetStyle: {},
		morphDisabled: true,
	}}
	onconsider={(e) => (dragging = e.detail.items)}
	onfinalize={(e) => {
		dragging = null;
		combat.layout.setRowOrder(
			ROW_PANEL.attacks,
			e.detail.items.map((i) => i.id),
		);
	}}
>
	{#each items as item (item.id)}
		{@const at = item.at}
		{#if at}
			<div class="row-wrap">
				<RowGrip
					panel={ROW_PANEL.attacks}
					id={at.id}
					name={attackName(at, $_)}
					onmove={(by) =>
						combat.layout.moveRow(
							ROW_PANEL.attacks,
							attacks.map((a) => a.id),
							at.id,
							by,
						)}
				/>
				<!-- D9: the notes explain a magic weapon's own +X (already folded into toHit/damage) on hover -->
				<button
					class="combat-row"
					title={attackNotes(at, $_) || undefined}
					onclick={(e) => combat.attackRoll(at, e)}
				>
					<span class="row-name">{attackName(at, $_)}</span><span class="combat-row-hint"
						>{signed(at.toHit)}</span
					>
					<span class="combat-row-desc">{formatDamageParts(at.damageParts, $_)}</span><span
						class="combat-row-marker">{attackMeta(at, $_)}</span
					>
				</button>
				<!-- FINESSE-ABILITY: RAW hands the player this choice every swing, and the app used to take
				     it silently. Rendered only where there IS a choice, and BESIDE the row rather than
				     inside it — a control nested in a row-wide button is what cost the keyboard its walk
				     the last time this shape was built. -->
				{#if at.finesse}
					{@const fin = at.finesse}
					{@const other = fin.ability === 'str' ? 'dex' : 'str'}
					<button
						class="finesse-swap"
						onclick={() => combat.inventory.setFinesseAbility(fin.kindId, other)}
						title={$_('combat.attacks.finesseSwap', {
							values: { other: $_(`abilityName.${other}`) },
						})}
						aria-label={$_('combat.attacks.finesseSwap', {
							values: { other: $_(`abilityName.${other}`) },
						})}
					>
						<!-- BOTH abilities stand, the live one lit: showing only the current
						     one made the control read as one more meta tag, and a player who
						     never pressed it would never learn a choice was there. -->
						<span class="fin-ab" class:on={fin.ability === 'str'}>{$_('abilityShort.str')}</span
						><span class="fin-ab" class:on={fin.ability === 'dex'}>{$_('abilityShort.dex')}</span>
					</button>
				{/if}
			</div>
		{/if}
	{/each}
</div>

<style>
	/* A finesse weapon's grip: quiet next to the number it changes, and never mistakable for the
	   damage type beside it — it is the one thing on this row that is a CHOICE rather than a fact. */
	.finesse-swap {
		flex: none;
		align-self: center;
		display: inline-flex;
		padding: 0;
		overflow: hidden;
		border-radius: var(--radius-sm);
		cursor: pointer;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
	}
	.fin-ab {
		padding: 2px var(--space-1-5);
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}
	.fin-ab.on {
		background: var(--color-accent-soft);
		color: var(--color-accent-bright);
	}
	.finesse-swap:hover,
	.finesse-swap:focus-visible {
		border-color: var(--color-accent);
	}
</style>

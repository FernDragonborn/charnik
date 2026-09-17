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
			</div>
		{/if}
	{/each}
</div>

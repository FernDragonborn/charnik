<script lang="ts">
	// Attacks panel body: each weapon/attack row rolls to-hit (with adv/dis via modifier keys) and
	// shows damage + meta. Uses the shared global `.combat-row` layout — no scoped CSS.
	import { _ } from '$lib/i18n';
	import { combat } from '../../combat-view-model.svelte';
	import { signed } from '$lib/combat/helpers';
	import { attackMeta, attackName, attackNotes, formatDamageParts } from '$lib/combat/attacks';
	import { why } from '$lib/combat/helpers';
	import { provenance } from '$lib/actions/provenance';
	import { dndzone, dragHandle } from 'svelte-dnd-action';
	import { tick } from 'svelte';
	const attacks = $derived(combat.attacks);

	/* The order of these rows is the player's — the list itself is derived from what they wield, so
	   the order lives on `ui.rowOrder` and is reconciled against the live rows on every read. The
	   zone's own list stands in mid-drag; the drop is what the character hears about. */
	const PANEL = 'attacks';
	let dragging = $state<{ id: string }[] | null>(null);
	const items = $derived(dragging ?? attacks.map((a) => ({ id: a.id })));
	const attackOf = (id: string) => attacks.find((a) => a.id === id);
	const ARROW_MOVE: Record<string, -1 | 1> = { ArrowUp: -1, ArrowDown: 1 };
	function moveOnArrow(event: KeyboardEvent, id: string): void {
		const by = ARROW_MOVE[event.code];
		if (!by) return;
		event.preventDefault(); // the panel would scroll instead
		combat.moveRow(
			PANEL,
			attacks.map((a) => a.id),
			id,
			by,
		);
		// the library rebuilds the row, so the grip holding the caret is gone by the time it lands
		void tick().then(() => document.getElementById(`attacks-grip-${id}`)?.focus());
	}
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
	class="rows"
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
		combat.setRowOrder(
			PANEL,
			e.detail.items.map((i) => i.id),
		);
	}}
>
	{#each items as item (item.id)}
		{@const at = attackOf(item.id)}
		{#if at}
			<div class="row-wrap">
				<!-- NOT a <button>: `svelte-dnd-action` discards a press whose target carries a `value`, and
				     every button does (`PanelCard`'s grip has the whole story). The row beside it stays one
				     button, so nothing interactive is nested in anything. -->
				<span
					id="attacks-grip-{at.id}"
					class="row-grip"
					use:dragHandle
					role="button"
					tabindex="0"
					aria-label={$_('combat.moveRow', { values: { name: attackName(at, $_) } })}
					title={$_('combat.moveRow', { values: { name: attackName(at, $_) } })}
					onkeydown={(e) => moveOnArrow(e, at.id)}>⠿</span
				>
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

<style>
	/* the list is a zone now, so it owns the stacking its rows used to get from the panel */
	.rows {
		display: flex;
		flex-direction: column;
	}
	/* the grip sits beside the row rather than inside it — a row here IS a button, and a control
	   nested in a control is what the keyboard walk lost last time */
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
</style>

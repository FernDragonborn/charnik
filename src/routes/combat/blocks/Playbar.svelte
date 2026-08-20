<script lang="ts">
	// The always-visible "last roll" strip + the way into the roll log. Reads the `combat` view-model
	// singleton (the log lives on the dice tray).
	//
	// It used to print `label + expr + total`, which LOST the roll: on an advantage roll the d20 is
	// not in `expr` (it rides `advantageRoll`), so the chip read "Last · Greataxe +6 = 9" with the die
	// that decided the attack simply absent, and `damage` was ignored entirely — for an attack it
	// showed the to-hit and never the number the player wanted (UBUG-20). It now mounts the same
	// `RollRow` the toast does, so the last roll reads identically wherever you look at it.
	//
	// The row is NOT wrapped in a button: the log cue is its own control. That keeps the roll's own
	// pills free to become controls (UX-3's retroactive advantage) without nesting a button in a
	// button — the constraint that shaped the toast.
	import Icon from '$lib/components/Icon.svelte';
	import DiceIcon from '$lib/components/DiceIcon.svelte';
	import { combat } from '../combat-view-model.svelte';
	import { rollToastModel, ROLL_LAYOUT } from '$lib/dice/roll-toast';
	import RollRow from '$lib/components/RollRow.svelte';

	const { openMenu } = combat;
	const log = $derived(combat.tray.log);
	const last = $derived(log[0]);

	// The live controls on this roll (UX-3). They exist HERE and in the log, never in the toast: a
	// toast expires mid-decision and click-anywhere dismisses it, so it announces and these two act.
	// `savagePendingEntry` is the one roll whose weapon damage can still be rerolled this turn.
	const rerollDamage = $derived(
		last && combat.savageLabel && last === combat.savagePendingEntry
			? {
					attack: 0,
					part: 0,
					label: `${combat.savageLabel} — reroll damage, keep the higher`,
					run: combat.savageReroll,
				}
			: undefined,
	);
</script>

<div class="playbar">
	<div class="last-roll" class:empty={!last}>
		{#if last}
			<RollRow
				model={rollToastModel(last)}
				onAdvantage={() => combat.tray.amendAdvantage(last)}
				{rerollDamage}
				layout={ROLL_LAYOUT.strip}
			/>
		{:else}
			<span class="no-roll">Tap any check · save · attack · spell to roll it.</span>
		{/if}
		<button class="log-cue" onclick={(e) => openMenu('log', e)} title="Roll log · history"
			><DiceIcon size={15} /> log <Icon name="chevron-right" size={12} /></button
		>
	</div>
</div>

<style>
	/* the page puts this in a row beside the turn/time bar, so the strip owns no outer spacing and
	   takes only the width its roll needs (the bar beside it absorbs the rest) */
	.playbar {
		display: flex;
		min-width: 0;
	}
	/* matches the combat bars it sits beside — same surface, same 12px radius, same 56px floor — so
	   the row reads as two halves of one strip rather than two unrelated widgets */
	.last-roll {
		display: flex;
		align-items: stretch;
		min-width: 0;
		max-width: 100%;
		min-height: 56px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		overflow: hidden;
	}
	.no-roll {
		display: flex;
		align-items: center;
		padding: 9px 14px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.log-cue {
		align-self: stretch;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 11px;
		border: 0;
		border-left: 1px solid var(--color-border);
		background: var(--color-surface-2);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
		cursor: pointer;
	}
	.log-cue:hover {
		color: var(--color-text);
		background: var(--color-surface);
	}
</style>

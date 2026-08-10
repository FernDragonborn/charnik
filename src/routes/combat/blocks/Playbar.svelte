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
	import { combat } from '../state.svelte';
	import { rollToastModel } from '$lib/dice/roll-toast';
	import RollRow from '$lib/components/RollRow.svelte';

	const { openMenu } = combat;
	const log = $derived(combat.tray.log);
	const last = $derived(log[0]);
</script>

<div class="playbar">
	<div class="lastroll" class:empty={!last}>
		{#if last}
			<!-- RollRow renders sibling spans (name · grid · note); they stack, as in the toast card -->
			<div class="rollwrap"><RollRow model={rollToastModel(last)} /></div>
		{:else}
			<span class="noroll">Tap any check · save · attack · spell to roll it.</span>
		{/if}
		<button class="log-cue" onclick={(e) => openMenu('log', e)} title="Roll log · history"
			>🎲 log ▸</button
		>
	</div>
</div>

<style>
	.playbar {
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		margin-bottom: 22px;
	}
	/* sizes to the roll it holds, exactly like the toast card — same content, same shape */
	.lastroll {
		display: flex;
		align-items: stretch;
		max-width: 100%;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.rollwrap {
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-width: 0;
	}
	.noroll {
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

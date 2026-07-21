<script lang="ts">
	// Action-economy bar (only shown while Combat is ON): round counter, the action/bonus/reaction
	// pip slots, the movement tracker, and Next turn. Reads the `combat` view-model; the non-null
	// character comes in as a prop (for the per-slot spent counts in `play.turn`).
	import type { Character } from '$lib/character/schema';
	import { combat } from '../state.svelte';
	import { range } from '$lib/combat/helpers';

	let { c }: { c: Character } = $props();

	// action-economy slots (id + label); base 1 pip each until a feature grants extras
	const SLOTS = [
		['action', 'Action'],
		['bonus', 'Bonus'],
		['reaction', 'Reaction']
	] as const;
</script>

<section class="turnbar">
	<span class="bar-label">Round <b>{combat.round}</b></span>
	{#each SLOTS as [slot, label] (slot)}
		<span class="turn-slot">
			{label}
			<span class="turn-pips">
				{#each range(combat.economy.slotMax[slot]) as i (i)}
					{@const used = i >= combat.economy.slotMax[slot] - c.play.turn[slot]}
					<button
						type="button"
						class="turn-pip"
						class:used
						onclick={() => combat.economy.usePip(slot, i)}
						title="{label}: {used ? 'used — click to restore' : 'available'}"
						aria-label="{label} pip {i + 1}"
					></button>
				{/each}
			</span>
		</span>
	{/each}
	<button
		type="button"
		class="turn-slot move"
		onclick={() => combat.economy.spendMove(5)}
		title="Click: spend 5 ft"
	>
		🦶 Move <b class:spent={combat.economy.moveLeft === 0}>{combat.economy.moveLeft}</b> / {combat
			.economy.moveMax} ft
	</button>
	<button type="button" class="aereset" onclick={combat.economy.resetMove} title="Reset movement"
		>↺</button
	>
	<span class="spacer"></span>
	<button type="button" class="nextturn" onclick={combat.economy.nextTurn}>Next turn ▸</button>
</section>

<style>
	.turnbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 9px 12px;
		margin-bottom: 12px;
	}
	.turnbar .spacer {
		flex: 1 1 auto;
		min-width: 8px;
	}
	.turnbar .bar-label {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.turn-slot {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 5px 11px;
	}
	.turn-slot .turn-pips {
		display: inline-flex;
		gap: 4px;
	}
	.turn-slot .turn-pip {
		width: 12px;
		height: 12px;
		padding: 0;
		border: 1px solid var(--color-good);
		border-radius: 50%;
		background: var(--color-good);
		box-shadow: 0 0 8px rgba(59, 184, 166, 0.45);
		cursor: pointer;
	}
	.turn-slot .turn-pip.used {
		background: transparent;
		border-color: var(--color-border-strong);
		box-shadow: none;
	}
	.turn-slot b {
		color: var(--color-text);
	}
	.turn-slot b.spent {
		color: var(--color-text-muted);
	}
	/* the Move slot + reset are buttons but wear the same chip look */
	button.turn-slot {
		cursor: pointer;
		color: var(--color-text-muted);
	}
	button.turn-slot:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
	.aereset {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		width: 28px;
		height: 28px;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 14px;
	}
	.aereset:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
	.nextturn {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: var(--color-accent-text);
		border-radius: 9px;
		padding: 7px 15px;
		cursor: pointer;
	}
	.nextturn:hover {
		filter: brightness(1.14);
	}
</style>

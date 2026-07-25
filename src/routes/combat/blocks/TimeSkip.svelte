<script lang="ts">
	// B19: out-of-combat "pass time" bar. In combat, Next turn advances the round + expires timed
	// effects; OUT of combat the round is frozen, so a round-timed buff (a 10-round Bless) would hang
	// until a rest. This lets the user skip a round / minute / 10 min / hour (1 round = 6 s) and expire
	// whatever timed out. Shown only when a timed effect is actually ticking (see combat.hasTimedEffects).
	import { combat } from '../state.svelte';

	// label → rounds (1 round = 6 s → 1 min = 10 rd, 10 min = 100 rd, 1 hr = 600 rd)
	const STEPS = [
		['+1 rd', 1],
		['+1 min', 10],
		['+10 min', 100],
		['+1 hr', 600]
	] as const;
</script>

<section class="combat-bar">
	<span class="bar-label">⏱ Pass time</span>
	{#each STEPS as [label, rounds] (label)}
		<button
			type="button"
			class="step"
			onclick={() => combat.economy.advanceTime(rounds)}
			title="Advance {rounds} round{rounds > 1 ? 's' : ''} and expire what times out">{label}</button
		>
	{/each}
</section>

<style>
	/* container + label come from the shared .combat-bar / .bar-label (components.css) */
	.step {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 5px 11px;
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.step:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
</style>

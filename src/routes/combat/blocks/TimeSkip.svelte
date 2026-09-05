<script lang="ts">
	// B19: out-of-combat "pass time" bar. In combat, Next turn advances the round + expires timed
	// effects; OUT of combat the round is frozen, so a round-timed buff (a 10-round Bless) would hang
	// until a rest. This lets the user skip a round / minute / 10 min / hour (1 round = 6 s) and expire
	// whatever timed out. Shown only when a timed effect is actually ticking (see combat.hasTimedEffects).
	import Icon from '$lib/components/Icon.svelte';
	import { combat } from '../combat-view-model.svelte';
	import { _ } from '$lib/i18n';

	// key → rounds (1 round = 6 s → 1 min = 10 rd, 10 min = 100 rd, 1 hr = 600 rd). The step is the
	// app's own vocabulary, and its abbreviation is not "rd" in every language
	const STEPS = [
		['combat.timeSkip.round', 1],
		['combat.timeSkip.minute', 10],
		['combat.timeSkip.tenMinutes', 100],
		['combat.timeSkip.hour', 600],
	] as const;
</script>

<section class="combat-bar">
	<span class="bar-label"><Icon name="timer" size={13} /> {$_('combat.timeSkip.title')}</span>
	{#each STEPS as [key, rounds] (key)}
		<button
			type="button"
			class="step"
			onclick={() => combat.economy.advanceTime(rounds)}
			title={$_('combat.timeSkip.hint', { values: { rounds } })}>{$_(key)}</button
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
		padding: var(--space-1) var(--space-2-5);
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.step:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
</style>

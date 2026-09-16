<script lang="ts">
	// B19: out-of-combat "pass time" bar. In combat, Next turn advances the round + expires timed
	// effects; OUT of combat the round is frozen, so a round-timed buff (a 10-round Bless) would hang
	// until a rest. This lets the user skip a round / minute / 10 min / hour (1 round = 6 s) and expire
	// whatever timed out. ALWAYS offered out of combat: passing time moves the round counter whether or
	// not something is ticking, and a bar that came and went with the player's buffs was a control they
	// could not reach for when they wanted it.
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
	<!-- Dawn and dusk are BOUNDARIES, not durations: a wand recharges at dawn, and the app has no
	     clock to know when that is, so the player says so. Shown only when something comes back
	     there — a button that could never do anything says the wrong thing about the sheet. -->
	{#if combat.hasDawnPool}
		<button
			type="button"
			class="step boundary"
			onclick={() => combat.resources.passBoundary('dawn')}
			title={$_('combat.timeSkip.newDayHint')}
			><Icon name="sun" size={12} /> {$_('combat.timeSkip.newDay')}</button
		>
	{/if}
	{#if combat.hasDuskPool}
		<button
			type="button"
			class="step boundary"
			onclick={() => combat.resources.passBoundary('dusk')}
			title={$_('combat.timeSkip.nightfallHint')}
			><Icon name="moon" size={12} /> {$_('combat.timeSkip.nightfall')}</button
		>
	{/if}
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
	/* a boundary is a different KIND of press than "skip ten minutes": it fires a recharge */
	.step.boundary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
	.step:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
</style>

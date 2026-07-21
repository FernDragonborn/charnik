<script lang="ts">
	// Combat toolbar: the play-state toggles (Combat / Shield / Concentration / Inspiration),
	// the rest buttons, Auto-calc, and the Dice-tray opener. Reads the `combat` view-model
	// singleton; the non-null character comes in as a prop so the markup stays terse.
	import type { Character } from '$lib/character/schema';
	import { combat } from '../state.svelte';
	import DiceIcon from '$lib/components/DiceIcon.svelte';

	let { c }: { c: Character } = $props();
	const conc = $derived(combat.conc);
	const { openDice } = combat;
</script>

<section class="controls">
	<button
		class="toggle combatsw"
		class:on={c.play.inCombat}
		onclick={combat.economy.toggleCombat}
		title="Track the action economy (rounds, action/bonus/reaction)"
		>⚔ Combat <span class="toggle-state">{c.play.inCombat ? 'ON' : 'OFF'}</span></button
	>
	<button
		class="toggle"
		class:on={c.play.shieldRaised}
		onclick={() => (c.play.shieldRaised = !c.play.shieldRaised)}
		>🛡 Shield <span class="toggle-state">{c.play.shieldRaised ? 'ON' : 'OFF'}</span></button
	>
	{#if conc}<button
			class="toggle conc on"
			onclick={combat.clearConcentration}
			title="Tap to stop concentrating"
			>◈ Concentration <span class="toggle-state">{conc.label}</span></button
		>{/if}
	<button
		class="toggle"
		class:on={c.play.inspiration}
		onclick={() => (c.play.inspiration = !c.play.inspiration)}
		>✦ Inspiration <span class="toggle-state">{c.play.inspiration ? 'ON' : 'OFF'}</span></button
	>
	<span class="spacer"></span>
	<button class="toggle rest" onclick={() => combat.resources.rest('short')} title="Short rest"
		>☾ Short</button
	>
	<button class="toggle rest" onclick={() => combat.resources.rest('long')} title="Long rest"
		>🌙 Long</button
	>
	<button
		class="toggle auto"
		class:on={c.play.autoCalc}
		onclick={() => (c.play.autoCalc = !c.play.autoCalc)}
		title="Auto-calculate derived stats from effects (off → base values only)"
		>⚙ Auto-calc <span class="toggle-state">{c.play.autoCalc ? 'ON' : 'OFF'}</span></button
	>
	<button class="toggle dice" onclick={openDice}><DiceIcon /> Dice tray</button>
</section>

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-bottom: 14px;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 7px 12px;
		border-radius: var(--radius-full);
		cursor: pointer;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.toggle .toggle-state {
		font-family: var(--font-mono);
		font-size: 10px;
		border: 1px solid var(--color-border-strong);
		border-radius: 5px;
		padding: 1px 6px;
		color: inherit;
	}
	.toggle.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.toggle.on .toggle-state {
		border-color: var(--color-resource);
	}
	.toggle.conc.on {
		background: var(--color-accent-soft);
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.toggle.conc.on .toggle-state {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.toggle.auto.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.toggle.auto.on .toggle-state {
		border-color: var(--color-good);
	}
	.toggle.dice {
		background: var(--color-accent-deep);
		border-color: var(--color-accent-deep);
		color: var(--color-accent-text);
		font-size: 13px;
	}
	/* Combat mode = gold when tracking (own class: `combat` collides with the stat-grid section) */
	.toggle.combatsw.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.toggle.combatsw.on .toggle-state {
		border-color: var(--color-resource);
	}
	.controls .spacer {
		flex: 1 1 auto;
		min-width: 8px;
	}
	.toggle.rest {
		font-size: 12px;
	}
	/* colored pill buttons keep their semantic colour but brighten on hover */
	.toggle:hover {
		filter: brightness(1.14);
	}
</style>

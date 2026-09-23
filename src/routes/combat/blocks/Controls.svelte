<script lang="ts">
	// Combat toolbar: the play-state toggles (Combat / Shield / Concentration), the rest buttons and
	// the Dice-tray opener — the things a player presses every session. Reads the `combat` view-model
	// singleton; the non-null character comes in as a prop so the markup stays terse.
	//
	// Auto-calc is NOT here. It is the escape hatch for a number the engine got wrong, pressed almost
	// never, and it lives on the Effects panel head — beside the layers it drops.
	import Icon from '$lib/components/Icon.svelte';
	import type { Character } from '$lib/character/schema';
	import { combat } from '../combat-view-model.svelte';
	import { _ } from '$lib/i18n';
	import DiceIcon from '$lib/components/DiceIcon.svelte';

	let { c }: { c: Character } = $props();
	const conc = $derived(combat.conc);
	const shield = $derived(combat.inventory.shield);
	const { openDice } = combat;
	/** Every toggle's state pill reads the same two words. */
	const state = (on: boolean) => $_(on ? 'combat.controls.on' : 'combat.controls.off');
</script>

<section class="controls">
	<button
		class="toggle combat-toggle"
		class:on={c.play.inCombat}
		onclick={combat.toggleCombat}
		title={$_('combat.controls.combatHint')}
		><Icon name="swords" />
		{$_('combat.controls.combat')}
		<span class="toggle-state">{state(c.play.inCombat)}</span></button
	>
	<!-- shown only when this character carries a shield: the toggle IS that shield's equip button, so
	     with none in the pack it could never do anything, and a button like that says the wrong thing
	     about the sheet (the same rule the Dawn/Dusk buttons follow). -->
	{#if shield}
		<button
			class="toggle"
			class:on={shield.entry.equipped}
			onclick={() => combat.inventory.equip(shield.entry.item)}
			title={$_('combat.controls.shieldHint')}
			><Icon name="shield" />
			{$_('combat.controls.shield')}
			<span class="toggle-state">{state(shield.entry.equipped)}</span></button
		>
	{/if}
	<!-- The chip ROLLS the save; ending the spell on purpose is the ✕ that drops out of it. The two are
	     one press apart on purpose: a miss ends concentration, so the roll is the common act and the
	     deliberate end is the rare one, and it used to be the other way round — a single stray press on
	     this chip killed the spell with nothing to confirm it. -->
	{#if conc}
		<span class="conc-chip">
			<button
				class="toggle concentration on"
				onclick={combat.rollConcentrationSave}
				title={$_('combat.controls.concentrationHint')}
				><Icon name="target" />
				{$_('combat.controls.concentration')}
				<span class="toggle-state">{conc.label}</span></button
			>
			<span class="conc-drop">
				<button
					class="conc-end"
					onclick={combat.endConcentrationByHand}
					title={$_('combat.hp.endConcentration', { values: { spell: conc.label } })}
					aria-label={$_('combat.hp.endConcentration', { values: { spell: conc.label } })}
					><Icon name="x" size={12} /></button
				>
			</span>
		</span>
	{/if}
	<span class="spacer"></span>
	<button
		class="toggle rest"
		onclick={(e) => combat.startShortRest(e)}
		title={$_(
			combat.shortRestMode === 'half'
				? 'combat.controls.shortHintHalf'
				: 'combat.controls.shortHintDice',
		)}><Icon name="flame-kindling" /> {$_('combat.controls.short')}</button
	>
	<button
		class="toggle rest"
		onclick={() => combat.resources.rest('long')}
		title={$_('combat.controls.longHint')}><Icon name="tent" /> {$_('combat.controls.long')}</button
	>
	<button class="toggle dice" onclick={openDice}
		><DiceIcon /> {$_('combat.controls.diceTray')}</button
	>
</section>

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: 14px;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		padding: var(--space-1-5) var(--space-3);
		border-radius: var(--radius-full);
		cursor: pointer;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.toggle .toggle-state {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1-5);
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
	/* The ✕ hangs UNDER the chip and is a descendant of it, so the pointer crossing the gap never
	   leaves the hover — the gap is this wrapper's own padding, not empty page. */
	.conc-chip {
		position: relative;
		display: inline-flex;
	}
	.conc-drop {
		position: absolute;
		inset-inline: 0;
		top: 100%;
		padding-top: var(--space-1);
		display: flex;
		justify-content: center;
		opacity: 0;
		/* not `visibility`, which would take it out of the tab order — the keyboard reaches it and the
		   rule below is what reveals it. */
		pointer-events: none;
		transition: opacity 120ms ease;
		z-index: 2;
	}
	/* `:focus-visible`, never `:focus-within`: a mouse CLICK leaves focus on the chip, so focus-within
	   kept the ✕ standing open after the pointer had long gone — until you clicked something else. The
	   keyboard still needs it, and only the keyboard does. */
	.conc-chip:hover .conc-drop,
	.conc-chip:has(:focus-visible) .conc-drop {
		opacity: 1;
		pointer-events: auto;
	}
	/* Neutral at rest and red only under the pointer: the chip it hangs from is already accent-red, so
	   a red ✕ beside it reads as more of the same chip rather than as the thing that ENDS it. */
	.conc-end {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: var(--radius-full);
		cursor: pointer;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		color: var(--color-text-muted);
	}
	.conc-end:hover,
	.conc-end:focus-visible {
		background: var(--color-danger-soft);
		border-color: var(--color-danger);
		color: var(--color-danger);
	}
	.toggle.concentration.on {
		background: var(--color-accent-soft);
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.toggle.concentration.on .toggle-state {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.toggle.dice {
		background: var(--color-accent-deep);
		border-color: var(--color-accent-deep);
		color: var(--color-accent-text);
		font-size: var(--font-size-sm);
	}
	/* Combat mode = gold when tracking (own class: `combat` collides with the stat-grid section) */
	.toggle.combat-toggle.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.toggle.combat-toggle.on .toggle-state {
		border-color: var(--color-resource);
	}
	.controls .spacer {
		flex: 1 1 auto;
		min-width: 8px;
	}
	.toggle.rest {
		font-size: var(--font-size-xs);
	}
	/* colored pill buttons keep their semantic colour but brighten on hover */
	.toggle:hover {
		filter: brightness(1.14);
	}
</style>

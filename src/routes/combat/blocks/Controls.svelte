<script lang="ts">
	// Combat toolbar: the play-state toggles (Combat / Shield / Concentration),
	// the rest buttons, Auto-calc, and the Dice-tray opener. Reads the `combat` view-model
	// singleton; the non-null character comes in as a prop so the markup stays terse.
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
	{#if conc}<button
			class="toggle concentration on"
			onclick={combat.clearConcentration}
			title={$_('combat.controls.concentrationHint')}
			><Icon name="target" />
			{$_('combat.controls.concentration')}
			<span class="toggle-state">{conc.label}</span></button
		>{/if}
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
	<button
		class="toggle auto"
		class:on={c.play.autoCalc}
		onclick={() => (c.play.autoCalc = !c.play.autoCalc)}
		title={$_('combat.controls.autoCalcHint')}
		><Icon name="settings" />
		{$_('combat.controls.autoCalc')}
		<span class="toggle-state">{state(c.play.autoCalc)}</span></button
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
	.toggle.concentration.on {
		background: var(--color-accent-soft);
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.toggle.concentration.on .toggle-state {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	/* neutral, not green: auto-calc being ON is the NORMAL state, not a good outcome — green here reads
	   as "something went well" beside toggles whose colour really does mean a state (rage, concentration) */
	.toggle.auto.on {
		background: color-mix(in srgb, var(--color-text) 10%, var(--color-surface-2));
		border-color: var(--color-text-muted);
		color: var(--color-text);
	}
	.toggle.auto.on .toggle-state {
		border-color: var(--color-text-muted);
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

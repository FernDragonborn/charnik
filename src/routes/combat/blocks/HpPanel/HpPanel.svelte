<script lang="ts">
	// Hit-points panel (current/max/temp, bar, damage/heal, temp-HP). Always shown.
	// Reads the `combat` view-model singleton; character + sheet come in as props.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { damageTypeLabel } from '$lib/combat/attacks';
	import DiceIcon from '$lib/components/DiceIcon.svelte';
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../../combat-view-model.svelte';
	import { why } from '$lib/combat/helpers';
	import { provenance } from '$lib/actions/provenance';

	let { c, s }: { c: Character; s: CharacterSheet } = $props();
	const hpBar = $derived(combat.hpBar);
	const { openMenu } = combat;
	// death saves show only while downed (0 HP); pips render the tracked count, the button rolls one
	const downed = $derived(c.play.hp.current <= 0);
	const pips = [0, 1, 2];
</script>

<div class="hitpoints">
	<!-- redesigned main row: readout (label · number · bar) LEFT, adjust controls RIGHT -->
	<div class="hp-main">
		<div class="hp-readout">
			<div class="hitpoints-label">
				<span>{$_('combat.hp.hitPoints')}</span>
				<button class="temptag" onclick={(e) => openMenu('temphp', e)}
					><Icon name="plus" size={13} /> {$_('combat.hp.tempHp')}</button
				>
			</div>
			<div class="hitpoints-value" use:provenance={why(s.maxHp, $_)}>
				{c.play.hp.current}<small> / {combat.hpMax}</small>{#if c.play.hp.temp > 0}<span
						class="temp">+{c.play.hp.temp} {$_('combat.hp.temp')}</span
					>{/if}
			</div>
			<div class="hitpoints-bar">
				<i class="hitpoints-bar-current" style="width:{hpBar.cur}%"></i><i
					class="hitpoints-bar-temp"
					style="width:{hpBar.tmp}%"
				></i>
			</div>
		</div>
		<div class="hp-controls">
			<button class="hp-btn heal" onclick={combat.heal} title={$_('combat.hp.healTitle')}
				><Icon name="plus" size={13} /> {$_('combat.hp.heal')}</button
			>
			<input
				class="hp-number"
				type="number"
				min="0"
				bind:value={combat.hpAmount}
				aria-label={$_('combat.hp.hpAmount')}
			/>
			<button class="hp-btn damage" onclick={combat.damage} title={$_('combat.hp.damageTitle')}
				>− {$_('combat.hp.damage')}</button
			>
		</div>
	</div>
	<!-- At 0 HP the next hit is a death-save failure, and TWO if it was a critical — RAW, and the one
	     thing the Damage button cannot know, since there is no attack behind it to read. Asked only
	     here, where it changes something. -->
	{#if combat.character?.play.hp.current === 0 && !combat.character?.play.death}
		<label class="crit-ask">
			<input type="checkbox" bind:checked={combat.hp.damageWasCrit} />
			{$_('combat.hp.wasCritical')}
		</label>
	{/if}
	{#if combat.damageTypeOptions.length}
		<!-- B20: only shown when the sheet HAS a defense — picks the incoming damage's type so
		     resist (½) / immune (0) / vulnerable (×2) apply. Untyped = plain damage. -->
		<select
			class="hp-damage-type"
			bind:value={combat.damageType}
			aria-label={$_('combat.hp.damageTypeLabel')}
		>
			<option value={null}>{$_('combat.hp.untyped')}</option>
			{#each combat.damageTypeOptions as t (t)}
				<option value={t}>{damageTypeLabel(t, $_)}</option>
			{/each}
		</select>
	{/if}
	<!-- B4: concentration-save banner — a thin, persistent bar shown while a CON save is DUE after
	     taking damage while concentrating. Suggested-but-editable DC, player-rolled (surface, never
	     force); a failed roll offers Drop rather than auto-ending the spell. -->
	{#if combat.pendingConcentrationSave && combat.conc}
		{@const pend = combat.pendingConcentrationSave}
		<div class="conc-banner" class:failed={pend.failed} role="status">
			{#if pend.failed}
				<span class="conc-warn"
					><Icon name="circle-x" size={13} /> {$_('combat.hp.saveFailed')}</span
				>
				<span class="conc-detail">
					{$_('combat.hp.spellEnds', { values: { spell: combat.conc.label } })}
				</span>
			{:else}
				<span class="conc-warn"
					><Icon name="triangle-alert" size={13} /> {$_('combat.hp.concentrationCheck')}</span
				>
				<span class="conc-detail">
					{combat.conc.label} · DC
					<input
						class="conc-dc"
						type="number"
						min="1"
						bind:value={pend.dc}
						aria-label={$_('combat.hp.concentrationDc')}
					/>
					· d20 + CON ({combat.concentrationSaveMod >= 0 ? '+' : ''}{combat.concentrationSaveMod})
				</span>
			{/if}
			<span class="conc-actions">
				{#if !pend.failed}
					<button class="conc-btn roll" onclick={combat.rollConcentrationSave}
						><DiceIcon size={14} /> {$_('combat.hp.roll')}</button
					>
				{/if}
				<button
					class="conc-btn drop"
					title={$_('combat.hp.endConcentration', { values: { spell: combat.conc.label } })}
					onclick={combat.dropConcentrationFromSave}>{$_('combat.hp.dropSpell')}</button
				>
				<button
					class="conc-btn dismiss"
					title={$_('combat.hp.keepConcentrating')}
					aria-label={$_('combat.hp.keepConcentratingAria')}
					onclick={combat.dismissConcentrationSave}
					><Icon name="x" size={13} label={$_('combat.hp.dismiss')} /></button
				>
			</span>
		</div>
	{/if}
	<!-- Hit Dice live entirely in the "☾ Short" rest popover now (spend + remaining), not on this panel. -->
	<!-- death takes over the whole sheet (DeathScreen), so the pips stay out of its way -->
	{#if downed && !c.play.death}
		<div class="death-saves">
			<button
				class="hp-btn death-roll"
				onclick={() => combat.deathSave()}
				title={$_('combat.hp.rollDeathSave')}
			>
				<DiceIcon size={14} />
				{$_('combat.hp.deathSave')}
			</button>
			<div class="death-tracks">
				<div class="death-track" role="group" aria-label={$_('combat.hp.deathSuccesses')}>
					<span class="death-track-label good">{$_('combat.hp.success')}</span>
					{#each pips as i (i)}
						<button
							type="button"
							class="death-pip good"
							class:filled={c.play.deathSaves.successes > i}
							aria-label={$_('combat.hp.successN', { values: { n: i + 1 } })}
							aria-pressed={c.play.deathSaves.successes > i}
							onclick={() => combat.toggleDeathSave('successes', i)}
						></button>
					{/each}
				</div>
				<div class="death-track" role="group" aria-label={$_('combat.hp.deathFailures')}>
					<span class="death-track-label bad">{$_('combat.hp.failure')}</span>
					{#each pips as i (i)}
						<button
							type="button"
							class="death-pip bad"
							class:filled={c.play.deathSaves.failures > i}
							aria-label={$_('combat.hp.failureN', { values: { n: i + 1 } })}
							aria-pressed={c.play.deathSaves.failures > i}
							onclick={() => combat.toggleDeathSave('failures', i)}
						></button>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.hitpoints {
		flex: 1;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-3) var(--space-4);
	}
	/* main row: HP readout (label · number · bar) left, adjust controls right */
	.hp-main {
		display: flex;
		gap: 15px;
	}
	.hp-readout {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}
	.hp-controls {
		flex: none;
		width: 120px;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		justify-content: space-between;
		border-inline-start: 1px solid var(--color-border);
		padding-inline-start: 15px;
	}
	.hitpoints .hitpoints-label {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: var(--color-text-muted);
		margin-bottom: 2px;
	}
	/* UPPERCASE mono eyebrow (app label convention) — the label text only, not the Temp HP button */
	.hitpoints-label span {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
	}
	.temptag {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-full);
		cursor: pointer;
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
	}
	.temptag:hover {
		filter: brightness(1.14);
	}
	/* the crit question sits under the damage row it qualifies, in the same muted register as the
	   damage-type select beside it */
	.crit-ask {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		margin-top: var(--space-1-5);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.hitpoints .hitpoints-value {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h2);
	}
	.hitpoints .hitpoints-value small {
		color: var(--color-text-muted);
		font-size: var(--font-size-md);
		font-weight: 500;
	}
	.hitpoints .hitpoints-value .temp {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-body);
		color: var(--color-good);
		margin-inline-start: var(--space-1-5);
	}
	.hitpoints-bar {
		height: 9px;
		border-radius: var(--radius-full);
		background: var(--color-surface-2);
		overflow: hidden;
		border: 1px solid var(--color-border);
		margin-top: var(--space-2);
		display: flex;
	}
	.hitpoints-bar > i {
		display: block;
		height: 100%;
	}
	.hitpoints-bar > i.hitpoints-bar-current {
		background: var(--color-accent);
	}
	.hitpoints-bar > i.hitpoints-bar-temp {
		background: var(--color-good);
		box-shadow: -1px 0 0 var(--color-surface);
	}
	.hp-number {
		width: 100%;
		box-sizing: border-box;
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--font-size-body);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		color: var(--color-text);
		padding: var(--space-1);
	}
	.hp-btn {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2-5);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.hp-btn.damage {
		background: var(--color-danger-soft);
		border: 1px solid var(--color-danger);
		color: var(--color-danger);
	}
	.hp-btn.heal {
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
	}
	.hp-btn:hover {
		filter: brightness(1.12);
	}
	.hp-damage-type {
		margin-top: var(--space-1-5);
		width: 100%;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-xs);
		border-radius: var(--radius);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
	}
	/* B4 concentration-save banner — thin inline bar (not floating, not modal) */
	.conc-banner {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2-5);
		padding: var(--space-1-5) var(--space-2-5);
		border-radius: var(--radius-md);
		background: var(--color-accent-soft);
		border: 1px solid var(--color-accent);
		font-size: var(--font-size-xs);
	}
	.conc-banner.failed {
		background: var(--color-danger-soft);
		border-color: var(--color-danger);
	}
	.conc-warn {
		font-family: var(--font-display);
		font-weight: 600;
		color: var(--color-accent-bright);
	}
	.conc-banner.failed .conc-warn {
		color: var(--color-danger);
	}
	.conc-detail {
		color: var(--color-text-muted);
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.conc-dc {
		width: 44px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		padding: 2px var(--space-1);
	}
	.conc-btn {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2-5);
		border-radius: var(--radius-sm);
		cursor: pointer;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.conc-actions {
		margin-inline-start: auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
	}
	.conc-btn.roll {
		background: var(--color-accent-soft);
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.conc-btn.dismiss {
		padding: var(--space-1) var(--space-2);
		background: transparent;
		border-color: transparent;
		color: var(--color-text-muted);
	}
	.conc-btn:hover {
		filter: brightness(1.12);
	}
	.conc-btn.dismiss:hover {
		background: var(--color-surface-2);
		filter: none;
	}

	.death-saves {
		margin-top: var(--space-3);
		padding-top: var(--space-2-5);
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.hp-btn.death-roll {
		flex: 0 0 auto;
		align-self: flex-start;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}
	.death-tracks {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
	}
	.death-track {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
	}
	.death-track-label {
		font-size: var(--font-size-xs);
		font-weight: 600;
		width: 56px;
	}
	.death-track-label.good {
		color: var(--color-good);
	}
	.death-track-label.bad {
		color: var(--color-danger);
	}
	.death-pip {
		width: 15px;
		height: 15px;
		border-radius: var(--radius-full);
		cursor: pointer;
		padding: 0;
		background: var(--color-surface-2);
	}
	.death-pip.good {
		border: 1px solid var(--color-good);
	}
	.death-pip.bad {
		border: 1px solid var(--color-danger);
	}
	.death-pip.good.filled {
		background: var(--color-good);
	}
	.death-pip.bad.filled {
		background: var(--color-danger);
	}
	.death-pip:hover {
		filter: brightness(1.15);
	}
</style>

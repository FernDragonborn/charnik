<script lang="ts">
	// Hit-points panel (current/max/temp, bar, damage/heal, temp-HP). Always shown.
	// Reads the `combat` view-model singleton; character + sheet come in as props.
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../../state.svelte';
	import { why } from '$lib/combat/helpers';

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
				<span>Hit points</span>
				<button class="temptag" onclick={(e) => openMenu('temphp', e)}>＋ Temp HP</button>
			</div>
			<div class="hitpoints-value" title={why(s.maxHp)}>
				{c.play.hp.current}<small>
					/ {c.play.hp.max ?? s.maxHp.value}</small
				>{#if c.play.hp.temp > 0}<span class="temp">+{c.play.hp.temp} temp</span>{/if}
			</div>
			<div class="hitpoints-bar">
				<i class="hitpoints-bar-current" style="width:{hpBar.cur}%"></i><i
					class="hitpoints-bar-temp"
					style="width:{hpBar.tmp}%"
				></i>
			</div>
		</div>
		<div class="hp-controls">
			<button class="hp-btn heal" onclick={combat.heal} title="Apply healing">＋ Heal</button>
			<input
				class="hp-number"
				type="number"
				min="0"
				bind:value={combat.hpAmount}
				aria-label="HP amount"
			/>
			<button class="hp-btn damage" onclick={combat.damage} title="Apply damage">− Damage</button>
		</div>
	</div>
	{#if combat.damageTypeOptions.length}
		<!-- B20: only shown when the sheet HAS a defense — picks the incoming damage's type so
		     resist (½) / immune (0) / vulnerable (×2) apply. Untyped = plain damage. -->
		<select
			class="hp-damage-type"
			bind:value={combat.damageType}
			aria-label="Damage type (applies resistance / immunity / vulnerability)"
		>
			<option value={null}>untyped</option>
			{#each combat.damageTypeOptions as t (t)}
				<option value={t}>{t}</option>
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
				<span class="conc-warn">✖ Save failed</span>
				<span class="conc-detail">{combat.conc.label} ends</span>
				<button class="conc-btn drop" onclick={combat.dropConcentrationFromSave}>Drop</button>
			{:else}
				<span class="conc-warn">⚠ Concentration check</span>
				<span class="conc-detail">
					{combat.conc.label} · DC
					<input
						class="conc-dc"
						type="number"
						min="1"
						bind:value={pend.dc}
						aria-label="Concentration save DC"
					/>
					· d20 + CON ({combat.concentrationSaveMod >= 0 ? '+' : ''}{combat.concentrationSaveMod})
				</span>
				<button class="conc-btn roll" onclick={combat.rollConcentrationSave}>🎲 Roll</button>
				<button class="conc-btn drop" onclick={combat.dropConcentrationFromSave}>Drop</button>
			{/if}
		</div>
	{/if}
	<!-- Hit Dice live entirely in the "☾ Short" rest popover now (spend + remaining), not on this panel. -->
	{#if downed}
		<div class="death-saves">
			<button class="hp-btn deathroll" onclick={() => combat.deathSave()} title="Roll a death save">
				🎲 Death save
			</button>
			<div class="death-tracks">
				<div class="death-track" role="group" aria-label="Death save successes">
					<span class="death-track-label good">Success</span>
					{#each pips as i (i)}
						<button
							type="button"
							class="death-pip good"
							class:filled={c.play.deathSaves.successes > i}
							aria-label="Success {i + 1}"
							aria-pressed={c.play.deathSaves.successes > i}
							onclick={() => combat.toggleDeathSave('successes', i)}
						></button>
					{/each}
				</div>
				<div class="death-track" role="group" aria-label="Death save failures">
					<span class="death-track-label bad">Failure</span>
					{#each pips as i (i)}
						<button
							type="button"
							class="death-pip bad"
							class:filled={c.play.deathSaves.failures > i}
							aria-label="Failure {i + 1}"
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
		padding: 12px 16px;
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
		gap: 5px;
		justify-content: space-between;
		border-left: 1px solid var(--color-border);
		padding-left: 15px;
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
		padding: 3px 9px;
		border-radius: var(--radius-full);
		cursor: pointer;
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
	}
	.temptag:hover {
		filter: brightness(1.14);
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
		margin-left: 7px;
	}
	.hitpoints-bar {
		height: 9px;
		border-radius: var(--radius-full);
		background: var(--color-surface-2);
		overflow: hidden;
		border: 1px solid var(--color-border);
		margin-top: 8px;
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
		border-radius: 7px;
		color: var(--color-text);
		padding: 4px;
	}
	.hp-btn {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		padding: 5px 11px;
		border-radius: 7px;
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
		margin-top: 6px;
		width: 100%;
		padding: 5px 8px;
		font-size: var(--font-size-xs);
		border-radius: 7px;
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
		gap: 9px;
		margin-top: 10px;
		padding: 7px 10px;
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
		gap: 5px;
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
		padding: 2px 3px;
	}
	.conc-btn {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		padding: 4px 10px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.conc-btn.roll {
		margin-left: auto;
		background: var(--color-accent-soft);
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.conc-btn:hover {
		filter: brightness(1.12);
	}

	.death-saves {
		margin-top: 12px;
		padding-top: 11px;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	.hp-btn.deathroll {
		flex: 0 0 auto;
		align-self: flex-start;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}
	.death-tracks {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.death-track {
		display: flex;
		align-items: center;
		gap: 6px;
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

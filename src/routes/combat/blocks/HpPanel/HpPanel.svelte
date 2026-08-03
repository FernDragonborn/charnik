<script lang="ts">
	// Hit-points panel (current/max/temp, bar, damage/heal, temp-HP). Always shown.
	// Reads the `combat` view-model singleton; character + sheet come in as props.
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../../state.svelte';
	import { why, range } from '$lib/combat/helpers';

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
	{#if combat.shortRestMode === 'dice' && combat.hitDice.length}
		<!-- Hit Dice: a READ-ONLY reserve display (pips show remaining). Spending happens in the "☾ Short"
		     rest popover, not here. Regained on a long rest (2014 half / 2024 all). In the `half` short-rest
		     model Hit Dice aren't a short-rest resource, so this block hides entirely. -->
		<div class="hit-dice">
			<span class="hd-label">Hit dice</span>
			{#each combat.hitDice as h (h.die)}
				<span
					class="hd-pool"
					title="{h.die}: {h.left}/{h.max} left — spend on a short rest (☾ Short)"
				>
					{h.die}
					{#if h.max <= 20}
						<span class="hd-pips">
							{#each range(h.max) as i (i)}
								<span class="hd-pip" class:used={i >= h.left}></span>
							{/each}
						</span>
					{/if}
					<small>{h.left}/{h.max}</small>
				</span>
			{/each}
		</div>
	{/if}
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
	.hit-dice {
		margin-top: 12px;
		padding-top: 11px;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.hd-label {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.hd-pool {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 5px 11px;
		cursor: default; /* read-only reserve display — spending is in the short-rest popover */
	}
	.hd-pool small {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}
	.hd-pips {
		display: inline-flex;
		gap: 3px;
	}
	.hd-pip {
		width: 9px;
		height: 9px;
		border-radius: var(--radius-full);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
	}
	.hd-pip.used {
		background: transparent;
		border-color: var(--color-border-strong);
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

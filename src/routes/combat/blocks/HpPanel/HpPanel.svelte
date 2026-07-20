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
	<div class="hp-adjust">
		<button class="hp-btn damage" onclick={combat.damage} title="Apply damage">− Damage</button>
		<input
			class="hp-number"
			type="number"
			min="0"
			bind:value={combat.hpAmount}
			aria-label="HP amount"
		/>
		<button class="hp-btn heal" onclick={combat.heal} title="Apply healing">Heal ＋</button>
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
	{#if downed}
		<div class="death-saves">
			<button
				class="hp-btn deathroll"
				onclick={(e) => combat.deathSave(e)}
				title="Roll a death save"
			>
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
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 15px 17px;
	}
	.hitpoints .hitpoints-label {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-bottom: 2px;
	}
	.temptag {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 11px;
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
		font-size: 30px;
	}
	.hitpoints .hitpoints-value small {
		color: var(--color-text-muted);
		font-size: 16px;
		font-weight: 500;
	}
	.hitpoints .hitpoints-value .temp {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
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
	.hp-adjust {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
	}
	.hp-number {
		width: 58px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 14px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 7px;
		color: var(--color-text);
		padding: 5px 4px;
	}
	.hp-btn {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 6px 11px;
		border-radius: 7px;
		cursor: pointer;
		flex: 1;
	}
	.hp-btn.damage {
		background: var(--color-danger-soft, rgba(179, 69, 47, 0.12));
		border: 1px solid var(--color-danger, #b3452f);
		color: var(--color-danger, #d06a52);
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
		font-size: 12px;
		border-radius: 7px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
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
		font-size: 11px;
		font-weight: 600;
		width: 56px;
	}
	.death-track-label.good {
		color: var(--color-good);
	}
	.death-track-label.bad {
		color: var(--color-danger, #d06a52);
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
		border: 1px solid var(--color-danger, #b3452f);
	}
	.death-pip.good.filled {
		background: var(--color-good);
	}
	.death-pip.bad.filled {
		background: var(--color-danger, #b3452f);
	}
	.death-pip:hover {
		filter: brightness(1.15);
	}
</style>

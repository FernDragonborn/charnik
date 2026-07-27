<script lang="ts">
	// The dice tray / roll builder (overlay.kind === 'dice'). Reads the shared combat view-model's
	// roll subsystem (combat.tray). Split out of CombatMenus.svelte.
	import { combat } from '../state.svelte';
	import { signed, DICE } from '$lib/combat/helpers';

	const rollSrc = $derived(combat.tray.rollSrc);
	const dice = $derived(combat.tray.dice);
	const rollAdvantage = $derived(combat.tray.rollAdvantage);
	const rollMod = $derived(combat.tray.rollMod);
	const rollExpr = $derived(combat.tray.rollExpr);
	const log = $derived(combat.tray.log);
	const { bumpDie, doRoll } = combat.tray;
</script>

<div class="tray">
	{#if rollSrc}<div class="tray-src"><b>{rollSrc}</b></div>{/if}
	<div class="pool">
		{#each Object.entries(dice).sort((a, b) => Number(b[0]) - Number(a[0])) as [s, c] (s)}
			<div class="poolchip">
				<button onclick={() => bumpDie(Number(s), -1)}>−</button><b>{c}</b>×d{s}<button
					onclick={() => bumpDie(Number(s), 1)}>+</button
				>
			</div>
		{/each}
	</div>
	<p class="gridhint">tap a die to add · ± sets the count</p>
	<div class="dice-grid">
		{#each DICE as d (d)}<button class="die-btn" onclick={() => bumpDie(d, 1)}>d{d}</button>{/each}
	</div>
	<div class="advantage-row">
		<button
			class="adv-seg"
			class:on={rollAdvantage === -1}
			onclick={() => (combat.tray.rollAdvantage = -1)}>Disadv.</button
		>
		<button
			class="adv-seg"
			class:on={rollAdvantage === 0}
			onclick={() => (combat.tray.rollAdvantage = 0)}>Normal</button
		>
		<button
			class="adv-seg"
			class:on={rollAdvantage === 1}
			onclick={() => (combat.tray.rollAdvantage = 1)}>Advant.</button
		>
	</div>
	<div class="roll-mod-row">
		<div class="roll-mod">
			<button onclick={() => (combat.tray.rollMod -= 1)}>−</button> mod {signed(rollMod)}
			<button onclick={() => (combat.tray.rollMod += 1)}>+</button>
		</div>
		<button class="rollbtn" onclick={doRoll}>Roll {rollExpr}</button>
	</div>
	{#if log[0]}{@const r = log[0]}
		<div class="roll-history">
			<div>
				{r.label} · {#if r.advantageRoll}d20 <b class="roll-result">{r.advantageRoll.kept}</b>
				{/if}{r.expr}
				= <span class="roll-result">{Number.isNaN(r.total) ? '' : r.total}</span>
			</div>
			{#if r.advantageRoll}<div class="drop">drop d20({r.advantageRoll.dropped})</div>{/if}
			{#if r.damage}<div>
					dmg {r.damage.expr} = <span class="roll-result">{r.damage.total}</span>
				</div>{/if}
		</div>{/if}
</div>

<style>
	/* --- dice tray / roll builder --- */
	.tray {
		padding: 12px;
	}
	.tray-src {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 9px;
		padding: 8px 11px;
		margin-bottom: 9px;
	}
	.tray-src b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-body);
	}
	.pool {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
		margin-bottom: 9px;
	}
	.poolchip {
		display: flex;
		align-items: center;
		gap: 5px;
		background: var(--color-resource-soft);
		border: 1px solid var(--color-resource);
		border-radius: var(--radius);
		padding: 4px 8px;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-resource);
	}
	.poolchip button {
		all: unset;
		cursor: pointer;
		color: var(--color-resource);
		font-size: var(--font-size-body);
		padding: 0 2px;
	}
	.poolchip b {
		font-family: var(--font-display);
		font-weight: 700;
	}
	.gridhint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0 0 7px;
	}
	.dice-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 7px;
		margin-bottom: 11px;
	}
	.die-btn {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		text-align: center;
		padding: 9px 0;
		border-radius: 9px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
	}
	.die-btn:hover {
		border-color: var(--color-resource);
	}
	.advantage-row {
		display: flex;
		gap: 6px;
		margin-bottom: 11px;
	}
	.adv-seg {
		flex: 1;
		text-align: center;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		padding: 7px 0;
		border-radius: var(--radius);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.adv-seg.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.roll-mod-row {
		display: flex;
		gap: 8px;
		margin: 8px 0;
	}
	.roll-mod {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 7px 9px;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}
	.roll-mod button {
		all: unset;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: var(--font-size-body);
		padding: 0 4px;
	}
	.rollbtn {
		flex: 1;
		text-align: center;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-body);
		color: var(--color-accent-text);
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		border-radius: 9px;
		padding: 9px 12px;
		cursor: pointer;
	}
	.roll-history {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-border);
		margin-top: 10px;
		padding-top: 9px;
	}
	.roll-history .roll-result {
		color: var(--color-good);
		font-weight: 700;
	}
	/* the dropped adv/disadv d20 — shown but dimmed (de-emphasized, not struck through) */
	.drop {
		color: var(--color-text-muted);
		opacity: 0.45;
	}
</style>

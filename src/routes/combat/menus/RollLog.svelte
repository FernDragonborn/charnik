<script lang="ts">
	// The roll-log history menu (overlay.kind === 'log'). Reads the shared combat view-model's roll
	// subsystem (combat.tray.log).
	//
	// Each entry is the SAME `RollRow` the toast mounts, not a lookalike (UBUG-20): the log used to
	// print the roller's internal `expr` plus a dimmed "drop d20(N)" line, so the surface you go to
	// precisely to re-read a roll was the worst rendering of the four. One entry = one row = always
	// the full-detail, single-attack model — the toast is what groups a volley, the log never does,
	// so there is no grouping key and no second code path here.
	import { combat } from '../combat-view-model.svelte';
	import { rollToastModel } from '$lib/dice/roll-toast';
	import RollRow from '$lib/components/RollRow.svelte';

	const log = $derived(combat.tray.log);
</script>

<div class="log-head"><span class="menu-title eyebrow">Roll log · history</span></div>
<div class="log-scroll">
	{#each log as l, i (i)}
		<div class="log-row">
			<!-- the log carries the same live controls as the Playbar, on EVERY roll and forever: tap the
			     d20 to apply advantage after the fact, tap a damage pill marked with the reroll icon to reroll it. N2 Savage
			     Attacker's offer is one of those pills — the label comes from the granting feature
			     (combat.savageLabel), never hardcoded — instead of the bar that used to sit under the row,
			     which could not say WHICH damage it meant once a roll has several parts. -->
			<RollRow
				model={rollToastModel(l)}
				onAdvantage={() => combat.tray.amendAdvantage(l)}
				rerollDamage={combat.savageLabel && l === combat.savagePendingEntry
					? {
							attack: 0,
							part: 0,
							label: `${combat.savageLabel} — reroll damage, keep the higher`,
							run: combat.savageReroll,
						}
					: undefined}
			/>
		</div>
	{:else}<p class="note" style="padding: 11px 13px">
			No rolls yet — tap a stat, skill, save, or attack.
		</p>{/each}
</div>

<style>
	/* --- roll log --- */
	.log-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2-5) var(--space-3) var(--space-1-5);
	}
	/* mono/uppercase/tracking/muted come from the shared .eyebrow primitive; keep only the micro size */
	.log-head .menu-title {
		font-size: var(--font-size-micro);
	}
	.log-scroll {
		padding: 0 var(--space-1-5) var(--space-1);
	}
	.log-row {
		padding: 2px 0;
		border-top: 1px solid var(--color-border);
	}
	.log-row:first-child {
		border-top: 0;
	}
	.note {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0;
	}
</style>

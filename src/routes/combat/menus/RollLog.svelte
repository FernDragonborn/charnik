<script lang="ts">
	// The roll-log history menu (overlay.kind === 'log'). Reads the shared combat view-model's roll
	// subsystem (combat.tray.log). Split out of CombatMenus.svelte.
	import { combat } from '../state.svelte';

	const log = $derived(combat.tray.log);
</script>

<div class="cardhead2"><span class="menu-title">Roll log · history</span></div>
<div class="logscroll">
	{#each log as l, i (i)}
		<div class="log-row">
			<!-- line 1: the roll (attack roll / check) with the dice that were rolled -->
			<div class="lr-top">
				<b>{l.label}</b><span class="lr-tot" class:roll-result={!Number.isNaN(l.total)}
					>{Number.isNaN(l.total) ? '—' : l.total}</span
				>
			</div>
			{#if l.expr || l.advantageRoll}<div class="lr-sub">
					{#if l.advantageRoll}d20 <b>{l.advantageRoll.kept}</b>
					{/if}{l.expr}
				</div>{/if}
			<!-- line 2: the dropped advantage/disadvantage die (dimmed), if any -->
			{#if l.advantageRoll}<div class="lr-sub drop">
					drop d20({l.advantageRoll.dropped})
				</div>{/if}
			<!-- line 3: damage rolled (for an attack) -->
			{#if l.damage}<div class="lr-sub">
					dmg {l.damage.expr} = <b class="roll-result">{l.damage.total}</b>
				</div>{/if}
		</div>
	{:else}<p class="note" style="padding: 11px 13px">
			No rolls yet — tap a stat, skill, save, or attack.
		</p>{/each}
</div>

<style>
	/* --- roll log --- */
	.cardhead2 {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 11px 13px 6px;
	}
	.cardhead2 .menu-title {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.logscroll {
		padding: 0 6px 4px;
	}
	.log-row {
		padding: 7px 7px;
		border-top: 1px solid var(--color-border);
	}
	.log-row:first-child {
		border-top: 0;
	}
	.lr-top {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.lr-top b {
		flex: 1;
		font-weight: 600;
	}
	.lr-tot {
		font-family: var(--font-display);
		font-weight: 700;
	}
	.lr-tot.roll-result {
		color: var(--color-good);
	}
	.lr-sub {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-top: 2px;
	}
	.lr-sub b {
		color: var(--color-good);
	}
	/* the dropped adv/disadv d20 — shown but dimmed (de-emphasized, not struck through) */
	.drop {
		color: var(--color-text-muted);
		opacity: 0.45;
	}
	.note {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0;
	}
</style>

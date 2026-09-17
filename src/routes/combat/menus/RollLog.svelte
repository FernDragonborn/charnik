<script lang="ts">
	// The roll-log history menu (overlay.kind === 'log'). Reads the shared combat view-model's roll
	// subsystem (combat.journal.log).
	//
	// Each entry is the SAME `RollRow` the toast mounts, not a lookalike (UBUG-20): the log used to
	// print the roller's internal `expr` plus a dimmed "drop d20(N)" line, so the surface you go to
	// precisely to re-read a roll was the worst rendering of the four. One entry = one row = always
	// the full-detail, single-attack model, because every row carries its OWN live controls (amend
	// this d20, reroll this damage) and merging a volley into one card would take them away.
	//
	// A volley is still shown as ONE action: its rows share a bracket instead of each sitting under
	// its own rule. That is the whole use of the group id here — the fact survives a reload, and it
	// costs no second rendering path, because each throw is still its own ordinary row.
	import { combat } from '../combat-view-model.svelte';
	import { rollToastModel } from '$lib/dice/roll-toast';
	import { actionRuns } from '$lib/combat/roll';
	import { _ } from '$lib/i18n';
	import RollRow from '$lib/components/RollRow.svelte';

	const actions = $derived(actionRuns(combat.journal.log));
</script>

<div class="log-head"><span class="menu-title eyebrow">{$_('combat.log.rollLog')}</span></div>
<div class="log-scroll">
	{#each actions as run, i (i)}
		<div class="log-row" class:one-action={run.length > 1}>
			<!-- how many throws one action made. The bracket alone is too quiet to carry it at this
			     contrast, and "×3" is what a player says out loud about a volley anyway. -->
			{#if run.length > 1}<span class="action-count eyebrow">×{run.length}</span>{/if}
			{#each run as l, j (j)}
				<!-- the log carries the same live controls as the Playbar, on EVERY roll and forever: tap the
			     d20 to apply advantage after the fact, tap a damage pill marked with the reroll icon to reroll it. N2 Savage
			     Attacker's offer is one of those pills — the label comes from the granting feature
			     (combat.savageLabel), never hardcoded — instead of the bar that used to sit under the row,
			     which could not say WHICH damage it meant once a roll has several parts. -->
				<RollRow
					model={rollToastModel(l, $_)}
					onAdvantage={() => combat.journal.amendAdvantage(l)}
					rerollDamage={combat.savageLabel && l === combat.savagePendingEntry
						? {
								attack: 0,
								part: 0,
								label: $_('combat.roll.rerollDamage', { values: { name: combat.savageLabel } }),
								run: combat.savageReroll,
							}
						: undefined}
				/>
			{/each}
		</div>
	{:else}<p class="note" style="padding: 11px 13px">
			{$_('combat.log.noRolls')}
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
	/* one action, several throws (a volley's beams, Extra Attack's strikes). The bracket is what says
	   they happened together — without it a reloaded volley reads as N unrelated rolls, which is the
	   one fact the two-level model exists to state. */
	.log-row.one-action {
		position: relative;
		border-inline-start: 2px solid var(--color-border-strong);
		/* wide enough for the ×N badge that sits in this gutter — it is an overlay, so the padding is
		   the only thing keeping it off the first row's label */
		padding-inline-start: var(--space-5);
		margin-inline-start: var(--space-1);
	}
	/* One action says its NAME once. Every throw is still its own row — that is what keeps its own
	   live controls — but printing "Eldritch Blast" above each of them says nothing the bracket and
	   the ×N have not already said, and it pushed the numbers a player is comparing further apart.
	   Decided here rather than with a prop on the row: which throw is a repeat is a fact about the
	   RUN, and the run is the chrome's (`RollRow` ▸ the component's own note). */
	.log-row.one-action :global(.roll-row ~ .roll-row .roll-label) {
		display: none;
	}
	.action-count {
		position: absolute;
		inset-inline-start: var(--space-1);
		top: var(--space-2);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.note {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0;
	}
</style>

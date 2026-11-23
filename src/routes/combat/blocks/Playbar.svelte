<script lang="ts">
	// The always-visible "last roll" strip + the way into the roll log. Reads the `combat` view-model
	// singleton (the log lives on the dice tray).
	//
	// It used to print `label + expr + total`, which LOST the roll: on an advantage roll the d20 is
	// not in `expr` (it rides `advantageRoll`), so the chip read "Last · Greataxe +6 = 9" with the die
	// that decided the attack simply absent, and `damage` was ignored entirely — for an attack it
	// showed the to-hit and never the number the player wanted (UBUG-20). It now mounts the same
	// `RollRow` the toast does, so the last roll reads identically wherever you look at it.
	//
	// The row is NOT wrapped in a button: the log cue is its own control. That keeps the roll's own
	// pills free to become controls (UX-3's retroactive advantage) without nesting a button in a
	// button — the constraint that shaped the toast.
	import { provenance } from '#lib/actions/provenance.ts';
	import Icon from '#lib/components/Icon.svelte';
	import { _ } from '#lib/i18n/index.ts';
	import DiceIcon from '#lib/components/DiceIcon.svelte';
	import { combat } from '../combat-view-model.svelte';
	import { rollToastModel, ROLL_LAYOUT } from '#lib/dice/roll-toast.ts';
	import RollRow from '#lib/components/RollRow.svelte';
	import { isTurnAct, LOG_KIND } from '#lib/character/log-kind.ts';
	import { MediaQuery } from 'svelte/reactivity';
	import { NARROW_WINDOW_QUERY } from '#lib/config/narrow-window.ts';
	import { table } from '../../table/table-view-model.svelte';
	import TableRequestLine from '../../table/TableRequestLine.svelte';
	import TableRequestAnswers from '../../table/TableRequestAnswers.svelte';

	const { openMenu } = combat;
	const log = $derived(combat.journal.log);
	// the newest thing the player DID: what followed from it, or what was said about it, sits in the log
	const last = $derived(log.find((e) => isTurnAct(e.kind ?? LOG_KIND.roll)));

	// The live controls on this roll (UX-3). They exist HERE and in the log, never in the toast: a
	// toast expires mid-decision and click-anywhere dismisses it, so it announces and these two act.
	// `savagePendingEntry` is the one roll whose weapon damage can still be rerolled this turn.
	// A GM's request waits HERE on a desktop-wide play screen — beside the sheet the answer depends
	// on, not over it — and the strip widens for it. Narrower, and on every other screen, the dialog
	// asks instead (`TableRequestDialog`).
	const narrow = new MediaQuery(NARROW_WINDOW_QUERY);
	$effect(() => {
		table.asks.playbarHolds = !narrow.current;
		return () => {
			table.asks.playbarHolds = false;
		};
	});
	const pending = $derived(narrow.current ? undefined : table.asks.shown);
	const waiting = $derived(table.asks.requests.length);
	const defended = $derived(pending ? table.asks.defendedOf(pending.request) : null);

	const rerollDamage = $derived(
		last && combat.savageLabel && last === combat.savagePendingEntry
			? {
					attack: 0,
					part: 0,
					label: $_('combat.roll.rerollDamage', { values: { name: combat.savageLabel } }),
					run: combat.savageReroll,
				}
			: undefined,
	);
</script>

<div class="playbar">
	<!-- said once as it arrives: a live region announces a CHANGE, so it stands here empty before the
	     request does, rather than arriving with its words already in it -->
	<span class="visually-hidden" role="status"
		>{#if pending}{$_('table.prompt.title')}: <TableRequestLine
				request={pending.request}
				sheetState={(id) => table.asks.stateFor(id)?.label}
			/>{/if}</span
	>
	<div class="last-roll" class:empty={!last && !pending} class:asking={!!pending}>
		{#if pending}
			<!-- keyed by the request: the next one arrives as a new face, so a second press meant for
			     the first cannot answer what replaced it -->
			{#key pending.requestId}
				<div class="request-face" role="group" aria-labelledby="playbar-request-what">
					<div class="request-said">
						<span class="request-who">{$_('table.prompt.title')}</span>
						<span class="request-what" id="playbar-request-what"
							><TableRequestLine
								request={pending.request}
								sheetState={(id) => table.asks.stateFor(id)?.label}
							/>{#if waiting > 1}<span class="count-pill">1 / {waiting}</span>{/if}</span
						>
						{#if defended}
							<span class="request-who"
								>{$_(`combat.hp.damagePreview.${defended.bucket}`, {
									values: { raw: defended.raw, final: defended.final },
								})}</span
							>
						{/if}
					</div>
					<div class="request-answers system-question">
						<TableRequestAnswers {pending} withTray={false} />
					</div>
				</div>
			{/key}
		{:else if last}
			<RollRow
				model={rollToastModel(last, $_)}
				onAdvantage={() => combat.journal.amendAdvantage(last)}
				{rerollDamage}
				layout={ROLL_LAYOUT.strip}
			/>
		{:else}
			<span class="no-roll">{$_('combat.log.noRolls')}</span>
		{/if}
		<button
			class="log-cue"
			onclick={(e) => openMenu('log', e)}
			use:provenance={$_('combat.log.rollLog')}
			><DiceIcon size={15} />
			{$_('combat.log.logCue')}
			<Icon name="chevron-right" size={12} /></button
		>
	</div>
</div>

<style>
	/* the page puts this in a row beside the turn/time bar, so the strip owns no outer spacing and
	   takes only the width its roll needs (the bar beside it absorbs the rest) */
	.playbar {
		display: flex;
		min-width: 0;
	}
	/* matches the combat bars it sits beside — same surface, same 12px radius, same 56px floor — so
	   the row reads as two halves of one strip rather than two unrelated widgets */
	.last-roll {
		display: flex;
		align-items: stretch;
		min-width: 0;
		max-width: 100%;
		min-height: 56px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		/* a request: the strip widens for it and takes the asking colour; one glow as it settles,
		   then still. Width moves rather than jumps (ui.md ▸ 23), on the mock's one curve and one
		   length (gm-request-h2-motion.html) */
		--playbar-grow: 320ms;
		--playbar-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
		transition:
			min-width var(--playbar-grow) var(--playbar-ease),
			border-color var(--playbar-grow) var(--playbar-ease),
			background-color var(--playbar-grow) var(--playbar-ease);
	}
	.last-roll.asking {
		min-width: min(34rem, 100%);
		border-color: var(--color-accent-deep);
		background: var(--color-accent-soft);
		animation: playbar-arrival 1.4s ease-out var(--playbar-grow) 1;
	}
	@keyframes playbar-arrival {
		from {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 15%, transparent);
		}
		to {
			box-shadow: 0 0 0 5px transparent;
		}
	}
	:global(:root[data-motion='reduced']) .last-roll {
		transition: none;
		animation: none;
	}
	.request-face {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
	}
	.request-said {
		display: flex;
		flex-direction: column;
		justify-content: center;
		flex: 1;
		min-width: 0;
		padding: 0 14px;
	}
	.request-who {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.request-what {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-md);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.request-answers {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		padding: 0 var(--space-2-5);
		border-inline-start: 1px solid var(--color-border);
		align-self: stretch;
	}
	.no-roll {
		display: flex;
		align-items: center;
		padding: var(--space-2) 14px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.log-cue {
		align-self: stretch;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0 var(--space-2-5);
		border: 0;
		border-inline-start: 1px solid var(--color-border);
		background: var(--color-surface-2);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
		cursor: pointer;
	}
	.log-cue:hover {
		color: var(--color-text);
		background: var(--color-surface);
	}
</style>

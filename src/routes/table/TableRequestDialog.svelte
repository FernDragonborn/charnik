<script lang="ts">
	// What the GM asks, raised over whatever screen the player is on — except the play screen at a
	// desktop width, whose playbar holds it beside the sheet the answer depends on. The app is asking
	// a question, so it wears the house dialog shell, and it has no way out but its answers: a stray
	// click on the backdrop must neither take a hit nor turn a roll down.
	import DialogShell from '#lib/components/DialogShell.svelte';
	import { _ } from '#lib/i18n/index.ts';
	import { table } from './table-view-model.svelte';
	import TableRequestLine from './TableRequestLine.svelte';
	import TableRequestAnswers from './TableRequestAnswers.svelte';

	const pending = $derived(table.asks.playbarHolds ? undefined : table.asks.shown);
	const waiting = $derived(table.asks.requests.length);
	const request = $derived(pending?.request);
	const defended = $derived(request ? table.asks.defendedOf(request) : null);
	const takeable = $derived(!!request && table.asks.canAccept(request));
</script>

{#if pending && request}
	<!-- keyed by the request: the next one opens as a new dialog, its focus on Decline, so a second
	     press meant for the first cannot accept what replaced it -->
	{#key pending.requestId}
		<DialogShell
			titleId="table-request-title"
			title={$_('table.prompt.title')}
			subtitle={$_('table.prompt.subtitle')}
			width="min(460px, calc(100vw - 2 * var(--space-4)))"
		>
			<div class="dialog-body table-request-body">
				<p class="table-request-ask">
					<TableRequestLine {request} sheetState={(id) => table.asks.stateFor(id)?.label} />
					{#if waiting > 1}<span class="count-pill">1 / {waiting}</span>{/if}
				</p>
				{#if defended}
					<p class="muted">
						{$_(`combat.hp.damagePreview.${defended.bucket}`, {
							values: { raw: defended.raw, final: defended.final },
						})}
					</p>
				{/if}
				{#if !takeable}
					<p class="table-request-cannot">{table.asks.cannotSay(request)}</p>
				{/if}
			</div>
			<footer class="dialog-foot">
				<span class="dialog-spacer"></span>
				<TableRequestAnswers {pending} />
			</footer>
		</DialogShell>
	{/key}
{/if}

<style>
	.table-request-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.table-request-ask {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-lg);
	}
	.table-request-cannot {
		margin: 0;
		color: var(--color-warning);
		font-size: var(--font-size-sm);
	}
</style>

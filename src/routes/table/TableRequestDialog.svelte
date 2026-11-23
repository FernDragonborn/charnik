<script lang="ts">
	// What the GM asks, raised over whatever screen the player is on. The app is asking a question,
	// so it wears the house dialog shell — and it has no way out but its two buttons: a stray click
	// on the backdrop must neither take a hit nor turn a roll down.
	import DialogShell from '#lib/components/DialogShell.svelte';
	import { _ } from '#lib/i18n/index.ts';
	import { TABLE_REQUEST } from '#lib/table-link/types.ts';
	import { combat } from '../combat/combat-view-model.svelte';
	import { table } from './table-view-model.svelte';
	import TableRequestLine from './TableRequestLine.svelte';

	// one ask at a time: the next waits while a roll is being built in the tray, which it would cover
	const pending = $derived(table.asks.inTray ? undefined : table.asks.requests[0]);
	const waiting = $derived(table.asks.requests.length);
	const request = $derived(pending?.request);
	const takeable = $derived(!!request && table.asks.canAccept(request));
	const buildable = $derived(!!request && table.asks.canBuildInTray(request));
	/** What a hit comes to once this character's defense against its type applies. */
	const defended = $derived(
		request?.kind === TABLE_REQUEST.damage
			? combat.hp.previewOf({ amount: request.amount, type: request.type })
			: null,
	);
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
					<p class="table-request-cannot" id="table-request-cannot">
						{request.kind === TABLE_REQUEST.effect
							? $_('table.prompt.cannotEffect', { values: { id: request.id } })
							: $_('table.prompt.cannotRoll')}
					</p>
				{/if}
			</div>
			<footer class="dialog-foot">
				<span class="dialog-spacer"></span>
				<button class="btn ghost" onclick={() => void table.asks.decline(pending)}
					>{$_('table.prompt.decline')}</button
				>
				<!-- offered only where the tray is mounted: the play screen -->
				{#if buildable}
					<button class="btn" onclick={() => void table.asks.buildInTray(pending)}
						>{$_('table.prompt.inTray')}</button
					>
				{/if}
				<!-- blocked, not disabled: a disabled control takes no focus, so its reason could not be read -->
				<button
					class="btn primary"
					class:is-blocked={!takeable}
					aria-disabled={!takeable}
					aria-describedby={takeable ? undefined : 'table-request-cannot'}
					onclick={() => void table.asks.accept(pending)}
					>{$_(`table.prompt.accept.${request.kind}`)}</button
				>
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

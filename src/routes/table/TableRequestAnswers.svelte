<script lang="ts">
	// The answers to a GM's request — Decline, Build in the tray where a tray is mounted, and the
	// accept that does what was asked — wherever the request is answered: the dialog, the playbar,
	// the roll log. One set, so the three places cannot disagree about what a press does.
	import { provenance } from '#lib/actions/provenance.ts';
	import { _ } from '#lib/i18n/index.ts';
	import { table } from './table-view-model.svelte';
	import type { PendingRequest } from './player-requests.svelte';

	let {
		pending,
		withTray = true,
	}: {
		pending: PendingRequest;
		/** The tray is offered where there is room to say it; the playbar leaves it to the log. */
		withTray?: boolean;
	} = $props();

	const request = $derived(pending.request);
	const takeable = $derived(table.asks.canAccept(request));
	const buildable = $derived(withTray && table.asks.canBuildInTray(request));
</script>

<button class="btn ghost" onclick={() => void table.asks.decline(pending)}
	>{$_('table.prompt.decline')}</button
>
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
	use:provenance={takeable ? '' : table.asks.cannotSay(request)}
	onclick={() => void table.asks.accept(pending)}
	>{$_(`table.prompt.accept.${request.kind}`)}</button
>

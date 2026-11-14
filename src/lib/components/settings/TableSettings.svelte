<script lang="ts">
	// Settings ▸ Table: which relay servers a table THIS app opens is reached through. A GM's
	// choice — a player's app follows the invitation it was handed, and is asked first.
	import { app } from '$lib/stores/app.svelte';
	import { _ } from '$lib/i18n';
	import { RELAY_MODE, type RelayMode } from '$lib/table-link/types';

	const MODES: RelayMode[] = [RELAY_MODE.n0, RELAY_MODE.custom, RELAY_MODE.none];
	const RELAY_SCHEME = 'https://';

	const mode = $derived(app.tableRelay.mode);
	const url = $derived(app.tableRelay.mode === RELAY_MODE.custom ? app.tableRelay.url : '');
	/** The typed address as it is kept across a switch to another mode and back. */
	let typedUrl = $state(app.tableRelay.mode === RELAY_MODE.custom ? app.tableRelay.url : '');
	const urlLooksWrong = $derived(url.trim() !== '' && !url.trim().startsWith(RELAY_SCHEME));

	function choose(next: RelayMode): void {
		app.tableRelay = next === RELAY_MODE.custom ? { mode: next, url: typedUrl } : { mode: next };
	}
	function typeUrl(value: string): void {
		typedUrl = value;
		app.tableRelay = { mode: RELAY_MODE.custom, url: value };
	}
</script>

<section class="sec-head">
	<h2>{$_('settings.table.title')}</h2>
	<p class="sec-note">{$_('settings.table.blurb')}</p>
</section>

<div class="setting-row">
	<span class="setting-label" id="table-relay-label">{$_('settings.table.relay')}</span>
	<div class="setting-options" role="group" aria-labelledby="table-relay-label">
		{#each MODES as choice (choice)}
			<button
				class="pill-btn"
				class:accent={mode === choice}
				aria-pressed={mode === choice}
				onclick={() => choose(choice)}>{$_(`settings.table.relayName.${choice}`)}</button
			>
		{/each}
	</div>
</div>
<p class="sec-note table-note">{$_(`settings.table.relayHint.${mode}`)}</p>

{#if mode === RELAY_MODE.custom}
	<div class="setting-row">
		<label class="setting-label" for="table-relay-url">{$_('settings.table.relayUrl')}</label>
		<input
			id="table-relay-url"
			class="text-field table-relay-url"
			type="url"
			inputmode="url"
			autocomplete="off"
			spellcheck="false"
			value={url}
			placeholder={$_('settings.table.relayUrlPlaceholder')}
			aria-invalid={urlLooksWrong}
			aria-describedby={urlLooksWrong ? 'table-relay-url-problem' : undefined}
			oninput={(e) => typeUrl(e.currentTarget.value)}
		/>
	</div>
	{#if urlLooksWrong}
		<p class="sec-note table-note table-relay-problem" id="table-relay-url-problem">
			{$_('settings.table.relayUrlBad')}
		</p>
	{/if}
{/if}

<p class="sec-note table-note">{$_('settings.table.joiningNote')}</p>

<style>
	/* rows use the global .setting-row / .setting-label / .setting-options (components.css) */
	.table-note {
		margin-top: var(--space-1-5);
	}
	.table-relay-url {
		flex: 1;
		min-width: 0;
		padding: var(--space-1-5) var(--space-2-5);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}
	.table-relay-problem {
		color: var(--color-warning);
	}
</style>

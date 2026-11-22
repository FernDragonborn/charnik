<script lang="ts">
	// Settings ▸ Table: which relay servers a table THIS app opens is reached through. A GM's
	// choice — a player's app follows the invitation it was handed, and is asked first.
	import { app } from '$lib/stores/app.svelte';

	/** Inside a dialog that names the subject itself, the section's own heading is left out. */
	let { embedded = false }: { embedded?: boolean } = $props();
	import { _ } from '$lib/i18n';
	import {
		ADDRESS_FAMILIES,
		RELAY_MODE,
		type AddressFamilies,
		type RelayMode,
	} from '$lib/table-link/types';

	const MODES: RelayMode[] = [RELAY_MODE.n0, RELAY_MODE.custom, RELAY_MODE.none];
	const FAMILIES: AddressFamilies[] = [ADDRESS_FAMILIES.both, ADDRESS_FAMILIES.ipv4];
	const RELAY_SCHEME = 'https://';

	const mode = $derived(app.tableRelay.mode);
	const url = $derived(app.tableRelay.mode === RELAY_MODE.custom ? app.tableRelay.url : '');
	/** The typed address as it is kept across a switch to another mode and back. */
	let typedUrl = $state(app.tableRelay.mode === RELAY_MODE.custom ? app.tableRelay.url : '');
	const urlLooksWrong = $derived(url.trim() !== '' && !url.trim().startsWith(RELAY_SCHEME));
	const addresses = $derived(
		app.tableRelay.mode === RELAY_MODE.none
			? (app.tableRelay.addresses ?? ADDRESS_FAMILIES.both)
			: ADDRESS_FAMILIES.both,
	);

	function choose(next: RelayMode): void {
		app.tableRelay = next === RELAY_MODE.custom ? { mode: next, url: typedUrl } : { mode: next };
	}
	function chooseAddresses(next: AddressFamilies): void {
		app.tableRelay = { mode: RELAY_MODE.none, addresses: next };
	}
	function typeUrl(value: string): void {
		typedUrl = value;
		app.tableRelay = { mode: RELAY_MODE.custom, url: value };
	}
</script>

{#if !embedded}
	<section class="sec-head">
		<h2>{$_('settings.table.title')}</h2>
		<p class="sec-note">{$_('settings.table.blurb')}</p>
	</section>
{/if}

{#snippet choices(
	key: string,
	options: readonly string[],
	current: string,
	pick: (choice: string) => void,
)}
	<div class="setting-row">
		<span class="setting-label" id={`table-${key}-label`}>{$_(`settings.table.${key}`)}</span>
		<div class="setting-options" role="group" aria-labelledby={`table-${key}-label`}>
			{#each options as choice (choice)}
				<button
					class="pill-btn"
					class:accent={current === choice}
					aria-pressed={current === choice}
					onclick={() => pick(choice)}>{$_(`settings.table.${key}Name.${choice}`)}</button
				>
			{/each}
		</div>
	</div>
	<p class="sec-note table-note">{$_(`settings.table.${key}Hint.${current}`)}</p>
{/snippet}

{@render choices('relay', MODES, mode, (picked) => {
	const next = MODES.find((candidate) => candidate === picked);
	if (next) choose(next);
})}

{#if mode === RELAY_MODE.none}
	{@render choices('addresses', FAMILIES, addresses, (picked) => {
		const next = FAMILIES.find((candidate) => candidate === picked);
		if (next) chooseAddresses(next);
	})}
{/if}

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

{#if !embedded}
	<p class="sec-note table-note">{$_('settings.table.joiningNote')}</p>
{/if}

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

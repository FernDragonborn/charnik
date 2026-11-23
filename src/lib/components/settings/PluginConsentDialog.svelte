<script lang="ts">
	// Plugin consent: asked before a plugin is FIRST enabled, and again whenever its code hash changed
	// (docs/internals/plugins.md §6). It answers, in this order, what the plugin gives (its author's
	// words, in the reader's language where written), what needs it (the rows of the enabled packs
	// whose tokens name it — a fact the app knows whether or not the author wrote a word), and what a
	// plugin is and what leaving it off costs. The technical record waits under Details. Every
	// manifest field renders as PLAIN TEXT (PLG-SEC 15) and the url is display-only — never a
	// clickable in-app link (PLG-SEC 7).
	import { _ } from '$lib/i18n';
	import DialogShell from '../DialogShell.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { LOCAL_ORIGIN, pluginDescription, type DiscoveredPlugin } from '$lib/effects/plugin-host';

	/** How many rows "needed for" names before it says how many more. */
	const NEEDED_SHOWN = 6;

	let {
		plugin,
		codeChanged,
		neededFor,
		onAccept,
		onCancel,
	}: {
		plugin: DiscoveredPlugin;
		/** true → the re-consent variant (code differs from what was approved before). */
		codeChanged: boolean;
		/** The rows of the enabled packs that name this plugin, as the player reads them. */
		neededFor: { name: string; kind: string }[];
		onAccept: () => void;
		onCancel: () => void;
	} = $props();

	const m = $derived(plugin.manifest);
	const gives = $derived(pluginDescription(m, app.activeLocale));
</script>

<DialogShell
	titleId="plg-title"
	ask={codeChanged
		? $_('settings.plugins.consent.titleChanged')
		: $_('settings.plugins.consent.title')}
	title={m?.name ?? plugin.namespace}
	width="min(600px, calc(100vw - 2 * var(--space-4)))"
	onDismiss={onCancel}
>
	<div class="dialog-body">
		<div class="gives">
			<span class="dialog-label">{$_('settings.plugins.consent.gives')}</span>
			<p class="said" class:muted={!gives}>{gives || $_('settings.plugins.consent.givesNone')}</p>
			<span class="dialog-label">{$_('settings.plugins.consent.neededFor')}</span>
			{#if neededFor.length}
				<p class="uses">
					{#each neededFor.slice(0, NEEDED_SHOWN) as use, i (i)}<span class="use"
							>{use.name} <span class="kind">{use.kind}</span></span
						>{/each}{#if neededFor.length > NEEDED_SHOWN}<span class="kind"
							>{$_('settings.plugins.consent.neededMore', {
								values: { count: neededFor.length - NEEDED_SHOWN },
							})}</span
						>{/if}
				</p>
			{:else}
				<p class="said muted">{$_('settings.plugins.consent.neededNone')}</p>
			{/if}
		</div>
		<p class="what-is">{$_('settings.plugins.consent.whatIs')}</p>
		<details class="record">
			<summary>{$_('settings.plugins.consent.details')}</summary>
			<dl>
				<dt>{$_('settings.plugins.consent.namespace')}</dt>
				<dd>{plugin.namespace}</dd>
				<!-- WHERE it came from: with a plugin that arrived inside a content pack the user never
				     placed the folder themselves, so say so before they grant it anything. -->
				<dt>{$_('settings.plugins.consent.origin')}</dt>
				<dd>
					{plugin.origin === LOCAL_ORIGIN
						? $_('settings.plugins.originLocal')
						: $_('settings.plugins.originPack', { values: { pack: plugin.origin } })}
				</dd>
				<dt>{$_('settings.plugins.consent.version')}</dt>
				<dd>{m?.version ?? '—'}</dd>
				{#if m?.author}
					<dt>{$_('settings.plugins.consent.author')}</dt>
					<dd>{m.author}</dd>
				{/if}
				{#if m?.url}
					<dt>{$_('settings.plugins.consent.url')}</dt>
					<dd>{m.url}</dd>
				{/if}
				<dt>{$_('settings.plugins.consent.codeHash')}</dt>
				<dd>{plugin.hash?.slice(0, 16)}…</dd>
			</dl>
		</details>
		<p class="warning">{$_('settings.plugins.consent.warning')}</p>
	</div>

	<footer class="dialog-foot">
		<button class="btn" onclick={onCancel}>{$_('settings.plugins.consent.cancel')}</button>
		<span class="dialog-spacer"></span>
		<button class="btn primary" onclick={onAccept}>{$_('settings.plugins.consent.accept')}</button>
	</footer>
</DialogShell>

<style>
	.gives {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.said {
		margin: 0 0 var(--space-2);
		color: var(--color-text);
	}
	.said.muted {
		color: var(--color-text-muted);
	}
	.uses {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: 0;
	}
	.kind {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.what-is,
	.warning {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.what-is {
		color: var(--color-text-muted);
	}
	.warning {
		color: var(--color-warning);
	}
	.record summary {
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.record dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-4);
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-sm);
	}
	.record dt {
		color: var(--color-text-muted);
	}
	.record dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>

<script lang="ts">
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	// Plugin consent — the house attention-dialog template, single-pane notice variant
	// (charnik-dialog-design-template). Shown before a plugin is FIRST enabled, and again whenever
	// its code hash changed (docs/PLUGINS.md §6). Every manifest field renders as PLAIN TEXT
	// (PLG-SEC 15) and the url is display-only — never a clickable in-app link (PLG-SEC 7).
	import { _ } from '$lib/i18n';
	import LangSwitcher from '$lib/components/LangSwitcher.svelte';
	import type { DiscoveredPlugin } from '$lib/effects/plugin-host';

	let {
		plugin,
		codeChanged,
		onAccept,
		onCancel
	}: {
		plugin: DiscoveredPlugin;
		/** true → the re-consent variant (code differs from what was approved before). */
		codeChanged: boolean;
		onAccept: () => void;
		onCancel: () => void;
	} = $props();

	const m = $derived(plugin.manifest);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={onCancel}></div>
<div
	class="dialog consent-dialog"
	role="dialog"
	aria-modal="true"
	aria-labelledby="plg-title"
	use:dismissOnEscape={onCancel}
>
	<header class="dialog-head">
		<div class="dialog-lang-corner"><LangSwitcher /></div>
		<span class="dialog-badge warn">⚿</span>
		<h2 id="plg-title" class="dialog-title">
			{codeChanged
				? $_('settings.plugins.consent.titleChanged')
				: $_('settings.plugins.consent.title')}
		</h2>
		<p class="dialog-subtitle">{$_('settings.plugins.consent.sandbox')}</p>
	</header>

	<div class="manifest">
		<div class="grid">
			<span class="dialog-label">{$_('settings.plugins.consent.name')}</span>
			<span class="val">{m?.name ?? plugin.namespace}</span>
			<span class="dialog-label">{$_('settings.plugins.consent.namespace')}</span>
			<span class="val mono">{plugin.namespace}</span>
			<span class="dialog-label">{$_('settings.plugins.consent.version')}</span>
			<span class="val mono">{m?.version ?? '—'}</span>
			{#if m?.author}
				<span class="dialog-label">{$_('settings.plugins.consent.author')}</span>
				<span class="val">{m.author}</span>
			{/if}
			{#if m?.url}
				<span class="dialog-label">URL</span>
				<span class="val mono">{m.url}</span>
			{/if}
			{#if m?.description}
				<span class="dialog-label">{$_('settings.plugins.consent.description')}</span>
				<span class="val">{m.description}</span>
			{/if}
			<span class="dialog-label">{$_('settings.plugins.consent.codeHash')}</span>
			<span class="val mono">{plugin.hash?.slice(0, 16)}…</span>
		</div>
		<p class="warning">{$_('settings.plugins.consent.warning')}</p>
	</div>

	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onCancel}>{$_('settings.plugins.consent.cancel')}</button>
		<button class="btn primary" onclick={onAccept}>{$_('settings.plugins.consent.accept')}</button>
	</footer>
</div>

<style>
	.consent-dialog {
		width: min(520px, calc(100vw - 2 * var(--space-4)));
	}
	.manifest {
		padding: var(--space-4) var(--space-6);
		overflow: auto;
	}
	.grid {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-4);
		align-items: baseline;
	}
	.val {
		font-size: var(--font-size-md);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}
	.warning {
		margin: var(--space-4) 0 0;
		font-size: var(--font-size-sm);
		color: var(--color-warning);
	}
</style>

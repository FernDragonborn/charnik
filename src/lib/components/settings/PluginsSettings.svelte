<script lang="ts">
	// Settings ▸ Plugins — the L3 sandbox lifecycle UI (docs/PLUGINS.md §6): discovered plugin list
	// with manifest info + status, per-plugin enable behind the consent dialog, the global kill
	// switch, and a refresh re-scan. Desktop-only (PLG-SEC 21) — the web build shows an explainer.
	// Broken folders are listed with their problem, never silently skipped.
	import { _ } from '$lib/i18n';
	import {
		plugins,
		refreshPlugins,
		consentAndEnable,
		disablePlugin,
		enableConsented,
		setKillSwitch,
		pluginStatus,
		type PluginStatus
	} from '$lib/effects/plugin-store.svelte';
	import type { DiscoveredPlugin } from '$lib/effects/plugin-host';
	import PluginConsentDialog from './PluginConsentDialog.svelte';

	let consentFor = $state<DiscoveredPlugin | null>(null);

	const statusKey: Record<PluginStatus, string> = {
		broken: 'settings.plugins.status.broken',
		needs_consent: 'settings.plugins.status.needsConsent',
		code_changed: 'settings.plugins.status.codeChanged',
		disabled: 'settings.plugins.status.disabled',
		enabled: 'settings.plugins.status.enabled'
	};

	async function toggle(p: DiscoveredPlugin) {
		const status = pluginStatus(p, plugins.prefs);
		if (status === 'enabled') await disablePlugin(p.namespace);
		else if (status === 'disabled') await enableConsented(p);
		else if (status === 'needs_consent' || status === 'code_changed') consentFor = p;
	}

	async function acceptConsent() {
		if (consentFor) await consentAndEnable(consentFor);
		consentFor = null;
	}
</script>

<section class="sec-head">
	<h2>{$_('settings.plugins.title')}</h2>
	<p class="sec-note">{$_('settings.plugins.desc')}</p>
</section>

{#if !plugins.supported}
	<p class="empty">{$_('settings.plugins.webOnly')}</p>
{:else}
	<div class="setting-row">
		<span class="setting-label">{$_('settings.plugins.killSwitch')}</span>
		<div class="setting-options">
			<button
				class="pill-btn"
				class:accent={plugins.prefs.killSwitch}
				onclick={() => setKillSwitch(!plugins.prefs.killSwitch)}
			>
				{plugins.prefs.killSwitch
					? $_('settings.plugins.killSwitchOn')
					: $_('settings.plugins.killSwitchOff')}
			</button>
			<button class="pill-btn" onclick={refreshPlugins}>{$_('settings.plugins.refresh')}</button>
		</div>
	</div>

	{#if plugins.discovered.length === 0}
		<p class="empty">{$_('settings.plugins.none')}</p>
	{:else}
		<div class="plugin-list">
			{#each plugins.discovered as p (p.namespace)}
				{@const status = pluginStatus(p, plugins.prefs)}
				<div class="plugin-row" class:dim={status === 'broken' || plugins.prefs.killSwitch}>
					<div class="plugin-meta">
						<div class="plugin-name">
							{p.manifest?.name ?? p.namespace}
							{#if p.manifest}<span class="plugin-version">v{p.manifest.version}</span>{/if}
						</div>
						<div class="plugin-sub">
							<span class="mono">{p.namespace}</span>
							{#if p.manifest?.author}· {p.manifest.author}{/if}
						</div>
						{#if p.problem}
							<div class="plugin-problem">{p.problem}</div>
						{:else if p.manifest?.description}
							<div class="plugin-desc">{p.manifest.description}</div>
						{/if}
					</div>
					<span class="status status-{status}">{$_(statusKey[status])}</span>
					{#if status !== 'broken'}
						<button class="pill-btn" class:accent={status === 'enabled'} onclick={() => toggle(p)}>
							{status === 'enabled'
								? $_('settings.plugins.disable')
								: status === 'disabled'
									? $_('settings.plugins.enable')
									: $_('settings.plugins.review')}
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
{/if}

{#if consentFor}
	<PluginConsentDialog
		plugin={consentFor}
		codeChanged={pluginStatus(consentFor, plugins.prefs) === 'code_changed'}
		onAccept={acceptConsent}
		onCancel={() => (consentFor = null)}
	/>
{/if}

<style>
	.empty {
		color: var(--color-text-muted);
		font-size: var(--font-size-md);
	}
	.plugin-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
	.plugin-row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
	}
	.plugin-row.dim {
		opacity: 0.65;
	}
	.plugin-meta {
		flex: 1;
		min-width: 0;
	}
	.plugin-name {
		font-weight: 600;
		color: var(--color-text);
	}
	.plugin-version {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-left: var(--space-2);
	}
	.plugin-sub {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-top: 2px;
	}
	.mono {
		font-family: var(--font-mono);
	}
	.plugin-desc {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-top: var(--space-1);
	}
	.plugin-problem {
		font-size: var(--font-size-sm);
		color: var(--color-warning);
		margin-top: var(--space-1);
	}
	.status {
		flex: none;
		font-size: var(--font-size-xs);
		font-family: var(--font-mono);
		padding: 2px 8px;
		border-radius: 20px;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.status-enabled {
		color: var(--color-success);
		border-color: currentcolor;
	}
	.status-broken,
	.status-code_changed {
		color: var(--color-warning);
		border-color: currentcolor;
	}
</style>

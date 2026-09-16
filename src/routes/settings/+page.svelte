<script lang="ts">
	// Settings — content management first (the PLAN's "Content sources, collisions, rule options").
	// Theme/system/language switches live in the top bar already; this page owns the heavier content
	// controls: health diagnostics, two-dimensional source filtering, and collision resolution.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { loadContentStore, content } from '$lib/content/store.svelte';
	import { detectCollisions } from '$lib/content/sources.svelte';
	import GeneralSettings from '$lib/components/settings/GeneralSettings.svelte';
	import StorageSettings from '$lib/components/settings/StorageSettings.svelte';
	import ContentHealth from '$lib/components/settings/ContentHealth.svelte';
	import SourceManager from '$lib/components/settings/SourceManager.svelte';
	import CollisionManager from '$lib/components/settings/CollisionManager.svelte';
	import PluginsSettings from '$lib/components/settings/PluginsSettings.svelte';
	import ThemesSettings from '$lib/components/settings/ThemesSettings.svelte';
	import { _ } from '$lib/i18n';
	import { deriveHealth } from '$lib/character/health.svelte';
	import { updates } from '$lib/content/remote/updates.svelte';

	const TAB_IDS = [
		'general',
		'themes',
		'data',
		'health',
		'sources',
		'collisions',
		'plugins',
	] as const;
	type Tab = (typeof TAB_IDS)[number];

	// `?tab=` makes a tab LINKABLE, which is what the "Rules update" chip needs: it used to point at
	// `/settings` and land on General, so the one panel that knows about the waiting update was still
	// a click away — and clicking the chip while already in Settings did nothing at all, since the URL
	// never changed. A tab a link can name fixes both.
	const urlTab = $derived(TAB_IDS.find((id) => id === page.url.searchParams.get('tab')));
	let tab = $state<Tab>('general');
	$effect(() => {
		if (urlTab) tab = urlTab;
	});

	onMount(loadContentStore);

	const graph = $derived(content.graph);
	// badge counts on the tabs
	// the badge must count EVERYTHING the panel shows, derive-time issues included — otherwise a
	// per-character content problem sits in a tab with no hint that it's worth opening
	const issueCount = $derived(
		(graph ? graph.issues.length + graph.metaIssues.length + graph.driftItems.length : 0) +
			deriveHealth.issues.length,
	);
	const collisionCount = $derived(graph ? detectCollisions(graph).length : 0);

	// a tab's NAME derives from its id (`settings.tab.<id>`), so a tab is spelled in one place
	const TABS: { id: Tab; badge?: () => number }[] = [
		{ id: 'general' },
		{ id: 'themes' },
		{ id: 'data' },
		{ id: 'health', badge: () => issueCount },
		// the pack panel lives in this tab, so a waiting update is a reason to open it
		{ id: 'sources', badge: () => Object.keys(updates.pending).length },
		{ id: 'collisions', badge: () => collisionCount },
		{ id: 'plugins' },
	];
</script>

<svelte:head><title>{$_('nav.settings')} — Charnik</title></svelte:head>

<div class="settings">
	<h1>{$_('nav.settings')}</h1>
	<div class="tabs">
		{#each TABS as t (t.id)}
			<button class="tab" class:active={tab === t.id} onclick={() => (tab = t.id)}>
				{$_(`settings.tab.${t.id}`)}
				{#if t.badge && t.badge() > 0}<span class="badge">{t.badge()}</span>{/if}
			</button>
		{/each}
	</div>

	<div class="panel">
		{#if tab === 'general'}
			<GeneralSettings />
		{:else if tab === 'themes'}
			<ThemesSettings />
		{:else if tab === 'data'}
			<StorageSettings />
		{:else if tab === 'health'}
			<ContentHealth />
		{:else if tab === 'sources'}
			<SourceManager />
		{:else if tab === 'collisions'}
			<CollisionManager />
		{:else}
			<PluginsSettings />
		{/if}
	</div>
</div>

<style>
	.settings {
		max-width: 820px;
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h4);
		margin: 0 0 var(--space-4);
	}
	.tabs {
		display: flex;
		gap: var(--space-1);
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 20px;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		font-family: var(--font-body);
		font-size: var(--font-size-body);
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted);
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		margin-bottom: -1px;
	}
	.tab:hover {
		color: var(--color-text);
	}
	.tab.active {
		color: var(--color-text);
		border-bottom-color: var(--color-accent);
	}
	/* The full row of tabs measures ~530px. Narrower than that it scrolls sideways rather than wrapping
	   into rows, because a wrapped row's active underline would float mid-panel instead of sitting on
	   the strip's own bottom border. */
	@media (max-width: 640px) {
		.tabs {
			overflow-x: auto;
		}
		.tab {
			flex: 0 0 auto;
			white-space: nowrap;
		}
	}
	.badge {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		min-width: 16px;
		text-align: center;
		padding: 1px var(--space-1);
		border-radius: var(--radius-full);
		background: var(--color-warning);
		color: var(--color-warning-text);
	}
</style>

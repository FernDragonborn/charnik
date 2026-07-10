<script lang="ts">
	// Settings — content management first (the PLAN's "Content sources, collisions, rule options").
	// Theme/system/language switches live in the top bar already; this page owns the heavier content
	// controls: health diagnostics, two-dimensional source filtering, and collision resolution.
	import { onMount } from 'svelte';
	import { loadContentStore, content } from '$lib/content/store.svelte';
	import { detectCollisions } from '$lib/content/sources.svelte';
	import ContentHealth from '$lib/components/settings/ContentHealth.svelte';
	import SourceManager from '$lib/components/settings/SourceManager.svelte';
	import CollisionManager from '$lib/components/settings/CollisionManager.svelte';
	import { _ } from '$lib/i18n';

	type Tab = 'health' | 'sources' | 'collisions';
	let tab = $state<Tab>('health');

	onMount(loadContentStore);

	const graph = $derived(content.graph);
	// badge counts on the tabs
	const issueCount = $derived(
		graph ? graph.issues.length + graph.metaIssues.length + graph.driftItems.length : 0
	);
	const collisionCount = $derived(graph ? detectCollisions(graph).length : 0);

	const TABS: { id: Tab; label: string; badge?: () => number }[] = [
		{ id: 'health', label: 'Content health', badge: () => issueCount },
		{ id: 'sources', label: 'Sources' },
		{ id: 'collisions', label: 'Collisions', badge: () => collisionCount }
	];
</script>

<svelte:head><title>Settings — Charnik</title></svelte:head>

<div class="settings">
	<h1>{$_('nav.settings')}</h1>
	<div class="tabs">
		{#each TABS as t (t.id)}
			<button class="tab" class:active={tab === t.id} onclick={() => (tab = t.id)}>
				{t.label}
				{#if t.badge && t.badge() > 0}<span class="badge">{t.badge()}</span>{/if}
			</button>
		{/each}
	</div>

	<div class="panel">
		{#if tab === 'health'}
			<ContentHealth />
		{:else if tab === 'sources'}
			<SourceManager />
		{:else}
			<CollisionManager />
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
		font-size: 24px;
		margin: 0 0 16px;
	}
	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 20px;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-body);
		font-size: 14px;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted);
		padding: 8px 12px;
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
	.badge {
		font-family: var(--font-mono);
		font-size: 10px;
		min-width: 16px;
		text-align: center;
		padding: 1px 5px;
		border-radius: 20px;
		background: var(--color-warning);
		color: #1a1400;
	}
</style>

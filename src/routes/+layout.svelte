<script lang="ts">
	import '$lib/styles/app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { app } from '$lib/stores/app.svelte';
	import { dirFor, locale as i18nLocale, _ } from '$lib/i18n';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import LangSwitcher from '$lib/components/LangSwitcher.svelte';
	import ContentMetaModal from '$lib/components/ContentMetaModal.svelte';
	import HashDriftModal from '$lib/components/HashDriftModal.svelte';
	import { loadContentStore } from '$lib/content/store.svelte';
	import { review, pendingMetaIssues, pendingDriftItems } from '$lib/content/review.svelte';
	import { Toaster } from 'svelte-sonner';
	import { onMount, onDestroy } from 'svelte';
	import { detectPlatform, Platform } from '$lib/storage/provider';
	import {
		getSavedDataDir,
		defaultDataDir,
		grantDataDirScope,
		setDataDirOverride,
		pickDataDir
	} from '$lib/storage/tauri';
	import FirstRunModal from '$lib/components/FirstRunModal.svelte';
	import { reloadApp } from '$lib/content/reload';
	import { reloadContent } from '$lib/content/store.svelte';
	import { startContentWatcher, stopContentWatcher } from '$lib/content/watcher';
	import { loadRoster } from '$lib/character/store.svelte';

	let { children } = $props();

	// The ⟳ button does a no-flash refresh: re-read content + roster from disk into their reactive
	// stores, so every view re-derives without a page reload. F5 keeps the familiar hard reload
	// (flush + reload the webview — not a process restart). See $lib/content/reload.
	let refreshing = $state(false);
	async function softRefresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await reloadContent();
			await loadRoster();
		} finally {
			refreshing = false;
		}
	}
	function onGlobalKey(e: KeyboardEvent) {
		if (e.code === 'F5') {
			e.preventDefault();
			void reloadApp();
		}
	}

	const nav = [
		{ href: '/', key: 'nav.roster' },
		{ href: '/combat', key: 'nav.combat' },
		{ href: '/compendium', key: 'nav.compendium' },
		{ href: '/settings', key: 'nav.settings' }
	];

	// Links must include the base path so navigation works under a subpath (GitHub Pages
	// serves the app at /<repo>). base is '' for the desktop build (served at root).
	const link = (href: string) => `${base}${href}`;
	const norm = (p: string) => p.replace(/\/$/, '') || '/';
	const isCurrent = (href: string) => norm(page.url.pathname) === norm(link(href));

	// Single source of truth for live switches: mirror the store onto <html>. No reload.
	$effect(() => {
		if (!browser) return;
		const el = document.documentElement;
		el.dataset.theme = app.theme;
		el.lang = app.activeLocale;
		el.dir = dirFor(app.activeLocale);
	});

	// Keep svelte-i18n's active locale in sync with the store.
	$effect(() => {
		i18nLocale.set(app.activeLocale);
	});

	// Content loads once at startup so the DATA-VER-1 review surfaces app-wide. On desktop the FIRST
	// launch first asks WHERE to keep the data (docs/PLAN.md) and holds the load until chosen, so it
	// seeds to the chosen folder; a saved custom folder is re-granted fs-scope each start. Web/headless
	// just load. Cached — a no-op if a page already loaded it.
	let firstRunDefault = $state<string | null>(null); // non-null → show the first-run picker
	onMount(async () => {
		if (detectPlatform() !== Platform.Desktop) {
			loadContentStore();
			return;
		}
		const saved = await getSavedDataDir();
		if (saved) {
			await grantDataDirScope(saved); // re-allow a custom folder outside the static scope
			await loadContentStore();
			startContentWatcher(); // live-refresh when a CSV is edited on disk
		} else {
			firstRunDefault = await defaultDataDir(); // first run → show picker, hold content load
		}
	});
	onDestroy(stopContentWatcher);

	async function confirmDataDir(dir: string) {
		await grantDataDirScope(dir);
		await setDataDirOverride(dir);
		firstRunDefault = null;
		await loadContentStore();
		startContentWatcher();
	}
	// Drift is shown first (a quick date/hash confirm), then the metadata prompt.
	const driftItems = $derived(pendingDriftItems());
	const metaIssues = $derived(pendingMetaIssues());

	function toggleTheme() {
		app.theme = app.theme === 'dark' ? 'light' : 'dark';
	}
	// svelte-sonner only accepts light/dark/system; custom theme ids render on the dark base.
	const toasterTheme = $derived(app.theme === 'light' ? 'light' : 'dark');
	function toggleSystem() {
		app.activeSystem = app.activeSystem === '5.5e' ? '5e' : '5.5e';
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<svelte:window onkeydown={onGlobalKey} />

<a class="skip-link" href="#main">{$_('nav.skipToContent')}</a>

<header class="topbar">
	<a class="wordmark" href={link('/')}>Char<span>nik</span></a>
	<nav class="nav" aria-label="Primary">
		{#each nav as item (item.href)}
			<a href={link(item.href)} aria-current={isCurrent(item.href) ? 'page' : undefined}>
				{$_(item.key)}
			</a>
		{/each}
	</nav>
	<a
		class="feedback"
		href="https://github.com/FernDragonborn/charnik/issues"
		target="_blank"
		rel="noopener noreferrer"
		title={$_('feedback.title')}
	>
		{$_('feedback.link')}
	</a>
	<div class="chips">
		<button type="button" class="chip" onclick={toggleSystem} title={$_('settings.system')}>
			{app.activeSystem}
		</button>
		<LangSwitcher />
		<button type="button" class="chip" onclick={toggleTheme} title={$_('settings.theme')}>
			{app.theme === 'dark' ? '☾' : '☀'}
		</button>
		<button
			type="button"
			class="chip"
			onclick={() => void softRefresh()}
			disabled={refreshing}
			title={$_('refresh.title')}
			aria-label={$_('refresh.title')}>⟳</button
		>
		<kbd>Ctrl K</kbd>
	</div>
</header>

<!-- Translate mode needs the full viewport width (3 columns); other routes stay centred to 1040px. -->
<main id="main" tabindex="-1" class:full-bleed={page.url.pathname.startsWith(`${base}/translate`)}>
	{@render children()}
</main>

{#if firstRunDefault}
	<FirstRunModal defaultDir={firstRunDefault} pickFolder={pickDataDir} onConfirm={confirmDataDir} />
{/if}

<CommandPalette />

<!-- DATA-VER-1 startup review: drift first, then missing-metadata. Confirm actions do the write-back
     (task 6); for now they dismiss for the session. Shipped SRD carries full metadata, so a clean
     install shows neither. -->
{#if driftItems.length}
	<HashDriftModal
		items={driftItems}
		onUpdate={() => (review.driftDismissed = true)}
		onSkip={() => (review.driftDismissed = true)}
		onNeverAsk={() => (review.driftDismissed = true)}
	/>
{:else if metaIssues.length}
	<ContentMetaModal
		issues={metaIssues}
		onFillAndSave={() => (review.metaDismissed = true)}
		onSkip={() => (review.metaDismissed = true)}
		onNeverAsk={() => (review.metaDismissed = true)}
	/>
{/if}

<Toaster
	position="top-center"
	theme={toasterTheme}
	richColors
	closeButton
	toastOptions={{ duration: 6000 }}
/>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
	}
	.wordmark {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-lg);
		letter-spacing: -0.01em;
		text-decoration: none;
		color: var(--color-text);
	}
	.wordmark span {
		color: var(--color-accent);
	}
	.nav {
		display: flex;
		gap: var(--space-3);
		font-family: var(--font-display);
		font-size: var(--font-size-sm);
	}
	.nav a {
		text-decoration: none;
		color: var(--color-text-muted);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
	}
	.nav a[aria-current='page'] {
		color: var(--color-text);
		background: var(--color-surface-2);
	}
	.feedback {
		margin-left: auto;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
		white-space: nowrap;
		text-decoration: none;
		color: var(--color-accent-bright);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
	}
	.feedback:hover {
		background: var(--color-accent-soft, var(--color-surface-2));
	}
	.chips {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	/* the chip buttons use the shared global .chip (styles/components.css) */
	.chips kbd {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 2px var(--space-2);
	}
	main {
		outline: none;
		/* main is the scroll region; body fills the viewport and never scrolls itself, so
		   full-height pages (compendium) size to the available space with no stray body
		   scrollbar. main spans the FULL width (scrollbar at the viewport edge — no dead side
		   zones); the content is centred to 1040px via auto inline padding, not a max-width on
		   the scroll container. */
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding-block: var(--space-5);
		padding-inline: max(var(--space-5), calc((100% - 1040px) / 2));
	}
	/* full-bleed routes (translate): use the whole width, keep only a small edge gutter */
	main.full-bleed {
		padding-inline: var(--space-5);
	}
	:global(body) {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
</style>

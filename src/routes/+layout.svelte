<script lang="ts">
	import '$lib/styles/app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { app } from '$lib/stores/app.svelte';
	import { registerCustomThemes } from '$lib/styles/customThemes';
	import { BUNDLED_THEMES } from '$lib/styles/presetThemes';
	import { initThemes } from '$lib/styles/themeFiles';
	import { ui } from '$lib/stores/ui.svelte';
	import { dirFor, locale as i18nLocale, _ } from '$lib/i18n';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import LangSwitcher from '$lib/components/LangSwitcher.svelte';
	import ContentMetaModal from '$lib/components/ContentMetaModal.svelte';
	import HashDriftModal from '$lib/components/HashDriftModal.svelte';
	import { content, loadContentStore } from '$lib/content/store.svelte';
	import {
		autoCheckAllowed,
		checkNow,
		restorePendingUpdates,
		updates,
	} from '$lib/content/remote/updates.svelte';
	import { missingUnanswered } from '$lib/content/packs.svelte';
	import MissingContentModal from '$lib/components/MissingContentModal.svelte';
	import { loadPlugins } from '$lib/effects/plugin-store.svelte';
	import {
		adoptDriftedFiles,
		autoAdoptDrift,
		fillMissingMeta,
		review,
		pendingMetaIssues,
		pendingDriftItems,
	} from '$lib/content/review.svelte';
	import type { FilledMeta } from '$lib/content/meta';
	import type { RestampFailure } from '$lib/content/restamp';
	import { Toaster, toast } from 'svelte-sonner';
	import { takeFlash } from '$lib/stores/flash';
	import { externalLinkToOpen, shouldCancelNavigation } from '$lib/util/links';
	import { onMount, onDestroy } from 'svelte';
	import { detectPlatform, Platform, getUserStorage } from '$lib/storage/provider';
	import {
		applySavedDataDir,
		defaultDataDir,
		setDataDirOverride,
		pickDataDir,
		openExternalUrl,
	} from '$lib/storage/tauri';
	import FirstRunModal from '$lib/components/FirstRunModal.svelte';
	import MobileWarning from '$lib/components/MobileWarning.svelte';
	import { reloadApp } from '$lib/content/reload';
	import { reloadContent } from '$lib/content/store.svelte';
	import { startContentWatcher, stopContentWatcher } from '$lib/content/watcher';
	import { loadRoster } from '$lib/character/store.svelte';
	import {
		updater,
		checkForUpdate,
		installUpdate,
		simulateUpdateAvailable,
	} from '$lib/update/updater.svelte';
	import { initDiag, captureGlobalErrors, logger } from '$lib/diag/logger';
	import DiagnosticsModal from '$lib/components/DiagnosticsModal.svelte';

	let { children } = $props();

	// The bug-report flow (audit DIAG-1): the "Found a bug?" chip opens this instead of jumping straight
	// to GitHub, so the user has a diagnostics bundle to attach.
	let showDiagnostics = $state(false);

	// The refresh chip does a no-flash refresh: re-read content + roster from disk into their reactive
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
	// Ctrl+R interception is DESKTOP ONLY. In the browser (web target / dev) Ctrl+R and Ctrl+Shift+R
	// must stay the native page reload — we don't hijack them. F5 stays intercepted everywhere so it
	// flushes pending writes before reloading.
	const isDesktop = browser && detectPlatform() === Platform.Desktop;
	function onGlobalKey(e: KeyboardEvent) {
		if (e.code === 'F5') {
			e.preventDefault();
			void reloadApp(); // hard reload (flush + reload the webview)
		} else if (isDesktop && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyR') {
			// Desktop only: the webview's native Ctrl+R is a hard reload → swap it for our no-flash soft
			// refresh (matches the refresh chip). Ctrl+Shift+R is left alone.
			e.preventDefault();
			void softRefresh();
		}
	}

	const nav = [
		{ href: '/', key: 'nav.roster' },
		{ href: '/combat', key: 'nav.combat' },
		{ href: '/compendium', key: 'nav.compendium' },
		{ href: '/settings', key: 'nav.settings' },
	];

	// Links must include the base path so navigation works under a subpath (GitHub Pages
	// serves the app at /<repo>). base is '' for the desktop build (served at root).
	const link = (href: string) => `${base}${href}`;
	const norm = (p: string) => p.replace(/\/$/, '') || '/';
	const isCurrent = (href: string) => norm(page.url.pathname) === norm(link(href));

	// Single source of truth for live switches: mirror the store onto <html>. No reload.
	$effect(() => {
		if (!browser) return;
		// register all themes BEFORE activating one, so `[data-theme=id]` has its rule ready. Bundled
		// themes are seeded into app.customThemes as files (see syncThemes), so this one list covers them.
		registerCustomThemes(app.customThemes);
		const el = document.documentElement;
		el.dataset.theme = app.theme;
		el.lang = app.activeLocale;
		el.dir = dirFor(app.activeLocale);
	});

	// Keep svelte-i18n's active locale in sync with the store.
	$effect(() => {
		void i18nLocale.set(app.activeLocale);
	});

	/**
	 * A link OUT of the app opens in the OS browser, never in the app's own window.
	 *
	 * security.md §5 has stated this as a control for a long time and nothing implemented it. It
	 * matters because content prose is rendered HTML from CSVs a stranger may have written: DOMPurify
	 * strips anything executable and correctly keeps `<a href>`, so one click on a spell description
	 * replaced the whole app with a remote page — in a window with no address bar, no back button and
	 * nothing to say what happened.
	 *
	 * ONE listener in the layout rather than a handler per renderer: this has to hold for every link
	 * the app ever shows — content prose, a translated UI string (a user can drop in a locale file),
	 * a dialog's "report a bug" — and a rule enforced at each call site is a rule with a hole in it.
	 * Capture phase, so it runs before SvelteKit's own router or any component handler.
	 *
	 * Desktop only: on the web the browser already owns this, tabs and address bar included.
	 */
	$effect(() => {
		if (!browser || detectPlatform() !== Platform.Desktop) return;
		const onClick = (event: MouseEvent): void => {
			const anchor = (event.target as Element | null)?.closest?.('a[href]');
			if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented) return;
			const { href } = anchor;
			if (!shouldCancelNavigation(href, location.origin)) return; // in-app: that is the router
			event.preventDefault();
			const target = externalLinkToOpen(href, location.origin);
			if (target === null) return; // cancelled, but not a scheme we hand to the OS either
			void openExternalUrl(target).catch((e: unknown) =>
				logger.warn('could not open link', { href, e }),
			);
		};
		document.addEventListener('click', onClick, true);
		return () => document.removeEventListener('click', onClick, true);
	});

	// Content loads once at startup so the DATA-VER-1 review surfaces app-wide. On desktop the FIRST
	// launch first asks WHERE to keep the data (docs/plan.md) and holds the load until chosen, so it
	// seeds to the chosen folder; a saved custom folder is re-granted fs-scope each start. Web/headless
	// just load. Cached — a no-op if a page already loaded it.
	let firstRunDefault = $state<string | null>(null); // non-null → show the first-run picker
	let stopErrorCapture: (() => void) | null = null;
	onMount(async () => {
		void initDiag(); // wire the desktop file sink (no-op on web); ring buffer works immediately
		stopErrorCapture = captureGlobalErrors(); // route uncaught errors/rejections into the logger
		logger.info('app started', { version: __APP_VERSION__, platform: detectPlatform() });
		const flash = takeFlash(); // a success note stashed before a reload (e.g. data-folder move)
		if (flash) toast.success(flash);
		void checkForUpdate(); // fire-and-forget; self-guards to desktop, never blocks the load
		// Dev preview of the update chip: `?dev-update` in the URL. No-op in production.
		if (import.meta.env.DEV && page.url.searchParams.has('dev-update')) simulateUpdateAvailable();
		if (detectPlatform() !== Platform.Desktop) {
			void loadContentStore();
			void syncThemes(); // web: IndexedDB storage is always ready
			return;
		}
		const saved = await applySavedDataDir(); // Rust re-grants the custom folder from its own pointer
		if (saved) {
			await loadContentStore();
			startContentWatcher(); // live-refresh when a CSV is edited on disk
			void loadPlugins(); // desktop-only L3 discovery; consented+enabled plugins wake up
			void syncThemes(); // load user themes from the data dir now it's granted
			// Content-pack updates (REL-4). First put back what the last check already found — that
			// costs nothing and needs no permission, it is a conclusion we reached, not a new request.
			// Then check, which self-gates on the user's update mode + the once-a-day throttle. Both
			// fire-and-forget, AFTER content is up (the impact preview reads the graph), and neither
			// ever APPLIES anything — that stays a click in Settings.
			void restorePendingUpdates().then(() => {
				if (autoCheckAllowed()) return checkNow();
			});
		} else {
			firstRunDefault = await defaultDataDir(); // first run → show picker, hold content load
		}
	});
	onDestroy(() => {
		stopContentWatcher();
		stopErrorCapture?.();
	});

	/** Reconcile custom themes with the data dir (files are the source of truth; a first launch after
	 *  the localStorage-only version migrates the cache to files). Best-effort. */
	async function syncThemes() {
		if (!browser) return;
		try {
			const { themes, newlySeeded } = await initThemes(
				getUserStorage(),
				BUNDLED_THEMES,
				app.seededBundledIds,
				app.customThemes, // migrate any pre-files (localStorage-only) themes into files, once
			);
			app.customThemes = themes;
			if (newlySeeded.length) app.seededBundledIds = [...app.seededBundledIds, ...newlySeeded];
		} catch {
			/* keep the localStorage cache if the store isn't reachable */
		}
	}

	async function confirmDataDir(dir: string) {
		await setDataDirOverride(dir); // dir was picker-chosen (already granted in Rust); this persists it

		firstRunDefault = null;
		await loadContentStore();
		startContentWatcher();
		void loadPlugins();
		void syncThemes(); // data dir just chosen → load/seed themes there
	}
	// Drift is shown first (a quick date/hash confirm), then the metadata prompt.
	const driftItems = $derived(pendingDriftItems());
	const metaIssues = $derived(pendingMetaIssues());

	// Content-editing mode adopts a hand-edit instead of asking. Hung off the GRAPH rather than off
	// each load call site, so every path reaches it (startup, the first-run folder pick, a data-folder
	// change, the watcher) — it self-guards and finds nothing to do once the drift is stamped away.
	$effect(() => {
		if (content.graph) void autoAdoptDrift();
	});

	// The write-back the two review dialogs promise (DATA-VER-1 task 6). Dismiss FIRST so the dialog
	// closes on the click rather than after the disk work, then report anything that would not write —
	// a file the app cannot fix is exactly what the user must hear about.
	function reportFailures(failures: RestampFailure[]): void {
		if (failures.length === 0) return;
		toast.error(
			$_('contentReview.writeFailed', {
				values: { files: failures.map((f) => f.file).join(', ') },
			}),
		);
	}
	async function adoptDrift(files: string[]): Promise<void> {
		review.driftDismissed = true;
		reportFailures(await adoptDriftedFiles(files));
	}
	async function fillMeta(fills: FilledMeta): Promise<void> {
		review.metaDismissed = true;
		reportFailures(await fillMissingMeta(fills));
	}

	function toggleTheme() {
		app.theme = app.theme === 'dark' ? 'light' : 'dark';
	}
	// svelte-sonner only accepts light/dark/system; custom theme ids render on the dark base.
	const toasterTheme = $derived(app.theme === 'light' ? 'light' : 'dark');

	/** Content packs with an update waiting — the count the header chip shows. */
	const pendingPacks = $derived(Object.keys(updates.pending).length);

	// The update chip only exists once a newer build is found; it stays gold-lit until installed, shows
	// live % while downloading, and is inert (no re-trigger) mid-install.
	const updateBusy = $derived(updater.status === 'downloading' || updater.status === 'installing');
	const updateLabel = $derived.by(() => {
		if (updater.status === 'downloading') return `${updater.progress}%`;
		if (updater.status === 'installing') return '…';
		return $_('update.ready');
	});
	const updateTitle = $derived.by(() => {
		if (updater.status === 'error') return $_('update.error', { values: { error: updater.error } });
		if (updater.status === 'downloading')
			return $_('update.downloading', { values: { progress: updater.progress } });
		if (updater.status === 'installing') return $_('update.installing');
		return $_('update.tooltip', { values: { version: updater.version } });
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<svelte:window onkeydown={onGlobalKey} />

<a class="skip-link" href="#main">{$_('nav.skipToContent')}</a>

<header class="topbar">
	<a class="wordmark" href={link('/')}>Char<span>nik</span></a>
	<nav class="nav" aria-label={$_('nav.primary')}>
		{#each nav as item (item.href)}
			<a href={link(item.href)} aria-current={isCurrent(item.href) ? 'page' : undefined}>
				{$_(item.key)}
			</a>
		{/each}
	</nav>
	<button
		type="button"
		class="feedback"
		onclick={() => (showDiagnostics = true)}
		title={$_('feedback.title')}
		aria-label={$_('feedback.link')}
	>
		<Icon name="bug" size={13} />
		<span class="control-label">{$_('feedback.link')}</span>
	</button>
	<div class="chips">
		<LangSwitcher />
		<button type="button" class="chip" onclick={toggleTheme} title={$_('settings.theme')}>
			<Icon name={app.theme === 'dark' ? 'moon' : 'sun'} label={$_('settings.theme')} />
		</button>
		<button
			type="button"
			class="chip"
			onclick={() => void softRefresh()}
			disabled={refreshing}
			title={isDesktop ? `${$_('refresh.title')} (Ctrl+R)` : $_('refresh.title')}
			aria-label={isDesktop ? `${$_('refresh.title')} (Ctrl+R)` : $_('refresh.title')}
			><Icon name="rotate-cw" /></button
		>
		<!-- Content packs with an update waiting. "Check and notify" has to NOTIFY somewhere the user
		     actually is: the panel that knows about it lives three clicks deep in Settings, so without
		     this the mode only worked for someone who happened to open that tab. Rules data, unlike an
		     app build, is what a session runs on — hence its own chip rather than a shared one. -->
		{#if pendingPacks > 0}
			<a
				class="chip chip-packs"
				href="{base}/settings?tab=sources"
				title={$_('settings.packs.chipTitle', { values: { count: pendingPacks } })}
				aria-label={$_('settings.packs.chipTitle', { values: { count: pendingPacks } })}
				><Icon name="download" size={13} /> {$_('settings.packs.chip')}</a
			>
		{/if}
		{#if updater.status !== 'idle'}
			<button
				type="button"
				class="chip chip-update"
				class:is-busy={updateBusy}
				onclick={() => void installUpdate()}
				disabled={updateBusy}
				title={updateTitle}
				aria-label={updateTitle}><Icon name="download" size={13} /> {updateLabel}</button
			>
		{/if}
		<button
			type="button"
			class="chip search-chip"
			onclick={() => (ui.commandPaletteOpen = true)}
			title={$_('nav.openCommandPalette')}
			aria-label={$_('nav.openCommandPalette')}
		>
			<Icon name="search" size={13} />
			<span class="control-label">Ctrl K</span>
		</button>
	</div>
</header>

<!-- Translate + the compendium editor (3-column views) need the full viewport width; other routes stay
     centred to 1040px. A view flips `ui.fullBleed` while it needs the width. -->
<main
	id="main"
	tabindex="-1"
	class:full-bleed={page.url.pathname.startsWith(`${base}/translate`) || ui.fullBleed}
>
	{@render children()}
</main>

{#if firstRunDefault}
	<FirstRunModal defaultDir={firstRunDefault} pickFolder={pickDataDir} onConfirm={confirmDataDir} />
{/if}

<MobileWarning />

<CommandPalette />

{#if showDiagnostics}
	<DiagnosticsModal onDismiss={() => (showDiagnostics = false)} />
{/if}

<!-- The rules themselves are missing — asked BEFORE the content-review prompts, since those review
     content this install doesn't have. -->
{#if missingUnanswered().length > 0}
	<MissingContentModal />
{/if}

<!-- DATA-VER-1 startup review: drift first, then missing-metadata. Confirm writes the header back;
     Skip defers to the next launch; "Don't ask again" is content-editing mode — a persisted setting,
     reachable again in Settings ▸ Content health, not a one-way door. Shipped SRD carries full
     metadata, so a clean install shows neither. -->
{#if driftItems.length}
	<HashDriftModal
		items={driftItems}
		onUpdate={(files) => void adoptDrift(files)}
		onSkip={() => (review.driftDismissed = true)}
		onNeverAsk={() => (app.contentEditingMode = true)}
	/>
{:else if metaIssues.length}
	<ContentMetaModal
		issues={metaIssues}
		onFillAndSave={(fills) => void fillMeta(fills)}
		onSkip={() => (review.metaDismissed = true)}
		onNeverAsk={() => (app.contentEditingMode = true)}
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
		margin-inline-start: auto;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
		background: transparent;
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
	/* The one gold-lit chip: absent until a release is found, so its arrival draws the eye. Selector
	   also matches :hover to keep the gold instead of reverting to the base .chip:hover grey. */
	.chip-update,
	.chip-update:hover {
		color: var(--color-resource);
		border-color: var(--color-resource);
		background: var(--color-resource-soft);
		font-weight: 600;
	}
	.chip-update.is-busy {
		cursor: default;
		opacity: 0.85;
	}
	/* Content-pack updates: accent, not the app-update gold — new RULES and a new BUILD are different
	   errands, and two chips in the same colour would read as one thing shown twice. */
	.chip-packs,
	.chip-packs:hover {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
		text-decoration: none;
	}
	/* search chip = the Ctrl+K hint, now a clickable button (magnifier + label) that opens the palette */
	.search-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	/* :global — the svg now belongs to Icon.svelte, so a scoped selector can't reach it */
	.search-chip :global(svg) {
		opacity: 0.85;
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
	/* A narrow window — a phone, or a desktop window dragged small. The topbar is the one piece of
	   chrome that cannot shrink on its own: its five groups on a single row measure 763px against a
	   393px viewport, which scrolls the whole DOCUMENT sideways on every route. So it wraps —
	   identity and controls keep the first row, the nav takes a scrollable second one — and the two
	   labelled controls collapse to their icon. Both carry an aria-label, because the bug chip is the
	   ONLY way into the diagnostics bundle: it may shrink, never disappear. The threshold matches
	   MobileWarning's own, so the banner and the layout agree on where narrow starts. */
	@media (max-width: 800px) {
		.topbar {
			flex-wrap: wrap;
			gap: var(--space-2);
			padding-inline: var(--space-3);
		}
		.nav {
			/* last in visual order, so the wrap puts it on a row of its own below the controls */
			order: 1;
			flex: 1 0 100%;
			overflow-x: auto;
		}
		/* the primary control on a phone, and a finger is not a mouse pointer */
		.nav a {
			padding-block: var(--space-2);
		}
		.chips {
			flex-wrap: wrap;
			justify-content: flex-end;
		}
		.control-label {
			display: none;
		}
		/* with the label gone a 13px glyph is the whole button, which is under any usable tap target */
		.feedback,
		.search-chip {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 32px;
			min-height: 32px;
		}
		main,
		main.full-bleed {
			padding-inline: var(--space-3);
		}
	}
	:global(body) {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	/* UBUG-23. sonner forces every collapsed background toast to `height: var(--front-toast-height)`,
	   which is invisible for ITS toasts because it also fades their content out — but only for
	   `data-styled='true'`, and a custom-component toast is styled='false'. Ours size to their content
	   (the roll card is max-content), so a taller one behind the front one spilled out of the forced
	   height and clipped. Same mechanism, extended to the toasts the library left out: the geometry
	   stays, the content goes. `data-expanded='false'` keeps hover-expand — the one state where a
	   background toast is MEANT to be seen at its own size — and pointer-events follow the pixels, so
	   an invisible card is not a click target. */
	:global([data-sonner-toast][data-expanded='false'][data-front='false'][data-styled='false'])
		> :global(*) {
		opacity: 0;
	}
	:global([data-sonner-toast][data-expanded='false'][data-front='false'][data-styled='false']) {
		pointer-events: none;
	}
</style>

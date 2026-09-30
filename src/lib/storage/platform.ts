/*
 * Which runtime the app is executing in — a LEAF, so anything may ask without pulling the storage
 * it decides. `provider.ts` re-exports both names; `diag/logger.ts` needs them and is imported BY
 * the provider, which is the cycle this file exists to avoid.
 */

/**
 * The one runtime environment the app can be executing in. This single enum replaces the two
 * scattered booleans (`browser` + `isTauri()`) that together encoded the same one fact — "where am
 * I running" — so every platform decision reads from one typed source with one detection point.
 */
export enum Platform {
	/** Tauri desktop/mobile webview → real filesystem (TauriStorage) + seed content onto disk. */
	Desktop = 'desktop',
	/** Plain browser (the web build) → IndexedDB for user data + bundled content over fetch. */
	Web = 'web',
	/** No `window` at all (no browser) → build-time prerender + Node tests. Read-only, no user store. */
	Headless = 'headless',
}

/**
 * Detect the current runtime. No `window` means a headless (non-browser) context; otherwise the
 * Tauri runtime injects `__TAURI_INTERNALS__` into the webview's `window`, so its presence means
 * desktop and its absence means a plain browser.
 */
export function detectPlatform(): Platform {
	if (typeof window === 'undefined') return Platform.Headless;
	return '__TAURI_INTERNALS__' in window ? Platform.Desktop : Platform.Web;
}

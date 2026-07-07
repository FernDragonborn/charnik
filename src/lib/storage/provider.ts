/*
 * The runtime writable Storage for user data (characters, homebrew), behind the one `Storage`
 * seam. The compiled Tauri apps (desktop + mobile) get a real-fs impl; every other target (the
 * web build, SSR/prerender, tests) gets IndexedDB. Detection is a pure runtime check on the Tauri
 * global — `TauriStorage` is only constructed inside a Tauri webview, and its plugin functions are
 * lazy (invoked per-op, nothing at import time), so importing it is inert on the web. Nothing above
 * this news a storage.
 */
import { BrowserStorage } from './browser';
import { TauriStorage } from './tauri';
import type { Storage } from './types';

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
	Headless = 'headless'
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

let cache: Storage | null = null;

export function getUserStorage(): Storage {
	if (!cache)
		cache = detectPlatform() === Platform.Desktop ? new TauriStorage() : new BrowserStorage();
	return cache;
}

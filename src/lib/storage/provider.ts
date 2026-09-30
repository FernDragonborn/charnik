/*
 * The runtime writable Storage for user data (characters, homebrew), behind the one `Storage`
 * seam. The compiled Tauri apps (desktop + mobile) get a real-fs impl; every other target (the
 * web build, SSR/prerender, tests) gets IndexedDB. Detection is a pure runtime check on the Tauri
 * global — `TauriStorage` is only constructed inside a Tauri webview, and its plugin functions are
 * lazy (invoked per-op, nothing at import time), so importing it is inert on the web. Nothing above
 * this news a storage.
 *
 * Every instance handed out is WRAPPED so each mutation and each failure reaches the diagnostics log
 * (`withWriteLog`). One wrapper here rather than a call at each site: this is the only file IO seam
 * the app has, so it is also the only place a write can be counted from.
 */
import { BrowserStorage } from './browser';
import { TauriStorage } from './tauri';
import { withWriteLog } from './logged';
import { Platform, detectPlatform } from './platform';
import type { Storage } from './types';

// Re-exported: "where am I running" is asked from everywhere and the answer moved to a leaf so the
// logger could reach it without importing this file back. Moving the implementation is no reason to
// move the import every caller already writes.
export { Platform, detectPlatform };

let cache: Storage | null = null;

export function getUserStorage(): Storage {
	if (!cache)
		cache = withWriteLog(
			detectPlatform() === Platform.Desktop ? new TauriStorage() : new BrowserStorage(),
		);
	return cache;
}

/** Drop the cached storage instance so the next `getUserStorage()` re-resolves the data root — used
 *  when the user changes the data folder, so reads/writes retarget the new location. */
export function resetUserStorage(): void {
	cache = null;
}

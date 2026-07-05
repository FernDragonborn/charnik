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

let cache: Storage | null = null;

/** True when running inside a Tauri webview (the internals global is injected by the runtime). */
export function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getUserStorage(): Storage {
	if (!cache) cache = isTauri() ? new TauriStorage() : new BrowserStorage();
	return cache;
}

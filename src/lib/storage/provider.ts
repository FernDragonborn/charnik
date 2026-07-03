/*
 * The runtime writable Storage for user data (characters, homebrew). Behind the one `Storage`
 * seam: the web build gets IndexedDB (BrowserStorage); the compiled Tauri apps (desktop +
 * mobile) will get a real-fs impl here (task #6). Nothing above this news a storage.
 */
import { BrowserStorage } from './browser';
import type { Storage } from './types';

let cache: Storage | null = null;

export function getUserStorage(): Storage {
	// TODO(task #6): return a Tauri fs Storage when running under Tauri; web uses IndexedDB.
	if (!cache) cache = new BrowserStorage();
	return cache;
}

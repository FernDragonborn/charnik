/*
 * A one-shot message that must survive a full webview reload. Some actions (moving the data folder)
 * finish by hard-reloading the SPA so every view re-reads from the new location — a normal toast
 * would die with the old page. `flashAfterReload` stashes the message in sessionStorage; the root
 * layout calls `takeFlash` once on mount and shows it, then clears it so it fires exactly once.
 */
const KEY = 'charnik:flash';

/** Queue a message to toast right after the coming reload. */
export function flashAfterReload(message: string): void {
	try {
		sessionStorage.setItem(KEY, message);
	} catch {
		// no sessionStorage (SSR / private mode) — a lost success note is harmless.
	}
}

/** Read and clear the queued message (null if none). Call once on app mount. */
export function takeFlash(): string | null {
	try {
		const message = sessionStorage.getItem(KEY);
		if (message) sessionStorage.removeItem(KEY);
		return message;
	} catch {
		return null;
	}
}

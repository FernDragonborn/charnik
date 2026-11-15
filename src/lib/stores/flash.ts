/*
 * One-shot notes that must survive a full webview reload. Some actions (moving the data folder)
 * finish by hard-reloading the SPA so every view re-reads from the new location — a normal toast
 * would die with the old page. `flashAfterReload` stashes the message in sessionStorage; the root
 * layout calls `takeFlash` once on mount and shows it, then clears it so it fires exactly once.
 * `markReload` is the same for the reload itself: the page that loads next says it was reloaded.
 */
const FLASH_KEY = 'charnik:flash';
const RELOAD_KEY = 'charnik:reloaded';

function stash(key: string, value: string): void {
	try {
		sessionStorage.setItem(key, value);
	} catch {
		// no sessionStorage (SSR / private mode) — a lost success note is harmless.
	}
}

/** Read and clear what was stashed (null if nothing). */
function take(key: string): string | null {
	try {
		const value = sessionStorage.getItem(key);
		if (value) sessionStorage.removeItem(key);
		return value;
	} catch {
		return null;
	}
}

/** Queue a message to toast right after the coming reload. */
export const flashAfterReload = (message: string): void => stash(FLASH_KEY, message);

/** Read and clear the queued message (null if none). Call once on app mount. */
export const takeFlash = (): string | null => take(FLASH_KEY);

/** Leave word that the page is about to be reloaded by the app itself. */
export const markReload = (): void => stash(RELOAD_KEY, '1');

/** Was this page loaded by the app's own reload? Asked once on app mount, and true once. */
export const takeReloadMark = (): boolean => take(RELOAD_KEY) !== null;

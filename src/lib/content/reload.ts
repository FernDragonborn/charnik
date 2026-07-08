/*
 * Coordinated refresh so a view can show new on-disk data WITHOUT restarting the app process.
 *
 * Phase A (here): `reloadApp()` flushes any pending writes, then reloads the webview — NOT an app
 * restart (the Rust process stays alive; the SPA re-mounts and re-reads content + characters from
 * disk). Views register a flusher via `onBeforeReload` so a debounced autosave isn't lost if the
 * user refreshes mid-edit.
 *
 * Phase B (later) will add a no-flash live reload (reset caches + bump a content-version signal that
 * views watch) — see docs/PLAN.md. Until then a webview reload is the reliable, simple answer.
 */

// Pending-write flushers (e.g. a debounced character autosave) — awaited before any reload.
const flushers = new Set<() => Promise<void> | void>();

/** Register a flush callback; returns an unregister fn (hand it to `onMount` for auto-cleanup). */
export function onBeforeReload(fn: () => Promise<void> | void): () => void {
	flushers.add(fn);
	return () => void flushers.delete(fn);
}

async function flushAll(): Promise<void> {
	await Promise.all([...flushers].map((fn) => Promise.resolve(fn())));
}

/** Flush pending writes, then reload the webview so every view re-reads fresh data from disk. */
export async function reloadApp(): Promise<void> {
	await flushAll();
	if (typeof location !== 'undefined') location.reload();
}

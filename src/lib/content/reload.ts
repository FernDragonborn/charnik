/*
 * Coordinated refresh so a view can show new on-disk data WITHOUT restarting the app process.
 *
 * Phase A (here): `reloadApp()` flushes any pending writes, then reloads the webview — NOT an app
 * restart (the Rust process stays alive; the SPA re-mounts and re-reads content + characters from
 * disk). Views register a flusher via `onBeforeReload` so a debounced autosave isn't lost if the
 * user refreshes mid-edit.
 *
 * Phase B (later) will add a no-flash live reload (reset caches + bump a content-version signal that
 * views watch) — see docs/plan.md. Until then a webview reload is the reliable, simple answer.
 */
import { logger } from '$lib/diag/logger';
import { errText } from '$lib/util/format';
import { toast } from '$lib/toast/toast';
import { t } from '$lib/i18n';

// Pending-write flushers (e.g. a debounced character autosave) — awaited before any reload.
const flushers = new Set<() => Promise<void> | void>();

/** Register a flush callback; returns an unregister fn (hand it to `onMount` for auto-cleanup). */
export function onBeforeReload(fn: () => Promise<void> | void): () => void {
	flushers.add(fn);
	return () => void flushers.delete(fn);
}

/** Run every flusher; true when all of them landed. */
async function flushAll(): Promise<boolean> {
	// allSettled, not all: one rejecting flusher must not stop the others from writing
	const settled = await Promise.allSettled([...flushers].map((fn) => Promise.resolve(fn())));
	let flushed = true;
	for (const r of settled)
		if (r.status === 'rejected') {
			flushed = false;
			logger.error('flush before reload failed', { error: errText(r.reason) });
		}
	return flushed;
}

/** Flush pending writes, then reload the webview so every view re-reads fresh data from disk. A
 *  flush that failed holds the reload back and says so: the reload would discard the very edit. */
export async function reloadApp(): Promise<void> {
	if (!(await flushAll())) {
		toast(t('character.notSaved'), { description: t('character.reloadHeld') });
		return;
	}
	if (typeof location !== 'undefined') location.reload();
}

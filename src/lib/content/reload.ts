/*
 * Coordinated refresh so a view can show new on-disk data WITHOUT restarting the app process.
 *
 * `reloadApp()` flushes any pending writes, then reloads the webview — NOT an app restart (the Rust
 * process stays alive; the SPA re-mounts and re-reads content + characters from disk). Views
 * register a flusher via `onBeforeReload` so a debounced autosave isn't lost if the user reloads
 * mid-edit. The lighter refresh, which re-reads the disk and reloads nothing, is `reloadContent()`;
 * `reloadIntentOf` says which of the two a key asks for.
 */
import { logger } from '$lib/diag/logger';
import { errText } from '$lib/util/format';
import { toast } from '$lib/toast/toast';
import { t } from '$lib/i18n';

export const RELOAD_INTENT = {
	/** Not a reload key here: the browser keeps it. */
	none: 'none',
	/** Re-read the disk into the live stores; the page and everything it holds stay. */
	refresh: 'refresh',
	/** Flush pending writes and load the page again. */
	reload: 'reload',
} as const;
export type ReloadIntent = (typeof RELOAD_INTENT)[keyof typeof RELOAD_INTENT];

/**
 * What a key press asks for, read the way every browser reads it: F5 and Ctrl+R are one key, and
 * Shift (or Ctrl on F5) makes it the hard one. On the web the keys are the browser's: only F5 is
 * taken, so the page it reloads has its pending writes on disk first.
 */
export function reloadIntentOf(
	key: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
	isDesktop: boolean,
): ReloadIntent {
	const isF5 = key.code === 'F5';
	const withCommand = key.ctrlKey || key.metaKey;
	if (!isDesktop) return isF5 ? RELOAD_INTENT.reload : RELOAD_INTENT.none;
	if (!isF5 && !(withCommand && key.code === 'KeyR')) return RELOAD_INTENT.none;
	return key.shiftKey || (isF5 && withCommand) ? RELOAD_INTENT.reload : RELOAD_INTENT.refresh;
}

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

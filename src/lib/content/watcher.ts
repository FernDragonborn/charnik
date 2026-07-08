/*
 * Phase C of live reload: watch the content folder on disk and live-refresh the app when a CSV is
 * edited EXTERNALLY (in Excel, an editor, git…). Desktop-only (the web build has no such folder).
 *
 * Safe by construction:
 *  - Debounced (300 ms) so a burst of events (editors write temp→rename; a save emits several) and a
 *    still-in-progress write settle into ONE reload — also tolerating a torn read mid-write.
 *  - `reloadContent()` only READS (never writes), so the app's own homebrew save can't create a
 *    write→reload→write loop — at worst one redundant re-read (already coalesced by the debounce).
 */
import { detectPlatform, Platform, getUserStorage } from '$lib/storage/provider';
import { reloadContent } from './store.svelte';

let stop: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Start watching `<dataDir>/content` (desktop only; no-op off desktop or if already watching). */
export function startContentWatcher(): void {
	if (stop || detectPlatform() !== Platform.Desktop) return;
	stop = getUserStorage().watch('content', () => {
		clearTimeout(timer);
		timer = setTimeout(() => void reloadContent(), 300);
	});
}

/** Stop watching (call on teardown / before re-pointing at a new data folder). */
export function stopContentWatcher(): void {
	stop?.();
	stop = null;
	clearTimeout(timer);
}

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
import { isPackWriteInFlight } from './remote/install';
import { autoAdoptDrift } from './review.svelte';
import { reloadContent } from './store.svelte';

let stop: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleReload(): void {
	clearTimeout(timer);
	timer = setTimeout(() => {
		// These events are an apply's / rename's / rollback's OWN writes, and the tree they are
		// swapping is not one to build a graph from — a pack folder is briefly absent, so the reload
		// would drop that pack's rows and flag every reference to them, for the ~300 ms until the next
		// one. Wait it out; each of those paths ends with a reload of its own anyway.
		if (isPackWriteInFlight()) return scheduleReload();
		// in content-editing mode the edit we just saw is adopted rather than queued for a dialog
		void reloadContent().then(autoAdoptDrift);
	}, 300);
}

/** Start watching `<dataDir>/content` (desktop only; no-op off desktop or if already watching). */
export function startContentWatcher(): void {
	if (stop || detectPlatform() !== Platform.Desktop) return;
	stop = getUserStorage().watch('content', scheduleReload);
}

/** Stop watching (call on teardown / before re-pointing at a new data folder). */
export function stopContentWatcher(): void {
	stop?.();
	stop = null;
	clearTimeout(timer);
}

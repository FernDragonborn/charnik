/*
 * Reactive content-graph store. Everything that derives from content (compendium lists, the
 * search indexes) reads `content.graph` and keys its recompute on `content.guid`. The guid is
 * a fresh GUID per graph state — NOT a local counter — because content is shared/imported
 * between standalone instances, where a per-instance counter would collide (see
 * charnik-guid-not-counter). Future triggers (file-watcher, homebrew write, manual refresh)
 * call `reloadContent()`; that's the whole rebuild mechanism.
 */
import { getContentGraph, resetContentGraph } from './provider';
import { resetUserStorage } from '$lib/storage/provider';
import { initSourceConfig } from './sources.svelte';
import type { ContentGraph } from './loader';

export const content = $state<{ graph: ContentGraph | null; guid: string; error: string | null }>({
	graph: null,
	guid: '',
	// A load failure is recorded here (not thrown) so the loading screen can SHOW it instead of hanging
	// forever on "Loading content…" — the only way to diagnose a broken content bundle on an installed app.
	error: null
});

/** Load the graph into the store: on success rotate the guid + clear the error; on failure record it
 *  and drop the rejected cache so a retry can re-run. Shared by the initial load + reload. */
async function loadGraphIntoStore(): Promise<void> {
	try {
		content.graph = await getContentGraph();
		content.guid = crypto.randomUUID();
		content.error = null;
	} catch (e) {
		content.error = e instanceof Error ? (e.stack ?? e.message) : String(e);
		resetContentGraph();
	}
}

/** Load the graph once into the store (no-op if already loaded). Loads the browse-config from its
 *  file FIRST (ARCH-2), so source/collision filtering is ready before anything derives. */
export async function loadContentStore(): Promise<ContentGraph | null> {
	if (!content.graph) {
		await initSourceConfig();
		await loadGraphIntoStore();
	}
	return content.graph;
}

/** Drop the cache, reload, and rotate the guid → all derived state recomputes with no page reload.
 *  `remount` also drops the storage instance so a changed data folder is re-resolved. */
export async function reloadContent(
	opts: { remount?: boolean } = {}
): Promise<ContentGraph | null> {
	if (opts.remount) {
		resetUserStorage();
		await initSourceConfig(); // the browse-config lives in the (now new) data folder
	}
	resetContentGraph();
	await loadGraphIntoStore();
	return content.graph;
}

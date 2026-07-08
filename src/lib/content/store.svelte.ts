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
import type { ContentGraph } from './loader';

export const content = $state<{ graph: ContentGraph | null; guid: string }>({
	graph: null,
	guid: ''
});

/** Load the graph once into the store (no-op if already loaded). */
export async function loadContentStore(): Promise<ContentGraph> {
	if (!content.graph) {
		content.graph = await getContentGraph();
		content.guid = crypto.randomUUID();
	}
	return content.graph;
}

/** Drop the cache, reload, and rotate the guid → all derived state recomputes with no page reload.
 *  `remount` also drops the storage instance so a changed data folder is re-resolved. */
export async function reloadContent(opts: { remount?: boolean } = {}): Promise<ContentGraph> {
	if (opts.remount) resetUserStorage();
	resetContentGraph();
	content.graph = await getContentGraph();
	content.guid = crypto.randomUUID();
	return content.graph;
}

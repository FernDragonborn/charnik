/*
 * The app-wide content graph, loaded once and cached. Shipped SRD CSVs load as static assets
 * (FetchStorage over the `base` path — served bundled on desktop over the Tauri asset protocol);
 * user HOMEBREW is merged in from the writable user Storage (IndexedDB / Tauri fs) as an extra
 * content root, so authored rows appear in the compendium alongside SRD. Everything above this
 * uses `getContentGraph()` and never touches Storage directly.
 */
import { base } from '$app/paths';
import { browser } from '$app/environment';
import { FetchStorage } from '$lib/storage/fetch';
import { getUserStorage } from '$lib/storage/provider';
import { loadContent, type ContentGraph, type ContentSource } from './loader';
import { HOMEBREW_ROOT } from './homebrew';

/** The content roots that ship with the app (both editions). */
export const CONTENT_ROOTS = ['content/srd-2024', 'content/srd-2014'];

let cache: Promise<ContentGraph> | null = null;

/** Load (once) and return the merged content graph (SRD assets ∪ user homebrew). */
export function getContentGraph(): Promise<ContentGraph> {
	if (!cache) {
		// homebrew lives in the writable user store, only reachable in the browser/webview
		const extra: ContentSource[] = browser
			? [{ storage: getUserStorage(), root: HOMEBREW_ROOT }]
			: [];
		cache = loadContent(new FetchStorage(base), CONTENT_ROOTS, extra);
	}
	return cache;
}

/** Drop the cache (e.g. after the user adds/edits homebrew and wants a reload). */
export function resetContentGraph(): void {
	cache = null;
}

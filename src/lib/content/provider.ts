/*
 * The app-wide content graph, loaded once and cached.
 *
 * WEB: the shipped SRD CSVs load as static assets over `fetch` (FetchStorage), and homebrew comes
 * from IndexedDB.
 *
 * DESKTOP (Tauri): on first run we SEED the bundled SRD CSVs onto disk (into `<dataDir>/content/…`)
 * so the user can see and edit them as plain files; from then on the graph is loaded from that
 * writable folder (the same TauriStorage that holds characters + homebrew). This is what makes
 * "own your data as CSV" real on desktop — the content lives in a folder you can open, not just
 * inside the app bundle.
 *
 * Everything above this uses `getContentGraph()` and never touches Storage directly.
 */
import { base } from '$app/paths';
import { browser } from '$app/environment';
import { FetchStorage } from '$lib/storage/fetch';
import { getUserStorage, isTauri } from '$lib/storage/provider';
import type { Storage } from '$lib/storage/types';
import { loadContent, type ContentGraph, type ContentSource } from './loader';
import { HOMEBREW_ROOT } from './homebrew';

/** The content roots that ship with the app (both editions). */
export const CONTENT_ROOTS = ['content/srd-2024', 'content/srd-2014'];

let cache: Promise<ContentGraph> | null = null;

/** Load (once) and return the merged content graph (SRD ∪ user homebrew). */
export function getContentGraph(): Promise<ContentGraph> {
	return (cache ??= buildGraph());
}

async function buildGraph(): Promise<ContentGraph> {
	// homebrew lives in the writable user store, only reachable in the browser/webview
	const homebrew: ContentSource[] = browser
		? [{ storage: getUserStorage(), root: HOMEBREW_ROOT }]
		: [];

	if (browser && isTauri()) {
		// desktop: seed the shipped content onto disk (first run), then read it from there
		const user = getUserStorage();
		await seedShippedContent(user);
		return loadContent(user, CONTENT_ROOTS, homebrew);
	}
	// web (and SSR/prerender): read the bundled CSVs over fetch
	return loadContent(new FetchStorage(base), CONTENT_ROOTS, homebrew);
}

/**
 * Copy the bundled SRD CSVs into the writable data dir once, so a fresh desktop install has real,
 * editable content files on disk. A root that already exists on disk is left untouched (so the
 * user's edits — or their own added CSVs — are never overwritten).
 */
async function seedShippedContent(user: Storage): Promise<void> {
	await copyMissingRoots(new FetchStorage(base), user, CONTENT_ROOTS);
}

/** Copy each root's files from `from` to `to`, byte-for-byte, but skip a root that already exists in
 *  `to` (so we never clobber the user's copy). Pure over the Storage seam — unit-testable. */
export async function copyMissingRoots(from: Storage, to: Storage, roots: string[]): Promise<void> {
	for (const root of roots) {
		if (await to.exists(root)) continue; // already seeded / user-managed → don't clobber
		for (const f of await from.list(root)) {
			// writeBytes creates the parent dirs and preserves the exact bytes (BOM/CRLF intact)
			await to.writeBytes(f.path, await from.readBytes(f.path));
		}
	}
}

/** Drop the cache (e.g. after the user adds/edits homebrew and wants a reload). */
export function resetContentGraph(): void {
	cache = null;
}

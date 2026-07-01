/*
 * The app-wide content graph, loaded once and cached. On the web it reads the shipped CSVs
 * as static assets (FetchStorage over the `base` path); the desktop build will swap in the
 * Tauri fs Storage behind the same call. Everything above this uses `getContentGraph()`
 * and never touches Storage directly.
 */
import { base } from '$app/paths';
import { FetchStorage } from '$lib/storage/fetch';
import { loadContent, type ContentGraph } from './loader';

/** The content roots that ship with the app (both editions). */
export const CONTENT_ROOTS = ['content/srd-2024', 'content/srd-2014'];

let cache: Promise<ContentGraph> | null = null;

/** Load (once) and return the merged content graph. */
export function getContentGraph(): Promise<ContentGraph> {
	if (!cache) cache = loadContent(new FetchStorage(base), CONTENT_ROOTS);
	return cache;
}

/** Drop the cache (e.g. after the user adds/edits homebrew and wants a reload). */
export function resetContentGraph(): void {
	cache = null;
}

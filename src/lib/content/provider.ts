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
 * inside the app bundle. A `CONTENT_SEED_VERSION` marker makes an app UPDATE re-seed the shipped
 * files when their data changed (else a returning user would be stuck on the old SRD): untouched
 * files are overwritten, hand-edited ones (hash drift) are preserved; homebrew/characters untouched.
 * WEB needs none of this — it always fetches the freshly-deployed static content.
 *
 * Everything above this uses `getContentGraph()` and never touches Storage directly.
 */
import { base } from '$app/paths';
import { FetchStorage } from '$lib/storage/fetch';
import { getUserStorage, detectPlatform, Platform } from '$lib/storage/provider';
import type { Storage } from '$lib/storage/types';
import { loadContent, type ContentGraph, type ContentSource } from './loader';
import { HOMEBREW_ROOT } from './homebrew';
import { parseContentDirectives, isHashDrift } from './meta';
import { hashBody } from './hash';
import { CONTENT_SEED_VERSION } from '$lib/schema/version';

/** Records which CONTENT_SEED_VERSION was last written to the data dir. Lives beside the seeded roots
 *  but OUTSIDE them (the loader only scans the `srd-*` roots), so it's never parsed as content. */
const SEED_VERSION_FILE = 'content/.seed-version';

/** The content roots that ship with the app (both editions). */
export const CONTENT_ROOTS = ['content/srd-2024', 'content/srd-2014'];

let cache: Promise<ContentGraph> | null = null;

/** Load (once) and return the merged content graph (SRD ∪ user homebrew). */
export function getContentGraph(): Promise<ContentGraph> {
	return (cache ??= buildGraph());
}

async function buildGraph(): Promise<ContentGraph> {
	const platform = detectPlatform();

	// homebrew lives in the writable user store (desktop FS / web IndexedDB); absent when headless
	const homebrew: ContentSource[] =
		platform === Platform.Headless ? [] : [{ storage: getUserStorage(), root: HOMEBREW_ROOT }];

	if (platform === Platform.Desktop) {
		// desktop: seed/UPDATE the shipped content on disk (first run + version bumps), then read it
		const user = getUserStorage();
		await seedShippedContent(new FetchStorage(base), user, CONTENT_ROOTS, CONTENT_SEED_VERSION);
		return loadContent(user, CONTENT_ROOTS, homebrew);
	}
	// web + headless (build-time prerender / tests): read the bundled CSVs over fetch
	return loadContent(new FetchStorage(base), CONTENT_ROOTS, homebrew);
}

/** The CONTENT_SEED_VERSION last written to disk, or null if never seeded / unreadable. */
async function readSeedVersion(store: Storage): Promise<number | null> {
	try {
		if (!(await store.exists(SEED_VERSION_FILE))) return null;
		const n = Number((await store.read(SEED_VERSION_FILE)).trim());
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

/** Is an on-disk shipped file USER-modified? True iff its body no longer matches its own recorded
 *  `#content-hash` (the app never re-stamps shipped SRD files, so a mismatch means a hand-edit). Such
 *  a file is PRESERVED on re-seed; an untouched one is overwritten with the newly-shipped copy. */
async function isUserModified(store: Storage, path: string): Promise<boolean> {
	try {
		const { directives, body } = parseContentDirectives(await store.read(path));
		return isHashDrift(directives.get('hash'), await hashBody(body));
	} catch {
		return false; // unreadable / no header → treat as unmodified (safe to overwrite)
	}
}

/**
 * Seed / UPDATE the shipped SRD roots on disk (desktop). On a fresh install (no version marker) OR
 * when the app ships a newer `shippedVersion` than what's on disk, every shipped file is (re)written
 * — EXCEPT one the user has hand-edited (hash drift → preserved). Homebrew + characters are never
 * touched (different roots). When already at `shippedVersion`, only genuinely-missing roots are
 * filled (belt-and-suspenders). Idempotent. Returns the paths it preserved (surfaced to the user).
 * Pure over the Storage seam — unit-testable with two MemoryStorages.
 */
export async function seedShippedContent(
	from: Storage,
	to: Storage,
	roots: string[],
	shippedVersion: number
): Promise<{ preserved: string[] }> {
	if ((await readSeedVersion(to)) === shippedVersion) {
		await copyMissingRoots(from, to, roots);
		return { preserved: [] };
	}
	const preserved: string[] = [];
	for (const root of roots) {
		for (const f of await from.list(root)) {
			if ((await to.exists(f.path)) && (await isUserModified(to, f.path))) {
				preserved.push(f.path); // user hand-edited this shipped file → keep their version
				continue;
			}
			// writeBytes creates parent dirs + preserves exact bytes (BOM/CRLF intact)
			await to.writeBytes(f.path, await from.readBytes(f.path));
		}
	}
	await to.write(SEED_VERSION_FILE, String(shippedVersion));
	return { preserved };
}

/** Copy each root's files from `from` to `to`, byte-for-byte, but skip a root that already exists in
 *  `to` (so we never clobber the user's copy). The first-run/missing-root path. Unit-testable. */
export async function copyMissingRoots(from: Storage, to: Storage, roots: string[]): Promise<void> {
	for (const root of roots) {
		if (await to.exists(root)) continue; // already seeded / user-managed → don't clobber
		for (const f of await from.list(root)) {
			await to.writeBytes(f.path, await from.readBytes(f.path));
		}
	}
}

/** Drop the cache (e.g. after the user adds/edits homebrew and wants a reload). */
export function resetContentGraph(): void {
	cache = null;
}

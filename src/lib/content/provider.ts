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
 * A pack the user UNINSTALLED is never re-seeded — the bundled SRD is a pack like any other, so
 * deleting it sticks, and re-installing it is the same paste-a-URL flow as any pack.
 * WEB needs none of this — it always fetches the freshly-deployed static content.
 *
 * The set of roots is NOT a constant: each folder under `content/` is one content PACK (the shipped
 * SRD is simply the pack we bundle), discovered by scanning — see `discoverContentRoots`.
 *
 * Everything above this uses `getContentGraph()` and never touches Storage directly.
 */
import { base } from '$app/paths';
import { FetchStorage } from '$lib/storage/fetch';
import { getUserStorage, detectPlatform, Platform } from '$lib/storage/provider';
import type { Storage } from '$lib/storage/types';
import { listFilesRecursive } from '$lib/storage/walk';
import { loadContent, type ContentGraph, type ContentSource } from './loader';
import { HOMEBREW_ROOT } from './homebrew';
import { HASH_STATE } from './meta';
import { fileHashState } from './hash';
import { CONTENT_SEED_VERSION } from '$lib/schema/version';
import { recoverInterruptedApply } from './remote/install';
import {
	bundledPacks,
	forgetPack,
	isReservedPackName,
	missingBundled,
	packConfig,
	registerPack,
	SHIPPED_PACK_REPO,
	unDismissMissing
} from './packs.svelte';

/** Records which CONTENT_SEED_VERSION was last written to the data dir. Lives beside the seeded roots
 *  but OUTSIDE them (the loader only scans the `srd-*` roots), so it's never parsed as content. */
const SEED_VERSION_FILE = 'content/.seed-version';

/** Where content packs live. Each direct SUBFOLDER is one pack. */
const CONTENT_DIR = 'content';

/**
 * Every installed content pack, discovered by SCANNING `content/` — a pack is a folder, so the
 * folder listing is the file list and there is no index to keep in sync (AI-CONVENTIONS §1.6).
 * The shipped SRD is just the pack the app happens to bundle. Excludes the writable homebrew root
 * (loaded separately as the user's own source).
 *
 * Sorted only so the scan is deterministic — nothing downstream is allowed to MEAN anything by the
 * order. The fold is order-independent by construction (`rules/pipeline.ts`), a character filters to
 * its own edition, and the one place that did inherit this order (the compendium list) now sorts by
 * name itself. An exact `type:source:id` clash is first-wins, but that can only happen inside a single
 * source, so pack order can't decide it.
 */
export async function discoverContentRoots(storage: Storage): Promise<string[]> {
	let entries;
	try {
		entries = await storage.list(CONTENT_DIR);
	} catch (e) {
		// A missing `content/` (fresh install, before the seed) is legitimately "nothing installed".
		// PRESENT BUT UNREADABLE IS NOT: `[]` there reads as "the user deleted every pack", and
		// `forgetUninstalledPacks` would act on it and wipe the registry — pins and repo URLs with it.
		// One transient listing failure must not be able to do that, so it fails loudly instead
		// (the content store turns a throw into the diagnosable error screen).
		if (await storage.exists(CONTENT_DIR).catch(() => false)) throw e;
		return [];
	}
	return entries
		.filter((e) => e.isDir && !isReservedPackName(e.name))
		.map((e) => e.path)
		.sort();
}

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

	const bundled = new FetchStorage(base);
	if (platform === Platform.Desktop) {
		// desktop: seed/UPDATE the BUNDLED packs on disk (first run + version bumps), then read every
		// pack that is actually installed there — which is the bundled set plus anything the user added.
		const user = getUserStorage();
		// an apply that was killed mid-swap left staging folders behind; settle them before anything
		// looks at `content/`, or a half-swapped pack is what gets loaded
		await recoverInterruptedApplies(user);
		const shipped = await discoverContentRoots(bundled);
		await seedShippedContent(bundled, user, shipped, CONTENT_SEED_VERSION);
		const installed = await discoverContentRoots(user);
		forgetUninstalledPacks(installed);
		adoptShippedPacks(shipped.filter((root) => installed.includes(root)));
		// deleting a bundled pack is allowed and sticks — but it is the rules the app runs on, so the
		// absence is REPORTED (layout prompt + a restore button in Settings), never silently endured
		bundledPacks.packs = shipped.map(packNameOf);
		missingBundled.packs = shipped.filter((root) => !installed.includes(root)).map(packNameOf);
		return loadContent(user, installed, homebrew);
	}
	// web + headless (build-time prerender / tests): read the bundled CSVs over fetch
	return loadContent(bundled, await discoverContentRoots(bundled), homebrew);
}

/**
 * The shipped SRD is A PACK, not a special case (REL-4 slice 4) — it just happens to be the one we
 * bundle, so it has a floor no download can take away. Registering it against the repo it is
 * released from (`SHIPPED_PACK_REPO`) is what lets it be updated on the SAME path as any
 * third-party pack: rules data ships without an app build, which is the entire point of REL-4.
 *
 * Give every bundled pack a registry entry, unless the user already has one (theirs wins — they may
 * have re-pointed it at a fork). Never overwrites a pin. Called with the packs that are actually ON
 * DISK: one the user uninstalled must not reappear in the list as an install offer.
 */
function adoptShippedPacks(shipped: string[]): void {
	for (const root of shipped)
		if (packConfig.packs[packNameOf(root)] === undefined)
			registerPack(packNameOf(root), SHIPPED_PACK_REPO);
}

/**
 * Settle any pack left mid-apply (crash, kill, power loss). The staging folders are their own
 * evidence — `<pack>.new` / `<pack>.prev` next to `content/` — so this needs no journal to read:
 * find the base names, and let `recoverInterruptedApply` decide per pack which state it is in.
 * `.prev` beside a live folder is not an interruption; it is the kept undo copy, and stays.
 */
async function recoverInterruptedApplies(storage: Storage): Promise<void> {
	const entries = await storage.list(CONTENT_DIR).catch(() => []);
	const interrupted = new Set(
		entries
			.filter((e) => e.isDir && /\.(new|prev)$/i.test(e.name))
			.map((e) => e.name.replace(/\.(new|prev)$/i, ''))
	);
	for (const pack of interrupted) await recoverInterruptedApply(storage, pack);
}

/** `content/srd-2024` → `srd-2024`: the folder IS the pack, so its name is its last segment. */
const packNameOf = (root: string): string => root.slice(root.lastIndexOf('/') + 1);

/**
 * The registry describes what is INSTALLED, and a folder can leave without asking it: deleting the
 * pack in a file manager is a supported way to do anything here. An entry with no folder behind it
 * would list a pack that isn't there, offer to check it for updates, and — for a bundled one — show
 * it twice, once as installed and once as deleted-but-restorable.
 *
 * Forgetting is safe because it is self-healing: a bundled pack re-registers itself the moment its
 * files are back (`adoptShippedPacks`, right below), and a third-party one is re-registered by the
 * install that brings it back.
 */
export function forgetUninstalledPacks(installed: string[]): void {
	const onDisk = new Set(installed.map(packNameOf));
	for (const pack of Object.keys(packConfig.packs)) if (!onDisk.has(pack)) forgetPack(pack);
}

/**
 * Put a bundled pack back, from the copy inside the app — the undo for a deletion, offered both at
 * launch (when the rules are simply gone) and in Settings. It re-copies rather than downloading, so
 * it works with no network: the bundle is the floor a fresh install starts from, and this is the
 * same copy step, asked for explicitly instead of happening behind the user's back.
 */
export async function restoreBundledPacks(packs: string[]): Promise<void> {
	const bundled = new FetchStorage(base);
	const user = getUserStorage();
	for (const pack of packs) {
		const root = `${CONTENT_DIR}/${pack}`;
		for (const path of await listFilesRecursive(bundled, root))
			await user.writeBytes(path, await bundled.readBytes(path));
	}
	unDismissMissing(packs);
	resetContentGraph();
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

/**
 * May the app overwrite this on-disk file, or is it the user's now? The ONE rule behind both the
 * shipped re-seed and a pack update — reuse it rather than invent a second merge strategy.
 *
 * A file is protected when its body no longer matches its own `#content-hash` (the app never
 * re-stamps shipped files, so a mismatch means a hand-edit) **and equally when it carries no hash at
 * all**: "I cannot verify this" and "I verified it changed" are the same instruction to a writer.
 * The old boolean said `false` for unstamped, which quietly meant "overwrite anything you can't
 * check" — the exact case a user's own file added to a pack folder falls into.
 *
 * ONE exception, by path: a pack's `plugins/` subtree is always overwritable. Code has a stronger
 * guarantee than this one — new bytes void the consent hash, so nothing runs unapproved (PLUGINS
 * §6.3) — and the alternative is worse than the risk: an unstamped `main.js` can never carry a hash
 * (a `plugin.json` cannot either; its schema rejects unknown keys), so protecting it would freeze
 * every pack-shipped plugin at the version it was installed at, forever. Editing a plugin in place
 * is not the supported path anyway: `<dataDir>/plugins/<ns>/` exists for that and WINS the namespace.
 */
export async function isProtectedFromOverwrite(store: Storage, path: string): Promise<boolean> {
	if (path.includes('/plugins/')) return false;
	try {
		return (await fileHashState(await store.read(path))) !== HASH_STATE.match;
	} catch {
		return false; // unreadable — there is nothing here to preserve
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
	const onDisk = await readSeedVersion(to);
	if (onDisk === shippedVersion) return { preserved: [] };
	const firstRun = onDisk === null;

	const preserved: string[] = [];
	for (const root of roots) {
		// A pack the user UNINSTALLED stays uninstalled. A fresh data dir gets every bundled pack;
		// after that the bundle only ever REFRESHES packs that are still there, so a bundled pack is
		// exactly as deletable as any other and an app update can't quietly put it back.
		if (!firstRun && !(await to.exists(root))) continue;
		// RECURSIVE, because a pack may carry plugins in `plugins/<ns>/` (PLUGINS §2) and a one-level
		// listing dropped their code silently — while the pack DIFFER walked the same folder in full,
		// so the two halves of "what is in this pack" disagreed about a bundled one.
		for (const path of await listFilesRecursive(from, root)) {
			if ((await to.exists(path)) && (await isProtectedFromOverwrite(to, path))) {
				preserved.push(path); // user hand-edited this shipped file → keep their version
				continue;
			}
			// writeBytes creates parent dirs + preserves exact bytes (BOM/CRLF intact)
			await to.writeBytes(path, await from.readBytes(path));
		}
	}
	await to.write(SEED_VERSION_FILE, String(shippedVersion));
	return { preserved };
}

/** Drop the cache (e.g. after the user adds/edits homebrew and wants a reload). */
export function resetContentGraph(): void {
	cache = null;
}

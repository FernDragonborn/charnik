/*
 * What is on disk under `content/`, and what the app is allowed to write there.
 *
 * A LEAF module on purpose: it knows about Storage, hashes and reserved names, and about nothing
 * above itself. These two questions are asked from opposite ends of the app — the desktop seed and
 * the graph loader (`provider.ts`) on one side, the pack diff/installer (`remote/*`) on the other —
 * and while they lived in `provider.ts` the second group had to import the orchestrator that
 * imports it, so `provider → remote/install → remote/diff → provider` was a cycle and the remote
 * module could not be lifted out or tested on its own.
 */
import type { Storage } from '$lib/storage/types';
import { HASH_STATE } from './meta';
import { fileHashState } from './hash';
import { isReservedPackName } from './packs.svelte';

/** Where content packs live. Each direct SUBFOLDER is one pack. */
export const CONTENT_DIR = 'content';

/** `content/srd-2024` → `srd-2024`: the folder IS the pack, so its name is its last segment. */
export const packNameOf = (root: string): string => root.slice(root.lastIndexOf('/') + 1);

/**
 * Every installed content pack, discovered by SCANNING `content/` — a pack is a folder, so the
 * folder listing is the file list and there is no index to keep in sync (docs/internals/content.md ▸ No manifests).
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
	try {
		return isProtectedText(path, await store.read(path));
	} catch {
		return false; // unreadable — there is nothing here to preserve
	}
}

/** The same question asked of bytes already in hand — for a caller that has just read the file for
 *  another reason (the diff hashes it) and must not read it a second time to ask this. */
export async function isProtectedText(path: string, text: string): Promise<boolean> {
	if (path.includes('/plugins/')) return false;
	return (await fileHashState(text)) !== HASH_STATE.match;
}

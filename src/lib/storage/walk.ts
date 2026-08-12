/*
 * Walking a whole subtree over the one file-IO seam.
 *
 * `Storage.list` is deliberately non-recursive — every impl can answer "immediate children" cheaply
 * and honestly, including the read-only web one, which synthesises directories out of its manifest's
 * keys. Recursion on top of it is a caller's concern, so it lives here rather than growing a second
 * method every impl would have to reimplement.
 *
 * It is here rather than beside its first caller because it had THREE callers and one of them knew
 * it: the pack differ walked a pack recursively while the shipped-content seed listed one level, so
 * a bundled pack's `plugins/<ns>/` subtree was invisible to the half that writes it and visible to
 * the half that compares it.
 */
import type { Storage } from './types';

/**
 * Every file under `dir`, at any depth, as dataDir-relative paths.
 *
 * **Absent is empty; present-but-unreadable throws** — the same rule `discoverContentRoots` needed,
 * for the same reason. Callers ask this to decide what to COPY: a pack being installed for the
 * first time has no folder yet and legitimately walks to nothing, but a folder that IS there and
 * cannot be listed answering `[]` means `buildAndSwap` carries nothing across and the replacement
 * tree silently loses every file the update never mentioned — a README, notes, the hand-edited
 * files the diff promised to preserve. Loud is recoverable; empty is not.
 */
export async function listFilesRecursive(storage: Storage, dir: string): Promise<string[]> {
	let entries;
	try {
		entries = await storage.list(dir);
	} catch (e) {
		if (await storage.exists(dir).catch(() => false)) throw e;
		return [];
	}
	const out: string[] = [];
	for (const entry of entries)
		if (entry.isDir) out.push(...(await listFilesRecursive(storage, entry.path)));
		else out.push(entry.path);
	return out;
}

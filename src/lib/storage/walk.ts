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

/** Every file under `dir`, at any depth, as dataDir-relative paths. Directories that cannot be read
 *  contribute nothing — a walk is used to decide what to copy or compare, and neither of those is
 *  improved by throwing half-way through. */
export async function listFilesRecursive(storage: Storage, dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await storage.list(dir).catch(() => []))
		if (entry.isDir) out.push(...(await listFilesRecursive(storage, entry.path)));
		else out.push(entry.path);
	return out;
}

/*
 * The REAL shipped CSVs, for the tests that must assert against actual content (a wiped effect
 * token or a dropped column has to fail somewhere). The files live in the SEPARATE content repo,
 * so go through the one resolver — a missing clone then says what to clone instead of ENOENT.
 *
 * `tools/content-repo.mjs` is node-only; nothing but tests may import this module.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentRepoDir, packDir, requireContentRepo } from '../../tools/content-repo.mjs';
import { NodeStorage } from '$lib/storage/node';
import { loadContent, type ContentGraph } from '$lib/content/loader';

/** Is the content repo cloned? For the few tests that are optional without it. */
export const hasContentRepo = existsSync(contentRepoDir());

/** Absolute path of one shipped file — for the gates that tolerate a type missing in an edition. */
export function packFile(pack: string, file: string): string {
	return join(packDir(pack), file);
}

/** One shipped file, verbatim (BOM/EOL intact) — e.g. `readPackFile('srd-2024', 'items_srd.csv')`. */
export function readPackFile(pack: string, file: string): string {
	return readFileSync(packFile(pack, file), 'utf8');
}

/** Load whole packs into a graph, straight off disk. Each pack is its own root, as it is at
 *  runtime, so per-file/per-source filtering behaves the same as in the app. */
export function loadPacks(...packs: string[]): Promise<ContentGraph> {
	return loadContent(new NodeStorage(requireContentRepo()), packs);
}

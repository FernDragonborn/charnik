/*
 * What an update WOULD do, computed before anything is written (REL-4 slice 3).
 *
 * Two rules from the plan land here, and both are about not surprising the user:
 *  - **A hand-edited file is never overwritten.** That rule already exists and is unit-tested for
 *    the shipped-content re-seed (REL-3), so this reuses `isUserModified` rather than inventing a
 *    merge strategy: a file whose body no longer matches its own `#content-hash` was edited by the
 *    user, and their version wins.
 *  - **Removals are listed BEFORE applying, with what they would break.** Additions can't hurt
 *    anyone; a removed row can orphan a reference inside a character that is mid-campaign.
 *
 * Comparison is by GIT BLOB SHA, because that is what a repo tree listing gives us — so "did this
 * file change?" is answered without downloading a single byte.
 */
import type { Storage } from '$lib/storage/types';
import type { ContentGraph } from '../loader';
import { isUserModified } from '../provider';
import { parseContentDirectives } from '../meta';
import type { RemotePack } from './github';

/** Where a pack's files live locally. The runtime layout is `content/<pack>/…` regardless of which
 *  repo or folder they came from. */
export const localPath = (repoRelative: string): string => `content/${repoRelative}`;

/** `sha1("blob <byteLength>\0" + bytes)` — git's own object id, so it can be compared with the SHA
 *  in a tree listing directly. Uses WebCrypto; SHA-1 is not a trust decision here (that is the
 *  consent hash's job), it is the identifier the remote already published. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
	const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
	const buf = new Uint8Array(header.length + bytes.length);
	buf.set(header);
	buf.set(bytes, header.length);
	const digest = await crypto.subtle.digest('SHA-1', buf);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const FILE_CHANGE = {
	/** not here yet — safe, nothing can break */
	added: 'added',
	/** bytes differ from the remote */
	changed: 'changed',
	/** here, but gone upstream — the case that needs a warning */
	removed: 'removed',
	/** hand-edited locally, so the update SKIPS it and the user keeps their version */
	preserved: 'preserved'
} as const;
export type FileChangeKind = (typeof FILE_CHANGE)[keyof typeof FILE_CHANGE];

export interface FileChange {
	/** repo-relative path (`srd-2024/spells_srd.csv`) — `localPath()` maps it onto disk. */
	path: string;
	kind: FileChangeKind;
}

export interface PackDiff {
	pack: string;
	changes: FileChange[];
}

/** Does this diff actually ask to write anything? A pack whose only entries are `preserved` or
 *  `removed` has no download to do. */
export const hasWrites = (diff: PackDiff): boolean =>
	diff.changes.some((c) => c.kind === FILE_CHANGE.added || c.kind === FILE_CHANGE.changed);

/**
 * Compare one remote pack against what is on disk. Never writes. Files present locally but absent
 * from the remote are reported as `removed` — reported, not deleted here.
 */
export async function diffPack(storage: Storage, remote: RemotePack): Promise<PackDiff> {
	const changes: FileChange[] = [];
	const seen = new Set<string>();

	for (const file of remote.files) {
		const path = localPath(file.path);
		seen.add(path);
		if (!(await storage.exists(path))) {
			changes.push({ path: file.path, kind: FILE_CHANGE.added });
			continue;
		}
		if (await isUserModified(storage, path)) {
			changes.push({ path: file.path, kind: FILE_CHANGE.preserved });
			continue;
		}
		const local = await gitBlobSha(await storage.readBytes(path));
		if (local !== file.sha) changes.push({ path: file.path, kind: FILE_CHANGE.changed });
	}

	for (const entry of await storage.list(localPath(remote.pack)).catch(() => []))
		if (!entry.isDir && !seen.has(entry.path))
			changes.push({ path: `${remote.pack}/${entry.name}`, kind: FILE_CHANGE.removed });

	return { pack: remote.pack, changes };
}

/** The `#content-source` a CSV declares, or null if it declares none. */
export const sourceOf = (csv: string): string | null =>
	parseContentDirectives(csv).directives.get('source') ?? null;

/**
 * The source tag this pack currently claims ON DISK — the identity half of `source:id`.
 *
 * **Why this exists:** a pack that changes its `#content-source` is a NEW pack, never an update.
 * Identity is `source:id`, so a re-tag re-namespaces every row at once and breaks every character
 * reference that points at them — silently, since the files would otherwise look like ordinary
 * changed bytes. Comparing tags is the only thing standing between an upstream typo and a save
 * whose class, species and spells all resolve to nothing.
 *
 * Takes the first declared source in the pack; a pack whose files disagree is already malformed,
 * and the two-dimensional source filter is what surfaces that.
 */
export async function localPackSource(storage: Storage, pack: string): Promise<string | null> {
	const entries = (await storage.list(localPath(pack)).catch(() => []))
		.filter((e) => !e.isDir && e.name.endsWith('.csv'))
		.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const source = sourceOf(await storage.read(entry.path).catch(() => ''));
		if (source !== null) return source;
	}
	return null;
}

/** The content rows that would DISAPPEAR if this diff were applied — every row the loader read from
 *  a file the update removes. Keyed the way a character references content: `type:source:id`. */
export function rowsRemovedBy(graph: ContentGraph, diff: PackDiff): string[] {
	const doomed = new Set(
		diff.changes.filter((c) => c.kind === FILE_CHANGE.removed).map((c) => localPath(c.path))
	);
	if (doomed.size === 0) return [];
	return graph.rows
		.filter((row) => doomed.has(`${row.root}/${row.file}`))
		.map((row) => `${row.type}:${row.source}:${row.id}`)
		.sort();
}

/**
 * Which saved characters mention any of those row keys. Scans the raw character JSON for the
 * QUOTED key, which is exact for our references: every content reference is a whole string value of
 * the form `type:source:id` (`"class:SRD 5.2.1:barbarian"`), so a quoted match cannot collide with
 * a longer id the way a bare substring search could.
 *
 * ponytail: string scan over the saved JSON rather than a second reference walker — the derive
 * pipeline already owns "what does this character reference" (its `missing` list). If this ever
 * needs to report WHERE in the sheet the reference sits, derive against a filtered graph instead.
 */
export function charactersReferencing(
	characters: { slug: string; json: string }[],
	rowKeys: string[]
): { slug: string; keys: string[] }[] {
	if (rowKeys.length === 0) return [];
	return characters
		.map(({ slug, json }) => ({
			slug,
			keys: rowKeys.filter((key) => json.includes(`"${key}"`))
		}))
		.filter((hit) => hit.keys.length > 0);
}

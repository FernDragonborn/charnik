/*
 * What an update WOULD do, computed before anything is written (REL-4 slice 3).
 *
 * Two rules from the plan land here, and both are about not surprising the user:
 *  - **A hand-edited file is never overwritten.** That rule already exists and is unit-tested for
 *    the shipped-content re-seed (REL-3), so this reuses that rule (`isProtectedText`, the same one
 *    behind `isProtectedFromOverwrite`) rather than inventing a merge strategy: a file whose body no
 *    longer matches its own `#content-hash` was edited by the user, and their version wins.
 *  - **Removals are listed BEFORE applying, with what they would break.** Additions can't hurt
 *    anyone; a removed row can orphan a reference inside a character that is mid-campaign.
 *
 * Comparison is by GIT BLOB SHA, because that is what a repo tree listing gives us — so "did this
 * file change?" is answered without downloading a single byte.
 */
import Papa from 'papaparse';
import type { Storage } from '$lib/storage/types';
import { listFilesRecursive } from '$lib/storage/walk';
import type { ContentGraph } from '../loader';
import { isProtectedText } from '../disk';
import { parseContentDirectives } from '../meta';
import { isPackFile, type RemotePack } from './github';

/** Where a pack's files live locally. The runtime layout is `content/<pack>/…` regardless of which
 *  repo or folder they came from. */
export const localPath = (repoRelative: string): string => `content/${repoRelative}`;

/** The part of a repo-relative path BELOW the pack folder (`srd-2024/spells.csv` → `spells.csv`). */
export const withinPack = (repoRelative: string): string =>
	repoRelative.slice(repoRelative.indexOf('/') + 1);

/**
 * Where one of a pack's files lives on THIS disk. The first segment is replaced rather than kept,
 * because a pack's local folder can differ from the folder name in its repo: folder names are not
 * the publisher's to reserve, two repos may both publish `srd-2024`, and one of them has to land
 * somewhere else. Everything above this works in local names; only the fetch works in remote ones.
 */
export const localPathIn = (localPack: string, repoRelative: string): string =>
	`content/${localPack}/${withinPack(repoRelative)}`;

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
	preserved: 'preserved',
} as const;
type FileChangeKind = (typeof FILE_CHANGE)[keyof typeof FILE_CHANGE];

export interface FileChange {
	/** repo-relative path (`srd-2024/spells_srd.csv`) — `localPath()` maps it onto disk. */
	path: string;
	kind: FileChangeKind;
	/** The remote's git blob SHA. Absent only for `removed`, which by definition has no remote file.
	 *  Carried through because it is both the download's integrity check and the staging cache's key. */
	sha?: string;
	/**
	 * What was on disk WHEN THIS DIFF WAS COMPUTED: the local file's blob SHA, or `null` for a file
	 * that wasn't there. The apply re-checks it immediately before writing (a compare-and-set) and
	 * refuses the whole update if anything moved.
	 *
	 * Why: a diff is shown, then sits until the user clicks — minutes, or across a restart. Acting on
	 * a stale reading means overwriting an edit made in between, silently, having just told the user
	 * that file would be preserved.
	 */
	expectLocal?: string | null;
}

export interface PackDiff {
	/** The pack's LOCAL folder name — what is on disk, and what the registry is keyed by. Every
	 *  `FileChange.path` is repo-relative, so `localPathIn(pack, …)` is what maps one onto the other. */
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
export async function diffPack(
	storage: Storage,
	remote: RemotePack,
	/** The folder it occupies HERE. Differs from `remote.pack` when the name was already taken by a
	 *  pack from another repo, so the install landed beside it instead of on top of it. */
	localPack: string = remote.pack,
): Promise<PackDiff> {
	const changes: FileChange[] = [];
	const seen = new Set<string>();
	const decoder = new TextDecoder();

	for (const file of remote.files) {
		const path = localPathIn(localPack, file.path);
		seen.add(path);
		if (!(await storage.exists(path))) {
			changes.push({ path: file.path, kind: FILE_CHANGE.added, sha: file.sha, expectLocal: null });
			continue;
		}
		// ONE read, two questions: the blob SHA the remote is compared against, and whether the body
		// still matches its own `#content-hash`. Asking the second one through the Storage seam read
		// every file of every pack a second time, on every check and at every launch.
		const bytes = await storage.readBytes(path);
		const expectLocal = await gitBlobSha(bytes);
		if (await isProtectedText(path, decoder.decode(bytes))) {
			changes.push({ path: file.path, kind: FILE_CHANGE.preserved, sha: file.sha, expectLocal });
			continue;
		}
		if (expectLocal !== file.sha)
			changes.push({ path: file.path, kind: FILE_CHANGE.changed, sha: file.sha, expectLocal });
	}

	// The local side is walked RECURSIVELY: a pack's plugins live in `plugins/<ns>/` (PLUGINS §2), so
	// a flat listing would never notice upstream deleting executable code — it would sit there forever.
	// Only files the PACK FORMAT covers can be "removed": anything else in that folder is the user's,
	// not the update's business (a README, notes, a leftover from an older layout).
	const localRoot = localPath(localPack);
	for (const path of await listFilesRecursive(storage, localRoot)) {
		if (seen.has(path) || !isPackFile(path)) continue;
		const bytes = await storage.readBytes(path);
		changes.push({
			// stated the way every other change is — repo-relative — so one mapping serves them all,
			// even though a removed file is by definition not in the repo any more
			path: `${remote.pack}/${path.slice(localRoot.length + 1)}`,
			// The overwrite guard decides the DELETE path too: a file the user wrote or edited is
			// theirs whether the update wants to change it or to drop it, and "never overwritten"
			// cannot mean "unless upstream stopped shipping it".
			kind: (await isProtectedText(path, decoder.decode(bytes)))
				? FILE_CHANGE.preserved
				: FILE_CHANGE.removed,
			expectLocal: await gitBlobSha(bytes),
		});
	}

	return { pack: localPack, changes };
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
		diff.changes
			.filter((c) => c.kind === FILE_CHANGE.removed)
			.map((c) => localPathIn(diff.pack, c.path)),
	);
	if (doomed.size === 0) return [];
	return graph.rows
		.filter((row) => doomed.has(`${row.root}/${row.file}`))
		.map((row) => `${row.type}:${row.source}:${row.id}`)
		.sort();
}

/**
 * The rows a CHANGED file would drop: present in the graph for that file, absent from the incoming
 * bytes. This is the common shape of a breaking update and the one `rowsRemovedBy` cannot see —
 * upstream rarely deletes a whole CSV, it deletes or re-ids a row inside one, which arrives looking
 * like any other changed file.
 *
 * Identity comes from the graph, which already knows each row's `type:source:id`; the new bytes only
 * have to answer "is this id still in here". Parsed with the same CSV library the loader uses, over
 * the body with the directive block stripped.
 */
export function rowsDroppedFromFile(
	graph: ContentGraph,
	localFilePath: string,
	incoming: string,
): string[] {
	const before = graph.rows.filter((row) => `${row.root}/${row.file}` === localFilePath);
	if (before.length === 0) return [];
	const { body } = parseContentDirectives(incoming);
	const parsed = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
	const stillThere = new Set(parsed.data.map((row) => row['id']).filter(Boolean));
	return before
		.filter((row) => !stillThere.has(row.id))
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
	rowKeys: string[],
): { slug: string; keys: string[] }[] {
	if (rowKeys.length === 0) return [];
	return characters
		.map(({ slug, json }) => ({
			slug,
			keys: rowKeys.filter((key) => json.includes(`"${key}"`)),
		}))
		.filter((hit) => hit.keys.length > 0);
}

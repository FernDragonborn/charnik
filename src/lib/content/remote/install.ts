/*
 * Applying an update (REL-4 slice 3) — the only part of this feature that writes.
 *
 * **Always a user action** (SECURITY.md §7): nothing here runs on a timer. Checking and even
 * downloading can be automatic; changing someone's rules mid-campaign cannot.
 *
 * **Pack-level all-or-nothing, on the network AND on disk.** Every byte is fetched first, so a
 * failed download aborts with nothing written. Then the whole pack is rebuilt beside the live folder
 * and swapped in with a rename: per-file writes are atomic individually, but a 12-file update that
 * dies on file 7 leaves a root that is half old and half new, unresolvable by inspection. The
 * visible state goes from all-old to all-new, and the folder it replaced is kept one generation as
 * `<pack>.prev` — the only undo an applied update has.
 *
 * **The disk is re-checked immediately before the swap** against what the diff saw
 * (`FileChange.expectLocal`). A diff is shown and then waits for a click — minutes, or a restart —
 * and acting on a stale reading means silently overwriting an edit made in between.
 *
 * The content watcher needs no suppression here: its callback only re-READS (debounced), so a bulk
 * write coalesces into one reload — which is the correct reaction to content having changed.
 */
import type { Storage } from '$lib/storage/types';
import type { ContentGraph } from '../loader';
import { rawUrl, type GithubRepo, type RemotePack } from './github';
import type { RemoteFetcher, UpdateError } from './types';
import {
	FILE_CHANGE,
	gitBlobSha,
	listFiles,
	localPath,
	localPackSource,
	rowsDroppedFromFile,
	sourceOf,
	type FileChange,
	type PackDiff
} from './diff';

/**
 * Where pre-downloaded bytes wait between "check and pre-download" and the click that applies them.
 *
 * **Content-addressed: the file NAME is the git blob SHA.** That is what makes a cache on disk safe
 * rather than a second source of truth to keep in sync — there is no invalidation rule to get wrong
 * (different bytes ⇒ different name), two packs shipping the same file cost one entry, and a
 * truncated or tampered entry is caught by re-hashing it instead of trusted because it exists.
 *
 * It lives OUTSIDE `content/`, because every folder in there is a pack by definition
 * (`discoverContentRoots`) and a cache is not content.
 */
const CACHE_DIR = '.pack-cache';
export const cachePath = (sha: string): string => `${CACHE_DIR}/${sha}`;

/** One file in hand, not yet on disk. */
interface StagedFile {
	path: string;
	bytes: Uint8Array;
}

export interface ApplyResult {
	/** repo-relative paths written */
	written: string[];
	/** hand-edited files the update deliberately skipped */
	preserved: string[];
	/** present locally, gone upstream — deleted only when `removeDeleted` is asked for */
	removed: string[];
	/** set when NOTHING was written: the disk is exactly as it was */
	error?: UpdateError;
	/** `type:source:id` keys this update would drop from INSIDE a changed file. Set when the apply
	 *  stopped to ask about them; the same list is what `acceptRowRemovals` then approves. */
	rowRemovals?: string[];
}

export interface ApplyRequest {
	storage: Storage;
	fetcher: RemoteFetcher;
	/** where to fetch the files from */
	repo: GithubRepo;
	/** what to do — computed by `diffPack`, and shown to the user before this is called */
	diff: PackDiff;
	/** Delete files the remote no longer has. Off by default: a removal can orphan a character's
	 *  reference, so it stays an explicit choice made after seeing the impact preview. */
	removeDeleted?: boolean;
	/** The loaded content graph, so the apply can name the ROWS this update drops. Without it the
	 *  check is skipped (a fresh install has no graph to lose anything from). */
	graph?: ContentGraph | null;
	/** The user has now seen the row-level losses and said yes. */
	acceptRowRemovals?: boolean;
}

/**
 * Fetch everything this diff wants, then write it. Returns what happened; on any download failure
 * it returns early with `error` and the disk untouched.
 */
export async function applyPackUpdate({
	storage,
	fetcher,
	repo,
	diff,
	removeDeleted = false,
	graph = null,
	acceptRowRemovals = false
}: ApplyRequest): Promise<ApplyResult> {
	const wanted = diff.changes.filter(
		(c) => c.kind === FILE_CHANGE.added || c.kind === FILE_CHANGE.changed
	);
	const preserved = diff.changes.filter((c) => c.kind === FILE_CHANGE.preserved).map((c) => c.path);
	const removable = diff.changes.filter((c) => c.kind === FILE_CHANGE.removed).map((c) => c.path);
	const nothing = { written: [], preserved, removed: [] };

	// phase 1 — get it all in hand; one failure means we write nothing at all
	const gathered = await gatherBytes({ storage, fetcher, repo, wanted });
	if ('error' in gathered) return { ...nothing, error: gathered.error };
	const staged = gathered.files;

	// phase 1½ — REFUSE a re-tagged pack. This is the only place it can be checked: the diff
	// compares blob SHAs without downloading, so the remote's `#content-source` is unknown until
	// now — and now is still before anything is written.
	const clash = await sourceClash(storage, diff.pack, staged);
	if (clash) return { ...nothing, error: clash };

	// phase 1¾ — the disk must still be what the diff was computed against. The user approved a
	// specific change to specific files; if any of them moved since (an edit in another window, a
	// pack folder replaced by hand), the approval no longer describes reality.
	const moved = await localChangesSince(storage, diff, removeDeleted);
	if (moved.length > 0)
		return {
			...nothing,
			error: {
				kind: 'i18n',
				key: 'settings.packs.localChanged',
				values: { files: moved.join(', ') }
			}
		};

	// phase 1⅞ — what would DISAPPEAR from inside the files being rewritten. The file-level preview
	// shown before this point can only see whole files the remote dropped, which upstream rarely
	// does; deleting or re-iding a row inside a CSV is the ordinary case, and it arrives looking
	// exactly like any other changed file. The bytes are only here, so this is the first moment the
	// question can be answered at all — and it is still before anything is written.
	const rowRemovals = graph ? rowsDroppedByUpdate(graph, staged) : [];
	if (rowRemovals.length > 0 && !acceptRowRemovals)
		return {
			...nothing,
			rowRemovals,
			error: {
				kind: 'i18n',
				key: 'settings.packs.rowsWouldVanish',
				values: { count: rowRemovals.length }
			}
		};

	// phase 2 — commit through a full replacement folder. Per-file writes are atomic on their own,
	// but a 12-file update that dies on file 7 leaves a root that is half old and half new and
	// unresolvable by inspection. Building the whole tree beside the live one and swapping it in with
	// a rename makes the visible state jump from all-old to all-new.
	const removed = removeDeleted ? removable : [];
	await swapInNewTree(storage, diff.pack, staged, new Set(removed.map(localPath)));

	// the pre-download did its job; the cache is pruned as a whole after a check, so nothing is
	// deleted here — two packs can legitimately share a blob (the cache is content-addressed)
	return { written: staged.map((f) => f.path), preserved, removed };
}

/** Every row the incoming bytes drop, across every file being rewritten. Decoded as text because
 *  that is what a CSV is; a `plugin.json`/`main.js` in the same set simply yields nothing. */
function rowsDroppedByUpdate(graph: ContentGraph, staged: StagedFile[]): string[] {
	const decoder = new TextDecoder();
	const dropped = staged.flatMap((file) =>
		rowsDroppedFromFile(graph, localPath(file.path), decoder.decode(file.bytes))
	);
	return [...new Set(dropped)].sort();
}

/** Where a replacement tree is built, and where the one it replaces is kept. Both live beside the
 *  pack, inside `content/`, and are excluded from pack discovery by name (`isReservedPackName`) —
 *  a content load that caught one of them would load every row twice. */
const stagingDir = (pack: string): string => localPath(`${pack}.new`);
const previousDir = (pack: string): string => localPath(`${pack}.prev`);

/**
 * Which files the diff's decisions no longer match. The diff recorded what it saw on disk
 * (`expectLocal`); this re-reads and compares, immediately before the write. A file that was
 * `preserved` is deliberately NOT checked — we are not touching it either way.
 */
async function localChangesSince(
	storage: Storage,
	diff: PackDiff,
	removeDeleted: boolean
): Promise<string[]> {
	const guarded = diff.changes.filter(
		(c) =>
			c.expectLocal !== undefined &&
			(c.kind === FILE_CHANGE.added ||
				c.kind === FILE_CHANGE.changed ||
				(removeDeleted && c.kind === FILE_CHANGE.removed))
	);
	const moved: string[] = [];
	for (const change of guarded) {
		const path = localPath(change.path);
		const now = (await storage.exists(path))
			? await gitBlobSha(await storage.readBytes(path))
			: null;
		if (now !== change.expectLocal) moved.push(change.path);
	}
	return moved;
}

/**
 * Build `<pack>.new` as a COMPLETE tree — every file the pack currently has, minus the ones being
 * removed, plus the ones being written — then swap it in with two renames.
 *
 * The old folder is kept as `<pack>.prev` rather than deleted: it is the only undo an applied update
 * has (a pin prevents, it does not revert), and it also catches the one edit the compare-and-set
 * above cannot — one made during the swap itself. It is replaced by the next apply, so at most one
 * generation is ever on disk.
 *
 * Crash safety comes from `recoverInterruptedApply`, which reads the leftovers at startup: the
 * three possible in-between states are each distinguishable by which folders exist.
 */
async function swapInNewTree(
	storage: Storage,
	pack: string,
	staged: StagedFile[],
	dropping: Set<string>
): Promise<void> {
	if (staged.length === 0 && dropping.size === 0) return; // nothing to do — don't churn a .prev
	const live = localPath(pack);
	const next = stagingDir(pack);
	await storage.remove(next).catch(() => {}); // a leftover from an interrupted attempt
	await storage.mkdir(next); // the replacement can legitimately be EMPTY (every file removed)

	// carry over everything not being written or dropped — including files the pack format doesn't
	// cover (a README, the user's notes) and hand-edited ones the update preserves
	const written = new Set(staged.map((f) => localPath(f.path)));
	for (const path of await listFiles(storage, live)) {
		if (written.has(path) || dropping.has(path)) continue;
		await storage.writeBytes(
			`${next}/${path.slice(live.length + 1)}`,
			await storage.readBytes(path)
		);
	}
	// writeBytes preserves the exact bytes (a content CSV's BOM/CRLF are load-bearing for Excel + the hash)
	for (const file of staged)
		await storage.writeBytes(`${next}/${file.path.slice(pack.length + 1)}`, file.bytes);

	const prev = previousDir(pack);
	await storage.remove(prev).catch(() => {});
	if (await storage.exists(live)) await storage.rename(live, prev);
	await storage.rename(next, live);
}

/**
 * Finish or undo an apply that was interrupted (crash, kill, power loss) — call once at startup,
 * before content is discovered. The staging folders say where it stopped:
 *
 *  - live + `.new`  → the swap never started; the half-built tree is junk.
 *  - `.prev` only   → it died between the two renames; the pack is intact under `.prev`.
 *  - `.new` only    → it died after the second rename with no old copy; promote it.
 *
 * `.prev` alongside a live folder is NOT a leftover — that is the deliberate one-generation undo.
 */
export async function recoverInterruptedApply(storage: Storage, pack: string): Promise<void> {
	const live = localPath(pack);
	const next = stagingDir(pack);
	const prev = previousDir(pack);
	if (await storage.exists(live)) {
		await storage.remove(next).catch(() => {});
		return;
	}
	if (await storage.exists(prev)) {
		await storage.rename(prev, live);
		await storage.remove(next).catch(() => {});
		return;
	}
	if (await storage.exists(next)) await storage.rename(next, live);
}

/** Roll one applied update back to the copy the swap kept. One generation only — the next apply
 *  replaces it — so this is "undo the last update", not a history. */
export async function rollbackPack(storage: Storage, pack: string): Promise<boolean> {
	const live = localPath(pack);
	const prev = previousDir(pack);
	if (!(await storage.exists(prev))) return false;
	const scratch = stagingDir(pack);
	await storage.remove(scratch).catch(() => {});
	if (await storage.exists(live)) await storage.rename(live, scratch);
	await storage.rename(prev, live);
	await storage.remove(scratch).catch(() => {});
	return true;
}

/** Is there something to roll back to? Drives the "undo this update" button. */
export const hasRollback = (storage: Storage, pack: string): Promise<boolean> =>
	storage.exists(previousDir(pack));

interface GatherRequest {
	storage: Storage;
	fetcher: RemoteFetcher;
	repo: GithubRepo;
	wanted: FileChange[];
}

/**
 * Get every wanted file's bytes: from the staging cache when a pre-download already fetched them,
 * off the network otherwise. Nothing is written to `content/` here — this is the "all or nothing"
 * half, so a failure anywhere returns an error with the disk untouched.
 *
 * **Every byte is verified against the blob SHA we diffed against**, cached or fresh. It costs one
 * hash of data we are already holding, and it closes the one failure mode that would otherwise be
 * invisible: `raw.githubusercontent.com` serving a stale or newer copy than the tree listing said,
 * which would write content whose SHA still doesn't match — an update that reappears every check and
 * can never be cleared.
 */
async function gatherBytes({
	storage,
	fetcher,
	repo,
	wanted
}: GatherRequest): Promise<{ files: StagedFile[] } | { error: UpdateError }> {
	const files: StagedFile[] = [];
	for (const change of wanted) {
		const cached = change.sha === undefined ? null : await readCached(storage, change.sha);
		if (cached) {
			files.push({ path: change.path, bytes: cached });
			continue;
		}
		const res = await fetcher.getBytes(rawUrl(repo, change.path));
		if (res.kind === 'error')
			return { error: { kind: 'raw', message: `${change.path}: ${res.message}` } };
		if (change.sha !== undefined && (await gitBlobSha(res.bytes)) !== change.sha)
			return {
				error: { kind: 'i18n', key: 'settings.packs.contentMoved', values: { path: change.path } }
			};
		files.push({ path: change.path, bytes: res.bytes });
	}
	return { files };
}

/** A cache entry, only if it is really the bytes its name claims — a truncated write or a tampered
 *  file is treated as a miss and re-fetched, never trusted for existing. */
async function readCached(storage: Storage, sha: string): Promise<Uint8Array | null> {
	try {
		const bytes = await storage.readBytes(cachePath(sha));
		return (await gitBlobSha(bytes)) === sha ? bytes : null;
	} catch {
		return null;
	}
}

/**
 * Pre-download an update's bytes into the cache, so applying it later is instant and works offline
 * (the `download` update mode). Writes nothing into `content/`: downloading is not applying, and
 * applying stays a click (SECURITY.md §7). Failures are silent — a pre-fetch nobody asked to watch
 * must not produce an error the user can't act on, and apply will simply fetch then.
 */
export async function stagePackUpdate({
	storage,
	fetcher,
	repo,
	diff
}: {
	storage: Storage;
	fetcher: RemoteFetcher;
	repo: GithubRepo;
	diff: PackDiff;
}): Promise<boolean> {
	let complete = true;
	for (const change of diff.changes) {
		if (change.kind !== FILE_CHANGE.added && change.kind !== FILE_CHANGE.changed) continue;
		if (change.sha === undefined) continue;
		if ((await readCached(storage, change.sha)) !== null) continue;
		const res = await fetcher.getBytes(rawUrl(repo, change.path));
		if (res.kind === 'error' || (await gitBlobSha(res.bytes)) !== change.sha) {
			complete = false;
			continue;
		}
		await storage.writeBytes(cachePath(change.sha), res.bytes);
	}
	return complete;
}

/** Is this whole update already downloaded? Drives the "ready to apply offline" hint. */
export async function isStaged(storage: Storage, diff: PackDiff): Promise<boolean> {
	const wanted = diff.changes.filter(
		(c) => c.kind === FILE_CHANGE.added || c.kind === FILE_CHANGE.changed
	);
	if (wanted.length === 0) return false;
	for (const change of wanted) {
		if (change.sha === undefined) return false;
		if ((await readCached(storage, change.sha)) === null) return false;
	}
	return true;
}

/**
 * Throw away staged bytes nothing is waiting for. Called once a check has finished, when the set of
 * pending updates is complete and therefore authoritative: an upstream that changes twice before the
 * user applies anything would otherwise leave the first download on disk forever.
 */
export async function pruneCache(storage: Storage, keep: Set<string>): Promise<void> {
	for (const entry of await storage.list(CACHE_DIR).catch(() => []))
		if (!entry.isDir && !keep.has(entry.name)) await storage.remove(entry.path).catch(() => {});
}

/**
 * Does the incoming pack claim a DIFFERENT `#content-source` than the one on disk? If so this is a
 * new pack wearing an old pack's folder name, and applying it would silently re-namespace every row
 * (identity is `source:id`) — every character reference into this pack would resolve to nothing at
 * once. Refuse and say so; installing it as a separate pack is the honest path.
 *
 * A pack with nothing local to compare against (a fresh install) has nothing to break.
 */
async function sourceClash(
	storage: Storage,
	pack: string,
	staged: StagedFile[]
): Promise<UpdateError | null> {
	const local = await localPackSource(storage, pack);
	if (local === null) return null;
	const decoder = new TextDecoder();
	for (const file of staged) {
		const incoming = sourceOf(decoder.decode(file.bytes));
		if (incoming !== null && incoming !== local)
			return {
				kind: 'i18n',
				key: 'settings.packs.sourceChanged',
				values: { pack, from: local, to: incoming }
			};
	}
	return null;
}

/** Does this pack ship executable code? A pack may carry plugins (PLUGINS §2), and the installer
 *  owes the user that fact BEFORE it installs — arriving inside a pack grants nothing, but it must
 *  never be a surprise either. Returns the namespaces it would add. */
export function pluginsIn(remote: RemotePack): string[] {
	return namespacesOf(remote.files.map((f) => f.path));
}

/**
 * Plugin namespaces whose CODE this update would rewrite — a much sharper thing to say than "this
 * pack contains plugins", and the one the user has to hear: new bytes void the consent hash
 * (PLUGINS §6.3), so an enabled plugin STOPS running the moment this is applied and stays stopped
 * until the user approves it again. Sheet numbers change with it. Silence there would read as the
 * app breaking by itself.
 */
export function pluginsTouchedBy(diff: PackDiff): string[] {
	return namespacesOf(
		diff.changes
			.filter((c) => c.kind === FILE_CHANGE.added || c.kind === FILE_CHANGE.changed)
			.map((c) => c.path)
	);
}

/** `<pack>/plugins/<namespace>/…` — the packaging layout (PLUGINS §2), read off repo-relative paths. */
function namespacesOf(paths: string[]): string[] {
	const namespaces = new Set<string>();
	for (const path of paths) {
		const [, dir, namespace] = path.split('/');
		if (dir === 'plugins' && namespace !== undefined) namespaces.add(namespace);
	}
	return [...namespaces].sort();
}

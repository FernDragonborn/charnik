/*
 * Applying an update (REL-4 slice 3) — the only part of this feature that writes.
 *
 * **Always a user action** (SECURITY.md §7): nothing here runs on a timer. Checking and even
 * downloading can be automatic; changing someone's rules mid-campaign cannot.
 *
 * **Pack-level all-or-nothing.** Per-file writes are already atomic (temp→rename), but a 12-file
 * update that dies on file 7 leaves a root that is half old and half new — unresolvable by
 * inspection. So every byte is fetched FIRST and nothing is written until all of them are in hand;
 * a failed download aborts with the disk untouched.
 *
 * The content watcher needs no suppression here: its callback only re-READS (debounced), so a bulk
 * write coalesces into one reload — which is the correct reaction to content having changed.
 */
import type { Storage } from '$lib/storage/types';
import { rawUrl, type GithubRepo, type RemotePack } from './github';
import type { RemoteFetcher, UpdateError } from './types';
import {
	FILE_CHANGE,
	gitBlobSha,
	localPath,
	localPackSource,
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
	removeDeleted = false
}: ApplyRequest): Promise<ApplyResult> {
	const wanted = diff.changes.filter(
		(c) => c.kind === FILE_CHANGE.added || c.kind === FILE_CHANGE.changed
	);
	const preserved = diff.changes.filter((c) => c.kind === FILE_CHANGE.preserved).map((c) => c.path);
	const removable = diff.changes.filter((c) => c.kind === FILE_CHANGE.removed).map((c) => c.path);

	// phase 1 — get it all in hand; one failure means we write nothing at all
	const gathered = await gatherBytes({ storage, fetcher, repo, wanted });
	if ('error' in gathered) return { written: [], preserved, removed: [], error: gathered.error };
	const staged = gathered.files;

	// phase 1½ — REFUSE a re-tagged pack. This is the only place it can be checked: the diff
	// compares blob SHAs without downloading, so the remote's `#content-source` is unknown until
	// now — and now is still before anything is written.
	const clash = await sourceClash(storage, diff.pack, staged);
	if (clash) return { written: [], preserved, removed: [], error: clash };

	// phase 2 — commit. writeBytes is temp→rename and creates parents, and preserves the exact
	// bytes (a content CSV's BOM/CRLF are load-bearing for Excel + the hash).
	for (const file of staged) await storage.writeBytes(localPath(file.path), file.bytes);
	// the pre-download did its job; its entries are now duplicates of what is on disk
	for (const change of wanted)
		if (change.sha !== undefined) await storage.remove(cachePath(change.sha)).catch(() => {});

	const removed: string[] = [];
	if (removeDeleted) {
		for (const path of removable) {
			await storage.remove(localPath(path));
			removed.push(path);
		}
	}
	return { written: staged.map((f) => f.path), preserved, removed };
}

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

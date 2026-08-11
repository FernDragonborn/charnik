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
import type { RemoteFetcher } from './types';
import { FILE_CHANGE, localPath, type PackDiff } from './diff';

export interface ApplyResult {
	/** repo-relative paths written */
	written: string[];
	/** hand-edited files the update deliberately skipped */
	preserved: string[];
	/** present locally, gone upstream — deleted only when `removeDeleted` is asked for */
	removed: string[];
	/** set when NOTHING was written: the disk is exactly as it was */
	error?: string;
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

	// phase 1 — fetch it all; one failure means we write nothing at all
	const staged: { path: string; bytes: Uint8Array }[] = [];
	for (const change of wanted) {
		const res = await fetcher.getBytes(rawUrl(repo, change.path));
		if (res.kind === 'error')
			return {
				written: [],
				preserved,
				removed: [],
				error: `${change.path}: ${res.message}`
			};
		staged.push({ path: change.path, bytes: res.bytes });
	}

	// phase 2 — commit. writeBytes is temp→rename and creates parents, and preserves the exact
	// bytes (a content CSV's BOM/CRLF are load-bearing for Excel + the hash).
	for (const file of staged) await storage.writeBytes(localPath(file.path), file.bytes);

	const removed: string[] = [];
	if (removeDeleted) {
		for (const path of removable) {
			await storage.remove(localPath(path));
			removed.push(path);
		}
	}
	return { written: staged.map((f) => f.path), preserved, removed };
}

/** Does this pack ship executable code? A pack may carry plugins (PLUGINS §2), and the installer
 *  owes the user that fact BEFORE it installs — arriving inside a pack grants nothing, but it must
 *  never be a surprise either. Returns the namespaces it would add. */
export function pluginsIn(remote: RemotePack): string[] {
	const namespaces = new Set<string>();
	for (const file of remote.files) {
		const [, dir, namespace] = file.path.split('/');
		if (dir === 'plugins' && namespace !== undefined) namespaces.add(namespace);
	}
	return [...namespaces].sort();
}

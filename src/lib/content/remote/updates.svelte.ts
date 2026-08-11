/*
 * The update ORCHESTRATOR — what Settings calls, and the only place the pieces meet: the registry
 * (which packs, which repos, when last asked), the fetcher (Rust), the GitHub adapter, and the
 * diff. Everything it exposes is a user action or reads state; nothing here starts on its own.
 *
 * Desktop only. The web build serves the content of its own deploy, so there is nothing to update
 * and `checkNow` simply reports that.
 */
import { detectPlatform, Platform, getUserStorage } from '$lib/storage/provider';
import { readCharacterFiles } from '$lib/character/repository';
import { content } from '../store.svelte';
import {
	forgetPack,
	forgetPending,
	isReservedPackName,
	packConfig,
	recordCheck,
	registerPack,
	rememberPending,
	reposDueForCheck,
	unDismissMissing,
	UPDATE_MODE,
	type PackConfigData
} from '../packs.svelte';
import { checkRepo, parseGithubRepo, type RemotePack } from './github';
import { diffPack, hasWrites, rowsRemovedBy, charactersReferencing, type PackDiff } from './diff';
import {
	applyPackUpdate,
	hasRollback,
	isStaged,
	pluginsIn,
	pluginsTouchedBy,
	pruneCache,
	rollbackPack,
	stagePackUpdate,
	type ApplyResult
} from './install';
import { tauriFetcher } from './tauri-fetch';
import type { RemoteFetcher, UpdateError } from './types';

/** One pack with an update waiting, and everything the user needs to decide about it. */
export interface PendingUpdate {
	pack: string;
	repo: string;
	remote: RemotePack;
	diff: PackDiff;
	/** content rows that would DISAPPEAR — listed before applying, never after */
	removedRows: string[];
	/** characters that reference those rows, so "this breaks Grog" is visible up front */
	affected: { slug: string; keys: string[] }[];
	/** plugin namespaces this pack would add — code always gets said out loud (PLUGINS §2) */
	plugins: string[];
	/** …and the ones THIS update rewrites, which is the sharper warning: they stop running until
	 *  the user re-approves the new bytes */
	pluginsChanged: string[];
	/** every byte is already downloaded (update mode `download`), so applying works offline */
	staged: boolean;
}

/** A pack found in a repo the user just pasted, and what installing it would bring. */
export interface DiscoveredPack {
	pack: string;
	repo: string;
	remote: RemotePack;
	files: number;
	/** plugin namespaces it ships — said out loud BEFORE installing, never discovered afterwards */
	plugins: string[];
	/** already in the registry: offer nothing, it is an update case, not an install */
	installed: boolean;
}

interface UpdateState {
	/** desktop-only feature; kept in the state (not computed in the component) so the dev preview at
	 *  /dev/packs can force it on in a plain browser — same trick the plugin store uses */
	supported: boolean;
	checking: boolean;
	/** pack → what is waiting for a decision */
	pending: Record<string, PendingUpdate>;
	/** what the last pasted URL turned out to hold (empty until someone pastes one) */
	discovered: DiscoveredPack[];
	/** last failure, kept for the Settings panel — never toasted: offline is not actionable (UX-1) */
	error: UpdateError | null;
}

export const updates = $state<UpdateState>({
	supported: detectPlatform() === Platform.Desktop,
	checking: false,
	pending: {},
	discovered: [],
	error: null
});

/** Which repos an AUTOMATIC check may contact right now (mode + throttle + pins). */
export const dueRepos = (cfg: PackConfigData = packConfig, now = Date.now()): string[] =>
	reposDueForCheck(cfg, now);

/**
 * Everything that rebuilds the pending set or sweeps the pre-download cache runs ONE AT A TIME.
 *
 * Serialised, not deduplicated: the startup check and a click on "check now" are two different
 * questions — the manual one may name a repo the automatic one skipped — so neither may be dropped
 * in favour of the other. But they must not interleave, because both a check and an apply finish by
 * pruning the cache against `updates.pending`, and that set is only authoritative when nothing else
 * is mid-way through rebuilding it. Two at once means whichever finishes first prunes against a
 * half-built set and deletes bytes the other had just downloaded — an "already staged" update that
 * silently has to fetch itself again.
 *
 * `updates.checking` stays what it always was, a spinner; this is the actual mutual exclusion.
 */
let packQueue: Promise<unknown> = Promise.resolve();

function serialised<T>(run: () => Promise<T>): Promise<T> {
	// a failure must not poison the queue for everything behind it
	const next = packQueue.catch(() => {}).then(run);
	packQueue = next.catch(() => {});
	return next;
}

/**
 * Ask the repos what they have. `manual` deliberately bypasses the once-a-day throttle and the
 * update-mode gate — "I want to test this one now" is the real use of the button; automatic runs
 * respect both. Silent on failure by design: an offline user can do nothing about it.
 */
export function checkNow(
	opts: { manual?: boolean; repo?: string; fetcher?: RemoteFetcher } = {}
): Promise<void> {
	return serialised(() => runCheck(opts));
}

async function runCheck(opts: {
	manual?: boolean;
	repo?: string;
	fetcher?: RemoteFetcher;
}): Promise<void> {
	if (detectPlatform() !== Platform.Desktop) return;
	const fetcher = opts.fetcher ?? tauriFetcher;
	const repos =
		opts.repo !== undefined
			? [opts.repo]
			: opts.manual === true
				? [...new Set(Object.values(packConfig.packs).map((p) => p.repo))]
				: dueRepos();
	// Nothing to ask — but the cache still needs sweeping, and the prune used to sit BEHIND this
	// return. Switching from `download` back to `off` (or pinning the last pack) then left every
	// staged byte on disk forever, because the one thing that cleans them only ran after a check that
	// could no longer happen. The pending set is restored at launch, so it is authoritative here too.
	if (repos.length === 0) {
		await pruneCache(getUserStorage(), stagedShas());
		return;
	}

	updates.checking = true;
	updates.error = null;
	try {
		for (const repo of repos) await checkOneRepo(fetcher, repo);
		// the pending set is now complete, so it is also authoritative about what the pre-download
		// cache is still holding for a reason
		await pruneCache(getUserStorage(), stagedShas());
	} finally {
		updates.checking = false;
	}
}

/** Every blob SHA some pending update still wants; anything else in the cache is litter. */
function stagedShas(): Set<string> {
	const keep = new Set<string>();
	for (const pending of Object.values(updates.pending))
		for (const change of pending.diff.changes) if (change.sha !== undefined) keep.add(change.sha);
	return keep;
}

async function checkOneRepo(fetcher: RemoteFetcher, repo: string): Promise<void> {
	const stored = packConfig.repos[repo]?.etag;
	const res = await checkRepo(fetcher, repo, stored);
	if (res.kind === 'error') {
		updates.error = { kind: 'raw', message: res.message };
		return;
	}
	if (res.kind === 'unsupported') {
		updates.error = { kind: 'i18n', key: 'settings.packs.hostUnsupported', values: { repo } };
		return;
	}
	// a 304 still counts as "asked today" — that is exactly the check we want to skip tomorrow
	recordCheck(repo, new Date(), res.kind === 'packs' ? res.etag : undefined);
	if (res.kind === 'unchanged') return;

	for (const remote of res.packs) {
		const entry = packConfig.packs[remote.pack];
		// only packs this user actually installed FROM THIS REPO, and not ones they froze
		if (entry?.repo !== repo || entry.pinned === true) continue;
		const pending = await describeUpdate(repo, remote);
		if (!pending) {
			delete updates.pending[remote.pack];
			forgetPending(remote.pack);
			continue;
		}
		// `download` mode fetches the bytes NOW so applying is instant and works offline. It is still
		// only a download: nothing under `content/` is touched until the user clicks (SECURITY.md §7).
		const parsed = parseGithubRepo(repo);
		if (packConfig.updates === UPDATE_MODE.download && parsed && hasWrites(pending.diff)) {
			await stagePackUpdate({
				storage: getUserStorage(),
				fetcher,
				repo: parsed,
				diff: pending.diff
			});
			pending.staged = await isStaged(getUserStorage(), pending.diff);
		}
		updates.pending[remote.pack] = pending;
		rememberPending(remote.pack, { repo, files: remote.files });
	}
}

/**
 * Build the full picture for one pack, or null when it is already up to date. Deliberately
 * NETWORK-FREE — everything here is the remote file list compared against the local disk — so the
 * same function can rebuild the panel at launch from the remembered list, with no request at all.
 */
async function describeUpdate(repo: string, remote: RemotePack): Promise<PendingUpdate | null> {
	const storage = getUserStorage();
	const diff = await diffPack(storage, remote);
	const removals = diff.changes.filter((c) => c.kind === 'removed');
	if (!hasWrites(diff) && removals.length === 0) return null;

	const removedRows = content.graph ? rowsRemovedBy(content.graph, diff) : [];
	return {
		pack: remote.pack,
		repo,
		remote,
		diff,
		removedRows,
		affected: await whoBreaks(removedRows),
		plugins: pluginsIn(remote),
		pluginsChanged: pluginsTouchedBy(diff),
		staged: await isStaged(storage, diff)
	};
}

/** Characters that reference rows an update would remove. Reads the saved JSON as-is — the point is
 *  to warn BEFORE applying, so it must not depend on anything the update would change. */
async function whoBreaks(removedRows: string[]): Promise<{ slug: string; keys: string[] }[]> {
	if (removedRows.length === 0) return [];
	return charactersReferencing(await readCharacterFiles(getUserStorage()), removedRows);
}

/**
 * Apply ONE pack's pending update. Always called from a click — never from `checkNow`, never on a
 * timer (SECURITY.md §7). Returns what happened; on failure nothing was written.
 */
export function applyUpdate(
	pack: string,
	opts: {
		removeDeleted?: boolean;
		acceptRowRemovals?: boolean;
		fetcher?: RemoteFetcher;
	} = {}
): Promise<ApplyResult | null> {
	// shares the check's queue: it ends by pruning the same shared cache, and a check running
	// alongside it would be rebuilding the very set that prune consults
	return serialised(() => runApply(pack, opts));
}

async function runApply(
	pack: string,
	opts: {
		removeDeleted?: boolean;
		acceptRowRemovals?: boolean;
		fetcher?: RemoteFetcher;
	}
): Promise<ApplyResult | null> {
	const pending = updates.pending[pack];
	if (!pending) return null;
	const repo = parseGithubRepo(pending.repo);
	if (!repo) return null;

	const res = await applyPackUpdate({
		storage: getUserStorage(),
		fetcher: opts.fetcher ?? tauriFetcher,
		repo,
		diff: pending.diff,
		removeDeleted: opts.removeDeleted === true,
		graph: content.graph,
		acceptRowRemovals: opts.acceptRowRemovals === true
	});
	if (res.error !== undefined) {
		updates.error = res.error;
		// It stopped to ask about rows disappearing from inside changed files — which is only knowable
		// once the bytes are here. Fold them into the pending entry so the panel can name them, and
		// say who they break, before the second click.
		if (res.rowRemovals !== undefined) {
			pending.removedRows = [...new Set([...pending.removedRows, ...res.rowRemovals])].sort();
			pending.affected = await whoBreaks(pending.removedRows);
		}
		return res;
	}
	// An update whose only entries are REMOVALS applies nothing unless removals were asked for.
	// Clearing it then would report success for a no-op and hide the offer until the next check
	// re-derived the very same one.
	if (res.written.length > 0 || res.removed.length > 0) {
		delete updates.pending[pack];
		forgetPending(pack);
	}
	// The staging cache is content-addressed and SHARED, so an apply must not delete entries by SHA:
	// another pending pack can be waiting on the same blob. Prune against everything still pending.
	await pruneCache(getUserStorage(), stagedShas());
	return res;
}

/**
 * Rebuild the pending set at launch from what the last check remembered — no network, no throttle,
 * no update-mode gate: this is not a check, it is reading back a conclusion we already reached.
 *
 * Without it an update found yesterday is invisible today: the repo's `ETag` answers `304` and the
 * check returns before it looks at any pack, so nothing would ever put the offer back (see
 * `PendingRemote`). Call it after the content graph is up — the impact preview reads it.
 */
export async function restorePendingUpdates(): Promise<void> {
	// No platform gate: only a check writes `pending`, and only desktop checks — so on web this loop
	// has nothing to walk. Gating anyway would just make the one function worth testing untestable.
	for (const [pack, remembered] of Object.entries(packConfig.pending)) {
		const entry = packConfig.packs[pack];
		// the pack was uninstalled, re-pointed at another repo, or frozen since we found this
		if (entry?.repo !== remembered.repo || entry.pinned === true) {
			forgetPending(pack);
			continue;
		}
		const pending = await describeUpdate(remembered.repo, { pack, files: remembered.files });
		// applied (or hand-edited) in the meantime: the disk already matches, so there is no offer
		if (pending) updates.pending[pack] = pending;
		else forgetPending(pack);
	}
}

/**
 * Undo the last applied update for one pack, from the copy the swap kept beside it. One generation
 * only — the next apply replaces it — so this is "put back what I had an hour ago", not a history.
 * Returns false when there is nothing to go back to.
 */
export async function undoUpdate(pack: string): Promise<boolean> {
	const done = await rollbackPack(getUserStorage(), pack);
	// the rolled-back files are older than the remote again, so the offer is live once more; the next
	// check re-derives it, and until then the pack simply reads as up to date
	if (done) forgetPending(pack);
	return done;
}

/** Which installed packs have a previous version on disk — drives the undo button. */
export async function rollbackablePacks(): Promise<string[]> {
	const storage = getUserStorage();
	const packs = Object.keys(packConfig.packs);
	const flags = await Promise.all(packs.map((pack) => hasRollback(storage, pack)));
	return packs.filter((_, i) => flags[i] === true);
}

/** Should the app check by itself at startup? Only when the user asked it to. */
export const autoCheckAllowed = (): boolean => packConfig.updates !== UPDATE_MODE.off;

// --- installing a NEW pack: paste a URL → see what's in it → install one -------------------------

/**
 * Ask a pasted repo URL what packs it holds. Nothing is written and nothing is registered: this is
 * the "show me first" half, and it is deliberately separate from installing, because a repo can
 * hold several packs and because a pack may carry plugins the user must see BEFORE saying yes.
 */
export async function discoverPacks(
	repo: string,
	opts: { fetcher?: RemoteFetcher } = {}
): Promise<void> {
	updates.checking = true;
	updates.error = null;
	updates.discovered = [];
	try {
		const res = await checkRepo(opts.fetcher ?? tauriFetcher, repo);
		if (res.kind === 'error') {
			updates.error = { kind: 'raw', message: res.message };
			return;
		}
		if (res.kind === 'unsupported') {
			updates.error = { kind: 'i18n', key: 'settings.packs.hostUnsupported', values: { repo } };
			return;
		}
		// `unchanged` can't happen here — a first look sends no ETag
		if (res.kind !== 'packs') return;
		// A folder name the app owns is never an installable pack, however the repo spells it —
		// `homebrew` above all, which would install straight into the user's own authoring root and
		// make "uninstall that pack" delete everything they ever wrote (`isReservedPackName`).
		updates.discovered = res.packs
			.filter((remote) => !isReservedPackName(remote.pack))
			.map((remote) => ({
				pack: remote.pack,
				repo,
				remote,
				files: remote.files.length,
				plugins: pluginsIn(remote),
				installed: packConfig.packs[remote.pack] !== undefined
			}));
		if (updates.discovered.length === 0)
			updates.error = { kind: 'i18n', key: 'settings.packs.noPacksFound', values: { repo } };
	} finally {
		updates.checking = false;
	}
}

/**
 * Install one discovered pack. Runs the SAME diff+apply path as an update — which is what makes a
 * folder that already exists locally behave correctly (hand-edited files preserved, a re-tagged
 * `#content-source` refused) instead of being blindly overwritten by a "fresh" install.
 * The registry entry is written only after the files land, so a failed install leaves no trace.
 */
export async function installPack(
	pack: string,
	opts: { fetcher?: RemoteFetcher } = {}
): Promise<ApplyResult | null> {
	const found = updates.discovered.find((d) => d.pack === pack);
	// belt-and-braces: `discoverPacks` already filtered these out, but this is the function that
	// WRITES, and a reserved name is the one input that turns an install into data loss
	if (!found || isReservedPackName(pack)) return null;
	const repo = parseGithubRepo(found.repo);
	if (!repo) return null;

	const storage = getUserStorage();
	const res = await applyPackUpdate({
		storage,
		fetcher: opts.fetcher ?? tauriFetcher,
		repo,
		diff: await diffPack(storage, found.remote)
	});
	if (res.error !== undefined) {
		updates.error = res.error;
		return res;
	}
	registerPack(pack, found.repo);
	// "I meant to delete it, stop asking" was an answer about a pack that is now BACK. Leaving the
	// flag set means deleting it a second time never prompts again — `restoreBundledPacks` already
	// clears it, and re-installing from the URL is the other way the same pack returns.
	unDismissMissing([pack]);
	updates.discovered = updates.discovered.map((d) =>
		d.pack === pack ? { ...d, installed: true } : d
	);
	return res;
}

/**
 * Uninstall a pack: delete its folder (which takes its plugins with it — they live inside it,
 * PLUGINS §2) and drop the registry entry. The shipped SRD is deliberately NOT special-cased here;
 * the caller decides, and the bundled floor re-seeds it on next launch anyway.
 */
export async function uninstallPack(pack: string): Promise<void> {
	// This deletes a folder recursively, so a reserved name reaching it is the worst outcome in the
	// module: `homebrew` here would erase everything the user ever authored. An older build could
	// have registered one before `isReservedPackName` existed — drop the entry, keep the files.
	if (isReservedPackName(pack)) {
		forgetPack(pack);
		return;
	}
	await getUserStorage().remove(`content/${pack}`);
	forgetPack(pack);
	delete updates.pending[pack];
}

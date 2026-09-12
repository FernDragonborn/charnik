/*
 * The update ORCHESTRATOR — what Settings calls, and the only place the pieces meet: the registry
 * (which packs, which repos, when last asked), the fetcher (Rust), the GitHub adapter, and the
 * diff. Everything it exposes is a user action or reads state; nothing here starts on its own.
 *
 * Desktop only. The web build serves the content of its own deploy, so there is nothing to update
 * and `checkNow` simply reports that.
 *
 * A pack ARRIVING, being renamed or leaving is the neighbouring concern, in `pack-lifecycle.ts`.
 */
import { detectPlatform, Platform, getUserStorage } from '$lib/storage/provider';
import { readCharacterFiles } from '$lib/character/repository';
import { draftEffectiveId, draftsTargeting } from '$lib/drafts/store';
import { content } from '../store.svelte';
import {
	forgetPending,
	localPackFor,
	packConfig,
	recordCheck,
	rememberPending,
	remoteNameOf,
	reposDueForCheck,
	setRepoBranch,
	UPDATE_MODE,
} from '../packs.svelte';
import { checkRepo, packSizeRefusal, type RemotePack } from './github';
import { diffPack, hasWrites, rowsRemovedBy, charactersReferencing } from './diff';
import {
	applyPackUpdate,
	hasRollback,
	isStaged,
	pluginsIn,
	pluginsTouchedBy,
	pruneCache,
	rollbackPack,
	stagePackUpdate,
	type ApplyResult,
} from './install';
import {
	updates,
	fail,
	refuse,
	clearErrors,
	serialised,
	guarded,
	guardedDisk,
	stagedShas,
	noListing,
	checkFailure,
	fetchRepo,
	type PendingUpdate,
} from './pack-update-state.svelte';
// re-exported: `updates` is the state every panel and test reads, and moving its implementation is
// no reason to move the import everyone writes (§6.1).
export { updates };
import { tauriFetcher } from './tauri-fetch';
import { MAX_PREFETCH_BYTES, type PrefetchBudget, type RemoteFetcher } from './types';

/** Which repos an AUTOMATIC check may contact right now (mode + throttle + pins). */
const dueRepos = (): string[] => reposDueForCheck(packConfig, Date.now());

/**
 * Ask the repos what they have. `manual` deliberately bypasses the once-a-day throttle and the
 * update-mode gate — "I want to test this one now" is the real use of the button; automatic runs
 * respect both. Silent on failure by design: an offline user can do nothing about it.
 */
export function checkNow(
	opts: { manual?: boolean; repo?: string; fetcher?: RemoteFetcher } = {},
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
	let repos: string[];
	if (opts.repo !== undefined) repos = [opts.repo];
	else if (opts.manual === true)
		repos = [...new Set(Object.values(packConfig.packs).map((p) => p.repo))];
	else repos = dueRepos();
	// Nothing to ask — but the cache still needs sweeping, and the prune used to sit BEHIND this
	// return. Switching from `download` back to `off` (or pinning the last pack) then left every
	// staged byte on disk forever, because the one thing that cleans them only ran after a check that
	// could no longer happen. The pending set is restored at launch, so it is authoritative here too.
	if (repos.length === 0) {
		await pruneCache(getUserStorage(), stagedShas());
		return;
	}

	updates.checking = true;
	clearErrors();
	try {
		// ONE budget for the whole run — the per-pack and per-repo caps say nothing about the total,
		// and `download` mode fetches without asking anyone
		const budget: PrefetchBudget = { left: MAX_PREFETCH_BYTES };
		for (const repo of repos) await checkOneRepo(fetcher, repo, budget);
		// the pending set is now complete, so it is also authoritative about what the pre-download
		// cache is still holding for a reason
		await pruneCache(getUserStorage(), stagedShas());
	} finally {
		updates.checking = false;
	}
}

async function checkOneRepo(
	fetcher: RemoteFetcher,
	repo: string,
	budget?: PrefetchBudget,
): Promise<void> {
	const stored = packConfig.repos[repo]?.etag;
	const res = await checkRepo(fetcher, repo, stored);
	if (noListing(res)) {
		fail(checkFailure(res, repo));
		return;
	}
	if (res.kind === 'unchanged') {
		// a 304 still counts as "asked today" — that is exactly the check we want to skip tomorrow,
		// and it certifies nothing we still have to write down
		recordCheck(repo, new Date());
		return;
	}
	setRepoBranch(repo, res.branch);

	let refused = false;
	for (const remote of res.packs) {
		// The repo only knows what IT calls this pack; the registry is keyed by the folder it lives in
		// here, which can differ (another repo may have claimed the name first). Looking the remote
		// name up directly would find the other repo's entry and compare it against the wrong URL.
		const pack = localPackFor(repo, remote.pack);
		const entry = pack === undefined ? undefined : packConfig.packs[pack];
		// only packs this user actually installed FROM THIS REPO, and not ones they froze
		if (pack === undefined || entry === undefined || entry.pinned === true) continue;
		// A pack over the size ceiling is REFUSED, not "up to date" — and the refusal must survive the
		// bookkeeping below. `describeUpdate` would raise it too, but only its caller can tell the two
		// apart, and treating them alike buried this: the offer was dropped and the ETag recorded, so
		// every later check answered 304 and the user saw the message exactly once, ever.
		const oversized = packSizeRefusal(remote);
		if (oversized) {
			fail(oversized);
			refused = true;
			continue;
		}
		const pending = await describeUpdate(repo, remote, pack);
		if (!pending) {
			delete updates.pending[pack];
			forgetPending(pack);
			continue;
		}
		// `download` mode fetches the bytes NOW so applying is instant and works offline. It is still
		// only a download: nothing under `content/` is touched until the user clicks (security.md §7).
		const parsed = fetchRepo(repo);
		if (packConfig.updates === UPDATE_MODE.download && parsed && hasWrites(pending.diff)) {
			await stagePackUpdate({
				storage: getUserStorage(),
				fetcher,
				repo: parsed,
				diff: pending.diff,
				...(budget === undefined ? {} : { budget }),
			});
			pending.staged = await isStaged(getUserStorage(), pending.diff);
		}
		updates.pending[pack] = pending;
		rememberPending(pack, { repo, files: remote.files });
	}

	/*
	 * LAST, not first. The `ETag` means "I have seen this remote state", and everything above is what
	 * that claim certifies — a diff over the whole pack, and in `download` mode the byte transfer
	 * itself. Recorded up front, a quit or a throw anywhere in that window left the claim on disk with
	 * no pending offer behind it: the next launch replays the `ETag`, gets `304`, returns before it
	 * looks at a single pack, and the update is invisible until some LATER upstream commit moves the
	 * tree again. The manual button replays it too, so nothing recovers it.
	 *
	 * This is the failure `PendingRemote` exists to prevent, one layer down. Not recording is the safe
	 * side of the trade: the repo simply stays due and the next check asks again.
	 *
	 * A pack refused for size is the same shape of claim and the same fix: `null` drops the stored
	 * ETag, so the next check re-lists the repo and refuses out loud again instead of being answered
	 * `304` before it ever looks.
	 */
	recordCheck(repo, new Date(), refused ? null : res.etag);
}

/**
 * Build the full picture for one pack, or null when it is already up to date. Deliberately
 * NETWORK-FREE — everything here is the remote file list compared against the local disk — so the
 * same function can rebuild the panel at launch from the remembered list, with no request at all.
 */
async function describeUpdate(
	repo: string,
	remote: RemotePack,
	/** the folder it occupies HERE, which the repo has no say in */
	localPack: string,
): Promise<PendingUpdate | null> {
	// Before anything downstream can fetch a byte. Both callers reach the network from here — a check
	// in `download` mode stages the whole diff immediately, and a restored offer is one click from
	// doing the same — so the count/size ceiling belongs at this fork rather than at either of them.
	const tooLarge = packSizeRefusal(remote);
	if (tooLarge) {
		fail(tooLarge);
		return null;
	}
	const storage = getUserStorage();
	const diff = await diffPack(storage, remote, localPack);
	const removals = diff.changes.filter((c) => c.kind === 'removed');
	if (!hasWrites(diff) && removals.length === 0) return null;

	const removedRows = content.graph ? rowsRemovedBy(content.graph, diff) : [];
	return {
		pack: localPack,
		repo,
		remote,
		diff,
		removedRows,
		...(await whoBreaks(removedRows)),
		plugins: pluginsIn(remote),
		pluginsChanged: pluginsTouchedBy(diff),
		staged: await isStaged(storage, diff),
	};
}

/**
 * What an update's removals would orphan. Reads what is on disk as-is — the point is to warn BEFORE
 * applying, so it must not depend on anything the update would change.
 *
 * Both halves, because both are references the user made and neither is visible from the other: a
 * saved character is scanned for the composite key it stores, and a DRAFT is matched by its target
 * row. Leaving drafts out was the quieter failure of the two — a character survives with a flagged
 * missing reference, while an unfinished translation of a deleted row has nothing left to attach to.
 */
async function whoBreaks(
	removedRows: string[],
): Promise<{ affected: { slug: string; keys: string[] }[]; affectedDrafts: string[] }> {
	if (removedRows.length === 0) return { affected: [], affectedDrafts: [] };
	const storage = getUserStorage();
	const drafts = await draftsTargeting(storage, removedRows);
	return {
		affected: charactersReferencing(await readCharacterFiles(storage), removedRows),
		affectedDrafts: drafts
			.map((d) => draftEffectiveId(d.target))
			.filter((eid): eid is string => eid !== null)
			.sort(),
	};
}

/**
 * Apply ONE pack's pending update. Always called from a click — never from `checkNow`, never on a
 * timer (security.md §7). Returns what happened; on failure nothing was written.
 */
export function applyUpdate(
	pack: string,
	opts: {
		removeDeleted?: boolean;
		acceptRowRemovals?: boolean;
		acceptSourceClaim?: boolean;
		fetcher?: RemoteFetcher;
	} = {},
): Promise<ApplyResult> {
	// shares the check's queue: it ends by pruning the same shared cache, and a check running
	// alongside it would be rebuilding the very set that prune consults
	return serialised(() => runApply(pack, opts));
}

async function runApply(
	pack: string,
	opts: {
		removeDeleted?: boolean;
		acceptRowRemovals?: boolean;
		acceptSourceClaim?: boolean;
		fetcher?: RemoteFetcher;
	},
): Promise<ApplyResult> {
	clearErrors();
	// Both refusals below used to answer `null`: the click did nothing and said nothing, which is the
	// one failure shape the user cannot see (§2.7). They are ordinary states — a second click on an
	// offer that just went away, a repo link that no longer parses — so they report like any other.
	const pending = updates.pending[pack];
	if (!pending) return refuse({ kind: 'i18n', key: 'settings.packs.applyGone', values: { pack } });
	const repo = fetchRepo(pending.repo);
	if (!repo)
		return refuse({
			kind: 'i18n',
			key: 'settings.packs.applyBadRepo',
			values: { pack, repo: pending.repo },
		});

	const res = await guarded(() =>
		applyPackUpdate({
			storage: getUserStorage(),
			fetcher: opts.fetcher ?? tauriFetcher,
			repo,
			diff: pending.diff,
			removeDeleted: opts.removeDeleted === true,
			graph: content.graph,
			acceptRowRemovals: opts.acceptRowRemovals === true,
			acceptSourceClaim: opts.acceptSourceClaim === true,
		}),
	);
	if (res.error !== undefined) {
		fail(res.error);
		// It stopped to ask about rows disappearing from inside changed files — which is only knowable
		// once the bytes are here. Fold them into the pending entry so the panel can name them, and
		// say who they break, before the second click.
		if (res.rowRemovals !== undefined) {
			pending.removedRows = [...new Set([...pending.removedRows, ...res.rowRemovals])].sort();
			Object.assign(pending, await whoBreaks(pending.removedRows));
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
export function restorePendingUpdates(): Promise<void> {
	// On the check's queue, because this is the OTHER rebuilder of `updates.pending` — and a check
	// that finishes while this is half-way through prunes the staging cache against a half-built set
	// and deletes bytes a pre-download had already fetched (see `serialised`). Startup happens to
	// sequence the two by hand today; anything else that calls `checkNow` would not.
	return serialised(runRestore);
}

async function runRestore(): Promise<void> {
	// No platform gate: only a check writes `pending`, and only desktop checks — so on web this loop
	// has nothing to walk. Gating anyway would just make the one function worth testing untestable.
	for (const [pack, remembered] of Object.entries(packConfig.pending)) {
		const entry = packConfig.packs[pack];
		// the pack was uninstalled, re-pointed at another repo, or frozen since we found this
		if (entry?.repo !== remembered.repo || entry.pinned === true) {
			forgetPending(pack);
			continue;
		}
		// the remembered listing is repo-relative, so the RemotePack it rebuilds must wear the repo's
		// name for this pack, not the folder name it happens to have here
		const pending = await describeUpdate(
			remembered.repo,
			{ pack: remoteNameOf(pack, entry), files: remembered.files },
			pack,
		);
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
	// a rollback is two renames on the real filesystem, so it can fail the way an apply can — reported
	// on the panel's error channel rather than rejecting into the button's `onclick`
	const done = await guardedDisk(false, () => rollbackPack(getUserStorage(), pack));
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

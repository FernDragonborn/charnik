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
import { revokePackPlugins } from '$lib/effects/plugin-store.svelte';
import { draftEffectiveId, draftsTargeting } from '$lib/drafts/store';
import { content } from '../store.svelte';
import {
	bundledPacks,
	forgetPack,
	forgetPending,
	freeLocalPackName,
	claimedPackName,
	isReservedPackName,
	isUsablePackFolderName,
	localPackFor,
	packConfig,
	recordCheck,
	registerPack,
	rememberPending,
	remoteNameOf,
	renamePackEntry,
	reposDueForCheck,
	setRepoBranch,
	unDismissMissing,
	UPDATE_MODE,
	type PackConfigData
} from '../packs.svelte';
import { discoverContentRoots, packNameOf } from '../disk';
import { renameFileRoot } from '../sources.svelte';
import {
	checkRepo,
	packSizeRefusal,
	packTooLarge,
	parseGithubRepo,
	type CheckResult,
	type GithubRepo,
	type RemotePack
} from './github';
import { diffPack, hasWrites, rowsRemovedBy, charactersReferencing, type PackDiff } from './diff';
import {
	applyPackUpdate,
	duringPackWrite,
	hasRollback,
	isStaged,
	pluginsIn,
	pluginsTouchedBy,
	pruneCache,
	removeStaging,
	rollbackPack,
	stagePackUpdate,
	type ApplyResult
} from './install';
import { tauriFetcher } from './tauri-fetch';
import {
	MAX_PREFETCH_BYTES,
	MAX_REPO_PACKS,
	type PrefetchBudget,
	type RemoteFetcher,
	type UpdateError
} from './types';

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
	/** …and the unfinished edits pointed at them (`type:source:id`). A draft is unsaved work with
	 *  nowhere else it is listed, so it is the reference MOST worth warning about, not the least. */
	affectedDrafts: string[];
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
	/** The branch its listing came off — `main` unless the repo turned out to live on `master`. */
	branch: string;
	remote: RemotePack;
	files: number;
	/** plugin namespaces it ships — said out loud BEFORE installing, never discovered afterwards */
	plugins: string[];
	/** already in the registry FROM THIS REPO: an update case, not an install */
	installed: boolean;
	/**
	 * The local folder it would be installed into. Its own name unless that is taken — by another
	 * repo's pack, by a folder the user copied in, or by a name the app reserves — in which case this
	 * is the suggestion (`srd-2024-2`), which the user may overrule before installing.
	 */
	localName: string;
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

/** Every blob SHA some pending update still wants; anything else in the cache is litter. */
function stagedShas(): Set<string> {
	const keep = new Set<string>();
	for (const pending of Object.values(updates.pending))
		for (const change of pending.diff.changes) if (change.sha !== undefined) keep.add(change.sha);
	return keep;
}

/** A check that came back with no listing to work from. */
type CheckFailure = Exclude<CheckResult, { kind: 'packs' } | { kind: 'unchanged' }>;
const noListing = (res: CheckResult): res is CheckFailure =>
	res.kind !== 'packs' && res.kind !== 'unchanged';

/**
 * How such a failure reads to the user. One function because BOTH callers ask it — the automatic
 * check and the paste-a-URL lookup — and a reason that only one of them explains is a reason the
 * other silently swallows. `raw` for what the network stack said, `i18n` for copy we author (see
 * {@link UpdateError}).
 */
function checkFailure(res: CheckFailure, repo: string): UpdateError {
	if (res.kind === 'error') return { kind: 'raw', message: res.message };
	if (res.kind === 'unsupported')
		return { kind: 'i18n', key: 'settings.packs.hostUnsupported', values: { repo } };
	if (res.kind === 'tooManyPacks')
		return {
			kind: 'i18n',
			key: 'settings.packs.tooManyPacks',
			values: { repo, packs: res.packs, max: MAX_REPO_PACKS }
		};
	return { kind: 'i18n', key: 'settings.packs.repoTooBig', values: { repo } };
}

async function checkOneRepo(
	fetcher: RemoteFetcher,
	repo: string,
	budget?: PrefetchBudget
): Promise<void> {
	const stored = packConfig.repos[repo]?.etag;
	const res = await checkRepo(fetcher, repo, stored);
	if (noListing(res)) {
		updates.error = checkFailure(res, repo);
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
			updates.error = oversized;
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
		// only a download: nothing under `content/` is touched until the user clicks (SECURITY.md §7).
		const parsed = fetchRepo(repo);
		if (packConfig.updates === UPDATE_MODE.download && parsed && hasWrites(pending.diff)) {
			await stagePackUpdate({
				storage: getUserStorage(),
				fetcher,
				repo: parsed,
				diff: pending.diff,
				...(budget === undefined ? {} : { budget })
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
 * The repo to FETCH from: the pasted URL, plus the branch a check actually found the tree on.
 * `parseGithubRepo` alone guesses `main`, which is wrong for every repo still on `master` — and a
 * wrong branch here doesn't fail once, it 404s every file of the download.
 */
function fetchRepo(repoUrl: string): GithubRepo | null {
	const parsed = parseGithubRepo(repoUrl);
	const branch = packConfig.repos[repoUrl]?.branch;
	return parsed !== null && branch !== undefined ? { ...parsed, branch } : parsed;
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
	localPack: string
): Promise<PendingUpdate | null> {
	// Before anything downstream can fetch a byte. Both callers reach the network from here — a check
	// in `download` mode stages the whole diff immediately, and a restored offer is one click from
	// doing the same — so the count/size ceiling belongs at this fork rather than at either of them.
	const tooLarge = packSizeRefusal(remote);
	if (tooLarge) {
		updates.error = tooLarge;
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
		staged: await isStaged(storage, diff)
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
	removedRows: string[]
): Promise<{ affected: { slug: string; keys: string[] }[]; affectedDrafts: string[] }> {
	if (removedRows.length === 0) return { affected: [], affectedDrafts: [] };
	const storage = getUserStorage();
	const drafts = await draftsTargeting(storage, removedRows);
	return {
		affected: charactersReferencing(await readCharacterFiles(storage), removedRows),
		affectedDrafts: drafts
			.map((d) => draftEffectiveId(d.target))
			.filter((eid): eid is string => eid !== null)
			.sort()
	};
}

/**
 * The disk half of an apply can THROW where the network half returns a value: a full disk, `EBUSY`
 * from a content CSV someone left open in Excel, a folder the OS refuses. Every one of those is an
 * ordinary failure the panel should state, and without this they surfaced as an unhandled rejection
 * and a silent no-op — the one shape of failure the user cannot even see.
 *
 * The disk is left consistent by `swapInNewTree`, which settles a half-done swap before rethrowing;
 * this only decides how the failure READS.
 */
async function guarded(run: () => Promise<ApplyResult>): Promise<ApplyResult> {
	try {
		return await run();
	} catch (e) {
		return {
			written: [],
			preserved: [],
			removed: [],
			error: { kind: 'raw', message: e instanceof Error ? e.message : String(e) }
		};
	}
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
		acceptSourceClaim?: boolean;
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
		acceptSourceClaim?: boolean;
		fetcher?: RemoteFetcher;
	}
): Promise<ApplyResult | null> {
	const pending = updates.pending[pack];
	if (!pending) return null;
	const repo = fetchRepo(pending.repo);
	if (!repo) return null;

	const res = await guarded(() =>
		applyPackUpdate({
			storage: getUserStorage(),
			fetcher: opts.fetcher ?? tauriFetcher,
			repo,
			diff: pending.diff,
			removeDeleted: opts.removeDeleted === true,
			graph: content.graph,
			acceptRowRemovals: opts.acceptRowRemovals === true,
			acceptSourceClaim: opts.acceptSourceClaim === true
		})
	);
	if (res.error !== undefined) {
		updates.error = res.error;
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
			pack
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
		if (noListing(res)) {
			updates.error = checkFailure(res, repo);
			return;
		}
		// `unchanged` can't happen here — a first look sends no ETag
		if (res.kind !== 'packs') return;
		// A folder name the app owns is never an installable pack, however the repo spells it —
		// `homebrew` above all, which would install straight into the user's own authoring root and
		// make "uninstall that pack" delete everything they ever wrote (`isReservedPackName`).
		// …and one that would be an unbounded download is refused here rather than half-way through it:
		// the tree is the only place the whole file list exists before the first byte is asked for.
		const oversized = res.packs.map(packSizeRefusal).find((e) => e !== null);
		if (oversized) updates.error = oversized;
		// a folder that already exists but belongs to no registry entry is still TAKEN — a pack copied
		// in by hand must not be overwritten by a stranger that happens to share its name
		const onDisk = (await discoverContentRoots(getUserStorage()).catch(() => [])).map(packNameOf);
		updates.discovered = res.packs
			.filter((remote) => !isReservedPackName(remote.pack) && packTooLarge(remote) === null)
			.map((remote) => {
				const already = localPackFor(repo, remote.pack);
				return {
					pack: remote.pack,
					repo,
					// carried rather than re-derived: nothing is registered yet, so `fetchRepo` has nowhere
					// to read it from, and the install downloads off this branch
					branch: res.branch,
					remote,
					files: remote.files.length,
					plugins: pluginsIn(remote),
					installed: already !== undefined,
					// Where it would land: its own name normally, something else when that name is already
					// somebody's. Folder names are not the publisher's to reserve, and two repos both
					// publishing `srd-2024` is a thing to resolve rather than refuse — so the second one
					// gets a suggestion the user can overrule before installing.
					localName: already ?? freeLocalPackName(remote.pack, onDisk)
				};
			});
		// "nothing here" is the wrong thing to say when we found something and refused it for size
		if (updates.discovered.length === 0 && !oversized)
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
 *
 * `pack` names it as the REPO does; `localName` is the folder it lands in here, and the two differ
 * whenever that name was already claimed. The registry then remembers both, so the next check still
 * asks the repo for the path the repo has.
 */
export async function installPack(
	pack: string,
	opts: { fetcher?: RemoteFetcher; localName?: string; acceptSourceClaim?: boolean } = {}
): Promise<ApplyResult | null> {
	const found = updates.discovered.find((d) => d.pack === pack);
	if (!found) return null;
	const typed = (opts.localName ?? found.localName).trim();
	// belt-and-braces: `discoverPacks` already filtered the remote name, but this is the function that
	// WRITES, and a reserved name is the one input that turns an install into data loss — and `local`
	// can be anything the user typed into the rename box
	if (!isUsablePackFolderName(typed)) {
		updates.error = { kind: 'i18n', key: 'settings.packs.badFolderName', values: { name: typed } };
		return null;
	}
	// …and it must not be somebody else's folder. Only the entry this repo already owns may be
	// written over; anything else is the collision the suggested name exists to step around.
	// Matched case-INSENSITIVELY, because NTFS/APFS fold case: `SRD-2024` typed beside an installed
	// `srd-2024` is the same directory, and an exact lookup calling it free is how the swap renames
	// somebody else's pack away to `.prev`.
	const ownerName = claimedPackName(typed);
	const owner = ownerName === undefined ? undefined : packConfig.packs[ownerName];
	if (owner !== undefined && localPackFor(found.repo, pack) !== ownerName) {
		updates.error = {
			kind: 'i18n',
			key: 'settings.packs.folderTaken',
			values: { name: typed, repo: owner.repo }
		};
		return null;
	}
	// our own pack under a differently-cased name is ONE folder, so write to the name the registry
	// already knows rather than minting a second entry for the same directory
	const local = ownerName ?? typed;
	const parsed = parseGithubRepo(found.repo);
	if (!parsed) return null;
	const repo: GithubRepo = { ...parsed, branch: found.branch };

	const storage = getUserStorage();
	const res = await guarded(async () =>
		applyPackUpdate({
			storage,
			fetcher: opts.fetcher ?? tauriFetcher,
			repo,
			// inside the guard too: a first install reads the disk before it writes to it
			diff: await diffPack(storage, found.remote, local),
			// …and the graph, so a pack claiming a source another pack already publishes under is
			// caught HERE — a first install is exactly when that claim gets made
			graph: content.graph,
			acceptSourceClaim: opts.acceptSourceClaim === true
		})
	);
	if (res.error !== undefined) {
		updates.error = res.error;
		return res;
	}
	registerPack(local, found.repo, pack);
	// …and how to reach it again: the next check and every later download resolve the branch through
	// the registry, not by guessing `main` off the URL a second time
	setRepoBranch(found.repo, found.branch);
	// "I meant to delete it, stop asking" was an answer about a pack that is now BACK. Leaving the
	// flag set means deleting it a second time never prompts again — `restoreBundledPacks` already
	// clears it, and re-installing from the URL is the other way the same pack returns.
	unDismissMissing([local]);
	updates.discovered = updates.discovered.map((d) =>
		d.pack === pack ? { ...d, installed: true, localName: local } : d
	);
	return res;
}

/**
 * Move a pack into a different folder, files and bookkeeping together — the way a name chosen at
 * install time (or a suggested `-2`) is corrected later without hand-editing the config.
 *
 * The folder name is the pack's identity here: it is what `content/` scanning finds and what a pin
 * names, so the entry moves with it and the repo's own name for the pack is remembered. Refuses
 * rather than merges when the destination exists — two packs in one folder is the state this whole
 * mechanism exists to prevent.
 */
export async function renamePack(from: string, to: string): Promise<boolean> {
	const target = to.trim();
	if (target === from) return true;
	if (!isUsablePackFolderName(target)) {
		updates.error = { kind: 'i18n', key: 'settings.packs.badFolderName', values: { name: to } };
		return false;
	}
	// A BUNDLED pack is identified by the folder the app ships it under and by nothing else — the seed
	// refreshes `content/<name>`, the missing-pack prompt is "the bundle has it and the disk doesn't",
	// and restore copies it back there. Moving it would leave the app reporting its own content as
	// deleted while it sits right there under another name, and offering a restore that would then
	// load every row twice.
	if (bundledPacks.packs.includes(from)) {
		updates.error = { kind: 'i18n', key: 'settings.packs.renameBundled', values: { name: from } };
		return false;
	}
	const storage = getUserStorage();
	// A case-ONLY rename (`srd-2024` → `SRD-2024`) is one folder changing its spelling, not a move
	// onto somebody else's — so neither taken-check applies to it, and both would otherwise refuse it
	// with "that folder is taken" naming the very pack being renamed.
	const caseOnly = target.toLowerCase() === from.toLowerCase();
	const claimed = claimedPackName(target);
	if (!caseOnly && (claimed !== undefined || (await storage.exists(`content/${target}`)))) {
		updates.error = {
			kind: 'i18n',
			key: 'settings.packs.folderTaken',
			values: {
				name: target,
				repo: (claimed === undefined ? undefined : packConfig.packs[claimed])?.repo ?? ''
			}
		};
		return false;
	}
	// Files and bookkeeping move under one raised flag: in between, NEITHER name has a folder, and a
	// content reload landing there would read the old one as uninstalled and drop the entry this is
	// about to rewrite — leaving a renamed folder with no repo, no pin and a `true` returned for it.
	await duringPackWrite(async () => {
		await storage.rename(`content/${from}`, `content/${target}`);
		// the kept undo copy belongs to the pack, not to the name it had — leaving it behind would make
		// `<from>.prev` look like an interrupted apply at the next launch and get promoted back
		if (await storage.exists(`content/${from}.prev`))
			await storage.rename(`content/${from}.prev`, `content/${target}.prev`);
		renamePackEntry(from, target);
		// …and the browse-config, which disables content FILES by path: leaving those behind would
		// turn every file the user had switched off back on, as a side effect of a rename
		renameFileRoot(`content/${from}`, `content/${target}`);
	});
	const pending = updates.pending[from];
	if (pending) {
		delete updates.pending[from];
		updates.pending[target] = { ...pending, pack: target, diff: { ...pending.diff, pack: target } };
	}
	return true;
}

/**
 * Uninstall a pack: revoke what its plugins were granted, delete its folder (which takes their code
 * with it — it lives inside the pack, PLUGINS §2) and drop the registry entry. The shipped SRD is
 * deliberately NOT special-cased here; the caller decides, and the bundled floor re-seeds it on next
 * launch anyway.
 *
 * The revoke belongs HERE and not in the button that used to do it: consent lives outside the data
 * dir (PLG-SEC 12), so it outlives the files, and an invariant that depends on one component calling
 * two functions in the right order is one caller away from being false. It runs BEFORE the delete,
 * while the folder is still there to say which namespaces were this pack's.
 */
export async function uninstallPack(pack: string): Promise<void> {
	// This deletes a folder recursively, so a reserved name reaching it is the worst outcome in the
	// module: `homebrew` here would erase everything the user ever authored. An older build could
	// have registered one before `isReservedPackName` existed — drop the entry, keep the files.
	// Nothing is revoked on this path either: the code stays on disk, so its permission should too.
	if (isReservedPackName(pack)) {
		forgetPack(pack);
		return;
	}
	await revokePackPlugins(pack);
	// The folder goes first and the entry second, so a reload in between sees a pack that is gone
	// and forgets it — harmless here (that is what we are doing anyway), except that it would race
	// the very write that removes it. One flag, one order, one writer.
	await duringPackWrite(async () => {
		const storage = getUserStorage();
		await storage.remove(`content/${pack}`);
		// …and the staging folders WITH it. A `<pack>.prev` left behind is not inert: startup recovery
		// reads a lone `.prev` as an apply that died between its two renames and renames it back, so an
		// uninstall that leaves one uninstalls nothing — the pack (and its plugin code) is on disk again
		// at the next launch, and only the revoke above keeps that code from running.
		await removeStaging(storage, pack);
		forgetPack(pack);
	});
	delete updates.pending[pack];
}

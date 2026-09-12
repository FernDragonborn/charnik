/*
 * The pack-update STATE and the plumbing both halves of the feature share — checking/applying and
 * install/rename/uninstall: what is pending, what failed, the one-at-a-time queue, and how a check
 * result reads to a user. Everything is exported on purpose; nothing here talks to the network.
 */
import { detectPlatform, Platform } from '$lib/storage/provider';
import { packConfig } from '../packs.svelte';
import { parseGithubRepo, type CheckResult, type GithubRepo, type RemotePack } from './github';
import type { PackDiff } from './diff';
import type { ApplyResult } from './install';
import { MAX_REPO_PACKS, type UpdateError } from './types';

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
interface DiscoveredPack {
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

export interface UpdateState {
	/** desktop-only feature; kept in the state (not computed in the component) so the dev preview at
	 *  /dev/packs can force it on in a plain browser — same trick the plugin store uses */
	supported: boolean;
	checking: boolean;
	/** pack → what is waiting for a decision */
	pending: Record<string, PendingUpdate>;
	/** what the last pasted URL turned out to hold (empty until someone pastes one) */
	discovered: DiscoveredPack[];
	/**
	 * Failures from the LAST action, in the order they happened — kept for the Settings panel, never
	 * toasted (offline is not actionable, UX-1).
	 *
	 * A list rather than a slot because one action is not one failure: a check walks every repo and
	 * every pack in it, and each of those can refuse for its own reason. With a single slot the last
	 * write silently erased the rest, so a user with three repos saw one of three problems and no
	 * sign that the others existed — the two they could not see were the ones that never got fixed.
	 */
	errors: UpdateError[];
}

export const updates = $state<UpdateState>({
	supported: detectPlatform() === Platform.Desktop,
	checking: false,
	pending: {},
	discovered: [],
	errors: [],
});

/** Record a failure. APPENDS: within one action every reason is worth saying, and the caller that
 *  starts the action is the one that clears (`clearErrors`). */
export function fail(error: UpdateError): void {
	updates.errors = [...updates.errors, error];
}

/** Start a fresh action — the previous run's reasons are no longer about anything. */
export function clearErrors(): void {
	updates.errors = [];
}

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

export function serialised<T>(run: () => Promise<T>): Promise<T> {
	// a failure must not poison the queue for everything behind it
	const next = packQueue.catch(() => {}).then(run);
	packQueue = next.catch(() => {});
	return next;
}

/** Every blob SHA some pending update still wants; anything else in the cache is litter. */
export function stagedShas(): Set<string> {
	const keep = new Set<string>();
	for (const pending of Object.values(updates.pending))
		for (const change of pending.diff.changes) if (change.sha !== undefined) keep.add(change.sha);
	return keep;
}

/** A check that came back with no listing to work from. */
export type CheckFailure = Exclude<CheckResult, { kind: 'packs' } | { kind: 'unchanged' }>;
export const noListing = (res: CheckResult): res is CheckFailure =>
	res.kind !== 'packs' && res.kind !== 'unchanged';

/**
 * How such a failure reads to the user. One function because BOTH callers ask it — the automatic
 * check and the paste-a-URL lookup — and a reason that only one of them explains is a reason the
 * other silently swallows. `raw` for what the network stack said, `i18n` for copy we author (see
 * {@link UpdateError}).
 */
export function checkFailure(res: CheckFailure, repo: string): UpdateError {
	if (res.kind === 'error') return { kind: 'raw', message: res.message };
	if (res.kind === 'unsupported')
		return { kind: 'i18n', key: 'settings.packs.hostUnsupported', values: { repo } };
	if (res.kind === 'tooManyPacks')
		return {
			kind: 'i18n',
			key: 'settings.packs.tooManyPacks',
			values: { repo, packs: res.packs, max: MAX_REPO_PACKS },
		};
	return { kind: 'i18n', key: 'settings.packs.repoTooBig', values: { repo } };
}

/**
 * The repo to FETCH from: the pasted URL, plus the branch a check actually found the tree on.
 * `parseGithubRepo` alone guesses `main`, which is wrong for every repo still on `master` — and a
 * wrong branch here doesn't fail once, it 404s every file of the download.
 */
export function fetchRepo(repoUrl: string): GithubRepo | null {
	const parsed = parseGithubRepo(repoUrl);
	const branch = packConfig.repos[repoUrl]?.branch;
	return parsed !== null && branch !== undefined ? { ...parsed, branch } : parsed;
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
export async function guarded(run: () => Promise<ApplyResult>): Promise<ApplyResult> {
	try {
		return await run();
	} catch (e) {
		return applyFailed({ kind: 'raw', message: e instanceof Error ? e.message : String(e) });
	}
}

/**
 * The same guard for the disk operations that do NOT return an `ApplyResult` — a rename, an
 * uninstall, a rollback. Each of those throws on exactly the failures `guarded` was written for, and
 * each of them was unwrapped: the rejection escaped into an `onclick`, nothing was toasted, and the
 * panel went on listing a pack whose folder no longer existed. `fallback` is what the caller is told
 * when it did not happen, so a refusal and a failure read the same way at the call site.
 */
export async function guardedDisk<T>(fallback: T, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (e) {
		fail({ kind: 'raw', message: e instanceof Error ? e.message : String(e) });
		return fallback;
	}
}

/** An apply that wrote nothing, and why. The ONE shape a refusal takes: an apply either reports what
 *  it did or reports why it did nothing — it never answers `null`, which says neither (NULL-1). */
function applyFailed(error: UpdateError): ApplyResult {
	return { written: [], preserved: [], removed: [], error };
}

/** Refuse to write, on BOTH channels at once: the panel's error list and the caller's answer. They
 *  used to disagree — several refusals reached one, some reached neither. */
export function refuse(error: UpdateError): ApplyResult {
	fail(error);
	return applyFailed(error);
}

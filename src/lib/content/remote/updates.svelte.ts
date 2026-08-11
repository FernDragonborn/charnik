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
	packConfig,
	recordCheck,
	reposDueForCheck,
	UPDATE_MODE,
	type PackConfigData
} from '../packs.svelte';
import { checkRepo, parseGithubRepo, type RemotePack } from './github';
import { diffPack, hasWrites, rowsRemovedBy, charactersReferencing, type PackDiff } from './diff';
import { applyPackUpdate, pluginsIn, type ApplyResult } from './install';
import { tauriFetcher } from './tauri-fetch';
import type { RemoteFetcher } from './types';

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
}

/**
 * A failure the panel can show. Two kinds on purpose: `i18n` is copy WE author (translatable),
 * `raw` is a message from the network stack (a machine string we must not pretend to have written).
 * Keeping them apart is what stops new untranslated English leaking into the UI — the UX-1 / ARCH-1
 * copy sweep only has to deal with keys.
 */
export type UpdateError =
	{ kind: 'i18n'; key: string; repo: string } | { kind: 'raw'; message: string };

interface UpdateState {
	/** desktop-only feature; kept in the state (not computed in the component) so the dev preview at
	 *  /dev/packs can force it on in a plain browser — same trick the plugin store uses */
	supported: boolean;
	checking: boolean;
	/** pack → what is waiting for a decision */
	pending: Record<string, PendingUpdate>;
	/** last failure, kept for the Settings panel — never toasted: offline is not actionable (UX-1) */
	error: UpdateError | null;
}

export const updates = $state<UpdateState>({
	supported: detectPlatform() === Platform.Desktop,
	checking: false,
	pending: {},
	error: null
});

/** Which repos an AUTOMATIC check may contact right now (mode + throttle + pins). */
export const dueRepos = (cfg: PackConfigData = packConfig, now = Date.now()): string[] =>
	reposDueForCheck(cfg, now);

/**
 * Ask the repos what they have. `manual` deliberately bypasses the once-a-day throttle and the
 * update-mode gate — "I want to test this one now" is the real use of the button; automatic runs
 * respect both. Silent on failure by design: an offline user can do nothing about it.
 */
export async function checkNow(
	opts: { manual?: boolean; repo?: string; fetcher?: RemoteFetcher } = {}
): Promise<void> {
	if (detectPlatform() !== Platform.Desktop) return;
	const fetcher = opts.fetcher ?? tauriFetcher;
	const repos =
		opts.repo !== undefined
			? [opts.repo]
			: opts.manual === true
				? [...new Set(Object.values(packConfig.packs).map((p) => p.repo))]
				: dueRepos();
	if (repos.length === 0) return;

	updates.checking = true;
	updates.error = null;
	try {
		for (const repo of repos) await checkOneRepo(fetcher, repo);
	} finally {
		updates.checking = false;
	}
}

async function checkOneRepo(fetcher: RemoteFetcher, repo: string): Promise<void> {
	const stored = packConfig.repos[repo]?.etag;
	const res = await checkRepo(fetcher, repo, stored);
	if (res.kind === 'error') {
		updates.error = { kind: 'raw', message: res.message };
		return;
	}
	if (res.kind === 'unsupported') {
		updates.error = { kind: 'i18n', key: 'settings.packs.hostUnsupported', repo };
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
		if (pending) updates.pending[remote.pack] = pending;
		else delete updates.pending[remote.pack];
	}
}

/** Build the full picture for one pack, or null when it is already up to date. */
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
		plugins: pluginsIn(remote)
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
export async function applyUpdate(
	pack: string,
	opts: { removeDeleted?: boolean; fetcher?: RemoteFetcher } = {}
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
		removeDeleted: opts.removeDeleted === true
	});
	if (res.error === undefined) delete updates.pending[pack];
	else updates.error = { kind: 'raw', message: res.error };
	return res;
}

/** Should the app check by itself at startup? Only when the user asked it to. */
export const autoCheckAllowed = (): boolean => packConfig.updates !== UPDATE_MODE.off;

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
	isReservedPackName,
	packConfig,
	recordCheck,
	registerPack,
	reposDueForCheck,
	UPDATE_MODE,
	type PackConfigData
} from '../packs.svelte';
import { checkRepo, parseGithubRepo, type RemotePack } from './github';
import { diffPack, hasWrites, rowsRemovedBy, charactersReferencing, type PackDiff } from './diff';
import {
	applyPackUpdate,
	isStaged,
	pluginsIn,
	pruneCache,
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
		const pending = await describeUpdate(fetcher, repo, remote);
		if (pending) updates.pending[remote.pack] = pending;
		else delete updates.pending[remote.pack];
	}
}

/** Build the full picture for one pack, or null when it is already up to date. */
async function describeUpdate(
	fetcher: RemoteFetcher,
	repo: string,
	remote: RemotePack
): Promise<PendingUpdate | null> {
	const storage = getUserStorage();
	const diff = await diffPack(storage, remote);
	const removals = diff.changes.filter((c) => c.kind === 'removed');
	if (!hasWrites(diff) && removals.length === 0) return null;

	// `download` mode fetches the bytes NOW so applying is instant and works offline. It is still
	// only a download: nothing under `content/` is touched until the user clicks (SECURITY.md §7).
	const parsed = parseGithubRepo(repo);
	if (packConfig.updates === UPDATE_MODE.download && parsed && hasWrites(diff))
		await stagePackUpdate({ storage, fetcher, repo: parsed, diff });

	const removedRows = content.graph ? rowsRemovedBy(content.graph, diff) : [];
	return {
		pack: remote.pack,
		repo,
		remote,
		diff,
		removedRows,
		affected: await whoBreaks(removedRows),
		plugins: pluginsIn(remote),
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
	else updates.error = res.error;
	return res;
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

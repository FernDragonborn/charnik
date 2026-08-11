/*
 * GitHub as a HOST ADAPTER, not as the model (REL-4 slice 2). The fetcher above takes an HTTPS URL;
 * this file is the per-host optimisation that turns `github.com/owner/repo` into the two calls that
 * make a check cheap:
 *
 *   1. ONE tree request per REPO returns every path with its blob SHA, so one round trip answers
 *      "what changed?" for every pack in it — and with an `ETag` a no-change check is a `304`,
 *      which does not count against the unauthenticated 60/hr budget at all.
 *   2. The files themselves come from `raw.githubusercontent.com`, which is not the REST API and
 *      not on that budget.
 *
 * Everything here is pure string/JSON work so it can be tested without a network. Coupling the
 * MODEL to one forge would break self-hosting, which is a stated project value — hence the split.
 */
import type { RemoteFetcher } from './types';

/** `owner/repo` parsed out of any reasonable GitHub URL the user might paste. */
export interface GithubRepo {
	owner: string;
	repo: string;
	/** Defaults to the repo's default branch when the URL doesn't say. */
	branch: string;
}

const DEFAULT_BRANCH = 'main';

/**
 * Recognise a GitHub repo URL. Deliberately narrow: anything it doesn't recognise is NOT an error,
 * it just means "no fast path for this host" — the caller falls back to a generic HTTPS fetch.
 * Accepts `https://github.com/owner/repo`, a `.git` suffix, a trailing slash, and `/tree/<branch>`.
 */
export function parseGithubRepo(url: string): GithubRepo | null {
	const u = URL.parse(url);
	if (u?.hostname !== 'github.com') return null;
	const parts = u.pathname.split('/').filter(Boolean);
	const [owner, rawRepo, kind, branch] = parts;
	if (owner === undefined || rawRepo === undefined) return null;
	const repo = rawRepo.replace(/\.git$/, '');
	if (repo === '') return null;
	return {
		owner,
		repo,
		branch: kind === 'tree' && branch !== undefined ? branch : DEFAULT_BRANCH
	};
}

/** The ONE request that answers for a whole repo. `recursive=1` returns every path in one response. */
export const treeUrl = ({ owner, repo, branch }: GithubRepo): string =>
	`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

/** Where one file's bytes live. Not the REST API, so not on the API rate budget. */
export const rawUrl = ({ owner, repo, branch }: GithubRepo, path: string): string =>
	`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

/** One remote file: its repo-relative path and the blob SHA that says whether it changed. */
export interface RemoteFile {
	path: string;
	sha: string;
}

/** A remote pack: a TOP-LEVEL folder holding content files — the same test as the local
 *  `discoverContentRoots`, applied to a tree listing instead of a directory listing. */
export interface RemotePack {
	pack: string;
	files: RemoteFile[];
}

interface TreeEntry {
	path?: unknown;
	type?: unknown;
	sha?: unknown;
}

/** A file a pack actually ships: content CSVs, plus the plugin files a pack may carry (§ PLUGINS 2). */
const isPackFile = (path: string): boolean =>
	path.endsWith('.csv') || path.endsWith('plugin.json') || path.endsWith('main.js');

/**
 * Group a GitHub tree response into packs. The rule is deliberately the same one used locally —
 * scan the TOP LEVEL for folders that contain content — so a third-party author can publish one
 * repo holding several packs and nothing new has to be declared anywhere.
 *
 * Unparseable JSON, a truncated tree, or a tree with no packs all yield `[]`: a repo that says
 * nothing useful is not an error the user can act on.
 */
export function packsFromTree(json: string): RemotePack[] {
	let entries: unknown;
	try {
		entries = (JSON.parse(json) as { tree?: unknown }).tree;
	} catch {
		return [];
	}
	if (!Array.isArray(entries)) return [];

	const byPack = new Map<string, RemoteFile[]>();
	for (const raw of entries as TreeEntry[]) {
		const { path, type, sha } = raw;
		if (typeof path !== 'string' || typeof sha !== 'string' || type !== 'blob') continue;
		if (!isPackFile(path)) continue;
		const [pack, ...rest] = path.split('/');
		// a file at the repo root belongs to no pack (README, LICENSE); a pack needs a folder
		if (pack === undefined || rest.length === 0) continue;
		const list = byPack.get(pack) ?? [];
		list.push({ path, sha });
		byPack.set(pack, list);
	}
	return [...byPack.entries()]
		.map(([pack, files]) => ({ pack, files: files.sort((a, b) => a.path.localeCompare(b.path)) }))
		.sort((a, b) => a.pack.localeCompare(b.pack));
}

/** What a check found. `unchanged` is the `304` path — free, and the common one. */
export type CheckResult =
	| { kind: 'packs'; packs: RemotePack[]; etag?: string }
	| { kind: 'unchanged' }
	| { kind: 'unsupported' } // not a host we have a fast path for
	| { kind: 'error'; message: string };

/**
 * Ask ONE repo what it holds. Sends the stored `ETag`, so an unchanged repo answers `304` and the
 * whole check costs nothing. Never throws: offline is a value the caller can ignore quietly.
 */
export async function checkRepo(
	fetcher: RemoteFetcher,
	repoUrl: string,
	etag?: string
): Promise<CheckResult> {
	const repo = parseGithubRepo(repoUrl);
	if (!repo) return { kind: 'unsupported' };
	const res = await fetcher.getText(treeUrl(repo), etag);
	if (res.kind === 'notModified') return { kind: 'unchanged' };
	if (res.kind === 'error') return { kind: 'error', message: res.message };
	const packs = packsFromTree(res.body);
	return res.etag === undefined
		? { kind: 'packs', packs }
		: { kind: 'packs', packs, etag: res.etag };
}

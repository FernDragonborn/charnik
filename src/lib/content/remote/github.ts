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
 *
 * ponytail: GitHub is RUNG ONE of content distribution, not the whole ladder — and today it is the
 * only rung that exists. There is no generic-HTTPS fallback behind `unsupported`: the reachable
 * hosts are pinned in `src-tauri/capabilities/default.json` (api.github.com + raw.githubusercontent),
 * a capability is compiled in, and widening it wholesale would hand any pasted URL the network. The
 * next rung is a per-host user grant (paste URL → "allow this host?" → stored allow-list checked in
 * Rust), at which point the `unsupported` branch grows a real fallback. That rung is **PLAN ANY-HOST-PACKAGE-DISTRIBUTION**,
 * scheduled for much later and deliberately not a tail of REL-4. Until then this file is the fast
 * path AND the only path — deliberately.
 */
import {
	MAX_PACK_BYTES,
	MAX_PACK_FILES,
	MAX_REPO_PACKS,
	type RemoteFetcher,
	type UpdateError,
} from './types';

/** `owner/repo` parsed out of any reasonable GitHub URL the user might paste. */
export interface GithubRepo {
	owner: string;
	repo: string;
	/** Defaults to the repo's default branch when the URL doesn't say. */
	branch: string;
}

const DEFAULT_BRANCH = 'main';
/** Tried when the URL named no branch and `main` isn't there — an older repo keeps its default on
 *  `master`, and for a feature whose whole point is "somebody ELSE publishes content" that is the
 *  primary failure path, surfacing today as an opaque `Not Found` on every check forever. */
const FALLBACK_BRANCH = 'master';

/**
 * Recognise a GitHub repo URL. Deliberately narrow; anything it doesn't recognise yields
 * `unsupported`, which today the callers surface as "GitHub only" (see the ladder note above).
 * Accepts `https://github.com/owner/repo`, a `.git` suffix, a trailing slash, and `/tree/<branch>`.
 */
export function parseGithubRepo(url: string): GithubRepo | null {
	const u = URL.parse(url);
	// `www.` because that is what some browsers put in the address bar, and the URL a user pastes is
	// the one they copied from there
	if (u?.hostname !== 'github.com' && u?.hostname !== 'www.github.com') return null;
	const parts = u.pathname.split('/').filter(Boolean);
	const [owner, rawRepo, kind] = parts;
	if (owner === undefined || rawRepo === undefined) return null;
	const repo = rawRepo.replace(/\.git$/, '');
	if (repo === '') return null;
	const rest = kind === 'tree' ? parts.slice(3) : [];
	return { owner, repo, branch: rest.join('/') || DEFAULT_BRANCH };
}

/**
 * The branches a URL could have meant, most specific first.
 *
 * `/tree/<...>` is ambiguous and the URL cannot resolve it: `tree/feature/x` is a branch called
 * `feature/x` — slashes in branch names are ordinary — and `tree/main/srd-2024` is the branch `main`
 * plus a folder inside it, which is what you get by clicking a directory on github.com. Both are
 * URLs a user will paste, and taking the first segment (what we did) turned every slashed branch
 * into a 404 on every file, forever, explained as "Not Found".
 *
 * So try the whole thing, then progressively shorter prefixes, and let the repo say which one
 * exists. Costs nothing in the common case — the first candidate is the answer — and only the
 * FAILING path pays for the rest.
 */
function branchCandidates(repo: GithubRepo): string[] {
	const parts = repo.branch.split('/');
	const nested = parts.map((_, i) => parts.slice(0, parts.length - i).join('/'));
	// a URL that named no branch is a GUESS, and the guess is wrong for every repo still on `master`
	return repo.branch === DEFAULT_BRANCH ? [DEFAULT_BRANCH, FALLBACK_BRANCH] : nested;
}

/** The ONE request that answers for a whole repo. `recursive=1` returns every path in one response.
 *  A branch containing slashes goes in AS IS, not percent-encoded: both hosts resolve the ref
 *  greedily across path segments, and `raw` below does not decode `%2F` — so encoding it would turn
 *  `feature/packs` into a ref no server has. */
export const treeUrl = ({ owner, repo, branch }: GithubRepo): string =>
	`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

/** Where one file's bytes live. Not the REST API, so not on the API rate budget. */
export const rawUrl = ({ owner, repo, branch }: GithubRepo, path: string): string =>
	`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

/** One remote file: its repo-relative path and the blob SHA that says whether it changed. */
interface RemoteFile {
	path: string;
	sha: string;
	/** Byte length, as the tree listing states it. Optional because a REMEMBERED listing (read back
	 *  from the registry after a restart) carries only what identifies a file, and because a future
	 *  non-GitHub adapter may not know sizes before downloading. */
	size?: number;
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
	size?: unknown;
}

/**
 * Executable code, in the ONE layout that means anything: `<pack>/plugins/<namespace>/main.js`
 * beside its `plugin.json` (PLUGINS §2). Anywhere else — a `main.js` at the pack root, one nested
 * under `plugins/ns/vendor/` — nothing loads it and nothing discloses it, so installing it was
 * writing a script onto the user's disk that no screen in the app would ever mention.
 */
const PLUGIN_FILE = /(^|\/)plugins\/[^/]+\/(plugin\.json|main\.js)$/;

/** A file a pack actually ships: content CSVs, plus the plugin files a pack may carry (§ PLUGINS 2).
 *  The DIFF applies the same test to the local side, so a file the pack format doesn't cover — a
 *  README, a leftover from an older layout, notes the user keeps beside the data — is never
 *  proposed for deletion just because the remote doesn't list it. */
export const isPackFile = (path: string): boolean =>
	path.endsWith('.csv') || PLUGIN_FILE.test(path);

/**
 * Group a GitHub tree response into packs. The rule is deliberately the same one used locally —
 * scan the TOP LEVEL for folders that contain content — so a third-party author can publish one
 * repo holding several packs and nothing new has to be declared anywhere.
 *
 * Unparseable JSON or a tree with no packs yields `[]`: a repo that says nothing useful is not an
 * error the user can act on.
 *
 * **`truncated` is carried out rather than ignored**, because an incomplete listing is not a small
 * version of a complete one: `diffPack` reads "local file the remote doesn't list" as `removed`, so
 * a partial tree manufactures removals for files that are alive upstream — and with `removeDeleted`
 * that deletes real content. GitHub cuts the response at ~7 MB / 100k entries and still answers
 * `200`, and `MAX_REMOTE_BYTES` (8 MB) sits ABOVE that, so nothing else in the stack would notice.
 */
export function packsFromTree(json: string): { packs: RemotePack[]; truncated: boolean } {
	let parsed: { tree?: unknown; truncated?: unknown };
	try {
		parsed = JSON.parse(json) as { tree?: unknown; truncated?: unknown };
	} catch {
		return { packs: [], truncated: false };
	}
	const truncated = parsed.truncated === true;
	const entries: unknown = parsed.tree;
	if (!Array.isArray(entries)) return { packs: [], truncated };

	const byPack = new Map<string, RemoteFile[]>();
	for (const raw of entries as TreeEntry[]) {
		const { path, type, sha, size } = raw;
		if (typeof path !== 'string' || typeof sha !== 'string' || type !== 'blob') continue;
		if (!isPackFile(path)) continue;
		const [pack, ...rest] = path.split('/');
		// a file at the repo root belongs to no pack (README, LICENSE); a pack needs a folder
		if (pack === undefined || rest.length === 0) continue;
		const list = byPack.get(pack) ?? [];
		list.push(typeof size === 'number' ? { path, sha, size } : { path, sha });
		byPack.set(pack, list);
	}
	return {
		packs: [...byPack.entries()]
			.map(([pack, files]) => ({ pack, files: files.sort((a, b) => a.path.localeCompare(b.path)) }))
			.sort((a, b) => a.pack.localeCompare(b.pack)),
		truncated,
	};
}

/**
 * Is this pack too big to touch? Answered from the TREE — the listing that arrives in one request,
 * states every path and size, and is the last thing we see before the first file is asked for.
 *
 * That timing is the whole point. `MAX_REMOTE_BYTES` bounds one response, so fifty thousand small
 * files clear it fifty thousand times over, and `download` mode fetches without asking anyone. The
 * only moment to refuse a runaway repo is while it is still a list.
 *
 * A file whose size the listing didn't state counts as zero rather than blocking the pack: the count
 * cap still applies, and the per-response cap is still there behind it. Refusing on missing metadata
 * would break every future adapter that has a file list but no sizes.
 */
export function packTooLarge(remote: RemotePack): { files: number; bytes: number } | null {
	const files = remote.files.length;
	const bytes = remote.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
	return files > MAX_PACK_FILES || bytes > MAX_PACK_BYTES ? { files, bytes } : null;
}

/** The refusal as the UI states it: which pack, how big it is, and what the ceiling was. */
export function packSizeRefusal(remote: RemotePack): UpdateError | null {
	const over = packTooLarge(remote);
	return over === null
		? null
		: {
				kind: 'i18n',
				key: 'settings.packs.packTooLarge',
				values: {
					pack: remote.pack,
					files: over.files,
					mb: Math.ceil(over.bytes / (1024 * 1024)),
					maxFiles: MAX_PACK_FILES,
					maxMb: MAX_PACK_BYTES / (1024 * 1024),
				},
			};
}

/** What a check found. `unchanged` is the `304` path — free, and the common one. `branch` says which
 *  branch the listing actually came off, so the file downloads that follow ask the same one. */
export type CheckResult =
	| { kind: 'packs'; packs: RemotePack[]; branch: string; etag?: string }
	| { kind: 'unchanged' }
	| { kind: 'unsupported' } // not a host we have a fast path for
	| { kind: 'truncated' } // the repo is too big for one listing — see `packsFromTree`
	| { kind: 'tooManyPacks'; packs: number } // …or too many packs to walk — see `MAX_REPO_PACKS`
	| { kind: 'error'; message: string };

/**
 * Ask ONE repo what it holds. Sends the stored `ETag`, so an unchanged repo answers `304` and the
 * whole check costs nothing. Never throws: offline is a value the caller can ignore quietly.
 */
export async function checkRepo(
	fetcher: RemoteFetcher,
	repoUrl: string,
	etag?: string,
): Promise<CheckResult> {
	const repo = parseGithubRepo(repoUrl);
	if (!repo) return { kind: 'unsupported' };
	// Each candidate is tried ONLY when the one before it 404s, so the ordinary URL costs one request
	// and nothing else changes. Both fallbacks — `main`→`master` for a URL that named no branch, and
	// the shorter prefixes of one that named a slashed path — are the same "ask which exists" step.
	const candidates = branchCandidates(repo);
	let branch = candidates[0] ?? DEFAULT_BRANCH;
	let res = await fetcher.getText(treeUrl({ ...repo, branch }), etag);
	for (const next of candidates.slice(1)) {
		if (!(res.kind === 'error' && res.status === 404)) break;
		branch = next;
		res = await fetcher.getText(treeUrl({ ...repo, branch }), etag);
	}
	if (res.kind === 'notModified') return { kind: 'unchanged' };
	if (res.kind === 'error') return { kind: 'error', message: res.message };
	const { packs, truncated } = packsFromTree(res.body);
	if (truncated) return { kind: 'truncated' };
	// Refused as a whole rather than trimmed to the first fifty: which packs a repo offers is not
	// ours to pick, and the caller would then diff and list a silently partial repo.
	if (packs.length > MAX_REPO_PACKS) return { kind: 'tooManyPacks', packs: packs.length };
	return res.etag === undefined
		? { kind: 'packs', packs, branch }
		: { kind: 'packs', packs, branch, etag: res.etag };
}

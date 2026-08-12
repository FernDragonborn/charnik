/*
 * REL-4 slice 2 — the GitHub adapter, driven through a FAKE fetcher (the real one is an HTTP client
 * in Rust and has no place in a unit test). What's pinned here is what a wrong answer costs: the
 * URLs we call, the "a pack is a top-level folder" rule applied to a tree listing, and the 304 path
 * that keeps steady-state checking free.
 */
import { describe, it, expect } from 'vitest';
import {
	parseGithubRepo,
	treeUrl,
	rawUrl,
	packsFromTree,
	packSizeRefusal,
	packTooLarge,
	checkRepo,
	type GithubRepo,
	type RemotePack
} from './github';
import {
	MAX_PACK_BYTES,
	MAX_PACK_FILES,
	MAX_REPO_PACKS,
	type RemoteFetcher,
	type FetchResult
} from './types';

const REPO: GithubRepo = { owner: 'FernDragonborn', repo: 'charnik-content-srd', branch: 'main' };

const fakeFetcher = (text: FetchResult): RemoteFetcher => ({
	getText: async () => text,
	getBytes: async () => ({ kind: 'error', message: 'not used' })
});

const tree = (paths: [string, string][]) =>
	JSON.stringify({ tree: paths.map(([path, sha]) => ({ path, sha, type: 'blob' })) });

describe('parseGithubRepo', () => {
	it.each([
		['https://github.com/FernDragonborn/charnik-content-srd', 'main'],
		['https://github.com/FernDragonborn/charnik-content-srd.git', 'main'],
		['https://github.com/FernDragonborn/charnik-content-srd/', 'main'],
		['https://github.com/FernDragonborn/charnik-content-srd/tree/dev', 'dev']
	])('%s → branch %s', (url, branch) => {
		expect(parseGithubRepo(url)).toEqual({ ...REPO, branch });
	});
	it('a non-GitHub or malformed URL is not an error, just no fast path', () => {
		expect(parseGithubRepo('https://example.com/packs')).toBeNull();
		expect(parseGithubRepo('https://github.com/FernDragonborn')).toBeNull();
		expect(parseGithubRepo('not a url')).toBeNull();
	});
});

describe('the two URLs', () => {
	it('ONE tree request answers for the whole repo', () => {
		expect(treeUrl(REPO)).toBe(
			'https://api.github.com/repos/FernDragonborn/charnik-content-srd/git/trees/main?recursive=1'
		);
	});
	it('files come from raw. — not the API, so not on its rate budget', () => {
		expect(rawUrl(REPO, 'srd-2024/spells_srd.csv')).toBe(
			'https://raw.githubusercontent.com/FernDragonborn/charnik-content-srd/main/srd-2024/spells_srd.csv'
		);
	});
});

describe('packsFromTree — a pack is a TOP-LEVEL folder, same rule as locally', () => {
	it('groups files under their pack folder, sorted and deterministic', () => {
		const { packs } = packsFromTree(
			tree([
				['srd-2024/spells_srd.csv', 'aaa'],
				['srd-2014/items_srd.csv', 'bbb'],
				['srd-2024/items_srd.csv', 'ccc']
			])
		);
		expect(packs.map((p) => p.pack)).toEqual(['srd-2014', 'srd-2024']);
		expect(packs[1]?.files.map((f) => f.path)).toEqual([
			'srd-2024/items_srd.csv',
			'srd-2024/spells_srd.csv'
		]);
		expect(packs[1]?.files[0]?.sha).toBe('ccc');
	});
	it('root files belong to no pack (README, LICENSE) and folders are not files', () => {
		const json = JSON.stringify({
			tree: [
				{ path: 'README.md', sha: 'x', type: 'blob' },
				{ path: 'LICENSE', sha: 'y', type: 'blob' },
				{ path: 'srd-2024', sha: 'z', type: 'tree' },
				{ path: 'srd-2024/spells_srd.csv', sha: 'w', type: 'blob' }
			]
		});
		expect(packsFromTree(json).packs).toEqual([
			{ pack: 'srd-2024', files: [{ path: 'srd-2024/spells_srd.csv', sha: 'w' }] }
		]);
	});
	it('a pack may ship plugin files too (PLUGINS §2) — they are part of the same unit', () => {
		const { packs } = packsFromTree(
			tree([
				['dark-sun/plugins/my-homebrew/plugin.json', 'a'],
				['dark-sun/plugins/my-homebrew/main.js', 'b']
			])
		);
		expect(packs[0]?.pack).toBe('dark-sun');
		expect(packs[0]?.files).toHaveLength(2);
	});
	/* `<pack>/plugins/<ns>/` is the only layout that means anything: it is what the loader loads and
	   what the installer discloses. A `main.js` anywhere else would be installed as executable code
	   the app never mentions and never runs — a script written to the user's disk for nothing. */
	it('takes plugin code only where a plugin actually lives', () => {
		const { packs } = packsFromTree(
			tree([
				['dark-sun/main.js', 'a'],
				['dark-sun/plugins/ns/vendor/main.js', 'b'],
				['dark-sun/plugins/ns/main.js', 'c'],
				['dark-sun/spells.csv', 'd']
			])
		);
		expect(packs[0]?.files.map((f) => f.path)).toEqual([
			'dark-sun/plugins/ns/main.js',
			'dark-sun/spells.csv'
		]);
	});

	it('garbage in → empty, never a throw at startup', () => {
		expect(packsFromTree('{oops').packs).toEqual([]);
		expect(packsFromTree('{}').packs).toEqual([]);
		expect(packsFromTree(JSON.stringify({ tree: 'nope' })).packs).toEqual([]);
	});
});

/* `MAX_REMOTE_BYTES` bounds one RESPONSE, so fifty thousand small files clear it fifty thousand
   times over — and `download` mode fetches without asking. The tree is the only moment a runaway
   repo is still just a list. */
describe('a pack too big to download is refused off the tree, before the first byte', () => {
	const sized = (count: number, size: number): RemotePack => ({
		pack: 'huge',
		files: Array.from({ length: count }, (_, i) => ({ path: `huge/${i}.csv`, sha: `${i}`, size }))
	});

	it('passes a pack the size of the one we ship', () => {
		expect(packTooLarge(sized(15, 150_000))).toBeNull();
	});

	it('refuses on file COUNT even when every file is tiny', () => {
		expect(packTooLarge(sized(MAX_PACK_FILES + 1, 1))).toEqual({
			files: MAX_PACK_FILES + 1,
			bytes: MAX_PACK_FILES + 1
		});
	});

	it('refuses on total BYTES even when there are few files', () => {
		expect(packTooLarge(sized(3, MAX_PACK_BYTES))?.files).toBe(3);
	});

	it('counts an unstated size as zero — a listing without sizes still gets the count cap', () => {
		const noSizes: RemotePack = { pack: 'p', files: [{ path: 'p/a.csv', sha: 'a' }] };
		expect(packTooLarge(noSizes)).toBeNull();
		expect(packSizeRefusal(noSizes)).toBeNull();
	});

	it('says which pack, how big, and what the ceiling was', () => {
		expect(packSizeRefusal(sized(4, 20 * 1024 * 1024))).toEqual({
			kind: 'i18n',
			key: 'settings.packs.packTooLarge',
			values: { pack: 'huge', files: 4, mb: 80, maxFiles: MAX_PACK_FILES, maxMb: 50 }
		});
	});

	it('the tree carries the sizes through, so the cap has something to read', () => {
		const json = JSON.stringify({
			tree: [{ path: 'p/a.csv', sha: 'a', type: 'blob', size: 4096 }]
		});
		expect(packsFromTree(json).packs[0]?.files[0]?.size).toBe(4096);
	});
});

describe('checkRepo', () => {
	it('a 304 is "unchanged" — the free steady state', async () => {
		const res = await checkRepo(
			fakeFetcher({ kind: 'notModified' }),
			'https://github.com/a/b',
			'W/"1"'
		);
		expect(res).toEqual({ kind: 'unchanged' });
	});
	it('carries the new ETag out, so the next check can be free too', async () => {
		const res = await checkRepo(
			fakeFetcher({ kind: 'ok', body: tree([['srd-2024/spells_srd.csv', 'a']]), etag: 'W/"2"' }),
			'https://github.com/a/b'
		);
		expect(res).toEqual({
			kind: 'packs',
			etag: 'W/"2"',
			branch: 'main',
			packs: [{ pack: 'srd-2024', files: [{ path: 'srd-2024/spells_srd.csv', sha: 'a' }] }]
		});
	});
	it('a non-GitHub URL is "unsupported", not an error the user must act on', async () => {
		expect(await checkRepo(fakeFetcher({ kind: 'notModified' }), 'https://example.com/x')).toEqual({
			kind: 'unsupported'
		});
	});
	it('offline surfaces as a value, never a throw', async () => {
		const res = await checkRepo(
			fakeFetcher({ kind: 'error', message: 'network unreachable' }),
			'https://github.com/a/b'
		);
		expect(res).toEqual({ kind: 'error', message: 'network unreachable' });
	});
});

/* GitHub cuts a tree at ~7 MB / 100k entries and still answers 200. `MAX_REMOTE_BYTES` is 8 MB, so
   the response sails through — and `diffPack` reads every unlisted local file as `removed`. Half a
   list must therefore never reach the diff at all. */
describe('a truncated listing is refused, not used', () => {
	const big = (paths: [string, string][]) =>
		JSON.stringify({
			truncated: true,
			tree: paths.map(([path, sha]) => ({ path, sha, type: 'blob' }))
		});

	it('says so instead of returning the part it got', async () => {
		const res = await checkRepo(
			fakeFetcher({ kind: 'ok', body: big([['srd-2024/spells_srd.csv', 'a']]), etag: 'W/"1"' }),
			'https://github.com/a/b'
		);
		expect(res).toEqual({ kind: 'truncated' });
	});

	it('parses the packs anyway — the flag is what the caller must not ignore', () => {
		const { packs, truncated } = packsFromTree(big([['srd-2024/spells_srd.csv', 'a']]));
		expect(truncated).toBe(true);
		expect(packs).toHaveLength(1);
	});

	it('an ordinary tree is not truncated', () => {
		expect(packsFromTree(tree([['p/a.csv', 'a']])).truncated).toBe(false);
	});
});

/* The per-PACK caps are applied pack by pack, so a repo of a thousand tiny folders passes every one
   of them and still asks the app to diff a thousand packs against the disk and list them all. */
describe('a repo with more packs than we will walk', () => {
	const manyPacks = (count: number) =>
		tree(Array.from({ length: count }, (_, i): [string, string] => [`pack-${i}/a.csv`, `${i}`]));

	it('is refused as a whole, and says how many it had', async () => {
		const res = await checkRepo(
			fakeFetcher({ kind: 'ok', body: manyPacks(MAX_REPO_PACKS + 1), etag: 'W/"1"' }),
			'https://github.com/a/b'
		);
		expect(res).toEqual({ kind: 'tooManyPacks', packs: MAX_REPO_PACKS + 1 });
	});

	it('a repo at the ceiling still works — this is a runaway guard, not a policy', async () => {
		const res = await checkRepo(
			fakeFetcher({ kind: 'ok', body: manyPacks(MAX_REPO_PACKS), etag: 'W/"1"' }),
			'https://github.com/a/b'
		);
		expect(res).toMatchObject({ kind: 'packs' });
	});
});

/* A pasted URL without `/tree/<branch>` is a GUESS, and it is wrong for every repo still on
   `master` — which today 404s on every check forever, with `Not Found` as the whole explanation. */
describe('the branch we guessed is not the branch the repo has', () => {
	const answering = (ok: string): RemoteFetcher => ({
		getText: async (url) =>
			url.includes(`/${ok}?`)
				? { kind: 'ok', body: tree([['srd-2024/spells_srd.csv', 'a']]) }
				: { kind: 'error', status: 404, message: 'Not Found' },
		getBytes: async () => ({ kind: 'error', message: 'not used' })
	});

	it('falls back to master on a 404 and says which branch answered', async () => {
		const res = await checkRepo(answering('master'), 'https://github.com/a/b');
		expect(res).toMatchObject({ kind: 'packs', branch: 'master' });
	});

	it('does not second-guess a branch the USER named', async () => {
		const res = await checkRepo(answering('master'), 'https://github.com/a/b/tree/dev');
		expect(res).toEqual({ kind: 'error', message: 'Not Found' });
	});

	it('a 404 that is not about the branch still surfaces once main is tried', async () => {
		const res = await checkRepo(answering('nothing-matches'), 'https://github.com/a/b');
		expect(res).toEqual({ kind: 'error', message: 'Not Found' });
	});
});

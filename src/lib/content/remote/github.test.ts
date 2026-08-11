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
	checkRepo,
	type GithubRepo
} from './github';
import type { RemoteFetcher, FetchResult } from './types';

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
		const packs = packsFromTree(
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
		expect(packsFromTree(json)).toEqual([
			{ pack: 'srd-2024', files: [{ path: 'srd-2024/spells_srd.csv', sha: 'w' }] }
		]);
	});
	it('a pack may ship plugin files too (PLUGINS §2) — they are part of the same unit', () => {
		const packs = packsFromTree(
			tree([
				['dark-sun/plugins/my-homebrew/plugin.json', 'a'],
				['dark-sun/plugins/my-homebrew/main.js', 'b']
			])
		);
		expect(packs[0]?.pack).toBe('dark-sun');
		expect(packs[0]?.files).toHaveLength(2);
	});
	it('garbage in → empty, never a throw at startup', () => {
		expect(packsFromTree('{oops')).toEqual([]);
		expect(packsFromTree('{}')).toEqual([]);
		expect(packsFromTree(JSON.stringify({ tree: 'nope' }))).toEqual([]);
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

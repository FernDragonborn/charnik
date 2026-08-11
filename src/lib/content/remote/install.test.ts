/*
 * REL-4 slice 3 — diff and apply, over MemoryStorage and a fake fetcher. The properties worth
 * pinning are the ones that would cost a user real data: a hand-edited file is never overwritten,
 * a failed download writes NOTHING, and a removal is reported (with its blast radius) rather than
 * silently applied.
 */
import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { hashBody } from '../hash';
import { diffPack, gitBlobSha, rowsRemovedBy, charactersReferencing, FILE_CHANGE } from './diff';
import { applyPackUpdate, pluginsIn } from './install';
import type { RemotePack } from './github';
import type { RemoteFetcher } from './types';
import type { ContentGraph, LoadedRow } from '../loader';

const REPO = { owner: 'o', repo: 'r', branch: 'main' };
const enc = (s: string) => new TextEncoder().encode(s);

/** A shipped file exactly as the app writes one: body + a matching `#content-hash` (no drift). */
async function shippedFile(body: string): Promise<string> {
	return `#content-source: Test\n#content-hash: ${await hashBody(body)}\n${body}`;
}

const fetcherOf = (files: Record<string, string>): RemoteFetcher => ({
	getText: async () => ({ kind: 'error', message: 'not used' }),
	getBytes: async (url) => {
		const hit = Object.entries(files).find(([path]) => url.endsWith(path));
		return hit ? { kind: 'ok', bytes: enc(hit[1]) } : { kind: 'error', message: `404 ${url}` };
	}
});

describe('gitBlobSha', () => {
	it("matches git's own object id, so a tree listing can be compared without downloading", async () => {
		// `printf 'hello' | git hash-object --stdin`
		expect(await gitBlobSha(enc('hello'))).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
	});
});

describe('diffPack', () => {
	it('classifies added / changed / unchanged / removed', async () => {
		const s = new MemoryStorage();
		const same = await shippedFile('id\nsame');
		await s.writeBytes('content/p/same.csv', enc(same));
		await s.writeBytes('content/p/old.csv', enc(await shippedFile('id\nold')));
		await s.writeBytes('content/p/gone.csv', enc(await shippedFile('id\ngone')));
		const remote: RemotePack = {
			pack: 'p',
			files: [
				{ path: 'p/same.csv', sha: await gitBlobSha(enc(same)) },
				{ path: 'p/old.csv', sha: 'different-sha' },
				{ path: 'p/new.csv', sha: 'whatever' }
			]
		};
		const diff = await diffPack(s, remote);
		expect(diff.changes).toEqual(
			expect.arrayContaining([
				{ path: 'p/old.csv', kind: FILE_CHANGE.changed },
				{ path: 'p/new.csv', kind: FILE_CHANGE.added },
				{ path: 'p/gone.csv', kind: FILE_CHANGE.removed }
			])
		);
		// an unchanged file produces no entry at all
		expect(diff.changes.some((c) => c.path === 'p/same.csv')).toBe(false);
	});

	it('a HAND-EDITED file is preserved, never listed as changed (the REL-3 rule, reused)', async () => {
		const s = new MemoryStorage();
		// body no longer matches its own recorded hash → the user edited it
		await s.writeBytes('content/p/mine.csv', enc('#content-hash: xxh64:stale\nid\nMY EDIT'));
		const diff = await diffPack(s, {
			pack: 'p',
			files: [{ path: 'p/mine.csv', sha: 'upstream' }]
		});
		expect(diff.changes).toEqual([{ path: 'p/mine.csv', kind: FILE_CHANGE.preserved }]);
	});
});

describe('applyPackUpdate', () => {
	const diff = {
		pack: 'p',
		changes: [
			{ path: 'p/a.csv', kind: FILE_CHANGE.added },
			{ path: 'p/b.csv', kind: FILE_CHANGE.changed }
		]
	};

	it('writes every file, byte for byte', async () => {
		const s = new MemoryStorage();
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\na', 'p/b.csv': 'id\nb' }),
			repo: REPO,
			diff
		});
		expect(res.error).toBeUndefined();
		expect(res.written).toEqual(['p/a.csv', 'p/b.csv']);
		expect(await s.read('content/p/b.csv')).toBe('id\nb');
	});

	it('ALL-OR-NOTHING: a download that fails halfway leaves the disk untouched', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/b.csv', enc('id\nOLD BUT INTACT'));
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\na' }), // b.csv 404s
			repo: REPO,
			diff
		});
		expect(res.error).toMatch(/b\.csv/);
		expect(res.written).toEqual([]);
		expect(await s.exists('content/p/a.csv')).toBe(false); // the one that DID download
		expect(await s.read('content/p/b.csv')).toBe('id\nOLD BUT INTACT');
	});

	it('a removal is only applied when explicitly asked for', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/gone.csv', enc('id\ngone'));
		const withRemoval = {
			pack: 'p',
			changes: [{ path: 'p/gone.csv', kind: FILE_CHANGE.removed }]
		};
		const args = { storage: s, fetcher: fetcherOf({}), repo: REPO, diff: withRemoval };
		const kept = await applyPackUpdate(args);
		expect(kept.removed).toEqual([]);
		expect(await s.exists('content/p/gone.csv')).toBe(true);

		const dropped = await applyPackUpdate({ ...args, removeDeleted: true });
		expect(dropped.removed).toEqual(['p/gone.csv']);
		expect(await s.exists('content/p/gone.csv')).toBe(false);
	});
});

describe('the impact preview — what a removal would break', () => {
	const row = (file: string, id: string): LoadedRow =>
		({ root: 'content/p', file, type: 'class', source: 'SRD 5.2.1', id }) as LoadedRow;
	const graph = {
		rows: [row('gone.csv', 'barbarian'), row('stays.csv', 'bard')]
	} as ContentGraph;

	it('lists the rows that would disappear, keyed as a character references them', () => {
		const diff = { pack: 'p', changes: [{ path: 'p/gone.csv', kind: FILE_CHANGE.removed }] };
		expect(rowsRemovedBy(graph, diff)).toEqual(['class:SRD 5.2.1:barbarian']);
	});
	it('no removals → nothing to warn about', () => {
		expect(
			rowsRemovedBy(graph, { pack: 'p', changes: [{ path: 'p/x.csv', kind: FILE_CHANGE.added }] })
		).toEqual([]);
	});
	it('names the characters that reference them, and only those', () => {
		const characters = [
			{ slug: 'grog', json: '{"build":{"classes":[{"class":"class:SRD 5.2.1:barbarian"}]}}' },
			{ slug: 'scanlan', json: '{"build":{"classes":[{"class":"class:SRD 5.2.1:bard"}]}}' }
		];
		expect(charactersReferencing(characters, ['class:SRD 5.2.1:barbarian'])).toEqual([
			{ slug: 'grog', keys: ['class:SRD 5.2.1:barbarian'] }
		]);
	});
	it('a longer id that merely CONTAINS the key is not a match (quoted comparison)', () => {
		const characters = [{ slug: 'x', json: '{"c":"class:SRD 5.2.1:barbarian-variant"}' }];
		expect(charactersReferencing(characters, ['class:SRD 5.2.1:barbarian'])).toEqual([]);
	});
});

describe('pluginsIn — the installer must disclose code before installing', () => {
	it('finds the namespaces a pack would add', () => {
		expect(
			pluginsIn({
				pack: 'dark-sun',
				files: [
					{ path: 'dark-sun/items_srd.csv', sha: 'a' },
					{ path: 'dark-sun/plugins/my-homebrew/main.js', sha: 'b' },
					{ path: 'dark-sun/plugins/my-homebrew/plugin.json', sha: 'c' },
					{ path: 'dark-sun/plugins/other/main.js', sha: 'd' }
				]
			})
		).toEqual(['my-homebrew', 'other']);
	});
	it('a data-only pack ships no code', () => {
		expect(pluginsIn({ pack: 'p', files: [{ path: 'p/a.csv', sha: 'x' }] })).toEqual([]);
	});
});

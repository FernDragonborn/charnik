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
import {
	applyPackUpdate,
	cachePath,
	isStaged,
	pluginsIn,
	pruneCache,
	stagePackUpdate
} from './install';
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
				{ path: 'p/old.csv', kind: FILE_CHANGE.changed, sha: 'different-sha' },
				{ path: 'p/new.csv', kind: FILE_CHANGE.added, sha: 'whatever' },
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
		expect(diff.changes).toEqual([
			{ path: 'p/mine.csv', kind: FILE_CHANGE.preserved, sha: 'upstream' }
		]);
	});

	it("never proposes deleting a file the pack format doesn't cover — it isn't the update's", async () => {
		// a README, notes the user keeps beside the data, a leftover from an older layout
		const s = new MemoryStorage();
		await s.writeBytes('content/p/NOTES.md', enc('my house rules'));
		expect((await diffPack(s, { pack: 'p', files: [] })).changes).toEqual([]);
	});

	it('notices a plugin file the pack no longer ships — code, nested two levels down', async () => {
		// a pack's plugins live in `plugins/<ns>/`; a flat listing would leave deleted executable code
		// sitting on disk forever
		const s = new MemoryStorage();
		await s.writeBytes('content/p/plugins/old-rules/main.js', enc('globalThis.x = 1;'));
		const diff = await diffPack(s, { pack: 'p', files: [] });
		expect(diff.changes).toEqual([
			{ path: 'p/plugins/old-rules/main.js', kind: FILE_CHANGE.removed }
		]);
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
		expect(res.error).toEqual({ kind: 'raw', message: expect.stringMatching(/b\.csv/) });
		expect(res.written).toEqual([]);
		expect(await s.exists('content/p/a.csv')).toBe(false); // the one that DID download
		expect(await s.read('content/p/b.csv')).toBe('id\nOLD BUT INTACT');
	});

	it('REFUSES a pack that re-tags its #content-source — that is a new pack, not an update', async () => {
		// identity is `source:id`, so applying this would rename every row at once and every
		// character reference into the pack would resolve to nothing
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('#content-source: Old Name\nid\na'));
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({
				'p/a.csv': '#content-source: New Name\nid\na',
				'p/b.csv': '#content-source: New Name\nid\nb'
			}),
			repo: REPO,
			diff
		});
		expect(res.error).toEqual({
			kind: 'i18n',
			key: 'settings.packs.sourceChanged',
			values: { pack: 'p', from: 'Old Name', to: 'New Name' }
		});
		expect(res.written).toEqual([]);
		expect(await s.read('content/p/a.csv')).toContain('Old Name'); // untouched
		expect(await s.exists('content/p/b.csv')).toBe(false);
	});

	it('the same source tag applies normally — the check must not block ordinary updates', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('#content-source: Same\nid\nold'));
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({
				'p/a.csv': '#content-source: Same\nid\nnew',
				'p/b.csv': '#content-source: Same\nid\nb'
			}),
			repo: REPO,
			diff
		});
		expect(res.error).toBeUndefined();
		expect(res.written).toEqual(['p/a.csv', 'p/b.csv']);
	});

	it('a FRESH install has no local source to clash with, so it proceeds', async () => {
		const s = new MemoryStorage();
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({
				'p/a.csv': '#content-source: Brand New\nid\na',
				'p/b.csv': '#content-source: Brand New\nid\nb'
			}),
			repo: REPO,
			diff
		});
		expect(res.error).toBeUndefined();
		expect(res.written).toHaveLength(2);
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

/** "Check and pre-download" only means anything if the bytes it fetched are still there, and still
 *  the right bytes, when the user finally clicks Apply — possibly offline, possibly next week. */
describe('the pre-download staging cache', () => {
	const bodyA = 'id\na';
	const offline: RemoteFetcher = {
		getText: async () => ({ kind: 'error', message: 'offline' }),
		getBytes: async () => ({ kind: 'error', message: 'offline' })
	};
	const stagedDiff = async () => ({
		pack: 'p',
		changes: [{ path: 'p/a.csv', kind: FILE_CHANGE.added, sha: await gitBlobSha(enc(bodyA)) }]
	});

	it('a staged update applies with NO network at all', async () => {
		const s = new MemoryStorage();
		const diff = await stagedDiff();
		await stagePackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': bodyA }),
			repo: REPO,
			diff
		});
		expect(await isStaged(s, diff)).toBe(true);

		const res = await applyPackUpdate({ storage: s, fetcher: offline, repo: REPO, diff });
		expect(res.error).toBeUndefined();
		expect(await s.read('content/p/a.csv')).toBe(bodyA);
		// applied ⇒ the staged copy is now just a duplicate of what is on disk
		expect(await isStaged(s, diff)).toBe(false);
	});

	it('a cache entry whose bytes do not match its name is a MISS, not a shortcut', async () => {
		const s = new MemoryStorage();
		const diff = await stagedDiff();
		const sha = diff.changes[0]?.sha ?? '';
		await s.writeBytes(cachePath(sha), enc('id\nTRUNCATED'));

		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': bodyA }),
			repo: REPO,
			diff
		});
		expect(res.error).toBeUndefined();
		expect(await s.read('content/p/a.csv')).toBe(bodyA); // re-fetched, not the corrupt copy
	});

	it('bytes that do not match the SHA we diffed against are refused, not written', async () => {
		// raw.githubusercontent.com serving a different revision than the tree listing did: writing it
		// would leave content whose SHA still differs, i.e. an update that never stops reappearing
		const s = new MemoryStorage();
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\nSOMETHING ELSE' }),
			repo: REPO,
			diff: await stagedDiff()
		});
		expect(res.error).toEqual({
			kind: 'i18n',
			key: 'settings.packs.contentMoved',
			values: { path: 'p/a.csv' }
		});
		expect(await s.exists('content/p/a.csv')).toBe(false);
	});

	it('prune keeps what is still pending and drops the rest', async () => {
		const s = new MemoryStorage();
		await s.writeBytes(cachePath('keep-me'), enc('x'));
		await s.writeBytes(cachePath('stale'), enc('y'));
		await pruneCache(s, new Set(['keep-me']));
		expect(await s.exists(cachePath('keep-me'))).toBe(true);
		expect(await s.exists(cachePath('stale'))).toBe(false);
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

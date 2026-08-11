/*
 * REL-4 — the install flow end to end over the real Storage seam (IndexedDB via fake-indexeddb) and
 * an injected fetcher. The pieces below are unit-tested elsewhere; what this pins is the GLUE that
 * can silently be wrong: that looking up a URL doesn't write anything, that a successful install is
 * what puts the pack in the registry (and a failed one leaves no trace), and that uninstalling
 * takes both the files and the entry.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { getUserStorage } from '$lib/storage/provider';
import { packConfig, emptyPackConfig } from '../packs.svelte';
import {
	updates,
	checkNow,
	discoverPacks,
	installPack,
	restorePendingUpdates,
	uninstallPack
} from './updates.svelte';
import { gitBlobSha } from './diff';
import { stampWithHash } from '../hash';
import type { RemoteFetcher } from './types';

const REPO = 'https://github.com/someone/dark-sun';
const enc = (s: string) => new TextEncoder().encode(s);

/** A CSV exactly as a pack ships one: body + a matching `#content-hash`. It has to be stamped, or
 *  the overwrite guard can't verify it and (rightly) refuses to touch it — see `diffPack`. */
const ALL = {
	'dark-sun/classes_srd.csv': await stampWithHash(
		new Map([['source', 'Dark Sun']]),
		'id\nathasian'
	),
	'dark-sun/plugins/dark-sun-rules/main.js': 'globalThis.handlers = {};',
	'dark-sun/plugins/dark-sun-rules/plugin.json': '{"api":1}'
};

/** The tree always advertises the whole pack (that is what the repo holds); which files the fetcher
 *  can actually serve is what a test varies. The SHAs are REAL git blob ids of the bodies below,
 *  because apply verifies every downloaded byte against them — as GitHub's own tree does. */
let tree = '';
beforeAll(async () => {
	tree = JSON.stringify({
		tree: await Promise.all(
			Object.entries(ALL).map(async ([path, body]) => ({
				path,
				sha: await gitBlobSha(enc(body)),
				type: 'blob'
			}))
		)
	});
});

/** The same listing a check would have remembered: every file with its real blob SHA. `csvMoved`
 *  puts one file at a SHA the disk doesn't have — i.e. upstream changed it since we installed. */
async function remoteFiles({ csvMoved = false } = {}): Promise<{ path: string; sha: string }[]> {
	return Promise.all(
		Object.entries(ALL).map(async ([path, body]) => ({
			path,
			sha: csvMoved && path.endsWith('.csv') ? 'f'.repeat(40) : await gitBlobSha(enc(body))
		}))
	);
}

const fetcher = (files: Record<string, string>): RemoteFetcher => ({
	getText: async () => ({ kind: 'ok', body: tree, etag: 'W/"1"' }),
	getBytes: async (url) => {
		const hit = Object.entries(files).find(([path]) => url.endsWith(path));
		return hit ? { kind: 'ok', bytes: enc(hit[1]) } : { kind: 'error', message: `404 ${url}` };
	}
});

describe('install a pack from a pasted URL', () => {
	beforeEach(async () => {
		Object.assign(packConfig, emptyPackConfig());
		updates.discovered = [];
		updates.error = null;
		await getUserStorage().remove('content/dark-sun');
	});

	it('looking up a URL only LOOKS — nothing installed, nothing written', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		expect(updates.discovered.map((d) => d.pack)).toEqual(['dark-sun']);
		expect(updates.discovered[0]?.installed).toBe(false);
		// the code it carries is disclosed BEFORE the user commits to anything
		expect(updates.discovered[0]?.plugins).toEqual(['dark-sun-rules']);
		expect(packConfig.packs).toEqual({});
		expect(await getUserStorage().exists('content/dark-sun/classes_srd.csv')).toBe(false);
	});

	it('installing writes the files AND registers the pack against its repo', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		const res = await installPack('dark-sun', { fetcher: fetcher(ALL) });
		expect(res?.error).toBeUndefined();
		expect(await getUserStorage().read('content/dark-sun/classes_srd.csv')).toContain('athasian');
		// a pack's plugins ride inside it (PLUGINS §2) — they land in the same folder
		expect(await getUserStorage().exists('content/dark-sun/plugins/dark-sun-rules/main.js')).toBe(
			true
		);
		expect(packConfig.packs['dark-sun']?.repo).toBe(REPO);
		expect(updates.discovered[0]?.installed).toBe(true);
	});

	it('a failed install leaves NO registry entry — half-installed is worse than not installed', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		const partial = { 'dark-sun/classes_srd.csv': ALL['dark-sun/classes_srd.csv'] }; // plugin files 404
		const res = await installPack('dark-sun', { fetcher: fetcher(partial) });
		expect(res?.error).toBeDefined();
		expect(packConfig.packs['dark-sun']).toBeUndefined();
		expect(await getUserStorage().exists('content/dark-sun/classes_srd.csv')).toBe(false);
	});

	/* The failure this pins: the ETag is recorded when the repo answers, so a relaunch replays it,
	   gets a 304 and returns before it looks at any pack. If the pending set only lived in memory,
	   an update found today was invisible tomorrow — and nothing brought it back, not even the
	   manual button, until some later upstream commit changed the tree again. */
	it('an update found before a restart is still offered after one', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		// what the check remembered: the whole remote listing, with the CSV at a SHA the disk lacks
		packConfig.pending['dark-sun'] = { repo: REPO, files: await remoteFiles({ csvMoved: true }) };
		updates.pending = {}; // a fresh process: memory knows nothing

		await restorePendingUpdates();

		expect(updates.pending['dark-sun']?.diff.changes).toMatchObject([
			{ path: 'dark-sun/classes_srd.csv', kind: 'changed', sha: 'f'.repeat(40) }
		]);
	});

	it('drops a remembered update the disk already satisfies — no phantom offer', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		packConfig.pending['dark-sun'] = { repo: REPO, files: await remoteFiles() };
		updates.pending = {};

		await restorePendingUpdates();

		expect(updates.pending['dark-sun']).toBeUndefined();
		expect(packConfig.pending['dark-sun']).toBeUndefined(); // and it stops being remembered
	});

	it('drops it for a pack the user has since frozen — a pin is not "ask me again later"', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		packConfig.packs['dark-sun'] = { repo: REPO, pinned: true };
		packConfig.pending['dark-sun'] = { repo: REPO, files: await remoteFiles({ csvMoved: true }) };
		updates.pending = {};

		await restorePendingUpdates();

		expect(updates.pending['dark-sun']).toBeUndefined();
		expect(packConfig.pending['dark-sun']).toBeUndefined();
	});

	it('uninstalling removes the folder and forgets the entry', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		await uninstallPack('dark-sun');
		expect(packConfig.packs['dark-sun']).toBeUndefined();
		expect(await getUserStorage().exists('content/dark-sun/classes_srd.csv')).toBe(false);
		// the repo's check state goes too, once nothing uses it
		expect(packConfig.repos[REPO]).toBeUndefined();
	});

	it('re-installing clears "stop asking" — deleting it a second time must prompt again', async () => {
		packConfig.dismissedMissing = ['dark-sun'];
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		expect(packConfig.dismissedMissing).toEqual([]);
	});
});

describe('the check runs alone', () => {
	beforeAll(() => {
		// `checkNow` is desktop-gated, and desktop is "a window carrying Tauri's marker". The storage
		// seam is already resolved (to IndexedDB) by the block above and cached, so planting the marker
		// now reaches the platform gate and nothing else.
		getUserStorage();
		Object.assign(globalThis, { window: { __TAURI_INTERNALS__: {} } });
	});
	afterAll(() => {
		Reflect.deleteProperty(globalThis, 'window');
	});
	beforeEach(() => {
		Object.assign(packConfig, emptyPackConfig());
		updates.pending = {};
	});

	/* Both a check and an apply finish by pruning the shared pre-download cache against
	   `updates.pending`, which is only authoritative once nothing is mid-way through rebuilding it.
	   Overlapping runs mean the first to finish prunes against a half-built set. */
	it('a second check waits for the first instead of interleaving with it', async () => {
		packConfig.packs['dark-sun'] = { repo: REPO };
		const log: string[] = [];
		let n = 0;
		const slow: RemoteFetcher = {
			getText: async () => {
				const id = ++n;
				log.push(`start ${id}`);
				await new Promise((r) => setTimeout(r, 5));
				log.push(`end ${id}`);
				return { kind: 'ok', body: tree, etag: 'W/"1"' };
			},
			getBytes: async () => ({ kind: 'error', message: 'not asked' })
		};

		await Promise.all([
			checkNow({ manual: true, fetcher: slow }),
			checkNow({ manual: true, fetcher: slow })
		]);

		expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
	});

	/* The prune used to sit BEHIND the "nothing is due" return, so bytes staged in `download` mode
	   and then abandoned (mode switched to `off`, or the last pack pinned) stayed on disk forever —
	   the one thing that cleans them only ran after a check that could no longer happen. */
	it('sweeps the pre-download cache even when there is nothing to check', async () => {
		await getUserStorage().writeBytes('.pack-cache/deadbeef', enc('bytes nobody is waiting for'));
		await checkNow(); // automatic, mode `off` → no repo is due
		expect(await getUserStorage().exists('.pack-cache/deadbeef')).toBe(false);
	});
});

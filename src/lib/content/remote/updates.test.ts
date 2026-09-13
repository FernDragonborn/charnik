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
import { packConfig, emptyPackConfig, UPDATE_MODE } from '../packs.svelte';
import { updates, checkNow, restorePendingUpdates } from './updates.svelte';
// one suite across both halves on purpose: what it pins is the GLUE between them
import { discoverPacks, installPack, renamePack, uninstallPack } from './pack-lifecycle';
import { gitBlobSha } from './diff';
import { discoverContentRoots } from '../disk';
import { forgetUninstalledPacks } from '../provider';
import { sourceConfig, toggleFile } from '../sources.svelte';
import { stampWithHash } from '../hash';
import { MAX_PACK_FILES, type RemoteFetcher } from './types';

const REPO = 'https://github.com/someone/dark-sun';
const enc = (s: string) => new TextEncoder().encode(s);

/** A CSV exactly as a pack ships one: body + a matching `#content-hash`. It has to be stamped, or
 *  the overwrite guard can't verify it and (rightly) refuses to touch it — see `diffPack`. */
const ALL = {
	'dark-sun/classes_srd.csv': await stampWithHash(
		new Map([['source', 'Dark Sun']]),
		'id\nathasian',
	),
	'dark-sun/plugins/dark-sun-rules/main.js': 'globalThis.handlers = {};',
	'dark-sun/plugins/dark-sun-rules/plugin.json': '{"api":1}',
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
				type: 'blob',
			})),
		),
	});
});

/** The same listing a check would have remembered: every file with its real blob SHA. `csvMoved`
 *  puts one file at a SHA the disk doesn't have — i.e. upstream changed it since we installed. */
async function remoteFiles({ csvMoved = false } = {}): Promise<{ path: string; sha: string }[]> {
	return Promise.all(
		Object.entries(ALL).map(async ([path, body]) => ({
			path,
			sha: csvMoved && path.endsWith('.csv') ? 'f'.repeat(40) : await gitBlobSha(enc(body)),
		})),
	);
}

const fetcher = (files: Record<string, string>): RemoteFetcher => ({
	getText: async () => ({ kind: 'ok', body: tree, etag: 'W/"1"' }),
	getBytes: async (url) => {
		const hit = Object.entries(files).find(([path]) => url.endsWith(path));
		return hit ? { kind: 'ok', bytes: enc(hit[1]) } : { kind: 'error', message: `404 ${url}` };
	},
});

describe('install a pack from a pasted URL', () => {
	beforeEach(async () => {
		Object.assign(packConfig, emptyPackConfig());
		updates.discovered = [];
		updates.errors = [];
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
			true,
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
			{ path: 'dark-sun/classes_srd.csv', kind: 'changed', sha: 'f'.repeat(40) },
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

/* Folder names are not the publisher's to reserve: two repos can both publish `dark-sun`, and the
   registry keyed by folder name alone let the second silently re-point the first's entry — so one
   repo's files landed in the other repo's folder and every later check compared the wrong pair. */
describe('two repos publishing the same folder name', () => {
	const OTHER = 'https://github.com/rival/dark-sun';

	beforeEach(async () => {
		Object.assign(packConfig, emptyPackConfig());
		updates.discovered = [];
		updates.errors = [];
		updates.pending = {};
		await getUserStorage().remove('content/dark-sun');
		await getUserStorage().remove('content/dark-sun-2');
	});

	it('the second one is offered a folder beside the first, not on top of it', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });

		await discoverPacks(OTHER, { fetcher: fetcher(ALL) });

		// same pack name, and the app has already decided where it can go
		expect(updates.discovered[0]).toMatchObject({ pack: 'dark-sun', installed: false });
		expect(updates.discovered[0]?.localName).toBe('dark-sun-2');
	});

	it('installs into that folder and remembers what the repo calls it', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		await discoverPacks(OTHER, { fetcher: fetcher(ALL) });

		const res = await installPack('dark-sun', { fetcher: fetcher(ALL) });

		expect(res?.error).toBeUndefined();
		// both packs exist, each under its own folder, each pointing at its own repo
		expect(packConfig.packs['dark-sun']).toEqual({ repo: REPO });
		expect(packConfig.packs['dark-sun-2']).toEqual({ repo: OTHER, remotePack: 'dark-sun' });
		expect(await getUserStorage().read('content/dark-sun-2/classes_srd.csv')).toContain('athasian');
		// …including the plugin two levels down, which the fetch asks for by its REPO path
		expect(await getUserStorage().exists('content/dark-sun-2/plugins/dark-sun-rules/main.js')).toBe(
			true,
		);
	});

	it('refuses a folder name the user types over somebody else’s pack', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		await discoverPacks(OTHER, { fetcher: fetcher(ALL) });

		const res = await installPack('dark-sun', { fetcher: fetcher(ALL), localName: 'dark-sun' });

		// NULL-1: a refusal REPORTS — nothing written, and a reason the panel can show
		expect(res.written).toEqual([]);
		expect(res.error).toMatchObject({ key: 'settings.packs.folderTaken' });
		expect(packConfig.packs['dark-sun']?.repo).toBe(REPO); // still the first repo's
	});

	/* A folder can exist with NO registry entry — the user copied one in by hand. `renamePack` and
	   the suggested name both ask the disk; the typed-in install name asked only the registry, so it
	   ran the diff against a stranger's folder and swapped it away to `.prev`. */
	it('refuses a folder name the registry does not claim but the DISK holds', async () => {
		await getUserStorage().write('content/handmade/classes_srd.csv', 'id\nmine');
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });

		const res = await installPack('dark-sun', { fetcher: fetcher(ALL), localName: 'handmade' });

		expect(res.written).toEqual([]);
		expect(res.error).toMatchObject({ key: 'settings.packs.folderTaken' });
		expect(packConfig.packs['handmade']).toBeUndefined();
		expect(await getUserStorage().read('content/handmade/classes_srd.csv')).toContain('mine');
		await getUserStorage().remove('content/handmade');
	});

	it('a check asks the repo for ITS name and offers the update against OUR folder', async () => {
		await discoverPacks(OTHER, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL), localName: 'dark-sun-2' });
		// upstream moved the CSV; the remembered listing is repo-relative (`dark-sun/…`)
		packConfig.pending['dark-sun-2'] = {
			repo: OTHER,
			files: await remoteFiles({ csvMoved: true }),
		};

		await restorePendingUpdates();

		expect(updates.pending['dark-sun-2']?.diff).toMatchObject({
			pack: 'dark-sun-2',
			changes: [{ path: 'dark-sun/classes_srd.csv', kind: 'changed' }],
		});
	});

	it('renaming moves the files and the entry together, and remembers the repo’s name', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });

		expect(await renamePack('dark-sun', 'athas')).toBe(true);

		expect(packConfig.packs['dark-sun']).toBeUndefined();
		expect(packConfig.packs['athas']).toEqual({ repo: REPO, remotePack: 'dark-sun' });
		expect(await getUserStorage().read('content/athas/classes_srd.csv')).toContain('athasian');
		expect(await getUserStorage().exists('content/dark-sun/classes_srd.csv')).toBe(false);
	});

	/* The window this closes: between `rename` and `renamePackEntry` the OLD folder is gone and the
	   new one has no entry, and the watcher's debounced reload rebuilds the graph right there. It
	   concluded "uninstalled", dropped the entry — repo URL, pin and all — and the rename then wrote
	   nothing and still reported success. */
	it('survives a content reload landing mid-rename, when neither folder is a whole pack', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		const storage = getUserStorage();
		await storage.remove('content/athas'); // an earlier rename in this block left one behind
		const realRename = storage.rename.bind(storage);
		storage.rename = async (from: string, to: string) => {
			await realRename(from, to);
			forgetUninstalledPacks(await discoverContentRoots(storage));
		};

		try {
			expect(await renamePack('dark-sun', 'athas')).toBe(true);
		} finally {
			storage.rename = realRename;
		}

		expect(packConfig.packs['athas']).toEqual({ repo: REPO, remotePack: 'dark-sun' });
		expect(await getUserStorage().read('content/athas/classes_srd.csv')).toContain('athasian');
	});

	/* The browse-config disables content FILES by path, so it is the fourth thing keyed by the folder
	   name — and the one nobody moved. A rename switched every file the user had turned off back on. */
	it('carries the user’s per-file toggles across a rename', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		await getUserStorage().remove('content/athas');
		sourceConfig.disabledFiles = [];
		toggleFile('content/dark-sun/classes_srd.csv');

		expect(await renamePack('dark-sun', 'athas')).toBe(true);

		expect(sourceConfig.disabledFiles).toEqual(['content/athas/classes_srd.csv']);
	});

	it('renaming refuses a name that is already a folder, rather than merging two packs', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		await getUserStorage().writeBytes('content/athas/notes.txt', enc('mine'));

		expect(await renamePack('dark-sun', 'athas')).toBe(false);
		expect(packConfig.packs['dark-sun']?.repo).toBe(REPO);
		await getUserStorage().remove('content/athas');
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
			getBytes: async () => ({ kind: 'error', message: 'not asked' }),
		};

		await Promise.all([
			checkNow({ manual: true, fetcher: slow }),
			checkNow({ manual: true, fetcher: slow }),
		]);

		expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
	});

	/* The ETag means "I have seen this remote state", and what makes that claim true is the pending
	   offer written from it. Recorded FIRST, a check that died in between (a quit, or a throw from
	   the pre-download it does in `download` mode) left the claim on disk with nothing behind it: the
	   next launch replays the ETag, gets a 304, and returns before it looks at a single pack. The
	   update is then invisible until some later upstream commit moves the tree — the exact failure
	   `PendingRemote` exists to prevent, one layer down. */
	it('does not claim to have seen a repo whose packs it never got through', async () => {
		packConfig.packs['dark-sun'] = { repo: REPO };
		packConfig.updates = UPDATE_MODE.download; // …so the check itself reaches the network for bytes
		const movedTree = JSON.stringify({
			tree: (await remoteFiles({ csvMoved: true })).map((f) => ({ ...f, type: 'blob' })),
		});
		const diesMidDownload: RemoteFetcher = {
			getText: async () => ({ kind: 'ok', body: movedTree, etag: 'W/"9"' }),
			getBytes: async () => {
				throw new Error('killed mid pre-download');
			},
		};

		await expect(checkNow({ manual: true, fetcher: diesMidDownload })).rejects.toThrow();

		expect(packConfig.repos[REPO]?.etag).toBeUndefined();
		expect(packConfig.repos[REPO]?.lastCheckedAt).toBeUndefined();
		expect(packConfig.pending['dark-sun']).toBeUndefined();
	});

	it('records it once the packs ARE through, so tomorrow is free', async () => {
		packConfig.packs['dark-sun'] = { repo: REPO };
		await checkNow({ manual: true, fetcher: fetcher(ALL) });
		expect(packConfig.repos[REPO]?.etag).toBe('W/"1"');
		expect(packConfig.repos[REPO]?.lastCheckedAt).toBeDefined();
	});

	/* A pack over the size ceiling is refused — but the refusal was recorded alongside the ETag that
	   says "I have seen this remote state", so every later check answered 304 and returned before it
	   looked at a pack. The user was told once, ever, and the pack quietly stopped updating. */
	it('does not bury a pack it refused for size behind an ETag', async () => {
		packConfig.packs['dark-sun'] = { repo: REPO };
		packConfig.repos[REPO] = { etag: 'W/"from an earlier, smaller version"' };
		const huge = JSON.stringify({
			tree: Array.from({ length: MAX_PACK_FILES + 1 }, (_, i) => ({
				path: `dark-sun/f${i}.csv`,
				sha: `${i}`.padStart(40, '0'),
				type: 'blob',
				size: 10,
			})),
		});
		const serving: RemoteFetcher = {
			getText: async () => ({ kind: 'ok', body: huge, etag: 'W/"huge"' }),
			getBytes: async () => ({ kind: 'error', message: 'never asked — it was refused' }),
		};

		await checkNow({ manual: true, fetcher: serving });

		expect(updates.errors).toMatchObject([{ key: 'settings.packs.packTooLarge' }]);
		// neither the new ETag nor the stale one: the next check must re-list and refuse out loud again
		expect(packConfig.repos[REPO]?.etag).toBeUndefined();
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

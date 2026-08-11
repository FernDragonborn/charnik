/*
 * REL-4 — the install flow end to end over the real Storage seam (IndexedDB via fake-indexeddb) and
 * an injected fetcher. The pieces below are unit-tested elsewhere; what this pins is the GLUE that
 * can silently be wrong: that looking up a URL doesn't write anything, that a successful install is
 * what puts the pack in the registry (and a failed one leaves no trace), and that uninstalling
 * takes both the files and the entry.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getUserStorage } from '$lib/storage/provider';
import { packConfig, emptyPackConfig } from '../packs.svelte';
import { updates, discoverPacks, installPack, uninstallPack } from './updates.svelte';
import { gitBlobSha } from './diff';
import type { RemoteFetcher } from './types';

const REPO = 'https://github.com/someone/dark-sun';
const enc = (s: string) => new TextEncoder().encode(s);

const ALL = {
	'dark-sun/classes_srd.csv': '#content-source: Dark Sun\nid\nathasian',
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

	it('uninstalling removes the folder and forgets the entry', async () => {
		await discoverPacks(REPO, { fetcher: fetcher(ALL) });
		await installPack('dark-sun', { fetcher: fetcher(ALL) });
		await uninstallPack('dark-sun');
		expect(packConfig.packs['dark-sun']).toBeUndefined();
		expect(await getUserStorage().exists('content/dark-sun/classes_srd.csv')).toBe(false);
		// the repo's check state goes too, once nothing uses it
		expect(packConfig.repos[REPO]).toBeUndefined();
	});
});

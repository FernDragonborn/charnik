/*
 * PLG-2 host tests — discovery over the Storage seam (MemoryStorage), strict manifest validation,
 * the length-prefixed consent hash (§6.3), and the runnability gate (consent × enable × kill
 * switch). No sandbox involved — this is the trust plumbing around it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import {
	discoverPlugins,
	consentHash,
	isRunnable,
	emptyPrefs,
	loadPluginPrefs,
	savePluginPrefs,
	pluginManifestSchema,
	type DiscoveredPlugin
} from './plugin-host';

const MANIFEST = {
	api: 1,
	namespace: 'my-homebrew',
	name: 'My Homebrew Helpers',
	version: '1.0.0',
	author: 'Jane Doe',
	url: 'https://example.com/repo',
	description: 'Test plugin.'
};
const MAIN = `globalThis.handlers = { f: { passive() { return {}; } } };`;

async function seeded(over?: { manifest?: object; code?: string; namespace?: string }) {
	const s = new MemoryStorage();
	const namespace = over?.namespace ?? 'my-homebrew';
	await s.mkdir(`plugins/${namespace}`);
	await s.write(`plugins/${namespace}/plugin.json`, JSON.stringify(over?.manifest ?? MANIFEST));
	await s.write(`plugins/${namespace}/main.js`, over?.code ?? MAIN);
	return s;
}

describe('discoverPlugins', () => {
	it('no plugins dir → empty, never throws', async () => {
		expect(await discoverPlugins(new MemoryStorage())).toEqual([]);
	});
	it('a valid folder discovers with manifest + code + consent hash', async () => {
		const [p] = await discoverPlugins(await seeded());
		expect(p?.ok).toBe(true);
		expect(p?.manifest?.name).toBe('My Homebrew Helpers');
		expect(p?.code).toBe(MAIN);
		expect(p?.hash).toMatch(/^[0-9a-f]{64}$/);
	});
	it.each([
		['bad namespace folder name', { namespace: 'My-Homebrew' }, /namespace/],
		[
			'manifest namespace ≠ folder',
			{ manifest: { ...MANIFEST, namespace: 'other-ns' } },
			/folder name/
		],
		['unknown manifest key', { manifest: { ...MANIFEST, extra: 1 } }, /invalid/],
		['newer api', { manifest: { ...MANIFEST, api: 2 } }, /invalid/],
		['http url', { manifest: { ...MANIFEST, url: 'http://x.com' } }, /invalid/],
		['bad semver', { manifest: { ...MANIFEST, version: 'latest' } }, /invalid/],
		['oversized main.js', { code: `// ${'x'.repeat(300000)}` }, /256 KB/]
	])('%s → not ok, problem surfaced', async (_n, over, problemRe) => {
		const [p] = await discoverPlugins(await seeded(over));
		expect(p?.ok).toBe(false);
		expect(p?.problem).toMatch(problemRe);
	});
	it('a folder missing main.js is reported, not skipped', async () => {
		const s = new MemoryStorage();
		await s.mkdir('plugins/lonely');
		await s.write(
			'plugins/lonely/plugin.json',
			JSON.stringify({ ...MANIFEST, namespace: 'lonely' })
		);
		const [p] = await discoverPlugins(s);
		expect(p?.ok).toBe(false);
		expect(p?.problem).toMatch(/missing/);
	});
});

describe('consentHash — length-prefixed SHA-256 (§6.3)', () => {
	it('is deterministic', async () => {
		expect(await consentHash('a', 'b')).toBe(await consentHash('a', 'b'));
	});
	it('the file boundary is part of the signature (no byte-migration collision)', async () => {
		// same concatenated bytes, different split — MUST differ (the §6.3 attack)
		expect(await consentHash('ab', 'c')).not.toBe(await consentHash('a', 'bc'));
	});
	it('any change to either file changes the hash', async () => {
		const base = await consentHash(MAIN, JSON.stringify(MANIFEST));
		expect(await consentHash(MAIN + ' ', JSON.stringify(MANIFEST))).not.toBe(base);
		expect(await consentHash(MAIN, JSON.stringify({ ...MANIFEST, url: 'https://evil' }))).not.toBe(
			base
		);
	});
});

describe('isRunnable — consent × enabled × kill switch', () => {
	const plugin = (hash: string): DiscoveredPlugin => ({
		namespace: 'ns1',
		ok: true,
		code: MAIN,
		hash
	});
	it('requires consent to the EXACT hash + the enabled flag', () => {
		const prefs = emptyPrefs();
		const p = plugin('abc');
		expect(isRunnable(p, prefs)).toBe(false);
		prefs.enabled['ns1'] = true;
		expect(isRunnable(p, prefs)).toBe(false); // enabled but never consented
		prefs.consent['ns1'] = 'abc';
		expect(isRunnable(p, prefs)).toBe(true);
		prefs.consent['ns1'] = 'OLD-HASH'; // code changed since consent
		expect(isRunnable(p, prefs)).toBe(false);
	});
	it('the kill switch beats everything', () => {
		const prefs = emptyPrefs();
		prefs.enabled['ns1'] = true;
		prefs.consent['ns1'] = 'abc';
		prefs.killSwitch = true;
		expect(isRunnable(plugin('abc'), prefs)).toBe(false);
	});
});

describe('pluginManifestSchema strictness', () => {
	it('optional fields may be absent', () => {
		expect(
			pluginManifestSchema.safeParse({ api: 1, namespace: 'x1', name: 'X', version: '0.1.0' })
				.success
		).toBe(true);
	});
});

describe('loadPluginPrefs — defensive parsing (corrupt/partial localStorage, PLG-T2)', () => {
	// node has no localStorage; stub a minimal one so the parse branches (not just the guard) run
	let store: Record<string, string>;
	beforeEach(() => {
		store = {};
		(globalThis as { localStorage?: unknown }).localStorage = {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => void (store[k] = v),
			removeItem: (k: string) => void delete store[k]
		};
	});
	afterEach(() => {
		delete (globalThis as { localStorage?: unknown }).localStorage;
	});

	it('no stored value → empty prefs', () => {
		expect(loadPluginPrefs()).toEqual(emptyPrefs());
	});
	it('corrupt JSON → empty prefs, never throws', () => {
		store['charnik:plugins'] = '{not json';
		expect(loadPluginPrefs()).toEqual(emptyPrefs());
	});
	it('partial object → missing halves fall back to the empty defaults', () => {
		store['charnik:plugins'] = JSON.stringify({ enabled: { a: true } });
		const p = loadPluginPrefs();
		expect(p.enabled).toEqual({ a: true });
		expect(p.consent).toEqual({});
		expect(p.killSwitch).toBe(false);
	});
	it('non-object consent / a truthy-but-not-true killSwitch are sanitised', () => {
		store['charnik:plugins'] = JSON.stringify({ consent: 'nope', killSwitch: 1 });
		const p = loadPluginPrefs();
		expect(p.consent).toEqual({});
		expect(p.killSwitch).toBe(false); // only the literal `true` enables the kill switch
	});
	it('round-trips through save', () => {
		const prefs = { consent: { a: 'h' }, enabled: { a: true }, killSwitch: true };
		savePluginPrefs(prefs);
		expect(loadPluginPrefs()).toEqual(prefs);
	});
});

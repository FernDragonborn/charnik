/*
 * PLG-T1 store tests — the `pluginStatus` state machine (broken / needs_consent / code_changed /
 * disabled / enabled), the user-facing trust surface the Settings list renders. Pure over
 * (DiscoveredPlugin × PluginPrefs); the async evaluator rebuild (gen-guard) is exercised by the
 * sandbox integration suite + tsc, not here (it needs the QuickJS module + a Desktop platform).
 */
import { describe, it, expect } from 'vitest';
import {
	pluginStatus,
	retryPlugins,
	plugins,
	usePluginPrefsStore,
	consentAndEnable,
	disablePlugin,
	forgetPlugin,
	setKillSwitch,
} from './plugin-store.svelte';
import {
	emptyPrefs,
	LOCAL_ORIGIN,
	type DiscoveredPlugin,
	type PluginPrefs,
	type PluginPrefsStore,
} from './plugin-host';

const disc = (over: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin => ({
	namespace: 'p1',
	origin: LOCAL_ORIGIN,
	ok: true,
	hash: 'HASH',
	...over,
});
const prefs = (over: Partial<PluginPrefs> = {}): PluginPrefs => ({ ...emptyPrefs(), ...over });

describe('pluginStatus — the Settings status label', () => {
	it('a broken folder is always "broken", whatever the prefs', () => {
		expect(
			pluginStatus(disc({ ok: false }), prefs({ enabled: { p1: true }, consent: { p1: 'HASH' } })),
		).toBe('broken');
	});
	it('ok + never consented → "needs_consent"', () => {
		expect(pluginStatus(disc(), emptyPrefs())).toBe('needs_consent');
	});
	it('a stored consent for DIFFERENT bytes → "code_changed"', () => {
		expect(pluginStatus(disc(), prefs({ consent: { p1: 'OLD-HASH' } }))).toBe('code_changed');
	});
	it('consented to the exact hash but not enabled → "disabled"', () => {
		expect(pluginStatus(disc(), prefs({ consent: { p1: 'HASH' } }))).toBe('disabled');
	});
	it('consented + enabled → "enabled"', () => {
		expect(pluginStatus(disc(), prefs({ consent: { p1: 'HASH' }, enabled: { p1: true } }))).toBe(
			'enabled',
		);
	});
	it('a missing hash (ok but unhashable) is treated as not-consented → "needs_consent"', () => {
		const noHash: DiscoveredPlugin = { namespace: 'p1', origin: LOCAL_ORIGIN, ok: true };
		expect(pluginStatus(noHash, emptyPrefs())).toBe('needs_consent');
	});
});

describe('the consent record is the store’s, and the page only holds a copy', () => {
	/** The record as Rust keeps it, with the dialog answered by `allow`. */
	function recordAnswering(allow: boolean): PluginPrefsStore & { held: PluginPrefs } {
		const held = emptyPrefs();
		const copy = () => Promise.resolve(structuredClone(held));
		return {
			held,
			read: copy,
			grant: (namespace, hash) => {
				if (allow) {
					held.consent[namespace] = hash;
					held.enabled[namespace] = true;
				}
				return copy();
			},
			forget: (namespaces) => {
				for (const namespace of namespaces) {
					delete held.consent[namespace];
					delete held.enabled[namespace];
				}
				return copy();
			},
			setEnabled: (namespace, enabled) => {
				if (!enabled || namespace in held.consent) held.enabled[namespace] = enabled;
				return copy();
			},
			setKillSwitch: (on) => {
				held.killSwitch = on;
				return copy();
			},
		};
	}
	const plugin = disc({ hash: 'a'.repeat(64) });

	it('a refused dialog changes nothing, and says so', async () => {
		const store = recordAnswering(false);
		usePluginPrefsStore(store);
		plugins.prefs = emptyPrefs();
		expect(await consentAndEnable(plugin, 'uk')).toBe(false);
		expect(pluginStatus(plugin, plugins.prefs)).toBe('needs_consent');
		expect(store.held).toEqual(emptyPrefs());
	});

	it('an allowed one is recorded by the store, and the page reads it back', async () => {
		const store = recordAnswering(true);
		usePluginPrefsStore(store);
		// the kill switch keeps the sandbox out of this test: consented, enabled, and not run
		await setKillSwitch(true);
		expect(await consentAndEnable(plugin, 'uk')).toBe(true);
		expect(plugins.prefs.consent).toEqual({ p1: 'a'.repeat(64) });
		expect(pluginStatus(plugin, plugins.prefs)).toBe('enabled');

		await disablePlugin('p1');
		expect(pluginStatus(plugin, plugins.prefs)).toBe('disabled');
		await forgetPlugin('p1');
		expect(pluginStatus(plugin, plugins.prefs)).toBe('needs_consent');
		expect(store.held.consent).toEqual({});
	});

	it('writing the page’s copy is not writing the record', async () => {
		const store = recordAnswering(false);
		usePluginPrefsStore(store);
		plugins.prefs = { consent: { p1: 'a'.repeat(64) }, enabled: { p1: true }, killSwitch: true };
		// the next thing the store answers is what stands, not what the page claimed
		await setKillSwitch(true);
		expect(plugins.prefs.consent).toEqual({});
	});
});

describe('retryPlugins', () => {
	it('bumps the version so the sheet re-derives (and resets fail counters via the memo clear)', () => {
		const before = plugins.version;
		retryPlugins();
		expect(plugins.version).toBe(before + 1);
	});
});

/*
 * PLG-T1 store tests — the `pluginStatus` state machine (broken / needs_consent / code_changed /
 * disabled / enabled), the user-facing trust surface the Settings list renders. Pure over
 * (DiscoveredPlugin × PluginPrefs); the async evaluator rebuild (gen-guard) is exercised by the
 * sandbox integration suite + tsc, not here (it needs the QuickJS module + a Desktop platform).
 */
import { describe, it, expect } from 'vitest';
import { pluginStatus, retryPlugins, plugins } from './plugin-store.svelte';
import { emptyPrefs, type DiscoveredPlugin, type PluginPrefs } from './plugin-host';

const disc = (over: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin => ({
	namespace: 'p1',
	ok: true,
	hash: 'HASH',
	...over
});
const prefs = (over: Partial<PluginPrefs> = {}): PluginPrefs => ({ ...emptyPrefs(), ...over });

describe('pluginStatus — the Settings status label', () => {
	it('a broken folder is always "broken", whatever the prefs', () => {
		expect(
			pluginStatus(disc({ ok: false }), prefs({ enabled: { p1: true }, consent: { p1: 'HASH' } }))
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
			'enabled'
		);
	});
	it('a missing hash (ok but unhashable) is treated as not-consented → "needs_consent"', () => {
		const noHash: DiscoveredPlugin = { namespace: 'p1', ok: true };
		expect(pluginStatus(noHash, emptyPrefs())).toBe('needs_consent');
	});
});

describe('retryPlugins', () => {
	it('bumps the version so the sheet re-derives (and resets fail counters via the memo clear)', () => {
		const before = plugins.version;
		retryPlugins();
		expect(plugins.version).toBe(before + 1);
	});
});

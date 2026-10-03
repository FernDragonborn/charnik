import { describe, it, expect } from 'vitest';
import { ISSUE_KEY, type EffectIssue } from './token-parser';
import { LOCAL_ORIGIN, emptyPrefs, type DiscoveredPlugin } from './plugin-host';
import { PLUGIN_NEED, pluginNeeds } from './plugin-needs';

const HASH = 'a'.repeat(64);

const failed = (namespace: string): EffectIssue => ({
	source: 'Exploit Die',
	token: `plugin:${namespace}:exploit-die:d8`,
	key: ISSUE_KEY.pluginFailed,
});

const installed = (namespace: string, over: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin => ({
	namespace,
	origin: LOCAL_ORIGIN,
	ok: true,
	manifest: { api: 1, namespace, name: 'My Homebrew', version: '1.0.0' },
	code: '',
	hash: HASH,
	...over,
});

const stateOf = (
	discovered: DiscoveredPlugin[],
	prefs = emptyPrefs(),
	supported = true,
): string | undefined =>
	pluginNeeds([failed('my-homebrew')], { supported, discovered, prefs })[0]?.state;

describe('pluginNeeds · why a plugin the sheet names is not contributing', () => {
	it('names each plugin once, by what it calls itself when it is here to say', () => {
		const needs = pluginNeeds([failed('my-homebrew'), failed('my-homebrew'), failed('other')], {
			supported: true,
			discovered: [installed('my-homebrew')],
			prefs: emptyPrefs(),
		});
		expect(needs.map((need) => [need.namespace, need.name])).toEqual([
			['my-homebrew', 'My Homebrew'],
			['other', 'other'],
		]);
	});

	it('reads only plugin failures, never another issue that happens to carry a token', () => {
		const other: EffectIssue = { ...failed('my-homebrew'), key: ISSUE_KEY.unreadableGuard };
		expect(pluginNeeds([other], { supported: true, discovered: [], prefs: emptyPrefs() })).toEqual(
			[],
		);
	});

	it('says what stands between the plugin and the sheet', () => {
		expect(stateOf([], emptyPrefs(), false)).toBe(PLUGIN_NEED.unsupported);
		expect(stateOf([])).toBe(PLUGIN_NEED.missing);
		expect(stateOf([installed('my-homebrew', { ok: false })])).toBe(PLUGIN_NEED.broken);
		expect(stateOf([installed('my-homebrew')])).toBe(PLUGIN_NEED.needsConsent);

		const consent = { 'my-homebrew': HASH };
		const enabled = { 'my-homebrew': true };
		expect(
			stateOf([installed('my-homebrew')], { ...emptyPrefs(), consent: { 'my-homebrew': 'old' } }),
		).toBe(PLUGIN_NEED.codeChanged);
		expect(stateOf([installed('my-homebrew')], { ...emptyPrefs(), consent })).toBe(
			PLUGIN_NEED.disabled,
		);
		expect(stateOf([installed('my-homebrew')], { consent, enabled, killSwitch: true })).toBe(
			PLUGIN_NEED.killSwitch,
		);
		// reviewed, enabled, allowed — and the handler still gave nothing usable
		expect(stateOf([installed('my-homebrew')], { consent, enabled, killSwitch: false })).toBe(
			PLUGIN_NEED.failed,
		);
	});

	it('a namespace two providers claim answers as the one that loads', () => {
		const loser = installed('my-homebrew', { ok: false, origin: 'dark-sun' });
		expect(stateOf([loser, installed('my-homebrew')])).toBe(PLUGIN_NEED.needsConsent);
	});
});

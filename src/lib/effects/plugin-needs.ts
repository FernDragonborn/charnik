/*
 * Which plugins a SHEET counts on and is not getting, and why — read off the derive's own issues, so
 * it is true of the character on screen rather than of what happens to be installed.
 *
 * A plugin token that does not resolve degrades to an inert note and the sheet goes on
 * (plugins.md §1). That is the right behaviour and a quiet one: a character built on one machine and
 * opened on another is simply missing numbers. This says so, per plugin, in the one word that names
 * what to do about it.
 */
import { ISSUE_KEY, EFFECT_KIND, parseToken, type EffectIssue } from './token-parser';
import type { DiscoveredPlugin, PluginPrefs } from './plugin-host';
import { pluginStatus } from './plugin-store.svelte';

/** Why a plugin the sheet names is not contributing. An open enum: each member is a different thing
 *  for the player to do, and the last is the one that is not theirs to fix. */
export const PLUGIN_NEED = {
	/** this build runs no plugins at all (the web demo) */
	unsupported: 'unsupported',
	/** nothing by that name is installed */
	missing: 'missing',
	/** its folder is here and cannot be loaded */
	broken: 'broken',
	needsConsent: 'needs_consent',
	codeChanged: 'code_changed',
	disabled: 'disabled',
	/** every plugin is off (the global switch) */
	killSwitch: 'kill_switch',
	/** it runs, and did not return a usable answer */
	failed: 'failed',
} as const;
export type PluginNeedState = (typeof PLUGIN_NEED)[keyof typeof PLUGIN_NEED];

export interface PluginNeed {
	namespace: string;
	/** What the plugin calls itself, when it is installed to say; its namespace otherwise. */
	name: string;
	state: PluginNeedState;
}

/** What of the plugin store this reads. */
export interface PluginAvailability {
	supported: boolean;
	discovered: readonly DiscoveredPlugin[];
	prefs: PluginPrefs;
}

/** The namespace a failed plugin token names, or undefined for any other issue. */
function namespaceOf(issue: EffectIssue): string | undefined {
	if (issue.key !== ISSUE_KEY.pluginFailed) return undefined;
	const parsed = parseToken(issue.token);
	return parsed.kind === EFFECT_KIND.plugin ? parsed.plugin?.namespace : undefined;
}

function stateOf(found: DiscoveredPlugin | undefined, available: PluginAvailability) {
	if (!available.supported) return PLUGIN_NEED.unsupported;
	if (!found) return PLUGIN_NEED.missing;
	const status = pluginStatus(found, available.prefs);
	if (status !== 'enabled') return status;
	return available.prefs.killSwitch ? PLUGIN_NEED.killSwitch : PLUGIN_NEED.failed;
}

/** Every plugin the sheet's issues name as not contributing, once each, in the order met. */
export function pluginNeeds(
	issues: readonly EffectIssue[],
	available: PluginAvailability,
): PluginNeed[] {
	const out: PluginNeed[] = [];
	for (const issue of issues) {
		const namespace = namespaceOf(issue);
		if (!namespace || out.some((need) => need.namespace === namespace)) continue;
		// a namespace two providers claim is listed twice, the loser carrying the conflict
		const claims = available.discovered.filter((p) => p.namespace === namespace);
		const found = claims.find((p) => p.ok) ?? claims[0];
		out.push({
			namespace,
			name: found?.manifest?.name ?? namespace,
			state: stateOf(found, available),
		});
	}
	return out;
}

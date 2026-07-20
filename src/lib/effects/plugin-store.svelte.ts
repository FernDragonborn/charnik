/*
 * L3 plugin reactive store — discovery results + consent/enable prefs + the live evaluator wiring.
 * The pure logic lives in plugin-host.ts; this file owns the $state the Settings UI binds to and
 * the ONE place the sandbox evaluator is (re)built and handed to the registry.
 *
 * Desktop-only (PLG-SEC 21): on web/headless `supported` stays false, nothing is discovered, and
 * the QuickJS sandbox module is never imported (dynamic import below) — the web bundle ships no
 * live sandbox path. Consent/enable prefs live in localStorage (app-side, OUTSIDE the dataDir —
 * PLG-SEC 12), so an imported data folder can carry plugin code but never its permission.
 *
 * `version` bumps whenever the evaluator set changes — sheet-deriving VMs read it so enabling /
 * disabling a plugin recomputes stats LIVE (no reload), matching the everything-from-the-UI
 * invariant.
 */
import { detectPlatform, Platform, getUserStorage } from '../storage/provider';
import {
	discoverPlugins,
	loadPluginPrefs,
	savePluginPrefs,
	isRunnable,
	emptyPrefs,
	type DiscoveredPlugin,
	type PluginPrefs
} from './plugin-host';
import {
	registerPluginEvaluator,
	clearPluginEvaluator,
	clearPluginMemo,
	type PluginEvaluator
} from './plugin-registry';

interface PluginsState {
	/** Plugins exist on the desktop build only. */
	supported: boolean;
	loaded: boolean;
	discovered: DiscoveredPlugin[];
	prefs: PluginPrefs;
	/** Bumped on every evaluator rebuild — a reactive dependency for sheet derivation. */
	version: number;
}

export const plugins = $state<PluginsState>({
	supported: false,
	loaded: false,
	discovered: [],
	prefs: emptyPrefs(),
	version: 0
});

let evaluatorHandle: { dispose(): void } | null = null;
let loadStarted = false;
/** Monotonic rebuild id. Toggling a plugin is a fold to the FINAL prefs (order-irrelevant, no
 *  queue) — a rebuild whose gen is no longer the latest was superseded and must drop its work. */
let rebuildGen = 0;

/** Discover plugins + build the evaluator for already-consented, enabled ones. Idempotent;
 *  called once at app start (layout) and re-runnable via `refreshPlugins`. */
export async function loadPlugins(): Promise<void> {
	if (loadStarted) return;
	loadStarted = true;
	plugins.supported = detectPlatform() === Platform.Desktop;
	if (!plugins.supported) {
		plugins.loaded = true;
		return;
	}
	plugins.prefs = loadPluginPrefs();
	await refreshPlugins();
	plugins.loaded = true;
}

/** Re-scan `<dataDir>/plugins/` (user added/edited a folder) and rebuild the evaluator. */
export async function refreshPlugins(): Promise<void> {
	if (!plugins.supported) return;
	plugins.discovered = await discoverPlugins(getUserStorage());
	await rebuildEvaluator();
}

async function rebuildEvaluator(): Promise<void> {
	const gen = ++rebuildGen;
	const runnable = plugins.discovered.filter((p) => isRunnable(p, plugins.prefs));

	// BUILD the next evaluator BEFORE touching the live one — the old evaluator keeps serving across
	// the async gap (no transient null window), and a concurrent rebuild that superseded us disposes
	// what it built and bails (no leak, no last-completed-wins). The swap below is synchronous.
	let next: (PluginEvaluator & { dispose(): void }) | null = null;
	if (runnable.length) {
		// dynamic import: the QuickJS-WASM module loads only when ≥1 plugin actually runs
		const { createSandboxEvaluator } = await import('./plugin-sandbox');
		next = await createSandboxEvaluator(
			runnable.map((p) => ({ namespace: p.namespace, code: p.code ?? '' }))
		);
	}
	if (gen !== rebuildGen) {
		next?.dispose(); // a newer rebuild already won — throw our work away, don't register it
		return;
	}
	evaluatorHandle?.dispose();
	evaluatorHandle = next;
	clearPluginMemo();
	if (next) registerPluginEvaluator(next);
	else clearPluginEvaluator();
	plugins.version++;
}

function persist(): void {
	savePluginPrefs(plugins.prefs);
}

/** The user accepted the consent dialog for THIS plugin at THIS code hash → record + enable. */
export async function consentAndEnable(p: DiscoveredPlugin): Promise<void> {
	if (!p.ok || p.hash === undefined) return;
	plugins.prefs.consent[p.namespace] = p.hash;
	plugins.prefs.enabled[p.namespace] = true;
	persist();
	await rebuildEvaluator();
}

export async function disablePlugin(namespace: string): Promise<void> {
	plugins.prefs.enabled[namespace] = false;
	persist();
	await rebuildEvaluator();
}

/** Re-enable a plugin whose consent is still valid (no dialog needed). Returns false when consent
 *  is missing/stale — the caller must show the consent dialog instead. */
export async function enableConsented(p: DiscoveredPlugin): Promise<boolean> {
	if (!p.ok || p.hash === undefined || plugins.prefs.consent[p.namespace] !== p.hash) return false;
	plugins.prefs.enabled[p.namespace] = true;
	persist();
	await rebuildEvaluator();
	return true;
}

/** The global "disable all plugins" kill switch (§6.4) — always works, survives restarts. */
export async function setKillSwitch(on: boolean): Promise<void> {
	plugins.prefs.killSwitch = on;
	persist();
	await rebuildEvaluator();
}

/** The one status label the Settings list renders per plugin. */
export type PluginStatus = 'broken' | 'needs_consent' | 'code_changed' | 'disabled' | 'enabled';

export function pluginStatus(p: DiscoveredPlugin, prefs: PluginPrefs): PluginStatus {
	if (!p.ok) return 'broken';
	const consented = p.hash !== undefined && prefs.consent[p.namespace] === p.hash;
	// a stored consent for DIFFERENT bytes = the §6.3 "disabled — code changed" state
	if (!consented && prefs.consent[p.namespace] !== undefined) return 'code_changed';
	if (!consented) return 'needs_consent';
	if (prefs.enabled[p.namespace] !== true) return 'disabled';
	return 'enabled';
}

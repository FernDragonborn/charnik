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
	type PluginPrefs,
} from './plugin-host';
import {
	registerPluginEvaluator,
	clearPluginEvaluator,
	clearPluginMemo,
	type PluginEvaluator,
} from './plugin-registry';

interface PluginsState {
	/** Plugins exist on the desktop build only. */
	supported: boolean;
	loaded: boolean;
	discovered: DiscoveredPlugin[];
	prefs: PluginPrefs;
	/** namespace → the REAL main.js load error, for a plugin that is consented+enabled but whose
	 *  code failed to evaluate at sandbox boot (discovery can't catch this — it never runs the code).
	 *  Surfaced in Settings ▸ Plugins so a broken plugin doesn't silently read as "enabled". */
	loadErrors: Record<string, string>;
	/** Bumped on every evaluator rebuild — a reactive dependency for sheet derivation. */
	version: number;
}

export const plugins = $state<PluginsState>({
	supported: false,
	loaded: false,
	discovered: [],
	prefs: emptyPrefs(),
	loadErrors: {},
	version: 0,
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
	forgetUndiscovered();
	await rebuildEvaluator();
}

/**
 * Drop consent + enablement for namespaces the scan no longer finds — the same rule
 * `revokePackPlugins` applies to a pack, for a folder the user deleted by hand.
 *
 * Consent lives outside the data dir and is keyed by the code hash, so it OUTLIVES the files it was
 * granted for: without this, deleting a plugin folder and later dropping the same bytes back started
 * running it immediately, with no dialog and nothing said. "I deleted that folder" is the clearest
 * possible statement that the permission is over. A failed scan never reaches here — `discoverPlugins`
 * throws rather than answering with an empty list.
 */
function forgetUndiscovered(): void {
	const present = new Set(plugins.discovered.map((p) => p.namespace));
	const gone = [
		...new Set([...Object.keys(plugins.prefs.consent), ...Object.keys(plugins.prefs.enabled)]),
	].filter((ns) => !present.has(ns));
	if (!gone.length) return;
	for (const ns of gone) {
		delete plugins.prefs.consent[ns];
		delete plugins.prefs.enabled[ns];
	}
	persist();
}

/** Forget one plugin: its consent and its enablement go, so running it again asks again. The way OUT
 *  of the consent a dialog granted — disabling only stops it for now, and the row's own button then
 *  re-enables it silently. */
export async function forgetPlugin(namespace: string): Promise<void> {
	delete plugins.prefs.consent[namespace];
	delete plugins.prefs.enabled[namespace];
	persist();
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
			runnable.map((p) => ({ namespace: p.namespace, code: p.code ?? '' })),
		);
	}
	if (gen !== rebuildGen) {
		next?.dispose(); // a newer rebuild already won — throw our work away, don't register it
		return;
	}
	evaluatorHandle?.dispose();
	evaluatorHandle = next;
	// both of these drop the memo and the failure streaks themselves — a result belongs to the
	// evaluator that produced it
	if (next) registerPluginEvaluator(next);
	else clearPluginEvaluator();
	// a plugin that booted with a broken main.js reports its real error → surface it globally
	const errs: Record<string, string> = {};
	for (const p of runnable) {
		const le = next?.loadError?.(p.namespace);
		if (le) errs[p.namespace] = le;
	}
	plugins.loadErrors = errs;
	plugins.version++;
}

/** Give plugins that auto-disabled (3 failures) another chance on THIS character without a full
 *  re-scan: clearing the memo also resets the fail counters; the version bump re-derives. */
export function retryPlugins(): void {
	clearPluginMemo();
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

/**
 * Drop consent + enablement for every plugin a content pack shipped. Call it as the pack is being
 * uninstalled, while its folder is still there to be read.
 *
 * Consent is keyed by `(namespace, hash)` and lives outside the data dir, so it OUTLIVES the files
 * it was granted for. Without this, re-installing the same pack later would silently start running
 * its code again — technically consented (the bytes match) but never said out loud, and "I removed
 * that pack" is the clearest possible statement that the permission is over. A namespace the pack
 * doesn't provide is untouched: a hand-placed plugin of the same name is the user's own.
 */
export async function revokePackPlugins(pack: string): Promise<void> {
	if (!plugins.supported) return;
	const mine = plugins.discovered.filter((p) => p.origin === pack).map((p) => p.namespace);
	if (mine.length === 0) return;
	for (const namespace of mine) {
		delete plugins.prefs.consent[namespace];
		delete plugins.prefs.enabled[namespace];
	}
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

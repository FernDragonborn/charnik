/*
 * L3 plugin reactive store — discovery results + consent/enable prefs + the live evaluator wiring.
 * The pure logic lives in plugin-host.ts; this file owns the $state the Settings UI binds to and
 * the ONE place the sandbox evaluator is (re)built and handed to the registry.
 *
 * Desktop-only (PLG-SEC 21): on web/headless `supported` stays false, nothing is discovered, and
 * the QuickJS sandbox module is never imported (dynamic import below) — the web bundle ships no
 * live sandbox path. Consent/enable prefs are Rust's (`PluginPrefsStore`): OUTSIDE the dataDir —
 * PLG-SEC 12 — so an imported data folder can carry plugin code but never its permission, and
 * outside the webview's reach, so `plugins.prefs` is a copy of the record and never the record.
 *
 * `version` bumps whenever the evaluator set changes — sheet-deriving VMs read it so enabling /
 * disabling a plugin recomputes stats LIVE (no reload), matching the everything-from-the-UI
 * invariant.
 */
import { detectPlatform, Platform, getUserStorage } from '../storage/provider';
import {
	discoverPlugins,
	isRunnable,
	emptyPrefs,
	type DiscoveredPlugin,
	type PluginPrefs,
	type PluginPrefsStore,
} from './plugin-host';
import {
	registerPluginEvaluator,
	clearPluginEvaluator,
	clearPluginMemo,
	type PluginEvaluator,
} from './plugin-registry';
import { logger } from '$lib/diag/logger';

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

/** Where the record is kept. Set at `loadPlugins` on desktop — the one platform with plugins — and
 *  by a test that stands in for it. */
let prefsStore: PluginPrefsStore | null = null;
export function usePluginPrefsStore(store: PluginPrefsStore): void {
	prefsStore = store;
}

/** Run one change against the record and take what it then holds. With no store there is nothing
 *  to change, which is the web build. */
async function record(change: (store: PluginPrefsStore) => Promise<PluginPrefs>): Promise<void> {
	if (prefsStore) plugins.prefs = await change(prefsStore);
}

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
	// dynamic, like the sandbox: the web bundle never loads a module that imports Tauri
	prefsStore ??= (await import('./plugin-prefs-tauri')).tauriPluginPrefs;
	await record((store) => store.read());
	await refreshPlugins();
	plugins.loaded = true;
}

/** Re-scan `<dataDir>/plugins/` (user added/edited a folder) and rebuild the evaluator. */
export async function refreshPlugins(): Promise<void> {
	if (!plugins.supported) return;
	plugins.discovered = await discoverPlugins(getUserStorage());
	logger.info('plugins: discovered', {
		found: plugins.discovered.length,
		broken: plugins.discovered.filter((p) => !p.ok).length,
	});
	await forgetUndiscovered();
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
async function forgetUndiscovered(): Promise<void> {
	const present = new Set(plugins.discovered.map((p) => p.namespace));
	const gone = [
		...new Set([...Object.keys(plugins.prefs.consent), ...Object.keys(plugins.prefs.enabled)]),
	].filter((ns) => !present.has(ns));
	if (!gone.length) return;
	logger.info('plugins: forgetting undiscovered', { namespaces: gone });
	await record((store) => store.forget(gone));
}

/** Forget one plugin: its consent and its enablement go, so running it again asks again. The way OUT
 *  of the consent a dialog granted — disabling only stops it for now, and the row's own button then
 *  re-enables it silently. */
export async function forgetPlugin(namespace: string): Promise<void> {
	logger.info('plugins: consent forgotten', { namespace });
	await record((store) => store.forget([namespace]));
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
	// code that would not boot is the failure a user cannot diagnose from the row alone
	for (const [namespace, error] of Object.entries(errs))
		logger.error('plugins: load failed', { namespace, error });
	plugins.version++;
}

/** Give plugins that auto-disabled (3 failures) another chance on THIS character without a full
 *  re-scan: clearing the memo also resets the fail counters; the version bump re-derives. */
export function retryPlugins(): void {
	clearPluginMemo();
	plugins.version++;
}

/**
 * The user accepted the review dialog for THIS plugin at THIS code hash → ask for the consent
 * itself, which is Rust's native dialog and not a button this page drew. Answers whether it was
 * given: a no leaves the record, and the plugin, exactly as they were.
 */
export async function consentAndEnable(p: DiscoveredPlugin, locale: string): Promise<boolean> {
	const hash = p.hash;
	if (!p.ok || hash === undefined) return false;
	await record((store) => store.grant(p.namespace, hash, locale));
	const granted = plugins.prefs.consent[p.namespace] === hash;
	// consent to RUN CODE is the one decision worth being able to reconstruct afterwards
	logger.info(granted ? 'plugins: consent granted' : 'plugins: consent refused', {
		namespace: p.namespace,
		hash,
	});
	await rebuildEvaluator();
	return granted;
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
	logger.info('plugins: consent revoked with pack', { pack, namespaces: mine });
	await record((store) => store.forget(mine));
	await rebuildEvaluator();
}

export async function disablePlugin(namespace: string): Promise<void> {
	await record((store) => store.setEnabled(namespace, false));
	await rebuildEvaluator();
}

/** Re-enable a plugin whose consent is still valid (no dialog needed). Returns false when consent
 *  is missing/stale — the caller must show the consent dialog instead. */
export async function enableConsented(p: DiscoveredPlugin): Promise<boolean> {
	if (!p.ok || p.hash === undefined || plugins.prefs.consent[p.namespace] !== p.hash) return false;
	await record((store) => store.setEnabled(p.namespace, true));
	await rebuildEvaluator();
	return true;
}

/** The global "disable all plugins" kill switch (§6.4) — always works, survives restarts. */
export async function setKillSwitch(on: boolean): Promise<void> {
	logger.warn('plugins: kill switch', { on });
	await record((store) => store.setKillSwitch(on));
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

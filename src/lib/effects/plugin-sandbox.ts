/*
 * L3 sandbox host — QuickJS-in-WASM (quickjs-ng, SYNC build) behind the `PluginEvaluator` seam.
 *
 * Proven container, zero DIY (PLAN "PLG design decisions"): limits are the library's own APIs
 * (`setInterruptHandler` / `setMemoryLimit` / `setMaxStackSize`); quickjs-NG is used specifically
 * because its regexp engine honours the interrupt (PLG-SEC 1b — the canonical handler pattern runs
 * a regexp over hostile `args`, so ReDoS must be interruptible).
 *
 * Containment model (docs/PLUGINS.md §5):
 * - one RUNTIME per plugin (PLG-SEC 14 — no shared globals between plugins);
 * - zero-capability context: nothing injected; Date excluded via the intrinsics config;
 *   Math.random / WeakRef / FinalizationRegistry / performance / the `eval` binding neutered by
 *   the setup script (not intrinsic flags) — integration tests assert every removal;
 * - the boundary is ONE JSON string, built by `JSON.stringify` INSIDE the sandbox and length-capped
 *   by the registry BEFORE `JSON.parse` (PLG-SEC 1c) — the host never walks live sandbox objects,
 *   and a returned Promise is an invalid result (the job queue is never drained);
 * - fail-closed: any limit trip disposes the context; it is rebuilt lazily on the next call
 *   (PLG-SEC 8 "context recycled after any limit trip").
 *
 * This module is imported DYNAMICALLY (plugin-host.ts) only when ≥1 plugin is enabled on desktop —
 * the web build never executes it (PLG-SEC 21).
 */
import {
	newQuickJSWASMModuleFromVariant,
	DefaultIntrinsics,
	type QuickJSContext,
	type QuickJSRuntime,
	type QuickJSWASMModule
} from 'quickjs-emscripten-core';
import type { PluginCallOutcome, PluginEvaluator, PluginTokenRef } from './plugin-registry';

/** Per-call CPU deadline, ms (§5 budgets). A handler is arithmetic, not a simulation. */
const CALL_BUDGET_MS = 5;
/** Budget for evaluating `main.js` itself (once per session per plugin). */
const LOAD_BUDGET_MS = 50;
/** Sandbox memory limit, bytes. */
const MEMORY_LIMIT = 8 * 1024 * 1024;
/** Sandbox stack limit, bytes. */
const STACK_LIMIT = 256 * 1024;
/** `main.js` size cap (docs/PLUGINS.md §2) — enforced at discovery too; defense in depth here. */
const MAX_MAIN_JS_BYTES = 256 * 1024;

/** Neuter the non-intrinsic determinism/side-channel surfaces (PLG-SEC 1) and freeze the result so
 *  plugin code can't restore them. Runs BEFORE `main.js`. `Date` is excluded via the intrinsics
 *  config (the spec-preferred path where a flag exists); `eval`'s binding is nulled here because
 *  its intrinsic must stay on for the host's own `evalCode` boundary. */
const SETUP_SCRIPT = `
"use strict";
Math.random = () => { throw new Error("Math.random is removed (determinism is mandatory)"); };
Object.freeze(Math);
globalThis.WeakRef = undefined;
globalThis.FinalizationRegistry = undefined;
globalThis.performance = undefined;
globalThis.eval = undefined;
`;

/** One evaluated plugin: its isolated runtime/context + the discovered handler names. */
interface LoadedPlugin {
	namespace: string;
	code: string;
	/** Handler names whose object carries a callable `passive` (the only `api: 1` hook). */
	passiveHandlers: Set<string>;
	runtime: QuickJSRuntime | null;
	context: QuickJSContext | null;
	deadline: number;
}

export interface SandboxPluginSpec {
	namespace: string;
	/** The full `main.js` source (read ONCE by the host — the same buffer that was consent-hashed,
	 *  closing TOCTOU; PLG-SEC 12). */
	code: string;
}

let modulePromise: Promise<QuickJSWASMModule> | null = null;
/** The settled module, for the SYNC call path (set once by `getModule`). */
let loadedModule: QuickJSWASMModule | null = null;
async function getModule(): Promise<QuickJSWASMModule> {
	if (!modulePromise)
		modulePromise = import('@jitl/quickjs-ng-wasmfile-release-sync').then((v) =>
			newQuickJSWASMModuleFromVariant(v.default)
		);
	loadedModule = await modulePromise;
	return loadedModule;
}
/** The already-loaded WASM module (call sites run after `createSandboxEvaluator` awaited it). */
function getModuleSync(): QuickJSWASMModule {
	if (!loadedModule) throw new Error('sandbox module not initialized');
	return loadedModule;
}

/** Cap on the raw string leaving the sandbox, BEFORE `JSON.parse` (PLG-SEC 1c). Slightly above the
 *  registry's own 64 KB result cap so the registry's rejection message stays the visible one. */
const MAX_RAW_RESULT = 128 * 1024;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** (Re)build a plugin's runtime + context and evaluate its `main.js` under the load budget.
 *  Returns an error string instead of throwing (the caller degrades). */
function bootPlugin(mod: QuickJSWASMModule, p: LoadedPlugin): string | null {
	disposePlugin(p);
	const runtime = mod.newRuntime();
	runtime.setMemoryLimit(MEMORY_LIMIT);
	runtime.setMaxStackSize(STACK_LIMIT);
	// interrupt fires between JS ops AND inside quickjs-ng regexp matching; the deadline is
	// re-armed per call
	runtime.setInterruptHandler(() => now() > p.deadline);
	// `Eval: false` would kill `evalCode` itself — the HOST boundary is eval. The intrinsic stays;
	// the sandbox-visible `globalThis.eval` binding is neutered by the setup script instead
	// (in-sandbox eval would be capability-harmless anyway — it can't reach past the container).
	const context = runtime.newContext({
		intrinsics: { ...DefaultIntrinsics, Date: false }
	});
	p.runtime = runtime;
	p.context = context;
	p.deadline = now() + LOAD_BUDGET_MS;

	const setup = context.evalCode(SETUP_SCRIPT, 'charnik-setup.js');
	if (setup.error) {
		setup.error.dispose();
		disposePlugin(p);
		return 'sandbox setup failed';
	}
	setup.value.dispose();

	const main = context.evalCode(p.code, 'main.js');
	if (main.error) {
		main.error.dispose();
		disposePlugin(p);
		return 'main.js failed to evaluate (or exceeded the load budget)';
	}
	main.value.dispose();

	// discover handlers: names under globalThis.handlers with a callable `passive`
	p.deadline = now() + LOAD_BUDGET_MS;
	const names = context.evalCode(
		`JSON.stringify(Object.keys(globalThis.handlers ?? {}).filter(
			(k) => typeof (globalThis.handlers[k] ?? {}).passive === "function"))`,
		'charnik-discover.js'
	);
	if (names.error) {
		names.error.dispose();
		disposePlugin(p);
		return 'handler discovery failed';
	}
	const raw = context.getString(names.value);
	names.value.dispose();
	try {
		const parsed: unknown = JSON.parse(raw);
		p.passiveHandlers = new Set(
			Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
		);
	} catch {
		p.passiveHandlers = new Set();
	}
	return null;
}

function disposePlugin(p: LoadedPlugin): void {
	p.context?.dispose();
	p.runtime?.dispose();
	p.context = null;
	p.runtime = null;
}

/**
 * Build the `PluginEvaluator` for a set of consented, enabled plugins. Async ONLY for the one-time
 * WASM module load — every `call` afterwards is synchronous (derive stays sync). Each plugin gets
 * its own runtime; a plugin that fails to boot stays listed (has() = false → its tokens degrade).
 */
export async function createSandboxEvaluator(
	specs: SandboxPluginSpec[]
): Promise<PluginEvaluator & { dispose(): void }> {
	const mod = await getModule();
	const plugins = new Map<string, LoadedPlugin>();
	for (const spec of specs) {
		if (new TextEncoder().encode(spec.code).length > MAX_MAIN_JS_BYTES) continue;
		const p: LoadedPlugin = {
			namespace: spec.namespace,
			code: spec.code,
			passiveHandlers: new Set(),
			runtime: null,
			context: null,
			deadline: 0
		};
		bootPlugin(mod, p); // boot failure leaves passiveHandlers empty → has() = false
		plugins.set(spec.namespace, p);
	}

	return {
		has(namespace, handlerName) {
			return plugins.get(namespace)?.passiveHandlers.has(handlerName) ?? false;
		},
		call(token: PluginTokenRef, buildJson: string, playJson: string): PluginCallOutcome {
			const p = plugins.get(token.namespace);
			if (!p || !p.passiveHandlers.has(token.handlerName))
				return { ok: false, reason: 'handler not registered' };
			// context recycled after a limit trip (PLG-SEC 8): rebuild lazily
			if (!p.context) {
				const err = bootPlugin(getModuleSync(), p);
				if (err || !p.context) return { ok: false, reason: err ?? 'sandbox unavailable' };
			}
			const context = p.context;

			// The wrapper runs INSIDE the sandbox: it parses the ctx halves, tracks whether the
			// handler touches `ctx.play` (the §4.2 memo split), rejects thenables (the host never
			// drains the job queue), and stringifies the outcome — so exactly ONE string crosses
			// the boundary (PLG-SEC 1c; `getString` on a primitive runs no sandbox getters).
			const code = `(() => {
				try {
					const t = ${JSON.stringify(token)};
					const b = JSON.parse(${JSON.stringify(buildJson)});
					const pl = JSON.parse(${JSON.stringify(playJson)});
					let playRead = false;
					const ctx = { api: 1, build: b };
					Object.defineProperty(ctx, "play", { get() { playRead = true; return pl; } });
					const r = globalThis.handlers[t.handlerName].passive(t, ctx);
					if (r !== undefined && r !== null && typeof r.then === "function")
						return JSON.stringify({ err: "async handlers are invalid (return plain JSON)" });
					return JSON.stringify({ result: r ?? {}, playRead });
				} catch (e) {
					return JSON.stringify({ err: String((e && e.message) || e).slice(0, 200) });
				}
			})()`;

			p.deadline = now() + CALL_BUDGET_MS;
			const res = context.evalCode(code, 'charnik-call.js');
			if (res.error) {
				// an interrupt / OOM / stack trip lands here (the in-sandbox try can't catch those)
				res.error.dispose();
				const err = bootPlugin(getModuleSync(), p);
				return { ok: false, reason: err ? 'over budget (sandbox rebuild failed)' : 'over budget' };
			}
			const raw = context.getString(res.value);
			res.value.dispose();
			if (raw.length > MAX_RAW_RESULT) return { ok: false, reason: 'result too large' };

			let parsed: { result?: unknown; playRead?: unknown; err?: unknown };
			try {
				parsed = JSON.parse(raw) as typeof parsed;
			} catch {
				return { ok: false, reason: 'invalid result: not JSON' };
			}
			if (parsed.err !== undefined) return { ok: false, reason: String(parsed.err) };
			return {
				ok: true,
				resultJson: JSON.stringify(parsed.result ?? {}),
				readPlay: parsed.playRead === true
			};
		},
		dispose() {
			for (const p of plugins.values()) disposePlugin(p);
			plugins.clear();
		}
	};
}

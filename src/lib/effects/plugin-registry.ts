/*
 * L3 plugin REGISTRY + the derive pre-pass (docs/PLUGINS.md is the normative `api: 1` spec).
 *
 * A `plugin:<namespace>:<handlerName>[:<args>]` token is a REFERENCE — code never lives in content. The pre-pass
 * (`expandPluginEffects`) resolves every such token once per derive through an injected
 * `PluginEvaluator` (native TS in tests, the QuickJS-WASM sandbox in production — plugin-sandbox.ts)
 * and validates the result HERE, on the host side: the evaluator's output is untrusted input
 * (zod, strict caps, finite numbers, whitelisted keys). A missing/disabled/over-budget/errored
 * plugin degrades the token to an inert note — a plugin can never break the sheet.
 *
 * Placement in the derive stage list (PLAN.md fresh-eyes #6): the pre-pass runs BETWEEN
 * (2) resolve and (3) facts — returned `tokens` must ride `collectFacts` like content tokens.
 * Memoization: results memoized on (raw token, ctx-hash), the build/play ctx halves hashed
 * separately — a handler that never reads `ctx.play` stays cache-hot across HP ticks (§4.2).
 */
import { z } from 'zod';
import type { Ability } from '../rules/core';
import { parseToken, EFFECT_KIND, type ActiveEffect, type EffectIssue } from './token-parser';
import type { NumericFact } from './apply';

// --- The ctx a handler receives (docs/PLUGINS.md §4.2) ------------------------------------------
// Least-data by design: game numbers only, never names/notes/free text. Two sub-objects with
// different lifetimes — `build` changes only on a build edit, `play` changes constantly.

interface PluginCtxBuild {
	system: string;
	level: number;
	classLevels: Record<string, number>;
	proficiencyBonus: number;
	/** EFFECTIVE (post-effect) scores/mods — resolved before any handler runs (§8.4). */
	abilities: Record<Ability, { score: number; mod: number }>;
}

interface PluginCtxPlay {
	hp: number;
	hpMax: number;
	tempHp: number;
	/** SAME names as the L2 guard variables (`is_bloodied` → `isBloodied`), camelCased like the
	 *  rest of the ctx JSON — one vocabulary across both layers, never two names for one fact. */
	flags: { isBloodied: boolean; isRaging: boolean; isConcentrating: boolean };
	conditions: string[];
	/** REMAINING pool counts (max − spent). */
	resources: Record<string, number>;
}

export interface PluginCtx {
	api: 1;
	build: PluginCtxBuild;
	play: PluginCtxPlay;
}

/** The parsed token as the handler sees it (§4.1). */
export interface PluginTokenRef {
	namespace: string;
	handlerName: string;
	args: string;
	raw: string;
}

// --- The evaluator seam (implemented by plugin-sandbox.ts; faked in tests) ----------------------

/** One sandbox call. `resultJson` is the raw JSON string produced INSIDE the sandbox (§5: the
 *  boundary is a single string — never a live object); `readPlay` reports whether the handler
 *  touched `ctx.play` (drives the §4.2 memo split). */
export type PluginCallOutcome =
	{ ok: true; resultJson: string; readPlay: boolean } | { ok: false; reason: string };

export interface PluginEvaluator {
	/** Is this namespace:handlerName present AND enabled? (Missing → the token degrades without a call.) */
	has(namespace: string, handlerName: string): boolean;
	/** Run the handler synchronously. buildJson/playJson are the pre-serialized ctx halves. */
	call(token: PluginTokenRef, buildJson: string, playJson: string): PluginCallOutcome;
}

let evaluator: PluginEvaluator | null = null;

/** Install the evaluator (the sandbox host, once ≥1 plugin is enabled). Replaces any previous. */
export function registerPluginEvaluator(e: PluginEvaluator): void {
	evaluator = e;
	failCounts.clear();
}
/** Remove the evaluator (kill switch / module teardown) — plugin tokens degrade to notes. */
export function clearPluginEvaluator(): void {
	evaluator = null;
}

// --- Host-side result validation (§4.3 — the sandbox output is untrusted input) -----------------

/** Result-size cap BEFORE JSON.parse (PLG-SEC 1c). */
const MAX_RESULT_JSON = 64 * 1024;
/** Aggregate plugin budget per derive, ms (PLG-SEC 13). */
const AGGREGATE_BUDGET_MS = 20;
/** Consecutive failures before a plugin is disabled for the session (§5 fail-closed). */
const MAX_CONSECUTIVE_FAILURES = 3;

/** §4.4 target keys. Skills validated by GRAMMAR (snake id), not membership — folding is
 *  string-compare into arrays (never `obj[key] =`), so an unknown id folds onto nothing;
 *  the pattern + count caps are what kill prototype-pollution keys (PLG-SEC 22b). */
const TARGET_KEY_RE =
	/^(ac|initiative|speed|hp_max|attack|damage|save\.(str|dex|con|int|wis|cha)|skill\.[a-z][a-z0-9_]{0,31}|passive\.(perception|investigation|insight))$/;

const contributionSchema = z.object({
	layer: z.enum(['feature', 'item', 'condition']),
	op: z.enum(['add', 'set', 'mult']),
	amount: z.number().finite().min(-1000).max(1000),
	label: z.string().max(48).optional()
});

/** One L1 token per array element — a `;`/newline inside would smuggle N tokens past the ≤16 cap
 *  (PLG-SEC 20). Values inside ride the same host clamps as content (they hit the same parser). */
const singleToken = z
	.string()
	.max(300)
	.refine((s) => !/[;\r\n]/.test(s), 'one token per element');

const resultSchema = z.object({
	tokens: z.array(singleToken).max(16).optional(),
	contributions: z.record(z.string(), z.array(contributionSchema).max(8)).optional(),
	notes: z.array(z.string().max(200)).max(8).optional()
});

type PluginResult = z.infer<typeof resultSchema>;

/** Parse + validate a sandbox result string. Whole-result rejection on ANY violation (§4.3). */
function validateResult(
	resultJson: string
): { ok: true; result: PluginResult } | { ok: false; reason: string } {
	if (resultJson.length > MAX_RESULT_JSON) return { ok: false, reason: 'result too large' };
	let parsed: unknown;
	try {
		parsed = JSON.parse(resultJson);
	} catch {
		return { ok: false, reason: 'result is not JSON' };
	}
	const r = resultSchema.safeParse(parsed);
	if (!r.success)
		return { ok: false, reason: `invalid result: ${r.error.issues[0]?.message ?? 'shape'}` };
	const keys = Object.keys(r.data.contributions ?? {});
	if (keys.length > 20) return { ok: false, reason: 'invalid result: too many contribution keys' };
	for (const k of keys)
		if (!TARGET_KEY_RE.test(k))
			return { ok: false, reason: `invalid result: bad target key "${k}"` };
	return { ok: true, result: r.data };
}

// --- Memoization (§4.2 memo economics; PLG-SEC 22c bounded) -------------------------------------
// Key = the raw token + the serialized ctx half(s) — the exact strings that cross the boundary, so
// there is no hash to collide (the token is attacker-controlled; a collidable checksum is out).

const MEMO_MAX = 512;
/** Handlers that read only ctx.build — cache-hot across every play-state change. */
const memoBuild = new Map<string, PluginResult>();
/** Handlers that read ctx.play — re-run whenever play-state changes. */
const memoFull = new Map<string, PluginResult>();

function memoGet(map: Map<string, PluginResult>, key: string): PluginResult | undefined {
	const hit = map.get(key);
	if (hit !== undefined) {
		// touch: re-insert so Map iteration order approximates LRU
		map.delete(key);
		map.set(key, hit);
	}
	return hit;
}
function memoSet(map: Map<string, PluginResult>, key: string, value: PluginResult): void {
	if (map.size >= MEMO_MAX) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) map.delete(oldest);
	}
	map.set(key, value);
}
/** Test/teardown helper: drop all memoized results + failure counts. */
export function clearPluginMemo(): void {
	memoBuild.clear();
	memoFull.clear();
	failCounts.clear();
}

// --- Fail-closed counter (§5: 3 consecutive failures disable the plugin for the session) --------
// Keyed by (namespace, characterId): a handler that fails only on ONE character's ctx (a bug at a
// high level, a ctx field that character lacks) must NOT disable the plugin for OTHER characters.
// The disabled state belongs to the exact plugin×character pair and persists per character.

const failCounts = new Map<string, number>();
/** NUL joins the two parts — neither a namespace (grammar `[a-z0-9-]`) nor a character id contains it. */
const failKey = (namespace: string, scope: string): string => `${namespace}\0${scope}`;
const isDisabled = (key: string): boolean => (failCounts.get(key) ?? 0) >= MAX_CONSECUTIVE_FAILURES;
function noteFailure(key: string): void {
	failCounts.set(key, (failCounts.get(key) ?? 0) + 1);
}
function noteSuccess(key: string): void {
	failCounts.delete(key);
}

// --- The pre-pass ------------------------------------------------------------------------------

export interface PluginExpansion {
	/** Synthetic carriers for returned `tokens` — fold at the CARRYING effect's layer with its
	 *  source (§4.4a attribution); consumed by a second `collectFacts` merge. */
	syntheticEffects: ActiveEffect[];
	/** Pre-folded `contributions`, host-stamped `"<namespace>: <label>"` (PLG-SEC 16) as NumericFacts. */
	numeric: NumericFact[];
	/** Plain-text notes for the effects panel (§4.3; rendered as text ONLY — PLG-SEC 3). */
	notes: { source: string; text: string }[];
	/** Failed/unavailable plugin tokens — the same inert-note channel unknown tokens use. */
	unknown: { source: string; token: string }[];
}

const emptyExpansion = (): PluginExpansion => ({
	syntheticEffects: [],
	numeric: [],
	notes: [],
	unknown: []
});

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Resolve every `plugin:` token in the resolved effect list — once per DISTINCT token (memoized),
 * applied once per CARRYING occurrence (§4.4a). Returns `null` when no plugin token is present
 * (the ~always fast path: zero cost without plugins). Failures degrade per-token to inert notes
 * + an `issues` entry; the aggregate budget degrades the REMAINDER once exhausted.
 *
 * `scope` is the character identity (`character.id`) — the fail-closed counter is keyed per
 * (namespace, scope) so one character's ctx can't disable the plugin for another (see `failKey`).
 */
export function expandPluginEffects(
	effects: ActiveEffect[],
	ctx: PluginCtx,
	issues: EffectIssue[],
	scope = ''
): PluginExpansion | null {
	let any = false;
	for (const eff of effects) {
		for (const t of eff.tokens) if (parseToken(t).kind === EFFECT_KIND.plugin) any = true;
		if (any) break;
	}
	if (!any) return null;

	const out = emptyExpansion();
	const buildJson = JSON.stringify(ctx.build);
	const playJson = JSON.stringify(ctx.play);
	const t0 = now();
	let overBudget = false;

	const degrade = (eff: ActiveEffect, token: string, reason: string): void => {
		out.unknown.push({ source: eff.source, token });
		issues.push({ source: eff.source, token, reason });
	};

	for (const eff of effects) {
		for (const token of eff.tokens) {
			const p = parseToken(token);
			if (p.kind !== EFFECT_KIND.plugin || !p.plugin) continue;
			const { namespace, handlerName, args } = p.plugin;
			const ref: PluginTokenRef = { namespace, handlerName, args, raw: token };
			// fail-closed counter is per (namespace, character) — a fail on THIS character only
			const fkey = failKey(namespace, scope);

			if (!evaluator) {
				degrade(eff, token, 'plugin not available (no plugins enabled)');
				continue;
			}
			if (isDisabled(fkey)) {
				degrade(eff, token, 'plugin disabled after repeated failures');
				continue;
			}
			if (!evaluator.has(namespace, handlerName)) {
				degrade(
					eff,
					token,
					`plugin "${namespace}" missing/disabled or handler "${handlerName}" not registered`
				);
				continue;
			}

			// memo lookup: build-only first (the common, cache-hot case), then the full key
			const keyB = JSON.stringify([token, buildJson]);
			const keyF = JSON.stringify([token, buildJson, playJson]);
			let result = memoGet(memoBuild, keyB) ?? memoGet(memoFull, keyF);

			if (!result) {
				if (overBudget || now() - t0 > AGGREGATE_BUDGET_MS) {
					overBudget = true;
					degrade(eff, token, 'plugin budget for this computation exhausted');
					continue;
				}
				const outcome = evaluator.call(ref, buildJson, playJson);
				if (!outcome.ok) {
					noteFailure(fkey);
					degrade(
						eff,
						token,
						isDisabled(fkey) ? `${outcome.reason}; plugin disabled for the session` : outcome.reason
					);
					continue;
				}
				const v = validateResult(outcome.resultJson);
				if (!v.ok) {
					noteFailure(fkey);
					degrade(
						eff,
						token,
						isDisabled(fkey) ? `${v.reason}; plugin disabled for the session` : v.reason
					);
					continue;
				}
				noteSuccess(fkey);
				result = v.result;
				memoSet(outcome.readPlay ? memoFull : memoBuild, outcome.readPlay ? keyF : keyB, result);
			}

			applyResult(out, eff, namespace, token, result);
		}
	}
	return out;
}

/** Fold one validated result into the expansion, attributed to the CARRYING effect (§4.4a). */
function applyResult(
	out: PluginExpansion,
	eff: ActiveEffect,
	namespace: string,
	token: string,
	result: PluginResult
): void {
	if (result.tokens?.length) {
		// nested `plugin:` tokens are IGNORED (no recursion — §4.3)
		const tokens = result.tokens.filter((t) => parseToken(t).kind !== EFFECT_KIND.plugin);
		if (tokens.length)
			out.syntheticEffects.push({
				source: `${eff.source} · ${namespace}`,
				layer: eff.layer,
				tokens,
				...(eff.classId !== undefined ? { classId: eff.classId } : {})
			});
	}
	for (const [target, contribs] of Object.entries(result.contributions ?? {})) {
		for (const c of contribs) {
			out.numeric.push({
				target,
				op: c.op,
				layer: c.layer,
				// host-stamped provenance: a plugin cannot masquerade as core math (PLG-SEC 16)
				source: `${namespace}: ${c.label ?? token}`,
				token,
				amount: c.amount
			});
		}
	}
	for (const text of result.notes ?? [])
		out.notes.push({ source: `${eff.source} · ${namespace}`, text });
}

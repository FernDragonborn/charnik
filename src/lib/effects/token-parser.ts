/*
 * L1 effect vocabulary — the token PARSER + per-token value resolution.
 *
 * The effects engine is an ISOLATED, optional, removable module: it interprets the BOUNDED effect
 * vocabulary (data, never `eval`/a DSL — a security property, see docs/SECURITY.md). The rules
 * core has NO dependency on it; deleting `src/lib/effects/` leaves the core's {value,trace,notes}
 * contract intact. This module may import core TYPES (pipeline), never the reverse.
 *
 * `parseToken` is the SINGLE interpreter of the token grammar (`kind:target:value`, optional
 * `guard ?`). Naming rule: a raw string is a "token" until `parseToken` turns it into an object,
 * after which it is an "effect" (`ParsedEffect`). `resolveEffectValue` bridges to L2 — it
 * evaluates a token's value expression. The fold seam that consumes these lives in apply.ts.
 */
import type { Layer } from '../rules/pipeline';
import type { Recharge } from '../rules/spellcasting';
import { evalExpression, diceToFormula, type ExprContext } from './expression-evaluator';

/** The bounded effect vocabulary, as named constants — compare against these, never bare strings. */
export const EFFECT_KIND = {
	flatBonus: 'flat_bonus',
	setOverride: 'set_override',
	advantage: 'advantage',
	disadvantage: 'disadvantage',
	grantProficiency: 'grant_proficiency',
	resistImmune: 'resist_immune',
	applyCondition: 'apply_condition',
	grantResource: 'grant_resource',
	// L1 roll-manipulation (the bounded, known set — NOT L3): the roll path consumes these facts.
	reroll: 'reroll', // `reroll:<target>:<threshold>` — reroll a die that lands ≤ threshold (GWF ≤2)
	minDie: 'min_die', // `min_die:<target>:<floor>` — treat a die result below floor AS floor (Reliable Talent d20→10)
	// Roll-OUTCOME overrides (not a die modifier — the result is forced regardless of the roll):
	// paralyzed/stunned auto-fail STR & DEX saves; a rare few auto-succeed. `auto_fail:<target>` /
	// `auto_succeed:<target>`, mirroring advantage/disadvantage (a fact + a note, matched by target).
	autoFail: 'auto_fail',
	autoSucceed: 'auto_succeed',
	// DISPLAY-ONLY free text (`note:<text>`): a rules effect the engine can't model on a single-
	// character sheet (attacks AGAINST you, auto-crit, sense-gated or relational effects). It never
	// folds and matches no target — it's shown, distinctly styled, so the mechanic is visible even
	// though it isn't auto-applied. Text is free-form (keeps its casing; `;` is the list separator).
	note: 'note',
	// L3 handler REFERENCE (`plugin:<namespace>:<handlerName>[:<args>]`) — content never contains code, only this
	// pointer; the derive pre-pass resolves it through the plugin registry (docs/PLUGINS.md §1).
	// Missing/disabled/errored plugin → the token degrades to an inert note like any unknown.
	plugin: 'plugin'
} as const;
export type EffectKind = (typeof EFFECT_KIND)[keyof typeof EFFECT_KIND];
/** The kinds as a list (for schema validation / the `includes` guard). */
export const EFFECT_KINDS = Object.values(EFFECT_KIND) as readonly EffectKind[];

// Recharge's single owner is rules/spellcasting (D11); re-exported here so token consumers keep
// importing it from the effects surface they already use.
export type { Recharge };
export type Defense = 'resist' | 'immune' | 'vulnerable';

/** Numeric caps on token values (cost, not game balance — content is untrusted input). Two classes:
 *  a bonus/override is only STORED and rendered as a scalar → a generous finite guard is enough (a
 *  +1e6 AC is silly, not dangerous); a resource `max` DRIVES the pip render loop (see AUDIT B10) →
 *  bound the WORK. Values past a cap are clamped, not dropped, so a typo still parses. */
const MAX_EFFECT_AMOUNT = 1_000_000;
export const MAX_RESOURCE_MAX = 1000;
const clampAmount = (n: number) =>
	Number.isFinite(n) ? Math.max(-MAX_EFFECT_AMOUNT, Math.min(MAX_EFFECT_AMOUNT, n)) : 0;

export interface ParsedEffect {
	kind: EffectKind | 'unknown';
	target?: string;
	/** Numeric flat bonus / override value (present when the value slot is a plain literal). */
	amount?: number;
	/** Dice bonus (e.g. "1d4" / "-1d4") — a roll modifier, not a flat number. */
	dice?: string;
	/** L2 value expression (`ceil(level/2)`, `class_level.monk`) when the value slot is NOT a plain
	 *  literal — resolved against a ctx at derive time by `resolveEffectValue`, not here. Present on
	 *  `flat_bonus` / `set_override` (the stat value) and mirrored by `resource.max` below. */
	valueExpr?: string;
	/** resist_immune: which bucket (defaults to 'resist' when the token omits it). */
	defense?: Defense;
	/** grant_proficiency: the LEVEL granted — one ladder value, not two booleans, so "expertise
	 *  without proficiency" is unrepresentable (expertise sits above proficient on the ladder). */
	proficiency?: 'proficient' | 'expertise';
	/** grant_resource: the fully-specified pool (only present when `id:max:recharge` is given). `max`
	 *  is a literal count; `maxExpr` is an L2 expression for it (`class_level.monk`) resolved at
	 *  derive time — exactly one of the two is set. */
	resource?: { id: string; max?: number; maxExpr?: string; recharge: Recharge };
	/** plugin: the parsed handler reference. `args` is OPAQUE, hostile text the handler must parse
	 *  defensively (docs/PLUGINS.md §1) — never interpreted here. */
	plugin?: { namespace: string; handlerName: string; args: string };
	raw: string;
}

/** Parse results memoized by token string — consumers scan tokens per stat per derive (AUDIT D7
 *  perf), and a `ParsedEffect` is read-only by contract. Bounded like the expression parser's cache. */
const EFFECT_CACHE = new Map<string, ParsedEffect>();
const EFFECT_CACHE_MAX = 4000;

/**
 * Parse one bounded-vocab token — the SINGLE interpreter of the effect grammar (a security
 * boundary: data, never code). Every consumer reads the structured result instead of its own
 * regex. Unknown / malformed → `{kind:'unknown'}` (kept as an inert text note, never dropped).
 * Memoized; treat the result as immutable.
 */
export function parseToken(token: string): ParsedEffect {
	const hit = EFFECT_CACHE.get(token);
	if (hit) return hit;
	const res = parseTokenUncached(token);
	if (EFFECT_CACHE.size >= EFFECT_CACHE_MAX) EFFECT_CACHE.clear();
	EFFECT_CACHE.set(token, res);
	return res;
}

function parseTokenUncached(token: string): ParsedEffect {
	const p = classifyToken(token);
	// Targets/ids are lowercase snake by convention (E3). Normalize the target HERE (the one parse
	// chokepoint) so an author who types `flat_bonus:AC+2` or `resist_immune:Fire` matches the
	// case-sensitive derive keys instead of silently folding onto nothing (a parsed-but-never-applied
	// no-op — the worst failure for an untrusted CSV). `valueExpr` is untouched (the L2 grammar is
	// already lowercase) and `raw` keeps the author's casing for the inert-note display. `note` is
	// EXEMPT — its "target" is free-form display prose that must keep its casing.
	if (p.kind !== EFFECT_KIND.note && p.target !== undefined && p.target !== p.target.toLowerCase())
		return { ...p, target: p.target.toLowerCase() };
	return p;
}

function classifyToken(token: string): ParsedEffect {
	const raw = token.trim();
	const sep = raw.indexOf(':');
	if (sep === -1) return { kind: 'unknown', raw };
	const kind = raw.slice(0, sep) as EffectKind;
	const rest = raw.slice(sep + 1);
	if (!EFFECT_KINDS.includes(kind)) return { kind: 'unknown', raw };

	if (kind === EFFECT_KIND.flatBonus) {
		// literal fast path — ONE target grammar with the expression path below (snake, single
		// optional dot; `-` is the L2 minus operator, E3): a literal amount/dice never needs a ctx
		const lit = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?)\s*([+-])\s*(\d+d\d+|\d+)$/i.exec(rest);
		if (lit) {
			const target = lit[1] ?? '';
			const sign = lit[2] ?? '';
			const amount = lit[3] ?? '';
			if (/d/i.test(amount)) return { kind, target, dice: (sign === '-' ? '-' : '') + amount, raw };
			return { kind, target, amount: clampAmount(Number(sign + amount)), raw };
		}
		// L2 expression value: `<target><+|->` then an expression. A `-` sign negates the whole value.
		const ex = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?)\s*([+-])\s*(.+)$/i.exec(rest);
		if (!ex) return { kind: 'unknown', raw };
		const valueExpr = ex[2] === '-' ? `-(${(ex[3] ?? '').trim()})` : (ex[3] ?? '').trim();
		return { kind, target: ex[1] ?? '', valueExpr, raw };
	}
	if (kind === EFFECT_KIND.setOverride) {
		const lit = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?):(-?\d+)$/i.exec(rest);
		if (lit) return { kind, target: lit[1] ?? '', amount: clampAmount(Number(lit[2])), raw };
		const ex = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?):(.+)$/i.exec(rest);
		if (!ex) return { kind: 'unknown', raw };
		return { kind, target: ex[1] ?? '', valueExpr: (ex[2] ?? '').trim(), raw };
	}
	if (kind === EFFECT_KIND.resistImmune) {
		// `resist_immune:<type>` (defaults to resistance) or `resist_immune:<bucket>:<type>`
		const m = /^(?:(resist|immune|vulnerable):)?(.+)$/i.exec(rest);
		if (!m?.[2]) return { kind: 'unknown', raw };
		const defense = (m[1]?.toLowerCase() ?? 'resist') as Defense;
		return { kind, defense, target: m[2].trim(), raw };
	}
	if (kind === EFFECT_KIND.grantResource) {
		// `grant_resource:<id>` (bare flag) or `grant_resource:<id>:<max>:<recharge>` where <max> is a
		// literal OR an L2 expression (`class_level.monk`). The recharge keyword anchors the end, so
		// the middle (max) can hold expression characters (`*`, `(`, `,`) unambiguously.
		// Id is snake-only (E3): a kebab pool id would be unreadable from `resource.<id>` expressions.
		const m = /^([a-z0-9][a-z0-9_]*)(?::(.+):(short|long|other))?$/i.exec(rest.trim());
		if (!m?.[1]) return { kind: 'unknown', raw };
		const id = m[1].toLowerCase();
		const maxSlot = m[2]?.trim();
		const recharge = m[3]?.toLowerCase() as Recharge | undefined;
		if (maxSlot && recharge) {
			const resource = /^\d+$/.test(maxSlot)
				? { id, max: Math.min(Number(maxSlot), MAX_RESOURCE_MAX), recharge }
				: { id, maxExpr: maxSlot, recharge };
			return { kind, target: id, resource, raw };
		}
		return { kind, target: id, raw };
	}
	if (kind === EFFECT_KIND.grantProficiency) {
		// `grant_proficiency:[expertise:]<target>` — the target is canonicalized here (the ONE place):
		// a `skill.` prefix strips to the bare skill id (skills are bare in this vocab; only saves
		// carry their `save.` prefix), so authors can write either form without it silently dropping.
		const m = /^(expertise:)?(?:skill\.)?(.+)$/i.exec(rest);
		if (!m?.[2]) return { kind: 'unknown', raw };
		return { kind, target: m[2].trim(), proficiency: m[1] ? 'expertise' : 'proficient', raw };
	}
	if (kind === EFFECT_KIND.plugin) {
		// `plugin:<namespace>:<handlerName>[:<args>]` — grammar + length caps from docs/PLUGINS.md §1. The token is
		// attacker-controlled content; over-cap or malformed → inert unknown (never a partial parse).
		// `args` may itself contain `:` — only the first two separators are structural.
		const m = /^([a-z0-9][a-z0-9-]{0,31}):([a-z0-9][a-z0-9-]{0,31})(?::([\s\S]{0,256}))?$/.exec(
			rest
		);
		if (!m?.[1] || !m[2]) return { kind: 'unknown', raw };
		return { kind, plugin: { namespace: m[1], handlerName: m[2], args: m[3] ?? '' }, raw };
	}
	if (kind === EFFECT_KIND.reroll || kind === EFFECT_KIND.minDie) {
		// `reroll:<target>:<threshold>` / `min_die:<target>:<floor>` — a target plus one integer the
		// roll path reads. Target may be a group (`d20_tests`) or a specific key (`skill.stealth`).
		const m = /^(.+):(\d+)$/.exec(rest);
		if (!m?.[1]) return { kind: 'unknown', raw };
		return { kind, target: m[1].trim(), amount: Number(m[2]), raw };
	}
	// advantage / disadvantage / apply_condition
	return { kind, target: rest, raw };
}

/** A resolved value for a `flat_bonus`/`set_override`/`grant_resource` token: a folded numeric
 *  `amount`, a `diceFormula` (rides the roll path, shown as a note), or an `error` (the L2
 *  expression failed → the token degrades to an inert note; EXPR-3 also routes it to content-health). */
export interface ResolvedValue {
	amount?: number;
	diceFormula?: string;
	error?: string;
}

/**
 * Resolve a token's value slot to a concrete quantity. A plain literal (`amount`/`dice`) passes
 * straight through; an L2 `valueExpr` is evaluated against `ctx` (SPEC2: effective vars) — a numeric
 * result is FLOORED (5e round-down) and cost-clamped, a dice result becomes a roller formula, a
 * failure returns `{error}`. Without a ctx an expression can't resolve (→ error), so the caller
 * degrades it; literals never need a ctx (core-off / no-effects path stays ctx-free).
 */
export function resolveEffectValue(p: ParsedEffect, ctx?: ExprContext): ResolvedValue {
	if (p.amount !== undefined) return { amount: p.amount };
	if (p.dice) return { diceFormula: p.dice };
	if (!p.valueExpr) return {};
	if (!ctx) return { error: 'expression needs a context' };
	const r = evalExpression(p.valueExpr, ctx);
	if (!r.ok) return { error: r.error };
	// `+ 0` normalizes a `-0` (from e.g. `-2*exhaustion` at exhaustion 0) to `0`.
	if (r.value.type === 'number') return { amount: clampAmount(Math.floor(r.value.value) + 0) };
	return { diceFormula: diceToFormula(r.value.dice) };
}

/** A runtime effect source contributing tokens at a pipeline layer. `classId` marks tokens carried
 *  by a specific class's row/feature — SPEC4: their `spellcasting_mod` reads THAT class's mod. */
export interface ActiveEffect {
	source: string;
	layer: Layer;
	tokens: string[];
	classId?: string;
}

/** A ctx, or a per-effect ctx provider (used to scope `spellcasting_mod` to the carrying class). */
export type EffectCtx = ExprContext | ((eff: ActiveEffect) => ExprContext);
export const ctxOf = (ctx: EffectCtx | undefined, eff: ActiveEffect): ExprContext | undefined =>
	typeof ctx === 'function' ? ctx(eff) : ctx;

/** A token split into its optional condition GUARD and the effect part. The L2 guard is
 *  condition-FIRST (`is_raging ? advantage:attack`); `?` never appears elsewhere in the GRAMMAR
 *  (expressions use `if()`, not `?:`, and `:` is structural), so splitting on the first `?` is
 *  unambiguous. Free-text/unknown tokens MAY contain a `?` — their "guard" then fails to evaluate
 *  and the resolve stage keeps them verbatim as inert notes (never dropped). */
export interface GuardedToken {
	guard?: string;
	token: string;
}
export function splitGuard(raw: string): GuardedToken {
	const q = raw.indexOf('?');
	if (q === -1) return { token: raw.trim() };
	return { guard: raw.slice(0, q).trim(), token: raw.slice(q + 1).trim() };
}

/** A derive-time problem with one token — the SPEC10 shape ({token, reason} + the carrying source)
 *  content-health merges with loader issues. */
export interface EffectIssue {
	source: string;
	token: string;
	reason: string;
}

/*
 * L2 value-expression language — the pure EVALUATOR (AST → value, never throws).
 *
 * Walks the `Ast` from expression-parser.ts over an `ExprContext` (the derive ctx; tests supply
 * plain maps). A dice term is DATA (`{pool, flat}`) that rides to the one roller later — never
 * rolled here, so eval is deterministic. An undefined var (→ 0), a type misuse, or a division by
 * zero returns `{ok:false, error}` for the caller to degrade to an inert note (the L1 fallback).
 */
import { MAX_DICE_PER_TERM, MAX_DIE_SIDES } from '../rules/dice';
import {
	parseExpression,
	ENUM_VARS,
	ORDERED_ENUMS,
	type Node,
	type Ast,
	type BinOp
} from './expression-parser';

/* ─────────────────────────── value type ─────────────────────────── */

/** A dice quantity: a pool ({sides: count}) plus a flat modifier, mirroring rules/dice.ts so it
 *  rides the existing roller unchanged. `1d6+3` → `{pool:{6:1}, flat:3}`. */
export interface DiceValue {
	pool: Record<number, number>;
	flat: number;
}

/** The result of evaluating an expression: a plain number OR a dice quantity (PLAN: "int OR dice
 *  formula"). Booleans are represented as the numbers 0/1. */
export type ExprValue = { type: 'number'; value: number } | { type: 'dice'; dice: DiceValue };

/* ─────────────────────────── the context the evaluator reads ─────────────────────────── */

/** How the evaluator resolves variables. EXPR-2/3 implement this over the real derive ctx; tests
 *  implement it from plain maps. An ABSENT whitelisted numeric var resolves to 0 and an absent
 *  boolean to false (PLAN SPEC4) — so shared-pack content (`class_level.rogue` on a non-rogue)
 *  degrades to a benign 0, not a broken token. Only an UNKNOWN name (rejected at parse) fails. */
export interface ExprContext {
	/** Numeric / dotted-numeric variable → its value; undefined ⇒ treated as 0. */
	number(name: string): number | undefined;
	/** Boolean / dotted-boolean flag → its value; undefined ⇒ false. */
	boolean(name: string): boolean | undefined;
	/** Enum variable → its current member string; undefined ⇒ no enum comparison matches. */
	enum(name: string): string | undefined;
}

export type EvalResult = { ok: true; value: ExprValue } | { ok: false; error: string };

/* ─────────────────────────── evaluator (never throws) ─────────────────────────── */

class EvalError extends Error {}

const isDice = (v: ExprValue): v is { type: 'dice'; dice: DiceValue } => v.type === 'dice';
/** The ONE constructor of a numeric value — so a single finite-guard covers every arithmetic path.
 *  A huge literal (`999…` → Infinity), an overflowing product, or an `Inf-Inf`/`0*Inf` (→ NaN) is
 *  rejected HERE as a structured error rather than leaking a non-finite number into a character stat
 *  (the whole point of the fail-closed contract). Booleans (num(0)/num(1)) are always finite. */
const num = (n: number): ExprValue => {
	if (!Number.isFinite(n)) throw new EvalError('result is not a finite number');
	return { type: 'number', value: n };
};

/** A number operand required where an expression yielded dice → an error (e.g. dice as a die-size,
 *  or a comparison on dice). Extracts the JS number or throws EvalError. */
function asNumber(v: ExprValue): number {
	if (isDice(v)) throw new EvalError('a dice term cannot be used as a plain number here');
	return v.value;
}

/** Add two values: number+number, or fold a number into a dice flat, or merge two dice pools. */
function addValues(a: ExprValue, b: ExprValue): ExprValue {
	if (!isDice(a) && !isDice(b)) return num(a.value + b.value);
	const da: DiceValue = isDice(a) ? a.dice : { pool: {}, flat: a.value };
	const db: DiceValue = isDice(b) ? b.dice : { pool: {}, flat: b.value };
	const pool: Record<number, number> = { ...da.pool };
	// per-side cap holds under repeated ADDITION too, not only at the dice term (`1000d6+1000d6+…`
	// within the length cap could otherwise pile ~73k dice past the cost bound)
	for (const [s, c] of Object.entries(db.pool))
		pool[Number(s)] = Math.min((pool[Number(s)] ?? 0) + c, MAX_DICE_PER_TERM);
	return { type: 'dice', dice: { pool, flat: da.flat + db.flat } };
}

function evalNode(n: Node, ctx: ExprContext): ExprValue {
	switch (n.t) {
		case 'num':
			return num(n.value);
		case 'numvar':
			return num(ctx.number(n.name) ?? 0);
		case 'boolvar':
			return num(ctx.boolean(n.name) ? 1 : 0);
		case 'enumvar':
			// An enum variable is only meaningful inside a comparison (handled there). Bare use is an error.
			throw new EvalError(`enum '${n.name}' can only be compared, not used as a value`);
		case 'enumlit':
			throw new EvalError(`'${n.name}' is only valid in an enum comparison`);
		case 'neg':
			return num(-asNumber(evalNode(n.e, ctx)));
		case 'not':
			return num(truthy(evalNode(n.e, ctx)) ? 0 : 1);
		case 'dice':
			return evalDice(n, ctx);
		case 'bin':
			return evalBin(n, ctx);
		case 'call':
			return evalCall(n, ctx);
	}
}

function truthy(v: ExprValue): boolean {
	return asNumber(v) !== 0;
}

function evalDice(n: { count: Node; sides: Node }, ctx: ExprContext): ExprValue {
	const count = Math.floor(asNumber(evalNode(n.count, ctx)));
	const sides = Math.floor(asNumber(evalNode(n.sides, ctx)));
	// amount clamps ≥0 (a negative count rolls nothing); sides ≥1; both cost-capped
	const c = Math.max(0, Math.min(count, MAX_DICE_PER_TERM));
	const s = Math.max(1, Math.min(sides, MAX_DIE_SIDES));
	return { type: 'dice', dice: { pool: c > 0 ? { [s]: c } : {}, flat: 0 } };
}

function evalBin(n: { op: BinOp; l: Node; r: Node }, ctx: ExprContext): ExprValue {
	const { op } = n;
	// enum comparison: one side an enum var, the other an enum literal
	if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
		if (isEnumCompare(n.l, n.r)) return evalEnumCompare(op, n.l, n.r, ctx);
	}
	// boolean short-circuit
	if (op === 'and') return num(truthy(evalNode(n.l, ctx)) && truthy(evalNode(n.r, ctx)) ? 1 : 0);
	if (op === 'or') return num(truthy(evalNode(n.l, ctx)) || truthy(evalNode(n.r, ctx)) ? 1 : 0);

	const l = evalNode(n.l, ctx);
	const r = evalNode(n.r, ctx);
	switch (op) {
		case '+':
			return addValues(l, r);
		case '-':
			return addValues(l, num(-asNumber(r))); // dice - number allowed; number/dice - dice handled by asNumber guard
		case '*': {
			// dice * integer scales the pool; otherwise numeric
			if (isDice(l) || isDice(r)) return scaleDice(l, r);
			return num(l.value * r.value);
		}
		case '/': {
			const rv = asNumber(r);
			if (rv === 0) throw new EvalError('division by zero');
			return num(asNumber(l) / rv); // exact intermediate; caller floors the final stat value
		}
		case '%': {
			const rv = asNumber(r);
			if (rv === 0) throw new EvalError('modulo by zero');
			return num(asNumber(l) % rv);
		}
		case '<':
			return num(asNumber(l) < asNumber(r) ? 1 : 0);
		case '<=':
			return num(asNumber(l) <= asNumber(r) ? 1 : 0);
		case '>':
			return num(asNumber(l) > asNumber(r) ? 1 : 0);
		case '>=':
			return num(asNumber(l) >= asNumber(r) ? 1 : 0);
		case '==':
			return num(asNumber(l) === asNumber(r) ? 1 : 0);
		case '!=':
			return num(asNumber(l) !== asNumber(r) ? 1 : 0);
		default:
			throw new EvalError(`unhandled operator '${op}'`);
	}
}

/** dice × integer: scale the pool counts and flat by the integer factor. */
function scaleDice(a: ExprValue, b: ExprValue): ExprValue {
	const d: DiceValue = isDice(a) ? a.dice : isDice(b) ? b.dice : { pool: {}, flat: 0 };
	const factorV = isDice(a) ? b : a;
	if (isDice(factorV)) throw new EvalError('cannot multiply a dice term by a dice term');
	const factor = Math.floor(factorV.value);
	const pool: Record<number, number> = {};
	for (const [s, c] of Object.entries(d.pool)) {
		// a zero/negative factor scales the count to nothing — drop the side entirely rather than
		// leave a `{6:0}` entry (which serializes to junk "0d6"); matches evalDice's `0d6` → {}
		const scaled = Math.max(0, Math.min(c * factor, MAX_DICE_PER_TERM));
		if (scaled > 0) pool[Number(s)] = scaled;
	}
	return { type: 'dice', dice: { pool, flat: d.flat * factor + 0 } }; // +0 normalizes -0 → 0
}

function isEnumCompare(l: Node, r: Node): boolean {
	const kinds = new Set([l.t, r.t]);
	return kinds.has('enumvar') && kinds.has('enumlit');
}

function evalEnumCompare(op: BinOp, l: Node, r: Node, ctx: ExprContext): ExprValue {
	const varNode = (l.t === 'enumvar' ? l : r) as { t: 'enumvar'; name: string };
	const litNode = (l.t === 'enumlit' ? l : r) as { t: 'enumlit'; name: string };
	const members = ENUM_VARS[varNode.name] ?? [];
	// authoring errors FIRST — a wrong literal / ordinal-on-unordered must say so even when the
	// variable happens to be absent (absence must not mask the mistake)
	if (!members.includes(litNode.name))
		throw new EvalError(`'${litNode.name}' is not a value of ${varNode.name}`);
	if (op !== '==' && op !== '!=' && !ORDERED_ENUMS.has(varNode.name))
		throw new EvalError(`${varNode.name} is unordered; only == and != apply`);
	const current = ctx.enum(varNode.name);
	// absent enum var → NO comparison matches (SPEC4 fail-closed) — `!=` included, else a missing
	// play ctx would satisfy every negative guard
	if (current === undefined) return num(0);
	if (op === '==') return num(current === litNode.name ? 1 : 0);
	if (op === '!=') return num(current !== litNode.name ? 1 : 0);
	const ci = members.indexOf(current);
	const li = members.indexOf(litNode.name);
	if (ci === -1) return num(0);
	const r2 = op === '<' ? ci < li : op === '<=' ? ci <= li : op === '>' ? ci > li : ci >= li;
	return num(r2 ? 1 : 0);
}

function evalCall(n: { fn: string; args: Node[] }, ctx: ExprContext): ExprValue {
	// `if` is special: it must NOT eagerly evaluate both branches (only the taken branch's type
	// decides the result type, PLAN SPEC5), and a dead branch may legitimately be dice.
	if (n.fn === 'if') {
		const cond = truthy(evalNode(n.args[0] as Node, ctx));
		return evalNode((cond ? n.args[1] : n.args[2]) as Node, ctx);
	}
	const a = n.args.map((x) => asNumber(evalNode(x, ctx)));
	switch (n.fn) {
		case 'min':
			return num(Math.min(...a));
		case 'max':
			return num(Math.max(...a));
		case 'floor':
			return num(Math.floor(a[0] as number));
		case 'ceil':
			return num(Math.ceil(a[0] as number));
		case 'round':
			return num(Math.round(a[0] as number));
		case 'abs':
			return num(Math.abs(a[0] as number));
		case 'sign':
			return num(Math.sign(a[0] as number));
		case 'clamp': {
			const [x, lo, hi] = a as [number, number, number];
			return num(Math.max(lo, Math.min(hi, x)));
		}
		default:
			throw new EvalError(`unknown function '${n.fn}'`);
	}
}

/** Evaluate a parsed expression against a context. Never throws — an undefined-var (handled as 0),
 *  a type misuse, or a division by zero returns `{ok:false, error}` for the caller to degrade. */
export function evaluate(ast: Ast, ctx: ExprContext): EvalResult {
	try {
		return { ok: true, value: evalNode(ast.root, ctx) };
	} catch (e) {
		return { ok: false, error: e instanceof EvalError ? e.message : 'evaluation failed' };
	}
}

/** Parse + evaluate in one step (convenience for callers that don't cache the AST). */
export function evalExpression(src: string, ctx: ExprContext): EvalResult {
	const p = parseExpression(src);
	if (!p.ok) return p;
	return evaluate(p.ast, ctx);
}

/* ─────────────────────────── static lint (authoring warnings, PLAN SPEC5/dice-note) ─────────────────────────── */

/** D&D's standard dice; anything else is legal homebrew but soft-warned (`d7` is usually a typo). */
const STANDARD_SIDES = new Set([2, 3, 4, 6, 8, 10, 12, 20, 100]);

/** Static type of a node: 'number', 'dice', or 'either' (depends on runtime state). */
function staticKind(n: Node): 'number' | 'dice' | 'either' {
	switch (n.t) {
		case 'dice':
			return 'dice';
		case 'bin': {
			if (n.op === '+' || n.op === '-' || n.op === '*') {
				const l = staticKind(n.l);
				const r = staticKind(n.r);
				if (l === 'dice' || r === 'dice') return 'dice';
				if (l === 'either' || r === 'either') return 'either';
			}
			return 'number';
		}
		case 'call': {
			if (n.fn !== 'if') return 'number';
			const a = staticKind(n.args[1] as Node);
			const b = staticKind(n.args[2] as Node);
			return a === b ? a : 'either';
		}
		default:
			return 'number';
	}
}

/** Authoring-slip warnings the spec promises content-health (PLAN EXPR): a mixed-type `if()`
 *  (dice in one branch, number in the other — legal but usually an accident) and a non-standard
 *  LITERAL die size (`1d7`). Returns [] for an unparseable expression — parse errors are the
 *  eval path's job, not the linter's. */
export function lintExpression(src: string): string[] {
	const p = parseExpression(src);
	if (!p.ok) return [];
	const warns: string[] = [];
	const walk = (n: Node): void => {
		if (n.t === 'call' && n.fn === 'if') {
			const a = staticKind(n.args[1] as Node);
			const b = staticKind(n.args[2] as Node);
			if (a !== b) warns.push('if() branches differ in type (dice vs number)');
		}
		if (n.t === 'dice' && n.sides.t === 'num' && !STANDARD_SIDES.has(n.sides.value))
			warns.push(`unusual die d${n.sides.value}`);
		switch (n.t) {
			case 'neg':
			case 'not':
				walk(n.e);
				break;
			case 'dice':
				walk(n.count);
				walk(n.sides);
				break;
			case 'bin':
				walk(n.l);
				walk(n.r);
				break;
			case 'call':
				n.args.forEach(walk);
				break;
		}
	};
	walk(p.ast.root);
	return warns;
}

/** Variable names an expression READS (feeds the dependency-order DAG: a token whose expression
 *  reads `str_mod` must resolve after effects that WRITE the STR score). Numeric + boolean vars
 *  only — enum vars (`armor_type`, `size`) are static play-state no effect can write. Returns []
 *  for an unparseable expression (error surfacing is the eval path's job). */
export function collectExprVariables(src: string): string[] {
	const p = parseExpression(src);
	if (!p.ok) return [];
	const names = new Set<string>();
	const walk = (n: Node): void => {
		switch (n.t) {
			case 'numvar':
			case 'boolvar':
				names.add(n.name);
				break;
			case 'neg':
			case 'not':
				walk(n.e);
				break;
			case 'dice':
				walk(n.count);
				walk(n.sides);
				break;
			case 'bin':
				walk(n.l);
				walk(n.r);
				break;
			case 'call':
				n.args.forEach(walk);
				break;
			default:
				break;
		}
	};
	walk(p.ast.root);
	return [...names];
}

/** Serialize a dice value to a formula string the roller (rules/dice.ts) accepts: "2d6+1d4+3". */
export function diceToFormula(d: DiceValue): string {
	const terms = Object.entries(d.pool)
		.sort((a, b) => Number(b[0]) - Number(a[0]))
		.map(([s, c]) => `${c}d${s}`);
	if (d.flat > 0) terms.push(String(d.flat));
	else if (d.flat < 0) terms.push(String(d.flat)); // keep the sign
	return terms.join('+').replace(/\+-/g, '-') || '0';
}

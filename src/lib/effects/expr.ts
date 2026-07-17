/*
 * L2 value-expression language — the pure parser + evaluator (EXPR-1).
 *
 * This is the safe formula layer between L1 (literal tokens) and L3 (sandboxed plugins): a token's
 * VALUE or a conditional GUARD can be a bounded expression (`ceil(level/2)`, `is_raging`,
 * `armor_type==none`) instead of only a literal. It is NON-Turing-complete BY CONSTRUCTION — no
 * loops, no recursion, no assignment, no `eval`, whitelisted variables + functions only — so it
 * terminates on every input and has zero sandbox/attack surface (see docs/SECURITY.md #4, PLAN.md
 * EXPR). It NEVER throws: a malformed expression, an unknown variable, or a division by zero returns
 * a structured error the caller degrades to an inert note (the L1 fallback), exactly like an unknown
 * token.
 *
 * This module is pure: no derive wiring, no rolling. A dice term is DATA (`{pool, flat}`) that rides
 * to the one dice roller later (EXPR-2) — never rolled here, so evaluation is deterministic. The
 * grammar, precedence, variable set, and semantics are pinned in docs/PLAN.md → "EXPR".
 */

// Cost caps: a dice count/sides drives a roll loop later, so an untrusted formula must not request a
// billion dice. The dice caps are the roller's own (one owner in rules/dice.ts); values are clamped,
// not rejected, so a typo still yields something. Depth/length bound the parser itself against a
// pathological nesting bomb.
import { ABILITY_IDS, SIZES, ARMOR_TYPES } from '../rules/core';
import { MAX_DICE_PER_TERM, MAX_DIE_SIDES } from '../rules/dice';

const MAX_DEPTH = 32;
const MAX_LENGTH = 512;

/* ─────────────────────────── whitelist (enforced at parse) ─────────────────────────── */

/** Exact-name numeric variables (the build/derived + play numbers). Ability mod/score names are
 *  generated from ABILITIES so they can never drift out of sync. */
const NUMERIC_VARS: ReadonlySet<string> = new Set<string>([
	'level',
	'proficiency_bonus',
	'spellcasting_mod',
	'base_speed',
	// play-state numbers (read by guards; EXPR-3 resolves them, EXPR-1 just accepts the names)
	'hp',
	'hp_max',
	'hp_percent',
	'temp_hp',
	'exhaustion',
	...ABILITY_IDS.map((a) => `${a}_mod`),
	...ABILITY_IDS.map((a) => `${a}_score`)
]);

/** Boolean flags (0/1). Always `is_`-prefixed so a flag never reads as a bare enum literal. */
const BOOLEAN_VARS: ReadonlySet<string> = new Set<string>([
	'is_bloodied',
	'is_raging',
	'is_concentrating',
	'is_wearing_armor',
	'is_wearing_shield'
]);

/** Enum-typed variables → their allowed literal values. A literal is valid ONLY when compared
 *  (`==`/`!=`, plus ordinal `<`/`<=`/`>`/`>=` for ORDERED enums) against a variable of its enum. */
const ENUM_VARS: Readonly<Record<string, readonly string[]>> = {
	armor_type: ARMOR_TYPES,
	size: SIZES
};
/** Enums whose members have a meaningful order (so `<`/`>` compare by index). `armor_type` is a
 *  bag (only `==`/`!=`); `size` is a ladder. */
const ORDERED_ENUMS: ReadonlySet<string> = new Set(['size']);
/** Every enum literal across all enums — the set a bare word must belong to, to parse at all. */
const ENUM_LITERALS: ReadonlySet<string> = new Set(Object.values(ENUM_VARS).flat());

/** Dotted variable families: `<prefix>.<id>`. The id is opaque (a class/condition/resource id).
 *  Exported so the ctx adapter (context.ts) routes off the SAME sets — one grammar owner. */
export const DOTTED_NUMERIC: ReadonlySet<string> = new Set([
	'class_level',
	'resource',
	'resource_max'
]);
export const DOTTED_BOOLEAN: ReadonlySet<string> = new Set(['has_condition']);

/** Split a dotted variable name into its family prefix + opaque id, or null when undotted.
 *  Shared by the parser (whitelist check) and the ctx adapter (routing). */
export function splitDottedName(name: string): { prefix: string; id: string } | null {
	const dot = name.indexOf('.');
	if (dot === -1) return null;
	return { prefix: name.slice(0, dot), id: name.slice(dot + 1) };
}

/** Whitelisted functions → allowed arity range [min, max]. NOTHING else is callable. */
const FUNCTIONS: Readonly<Record<string, { min: number; max: number }>> = {
	if: { min: 3, max: 3 },
	min: { min: 1, max: Infinity },
	max: { min: 1, max: Infinity },
	floor: { min: 1, max: 1 },
	ceil: { min: 1, max: 1 },
	round: { min: 1, max: 1 },
	abs: { min: 1, max: 1 },
	clamp: { min: 3, max: 3 },
	sign: { min: 1, max: 1 }
};

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

/* ─────────────────────────── AST ─────────────────────────── */

type BinOp = '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=' | 'and' | 'or';

type Node =
	| { t: 'num'; value: number }
	| { t: 'numvar'; name: string }
	| { t: 'boolvar'; name: string }
	| { t: 'enumvar'; name: string }
	| { t: 'enumlit'; name: string }
	| { t: 'neg'; e: Node }
	| { t: 'not'; e: Node }
	| { t: 'dice'; count: Node; sides: Node }
	| { t: 'bin'; op: BinOp; l: Node; r: Node }
	| { t: 'call'; fn: string; args: Node[] };

export interface Ast {
	root: Node;
}

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

/* ─────────────────────────── results (never throw) ─────────────────────────── */

export type ParseResult = { ok: true; ast: Ast } | { ok: false; error: string };
export type EvalResult = { ok: true; value: ExprValue } | { ok: false; error: string };

/* ─────────────────────────── tokenizer ─────────────────────────── */

type Tok =
	| { k: 'num'; v: number }
	| { k: 'ident'; v: string }
	| { k: 'op'; v: string } // + - * / % ( ) , and comparison operators
	| { k: 'dice' }; // the `d` dice operator (disambiguated from identifiers here)

const COMPARE_STARTS = new Set(['<', '>', '=', '!']);

/** Split source into tokens. The `d` dice operator is the one hard case: `d` is also a letter, so
 *  `1d6` would lex as num(1)+ident("d6"). We resolve it positionally — a `d` is the dice operator
 *  ONLY when the previous token is a number or `)` (a left operand) and it is not part of a longer
 *  identifier in that position. In every valid expression an identifier starting with `d`
 *  (`dex_mod`) follows an operator/`(`/`,`/start, never a number/`)`, so the rule is unambiguous. */
function tokenize(src: string): { ok: true; toks: Tok[] } | { ok: false; error: string } {
	const toks: Tok[] = [];
	let i = 0;
	const prevIsOperand = () => {
		const p = toks[toks.length - 1];
		return !!p && (p.k === 'num' || (p.k === 'op' && p.v === ')'));
	};
	while (i < src.length) {
		const c = src[i] ?? '';
		if (c === ' ' || c === '\t') {
			i++;
			continue;
		}
		if (c >= '0' && c <= '9') {
			let j = i;
			while (j < src.length && (src[j] ?? '') >= '0' && (src[j] ?? '') <= '9') j++;
			toks.push({ k: 'num', v: Number(src.slice(i, j)) });
			i = j;
			continue;
		}
		// dice operator: a lone `d` right after an operand
		if (c === 'd' && prevIsOperand()) {
			toks.push({ k: 'dice' });
			i++;
			continue;
		}
		if ((c >= 'a' && c <= 'z') || c === '_') {
			let j = i;
			while (j < src.length) {
				const ch = src[j] ?? '';
				const idChar =
					(ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_' || ch === '.';
				if (!idChar) break;
				j++;
			}
			toks.push({ k: 'ident', v: src.slice(i, j) });
			i = j;
			continue;
		}
		if (
			c === '(' ||
			c === ')' ||
			c === ',' ||
			c === '+' ||
			c === '-' ||
			c === '*' ||
			c === '/' ||
			c === '%'
		) {
			toks.push({ k: 'op', v: c });
			i++;
			continue;
		}
		if (COMPARE_STARTS.has(c)) {
			const two = src.slice(i, i + 2);
			if (two === '<=' || two === '>=' || two === '==' || two === '!=') {
				toks.push({ k: 'op', v: two });
				i += 2;
				continue;
			}
			if (c === '<' || c === '>') {
				toks.push({ k: 'op', v: c });
				i++;
				continue;
			}
			return { ok: false, error: `stray '${c}' (use ==, !=, <=, >=)` };
		}
		return { ok: false, error: `unexpected character '${c}'` };
	}
	return { ok: true, toks };
}

/* ─────────────────────────── parser (recursive descent, precedence ladder) ─────────────────────────── */

/** Precedence, loosest→tightest, matches PLAN: or → and → not → comparison → +/- → * / % →
 *  unary(-) → dice → primary. `not` is a low-precedence prefix; unary `-` is high (just above dice).
 *  A `ParseError` is thrown INTERNALLY and caught at the entry point — it never escapes the module. */
class ParseError extends Error {}

function parse(toks: Tok[]): Node {
	let pos = 0;
	let depth = 0;

	const peek = (): Tok | undefined => toks[pos];
	const eat = (): Tok => {
		const t = toks[pos];
		if (!t) throw new ParseError('unexpected end of expression');
		pos++;
		return t;
	};
	const isOp = (v: string): boolean => {
		const t = peek();
		return !!t && t.k === 'op' && t.v === v;
	};
	const isIdentWord = (v: string): boolean => {
		const t = peek();
		return !!t && t.k === 'ident' && t.v === v;
	};
	const guardDepth = () => {
		if (++depth > MAX_DEPTH) throw new ParseError('expression nested too deeply');
	};

	const parseExpr = (): Node => parseOr();

	function parseOr(): Node {
		let l = parseAnd();
		while (isIdentWord('or')) {
			eat();
			l = { t: 'bin', op: 'or', l, r: parseAnd() };
		}
		return l;
	}
	function parseAnd(): Node {
		let l = parseNot();
		while (isIdentWord('and')) {
			eat();
			l = { t: 'bin', op: 'and', l, r: parseNot() };
		}
		return l;
	}
	function parseNot(): Node {
		if (isIdentWord('not')) {
			eat();
			guardDepth();
			const e = { t: 'not', e: parseNot() } as const;
			depth--;
			return e;
		}
		return parseComparison();
	}
	function parseComparison(): Node {
		const isCompareOp = (): string | null => {
			const t = peek();
			if (!t || t.k !== 'op') return null;
			return ['<', '<=', '>', '>=', '==', '!='].includes(t.v) ? t.v : null;
		};
		let l = parseAddSub();
		const op = isCompareOp();
		if (op) {
			eat();
			l = { t: 'bin', op: op as BinOp, l, r: parseAddSub() };
			// non-associative BY DESIGN: `5<=level<=10` would silently parse as `(5<=level)<=10`
			// (always true) — an authoring trap, so a chain is a parse error, not a wrong answer.
			if (isCompareOp())
				throw new ParseError("chained comparisons are not supported (use 'and': a<=x and x<=b)");
		}
		return l;
	}
	function parseAddSub(): Node {
		let l = parseMulDiv();
		while (isOp('+') || isOp('-')) {
			const op = eat() as { k: 'op'; v: '+' | '-' };
			l = { t: 'bin', op: op.v, l, r: parseMulDiv() };
		}
		return l;
	}
	function parseMulDiv(): Node {
		let l = parseUnary();
		while (isOp('*') || isOp('/') || isOp('%')) {
			const op = eat() as { k: 'op'; v: '*' | '/' | '%' };
			l = { t: 'bin', op: op.v, l, r: parseUnary() };
		}
		return l;
	}
	function parseUnary(): Node {
		if (isOp('-')) {
			eat();
			guardDepth();
			const e = { t: 'neg', e: parseUnary() } as const;
			depth--;
			return e;
		}
		return parseDice();
	}
	function parseDice(): Node {
		let l = parsePrimary();
		while (peek()?.k === 'dice') {
			eat();
			l = { t: 'dice', count: l, sides: parsePrimary() };
		}
		return l;
	}
	function parsePrimary(): Node {
		const t = eat();
		if (t.k === 'num') return { t: 'num', value: t.v };
		if (t.k === 'op' && t.v === '(') {
			guardDepth();
			const e = parseExpr();
			if (!isOp(')')) throw new ParseError("missing ')'");
			eat();
			depth--;
			return e;
		}
		if (t.k === 'ident') return identNode(t.v);
		throw new ParseError(`unexpected token near '${tokText(t)}'`);
	}
	function identNode(name: string): Node {
		// function call?
		if (isOp('(')) {
			const spec = FUNCTIONS[name];
			if (!spec) throw new ParseError(`unknown function '${name}'`);
			eat(); // '('
			guardDepth();
			const args: Node[] = [];
			if (!isOp(')')) {
				args.push(parseExpr());
				while (isOp(',')) {
					eat();
					args.push(parseExpr());
				}
			}
			if (!isOp(')')) throw new ParseError(`missing ')' in ${name}(...)`);
			eat();
			depth--;
			if (args.length < spec.min || args.length > spec.max)
				throw new ParseError(`${name}() takes ${arityText(spec)} arguments, got ${args.length}`);
			return { t: 'call', fn: name, args };
		}
		return varNode(name);
	}
	function varNode(name: string): Node {
		const d = splitDottedName(name);
		if (d) {
			if (!d.id) throw new ParseError(`'${name}' is missing an id after '.'`);
			if (DOTTED_NUMERIC.has(d.prefix)) return { t: 'numvar', name };
			if (DOTTED_BOOLEAN.has(d.prefix)) return { t: 'boolvar', name };
			throw new ParseError(`unknown variable family '${d.prefix}.'`);
		}
		if (NUMERIC_VARS.has(name)) return { t: 'numvar', name };
		if (BOOLEAN_VARS.has(name)) return { t: 'boolvar', name };
		if (name in ENUM_VARS) return { t: 'enumvar', name };
		if (ENUM_LITERALS.has(name)) return { t: 'enumlit', name };
		// A bare ability name (`wis`) with no _mod/_score suffix is a deliberate parse error — never
		// leave "mod or score?" ambiguous (PLAN).
		throw new ParseError(`unknown variable '${name}'`);
	}

	const root = parseExpr();
	if (pos !== toks.length)
		throw new ParseError(`unexpected trailing token '${tokText(toks[pos])}'`);
	return root;
}

const arityText = (s: { min: number; max: number }): string =>
	s.min === s.max ? `${s.min}` : s.max === Infinity ? `at least ${s.min}` : `${s.min}–${s.max}`;
const tokText = (t: Tok | undefined): string =>
	!t ? 'end' : t.k === 'num' ? String(t.v) : t.k === 'dice' ? 'd' : t.v;

/** Parse results memoized by source string: expressions live in content rows and re-evaluate on
 *  EVERY derive (each HP click), so re-parsing the same string per stat per derive is pure waste
 *  (AUDIT D7 perf note). ASTs are never mutated by evaluation, so sharing is safe. Bounded: content
 *  has a finite token set; the clear-at-cap guards against a pathological generator. */
const PARSE_CACHE = new Map<string, ParseResult>();
const PARSE_CACHE_MAX = 2000;

/** Parse an expression string into an AST (memoized). Never throws — a syntax error, unknown
 *  variable/function, over-length or over-nested input all return `{ok:false, error}`. */
export function parseExpression(src: string): ParseResult {
	const hit = PARSE_CACHE.get(src);
	if (hit) return hit;
	const res = parseExpressionUncached(src);
	if (PARSE_CACHE.size >= PARSE_CACHE_MAX) PARSE_CACHE.clear();
	PARSE_CACHE.set(src, res);
	return res;
}

function parseExpressionUncached(src: string): ParseResult {
	if (src.length > MAX_LENGTH) return { ok: false, error: 'expression too long' };
	const t = tokenize(src);
	if (!t.ok) return t;
	if (t.toks.length === 0) return { ok: false, error: 'empty expression' };
	try {
		return { ok: true, ast: { root: parse(t.toks) } };
	} catch (e) {
		return { ok: false, error: e instanceof ParseError ? e.message : 'parse failed' };
	}
}

/* ─────────────────────────── evaluator (never throws) ─────────────────────────── */

class EvalError extends Error {}

const isDice = (v: ExprValue): v is { type: 'dice'; dice: DiceValue } => v.type === 'dice';
const num = (n: number): ExprValue => ({ type: 'number', value: n });

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
	for (const [s, c] of Object.entries(d.pool))
		pool[Number(s)] = Math.max(0, Math.min(c * factor, MAX_DICE_PER_TERM));
	return { type: 'dice', dice: { pool, flat: d.flat * factor } };
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

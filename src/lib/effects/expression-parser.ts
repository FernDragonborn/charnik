/*
 * L2 value-expression language — the pure PARSER (tokenizer → recursive-descent → AST).
 *
 * The safe formula layer between L1 (literal effect tokens) and L3 (sandboxed plugins): a token's
 * VALUE or a conditional GUARD is a bounded expression (`ceil(level/2)`, `is_raging`,
 * `armor_type==none`) instead of only a literal. NON-Turing-complete BY CONSTRUCTION — no loops,
 * no recursion, no assignment, no `eval`, whitelisted variables + functions only. Parsing NEVER
 * throws: a malformed / unknown / over-long / over-nested input returns `{ok:false, error}`.
 *
 * The evaluator (expression-evaluator.ts) consumes the `Node`/`Ast` this file produces — a
 * one-directional dep (eval → parse), also sharing the enum grammar. Grammar/precedence/vars are
 * pinned in docs/PLAN.md → "EXPR".
 */
import { ABILITY_IDS, SIZES, ARMOR_TYPES } from '../rules/core';

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
export const ENUM_VARS: Readonly<Record<string, readonly string[]>> = {
	armor_type: ARMOR_TYPES,
	size: SIZES
};
/** Enums whose members have a meaningful order (so `<`/`>` compare by index). `armor_type` is a
 *  bag (only `==`/`!=`); `size` is a ladder. */
export const ORDERED_ENUMS: ReadonlySet<string> = new Set(['size']);
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
	sign: { min: 1, max: 1 },
	// breakpoint lookup over `threshold->value` pairs: value of the highest threshold ≤ index, no
	// match → 0. The level-table primitive (Rage count, Bardic die). Args = index + ≥1 pair.
	step: { min: 2, max: Infinity },
	// identity — pure readability sugar (`var(class_level.rogue)d6` reads better glued than bare
	// parens); passes dice and `inf` through untouched.
	var: { min: 1, max: 1 }
};

/* ─────────────────────────── AST ─────────────────────────── */

export type BinOp =
	'+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=' | 'and' | 'or';

export type Node =
	| { t: 'num'; value: number }
	| { t: 'numvar'; name: string }
	| { t: 'boolvar'; name: string }
	| { t: 'enumvar'; name: string }
	| { t: 'enumlit'; name: string }
	| { t: 'neg'; e: Node }
	| { t: 'not'; e: Node }
	| { t: 'dice'; count: Node; sides: Node }
	| { t: 'bin'; op: BinOp; l: Node; r: Node }
	| { t: 'call'; fn: string; args: Node[] }
	// a `threshold->value` pair — legal ONLY as a step() argument (validated at parse)
	| { t: 'pair'; threshold: Node; value: Node }
	// the `inf` literal — a TERMINAL value: legal to produce (a step() pair value, an if() branch),
	// illegal to compute with (every arithmetic result still passes the evaluator's finite-guard)
	| { t: 'inf' };

export interface Ast {
	root: Node;
}

/* ─────────────────────────── results (never throw) ─────────────────────────── */

export type ParseResult = { ok: true; ast: Ast } | { ok: false; error: string };

/* ─────────────────────────── tokenizer ─────────────────────────── */

type Tok =
	| { k: 'num'; v: number }
	| { k: 'ident'; v: string }
	| { k: 'op'; v: string } // + - * / % ( ) , -> and comparison operators
	| { k: 'dice' }; // the `d` dice operator (disambiguated from identifiers here)

const COMPARE_STARTS = new Set(['<', '>', '=', '!']);

/** Word-form operators lex as identifiers but are NOT operands — a `d` right after one must belong
 *  to the next identifier (`is_raging and dex_mod`), never be the dice operator. */
const WORD_OPERATORS: ReadonlySet<string> = new Set(['and', 'or', 'not']);

/** Split source into tokens. The `d` dice operator is the one hard case: `d` is also a letter, so
 *  `1d6` would lex as num(1)+ident("d6"). We resolve it positionally — a `d` is the dice operator
 *  ONLY when the previous token is an OPERAND: a number, `)`, or a variable identifier (any ident
 *  except the word-operators and/or/not) — so `1d6`, `(level)d6` and `level d6` all lex as dice,
 *  while `dex_mod` after an operator/`(`/`,`/start stays one identifier. A fully-glued `leveld6`
 *  is indivisible (one identifier) and deliberately NOT supported — the parser's unknown-variable
 *  error carries a did-you-mean hint instead of guessing a split. */
function tokenize(src: string): { ok: true; toks: Tok[] } | { ok: false; error: string } {
	const toks: Tok[] = [];
	let i = 0;
	const prevIsOperand = () => {
		const p = toks[toks.length - 1];
		if (!p) return false;
		if (p.k === 'num' || (p.k === 'op' && p.v === ')')) return true;
		return p.k === 'ident' && !WORD_OPERATORS.has(p.v);
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
			const word = src.slice(i, j);
			// bare-die sugar: `d6`/`d20` with no operand before it desugars to `1d6`/`1d20` (the
			// tabletop habit). Safe: no whitelisted variable matches `d<digits>`.
			const bareDie = /^d(\d+)$/.exec(word);
			if (bareDie) {
				toks.push({ k: 'num', v: 1 }, { k: 'dice' }, { k: 'num', v: Number(bareDie[1]) });
			} else {
				toks.push({ k: 'ident', v: word });
			}
			i = j;
			continue;
		}
		// `->` (the step() pair separator) must lex before the single-char `-`
		if (c === '-' && src[i + 1] === '>') {
			toks.push({ k: 'op', v: '->' });
			i += 2;
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
	/** A call argument: an expression, optionally extended to a `threshold->value` pair. Pairs are
	 *  parsed for ANY call (one grammar) and rejected below for every function but step(). */
	function parseArg(): Node {
		const e = parseExpr();
		if (isOp('->')) {
			eat();
			return { t: 'pair', threshold: e, value: parseExpr() };
		}
		return e;
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
				args.push(parseArg());
				while (isOp(',')) {
					eat();
					args.push(parseArg());
				}
			}
			if (!isOp(')')) throw new ParseError(`missing ')' in ${name}(...)`);
			eat();
			depth--;
			if (args.length < spec.min || args.length > spec.max)
				throw new ParseError(`${name}() takes ${arityText(spec)} arguments, got ${args.length}`);
			validatePairShape(name, args);
			return { t: 'call', fn: name, args };
		}
		return varNode(name);
	}
	/** step() takes `index, t->v, t->v, …` — the index must NOT be a pair, everything after MUST be;
	 *  any other function must have no pairs at all. */
	function validatePairShape(fn: string, args: Node[]): void {
		if (fn !== 'step') {
			if (args.some((a) => a.t === 'pair'))
				throw new ParseError(`'->' pairs are only valid inside step()`);
			return;
		}
		if (args[0]?.t === 'pair')
			throw new ParseError(`step()'s first argument is the index, not a 'threshold->value' pair`);
		const bad = args.slice(1).find((a) => a.t !== 'pair');
		if (bad)
			throw new ParseError(`step() arguments after the index must be 'threshold->value' pairs`);
	}
	function varNode(name: string): Node {
		if (name === 'inf') return { t: 'inf' };
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
		// a KNOWN variable glued straight onto a die (`leveld6`) is indivisible by design — hint the
		// supported spelling instead of guessing a split (NEVER-support, decisions doc)
		const glued = /^(.+?)d(\d+)$/.exec(name);
		if (glued && glued[1] && isKnownVarName(glued[1]))
			throw new ParseError(
				`unknown variable '${name}' — did you mean '${glued[1]} d${glued[2]}'? (a variable needs a space or parens before the dice operator)`
			);
		// A bare ability name (`wis`) with no _mod/_score suffix is a deliberate parse error — never
		// leave "mod or score?" ambiguous (PLAN).
		throw new ParseError(`unknown variable '${name}'`);
	}

	const root = parseExpr();
	if (pos !== toks.length)
		throw new ParseError(`unexpected trailing token '${tokText(toks[pos])}'`);
	return root;
}

/** Is this name a whitelisted variable (any family)? Used only for the glued-die hint. */
function isKnownVarName(name: string): boolean {
	if (NUMERIC_VARS.has(name) || BOOLEAN_VARS.has(name) || name in ENUM_VARS) return true;
	const d = splitDottedName(name);
	return !!d && !!d.id && (DOTTED_NUMERIC.has(d.prefix) || DOTTED_BOOLEAN.has(d.prefix));
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

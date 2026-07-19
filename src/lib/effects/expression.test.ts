import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseExpression } from './expression-parser';
import {
	evaluate,
	evalExpression,
	diceToFormula,
	lintExpression,
	collectExprVariables,
	type ExprContext,
	type ExprValue,
	type DiceValue
} from './expression-evaluator';

/** A test context backed by plain maps. Absent numeric var → undefined (evaluator treats as 0). */
function ctx(
	opts: {
		numbers?: Record<string, number>;
		booleans?: Record<string, boolean>;
		enums?: Record<string, string>;
	} = {}
): ExprContext {
	return {
		number: (n) => opts.numbers?.[n],
		boolean: (n) => opts.booleans?.[n],
		enum: (n) => opts.enums?.[n]
	};
}

/** Evaluate, asserting success, returning the ExprValue. */
function ev(src: string, c: ExprContext = ctx()): ExprValue {
	const r = evalExpression(src, c);
	if (!r.ok) throw new Error(`expected ok, got error: ${r.error} (for "${src}")`);
	return r.value;
}

/** Evaluate to a plain number, asserting the value is numeric. */
function n(src: string, c: ExprContext = ctx()): number {
	const v = ev(src, c);
	if (v.type !== 'number') throw new Error(`expected number, got dice (for "${src}")`);
	return v.value;
}

/** Evaluate to a dice value. */
function dice(src: string, c: ExprContext = ctx()): DiceValue {
	const v = ev(src, c);
	if (v.type !== 'dice') throw new Error(`expected dice, got number (for "${src}")`);
	return v.dice;
}

describe('EXPR-1 · arithmetic & precedence', () => {
	it('folds integer arithmetic with correct precedence', () => {
		expect(n('2+3*4')).toBe(14);
		expect(n('(2+3)*4')).toBe(20);
		expect(n('10-2-3')).toBe(5); // left-assoc
		expect(n('2*3+4*5')).toBe(26);
		expect(n('-5+3')).toBe(-2);
		expect(n('- -5')).toBe(5);
		expect(n('2 * -3')).toBe(-6);
	});

	it('keeps division exact (floors only at the caller)', () => {
		expect(n('7/2')).toBe(3.5);
		expect(n('ceil(7/2)')).toBe(4);
		expect(n('floor(7/2)')).toBe(3);
		expect(n('round(7/2)')).toBe(4);
		expect(n('7%3')).toBe(1);
	});

	it('evaluates the whitelisted functions', () => {
		expect(n('min(3,1,2)')).toBe(1);
		expect(n('max(3,1,2)')).toBe(3);
		expect(n('abs(-4)')).toBe(4);
		expect(n('sign(-9)')).toBe(-1);
		expect(n('clamp(15,1,10)')).toBe(10);
		expect(n('clamp(-5,1,10)')).toBe(1);
		expect(n('clamp(5,1,10)')).toBe(5);
	});
});

describe('EXPR-1 · variables', () => {
	const c = ctx({
		numbers: { level: 7, proficiency_bonus: 3, wis_mod: 1, cha_mod: -1, 'class_level.monk': 5 }
	});

	it('reads whitelisted numeric variables', () => {
		expect(n('level', c)).toBe(7);
		expect(n('proficiency_bonus*2', c)).toBe(6);
		expect(n('10+wis_mod', c)).toBe(11);
		expect(n('class_level.monk', c)).toBe(5);
	});

	it('treats an absent-but-whitelisted variable as 0 (SPEC4)', () => {
		expect(n('class_level.rogue', c)).toBe(0); // non-rogue → 0, not an error
		expect(n('max(1,wis_mod)', ctx())).toBe(1); // wis_mod absent → 0 → max(1,0)=1
	});

	it('rejects an unknown variable at parse (never a silent 0)', () => {
		expect(parseExpression('bogus').ok).toBe(false);
		expect(parseExpression('wis').ok).toBe(false); // bare ability = ambiguous mod/score → error
		expect(parseExpression('class.monk').ok).toBe(false); // wrong family
	});
});

describe('EXPR-1 · dice terms', () => {
	it('produces a dice pool from `<amount>d<sides>`', () => {
		expect(dice('1d6')).toEqual({ pool: { 6: 1 }, flat: 0 });
		expect(dice('2d8')).toEqual({ pool: { 8: 2 }, flat: 0 });
	});

	it('scales the dice COUNT by an expression (Sneak Attack)', () => {
		const c = ctx({ numbers: { 'class_level.rogue': 5 } });
		// ceil(5/2)=3 → 3d6
		expect(dice('ceil(class_level.rogue/2)d6', c)).toEqual({ pool: { 6: 3 }, flat: 0 });
	});

	it('scales the die SIZE by an expression (Martial Arts die)', () => {
		const die =
			'1d(if(class_level.monk>=17, 10, if(class_level.monk>=11, 8, if(class_level.monk>=5, 6, 4))))';
		expect(dice(die, ctx({ numbers: { 'class_level.monk': 1 } }))).toEqual({
			pool: { 4: 1 },
			flat: 0
		});
		expect(dice(die, ctx({ numbers: { 'class_level.monk': 5 } }))).toEqual({
			pool: { 6: 1 },
			flat: 0
		});
		expect(dice(die, ctx({ numbers: { 'class_level.monk': 11 } }))).toEqual({
			pool: { 8: 1 },
			flat: 0
		});
		expect(dice(die, ctx({ numbers: { 'class_level.monk': 17 } }))).toEqual({
			pool: { 10: 1 },
			flat: 0
		});
	});

	it('folds a flat into a dice term and merges pools', () => {
		expect(dice('1d6+3')).toEqual({ pool: { 6: 1 }, flat: 3 });
		expect(dice('2d6+1d6')).toEqual({ pool: { 6: 3 }, flat: 0 });
		expect(dice('1d6+1d4')).toEqual({ pool: { 6: 1, 4: 1 }, flat: 0 });
		expect(dice('2*1d6')).toEqual({ pool: { 6: 2 }, flat: 0 }); // scale count
	});

	it('clamps count ≥0 and sides ≥1', () => {
		expect(dice('0d6')).toEqual({ pool: {}, flat: 0 });
	});

	it('serializes to a roller formula', () => {
		expect(diceToFormula({ pool: { 6: 2, 4: 1 }, flat: 3 })).toBe('2d6+1d4+3');
		expect(diceToFormula({ pool: { 6: 1 }, flat: -1 })).toBe('1d6-1');
	});
});

describe('EXPR-1 · conditional values (if) — SPEC5', () => {
	it('returns the taken branch, and its type decides the result type', () => {
		const bloodied = ctx({ booleans: { is_bloodied: true } });
		const healthy = ctx({ booleans: { is_bloodied: false } });
		expect(ev('if(is_bloodied, 1d4, 0)', bloodied)).toEqual({
			type: 'dice',
			dice: { pool: { 4: 1 }, flat: 0 }
		});
		expect(ev('if(is_bloodied, 1d4, 0)', healthy)).toEqual({ type: 'number', value: 0 });
	});

	it('does not evaluate the dead branch (a bad dead branch is harmless)', () => {
		// dead branch divides by zero; taken branch is fine → overall ok
		expect(n('if(1, 42, 1/0)')).toBe(42);
	});

	it('scales a Rage-style bonus', () => {
		const at = (lvl: number) =>
			n('if(level>=16, 4, if(level>=9, 3, 2))', ctx({ numbers: { level: lvl } }));
		expect(at(1)).toBe(2);
		expect(at(9)).toBe(3);
		expect(at(16)).toBe(4);
	});
});

describe('EXPR-1 · booleans & guards', () => {
	it('evaluates flags, and/or/not, comparisons', () => {
		const c = ctx({
			booleans: { is_raging: true, is_concentrating: false },
			numbers: { hp_percent: 40 }
		});
		expect(n('is_raging', c)).toBe(1);
		expect(n('is_raging and not is_concentrating', c)).toBe(1);
		expect(n('is_concentrating or is_raging', c)).toBe(1);
		expect(n('hp_percent <= 50', c)).toBe(1);
		expect(n('hp_percent > 50', c)).toBe(0);
	});

	it('binds `not` looser than comparison (PLAN precedence)', () => {
		// not a==b  ≡  not (a==b)
		expect(n('not 1 == 2')).toBe(1);
		expect(n('not 2 == 2')).toBe(0);
	});
});

describe('EXPR-1 · enum comparisons — SPEC3', () => {
	it('compares an enum variable to a whitelisted literal', () => {
		expect(n('armor_type==none', ctx({ enums: { armor_type: 'none' } }))).toBe(1);
		expect(n('armor_type==heavy', ctx({ enums: { armor_type: 'none' } }))).toBe(0);
		expect(n('armor_type!=none', ctx({ enums: { armor_type: 'heavy' } }))).toBe(1);
	});

	it('allows ordinal comparison ONLY on ordered enums', () => {
		expect(n('size<large', ctx({ enums: { size: 'small' } }))).toBe(1);
		expect(n('size>=large', ctx({ enums: { size: 'huge' } }))).toBe(1);
		// armor_type is unordered → ordinal compare is an eval error → degrade
		expect(evalExpression('armor_type<heavy', ctx({ enums: { armor_type: 'light' } })).ok).toBe(
			false
		);
	});

	it('rejects a literal that is not a member of the compared enum', () => {
		// `large` is a size literal, not an armor_type literal
		expect(evalExpression('armor_type==large', ctx({ enums: { armor_type: 'none' } })).ok).toBe(
			false
		);
	});

	it('parses the Unarmored Defense guard shape', () => {
		expect(parseExpression('armor_type==none').ok).toBe(true);
	});
});

describe('EXPR-1 · chained comparisons are a parse error (authoring trap)', () => {
	it('rejects `5<=level<=10` instead of silently evaluating `(5<=level)<=10`', () => {
		const r = parseExpression('5<=level<=10');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain('chained comparisons');
	});
	it('a single comparison still parses', () => {
		expect(n('level>=5', ctx({ numbers: { level: 6 } }))).toBe(1);
	});
	it('the `and` spelling works', () => {
		expect(n('5<=level and level<=10', ctx({ numbers: { level: 7 } }))).toBe(1);
		expect(n('5<=level and level<=10', ctx({ numbers: { level: 12 } }))).toBe(0);
	});
});

describe('EXPR-1 · absent enum var fails every comparison (SPEC4 fail-closed)', () => {
	it('neither == nor != matches when the enum is absent', () => {
		expect(n('armor_type==none')).toBe(0);
		expect(n('armor_type!=heavy')).toBe(0); // NOT 1 — absence is no evidence
		expect(n('size<large')).toBe(0);
	});
});

describe('EXPR-1 · dice cost caps hold under addition', () => {
	it('caps a pool built by repeated + at the per-term cap', () => {
		const d = dice('1000d6+1000d6');
		expect(d.pool[6]).toBe(1000);
	});
});

describe('lintExpression · authoring soft-warns', () => {
	it('warns on a mixed-type if() (dice vs number)', () => {
		expect(lintExpression('if(is_bloodied, 1d4, 0)').join(' ')).toContain('differ in type');
		expect(lintExpression('if(is_bloodied, 2, 0)')).toEqual([]);
		expect(lintExpression('if(is_bloodied, 1d4, 2d6)')).toEqual([]);
	});
	it('warns on a non-standard literal die size, not on standard or computed ones', () => {
		expect(lintExpression('1d7').join(' ')).toContain('unusual die d7');
		expect(lintExpression('1d6')).toEqual([]);
		expect(lintExpression('1d100')).toEqual([]);
		expect(lintExpression('1d(level)')).toEqual([]); // computed sides — can't lint statically
	});
	it('returns [] for an unparseable expression (parse errors are the eval path’s job)', () => {
		expect(lintExpression('bogus ~~~')).toEqual([]);
	});
	it('walks into a NESTED if to catch a mixed-type outer branch', () => {
		// outer: branch1 is (a dice-typed inner if), branch2 is a number → differ; inner is dice/dice → ok
		const w = lintExpression('if(is_bloodied, if(is_raging, 1d4, 2d6), 5)');
		expect(w.join(' ')).toContain('differ in type');
	});
});

/* ─────────────────────────── P2 · L2 support utilities ─────────────────────────── */

describe('EXPR · P2 · collectExprVariables (feeds the dependency-order DAG)', () => {
	it('collects numeric + boolean var names an expression reads', () => {
		expect(collectExprVariables('level+wis_mod').sort()).toEqual(['level', 'wis_mod']);
		expect(collectExprVariables('is_raging and level>0').sort()).toEqual(['is_raging', 'level']);
	});
	it('collects dotted variable families by their full name', () => {
		expect(collectExprVariables('class_level.monk+resource.ki').sort()).toEqual([
			'class_level.monk',
			'resource.ki'
		]);
	});
	it('deduplicates a name read more than once', () => {
		expect(collectExprVariables('str_mod+str_mod*2')).toEqual(['str_mod']);
	});
	it('excludes enum variables (no effect can write an enum → not a dep edge)', () => {
		expect(collectExprVariables('armor_type==none')).toEqual([]);
		expect(collectExprVariables('size<large')).toEqual([]);
	});
	it('returns [] for an unparseable expression (error surfacing is the eval path’s job)', () => {
		expect(collectExprVariables('bogus ~~~')).toEqual([]);
		expect(collectExprVariables('')).toEqual([]);
	});
});

describe('EXPR · P2 · diceToFormula edge shapes', () => {
	it('serializes a pure-flat quantity (no pool) to just the number', () => {
		expect(diceToFormula({ pool: {}, flat: 5 })).toBe('5');
		expect(diceToFormula({ pool: {}, flat: -5 })).toBe('-5');
	});
	it('serializes an empty quantity to "0"', () => {
		expect(diceToFormula({ pool: {}, flat: 0 })).toBe('0');
	});
	it('orders pools by descending die size and appends the flat with its sign', () => {
		expect(diceToFormula({ pool: { 6: 2, 8: 1 }, flat: 0 })).toBe('1d8+2d6');
		expect(diceToFormula({ pool: { 6: 1 }, flat: 3 })).toBe('1d6+3');
	});
});

describe('EXPR-1 · failure is a structured error, never a throw', () => {
	const bad = [
		'', // empty
		'2+', // dangling operator
		'(1+2', // unbalanced
		'1+2)', // trailing
		'bogus_fn(1)', // unknown function
		'min()', // too few args
		'if(1,2)', // wrong arity
		'1/0', // division by zero
		'1d6 == 3', // comparison on dice
		'1 d bogusvar', // unknown var as sides
		'@#$' // stray chars
	];
	for (const src of bad)
		it(`degrades "${src}" to {ok:false}`, () => {
			const r = evalExpression(src, ctx({ numbers: {} }));
			expect(r.ok).toBe(false);
		});

	it('rejects an over-long expression', () => {
		expect(parseExpression('1+'.repeat(400) + '1').ok).toBe(false);
	});
});

describe('EXPR-1 · property-based invariants', () => {
	const NUMERIC = ['level', 'proficiency_bonus', 'wis_mod', 'class_level.monk'];
	const genExpr = fc.letrec((tie) => ({
		expr: fc.oneof(
			{ depthSize: 'small' },
			fc.integer({ min: 0, max: 20 }).map(String),
			fc.constantFrom(...NUMERIC),
			fc
				.tuple(tie('expr'), fc.constantFrom('+', '-', '*'), tie('expr'))
				.map(([a, o, b]) => `(${a}${o}${b})`),
			tie('expr').map((e) => `ceil(${e})`),
			fc.tuple(tie('expr'), tie('expr')).map(([a, b]) => `max(${a},${b})`)
		)
	})).expr;

	it('never throws over the whitelisted domain (ok or structured error only)', () => {
		fc.assert(
			fc.property(
				genExpr,
				fc.dictionary(fc.constantFrom(...NUMERIC), fc.integer({ min: -5, max: 30 })),
				(src, nums) => {
					const r = evalExpression(src, ctx({ numbers: nums }));
					expect(typeof r.ok).toBe('boolean'); // did not throw
				}
			),
			{ numRuns: 300 }
		);
	});

	it('is deterministic — same (expr, ctx) yields the same result', () => {
		fc.assert(
			fc.property(
				genExpr,
				fc.dictionary(fc.constantFrom(...NUMERIC), fc.integer({ min: -5, max: 30 })),
				(src, nums) => {
					const c = ctx({ numbers: nums });
					const a = evalExpression(src, c);
					const b = evalExpression(src, c);
					expect(a).toEqual(b);
				}
			),
			{ numRuns: 200 }
		);
	});
});

describe('EXPR-1 · caching the AST is equivalent to one-shot', () => {
	it('parse-then-evaluate equals evalExpression', () => {
		const p = parseExpression('ceil(level/2)+wis_mod');
		expect(p.ok).toBe(true);
		if (!p.ok) return;
		const c = ctx({ numbers: { level: 5, wis_mod: 2 } });
		expect(evaluate(p.ast, c)).toEqual(evalExpression('ceil(level/2)+wis_mod', c));
	});
});

/* ─────────────────────────── P0 · hostile input / safety ─────────────────────────── */

describe('EXPR · non-finite results are rejected (fail-closed, never leak NaN/Infinity)', () => {
	// a stat can never be NaN/Infinity: any expression that would produce one degrades to a
	// structured error (→ inert note), NOT an ok:true carrying a poisoned number.
	const rejects = (src: string) => expect(evalExpression(src, ctx()).ok).toBe(false);
	it('an over-large numeric literal (overflows to Infinity) is an error, not ok', () => {
		rejects('9'.repeat(400)); // Number('999…') === Infinity
	});
	it('Infinity − Infinity (→ NaN) is an error', () => {
		rejects('9'.repeat(400) + '-' + '9'.repeat(400));
	});
	it('an overflowing product is an error', () => {
		rejects('9'.repeat(200) + '*' + '9'.repeat(200));
	});
	it('a non-finite value can never reach a comparison or guard as a real number', () => {
		// if the huge literal leaked as Infinity, `> 0` would read true; instead the whole guard errors
		rejects('9'.repeat(400) + '>0');
	});
	it('ordinary arithmetic is unaffected', () => {
		expect(n('2+3*4')).toBe(14);
		expect(n('1000000*1000000')).toBe(1_000_000_000_000); // large but finite → fine
	});
});

describe('EXPR · cap boundaries (depth / length / dice) degrade, never crash', () => {
	it('nesting exactly at the depth cap parses; one deeper is a structured error', () => {
		expect(parseExpression('not '.repeat(32) + '1').ok).toBe(true);
		const over = parseExpression('not '.repeat(33) + '1');
		expect(over.ok).toBe(false);
		if (!over.ok) expect(over.error).toContain('deeply');
	});
	it('deep nesting via unary and calls is bounded (not only parens)', () => {
		expect(parseExpression('-'.repeat(33) + '5').ok).toBe(false);
		expect(parseExpression('ceil('.repeat(33) + '1' + ')'.repeat(33)).ok).toBe(false);
		expect(parseExpression('----5').ok).toBe(true); // 4 deep → fine
	});
	it('a wall of parens is a structured error, NOT a stack overflow', () => {
		const r = parseExpression('('.repeat(200) + '1' + ')'.repeat(200));
		expect(r.ok).toBe(false); // returns cleanly — the assertion running at all proves no crash
	});
	it('over-length input is rejected before parsing; at-length input still parses', () => {
		const over = parseExpression('0'.repeat(513));
		expect(over.ok).toBe(false);
		if (!over.ok) expect(over.error).toContain('too long');
		expect(parseExpression('1+'.repeat(200) + '1').ok).toBe(true); // 401 chars, well-formed
	});
	it('clamps an over-large literal die size to the cost cap', () => {
		expect(dice('1d99999')).toEqual({ pool: { 1000: 1 }, flat: 0 });
	});
	it('clamps an over-large dice COUNT (both literal and via multiply)', () => {
		expect(dice('9999d6')).toEqual({ pool: { 6: 1000 }, flat: 0 });
		expect(dice('2000*1d6')).toEqual({ pool: { 6: 1000 }, flat: 0 }); // scale path, not add
	});
	it('a zero/absent die size floors to 1 side (never a 0-sided die)', () => {
		expect(dice('1d0')).toEqual({ pool: { 1: 1 }, flat: 0 });
	});
});

describe('EXPR · parser cache stays correct at/over its cap', () => {
	it('memoizes identical source (same result reference)', () => {
		const a = parseExpression('ceil(level/2)');
		const b = parseExpression('ceil(level/2)');
		expect(a).toBe(b); // same object → served from cache
	});
	it('a cached AST is stateless — same source under different contexts differs correctly', () => {
		const c1 = ctx({ numbers: { level: 4 } });
		const c2 = ctx({ numbers: { level: 10 } });
		expect(n('ceil(level/2)', c1)).toBe(2);
		expect(n('ceil(level/2)', c2)).toBe(5); // the shared AST did not carry c1's state
	});
	it('stays correct after the cache is cleared at its cap (>2000 distinct sources)', () => {
		for (let i = 0; i < 2100; i++) parseExpression(`${i}+1`); // blows past PARSE_CACHE_MAX → clear
		expect(n('ceil(level/2)', ctx({ numbers: { level: 7 } }))).toBe(4); // still parses + evaluates
	});
});

/* ─────────────────────────── P1 · semantic traps (pinned behaviour) ─────────────────────────── */

describe('EXPR · P1 · dice-operator `d` disambiguation', () => {
	const errs = (src: string) => expect(evalExpression(src, ctx()).ok).toBe(false);
	it('treats `d` after a `)` operand as the dice operator', () => {
		expect(dice('(1+1)d6')).toEqual({ pool: { 6: 2 }, flat: 0 }); // 2d6
	});
	it('floors a computed count and clamps a computed-negative count to an empty pool', () => {
		expect(dice('(7/2)d6')).toEqual({ pool: { 6: 3 }, flat: 0 }); // floor(3.5)=3
		expect(dice('(0-2)d6')).toEqual({ pool: {}, flat: 0 }); // negative count → nothing
	});
	it('an identifier that merely STARTS with d is not the dice op (must not run together)', () => {
		// `2dex_mod` lexes as `2 d ex_mod` → `ex_mod` is unknown → structured error (authoring trap:
		// a bonus die off dex must be written `2d(dex_mod)` or similar, never `2ddex_mod`)
		errs('2dex_mod');
	});
	it('a bare identifier as a die count/size does not glue to `d` (needs parens)', () => {
		errs('level d6'); // `level` then `d6`(ident) → not a dice term → error; write `(level)d6`
		errs('1d(1d6)'); // dice as a die size → error
		errs('1d6d8'); // chained dice → the second `d` reads dice as an operand → error
	});
});

describe('EXPR · P1 · dice-typing (dice forbidden where a plain number is required)', () => {
	const errs = (src: string) => expect(evalExpression(src, ctx()).ok).toBe(false);
	it('subtraction is asymmetric: dice minus a number is fine, number minus dice is not', () => {
		expect(dice('1d6-2')).toEqual({ pool: { 6: 1 }, flat: -2 }); // dice carries a flat
		errs('2-1d6'); // a dice term cannot be negated into a plain-number subtraction
		errs('1d6-1d4'); // dice minus dice is not a pool merge (only `+` merges pools)
	});
	it('rejects negating, comparing, or feeding dice where a number is demanded', () => {
		errs('-1d6'); // unary minus on dice
		errs('1d6*1d6'); // dice times dice
		errs('min(1d6,2)'); // dice as a function arg
		errs('if(1d6,1,2)'); // dice as a condition
	});
	it('scaling dice by a zero/negative factor yields an empty pool, not a `0d6` entry', () => {
		expect(dice('1d6*-2')).toEqual({ pool: {}, flat: 0 });
		expect(dice('(1/2)*1d6')).toEqual({ pool: {}, flat: 0 }); // factor floor(0.5)=0
	});
});

describe('EXPR · P1 · boolean semantics & short-circuit', () => {
	it('and/or short-circuit so a bad dead operand never breaks the result', () => {
		expect(n('0 and (1/0)')).toBe(0); // right side (div-by-zero) never evaluated
		expect(n('1 or (1/0)')).toBe(1);
	});
	it('and/or yield 0/1, not the JS operand value', () => {
		expect(n('2 and 3')).toBe(1); // NOT 3
		expect(n('0 or 5')).toBe(1); // NOT 5
	});
	it('any non-zero number is truthy (including negatives)', () => {
		expect(n('not -1')).toBe(0);
		expect(n('-1 and 1')).toBe(1);
	});
});

describe('EXPR · P1 · enum comparison edges', () => {
	const c = ctx({ enums: { armor_type: 'none', size: 'colossal' } }); // colossal ∉ SIZES (homebrew)
	it('accepts an enum literal on EITHER side of the comparison', () => {
		expect(n('none==armor_type', c)).toBe(1);
		expect(n('heavy!=armor_type', c)).toBe(1);
	});
	it('rejects a comparison with no literal (var==var) or no var (lit==lit)', () => {
		expect(evalExpression('armor_type==armor_type', c).ok).toBe(false);
		expect(evalExpression('none==none', c).ok).toBe(false);
	});
	it('an ordered-enum current value outside the known members compares as no-match (0)', () => {
		expect(n('size<large', c)).toBe(0); // colossal has no ordinal → fail-closed
		expect(n('size>=large', c)).toBe(0);
	});
	it('a bare enum var used as an arithmetic value is an error', () => {
		expect(evalExpression('armor_type+1', c).ok).toBe(false);
	});
});

describe('EXPR · P1 · numeric quirks (pinned, incl. hostile CSV shapes)', () => {
	it('has no float literals — a decimal point is a parse error', () => {
		expect(parseExpression('1.5').ok).toBe(false);
	});
	it('modulo follows JS sign semantics (sign of the dividend)', () => {
		expect(n('-7%3')).toBe(-1);
		expect(n('7%-3')).toBe(1);
	});
	it('clamp with lo>hi resolves to lo (documented quirk, not a crash)', () => {
		expect(n('clamp(5,10,1)')).toBe(10);
	});
	it('a newline inside the expression is rejected (multi-line CSV cell stays fail-closed)', () => {
		expect(parseExpression('1+\n2').ok).toBe(false);
	});
});

describe('EXPR · fuzz — arbitrary raw input never throws (returns {ok:boolean})', () => {
	it('random unicode/byte junk parses to a structured result, never a throw', () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 200, unit: 'binary' }), (src) => {
				const p = parseExpression(src);
				expect(typeof p.ok).toBe('boolean');
				const e = evalExpression(src, ctx());
				expect(typeof e.ok).toBe('boolean');
			}),
			{ numRuns: 500 }
		);
	});
	it('near-miss expression noise (real authoring surface) never throws', () => {
		// a curated alphabet of every operator + identifier fragment → dense malformed input that
		// exercises the tokenizer/parser far harder than random unicode
		const alphabet = fc.constantFrom(...'0123456789+-*/%()<>=!,._ dlevwisxyz'.split(''));
		fc.assert(
			fc.property(fc.string({ maxLength: 80, unit: alphabet }), (src) => {
				const e = evalExpression(src, ctx({ numbers: { level: 5, wis_mod: 2 } }));
				expect(typeof e.ok).toBe('boolean');
			}),
			{ numRuns: 1000 }
		);
	});
	it('a successful numeric result is ALWAYS finite (no NaN/Infinity ever escapes)', () => {
		const alphabet = fc.constantFrom(...'0123456789+-*/%()levwis_mod '.split(''));
		fc.assert(
			fc.property(fc.string({ maxLength: 60, unit: alphabet }), (src) => {
				const e = evalExpression(src, ctx({ numbers: { level: 9, wis_mod: 3 } }));
				if (e.ok && e.value.type === 'number') expect(Number.isFinite(e.value.value)).toBe(true);
			}),
			{ numRuns: 1000 }
		);
	});
});

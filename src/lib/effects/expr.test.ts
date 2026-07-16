import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
	parseExpression,
	evaluate,
	evalExpression,
	diceToFormula,
	lintExpression,
	type ExprContext,
	type ExprValue,
	type DiceValue
} from './expr';

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

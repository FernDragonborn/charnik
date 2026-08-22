import { describe, it, expect } from 'vitest';
import {
	rollPool,
	rollFormula,
	parseDicePool,
	parseFlatModifier,
	parseDiceTerm,
	DIE_ROLE,
	parseLegacyExpr,
	rehydrateRoll,
	amendWithAdvantage,
	flipAdvantage,
	cycleAdvantage,
	type Rng,
	type Rolled,
} from './dice';

/** RNG that yields the given [0,1) values in order (then throws if over-drawn — catches extra draws). */
function rngSequence(...values: number[]): Rng {
	let i = 0;
	return () => {
		if (i >= values.length) throw new Error('rng over-drawn');
		return values[i++]!;
	};
}
// rollDie(sides) = 1 + floor(rng()*sides); 0.5 on a d6 → 4, on a d20 → 11, on a d4 → 3.

describe('parseDiceTerm', () => {
	it('parses a signed single dice term into a BonusDie', () => {
		expect(parseDiceTerm('1d4')).toEqual({ count: 1, sides: 4, sign: 1 });
		expect(parseDiceTerm('-1d4')).toEqual({ count: 1, sides: 4, sign: -1 });
		expect(parseDiceTerm('2d6')).toEqual({ count: 2, sides: 6, sign: 1 });
	});
	it('returns null for a non-term', () => {
		expect(parseDiceTerm('5')).toBeNull();
		expect(parseDiceTerm('garbage')).toBeNull();
	});
});

describe('parseDicePool', () => {
	it('sums every NdM group', () => {
		expect(parseDicePool('2d6 + 1d4')).toEqual({ 6: 2, 4: 1 });
		expect(parseDicePool('3d8')).toEqual({ 8: 3 });
		expect(parseDicePool('no dice here')).toEqual({});
	});
	it('reads an implicit count of one ("d8" is a die, not nothing)', () => {
		expect(parseDicePool('d8')).toEqual({ 8: 1 });
		expect(parseDicePool('d6 + 2d6')).toEqual({ 6: 3 });
	});
});

describe('parseFlatModifier (shared by the roller and the damage-segment parser)', () => {
	it('sums every signed term, wherever it sits', () => {
		expect(parseFlatModifier('1d6+3+1d4')).toBe(3);
		expect(parseFlatModifier('1d8 +3 slashing')).toBe(3);
		expect(parseFlatModifier('2d6-1')).toBe(-1);
		expect(parseFlatModifier('+2+3')).toBe(5);
	});
	it('reads the unicode minus `signed()` writes', () => {
		expect(parseFlatModifier('1d6 −1 bludgeoning')).toBe(-1);
	});
	it('takes an unsigned LEADING value only when the segment has no dice', () => {
		expect(parseFlatModifier('70')).toBe(70); // Heal
		expect(parseFlatModifier('1 bludgeoning')).toBe(1); // a fixed-damage weapon
		expect(parseFlatModifier('1d20 vs AC 15')).toBe(0);
	});
	it('reads the statblock average form as dice + the SIGNED mod only', () => {
		// the shipped monsters carry "12 (2d6 + 5)" — the 12 is the average, not a bonus
		expect(parseFlatModifier('12 (2d6 + 5)')).toBe(5);
		expect(parseFlatModifier('6 (1d12)')).toBe(0);
	});
	it('never mistakes a die count for a modifier', () => {
		expect(parseFlatModifier('1d10')).toBe(0);
		expect(parseFlatModifier('2d6+10d4')).toBe(0);
	});
});

describe('rollPool', () => {
	it('rolls a single die', () => {
		// the whole record, pinned: the dice ARE the result, and `expr` is one rendering of them
		expect(rollPool({ 6: 1 }, rngSequence(0.5))).toEqual({
			total: 4,
			mod: 0,
			dice: [{ sides: 6, value: 4, face: 4, sign: 1, detail: '4', role: DIE_ROLE.pool }],
			expr: 'd6(4)',
		});
	});

	it('appends a signed flat modifier', () => {
		expect(rollPool({ 6: 1 }, { rng: rngSequence(0.5), mod: 3 })).toMatchObject({
			total: 7,
			expr: 'd6(4) +3',
		});
		expect(rollPool({ 6: 1 }, { rng: rngSequence(0.5), mod: -2 })).toMatchObject({
			total: 2,
			expr: 'd6(4) −2',
		});
	});

	it('advantage rolls two d20 and keeps the higher, exposing the loser', () => {
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0.1, 0.9), advantage: 1 }); // d20 → 3, then 19
		expect(r.total).toBe(19);
		expect(r.advantageRoll).toMatchObject({ kept: 19, dropped: 3, mode: 1 });
	});

	it('disadvantage keeps the lower', () => {
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0.1, 0.9), advantage: -1 });
		expect(r.total).toBe(3);
		expect(r.advantageRoll).toMatchObject({ kept: 3, dropped: 19, mode: -1 });
	});

	it('adds signed bonus dice (Bless +1d4 / Bane −1d4)', () => {
		const bless = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.5, 0.5), bonusDice: [{ sides: 4, count: 1, sign: 1 }] },
		);
		expect(bless).toMatchObject({ total: 14, expr: 'd20(11) + +d4(3)' });
		const bane = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.5, 0.5), bonusDice: [{ sides: 4, count: 1, sign: -1 }] },
		);
		expect(bane).toMatchObject({ total: 8, expr: 'd20(11) + −d4(3)' });
	});

	it('sorts the pool high-sides first', () => {
		const r = rollPool({ 4: 1, 8: 1 }, rngSequence(0.5, 0.5)); // d8 then d4
		expect(r.expr).toBe('d8(5) + d4(3)');
		expect(r.total).toBe(8);
	});

	it('exposes the natural d20 face (nat-1/nat-20 outcomes)', () => {
		expect(rollPool({ 20: 1 }, { rng: rngSequence(0.999), mod: 5 }).natural).toBe(20); // 20 + 5 = 25 total
		expect(rollPool({ 20: 1 }, { rng: rngSequence(0), mod: 5 }).natural).toBe(1);
		expect(rollPool({ 6: 1 }, rngSequence(0.5)).natural).toBeUndefined(); // no d20 in pool
	});
});

describe('rollPool · roll-manipulation (L1 reroll / min_die facts)', () => {
	it('rerolls a die that lands ≤ the threshold, keeping the new result (GWF ≤2)', () => {
		// d6 → 1 (≤2, reroll) → 5; the label shows both faces
		const r = rollPool({ 6: 1 }, { rng: rngSequence(0, 0.7), reroll: 2 });
		expect(r.total).toBe(5);
		expect(r.expr).toBe('d6(1↻5)');
	});

	it('does NOT reroll a die above the threshold', () => {
		const r = rollPool({ 6: 1 }, { rng: rngSequence(0.5), reroll: 2 }); // d6 → 4, kept
		expect(r.total).toBe(4);
		expect(r.expr).toBe('d6(4)');
	});

	it('floors a die below the minimum AS the minimum (Reliable Talent d20 → 10)', () => {
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0.1), minDie: 10, mod: 3 }); // d20 → 3 → 10
		expect(r.total).toBe(13); // 10 + 3 mod
		expect(r.expr).toBe('d20(3→10) +3');
		expect(r.natural).toBe(3); // the NATURAL face is pre-floor (a nat-1 is still a nat-1)
	});

	it('applies reroll THEN floor in order (Halfling Lucky 1 + a floor)', () => {
		// d20 → 1 (reroll on 1) → 4, then floored to 10
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0, 0.15), reroll: 1, minDie: 10 });
		expect(r.total).toBe(10);
		expect(r.expr).toBe('d20(1↻4→10)');
	});

	it('accepts a bare Rng for the existing callers (back-compat)', () => {
		expect(rollPool({ 6: 1 }, rngSequence(0.5)).total).toBe(4);
	});
});

describe('rollFormula', () => {
	it('rolls EVERY dice group (the old compendium roller only did the first)', () => {
		const r = rollFormula('1d8 + 1d4', rngSequence(0.5, 0.5));
		expect(r.total).toBe(8); // 5 + 3
	});

	it('parses a trailing flat modifier', () => {
		const r = rollFormula('2d6 + 3', rngSequence(0.5, 0.5));
		expect(r.total).toBe(11); // 4 + 4 + 3
	});

	it('handles a monster HP formula', () => {
		const r = rollFormula('16d12 + 80', rngSequence(...Array(16).fill(0.5)));
		expect(r.total).toBe(16 * 7 + 80); // d12 at 0.5 → 7
	});

	// UBUG-22: the modifier used to be read by a TAIL regex, so any +N with dice after it was lost —
	// silently, and reachable from content (a homebrew `heal:1d8+2+1d4`) and from the plugin API.
	it('counts a flat modifier that is not at the end (UBUG-22)', () => {
		// maximal dice: 0.99 on a d6 → 6, on a d4 → 4
		expect(rollFormula('1d6+3+1d4', rngSequence(0.99, 0.99)).total).toBe(13);
	});

	it('counts a signed modifier that comes BEFORE any dice', () => {
		expect(rollFormula('+2 + 1d6', rngSequence(0.99)).total).toBe(8);
	});

	it('rolls a bare-count die and a dice-less flat value', () => {
		expect(rollFormula('d8+2', rngSequence(0.99)).total).toBe(10);
		expect(rollFormula('70').total).toBe(70); // Heal — no dice at all, and no rng drawn
	});

	it('rolls the statblock average form as its dice, not its average', () => {
		expect(rollFormula('12 (2d6 + 5)', rngSequence(0.99, 0.99)).total).toBe(17);
	});

	it('subtracts a negative modifier wherever it sits', () => {
		expect(rollFormula('2d6-1', rngSequence(0.99, 0.99)).total).toBe(11);
		expect(rollFormula('1d6-2+1d4', rngSequence(0.99, 0.99)).total).toBe(8);
	});

	it('never reads a die COUNT as a modifier', () => {
		const r = rollFormula('2d6+10d4', rngSequence(...Array(12).fill(0.99)));
		expect(r.total).toBe(2 * 6 + 10 * 4); // the +10 belongs to d4, not to the total
	});

	it('ignores an unsigned number that is neither leading nor a die (prose, not a bonus)', () => {
		expect(rollFormula('1d20 vs AC 15', rngSequence(0.99)).total).toBe(20);
	});
});

describe('parseLegacyExpr (reading a roll off disk that predates `dice`)', () => {
	it('round-trips a rolled expr into per-die chips + the flat modifier', () => {
		const r = rollPool({ 8: 1, 6: 1 }, { rng: rngSequence(0.5, 0.5), mod: 3 });
		const { dice: chips, mod } = parseLegacyExpr(r.expr); // "d8(5) + d6(4) +3"
		expect(chips.map((c) => [c.sides, c.value, c.sign])).toEqual([
			[8, 5, 1],
			[6, 4, 1],
		]);
		expect(mod).toBe(3);
		expect(chips.reduce((n, c) => n + c.sign * c.value, 0) + mod).toBe(r.total);
	});

	it('takes the FINAL face of a rerolled/floored die and keeps the detail', () => {
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0, 0.15), reroll: 1, minDie: 10 });
		expect(parseLegacyExpr(r.expr).dice).toEqual([
			// value is what it counted for, face is what the die showed before the floor — the string
			// holds both, which is the one thing this reader can still recover exactly
			{ sides: 20, value: 10, face: 4, sign: 1, detail: '1↻4→10', role: DIE_ROLE.pool },
		]);
	});

	it('signs a negative bonus die and reads a negative modifier', () => {
		const r = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.5, 0.5), mod: -2, bonusDice: [{ sides: 4, count: 1, sign: -1 }] },
		);
		const { dice: chips, mod } = parseLegacyExpr(r.expr); // "d20(11) + −d4(3) −2"
		expect(chips.map((c) => c.sign)).toEqual([1, -1]);
		expect(mod).toBe(-2);
		expect(chips.reduce((n, c) => n + c.sign * c.value, 0) + mod).toBe(r.total);
	});

	it('is empty for a marker entry with no expr', () => {
		expect(parseLegacyExpr('')).toEqual({ dice: [], mod: 0 });
	});
});

/*
 * The record is the DICE now, not the string. What matters is that a roll answers with what happened
 * (ROLLER-PLAN finding A), that the string it still emits is a faithful rendering of that, and that a
 * roll read back off disk arrives in the same shape as one just rolled — no caller should ever have
 * to know which of the two it is holding.
 */
describe('Rolled.dice — the record, with `expr` as its rendering', () => {
	it('records every die with what it showed, what it counted for, and what drew it', () => {
		const r = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.1, 0.5), minDie: 10, bonusDice: [{ sides: 4, count: 1, sign: -1 }] },
		);
		expect(r.dice).toEqual([
			// floored: it showed 3, it counted 10 — the two numbers the old string had to encode
			{ sides: 20, value: 10, face: 3, sign: 1, detail: '3→10', role: DIE_ROLE.pool },
			{ sides: 4, value: 3, face: 3, sign: -1, detail: '3', role: DIE_ROLE.bonus },
		]);
		expect(r.dice.reduce((n, d) => n + d.sign * d.value, 0) + r.mod).toBe(r.total);
	});

	it('renders a positive bonus die with its sign — the distinction the old formatter lost', () => {
		const r = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.5, 0.5), bonusDice: [{ sides: 4, count: 1, sign: 1 }] },
		);
		expect(r.expr).toBe('d20(11) + +d4(3)'); // a pool d4 would read `d4(3)`
		expect(r.dice.map((d) => d.role)).toEqual([DIE_ROLE.pool, DIE_ROLE.bonus]);
	});

	it('leaves a roll that already has its dice exactly as it found it', () => {
		const fresh = rollPool({ 8: 2 }, rngSequence(0.5, 0.5));
		expect(rehydrateRoll(fresh)).toEqual(fresh);
	});

	it('fills the dice of a roll stored before they existed, from the string it did store', () => {
		const stored = rehydrateRoll({ expr: 'd8(5) + d6(4) +3', total: 12 });
		expect(stored.mod).toBe(3);
		expect(stored.dice.map((d) => [d.sides, d.value])).toEqual([
			[8, 5],
			[6, 4],
		]);
	});

	it('amends a roll through its dice, and the rendered string follows', () => {
		// the kept d20 moves to `advantageRoll`, so it must leave BOTH the dice and their rendering
		const start = rollPool({ 20: 1, 6: 1 }, { rng: rngSequence(0.3, 0.5), mod: 4 });
		const out = amendWithAdvantage(start, () => 0.9);
		expect(out?.dice.map((d) => d.sides)).toEqual([6]);
		expect(out?.expr).toBe(`d6(4) +4`);
		expect(out?.mod).toBe(4);
	});
});

describe('parseLegacyExpr · advantage-only pool', () => {
	it('still reads the modifier when the kept d20 lives outside expr', () => {
		// an advantage roll's d20 is surfaced as `advantageRoll`, so expr is just the mod
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0.65, 0.3), mod: 5, advantage: 1 });
		expect(r.expr).toBe(' +5');
		expect(parseLegacyExpr(r.expr)).toEqual({ dice: [], mod: 5 });
	});
});

/*
 * UX-3 retroactive advantage: a roll that already landed can take a second d20 after the fact. The
 * cases that matter are the two outcomes (the new die wins / loses), the two ineligible shapes, and
 * that the kept die leaves `expr` so it can't render twice.
 */
describe('amendWithAdvantage', () => {
	/** A d20 roll as it comes back off DISK — an entry written before `Rolled` carried its dice, so
	 *  the amend path is exercised against exactly the shape the legacy reader hands it. */
	const rolled = (expr: string, total: number, natural?: number): Rolled =>
		rehydrateRoll({ expr, total, ...(natural !== undefined ? { natural } : {}) });

	it('keeps the fresh die when it beats the original, and raises the total by the difference', () => {
		const out = amendWithAdvantage(rolled('d20(7) +4', 11, 7), () => 0.9); // → 19
		expect(out).not.toBeNull();
		expect(out?.advantageRoll).toMatchObject({ kept: 19, dropped: 7, mode: 1 });
		expect(out?.total).toBe(23);
		expect(out?.natural).toBe(19);
	});

	it('keeps the original when the fresh die loses, and the total does not move', () => {
		const out = amendWithAdvantage(rolled('d20(18) +4', 22, 18), () => 0.1); // → 3
		expect(out?.advantageRoll).toMatchObject({ kept: 18, dropped: 3, mode: 1 });
		expect(out?.total).toBe(22);
		expect(out?.natural).toBe(18);
	});

	it('takes the kept d20 out of `expr` (it renders from advantageRoll — else it shows twice)', () => {
		const out = amendWithAdvantage(rolled('d20(7) + d6(3) +4', 14, 7), () => 0.9);
		expect(out?.dice.map((d) => d.sides)).toEqual([6]);
		expect(out?.mod).toBe(4);
	});

	it('compares what the dice CONTRIBUTE, so a min_die floor is not undone', () => {
		// Reliable Talent: a natural 3 was floored to 10 and contributed 10; a fresh 7 must not win
		const out = amendWithAdvantage(rolled('d20(3→10) +5', 15, 3), () => 0.31); // → 7
		expect(out?.advantageRoll).toMatchObject({ kept: 10, dropped: 7, mode: 1 });
		expect(out?.total).toBe(15);
	});

	it('refuses a roll that two dice already decided', () => {
		expect(
			amendWithAdvantage(
				rehydrateRoll({ expr: '+4', total: 18, advantageRoll: { kept: 14, dropped: 3 } }),
			),
		).toBeNull();
	});

	it('refuses a roll with no d20 in it (damage)', () => {
		expect(amendWithAdvantage(rolled('d8(5) + d6(2) +3', 10))).toBeNull();
	});
});

/*
 * `mode` records advantage vs disadvantage on the pair itself. It cannot be recovered from the two
 * numbers — a tie looks identical either way — and the roll row frames the pair green or red by it.
 */
describe('advantageRoll.mode', () => {
	const rolled = (expr: string, total: number): Rolled => rehydrateRoll({ expr, total });

	it('is +1 for advantage and −1 for disadvantage even when both dice tie', () => {
		const tie = () => 0.5; // both d20 land on the same face
		expect(rollPool({ 20: 1 }, { rng: tie, advantage: 1 }).advantageRoll?.mode).toBe(1);
		expect(rollPool({ 20: 1 }, { rng: tie, advantage: -1 }).advantageRoll?.mode).toBe(-1);
	});

	it('a roll amended after the fact is advantage by construction', () => {
		expect(amendWithAdvantage(rolled('d20(7) +4', 11))?.advantageRoll?.mode).toBe(1);
	});
});

/*
 * Tapping the d20 a second time switches advantage to disadvantage. It reinterprets the pair already
 * rolled rather than drawing a new die, so the toggle can never manufacture a better result.
 */
describe('flipAdvantage', () => {
	const plain = (expr: string, total: number): Rolled => rehydrateRoll({ expr, total });

	it('swaps which of the two dice counted, and moves the total with it', () => {
		const advantaged = amendWithAdvantage(plain('d20(7) +4', 11), () => 0.9); // 19 kept
		const flipped = flipAdvantage(advantaged!);
		expect(flipped?.advantageRoll).toMatchObject({ kept: 7, dropped: 19, mode: -1 });
		expect(flipped?.total).toBe(11); // back to what the original die scored
		expect(flipped?.natural).toBe(7);
	});

	it('flips back, so the control is a toggle and not a one-way door', () => {
		const once = amendWithAdvantage(plain('d20(7) +4', 11), () => 0.9);
		const twice = flipAdvantage(flipAdvantage(once!)!);
		expect(twice?.advantageRoll).toMatchObject({ kept: 19, dropped: 7, mode: 1 });
		expect(twice?.total).toBe(23);
	});

	it('still flips the MODE when the two dice tied (the numbers alone can never say which)', () => {
		const tied = rollPool({ 20: 1 }, { rng: () => 0.5, advantage: 1 });
		const flipped = flipAdvantage(tied);
		expect(flipped?.advantageRoll?.mode).toBe(-1);
		expect(flipped?.total).toBe(tied.total);
	});

	it('refuses a roll no pair decided', () => {
		expect(flipAdvantage(plain('d20(7) +4', 11))).toBeNull();
	});
});

/*
 * The d20 pill is a three-state control: advantage → disadvantage → neither. Only the first tap draws
 * a die, so a lap round the cycle can never improve a roll, and a mis-tap is always undoable.
 */
describe('cycleAdvantage', () => {
	const plain = (expr: string, total: number): Rolled => rehydrateRoll({ expr, total });

	it('goes advantage → disadvantage → neither, and back to the roll as it landed', () => {
		const start = plain('d20(7) + d6(3) +4', 14);
		const adv = cycleAdvantage(start, () => 0.9); // fresh 19 beats 7
		expect(adv?.advantageRoll).toMatchObject({ kept: 19, dropped: 7, mode: 1, original: 7 });
		expect(adv?.total).toBe(26);

		const dis = cycleAdvantage(adv!);
		expect(dis?.advantageRoll).toMatchObject({ kept: 7, dropped: 19, mode: -1 });
		expect(dis?.total).toBe(14);

		const none = cycleAdvantage(dis!);
		expect(none?.advantageRoll).toBeUndefined();
		expect(none?.total).toBe(14); // exactly the roll we started from
		expect(none?.dice).toEqual(start.dice);
		expect(none?.expr).toBe(start.expr);
	});

	it('undoes a NATIVE disadvantage back to the die that was rolled first', () => {
		const rolled = rollPool({ 20: 1 }, { rng: rngSequence(0.9, 0.1), mod: 2, advantage: -1 }); // 19 then 3, keeps 3
		expect(rolled.advantageRoll).toMatchObject({ kept: 3, dropped: 19, original: 19 });
		const none = cycleAdvantage(rolled);
		expect(none?.advantageRoll).toBeUndefined();
		expect(none?.total).toBe(21); // 19 + 2
	});

	it('an entry with no recorded original flips instead of getting stuck', () => {
		const legacy: Rolled = rehydrateRoll({
			expr: '+4',
			total: 7,
			advantageRoll: { kept: 3, dropped: 18, mode: -1 },
		});
		expect(cycleAdvantage(legacy)?.advantageRoll).toMatchObject({ kept: 18, mode: 1 });
	});
});

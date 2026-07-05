import { describe, it, expect } from 'vitest';
import { rollPool, rollFormula, parseDicePool, type Rng } from './dice';

/** RNG that yields the given [0,1) values in order (then throws if over-drawn — catches extra draws). */
function rngSequence(...values: number[]): Rng {
	let i = 0;
	return () => {
		if (i >= values.length) throw new Error('rng over-drawn');
		return values[i++]!;
	};
}
// rollDie(sides) = 1 + floor(rng()*sides); 0.5 on a d6 → 4, on a d20 → 11, on a d4 → 3.

describe('parseDicePool', () => {
	it('sums every NdM group', () => {
		expect(parseDicePool('2d6 + 1d4')).toEqual({ 6: 2, 4: 1 });
		expect(parseDicePool('3d8')).toEqual({ 8: 3 });
		expect(parseDicePool('no dice here')).toEqual({});
	});
});

describe('rollPool', () => {
	it('rolls a single die', () => {
		expect(rollPool({ 6: 1 }, 0, 0, [], rngSequence(0.5))).toEqual({ total: 4, expr: 'd6(4)' });
	});

	it('appends a signed flat modifier', () => {
		expect(rollPool({ 6: 1 }, 3, 0, [], rngSequence(0.5))).toMatchObject({
			total: 7,
			expr: 'd6(4) +3'
		});
		expect(rollPool({ 6: 1 }, -2, 0, [], rngSequence(0.5))).toMatchObject({
			total: 2,
			expr: 'd6(4) −2'
		});
	});

	it('advantage rolls two d20 and keeps the higher, exposing the loser', () => {
		const r = rollPool({ 20: 1 }, 0, 1, [], rngSequence(0.1, 0.9)); // d20 → 3, then 19
		expect(r.total).toBe(19);
		expect(r.advantageRoll).toEqual({ kept: 19, dropped: 3 });
	});

	it('disadvantage keeps the lower', () => {
		const r = rollPool({ 20: 1 }, 0, -1, [], rngSequence(0.1, 0.9));
		expect(r.total).toBe(3);
		expect(r.advantageRoll).toEqual({ kept: 3, dropped: 19 });
	});

	it('adds signed bonus dice (Bless +1d4 / Bane −1d4)', () => {
		const bless = rollPool(
			{ 20: 1 },
			0,
			0,
			[{ sides: 4, count: 1, sign: 1 }],
			rngSequence(0.5, 0.5)
		);
		expect(bless).toMatchObject({ total: 14, expr: 'd20(11) + +d4(3)' });
		const bane = rollPool(
			{ 20: 1 },
			0,
			0,
			[{ sides: 4, count: 1, sign: -1 }],
			rngSequence(0.5, 0.5)
		);
		expect(bane).toMatchObject({ total: 8, expr: 'd20(11) + −d4(3)' });
	});

	it('sorts the pool high-sides first', () => {
		const r = rollPool({ 4: 1, 8: 1 }, 0, 0, [], rngSequence(0.5, 0.5)); // d8 then d4
		expect(r.expr).toBe('d8(5) + d4(3)');
		expect(r.total).toBe(8);
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
});

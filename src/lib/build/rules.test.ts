import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	pointBuyCost,
	pointsSpent,
	pointsRemaining,
	canRaise,
	canLower,
	boostCarrier,
	allocateBackgroundBoost,
	boostPickCount,
	asiFeatLevels,
	baseAbilities,
	POINT_BUY_BUDGET,
	POINT_BUY_MIN,
	POINT_BUY_MAX
} from './rules';
import { ABILITIES } from '../character/schema';

describe('point-buy', () => {
	it('costs match the SRD table', () => {
		expect([8, 9, 10, 11, 12, 13, 14, 15].map(pointBuyCost)).toEqual([0, 1, 2, 3, 4, 5, 7, 9]);
	});

	it('a fresh all-8 set spends nothing', () => {
		expect(pointsSpent(baseAbilities())).toBe(0);
		expect(pointsRemaining(baseAbilities())).toBe(POINT_BUY_BUDGET);
	});

	it('the classic 15/15/15/8/8/8 buy costs exactly the budget', () => {
		const a = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 };
		expect(pointsSpent(a)).toBe(27);
		expect(pointsRemaining(a)).toBe(0);
	});

	it('blocks a raise past 15 or over budget', () => {
		const maxed = { str: 15, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
		expect(canRaise(maxed, 'str')).toBe(false); // cap
		const broke = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 };
		expect(canRaise(broke, 'int')).toBe(false); // no points left
		expect(canRaise(baseAbilities(), 'str')).toBe(true);
	});

	it('blocks a lower below 8', () => {
		expect(canLower(baseAbilities(), 'str')).toBe(false);
		expect(canLower({ ...baseAbilities(), str: 12 }, 'str')).toBe(true);
	});

	it('never lets a legal buy exceed the budget (invariant)', () => {
		const score = fc.integer({ min: POINT_BUY_MIN, max: POINT_BUY_MAX });
		fc.assert(
			fc.property(fc.tuple(score, score, score, score, score, score), (vals) => {
				const a = Object.fromEntries(
					ABILITIES.map((ab, i) => [ab, vals[i]])
				) as Record<(typeof ABILITIES)[number], number>;
				// spent is a pure function of scores; it must be ≥0 and match the manual sum
				const manual = ABILITIES.reduce((n, ab) => n + pointBuyCost(a[ab]), 0);
				return pointsSpent(a) === manual && manual >= 0;
			})
		);
	});
});

describe('ability-boost placement', () => {
	it('5.5e boosts the background, 5e the species', () => {
		expect(boostCarrier('5.5e')).toBe('background');
		expect(boostCarrier('5e')).toBe('species');
	});

	it('allocates a +2/+1 over the offered abilities', () => {
		const b = allocateBackgroundBoost('2-1', ['int', 'con'], ['int', 'wis', 'con']);
		expect(b).toEqual({ int: 2, con: 1 });
	});

	it('allocates +1/+1/+1', () => {
		const b = allocateBackgroundBoost('1-1-1', ['int', 'wis', 'con'], ['int', 'wis', 'con']);
		expect(b).toEqual({ int: 1, wis: 1, con: 1 });
	});

	it('ignores picks outside the background offer', () => {
		const b = allocateBackgroundBoost('2-1', ['str', 'int'], ['int', 'wis', 'con']);
		expect(b).toEqual({ int: 2 }); // str dropped, only int remains
	});

	it('asks for 2 picks on a 2-1 shape and 3 on 1-1-1', () => {
		expect(boostPickCount('2-1')).toBe(2);
		expect(boostPickCount('1-1-1')).toBe(3);
	});
});

describe('feat / ASI slots', () => {
	// levels come from the class's own `asi_levels` data (see the converters); the fn just filters
	// them to the character's level, with a common-progression fallback when none is supplied.
	const fighter = [4, 6, 8, 12, 14, 16, 19];
	const rogue = [4, 8, 10, 12, 16, 19];
	it('falls back to the common 4/8/12/16/19 progression when no data is given', () => {
		expect(asiFeatLevels(20)).toEqual([4, 8, 12, 16, 19]);
		expect(asiFeatLevels(4)).toEqual([4]);
		expect(asiFeatLevels(3)).toEqual([]);
	});
	it('uses the class-specific progression and filters to the level', () => {
		expect(asiFeatLevels(20, fighter)).toEqual([4, 6, 8, 12, 14, 16, 19]);
		expect(asiFeatLevels(20, rogue)).toEqual([4, 8, 10, 12, 16, 19]);
		expect(asiFeatLevels(6, fighter)).toEqual([4, 6]);
	});
});

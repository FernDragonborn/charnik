import { describe, it, expect } from 'vitest';
import { parseSpeciesBoostChoice, asiBoost, speciesFixedAbilities } from './derive';
import type { LoadedRow } from '../content/loader';

describe('parseSpeciesBoostChoice', () => {
	it('parses "AxB" into { amount: A, count: B } and rejects junk', () => {
		expect(parseSpeciesBoostChoice('1x2')).toEqual({ amount: 1, count: 2 });
		expect(parseSpeciesBoostChoice('  2x1 ')).toEqual({ amount: 2, count: 1 });
		expect(parseSpeciesBoostChoice('')).toBeNull();
		expect(parseSpeciesBoostChoice('nope')).toBeNull();
	});
});

describe('asiBoost', () => {
	it('+2 shape puts 2 on the first pick', () => {
		expect(asiBoost({ shape: '2', picks: ['str'] })).toEqual({ str: 2 });
	});
	it('+1/+1 shape puts 1 on each of two picks', () => {
		expect(asiBoost({ shape: '1-1', picks: ['str', 'dex'] })).toEqual({ str: 1, dex: 1 });
	});
	it('undefined / empty picks → no boost', () => {
		expect(asiBoost(undefined)).toEqual({});
		expect(asiBoost({ shape: '2', picks: [] })).toEqual({});
	});
});

describe('speciesFixedAbilities', () => {
	const row = (effects: string[]) => ({ data: { effects } }) as unknown as LoadedRow;
	it('collects the abilities a flat-bonus effect raises, ignoring non-ability targets', () => {
		const set = speciesFixedAbilities([row(['flat-bonus:cha+2', 'flat-bonus:ac+1']), undefined]);
		expect([...set]).toEqual(['cha']); // ac is not an ability
	});
});

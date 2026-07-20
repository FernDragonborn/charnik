import { describe, it, expect } from 'vitest';
import { suggestClosest, didYouMean } from './suggest';

describe('suggestClosest — nearest valid candidate(s) within a length-relative cap (PLG-9)', () => {
	const targets = ['ac', 'attack', 'damage', 'initiative', 'speed', 'save.dex'];

	it('suggests a one-edit typo on a longer id', () => {
		expect(suggestClosest('attak', targets)).toEqual(['attack']);
		expect(suggestClosest('initiativ', targets)).toEqual(['initiative']);
	});

	it('returns nothing for an exact match (not a typo)', () => {
		expect(suggestClosest('attack', targets)).toEqual([]);
	});

	it('returns nothing when nothing is close enough', () => {
		expect(suggestClosest('xyzzy', targets)).toEqual([]);
	});

	it('does NOT guess for short ids where a small distance is garbage (hp→ac is distance 2)', () => {
		expect(suggestClosest('hp', ['ac'])).toEqual([]); // len 2 → cap 1, distance 2 rejected
	});

	it('surfaces a transposition within the tier even on plain Levenshtein (distance 2)', () => {
		expect(suggestClosest('flta_bonus', ['flat_bonus', 'set_override'])).toEqual(['flat_bonus']);
	});

	it('ranks by distance then alphabetically and caps the list length', () => {
		// "attac" (len 5 → cap 2) is one edit from both "attach" and "attack"; tie broken by name
		expect(suggestClosest('attac', ['attack', 'attach', 'random'], 2)).toEqual([
			'attach',
			'attack'
		]);
	});
});

describe('didYouMean — the ready-to-append error suffix', () => {
	it('formats one candidate', () => {
		expect(didYouMean('attak', ['attack', 'ac'])).toBe(' — did you mean "attack"?');
	});
	it('formats two candidates with "or"', () => {
		expect(didYouMean('attac', ['attack', 'attach'])).toBe(' — did you mean "attach" or "attack"?');
	});
	it('is empty when nothing is close', () => {
		expect(didYouMean('zzzzz', ['attack'])).toBe('');
	});
});

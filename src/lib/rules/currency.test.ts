/*
 * Coins. Two things can be wrong here and neither is visible: what a purse is worth, and what it
 * weighs — a number that quietly moves someone's carried load into "over capacity".
 */
import { describe, it, expect } from 'vitest';
import { COINS, coinCount, purseInCopper, purseWeightLb } from './currency';

describe('currency', () => {
	it('carries the five PHB coins, smallest first', () => {
		expect(COINS.map((c) => c.id)).toEqual(['cp', 'sp', 'ep', 'gp', 'pp']);
		expect(COINS.map((c) => c.copper)).toEqual([1, 10, 50, 100, 1000]);
	});

	it('values a mixed purse in copper', () => {
		// the exchange line the panel prints, arithmetically: 1 gp = 10 sp = 100 cp, 1 ep = 5 sp
		expect(purseInCopper({ gp: 1 })).toBe(purseInCopper({ sp: 10 }));
		expect(purseInCopper({ ep: 1 })).toBe(purseInCopper({ sp: 5 }));
		expect(purseInCopper({ pp: 1 })).toBe(purseInCopper({ gp: 10 }));
		expect(purseInCopper({ cp: 3, sp: 2, gp: 1 })).toBe(123);
	});

	it('weighs 50 coins to the pound, whatever the metal', () => {
		expect(purseWeightLb({ cp: 50 })).toBe(1);
		expect(purseWeightLb({ pp: 50 })).toBe(1);
		expect(purseWeightLb({ gp: 25, sp: 25 })).toBe(1);
		expect(purseWeightLb({})).toBe(0);
	});

	it('ignores an absent or negative count rather than crediting it', () => {
		// a purse is a partial map, and a negative cell is a hand-edited save, not a debt
		expect(coinCount({ gp: 2, xp: 900 })).toBe(2); // an unknown key is not a coin
		expect(coinCount({ gp: -5 })).toBe(0);
		expect(purseInCopper({ gp: -5, sp: 1 })).toBe(10);
	});
});

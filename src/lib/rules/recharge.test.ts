/*
 * The recharge model: what a cell means, and what a boundary gives back.
 *
 * The one-word policies are the ones on disk today, so the first thing worth proving is that they
 * still mean exactly what they meant — a sugar map that drifts silently changes every shipped class
 * feature at once.
 */
import { describe, it, expect } from 'vitest';
import { parseRecharge, restRecharge, rechargeRank } from './recharge';

describe('parseRecharge — the words on disk, and the two-axis model behind them', () => {
	it('reads the one-word policies as themselves', () => {
		expect(parseRecharge('short')).toEqual({ trigger: 'short', amount: 'all' });
		expect(parseRecharge('long')).toEqual({ trigger: 'long', amount: 'all' });
		expect(parseRecharge('consumable')).toEqual({ trigger: 'consumable', amount: 'all' });
		expect(parseRecharge('other')).toEqual({ trigger: 'other', amount: 'all' });
	});

	it('reads `short_one` as what it always meant: one use back on a short rest', () => {
		expect(parseRecharge('short_one')).toEqual({ trigger: 'short', amount: '1' });
	});

	it('reads a boundary with an amount', () => {
		expect(parseRecharge('dawn(1d6+1)')).toEqual({ trigger: 'dawn', amount: '1d6+1' });
		expect(parseRecharge('long(2)')).toEqual({ trigger: 'long', amount: '2' });
		expect(parseRecharge('dusk(all)')).toEqual({ trigger: 'dusk', amount: 'all' });
	});

	it('refuses what it cannot mean, rather than guessing half of it', () => {
		expect(parseRecharge('tuesday')).toBeUndefined();
		// an amount at a boundary that never comes round is a contradiction, not a policy
		expect(parseRecharge('consumable(2)')).toBeUndefined();
		expect(parseRecharge('')).toBeUndefined();
	});
});

describe('restRecharge — which rest gives what back', () => {
	const short = { trigger: 'short', amount: 'all' } as const;
	const shortOne = { trigger: 'short', amount: '1' } as const;
	const long = { trigger: 'long', amount: 'all' } as const;

	it('keeps every policy behaving exactly as its one-word self did', () => {
		expect(restRecharge(short, 'short')).toBe('all');
		expect(restRecharge(short, 'long')).toBe('all');
		expect(restRecharge(shortOne, 'short')).toBe('1'); // one use back
		expect(restRecharge(shortOne, 'long')).toBe('all'); // …and the pool on a long rest
		expect(restRecharge(long, 'short')).toBeNull();
		expect(restRecharge(long, 'long')).toBe('all');
		expect(restRecharge({ trigger: 'consumable', amount: 'all' }, 'long')).toBeNull();
		expect(restRecharge({ trigger: 'other', amount: 'all' }, 'long')).toBeNull();
	});

	it('a LONG-rest pool pays out its own amount there, rather than the whole pool', () => {
		// "a long rest refills everything a short rest would" is about the SHORT-rest pool. A pool whose
		// own boundary IS the long rest had its authored amount read for one trigger and ignored for the
		// other, so `long(2)` handed back all of them.
		const longTwo = { trigger: 'long', amount: '2' } as const;
		expect(restRecharge(longTwo, 'long')).toBe('2');
		expect(restRecharge(longTwo, 'short')).toBeNull();
	});

	it('does not hand a dawn pool back for sleeping — RAW ties it to the hour', () => {
		expect(restRecharge({ trigger: 'dawn', amount: '1d6+1' }, 'long')).toBeNull();
		expect(restRecharge({ trigger: 'dusk', amount: 'all' }, 'long')).toBeNull();
	});
});

describe('rechargeRank — the equal-max tie-break', () => {
	it('ranks a faster boundary above a slower one, and a full refill above a partial', () => {
		const rank = (trigger: string, amount = 'all') =>
			rechargeRank({ trigger, amount } as Parameters<typeof rechargeRank>[0]);
		expect(rank('short')).toBeGreaterThan(rank('long'));
		expect(rank('short')).toBeGreaterThan(rank('short', '1'));
		expect(rank('long')).toBeGreaterThan(rank('other'));
		expect(rank('other')).toBeGreaterThan(rank('consumable'));
	});
});

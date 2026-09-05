/*
 * Resolving a recharge amount — the half of the model that needs L2, and the only place a die is
 * rolled for charges.
 */
import { describe, it, expect } from 'vitest';
import { rechargeCount } from './recharge-amount';
import { rngSequence } from '../../test-support/rng';
import type { ExprContext } from './expression-evaluator';

const CTX = { vars: {}, system: '5.5e' } as unknown as ExprContext;

describe('rechargeCount — how many uses an amount is', () => {
	it('rolls a dice amount, once', () => {
		// 1d6+1 with a 4 on the die → 5 charges back
		expect(rechargeCount('1d6+1', CTX, rngSequence(0.5))).toBe(5);
	});

	it('reads a flat amount without rolling anything', () => {
		expect(rechargeCount('2', CTX, rngSequence())).toBe(2);
	});

	it('says nothing rather than restoring zero when it cannot read the amount', () => {
		expect(rechargeCount('nonsense(', CTX, rngSequence())).toBeNull();
		expect(rechargeCount('1d6', undefined, rngSequence())).toBeNull();
		expect(rechargeCount('all', CTX, rngSequence())).toBeNull(); // 'all' is the caller's to mean
	});
});

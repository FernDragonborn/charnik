/*
 * How many uses a recharge amount is, right now.
 *
 * The MODEL — trigger, amount, which rest gives what back — is `rules/recharge.ts` and stays free of
 * this module, because the rules core must compute without the effects layer at all. Resolving the
 * amount is the part that needs L2, so it lives here: an amount is an expression, and an expression
 * is the effects module's language.
 */
import { RECHARGE_ALL, type RechargeAmount } from '$lib/rules/recharge';
import { evalExpression, type ExprContext } from './expression-evaluator';
import { rollPool } from '$lib/rules/dice';

/**
 * The number of uses an amount gives back, or `null` when there is no number to give: the amount is
 * {@link RECHARGE_ALL} (the whole pool, which is the caller's to mean), there is no context to read
 * it against, or the expression does not resolve — surfaced by the caller restoring nothing, never
 * by quietly restoring zero as if it had.
 *
 * A dice amount is ROLLED here, at the boundary, which is when the table rolls it — resolving it at
 * derive time would freeze one roll into the sheet until something else re-derived it.
 */
export function rechargeCount(
	amount: RechargeAmount,
	ctx: ExprContext | undefined,
	rng: () => number = Math.random,
): number | null {
	if (amount === RECHARGE_ALL || !ctx) return null;
	const r = evalExpression(amount, ctx);
	if (!r.ok) return null;
	if (r.value.type === 'number')
		return Number.isFinite(r.value.value) ? Math.max(0, Math.floor(r.value.value)) : null;
	return Math.max(0, rollPool(r.value.dice.pool, { mod: r.value.dice.flat, rng }).total);
}

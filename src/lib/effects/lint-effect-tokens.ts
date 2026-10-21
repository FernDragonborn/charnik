/*
 * Content-health's soft warnings over a row's effect tokens. Its own module because it reads tokens
 * the way an author wrote them rather than folding them: nothing in the derive calls it.
 */
import { formWordTakesExpression, parseToken, splitGuard } from './token-parser';
import { lintExpression } from './expression-evaluator';
import { actionFormulas } from './action-token';
import { RECHARGE_ALL } from '../rules/recharge';

/** Authoring-slip warnings for one row's effect tokens (content-health): lints every L2 expression
 *  slot — guard, value, resource max, resource recharge AMOUNT, an `on_event` action's formula — for
 *  the spec-promised soft warns
 *  (mixed-type `if()`, unusual die). Parse ERRORS are not reported here; they surface at derive as
 *  issues/inert notes. */
export function lintEffectTokens(tokens: string[]): string[] {
	const warns: string[] = [];
	for (const raw of tokens) {
		const g = splitGuard(raw);
		const exprs: string[] = [];
		if (g.guard !== undefined) exprs.push(g.guard);
		const p = parseToken(g.token);
		if (p.valueExpr) exprs.push(p.valueExpr);
		// a LITERAL dice bonus (`+1d7`) parses to `p.dice`, not `valueExpr` — lint it too, else the most
		// common author typo (an unusual die size in the fast-path form) would silently skip the warning
		if (p.dice) exprs.push(p.dice);
		if (p.resource?.maxExpr) exprs.push(p.resource.maxExpr);
		// a wand's `dawn(1d6+1)` is an expression like any other, and the typo that hits it is the same
		// one — it was the single L2 slot nothing looked at, one segment over from the max that is lit
		if (p.resource && p.resource.recharge.amount !== RECHARGE_ALL)
			exprs.push(p.resource.recharge.amount);
		if (p.form?.value && formWordTakesExpression(p.form.word)) exprs.push(p.form.value);
		// an `on_event` action's own formula (`heal:5+con_mod`) is an L2 expression too — the fifth slot,
		// asked through the same function the evaluator uses so the two cannot drift apart again
		if (p.action) exprs.push(...actionFormulas(p.action));
		for (const e of exprs) for (const w of lintExpression(e)) warns.push(`${raw} — ${w}`);
	}
	return warns;
}

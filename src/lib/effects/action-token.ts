/*
 * The executor ACTION token as data: the bounded verbs of docs/internals/actions.md §2 (`heal:`,
 * `roll:`, `attack:`, `rest:` …), and the L2 formula some of them carry.
 *
 * Resolving that formula happens ONCE, at derive time — the same treatment a resource max gets — so
 * the executor only ever rolls what it is handed and a malformed formula surfaces as a deriveIssue
 * on the sheet instead of failing under the player's finger. It lives here rather than beside either
 * caller because BOTH reach it now: a resource-option's `action` column (derive-resource-options)
 * and an `on_event` token's action (the effect fold).
 */
import { ISSUE_KEY, type EffectIssue } from './token-parser';
import { evalExpression, diceToFormula, type ExprContext } from './expression-evaluator';

/** Resolve the L2 values inside an action token. Supports a `;`-separated MULTI-action (Uncanny
 *  Metabolism = `restore_resource:focus;heal:<MA die>+monk_level`): each sub-token is resolved
 *  independently and rejoined with `;`, so the executor runs them in order. Ceiling: a `note:` inside
 *  a multi-action can't contain `;` (it's the separator). A single-token action (the common case) is
 *  unchanged — a split of one is itself. */
export function resolveActionFormula(
	action: string,
	ctx: ExprContext | undefined,
	name: string,
	issues: EffectIssue[] | undefined,
): string {
	return action
		.split(';')
		.map((tok) => resolveOneActionFormula(tok.trim(), ctx, name, issues))
		.filter(Boolean)
		.join(';');
}

/** Resolve ONE action sub-token's L2 value: `heal:` / `roll:` carry a formula
 *  (`1d10+class_level.fighter` → `1d10+5`); `apply_condition:` / `note:` / `restore_resource:` pass
 *  through unchanged. A resolution failure keeps the raw token + flags a deriveIssue (executor no-ops). */
function resolveOneActionFormula(
	action: string,
	ctx: ExprContext | undefined,
	name: string,
	issues: EffectIssue[] | undefined,
): string {
	const i = action.indexOf(':');
	if (i === -1) return action;
	const verb = action.slice(0, i);
	const rest = action.slice(i + 1).trim();
	if ((verb !== 'heal' && verb !== 'roll') || !rest || !ctx) return action;
	const r = evalExpression(rest, ctx);
	if (!r.ok) {
		issues?.push({
			source: name,
			token: action,
			key: ISSUE_KEY.unreadableOptionEffect,
			detail: r.error,
		});
		return action;
	}
	const formula =
		r.value.type === 'number' ? String(Math.floor(r.value.value)) : diceToFormula(r.value.dice);
	return `${verb}:${formula}`;
}

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

/** WHICH verbs carry an L2 formula. `apply_condition:` / `note:` / `restore_resource:` carry an id or
 *  a sentence, and evaluating those would be reading a value out of prose. */
const FORMULA_VERBS = new Set(['heal', 'roll']);

/** The L2 expression a single action sub-token carries, or null when it carries none. */
function formulaOf(action: string): string | null {
	const i = action.indexOf(':');
	if (i === -1) return null;
	const rest = action.slice(i + 1).trim();
	return FORMULA_VERBS.has(action.slice(0, i)) && rest ? rest : null;
}

/** Every L2 expression slot inside an action token (a `;`-separated multi-action carries one per verb).
 *  Exported so the content-health linter asks the same question the evaluator does: this was the one L2
 *  slot nothing linted, and it went unlinted because the answer lived inside the resolver. */
export function actionFormulas(action: string): string[] {
	return action
		.split(';')
		.map((tok) => formulaOf(tok.trim()))
		.filter((f): f is string => f !== null);
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
	const rest = formulaOf(action);
	if (rest === null || !ctx) return action;
	const verb = action.slice(0, action.indexOf(':'));
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

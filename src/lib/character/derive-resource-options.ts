/*
 * Piece 3: the spend-options a character's granted resources offer (Ki → Flurry of Blows), read off
 * the `resource_option` linked table. Split out of `derive.ts`, which is the orchestrator.
 *
 * The L2 formulas inside an option's `action` are resolved HERE, once, at derive time — the same
 * treatment resource maxes get. The executor then only has to roll what it is handed, and a
 * malformed formula surfaces as a deriveIssue on the sheet instead of failing at the moment the
 * player clicks the button.
 */
import type { ContentGraph, LoadedRow } from '../content/loader';
import type { EffectIssue } from '../effects/token-parser';
import { evalExpression, diceToFormula, type ExprContext } from '../effects/expression-evaluator';
import type { System } from '../rules/pipeline';

/** Piece 3: a spend-option on a granted resource, resolved for a specific character. `cost` is a
 *  small integer or `'x'` (player-picked variable spend, 1..remaining); context-dependent costs
 *  (spell_level etc.) are deferred — an unsupported cost drops the option with a deriveIssue. */
export interface ResourceOption {
	id: string;
	resourceId: string;
	name: string;
	description: string;
	/** Bounded action token(s) the UI runs / displays: apply_condition / heal / roll / apply_effect /
	 *  gain_action / rest:short|long / restore_resource:<id> / note. A `;`-separated LIST is a
	 *  multi-action (Uncanny Metabolism = regain focus AND heal) — run in order on one activation. */
	action: string;
	actionType: 'action' | 'bonus_action' | 'reaction' | 'free';
	cost: number | 'x';
	/** Whether the option's `available` L2 guard passes right now (no guard → always true). A false
	 *  guard greys the option out — e.g. Persistent Rage is offerable only at combat start. */
	available: boolean;
}

interface ResourceOptionsInput {
	graph: ContentGraph;
	resourceIds: Set<string>;
	system: System;
	isActive: (row: LoadedRow) => boolean;
	issues: EffectIssue[];
	/** The L2 context (base), so a `heal:`/`roll:` action's formula resolves to concrete dice HERE
	 *  (once, like resource maxes) instead of at spend time; absent when auto-calc is off (manual). */
	ctx: ExprContext | undefined;
}

/** Resolve the L2 value inside a resource-option `action` so the executor can just roll it. Supports a
 *  `;`-separated MULTI-action (Uncanny Metabolism = `restore_resource:focus;heal:<MA die>+monk_level`):
 *  each sub-token is resolved independently and rejoined with `;`, so the executor runs them in order.
 *  Ceiling: a `note:` inside a multi-action can't contain `;` (it's the action separator) — no shipped
 *  option needs one. A single-token action (the common case) is unchanged (split of one = itself). */
function resolveActionFormula(
	action: string,
	ctx: ExprContext | undefined,
	name: string,
	issues: EffectIssue[],
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
	issues: EffectIssue[],
): string {
	const i = action.indexOf(':');
	if (i === -1) return action;
	const verb = action.slice(0, i);
	const rest = action.slice(i + 1).trim();
	if ((verb !== 'heal' && verb !== 'roll') || !rest || !ctx) return action;
	const r = evalExpression(rest, ctx);
	if (!r.ok) {
		issues.push({ source: name, token: action, reason: r.error });
		return action;
	}
	const formula =
		r.value.type === 'number' ? String(Math.floor(r.value.value)) : diceToFormula(r.value.dice);
	return `${verb}:${formula}`;
}

/** Evaluate an option's `available` L2 boolean guard → is it offerable right now? Empty → always
 *  available; a malformed guard fails OPEN (available) + a deriveIssue, so a bad guard surfaces
 *  rather than silently hiding the option (SPEC4-style: surface, never swallow). */
function resolveAvailable(
	expr: string,
	ctx: ExprContext | undefined,
	name: string,
	issues: EffectIssue[],
): boolean {
	const src = expr.trim();
	if (!src || !ctx) return true;
	const r = evalExpression(src, ctx);
	if (r.ok && r.value.type === 'number') return r.value.value !== 0;
	issues.push({
		source: name,
		token: `available:${src}`,
		reason: r.ok ? 'available guard is not a condition' : r.error,
	});
	return true;
}

/** Gather the spend-options for the resources a character has (edition + source filtered). Pure. */
export function resolveResourceOptions({
	graph,
	resourceIds,
	system,
	isActive,
	issues,
	ctx,
}: ResourceOptionsInput): ResourceOption[] {
	const out: ResourceOption[] = [];
	for (const row of graph.rows) {
		if (row.type !== 'resource_option' || !row.systems.includes(system) || !isActive(row)) continue;
		const resourceId = String(row.data.resource_id);
		if (!resourceIds.has(resourceId)) continue;
		const raw = String(row.data.cost ?? '').trim();
		let cost: number | 'x';
		if (raw === 'x') cost = 'x';
		else if (/^\d+$/.test(raw)) cost = Number(raw);
		else {
			issues.push({
				source: row.data.name_en,
				token: `cost:${raw}`,
				reason: 'unsupported resource-option cost (v1 supports an integer or `x`)',
			});
			continue;
		}
		out.push({
			id: row.id,
			resourceId,
			name: row.data.name_en,
			description: String(row.data.text_en ?? ''),
			action: resolveActionFormula(String(row.data.action ?? ''), ctx, row.data.name_en, issues),
			actionType: (row.data.action_type as ResourceOption['actionType']) ?? 'action',
			cost,
			available: resolveAvailable(String(row.data.available ?? ''), ctx, row.data.name_en, issues),
		});
	}
	return out;
}

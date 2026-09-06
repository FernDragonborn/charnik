/*
 * Piece 3: the spend-options a character's granted resources offer (Ki → Flurry of Blows), read off
 * the `resource_option` linked table. Split out of `derive.ts`, which is the orchestrator.
 *
 * The L2 formulas inside an option's `action` are resolved at derive time, once, by the shared
 * `effects/action-token` resolver — the same treatment resource maxes get, and the same code the
 * `on_event` hook resolves its action with.
 */
import { ISSUE_KEY } from '$lib/effects/token-parser';
import { resolveActionFormula } from '$lib/effects/action-token';
import type { ContentGraph, LoadedRow } from '../content/loader';
import type { EffectIssue } from '../effects/token-parser';
import { evalExpression, type ExprContext } from '../effects/expression-evaluator';
import type { System } from '../rules/pipeline';
import { titleCase } from '../util/format';

/** Piece 3: a spend-option on a granted resource, resolved for a specific character. `cost` is a
 *  small integer or `'x'` (player-picked variable spend, 1..remaining); context-dependent costs
 *  (spell_level etc.) are deferred — an unsupported cost drops the option with a deriveIssue. */
export interface ResourceOption {
	id: string;
	resourceId: string;
	/** What the POOL this spends is called — carried on the option so a cost chip never has to
	 *  reformat the id itself, which is how three different spellings of one pool appeared (RES-NAME). */
	resourceName: string;
	name: string;
	description: string;
	/** Bounded action token(s) the UI runs / displays: apply_condition / heal / roll / apply_effect /
	 *  attack:<weapon id>[:<count>] / gain_action / rest:short|long / restore_resource:<id> / note. A
	 *  `;`-separated LIST is a multi-action (Uncanny Metabolism = regain focus AND heal) — run in order
	 *  on one activation. */
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
	/** Pool id → its authored name, resolved once by the derive so an option's chip and the pool's
	 *  own tracker cannot call the same pool different things (RES-NAME). */
	poolNames: Map<string, string>;
	system: System;
	isActive: (row: LoadedRow) => boolean;
	issues: EffectIssue[];
	/** The L2 context (base), so a `heal:`/`roll:` action's formula resolves to concrete dice HERE
	 *  (once, like resource maxes) instead of at spend time; absent when auto-calc is off (manual). */
	ctx: ExprContext | undefined;
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
		key: ISSUE_KEY.unreadableOptionCondition,
		detail: r.ok ? `"${src}" is not a yes/no condition` : r.error,
	});
	return true;
}

/** Gather the spend-options for the resources a character has (edition + source filtered). Pure. */
export function resolveResourceOptions({
	graph,
	resourceIds,
	poolNames,
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
				key: ISSUE_KEY.unreadableOptionCost,
				detail: `cost: "${raw}"`,
			});
			continue;
		}
		out.push({
			id: row.id,
			resourceId,
			resourceName: poolNames.get(resourceId) ?? titleCase(resourceId),
			name: row.data.name_en,
			description: String(row.data.text_en ?? ''),
			action: resolveActionFormula(String(row.data.action ?? ''), ctx, row.data.name_en, issues),
			actionType: row.data.action_type ?? 'action',
			cost,
			available: resolveAvailable(String(row.data.available ?? ''), ctx, row.data.name_en, issues),
		});
	}
	return out;
}

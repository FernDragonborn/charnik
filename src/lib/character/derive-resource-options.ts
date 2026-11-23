/*
 * Piece 3: the spend-options a character's granted resources offer (Ki → Flurry of Blows), read off
 * the `resource_option` linked table. Split out of `derive.ts`, which is the orchestrator.
 *
 * The L2 formulas inside an option's `action` are resolved at derive time, once, by the shared
 * `effects/action-token` resolver — the same treatment resource maxes get, and the same code the
 * `on_event` hook resolves its action with.
 */
import { ISSUE_KEY } from '#lib/effects/token-parser.ts';
import { resolveActionFormula } from '#lib/effects/action-token.ts';
import type { ContentGraph, LoadedRow, LoadedRowOf } from '../content/loader';
import type { EffectIssue } from '../effects/token-parser';
import { evalExpression, type ExprContext } from '../effects/expression-evaluator';
import type { System } from '../rules/pipeline';
import { titleCase } from '../util/format';
import { characterFeatures } from './features';
import { OPTION_CADENCE } from '../content/schemas';
import type { Character } from './schema';

/** Piece 3: a spend-option on a granted resource, resolved for a specific character. `cost` is a
 *  small integer — 0 for an option its pool does not pay for — or `'x'` (player-picked variable
 *  spend, 1..remaining); context-dependent costs
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
	 *  attack:<weapon id>[:<count>] / gain_action / rest:short|long / restore_resource:<id> /
	 *  spend_resource:<id>[:<n>] / spend_slot / gain_slot:<level> / note. A
	 *  `;`-separated LIST is a multi-action (Uncanny Metabolism = regain focus AND heal) — run in order
	 *  on one activation. */
	action: string;
	actionType: 'action' | 'bonus_action' | 'reaction' | 'free';
	cost: number | 'x';
	/** Whether the option's `available` L2 guard passes right now (no guard → always true). A false
	 *  guard greys the option out — e.g. Persistent Rage is offerable only at combat start. */
	available: boolean;
	cadence?: typeof OPTION_CADENCE.turn;
	/** The feature that gives this option on a pool it does not own (`granted_by`); absent for an
	 *  option that comes with the pool itself. */
	grantedBy?: string;
}

interface ResourceOptionsInput {
	graph: ContentGraph;
	/** Whose options these are — an option's `granted_by` is asked of what this character HAS. */
	character: Character;
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

/** An option's cost as a number of uses, or `x` for the player to say; null when the cell says
 *  neither, and an issue says so. */
function optionCost(raw: string, name: string, issues: EffectIssue[]): number | 'x' | null {
	if (raw === 'x') return 'x';
	if (/^\d+$/.test(raw)) return Number(raw);
	issues.push({
		source: name,
		token: `cost:${raw}`,
		key: ISSUE_KEY.unreadableOptionCost,
		detail: `cost: "${raw}"`,
	});
	return null;
}

/** Is a `cadence: turn` option still open this turn: out of combat always, in combat until used. */
const openThisTurn = (character: Character, row: LoadedRowOf<'resource_option'>): boolean =>
	row.data.cadence !== OPTION_CADENCE.turn ||
	!character.play.inCombat ||
	!character.play.turn.usedRolls.includes(row.id);

const grantedByOf = (row: LoadedRowOf<'resource_option'>): string =>
	String(row.data.granted_by ?? '').trim();

/** Is this option the character's: on a pool they have, and — when another feature gives it on that
 *  pool — once they have that feature. Absent otherwise, never greyed: greyed is for a window that
 *  can open. */
function isTheirs(
	row: LoadedRowOf<'resource_option'>,
	resourceIds: ReadonlySet<string>,
	featureIds: ReadonlySet<string>,
): boolean {
	const resourceId = row.data.resource_id ?? '';
	const grantedBy = grantedByOf(row);
	return (!resourceId || resourceIds.has(resourceId)) && (!grantedBy || featureIds.has(grantedBy));
}

/** Gather the spend-options for the resources a character has (edition + source filtered). Pure. */
export function resolveResourceOptions({
	graph,
	character,
	resourceIds,
	poolNames,
	system,
	isActive,
	issues,
	ctx,
}: ResourceOptionsInput): ResourceOption[] {
	const out: ResourceOption[] = [];
	const featureIds = new Set(
		characterFeatures(character, graph)
			.filter((feature) => isActive(feature.row))
			.map((feature) => feature.row.id),
	);
	const offered = graph.rows.filter(
		(row): row is LoadedRowOf<'resource_option'> =>
			row.type === 'resource_option' &&
			row.systems.includes(system) &&
			isActive(row) &&
			isTheirs(row, resourceIds, featureIds),
	);
	for (const row of offered) {
		const resourceId = row.data.resource_id ?? '';
		const grantedBy = grantedByOf(row);
		const name = row.data.name_en;
		const cost = optionCost(String(row.data.cost ?? (resourceId ? '' : '0')).trim(), name, issues);
		if (cost === null) continue;
		out.push({
			id: row.id,
			resourceId,
			resourceName: poolNames.get(resourceId) ?? titleCase(resourceId),
			name,
			description: String(row.data.text_en ?? ''),
			action: resolveActionFormula(String(row.data.action ?? ''), ctx, name, issues),
			actionType: row.data.action_type ?? 'action',
			cost,
			available:
				openThisTurn(character, row) &&
				resolveAvailable(String(row.data.available ?? ''), ctx, name, issues),
			...(row.data.cadence ? { cadence: row.data.cadence } : {}),
			...(grantedBy ? { grantedBy } : {}),
		});
	}
	return out;
}

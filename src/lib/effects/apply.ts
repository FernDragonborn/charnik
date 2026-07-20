/*
 * L1 effect FOLD seam — turn resolved effects into typed facts, then into stat contributions.
 *
 * `collectFacts` parses the RESOLVED effect list ONCE per derive into the typed `EffectFacts`
 * object (AUDIT D7); `applyEffects` is the single seam that folds the matching facts onto a
 * core `Computed` (numeric → contribution, the rest → notes), preserving the on/off invariant.
 * Every consumer (stat folds, roll path, action economy, panels) reads `EffectFacts`, never a
 * re-scan of raw tokens. The one resolve stage that produces the effect list lives in
 * dependency-graph.ts (`resolveActiveEffects`, in dependency order).
 */
import { computed, type Computed, type Contribution, type Layer } from '../rules/pipeline';
import { titleCase } from '../util/format';
import { evalExpression, lintExpression } from './expression-evaluator';
import {
	parseToken,
	resolveEffectValue,
	splitGuard,
	ctxOf,
	EFFECT_KIND,
	MAX_RESOURCE_MAX,
	type ActiveEffect,
	type EffectCtx,
	type EffectIssue,
	type Defense
} from './token-parser';

/** Does an effect target apply to this stat key? Exact, plus the group targets that fan out:
 *  `saves`→`save.*`, `skills`→`skill.*`, and `d20_tests`→every d20-based roll (saves, ability
 *  checks/skills, attack, initiative) — the 2024 exhaustion penalty rides this one group. */
export function matchesTarget(effTarget: string | undefined, key: string): boolean {
	if (!effTarget) return false;
	if (effTarget === key) return true;
	if (effTarget === 'saves' && key.startsWith('save')) return true;
	if (effTarget === 'skills' && key.startsWith('skill')) return true;
	if (
		effTarget === 'd20_tests' &&
		(key.startsWith('save') || key.startsWith('skill') || key === 'attack' || key === 'initiative')
	)
		return true;
	return false;
}

/** Result of the derive's target check (B13): whether a consumer reads this (kind, target), plus an
 *  optional "did you mean X?" suffix (PLG-9) when it's unsupported but near a known key. */
export interface TargetCheck {
	supported: boolean;
	/** Ready-to-append suffix like ` — did you mean "ac"?`, or absent. */
	suggestion?: string;
}

/** Predicate the derive supplies (B13): does a consumer actually read this (kind, target) pair?
 *  Only CLOSED-vocab targets are checked (stat/roll/proficiency keys); open-vocab kinds
 *  (resist_immune types, grant_resource / apply_condition ids) are validated elsewhere or unbounded,
 *  so the validator returns `supported: true` for them. `kind` is an `EFFECT_KIND` value. */
export type TargetValidator = (kind: string, target: string) => TargetCheck;

/** A roll-manipulation fact for the roll path: `{target, value}` where value is the reroll
 *  threshold (`reroll`) or the die floor (`min_die`). */
export interface RollMod {
	target: string;
	value: number;
}

/** A resolved numeric token (`flat_bonus`/`set_override`) — its L2 expression already evaluated
 *  against the derive ctx, so every consumer folds a NUMBER (or rides a dice formula), never
 *  re-parses/re-evaluates. Exactly one of `amount`/`diceFormula`/`error` is set. */
export interface NumericFact {
	target: string;
	/** `mult` never comes from content tokens — only plugin `contributions` emit it (PLUGINS.md §4.3). */
	op: 'add' | 'set' | 'mult';
	layer: Layer;
	source: string;
	/** The guard-stripped token, for provenance notes. */
	token: string;
	amount?: number;
	/** A dice quantity (`1d4`, `-2d6`) — rides the roll path; folds as a note on stats. */
	diceFormula?: string;
	/** The value failed to resolve — the token degrades to a note (the inert-fallback contract). */
	error?: string;
}
/** A non-numeric fact tied to a target key (`advantage:attack` → {target:'attack', source}). */
export interface FactRef {
	target: string;
	source: string;
}
export interface ProficiencyFact {
	target: string;
	level: 'proficient' | 'expertise';
	source: string;
}
export interface DefenseFact {
	bucket: Defense;
	type: string;
	source: string;
}

/**
 * The ONE typed-facts object (AUDIT D7): every token of the resolved effect list, parsed once and
 * value-resolved once per derive. Every downstream consumer — stat folds (`applyEffects`), the
 * roll path (`rollEffectsFor`), proficiency/defense/resource scans, the action economy — reads
 * THIS, never its own re-scan of raw tokens.
 */
export interface EffectFacts {
	numeric: NumericFact[];
	advantage: FactRef[];
	disadvantage: FactRef[];
	/** Rolls whose OUTCOME is forced (paralyzed → auto-fail STR/DEX saves): the target roll fails
	 *  (`autoFail`) or succeeds (`autoSucceed`) regardless of the die. Consumed as a save note + the
	 *  roll-outcome check (combat), NOT as a die modifier — so it never mixes with advantage math. */
	autoFail: FactRef[];
	autoSucceed: FactRef[];
	proficiencies: ProficiencyFact[];
	defenses: DefenseFact[];
	/** Fully-specified resource pools (id:max:recharge), expression maxes resolved. */
	resources: ResourceDef[];
	/** Every granted resource id, incl. bare `grant_resource:<id>` flags (deduped). */
	resourceIds: string[];
	/** Applied condition ids (deduped). */
	conditions: string[];
	rerolls: RollMod[];
	minDie: RollMod[];
	unknown: { source: string; token: string }[];
	/** Plain-text notes returned by plugin handlers (PLUGINS.md §4.3) — panel display only,
	 *  rendered as TEXT (PLG-SEC 3). Filled by the plugin pre-pass, empty otherwise. */
	pluginNotes: { source: string; text: string }[];
}

const emptyFacts = (): EffectFacts => ({
	numeric: [],
	advantage: [],
	disadvantage: [],
	autoFail: [],
	autoSucceed: [],
	proficiencies: [],
	defenses: [],
	resources: [],
	resourceIds: [],
	conditions: [],
	rerolls: [],
	minDie: [],
	unknown: [],
	pluginNotes: []
});

/**
 * One pass over the RESOLVED effect list → the typed-facts object (D7). Numeric values (incl. L2
 * expressions) are resolved HERE, once — resolution failures become `error` facts + `issues`
 * entries (SPEC10), never silent drops. Resource pools follow the largest-max-wins rule; condition
 * and resource ids are deduped (the same condition arriving twice applies once — AUDIT A11).
 */
export function collectFacts(
	effects: ActiveEffect[],
	ctx?: EffectCtx,
	issues?: EffectIssue[],
	isTargetSupported?: TargetValidator
): EffectFacts {
	const facts = emptyFacts();
	const pools = new Map<string, ResourceDef>();
	const resourceIds = new Set<string>();
	const conditions = new Set<string>();
	// B13 exhaustiveness: a KNOWN kind whose target no consumer reads would fold onto nothing and
	// vanish silently (`flat_bonus:armorclass+1`). The derive that owns the consumers passes a
	// validator over the CLOSED-vocab targets; an unsupported one is kept inert AND surfaced as an
	// issue (content-health) instead of dropped. Returns true = the token was rejected + reported.
	const rejectTarget = (kind: string, target: string, source: string, token: string): boolean => {
		if (!isTargetSupported) return false;
		const check = isTargetSupported(kind, target);
		if (check.supported) return false;
		issues?.push({
			source,
			token,
			reason: `unknown target "${target}" for ${kind}${check.suggestion ?? ''}`
		});
		return true;
	};
	for (const eff of effects) {
		for (const token of eff.tokens) {
			const p = parseToken(token);
			switch (p.kind) {
				case EFFECT_KIND.flatBonus:
				case EFFECT_KIND.setOverride: {
					if (!p.target) break;
					if (rejectTarget(p.kind, p.target, eff.source, token)) break;
					const op = p.kind === EFFECT_KIND.setOverride ? 'set' : 'add';
					const v = resolveEffectValue(p, ctxOf(ctx, eff));
					const fact: NumericFact = {
						target: p.target,
						op,
						layer: eff.layer,
						source: eff.source,
						token
					};
					if (v.amount !== undefined) fact.amount = v.amount;
					else if (v.diceFormula && op === 'add') fact.diceFormula = v.diceFormula;
					else if (v.diceFormula) fact.error = 'an override cannot be a dice value';
					else fact.error = v.error ?? 'no value';
					facts.numeric.push(fact);
					break;
				}
				case EFFECT_KIND.advantage:
					if (p.target && !rejectTarget(p.kind, p.target, eff.source, token))
						facts.advantage.push({ target: p.target, source: eff.source });
					break;
				case EFFECT_KIND.disadvantage:
					if (p.target && !rejectTarget(p.kind, p.target, eff.source, token))
						facts.disadvantage.push({ target: p.target, source: eff.source });
					break;
				case EFFECT_KIND.autoFail:
					if (p.target && !rejectTarget(p.kind, p.target, eff.source, token))
						facts.autoFail.push({ target: p.target, source: eff.source });
					break;
				case EFFECT_KIND.autoSucceed:
					if (p.target && !rejectTarget(p.kind, p.target, eff.source, token))
						facts.autoSucceed.push({ target: p.target, source: eff.source });
					break;
				case EFFECT_KIND.grantProficiency:
					if (p.target && !rejectTarget(p.kind, p.target.trim(), eff.source, token))
						facts.proficiencies.push({
							target: p.target.trim(),
							level: p.proficiency ?? 'proficient',
							source: eff.source
						});
					break;
				case EFFECT_KIND.resistImmune:
					if (p.target)
						facts.defenses.push({
							bucket: p.defense ?? 'resist',
							type: p.target.trim(),
							source: eff.source
						});
					break;
				case EFFECT_KIND.applyCondition:
					if (p.target) conditions.add(p.target.trim());
					break;
				case EFFECT_KIND.grantResource: {
					if (!p.target) break;
					resourceIds.add(p.target);
					if (!p.resource) break;
					// max is either a literal or an L2 expression (`class_level.monk`); an unresolvable
					// expression means the pool count is unknown → skip the pool (a 0-pip render would be
					// noise) but SURFACE the failure (never silently).
					let maxVal: number | undefined;
					if (p.resource.max !== undefined) maxVal = p.resource.max;
					else if (p.resource.maxExpr) {
						const c = ctxOf(ctx, eff);
						const r = c
							? evalExpression(p.resource.maxExpr, c)
							: ({ ok: false, error: 'expression needs a context' } as const);
						if (r.ok && r.value.type === 'number') maxVal = Math.floor(r.value.value);
						else
							issues?.push({
								source: eff.source,
								token,
								reason: r.ok ? 'resource max is not a number' : r.error
							});
					}
					if (maxVal === undefined) break;
					const def: ResourceDef = {
						id: p.resource.id,
						max: Math.max(0, Math.min(maxVal, MAX_RESOURCE_MAX)),
						recharge: p.resource.recharge,
						name: titleCase(p.resource.id),
						source: eff.source
					};
					const prev = pools.get(def.id);
					// a scaling feature re-granted at a higher tier: the largest max wins
					if (!prev || def.max > prev.max) pools.set(def.id, def);
					break;
				}
				case EFFECT_KIND.reroll:
					if (
						p.target &&
						p.amount !== undefined &&
						!rejectTarget(p.kind, p.target, eff.source, token)
					)
						facts.rerolls.push({ target: p.target, value: p.amount });
					break;
				case EFFECT_KIND.minDie:
					if (
						p.target &&
						p.amount !== undefined &&
						!rejectTarget(p.kind, p.target, eff.source, token)
					)
						facts.minDie.push({ target: p.target, value: p.amount });
					break;
				case EFFECT_KIND.plugin:
					// resolved by the derive PRE-PASS (`expandPluginEffects`), not here — the pre-pass
					// reports every plugin token itself (result, or degraded inert note), so counting it
					// as unknown too would double the panel entry.
					break;
				case 'unknown':
					facts.unknown.push({ source: eff.source, token });
					break;
			}
		}
	}
	facts.resources = [...pools.values()];
	facts.resourceIds = [...resourceIds];
	facts.conditions = [...conditions];
	return facts;
}

/**
 * Merge a SECOND `collectFacts` result into `base` (in place) — the plugin pre-pass path: returned
 * tokens become synthetic effects, collected separately, then merged. Arrays concatenate;
 * condition/resource ids dedupe; resource pools keep the largest max per id (the same rule
 * `collectFacts` itself applies within one pass).
 */
export function mergeFacts(base: EffectFacts, extra: EffectFacts): void {
	base.numeric.push(...extra.numeric);
	base.advantage.push(...extra.advantage);
	base.disadvantage.push(...extra.disadvantage);
	base.autoFail.push(...extra.autoFail);
	base.autoSucceed.push(...extra.autoSucceed);
	base.proficiencies.push(...extra.proficiencies);
	base.defenses.push(...extra.defenses);
	base.rerolls.push(...extra.rerolls);
	base.minDie.push(...extra.minDie);
	base.unknown.push(...extra.unknown);
	base.pluginNotes.push(...extra.pluginNotes);
	base.conditions = [...new Set([...base.conditions, ...extra.conditions])];
	base.resourceIds = [...new Set([...base.resourceIds, ...extra.resourceIds])];
	for (const def of extra.resources) {
		const prev = base.resources.find((r) => r.id === def.id);
		if (!prev) base.resources.push(def);
		else if (def.max > prev.max) base.resources[base.resources.indexOf(prev)] = def;
	}
}

/**
 * The seam: compose effects onto a core-computed stat for `targetKey`. Returns a new
 * `Computed` with the matching numeric contributions folded in and non-numeric effects as
 * notes. With no effects, the value/trace are unchanged (the on/off invariant).
 *
 * Preferred input is the derive's ONE `EffectFacts` (built once via `collectFacts` — D7); a raw
 * `ActiveEffect[]` is also accepted (tests / one-off folds) and converted on the spot.
 */
export function applyEffects(
	targetKey: string,
	base: Computed,
	effects: ActiveEffect[] | EffectFacts,
	ctx?: EffectCtx
): Computed {
	const facts = Array.isArray(effects) ? collectFacts(effects, ctx) : effects;
	const contribs: Contribution[] = [...base.trace];
	const notes: string[] = [...(base.notes ?? [])];
	for (const f of facts.numeric) {
		if (!matchesTarget(f.target, targetKey)) continue;
		if (f.amount !== undefined) {
			contribs.push({
				source: f.source,
				layer: f.op === 'set' ? 'override' : f.layer,
				op: f.op,
				amount: f.amount,
				note: f.token
			});
		} else if (f.diceFormula) {
			const d = f.diceFormula;
			notes.push(`${f.source}: ${d.startsWith('-') ? '' : '+'}${d} to ${targetKey}`);
		} else if (f.error) {
			notes.push(`${f.source}: unresolved "${f.token}" (${f.error})`);
		}
	}
	for (const a of facts.advantage)
		if (matchesTarget(a.target, targetKey)) notes.push(`${a.source}: advantage on ${targetKey}`);
	for (const d of facts.disadvantage)
		if (matchesTarget(d.target, targetKey)) notes.push(`${d.source}: disadvantage on ${targetKey}`);
	for (const a of facts.autoFail)
		if (matchesTarget(a.target, targetKey)) notes.push(`${a.source}: auto-fail on ${targetKey}`);
	for (const a of facts.autoSucceed)
		if (matchesTarget(a.target, targetKey)) notes.push(`${a.source}: auto-succeed on ${targetKey}`);
	return computed(contribs, undefined, notes.length ? notes : undefined);
}

/** A trackable resource pool a feature/effect grants (rage, ki, sorcery points, an item's N/day…). */
export interface ResourceDef {
	id: string;
	name: string; // display label (title-cased from id)
	max: number;
	recharge: 'short' | 'long' | 'other';
	source: string; // the granting effect/feature
}

/** Authoring-slip warnings for one row's effect tokens (content-health): lints every L2 expression
 *  slot — guard, value, resource max — for the spec-promised soft warns (mixed-type `if()`,
 *  unusual die). Parse ERRORS are not reported here; they surface at derive as issues/inert notes. */
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
		for (const e of exprs) for (const w of lintExpression(e)) warns.push(`${raw} — ${w}`);
	}
	return warns;
}

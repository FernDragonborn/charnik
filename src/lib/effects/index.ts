/*
 * The effects / modifier engine — an ISOLATED, optional, removable module.
 *
 * It interprets the BOUNDED effect vocabulary (data, never `eval`/a DSL — a security
 * property, see docs/SECURITY.md) and composes item/feature/condition/override
 * contributions onto a core `Computed` through the single seam `applyEffects`. The rules
 * core has NO dependency on this file; deleting `src/lib/effects/` leaves the core's
 * `{value, trace, notes}` contract intact (values just lose their effect layers). This
 * module may import core TYPES (`pipeline`), never the reverse.
 *
 * Numeric tokens (`flat_bonus`, `set_override`) fold into the value; the rest
 * (`advantage`, `resist_immune`, `apply_condition`, `grant_resource`, `grant_proficiency`)
 * are non-numeric and surface as structured facts / notes. Anything unparseable is kept as
 * an inert text note — never dropped, never executed.
 */
import { computed, type Computed, type Contribution, type Layer } from '../rules/pipeline';
import { evalExpression, diceToFormula, lintExpression, type ExprContext } from './expr';

/** The bounded effect vocabulary, as named constants — compare against these, never bare strings. */
export const EFFECT_KIND = {
	flatBonus: 'flat_bonus',
	setOverride: 'set_override',
	advantage: 'advantage',
	disadvantage: 'disadvantage',
	grantProficiency: 'grant_proficiency',
	resistImmune: 'resist_immune',
	applyCondition: 'apply_condition',
	grantResource: 'grant_resource',
	// L1 roll-manipulation (the bounded, known set — NOT L3): the roll path consumes these facts.
	reroll: 'reroll', // `reroll:<target>:<threshold>` — reroll a die that lands ≤ threshold (GWF ≤2)
	minDie: 'min_die' // `min_die:<target>:<floor>` — treat a die result below floor AS floor (Reliable Talent d20→10)
} as const;
export type EffectKind = (typeof EFFECT_KIND)[keyof typeof EFFECT_KIND];
/** The kinds as a list (for schema validation / the `includes` guard). */
export const EFFECT_KINDS = Object.values(EFFECT_KIND) as readonly EffectKind[];

export type Recharge = 'short' | 'long' | 'other';
type Defense = 'resist' | 'immune' | 'vulnerable';

/** Numeric caps on token values (cost, not game balance — content is untrusted input). Two classes:
 *  a bonus/override is only STORED and rendered as a scalar → a generous finite guard is enough (a
 *  +1e6 AC is silly, not dangerous); a resource `max` DRIVES the pip render loop (see AUDIT B10) →
 *  bound the WORK. Values past a cap are clamped, not dropped, so a typo still parses. */
const MAX_EFFECT_AMOUNT = 1_000_000;
export const MAX_RESOURCE_MAX = 1000;
const clampAmount = (n: number) =>
	Number.isFinite(n) ? Math.max(-MAX_EFFECT_AMOUNT, Math.min(MAX_EFFECT_AMOUNT, n)) : 0;

export interface ParsedEffect {
	kind: EffectKind | 'unknown';
	target?: string;
	/** Numeric flat bonus / override value (present when the value slot is a plain literal). */
	amount?: number;
	/** Dice bonus (e.g. "1d4" / "-1d4") — a roll modifier, not a flat number. */
	dice?: string;
	/** L2 value expression (`ceil(level/2)`, `class_level.monk`) when the value slot is NOT a plain
	 *  literal — resolved against a ctx at derive time by `resolveEffectValue`, not here. Present on
	 *  `flat_bonus` / `set_override` (the stat value) and mirrored by `resource.max` below. */
	valueExpr?: string;
	/** resist_immune: which bucket (defaults to 'resist' when the token omits it). */
	defense?: Defense;
	/** grant_proficiency: the LEVEL granted — one ladder value, not two booleans, so "expertise
	 *  without proficiency" is unrepresentable (expertise sits above proficient on the ladder). */
	proficiency?: 'proficient' | 'expertise';
	/** grant_resource: the fully-specified pool (only present when `id:max:recharge` is given). `max`
	 *  is a literal count; `maxExpr` is an L2 expression for it (`class_level.monk`) resolved at
	 *  derive time — exactly one of the two is set. */
	resource?: { id: string; max?: number; maxExpr?: string; recharge: Recharge };
	raw: string;
}

/** Parse results memoized by token string — consumers scan tokens per stat per derive (AUDIT D7
 *  perf), and a `ParsedEffect` is read-only by contract. Bounded like the expr parse cache. */
const EFFECT_CACHE = new Map<string, ParsedEffect>();
const EFFECT_CACHE_MAX = 4000;

/**
 * Parse one bounded-vocab token — the SINGLE interpreter of the effect grammar (a security
 * boundary: data, never code). Every consumer reads the structured result instead of its own
 * regex. Unknown / malformed → `{kind:'unknown'}` (kept as an inert text note, never dropped).
 * Memoized; treat the result as immutable.
 */
export function parseEffect(token: string): ParsedEffect {
	const hit = EFFECT_CACHE.get(token);
	if (hit) return hit;
	const res = parseEffectUncached(token);
	if (EFFECT_CACHE.size >= EFFECT_CACHE_MAX) EFFECT_CACHE.clear();
	EFFECT_CACHE.set(token, res);
	return res;
}

function parseEffectUncached(token: string): ParsedEffect {
	const raw = token.trim();
	const sep = raw.indexOf(':');
	if (sep === -1) return { kind: 'unknown', raw };
	const kind = raw.slice(0, sep) as EffectKind;
	const rest = raw.slice(sep + 1);
	if (!EFFECT_KINDS.includes(kind)) return { kind: 'unknown', raw };

	if (kind === EFFECT_KIND.flatBonus) {
		// literal fast path — ONE target grammar with the expression path below (snake, single
		// optional dot; `-` is the L2 minus operator, E3): a literal amount/dice never needs a ctx
		const lit = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?)\s*([+-])\s*(\d+d\d+|\d+)$/i.exec(rest);
		if (lit) {
			const target = lit[1] ?? '';
			const sign = lit[2] ?? '';
			const amount = lit[3] ?? '';
			if (/d/i.test(amount)) return { kind, target, dice: (sign === '-' ? '-' : '') + amount, raw };
			return { kind, target, amount: clampAmount(Number(sign + amount)), raw };
		}
		// L2 expression value: `<target><+|->` then an expression. A `-` sign negates the whole value.
		const ex = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?)\s*([+-])\s*(.+)$/i.exec(rest);
		if (!ex) return { kind: 'unknown', raw };
		const valueExpr = ex[2] === '-' ? `-(${(ex[3] ?? '').trim()})` : (ex[3] ?? '').trim();
		return { kind, target: ex[1] ?? '', valueExpr, raw };
	}
	if (kind === EFFECT_KIND.setOverride) {
		const lit = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?):(-?\d+)$/i.exec(rest);
		if (lit) return { kind, target: lit[1] ?? '', amount: clampAmount(Number(lit[2])), raw };
		const ex = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?):(.+)$/i.exec(rest);
		if (!ex) return { kind: 'unknown', raw };
		return { kind, target: ex[1] ?? '', valueExpr: (ex[2] ?? '').trim(), raw };
	}
	if (kind === EFFECT_KIND.resistImmune) {
		// `resist_immune:<type>` (defaults to resistance) or `resist_immune:<bucket>:<type>`
		const m = /^(?:(resist|immune|vulnerable):)?(.+)$/i.exec(rest);
		if (!m?.[2]) return { kind: 'unknown', raw };
		const defense = (m[1]?.toLowerCase() ?? 'resist') as Defense;
		return { kind, defense, target: m[2].trim(), raw };
	}
	if (kind === EFFECT_KIND.grantResource) {
		// `grant_resource:<id>` (bare flag) or `grant_resource:<id>:<max>:<recharge>` where <max> is a
		// literal OR an L2 expression (`class_level.monk`). The recharge keyword anchors the end, so
		// the middle (max) can hold expression characters (`*`, `(`, `,`) unambiguously.
		// Id is snake-only (E3): a kebab pool id would be unreadable from `resource.<id>` expressions.
		const m = /^([a-z0-9][a-z0-9_]*)(?::(.+):(short|long|other))?$/i.exec(rest.trim());
		if (!m?.[1]) return { kind: 'unknown', raw };
		const id = m[1].toLowerCase();
		const maxSlot = m[2]?.trim();
		const recharge = m[3]?.toLowerCase() as Recharge | undefined;
		if (maxSlot && recharge) {
			const resource = /^\d+$/.test(maxSlot)
				? { id, max: Math.min(Number(maxSlot), MAX_RESOURCE_MAX), recharge }
				: { id, maxExpr: maxSlot, recharge };
			return { kind, target: id, resource, raw };
		}
		return { kind, target: id, raw };
	}
	if (kind === EFFECT_KIND.grantProficiency) {
		// `grant_proficiency:[expertise:]<target>` — the target is canonicalized here (the ONE place):
		// a `skill.` prefix strips to the bare skill id (skills are bare in this vocab; only saves
		// carry their `save.` prefix), so authors can write either form without it silently dropping.
		const m = /^(expertise:)?(?:skill\.)?(.+)$/i.exec(rest);
		if (!m?.[2]) return { kind: 'unknown', raw };
		return { kind, target: m[2].trim(), proficiency: m[1] ? 'expertise' : 'proficient', raw };
	}
	if (kind === EFFECT_KIND.reroll || kind === EFFECT_KIND.minDie) {
		// `reroll:<target>:<threshold>` / `min_die:<target>:<floor>` — a target plus one integer the
		// roll path reads. Target may be a group (`d20_tests`) or a specific key (`skill.stealth`).
		const m = /^(.+):(\d+)$/.exec(rest);
		if (!m?.[1]) return { kind: 'unknown', raw };
		return { kind, target: m[1].trim(), amount: Number(m[2]), raw };
	}
	// advantage / disadvantage / apply_condition
	return { kind, target: rest, raw };
}

/** A resolved value for a `flat_bonus`/`set_override`/`grant_resource` token: a folded numeric
 *  `amount`, a `diceFormula` (rides the roll path, shown as a note), or an `error` (the L2
 *  expression failed → the token degrades to an inert note; EXPR-3 also routes it to content-health). */
export interface ResolvedValue {
	amount?: number;
	diceFormula?: string;
	error?: string;
}

/**
 * Resolve a token's value slot to a concrete quantity. A plain literal (`amount`/`dice`) passes
 * straight through; an L2 `valueExpr` is evaluated against `ctx` (SPEC2: effective vars) — a numeric
 * result is FLOORED (5e round-down) and cost-clamped, a dice result becomes a roller formula, a
 * failure returns `{error}`. Without a ctx an expression can't resolve (→ error), so the caller
 * degrades it; literals never need a ctx (core-off / no-effects path stays ctx-free).
 */
export function resolveEffectValue(p: ParsedEffect, ctx?: ExprContext): ResolvedValue {
	if (p.amount !== undefined) return { amount: p.amount };
	if (p.dice) return { diceFormula: p.dice };
	if (!p.valueExpr) return {};
	if (!ctx) return { error: 'expression needs a context' };
	const r = evalExpression(p.valueExpr, ctx);
	if (!r.ok) return { error: r.error };
	// `+ 0` normalizes a `-0` (from e.g. `-2*exhaustion` at exhaustion 0) to `0`.
	if (r.value.type === 'number') return { amount: clampAmount(Math.floor(r.value.value) + 0) };
	return { diceFormula: diceToFormula(r.value.dice) };
}

/** A runtime effect source contributing tokens at a pipeline layer. `classId` marks tokens carried
 *  by a specific class's row/feature — SPEC4: their `spellcasting_mod` reads THAT class's mod. */
export interface ActiveEffect {
	source: string;
	layer: Layer;
	tokens: string[];
	classId?: string;
}

/** A ctx, or a per-effect ctx provider (used to scope `spellcasting_mod` to the carrying class). */
export type EffectCtx = ExprContext | ((eff: ActiveEffect) => ExprContext);
export const ctxOf = (ctx: EffectCtx | undefined, eff: ActiveEffect): ExprContext | undefined =>
	typeof ctx === 'function' ? ctx(eff) : ctx;

/** A token split into its optional condition GUARD and the effect part. The L2 guard is
 *  condition-FIRST (`is_raging ? advantage:attack`); `?` never appears elsewhere in the GRAMMAR
 *  (expressions use `if()`, not `?:`, and `:` is structural), so splitting on the first `?` is
 *  unambiguous. Free-text/unknown tokens MAY contain a `?` — their "guard" then fails to evaluate
 *  and the resolve stage keeps them verbatim as inert notes (never dropped). */
export interface GuardedToken {
	guard?: string;
	token: string;
}
export function splitGuard(raw: string): GuardedToken {
	const q = raw.indexOf('?');
	if (q === -1) return { token: raw.trim() };
	return { guard: raw.slice(0, q).trim(), token: raw.slice(q + 1).trim() };
}

/** A derive-time problem with one token — the SPEC10 shape ({token, reason} + the carrying source)
 *  content-health merges with loader issues. */
export interface EffectIssue {
	source: string;
	token: string;
	reason: string;
}

// NOTE: the ONE resolve stage (gather → guards → condition expansion → the guard-stripped list
// every consumer reads) lives in `./dag` (`resolveActiveEffects`) — it resolves effects in
// DEPENDENCY order (writers → readers) and owns the ability-score pipeline (A10).

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
	op: 'add' | 'set';
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
}

const emptyFacts = (): EffectFacts => ({
	numeric: [],
	advantage: [],
	disadvantage: [],
	proficiencies: [],
	defenses: [],
	resources: [],
	resourceIds: [],
	conditions: [],
	rerolls: [],
	minDie: [],
	unknown: []
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
	issues?: EffectIssue[]
): EffectFacts {
	const facts = emptyFacts();
	const pools = new Map<string, ResourceDef>();
	const resourceIds = new Set<string>();
	const conditions = new Set<string>();
	for (const eff of effects) {
		for (const token of eff.tokens) {
			const p = parseEffect(token);
			switch (p.kind) {
				case EFFECT_KIND.flatBonus:
				case EFFECT_KIND.setOverride: {
					if (!p.target) break;
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
					if (p.target) facts.advantage.push({ target: p.target, source: eff.source });
					break;
				case EFFECT_KIND.disadvantage:
					if (p.target) facts.disadvantage.push({ target: p.target, source: eff.source });
					break;
				case EFFECT_KIND.grantProficiency:
					if (p.target)
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
						name: titleCaseId(p.resource.id),
						source: eff.source
					};
					const prev = pools.get(def.id);
					// a scaling feature re-granted at a higher tier: the largest max wins
					if (!prev || def.max > prev.max) pools.set(def.id, def);
					break;
				}
				case EFFECT_KIND.reroll:
					if (p.target && p.amount !== undefined)
						facts.rerolls.push({ target: p.target, value: p.amount });
					break;
				case EFFECT_KIND.minDie:
					if (p.target && p.amount !== undefined)
						facts.minDie.push({ target: p.target, value: p.amount });
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

const titleCaseId = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** Authoring-slip warnings for one row's effect tokens (content-health): lints every L2 expression
 *  slot — guard, value, resource max — for the spec-promised soft warns (mixed-type `if()`,
 *  unusual die). Parse ERRORS are not reported here; they surface at derive as issues/inert notes. */
export function lintEffectTokens(tokens: string[]): string[] {
	const warns: string[] = [];
	for (const raw of tokens) {
		const g = splitGuard(raw);
		const exprs: string[] = [];
		if (g.guard !== undefined) exprs.push(g.guard);
		const p = parseEffect(g.token);
		if (p.valueExpr) exprs.push(p.valueExpr);
		if (p.resource?.maxExpr) exprs.push(p.resource.maxExpr);
		for (const e of exprs) for (const w of lintExpression(e)) warns.push(`${raw} — ${w}`);
	}
	return warns;
}

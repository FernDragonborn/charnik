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
import { evalExpression, diceToFormula, type ExprContext } from './expr';

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
const MAX_RESOURCE_MAX = 1000;
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

/**
 * Parse one bounded-vocab token — the SINGLE interpreter of the effect grammar (a security
 * boundary: data, never code). Every consumer reads the structured result instead of its own
 * regex. Unknown / malformed → `{kind:'unknown'}` (kept as an inert text note, never dropped).
 */
export function parseEffect(token: string): ParsedEffect {
	const raw = token.trim();
	const sep = raw.indexOf(':');
	if (sep === -1) return { kind: 'unknown', raw };
	const kind = raw.slice(0, sep) as EffectKind;
	const rest = raw.slice(sep + 1);
	if (!EFFECT_KINDS.includes(kind)) return { kind: 'unknown', raw };

	if (kind === EFFECT_KIND.flatBonus) {
		// literal fast path (backward compatible, incl. the `-1d4` dice-note form and kebab targets)
		const lit = /^([a-z][a-z._-]*?)\s*([+-])\s*(\d+d\d+|\d+)$/i.exec(rest);
		if (lit) {
			const target = lit[1] ?? '';
			const sign = lit[2] ?? '';
			const amount = lit[3] ?? '';
			if (/d/i.test(amount)) return { kind, target, dice: (sign === '-' ? '-' : '') + amount, raw };
			return { kind, target, amount: clampAmount(Number(sign + amount)), raw };
		}
		// L2 expression value: `<target><+|->` then an expression. Target is snake (no `-`, which is
		// now the minus operator) so the split is unambiguous. A `-` sign negates the whole value.
		const ex = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?)\s*([+-])\s*(.+)$/i.exec(rest);
		if (!ex) return { kind: 'unknown', raw };
		const valueExpr = ex[2] === '-' ? `-(${(ex[3] ?? '').trim()})` : (ex[3] ?? '').trim();
		return { kind, target: ex[1] ?? '', valueExpr, raw };
	}
	if (kind === EFFECT_KIND.setOverride) {
		const lit = /^([a-z][a-z._-]*):(-?\d+)$/i.exec(rest);
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
		const m = /^([a-z0-9][a-z0-9_-]*)(?::(.+):(short|long|other))?$/i.exec(rest.trim());
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

/** A runtime effect source contributing tokens at a pipeline layer. */
export interface ActiveEffect {
	source: string;
	layer: Layer;
	tokens: string[];
}

/** A token split into its optional condition GUARD and the effect part. The L2 guard is
 *  condition-FIRST (`is_raging ? advantage:attack`); `?` never appears elsewhere (expressions use
 *  `if()`, not `?:`, and `:` is structural), so splitting on the first `?` is unambiguous. */
export interface GuardedToken {
	guard?: string;
	token: string;
}
export function splitGuard(raw: string): GuardedToken {
	const q = raw.indexOf('?');
	if (q === -1) return { token: raw.trim() };
	return { guard: raw.slice(0, q).trim(), token: raw.slice(q + 1).trim() };
}

/** The one resolve stage (EXPR-3; closes D7/B21): gather → evaluate guards (drop false/errored) →
 *  expand `apply_condition` one level (its own tokens are guard-checked too) → the surviving,
 *  guard-STRIPPED tokens every consumer reads. A guard that errors or isn't boolean drops its token
 *  and is recorded in `issues` (SPEC10 → content-health), never throwing. `expandCondition` is
 *  injected (the graph lives in the caller) so this stays free of content-loader deps. */
export interface ResolvedEffects {
	effects: ActiveEffect[];
	issues: string[];
}
export function resolveActiveEffects(
	active: ActiveEffect[],
	ctx: ExprContext,
	expandCondition: (condId: string) => { source: string; tokens: string[] } | undefined
): ResolvedEffects {
	const issues: string[] = [];
	/** Keep the tokens whose guard passes, stripped of the guard; a bad guard → issue + drop. */
	const passGuards = (source: string, tokens: string[]): string[] => {
		const kept: string[] = [];
		for (const raw of tokens) {
			const g = splitGuard(raw);
			if (g.guard !== undefined) {
				const r = evalExpression(g.guard, ctx);
				if (!r.ok) {
					issues.push(`${source}: bad guard "${g.guard}" (${r.error})`);
					continue;
				}
				if (r.value.type !== 'number') {
					issues.push(`${source}: guard "${g.guard}" is not a condition`);
					continue;
				}
				if (r.value.value === 0) continue; // condition false → token doesn't apply
			}
			kept.push(g.token);
		}
		return kept;
	};

	const out: ActiveEffect[] = [];
	for (const eff of active) {
		const kept = passGuards(eff.source, eff.tokens);
		if (kept.length) out.push({ source: eff.source, layer: eff.layer, tokens: kept });
	}
	// expand apply_condition AFTER guards (SPEC7 order); one level, no recursive cascade
	for (const eff of [...out]) {
		for (const token of eff.tokens) {
			const p = parseEffect(token);
			if (p.kind !== EFFECT_KIND.applyCondition || !p.target) continue;
			const c = expandCondition(p.target.trim());
			if (!c) continue;
			const kept = passGuards(`${eff.source} → ${c.source}`, c.tokens);
			if (kept.length)
				out.push({ source: `${eff.source} → ${c.source}`, layer: 'condition', tokens: kept });
		}
	}
	return { effects: out, issues };
}

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
export interface EffectFlags {
	advantage: string[];
	disadvantage: string[];
	conditions: string[];
	resources: string[];
	proficiencies: string[];
	resistImmune: string[];
	/** `reroll:<target>:<threshold>` facts — the roll path rerolls a die that lands ≤ threshold. */
	rerolls: RollMod[];
	/** `min_die:<target>:<floor>` facts — the roll path treats a die below floor AS floor. */
	minDie: RollMod[];
	unknown: string[];
}

/**
 * The seam: compose effects onto a core-computed stat for `targetKey`. Returns a new
 * `Computed` with the matching numeric contributions folded in and non-numeric effects as
 * notes. With no effects, the value/trace are unchanged (the on/off invariant).
 */
export function applyEffects(
	targetKey: string,
	base: Computed,
	effects: ActiveEffect[],
	ctx?: ExprContext
): Computed {
	const contribs: Contribution[] = [...base.trace];
	const notes: string[] = [...(base.notes ?? [])];
	for (const eff of effects) {
		for (const token of eff.tokens) {
			const p = parseEffect(token);
			if (!matchesTarget(p.target, targetKey)) continue;
			if (p.kind === EFFECT_KIND.flatBonus) {
				const v = resolveEffectValue(p, ctx);
				if (v.amount !== undefined) {
					contribs.push({
						source: eff.source,
						layer: eff.layer,
						op: 'add',
						amount: v.amount,
						note: token
					});
				} else if (v.diceFormula) {
					const f = v.diceFormula;
					notes.push(`${eff.source}: ${f.startsWith('-') ? '' : '+'}${f} to ${targetKey}`);
				} else if (v.error) {
					notes.push(`${eff.source}: unresolved "${token}" (${v.error})`);
				}
			} else if (p.kind === EFFECT_KIND.setOverride) {
				const v = resolveEffectValue(p, ctx);
				if (v.amount !== undefined) {
					contribs.push({
						source: eff.source,
						layer: 'override',
						op: 'set',
						amount: v.amount,
						note: token
					});
				} else if (v.error) {
					notes.push(`${eff.source}: unresolved "${token}" (${v.error})`);
				}
			} else if (p.kind === EFFECT_KIND.advantage) {
				notes.push(`${eff.source}: advantage on ${targetKey}`);
			} else if (p.kind === EFFECT_KIND.disadvantage) {
				notes.push(`${eff.source}: disadvantage on ${targetKey}`);
			}
		}
	}
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

/**
 * Collect resource pools from `grant_resource:<id>:<max>:<recharge>` tokens. Data-driven and
 * class-agnostic — a Barbarian's rage, a Monk's ki, an item's "3/day" are all the same shape. If
 * the same id is granted more than once (a scaling feature re-granted at a higher tier), the largest
 * max wins.
 */
export function collectResources(effects: ActiveEffect[], ctx?: ExprContext): ResourceDef[] {
	const out = new Map<string, ResourceDef>();
	for (const eff of effects) {
		for (const token of eff.tokens) {
			const p = parseEffect(token);
			if (p.kind !== EFFECT_KIND.grantResource || !p.resource) continue;
			// max is either a literal or an L2 expression (`class_level.monk`); resolve the latter and
			// clamp to the pip cap. An unresolved expression means the pool count is unknown → skip it
			// (it would otherwise render as an inert 0-pip resource).
			let maxVal: number | undefined;
			if (p.resource.max !== undefined) maxVal = p.resource.max;
			else if (p.resource.maxExpr && ctx) {
				const r = evalExpression(p.resource.maxExpr, ctx);
				if (r.ok && r.value.type === 'number') maxVal = Math.floor(r.value.value);
			}
			if (maxVal === undefined) continue;
			const def: ResourceDef = {
				id: p.resource.id,
				max: Math.max(0, Math.min(maxVal, MAX_RESOURCE_MAX)),
				recharge: p.resource.recharge,
				name: titleCaseId(p.resource.id),
				source: eff.source
			};
			const prev = out.get(def.id);
			if (!prev || def.max > prev.max) out.set(def.id, def);
		}
	}
	return [...out.values()];
}

/** Collect the non-numeric effect facts across all active effects (for panels/flags). */
export function collectFlags(effects: ActiveEffect[]): EffectFlags {
	const flags: EffectFlags = {
		advantage: [],
		disadvantage: [],
		conditions: [],
		resources: [],
		proficiencies: [],
		resistImmune: [],
		rerolls: [],
		minDie: [],
		unknown: []
	};
	for (const eff of effects) {
		for (const token of eff.tokens) {
			const p = parseEffect(token);
			switch (p.kind) {
				case EFFECT_KIND.advantage:
					flags.advantage.push(p.target ?? token);
					break;
				case EFFECT_KIND.disadvantage:
					flags.disadvantage.push(p.target ?? token);
					break;
				case EFFECT_KIND.applyCondition:
					flags.conditions.push(p.target ?? token);
					break;
				case EFFECT_KIND.grantResource:
					flags.resources.push(p.target ?? token);
					break;
				case EFFECT_KIND.grantProficiency:
					flags.proficiencies.push(p.target ?? token);
					break;
				case EFFECT_KIND.resistImmune:
					flags.resistImmune.push(p.target ?? token);
					break;
				case EFFECT_KIND.reroll:
					if (p.target && p.amount !== undefined)
						flags.rerolls.push({ target: p.target, value: p.amount });
					break;
				case EFFECT_KIND.minDie:
					if (p.target && p.amount !== undefined)
						flags.minDie.push({ target: p.target, value: p.amount });
					break;
				case 'unknown':
					flags.unknown.push(token);
					break;
			}
		}
	}
	return flags;
}

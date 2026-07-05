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
 * Numeric tokens (`flat-bonus`, `set-override`) fold into the value; the rest
 * (`advantage`, `resist-immune`, `apply-condition`, `grant-resource`, `grant-proficiency`)
 * are non-numeric and surface as structured facts / notes. Anything unparseable is kept as
 * an inert text note — never dropped, never executed.
 */
import { computed, type Computed, type Contribution, type Layer } from '../rules/pipeline';

/** The bounded effect vocabulary, as named constants — compare against these, never bare strings. */
export const EFFECT_KIND = {
	flatBonus: 'flat-bonus',
	setOverride: 'set-override',
	advantage: 'advantage',
	grantProficiency: 'grant-proficiency',
	resistImmune: 'resist-immune',
	applyCondition: 'apply-condition',
	grantResource: 'grant-resource'
} as const;
export type EffectKind = (typeof EFFECT_KIND)[keyof typeof EFFECT_KIND];
/** The kinds as a list (for schema validation / the `includes` guard). */
export const EFFECT_KINDS = Object.values(EFFECT_KIND) as readonly EffectKind[];

export type Recharge = 'short' | 'long' | 'other';
export type Defense = 'resist' | 'immune' | 'vulnerable';

export interface ParsedEffect {
	kind: EffectKind | 'unknown';
	target?: string;
	/** Numeric flat bonus / override value. */
	amount?: number;
	/** Dice bonus (e.g. "1d4" / "-1d4") — a roll modifier, not a flat number. */
	dice?: string;
	/** resist-immune: which bucket (defaults to 'resist' when the token omits it). */
	defense?: Defense;
	/** grant-resource: the fully-specified pool (only present when `id:max:recharge` is given). */
	resource?: { id: string; max: number; recharge: Recharge };
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
		const m = /^([a-z][a-z.-]*?)\s*([+-])\s*(\d+d\d+|\d+)$/i.exec(rest);
		if (!m) return { kind: 'unknown', raw };
		const target = m[1] ?? '';
		const sign = m[2] ?? '';
		const amount = m[3] ?? '';
		if (/d/i.test(amount)) return { kind, target, dice: (sign === '-' ? '-' : '') + amount, raw };
		return { kind, target, amount: Number(sign + amount), raw };
	}
	if (kind === EFFECT_KIND.setOverride) {
		const m = /^([a-z][a-z.-]*):(-?\d+)$/i.exec(rest);
		if (!m) return { kind: 'unknown', raw };
		return { kind, target: m[1] ?? '', amount: Number(m[2]), raw };
	}
	if (kind === EFFECT_KIND.resistImmune) {
		// `resist-immune:<type>` (defaults to resistance) or `resist-immune:<bucket>:<type>`
		const m = /^(?:(resist|immune|vulnerable):)?(.+)$/i.exec(rest);
		if (!m?.[2]) return { kind: 'unknown', raw };
		const defense = (m[1]?.toLowerCase() ?? 'resist') as Defense;
		return { kind, defense, target: m[2].trim(), raw };
	}
	if (kind === EFFECT_KIND.grantResource) {
		// `grant-resource:<id>` (bare, for flags) or `grant-resource:<id>:<max>:<recharge>` (a pool)
		const m = /^([a-z0-9][a-z0-9-]*)(?::(\d+):(short|long|other))?$/i.exec(rest.trim());
		if (!m?.[1]) return { kind: 'unknown', raw };
		const id = m[1].toLowerCase();
		if (m[2] && m[3])
			return {
				kind,
				target: id,
				resource: { id, max: Number(m[2]), recharge: m[3].toLowerCase() as Recharge },
				raw
			};
		return { kind, target: id, raw };
	}
	// advantage / grant-proficiency / apply-condition
	return { kind, target: rest, raw };
}

/** A runtime effect source contributing tokens at a pipeline layer. */
export interface ActiveEffect {
	source: string;
	layer: Layer;
	tokens: string[];
}

/** Does an effect target apply to this stat key? Exact, plus the `saves` group → `save.*`. */
export function matchesTarget(effTarget: string | undefined, key: string): boolean {
	if (!effTarget) return false;
	if (effTarget === key) return true;
	if (effTarget === 'saves' && key.startsWith('save')) return true;
	if (effTarget === 'skills' && key.startsWith('skill')) return true;
	return false;
}

export interface EffectFlags {
	advantage: string[];
	disadvantage: string[];
	conditions: string[];
	resources: string[];
	proficiencies: string[];
	resistImmune: string[];
	unknown: string[];
}

/**
 * The seam: compose effects onto a core-computed stat for `targetKey`. Returns a new
 * `Computed` with the matching numeric contributions folded in and non-numeric effects as
 * notes. With no effects, the value/trace are unchanged (the on/off invariant).
 */
export function applyEffects(targetKey: string, base: Computed, effects: ActiveEffect[]): Computed {
	const contribs: Contribution[] = [...base.trace];
	const notes: string[] = [...(base.notes ?? [])];
	for (const eff of effects) {
		for (const token of eff.tokens) {
			const p = parseEffect(token);
			if (!matchesTarget(p.target, targetKey)) continue;
			if (p.kind === EFFECT_KIND.flatBonus) {
				if (p.amount !== undefined) {
					contribs.push({
						source: eff.source,
						layer: eff.layer,
						op: 'add',
						amount: p.amount,
						note: token
					});
				} else if (p.dice) {
					notes.push(
						`${eff.source}: ${p.dice.startsWith('-') ? '' : '+'}${p.dice} to ${targetKey}`
					);
				}
			} else if (p.kind === EFFECT_KIND.setOverride && p.amount !== undefined) {
				contribs.push({
					source: eff.source,
					layer: 'override',
					op: 'set',
					amount: p.amount,
					note: token
				});
			} else if (p.kind === EFFECT_KIND.advantage) {
				notes.push(`${eff.source}: advantage on ${targetKey}`);
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
 * Collect resource pools from `grant-resource:<id>:<max>:<recharge>` tokens. Data-driven and
 * class-agnostic — a Barbarian's rage, a Monk's ki, an item's "3/day" are all the same shape. If
 * the same id is granted more than once (a scaling feature re-granted at a higher tier), the largest
 * max wins.
 */
export function collectResources(effects: ActiveEffect[]): ResourceDef[] {
	const out = new Map<string, ResourceDef>();
	for (const eff of effects) {
		for (const token of eff.tokens) {
			const p = parseEffect(token);
			if (p.kind !== EFFECT_KIND.grantResource || !p.resource) continue;
			const def: ResourceDef = {
				...p.resource,
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
		unknown: []
	};
	for (const eff of effects) {
		for (const token of eff.tokens) {
			const p = parseEffect(token);
			switch (p.kind) {
				case EFFECT_KIND.advantage:
					flags.advantage.push(p.target ?? token);
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
				case 'unknown':
					flags.unknown.push(token);
					break;
			}
		}
	}
	return flags;
}

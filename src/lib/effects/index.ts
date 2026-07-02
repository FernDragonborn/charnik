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

export const EFFECT_KINDS = [
	'flat-bonus',
	'set-override',
	'advantage',
	'grant-proficiency',
	'resist-immune',
	'apply-condition',
	'grant-resource'
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface ParsedEffect {
	kind: EffectKind | 'unknown';
	target?: string;
	/** Numeric flat bonus / override value. */
	amount?: number;
	/** Dice bonus (e.g. "1d4") — a roll modifier, not a flat number. */
	dice?: string;
	raw: string;
}

/** Parse one bounded-vocab token. Unknown / malformed → `{kind:'unknown'}` (kept as text). */
export function parseEffect(token: string): ParsedEffect {
	const raw = token.trim();
	const sep = raw.indexOf(':');
	if (sep === -1) return { kind: 'unknown', raw };
	const kind = raw.slice(0, sep) as EffectKind;
	const rest = raw.slice(sep + 1);
	if (!EFFECT_KINDS.includes(kind)) return { kind: 'unknown', raw };

	if (kind === 'flat-bonus') {
		const m = /^([a-z][a-z.-]*?)\s*([+-])\s*(\d+d\d+|\d+)$/i.exec(rest);
		if (!m) return { kind: 'unknown', raw };
		const target = m[1];
		if (/d/i.test(m[3])) return { kind, target, dice: (m[2] === '-' ? '-' : '') + m[3], raw };
		return { kind, target, amount: Number(m[2] + m[3]), raw };
	}
	if (kind === 'set-override') {
		const m = /^([a-z][a-z.-]*):(-?\d+)$/i.exec(rest);
		if (!m) return { kind: 'unknown', raw };
		return { kind, target: m[1], amount: Number(m[2]), raw };
	}
	// advantage / grant-proficiency / resist-immune / apply-condition / grant-resource
	return { kind, target: rest, raw };
}

/** A runtime effect source contributing tokens at a pipeline layer. */
export interface ActiveEffect {
	source: string;
	layer: Layer;
	tokens: string[];
}

/** Does an effect target apply to this stat key? Exact, plus the `saves` group → `save.*`. */
function matchesTarget(effTarget: string | undefined, key: string): boolean {
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
			if (p.kind === 'flat-bonus') {
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
			} else if (p.kind === 'set-override' && p.amount !== undefined) {
				contribs.push({
					source: eff.source,
					layer: 'override',
					op: 'set',
					amount: p.amount,
					note: token
				});
			} else if (p.kind === 'advantage') {
				notes.push(`${eff.source}: advantage on ${targetKey}`);
			}
		}
	}
	return computed(contribs, undefined, notes.length ? notes : undefined);
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
				case 'advantage':
					flags.advantage.push(p.target ?? token);
					break;
				case 'apply-condition':
					flags.conditions.push(p.target ?? token);
					break;
				case 'grant-resource':
					flags.resources.push(p.target ?? token);
					break;
				case 'grant-proficiency':
					flags.proficiencies.push(p.target ?? token);
					break;
				case 'resist-immune':
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

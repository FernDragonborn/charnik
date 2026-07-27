/*
 * Damage defenses (resist/immune/vulnerable) and effective max-HP under a manual override. Pure.
 * Split out of the old combat/helpers.ts junk-drawer.
 */
import { computed, type Computed, type Contribution, type Layer } from '$lib/rules/pipeline';

/** The sheet's damage defenses (from `resist_immune` effects) — the three buckets by damage type. */
export interface Defenses {
	resist: string[];
	immune: string[];
	vulnerable: string[];
}

/** Which bucket, if any, a damage type hits. */
export type DefenseBucket = 'immune' | 'resist' | 'vulnerable' | null;

/**
 * Apply resist/immune/vulnerable to a raw damage amount given its type (B20). Immune → 0, resist →
 * half rounded DOWN (RAW), vulnerable → doubled; an untyped hit or a type the sheet has no defense
 * for is unchanged. Immunity outranks vulnerability (you can't be both for one type in SRD, but
 * fail-safe to 0). Pure — the resist/vuln math happens BEFORE temp-HP soak at the call site (RAW:
 * modify the damage, then absorb).
 */
export function applyDefense(
	amount: number,
	type: string | null,
	defenses: Defenses
): { final: number; bucket: DefenseBucket } {
	if (!type) return { final: amount, bucket: null };
	if (defenses.immune.includes(type)) return { final: 0, bucket: 'immune' };
	if (defenses.vulnerable.includes(type)) return { final: amount * 2, bucket: 'vulnerable' };
	if (defenses.resist.includes(type)) return { final: Math.floor(amount / 2), bucket: 'resist' };
	return { final: amount, bucket: null };
}

/** Effective max HP under an optional manual-max override (A14 — a Free-block affordance).
 *  `manualMax` null → the sheet's fully-computed max. Otherwise the manual value REPLACES the base/
 *  ability layers but hp_max EFFECTS still stack on top (Aid; a 2014-exhaustion `halve`): re-fold
 *  `{Manual max}` (base) + the sheet trace's item/feature/condition/override contributions through
 *  the SAME pipeline, so set/floor/cap/mult semantics survive. Never re-sum from facts (double-count
 *  + a D7 violation) — the effect layers are read straight off `sheetMaxHp.trace`. */
const HP_EFFECT_LAYERS = new Set<Layer>(['item', 'feature', 'condition', 'override']);
export function effectiveHpMax(manualMax: number | null, sheetMaxHp: Computed): number {
	if (manualMax === null) return sheetMaxHp.value;
	const contribs: Contribution[] = [
		{ source: 'Manual max', layer: 'base', op: 'set', amount: manualMax },
		...sheetMaxHp.trace.filter((c) => HP_EFFECT_LAYERS.has(c.layer))
	];
	return computed(contribs, { min: 1 }).value;
}

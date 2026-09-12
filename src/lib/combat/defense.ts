/*
 * Damage defenses (resist/immune/vulnerable). Pure. Split out of the old combat/helpers.ts
 * junk-drawer. The effective max-HP rule lives in `rules/core.ts` with the rest of the HP math —
 * every layer of the app asks it, not only this view.
 */

/** The sheet's damage defenses (from `damage_sensitivity` effects) — the three buckets by damage type. */
export interface DamageSensitivities {
	resist: string[];
	immune: string[];
	vulnerable: string[];
}

/** Which bucket, if any, a damage type hits. */
export type SensitivityBucket = 'immune' | 'resist' | 'vulnerable' | null;

/**
 * Apply resist/immune/vulnerable to a raw damage amount given its type (B20). Immune → 0, resist →
 * half rounded DOWN (RAW), vulnerable → doubled; an untyped hit or a type the sheet has no defense
 * for is unchanged. Immunity outranks vulnerability (you can't be both for one type in SRD, but
 * fail-safe to 0). Pure — the resist/vuln math happens BEFORE temp-HP soak at the call site (RAW:
 * modify the damage, then absorb).
 */
export function applyDamageSensitivity(
	amount: number,
	type: string | null,
	defenses: DamageSensitivities,
): { final: number; bucket: SensitivityBucket } {
	if (!type) return { final: amount, bucket: null };
	if (defenses.immune.includes(type)) return { final: 0, bucket: 'immune' };
	if (defenses.vulnerable.includes(type)) return { final: amount * 2, bucket: 'vulnerable' };
	if (defenses.resist.includes(type)) return { final: Math.floor(amount / 2), bucket: 'resist' };
	return { final: amount, bucket: null };
}

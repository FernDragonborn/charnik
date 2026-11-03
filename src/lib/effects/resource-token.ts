import { parseRecharge } from '../rules/recharge';
import type { EffectKind, ParsedEffect } from './token-parser';

export const RESOURCE_SPELL_CHOICE = 'chosen';
export const MAX_RESOURCE_MAX = 1000;

export function parseGrantResource(rest: string, raw: string, kind: EffectKind): ParsedEffect {
	// `grant_resource:<id>` (bare flag) or `grant_resource:<id>:<max>:<recharge>` where <max> is a
	// literal OR an L2 expression (`class_level.monk`). The recharge keyword anchors the end, so
	// the middle (max) can hold expression characters (`*`, `(`, `,`) unambiguously.
	// Id is snake-only (E3): a kebab pool id would be unreadable from `resource.<id>` expressions.
	const m =
		/^([a-z0-9][a-z0-9_]*)(?::([^:]+):([a-z_]+(?:\([^:]*\))?)(?::spell:([a-z0-9][a-z0-9_]*(?:,[a-z0-9][a-z0-9_]*)*))?)?$/i.exec(
			rest.trim(),
		);
	if (!m?.[1]) return { kind: 'unknown', raw };
	const id = m[1].toLowerCase();
	const spells = m[4]?.toLowerCase();
	if (spells?.includes(',') && spells.split(',').includes(RESOURCE_SPELL_CHOICE))
		return { kind: 'unknown', raw };
	const maxSlot = m[2]?.trim();
	// the recharge word (or `trigger(amount)`) anchors the end; an unknown one leaves the token
	// unparsed rather than defaulting to a policy the author did not write
	const recharge = m[3] ? parseRecharge(m[3]) : undefined;
	if (maxSlot && m[3] && !recharge) return { kind: 'unknown', raw };
	if (maxSlot && recharge) {
		const resource = /^\d+$/.test(maxSlot)
			? { id, max: Math.min(Number(maxSlot), MAX_RESOURCE_MAX), recharge }
			: { id, maxExpr: maxSlot, recharge };
		return {
			kind,
			target: id,
			resource: { ...resource, ...(spells ? { spell: spells } : {}) },
			raw,
		};
	}
	return { kind, target: id, raw };
}

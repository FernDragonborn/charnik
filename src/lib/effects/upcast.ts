/*
 * UPCAST — the structured spell-upcasting layer (docs/UPCAST-PLAN.md).
 *
 * A spell's `upcast` column is a `;`-list of `kind[:type]:formula` tokens (`damage:per_slot(1d6)`,
 * `count:slot+1`, `damage:bludgeoning:per_slot(1d8)`). Each formula is an L2 value expression that
 * reads the CAST-EPHEMERAL `slot` / `spell_level` vars (via `withCastSlot`), so upcasting is computed
 * at cast time — never in the persistent derive (B1). This module is pure: parse a cell, evaluate its
 * tokens against a cast ctx, and hand back per-kind contributions the cast layer folds.
 *
 * Reuses the existing grammar discipline (N1): `splitGuard` peels an optional `guard ?` prefix, then
 * `:` splits cleanly (an L2 expression is colon-free — no `?:` ternary, `if()` is comma-form). A
 * malformed / unknown / failing token degrades to an `error` result the caller surfaces as the prose
 * `higher_level` fallback + a content-health flag (H11) — never silently-wrong dice.
 */
import { evalExpression, type ExprContext, type ExprValue } from './expression-evaluator';
import { splitGuard } from './token-parser';

/** The upcast kinds (§8). Which combine + which cast route each takes is decided by the two sets below. */
export const UPCAST_KINDS = [
	'damage',
	'heal',
	'hp_max',
	'temp_hp',
	'count',
	'area',
	'duration',
	'enhancement'
] as const;
export type UpcastKind = (typeof UPCAST_KINDS)[number];

/** Kinds whose base value is STRUCTURED (already on the sheet), so the formula is a DELTA folded as
 *  `base + delta` (§8). Every other kind (count / area / duration / enhancement) has no structured base
 *  to add onto, so its formula is the ABSOLUTE total — e.g. an `enhancement` step gives the whole +N
 *  bonus a magic-weapon buff confers (Magic Weapon +1/+2/+3), which the cast layer spawns as a
 *  weapon-scoped `flat_bonus:attack/damage` effect. */
const DELTA_KINDS: ReadonlySet<UpcastKind> = new Set<UpcastKind>([
	'damage',
	'heal',
	'hp_max',
	'temp_hp'
]);

/** Kinds that carry an optional `:type` sub-slot (the typed-damage grammar, H5/N4): a damage/heal
 *  token may name its own damage type when the base can't supply one (`damage:bludgeoning:...`). */
const TYPED_KINDS: ReadonlySet<UpcastKind> = new Set<UpcastKind>(['damage', 'heal']);

/** One parsed upcast token — grammar only, not yet evaluated. `error` marks a token that failed to
 *  parse (unknown kind, malformed shape); the caller degrades it to prose + content-health. */
export interface ParsedUpcastToken {
	kind: UpcastKind;
	/** Damage type for a typed damage/heal sub-slot (`damage:fire:...`). */
	type?: string;
	/** The L2 value expression (colon-free). */
	formula: string;
	/** An optional `guard ?` prefix (rare; homebrew "only upcast when …"). */
	guard?: string;
	/** `delta` → fold as base+delta; `absolute` → the formula IS the total. */
	combine: 'delta' | 'absolute';
	raw: string;
}

/** A parse failure for one token (surfaced as prose fallback + content-health, H11). */
export interface UpcastParseError {
	error: string;
	raw: string;
}

const isKind = (s: string): s is UpcastKind => (UPCAST_KINDS as readonly string[]).includes(s);

/** Parse one `kind[:type]:formula` token. The formula is colon-free, so splitting on `:` is
 *  unambiguous once the optional `guard ?` is peeled. */
function parseUpcastToken(rawToken: string): ParsedUpcastToken | UpcastParseError {
	const raw = rawToken.trim();
	if (!raw) return { error: 'empty upcast token', raw };
	const { guard, token } = splitGuard(raw);
	const parts = token.split(':').map((p) => p.trim());
	const kind = parts[0] ?? '';
	if (!isKind(kind)) return { error: `unknown upcast kind '${kind}'`, raw };
	const combine = DELTA_KINDS.has(kind) ? 'delta' : 'absolute';

	if (parts.length === 2) {
		const formula = parts[1] ?? '';
		if (!formula) return { error: `upcast '${kind}' has no formula`, raw };
		return { kind, formula, combine, raw, ...(guard ? { guard } : {}) };
	}
	if (parts.length === 3) {
		if (!TYPED_KINDS.has(kind))
			return { error: `upcast '${kind}' cannot carry a type sub-slot`, raw };
		const type = parts[1] ?? '';
		const formula = parts[2] ?? '';
		if (!type || !formula) return { error: `malformed typed upcast '${raw}'`, raw };
		return { kind, type, formula, combine, raw, ...(guard ? { guard } : {}) };
	}
	return { error: `malformed upcast token '${raw}'`, raw };
}

/** Parse a whole `upcast` cell into its tokens (`;`-separated). Empty cell → []. Never throws. */
export function parseUpcast(cell: string | undefined): (ParsedUpcastToken | UpcastParseError)[] {
	if (!cell || !cell.trim()) return [];
	return cell
		.split(';')
		.map((t) => t.trim())
		.filter((t) => t.length > 0)
		.map(parseUpcastToken);
}

/** An evaluated upcast contribution for ONE kind. `pool` + `flat` are the dice / numeric parts; the
 *  caller folds them per `combine`. `isInfinite` marks a `duration:...inf` total. `error` degrades. */
export interface UpcastResult {
	kind: UpcastKind;
	type?: string;
	combine: 'delta' | 'absolute';
	/** Dice contribution ({sides: count}); `{}` when the value is purely numeric. */
	pool: Record<number, number>;
	/** Numeric contribution (floored; 5e round-down). */
	flat: number;
	/** A `duration` total that evaluated to `inf` (permanent) — the ONLY kind allowed to be infinite. */
	isInfinite?: boolean;
	raw: string;
}

const isError = (t: ParsedUpcastToken | UpcastParseError): t is UpcastParseError => 'error' in t;

/** Normalize an ExprValue into pool + flat (a number → an empty pool + that flat). */
function toPoolFlat(v: ExprValue): { pool: Record<number, number>; flat: number } {
	if (v.type === 'dice') return { pool: { ...v.dice.pool }, flat: v.dice.flat };
	return { pool: {}, flat: Math.floor(v.value) };
}

/**
 * Evaluate an `upcast` cell against a CAST ctx (must already carry `slot`/`spell_level` — build it
 * with `withCastSlot`). Returns one entry per token: an `UpcastResult` on success, or an
 * `UpcastParseError` when the token is malformed OR its formula failed / illegally produced `inf`.
 * Pure — the roller/cast layer folds the results.
 */
export function evalUpcast(
	cell: string | undefined,
	ctx: ExprContext
): (UpcastResult | UpcastParseError)[] {
	return parseUpcast(cell).map((tok) => {
		if (isError(tok)) return tok;
		if (tok.guard) {
			const g = evalExpression(tok.guard, ctx);
			if (!g.ok) return { error: `upcast guard failed: ${g.error}`, raw: tok.raw };
			// a guard that evaluates false contributes nothing — a 0 delta / absolute of the base
			if (g.value.type === 'number' && g.value.value === 0)
				return {
					kind: tok.kind,
					combine: tok.combine,
					pool: {},
					flat: 0,
					raw: tok.raw,
					...(tok.type ? { type: tok.type } : {})
				};
		}
		const r = evalExpression(tok.formula, ctx);
		if (!r.ok) return { error: r.error, raw: tok.raw };
		// `inf` is legal ONLY as a duration total; anywhere else it would poison arithmetic (N3).
		if (r.value.type === 'number' && !Number.isFinite(r.value.value)) {
			if (tok.kind === 'duration')
				return {
					kind: tok.kind,
					combine: tok.combine,
					pool: {},
					flat: 0,
					isInfinite: true,
					raw: tok.raw
				};
			return { error: `'inf' is only valid for a duration upcast`, raw: tok.raw };
		}
		const { pool, flat } = toPoolFlat(r.value);
		return {
			kind: tok.kind,
			combine: tok.combine,
			pool,
			flat,
			raw: tok.raw,
			...(tok.type ? { type: tok.type } : {})
		};
	});
}

/** Merge a delta pool + flat onto a base pool + flat (the damage/heal `base + delta` combine). Pure;
 *  returns a fresh pool. Same per-side addition the evaluator uses, kept in ONE place for the cast
 *  layer so it doesn't re-implement pool merging. */
export function combinePools(
	base: Record<number, number>,
	baseFlat: number,
	delta: Record<number, number>,
	deltaFlat: number
): { pool: Record<number, number>; flat: number } {
	const pool: Record<number, number> = { ...base };
	for (const [sides, count] of Object.entries(delta))
		pool[Number(sides)] = (pool[Number(sides)] ?? 0) + count;
	return { pool, flat: baseFlat + deltaFlat };
}

/*
 * Pure spellcasting math (rules core) — slots, caster level, caps, castable pools. No content
 * graph, no effects, no Svelte: tables are passed in as plain data, so it's fully unit-testable
 * and the core stays framework-agnostic. The derive layer feeds it data from the graph.
 *
 * Model (docs/PLAN.md "Spellcasting model", fork 1): a slot IS a recharge-typed "castable pool"
 * tagged with a spell level; the UI renders level-tagged pools as pips. Multiclass slots are the
 * SUM of caster contributions into ONE full table (not the senior class); warlock Pact Magic is a
 * separate pool and contributes NOTHING to the shared caster level.
 */

/** Multiclass caster-level contribution + rounding (data value `caster_share`). */
export type CasterShare = 'full' | 'half' | 'half-up' | 'third' | 'none';
export type Recharge = 'short' | 'long' | 'day' | 'dawn';

/** A spell-slot table: character level → counts per spell level (index 0 = 1st-level slots). */
export type SlotTable = ReadonlyMap<number, readonly number[]>;

/** A castable pool — a slot group (has `spellLevel`) or a generic/limited resource. */
export interface CastPool {
	id: string;
	label: string;
	/** Set for slot pools (rendered as pips); a spell of level ≤ this can be cast from it. */
	spellLevel?: number;
	max: number;
	recharge: Recharge;
	/** Warlock Pact Magic: everything cast from this pool is upcast to `spellLevel`. */
	forcedUpcast?: boolean;
	/** A fixed-spell resource (Mystic Arcanum, item "cast X"), by spell effectiveId. */
	castsSpell?: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** One caster class's contribution to the shared multiclass caster level. */
export function shareContribution(share: CasterShare, classLevel: number): number {
	switch (share) {
		case 'full':
			return classLevel;
		case 'half':
			return Math.floor(classLevel / 2);
		case 'half-up':
			return Math.ceil(classLevel / 2);
		case 'third':
			return Math.floor(classLevel / 3);
		default:
			return 0;
	}
}

/** Default `caster_share` from the `caster` column when the data leaves it blank. Pact → none
 *  (Pact Magic never merges into the shared pool). */
export function shareFromCaster(caster: string | undefined): CasterShare {
	switch (caster) {
		case 'full':
			return 'full';
		case 'half':
			return 'half';
		case 'third':
			return 'third';
		default:
			return 'none'; // 'pact' | 'none' | undefined
	}
}

/** Shared multiclass caster level = SUM of contributions (NOT the senior class). Pact excluded
 *  (its classes carry share `none`). Single full caster → its own level. */
export function effectiveCasterLevel(
	entries: readonly { share: CasterShare; level: number }[]
): number {
	return entries.reduce((n, e) => n + shareContribution(e.share, e.level), 0);
}

/** Slot counts (per spell level, index 0 = 1st) at a character level, clamped to 1..20. */
export function slotCountsFor(table: SlotTable, charLevel: number): number[] {
	return [...(table.get(clamp(charLevel, 1, 20)) ?? [])];
}

/** Highest spell level with at least one slot (0 = no leveled slots). */
export function maxSpellLevel(counts: readonly number[]): number {
	let m = 0;
	counts.forEach((c, i) => {
		if (c > 0) m = i + 1;
	});
	return m;
}

/** Cantrip damage-dice multiplier at a CHARACTER level — the 5/11/17 steps (identical in 2014 and
 *  2024, so no per-system seam): 1 die → 2/3/4 dice. Every SRD damage cantrip follows these steps
 *  (its `higher_level` prose restates them); a homebrew cantrip that scales differently simply
 *  isn't level 0-typed or overrides via its own damage column. */
export function cantripDieMultiplier(charLevel: number): number {
	return charLevel >= 17 ? 4 : charLevel >= 11 ? 3 : charLevel >= 5 ? 2 : 1;
}

/** The prepared/known set SIZE: the class-table value if present (2024), else a per-share formula
 *  fallback (`ability mod + effective level`, floored at 1) for editions lacking a table count. */
export function preparedCap(
	tableValue: number | undefined,
	opts: { abilityMod: number; share: CasterShare; level: number }
): number {
	if (tableValue != null) return tableValue;
	const eff = opts.share === 'none' ? opts.level : shareContribution(opts.share, opts.level);
	return Math.max(1, opts.abilityMod + eff);
}

/** Turn a slot-count array into one castable pool per non-empty spell level. */
export function slotPools(
	counts: readonly number[],
	opts: {
		idPrefix: string;
		recharge: Recharge;
		forcedUpcast?: boolean;
		label?: (lvl: number) => string;
	}
): CastPool[] {
	const out: CastPool[] = [];
	counts.forEach((n, i) => {
		if (n <= 0) return;
		const spellLevel = i + 1;
		out.push({
			id: `${opts.idPrefix}-${spellLevel}`,
			label: opts.label ? opts.label(spellLevel) : `Level ${spellLevel}`,
			spellLevel,
			max: n,
			recharge: opts.recharge,
			forcedUpcast: opts.forcedUpcast ?? false
		});
	});
	return out;
}

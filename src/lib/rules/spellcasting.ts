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
export type CasterShare = 'full' | 'half' | 'half_up' | 'third' | 'none';
/** How a limited pool refills: on a short or long rest, or `other` = never auto (manual only).
 *  The ONE owner of this vocabulary (D11) — the effects layer imports it, never redefines it. */
export type Recharge = 'short' | 'long' | 'other';

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

/** What casting a spell should do to the leveled slot pools (AUDIT A17): spend `key` (a
 *  `spellSlotsSpent` key, "1".."9"), do nothing (`null`), or refuse with `block`. */
export type SlotSpend = { key: string } | { block: string } | null;

/**
 * Which leveled spell slot a cast of `spellLevel` consumes. The LOWEST leveled slot ≥ the spell's
 * level that still has a use left (basic auto-fill — no manual upcast picker yet). Returns:
 *   - `null` when nothing is consumed: a cantrip (level 0), OR a caster with NO leveled pool (a pure
 *     warlock — pact pips aren't wired to the UI yet, so casting isn't gated on them).
 *   - `{ key }` — the `spellSlotsSpent` key to increment.
 *   - `{ block }` — the caster HAS leveled slots but none ≥ the spell's level remain (cast refused).
 * Pure; the play-state map is read, never mutated.
 */
export function slotToSpend(
	spellLevel: number,
	pools: readonly CastPool[],
	spent: Readonly<Record<string, number>>
): SlotSpend {
	if (spellLevel <= 0) return null; // cantrip
	const leveled = pools.filter(
		(p): p is CastPool & { spellLevel: number } => !p.forcedUpcast && p.spellLevel !== undefined
	);
	if (!leveled.length) return null; // no leveled pool (pure warlock / non-caster) — don't gate
	const open = leveled
		.filter((p) => p.spellLevel >= spellLevel && p.max - (spent[String(p.spellLevel)] ?? 0) > 0)
		.sort((a, b) => a.spellLevel - b.spellLevel)[0];
	return open
		? { key: String(open.spellLevel) }
		: { block: `No level-${spellLevel} spell slot remaining` };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** One caster class's contribution to the shared multiclass caster level. */
export function shareContribution(share: CasterShare, classLevel: number): number {
	switch (share) {
		case 'full':
			return classLevel;
		case 'half':
			return Math.floor(classLevel / 2);
		case 'half_up':
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

/** A prepared-spell entry (the two flags the cap logic reads). */
export interface PreparableSpell {
	prepared: boolean;
	alwaysPrepared: boolean;
}

/** Spells that count toward the prepared CAP: leveled + toggled-on. Always-prepared spells (domain,
 *  feat, subclass) are free and NEVER counted — the single source both the combat sheet and the
 *  spellbook use, so their caps can't diverge (D13). */
export function preparedLeveledCount(spells: readonly PreparableSpell[]): number {
	return spells.filter((s) => s.prepared && !s.alwaysPrepared).length;
}

/** Outcome of trying to flip a spell's `prepared` flag. `message` (when present) is the toast to show
 *  on refusal; a silent refusal (`ok:false` with no message) means "nothing to do". */
export type PrepareAttempt = { ok: true } | { ok: false; message?: string };

/** Whether a spell's `prepared` flag may flip, enforcing the leveled cap. Cantrips are always known
 *  and always-prepared spells are fixed, so neither can be toggled. Pure — the caller flips on `ok`.
 *  Shared by the combat sheet and the spellbook so both enforce identical rules (D13). */
export function canTogglePrepared(
	entry: PreparableSpell | undefined,
	isCantrip: boolean,
	cap: number,
	count: number
): PrepareAttempt {
	if (isCantrip)
		return { ok: false, message: 'Cantrips are always known — you never prepare them.' };
	if (!entry || entry.alwaysPrepared) return { ok: false };
	if (!entry.prepared && count >= cap)
		return { ok: false, message: `Prepared spells full (${cap}) — unprepare one first.` };
	return { ok: true };
}

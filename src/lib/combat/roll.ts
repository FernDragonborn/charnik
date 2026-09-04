/*
 * Roll-time helpers for the Combat view: what an effect contributes to a roll, forced outcomes,
 * advantage math, pip click-to-set, and the small roll-UI constants. Pure — the caller gates on
 * the effects-auto toggle. Split out of the old combat/helpers.ts junk-drawer.
 */
import {
	ADVANTAGE_MODE,
	droppedD20s,
	keptD20,
	parseDiceTerm,
	parseFormula,
	rehydrateRoll,
	rollPool,
	type BonusDie,
	type CritMethod,
	type DieMods,
	type FlatPart,
	type Rng,
	type Rolled,
	type StoredRoll,
} from '$lib/rules/dice';
import { matchesTarget, type EffectFacts } from '$lib/effects/apply';
import type { RollMod } from '$lib/effects/facts';

/** A rolled damage slice carrying its damage type ("slashing", "radiant"). A single-type hit is one
 *  of these; a multi-type weapon rolls several, each shown separately with its own total (BUG-DMG-1). */
export type TypedRoll = Rolled & { type: string };

/** One damage part to roll: its dice pool + flat mod + type, plus any effect bonus dice / mods that
 *  ride it (folded onto the primary part by the caller). Fed to `rollDamageParts`. */
export interface DamagePartSpec {
	dice: Record<number, number>;
	mod: number;
	/** What `mod` was made of, when the roll site knew — an effect's named `+2` beside a typed one.
	 *  Absent means nobody recorded a source, not that there was no modifier. */
	modParts?: FlatPart[];
	type: string;
	bonusDice?: BonusDie[];
	mods?: DieMods;
	/** Set → this part crit, by that method. Per PART rather than per roll because a crit doubles
	 *  DICE, and each part has its own; the flat modifier it carries is untouched either way. */
	crit?: CritMethod;
}

/** Does this set of parts actually deal damage? "Has a part" is NOT the question: `parseDamageParts`
 *  always yields at least one, falling back to an empty `{pool:{}, mod:0, type:''}` placeholder for a
 *  weapon with no damage line. Nor is "has dice" — Unarmed Strike's "1 + STR mod" is entirely FLAT,
 *  and gating on dice alone dropped it from the roll and the toast altogether. Dice OR a flat value. */
export const dealsDamage = (parts: DamagePartSpec[]): boolean =>
	parts.some((p) => Object.keys(p.dice).length > 0 || p.mod !== 0);

/** Roll each damage part into a `TypedRoll`, preserving order (primary part first). Pure — the rng is
 *  injectable for tests; each part carries its own type through so the tray can show the breakdown. */
export function rollDamageParts(parts: DamagePartSpec[], rng?: () => number): TypedRoll[] {
	return parts.map((p) => ({
		...rollPool(p.dice, {
			...(p.mods ?? {}),
			...(rng ? { rng } : {}),
			mod: p.mod,
			...(p.modParts ? { modParts: p.modParts } : {}),
			...(p.bonusDice ? { bonusDice: p.bonusDice } : {}),
			...(p.crit ? { crit: p.crit } : {}),
		}),
		type: p.type,
	}));
}

/** A roll-log row: a completed roll (the primary/to-hit) plus what it was for, and — for an attack —
 *  the per-type damage rolls that follow it. Rendered as the roll, the dropped adv die, then one line
 *  per damage type plus a combined total. `note` is an optional provenance line (item 4): an upcast
 *  cast records "Xd base + Yd @ slot N" so the boosted dice are explained (value + provenance), not a
 *  bare bigger total. */
export type RollLogEntry = Rolled & {
	label: string;
	damage?: TypedRoll[];
	note?: string;
	/** When it was rolled (epoch ms), stamped by `pushRoll` — so it belongs to the ROLL rather than to
	 *  how it happens to be stored. The persisted line used to invent its own timestamp at write time,
	 *  which is part of how the two records drifted apart; it is also what an amendment matches on to
	 *  rewrite its own line. Absent only on a view-model literal that is toasted but never logged. */
	at?: number;
};

/** A log row as it may come BACK off disk: a line written before `Rolled` carried its dice has only
 *  the rendered `expr`, and so does every damage part under it. */
export type StoredRollLogEntry = StoredRoll & {
	label: string;
	note?: string;
	at?: number;
	damage?: (StoredRoll & { type: string })[];
};

/** A stored row → a row with dice, damage parts included. `rehydrateRoll` covers ONE roll; an attack
 *  is a roll plus N damage rolls, and rehydrating only the top one would give the row back its d20
 *  while its damage chips stayed empty. The seam is here rather than in the roller because `damage`
 *  is a combat-layer fact and `rules/dice` must not learn about it.
 *
 *  The row's own fields are listed rather than spread: `rehydrateRoll` DROPS the legacy fields it
 *  consumes, and a spread of the original would carry them (a stale advantage pair, a stale
 *  `natural`) back onto the row and from there back to disk. */
export const rehydrateLogEntry = (e: StoredRollLogEntry): RollLogEntry => ({
	...rehydrateRoll(e),
	label: e.label,
	...(e.note !== undefined ? { note: e.note } : {}),
	...(e.at !== undefined ? { at: e.at } : {}),
	...(e.damage ? { damage: e.damage.map((d) => ({ ...rehydrateRoll(d), type: d.type })) } : {}),
});

/** The amendment sentence a roll's note carries, matched so re-amending REPLACES it rather than
 *  stacking, and so undoing removes it without eating a note the roll already had (an upcast's
 *  "8d6 base + 1d6 @ slot 4" is provenance, and amending the d20 must not destroy it).
 *
 *  The sentence is ONE ` · ` segment, and the parenthetical is why: it used to read "advantage after
 *  the roll · kept 19 over 7", which this pattern could only eat as far as the next `·` — so every
 *  lap round the cycle left another "· kept 19 over 7" behind and the note grew. Reading back a
 *  sentence we wrote ourselves is the same sin as parsing a rendered roll back; one segment is the
 *  cheap half of the
 *  fix, and the structured `amendments: [{kind, from, to}]` is the real one. */
const AMEND_NOTE = /(?:^\s*|\s·\s)(?:(?:dis)?advantage after the roll|advantage cleared)[^·]*/;

/** A roll's note after it has been re-read at a different advantage: whatever the note already said,
 *  minus any previous amendment, plus what this one is. Pure so the sentence has one definition and
 *  a test can walk a whole lap of the cycle over it. */
export function amendedNote(previous: string | undefined, revised: Rolled): string {
	const dropped = droppedD20s(revised)[0];
	const kept = (previous ?? '').replace(AMEND_NOTE, '').trim();
	if (!dropped) return kept;
	const amendment =
		revised.advantage === ADVANTAGE_MODE.neither
			? // the second die was really rolled and the record says so; it just doesn't count
				`advantage cleared (the second d20, ${dropped.value}, does not count)`
			: `${revised.advantage} after the roll (kept ${keptD20(revised)?.value} over ${dropped.value})`;
	return [kept, amendment].filter(Boolean).join(' · ');
}

/**
 * A formula that came from CONTENT (a monster's HP, a spell's damage) → the entry that rolls it,
 * carrying anything the parse could not account for as its own note. Every instant-roll affordance
 * goes through here, so an unread fragment surfaces the same way wherever it is rolled instead of
 * making the total quietly smaller (docs/internals/roller.md ▸ Conventions).
 */
export function rollFormulaEntry(label: string, formula: string, rng?: Rng): RollLogEntry {
	const { dice, mod, issues } = parseFormula(formula);
	return {
		label,
		...rollPool(dice, { mod, ...(rng ? { rng } : {}) }),
		...(issues.length
			? { note: `formula not fully read — ${issues.map((i) => `“${i}”`).join(', ')} ignored` }
			: {}),
	};
}

/** Combined total across every typed damage part. */
export const damageTotal = (parts: TypedRoll[]): number => parts.reduce((n, p) => n + p.total, 0);

/** The three action-economy slots a turn tracks. */
export type ActionSlot = 'action' | 'bonus' | 'reaction';

/** What a slot is called in a sentence — "bonus" alone is not the name of anything at the table.
 *  Catalog KEYS, not words: these land inside sentences the user reads, and this module has no
 *  locale. Every consumer already has a `$_` or `t()` to spend on them. */
export const ACTION_SLOT_LABEL: Record<ActionSlot, string> = {
	action: 'combat.slot.action',
	bonus: 'combat.slot.bonus',
	reaction: 'combat.slot.reaction',
};

/** The dice sizes offered in the roll tray. */
export const DICE = [4, 6, 8, 10, 12, 20, 100];

/** `[0, 1, …, n-1]` — for rendering N pips/dots. */
export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** A normal tap rolls instantly; Shift-click opens the prefilled roll tray. */
export const wantsTray = (e: Event) => (e as MouseEvent).shiftKey;

/**
 * Click-to-set for every pip tracker (action economy, spell slots, resources) — ONE model:
 * available pips on the LEFT, spent pips accumulate on the RIGHT. Clicking an available pip spends
 * from it rightward; clicking a spent pip restores from it leftward. Returns the new spent count,
 * always in [0, total]. Pure so it's the single source shared by every tracker and unit-testable.
 */
export function pipClick(currentSpent: number, index: number, total: number): number {
	const remaining = total - currentSpent; // pips 0..remaining-1 are available (left), rest spent
	return index < remaining ? total - index : total - index - 1;
}

/** What a roll target (e.g. "save.dex", "skill.stealth", "attack", "damage") picks up from active
 *  effects: advantage/disadvantage, signed bonus/penalty dice (Bless +1d4 / Bane −1d4), the summed
 *  FLAT bonus, and the roll-manipulation facts (`reroll`/`min_die`). NB `flat` is for keys the
 *  sheet does NOT already fold (attack/damage) — for save/skill keys the flat part is already
 *  inside the sheet value, so callers must ignore it there or it double-counts. Pure — the caller
 *  gates it on the effects-auto toggle.
 *
 *  Reads the sheet's typed-facts object (D7) — the resolve stage already evaluated guards,
 *  expanded conditions and resolved L2 expression values, so an expression bonus
 *  (`is_raging ? flat_bonus:damage+cha_mod`) arrives here as a plain number. */
export interface RollEffects extends DieMods {
	advantage: boolean;
	disadvantage: boolean;
	flat: number;
	bonusDice: BonusDie[];
}
export const NO_ROLL_EFFECTS: RollEffects = {
	advantage: false,
	disadvantage: false,
	flat: 0,
	bonusDice: [],
};
export function rollEffectsFor(
	facts: EffectFacts,
	key: string,
	weaponScopes?: Set<string>,
): RollEffects {
	const out: RollEffects = { ...NO_ROLL_EFFECTS, bonusDice: [] };
	out.advantage = facts.advantage.some((a) => matchesTarget(a.target, key));
	out.disadvantage = facts.disadvantage.some((d) => matchesTarget(d.target, key));
	for (const f of facts.numeric) {
		if (f.op !== 'add' || !matchesTarget(f.target, key)) continue;
		if (f.weaponScope) continue; // §A: weapon-scoped bonus folds per-weapon in computeAttacks
		if (f.amount !== undefined) out.flat += f.amount;
		else if (f.diceFormula) {
			const die = parseDiceTerm(f.diceFormula);
			if (die) out.bonusDice.push(die);
		}
	}
	// §B: a weapon-scoped roll-manip (GWF `two_handed,melee`) applies only when the rolling weapon
	// carries EVERY tag; a non-weapon roll (no scope set) skips scoped facts. Unscoped facts always apply.
	const scopeOk = (mod: RollMod): boolean =>
		!mod.weaponScope ||
		(weaponScopes ? mod.weaponScope.split(',').every((t) => weaponScopes.has(t)) : false);
	// several sources → the most generous single value applies (they don't stack — one reroll pass)
	for (const r of facts.rerolls)
		if (matchesTarget(r.target, key) && scopeOk(r)) out.reroll = Math.max(out.reroll ?? 0, r.value);
	for (const m of facts.minDie)
		if (matchesTarget(m.target, key) && scopeOk(m)) out.minDie = Math.max(out.minDie ?? 0, m.value);
	return out;
}

/** A forced roll outcome for `key`, or null to roll normally. `auto_fail`/`auto_succeed` effects
 *  (paralyzed → STR/DEX saves) override the RESULT, not the die — so a matched save doesn't roll at
 *  all. Auto-fail wins a contradictory pair (the debuff bias: conditions that force outcomes are
 *  debilitating, and a fail-closed default is safer than silently succeeding). */
export function autoOutcome(facts: EffectFacts, key: string): 'fail' | 'succeed' | null {
	if (facts.autoFail.some((a) => matchesTarget(a.target, key))) return 'fail';
	if (facts.autoSucceed.some((a) => matchesTarget(a.target, key))) return 'succeed';
	return null;
}

/** Advantage + disadvantage cancel to a straight roll (5e rule) → the −1/0/+1 the roller takes. */
export const netAdvantage = (fx: Pick<RollEffects, 'advantage' | 'disadvantage'>): number =>
	fx.advantage === fx.disadvantage ? 0 : fx.advantage ? 1 : -1;

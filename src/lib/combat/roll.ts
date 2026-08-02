/*
 * Roll-time helpers for the Combat view: what an effect contributes to a roll, forced outcomes,
 * advantage math, pip click-to-set, and the small roll-UI constants. Pure — the caller gates on
 * the effects-auto toggle. Split out of the old combat/helpers.ts junk-drawer.
 */
import { parseDiceTerm, rollPool, type BonusDie, type DieMods, type Rolled } from '$lib/rules/dice';
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
	type: string;
	bonusDice?: BonusDie[];
	mods?: DieMods;
}

/** Roll each damage part into a `TypedRoll`, preserving order (primary part first). Pure — the rng is
 *  injectable for tests; each part carries its own type through so the tray can show the breakdown. */
export function rollDamageParts(parts: DamagePartSpec[], rng?: () => number): TypedRoll[] {
	return parts.map((p) => ({
		...rollPool(p.dice, p.mod, 0, p.bonusDice ?? [], {
			...(p.mods ?? {}),
			...(rng ? { rng } : {})
		}),
		type: p.type
	}));
}

/** A roll-log row: a completed roll (the primary/to-hit) plus what it was for, and — for an attack —
 *  the per-type damage rolls that follow it. Rendered as the roll, the dropped adv die, then one line
 *  per damage type plus a combined total. */
export type RollLogEntry = Rolled & { label: string; damage?: TypedRoll[] };

/** Combined total across every typed damage part. */
export const damageTotal = (parts: TypedRoll[]): number => parts.reduce((n, p) => n + p.total, 0);

/** The three action-economy slots a turn tracks. */
export type ActionSlot = 'action' | 'bonus' | 'reaction';

/** The dice sizes offered in the roll tray. */
export const DICE = [4, 6, 8, 10, 12, 20, 100];

/** `[0, 1, …, n-1]` — for rendering N pips/dots. */
export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** A normal tap rolls instantly; Alt/Ctrl/Cmd-click opens the prefilled roll tray. */
export const wantsTray = (e: Event) => {
	const m = e as MouseEvent;
	return m.altKey || m.ctrlKey || m.metaKey;
};

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
	bonusDice: []
};
export function rollEffectsFor(
	facts: EffectFacts,
	key: string,
	weaponScopes?: Set<string>
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

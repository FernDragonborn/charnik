/*
 * The ONE dice roller. Pure: no Svelte, no toast, no logging — it returns {total, expr, adv?}
 * so every caller (combat tap-roll, the custom roll tray, compendium HP/damage) shares identical
 * mechanics and it's unit-testable with a seeded RNG. Before this, three copies of the roll loop
 * had drifted (the compendium one only rolled the first NdM group). A single roll path is also a
 * correctness property: adv/disadv, bonus dice and formatting can't diverge across call sites.
 */

/** Injectable randomness; defaults to Math.random, seeded in tests. Returns [0,1). */
export type Rng = () => number;

/** A signed bonus/penalty die a roll gains from an effect (Bless +1d4 → {sides:4,count:1,sign:+1}). */
export interface BonusDie {
	sides: number;
	count: number;
	sign: number;
}

/** Result of a roll: the total, a human-readable breakdown, and the adv/disadv d20 pair if any. */
export interface Rolled {
	total: number;
	/** e.g. "d8(5) + d6(2) +3"; the bonus-die parts carry their own sign. */
	expr: string;
	/** [kept, dropped] when an advantage/disadvantage d20 was rolled. */
	adv?: [number, number];
}

/** Roll one die with `sides` faces. */
const rollDie = (sides: number, rng: Rng) => 1 + Math.floor(rng() * sides);

/** "+N" / "−N" for a nonzero flat modifier (0 is never appended). */
const formatModifier = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Parse every `NdM` token in a string into a pool ({sides: count}). "2d6 + 1d4" → {6:2, 4:1}. */
export function parseDicePool(s: string): Record<number, number> {
	const out: Record<number, number> = {};
	for (const m of s.matchAll(/(\d+)d(\d+)/gi))
		out[Number(m[2])] = (out[Number(m[2])] ?? 0) + Number(m[1]);
	return out;
}

/**
 * Roll a dice pool + flat mod. `adv` (−1 disadvantage / 0 normal / +1 advantage) applies to the
 * FIRST d20 in the pool: roll two, keep the winner, expose the loser as `adv`. `bonusDice` are the
 * signed effect dice (Bless +1d4 / Bane −1d4). Deterministic under a seeded `rng`.
 */
export function rollPool(
	dice: Record<number, number>,
	mod = 0,
	adv = 0,
	bonusDice: BonusDie[] = [],
	rng: Rng = Math.random
): Rolled {
	const parts: string[] = [];
	let total = 0;
	let advPair: [number, number] | undefined;
	for (const [s, c] of Object.entries(dice).sort((a, b) => Number(b[0]) - Number(a[0]))) {
		const sides = Number(s);
		for (let k = 0; k < c; k++) {
			const v = rollDie(sides, rng);
			if (sides === 20 && adv !== 0 && k === 0) {
				// roll TWO d20 and keep the winner; the loser is surfaced (rendered struck through)
				const v2 = rollDie(20, rng);
				const kept = adv > 0 ? Math.max(v, v2) : Math.min(v, v2);
				advPair = [kept, kept === v ? v2 : v];
				total += kept;
				continue; // the adv detail renders the d20, don't duplicate it in `parts`
			}
			total += v;
			parts.push(`d${sides}(${v})`);
		}
	}
	for (const b of bonusDice)
		for (let k = 0; k < b.count; k++) {
			const v = rollDie(b.sides, rng);
			total += b.sign * v;
			parts.push(`${b.sign < 0 ? '−' : '+'}d${b.sides}(${v})`);
		}
	total += mod;
	const expr = parts.join(' + ') + (mod ? ` ${formatModifier(mod)}` : '');
	return { total, expr, adv: advPair };
}

/** Roll a dice formula string ("16d12 + 80", "8d6", "2d6+1d4-1"): parse the pool + trailing flat
 *  mod, then `rollPool`. Rolls EVERY dice group (the old compendium roller only did the first). */
export function rollFormula(formula: string, rng: Rng = Math.random): Rolled {
	const fm = /([+-]\s*\d+)\s*$/.exec(formula);
	const mod = fm ? Number(fm[1].replace(/\s/g, '')) : 0;
	return rollPool(parseDicePool(formula), mod, 0, [], rng);
}

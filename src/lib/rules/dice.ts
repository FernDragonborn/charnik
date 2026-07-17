/*
 * The ONE dice roller. Pure: no Svelte, no toast, no logging — it returns {total, expr,
 * advantageRoll?} so every caller (combat tap-roll, the custom roll tray, compendium HP/damage)
 * shares identical mechanics and it's unit-testable with a seeded RNG. Before this, three copies of
 * the roll loop had drifted (the compendium one only rolled the first NdM group). A single roll path
 * is also a correctness property: advantage, bonus dice and formatting can't diverge across sites.
 */

/** Injectable randomness; defaults to Math.random, seeded in tests. Returns [0,1). */
export type Rng = () => number;

/** A signed bonus/penalty die a roll gains from an effect (Bless +1d4 → {sides:4,count:1,sign:+1}). */
export interface BonusDie {
	sides: number;
	count: number;
	sign: number;
}

/** The two d20 of an advantage/disadvantage roll: the one kept and the one dropped. */
interface AdvantageRoll {
	kept: number;
	dropped: number;
}

/** Result of a roll: the total, a human-readable breakdown, and the two d20 if adv/disadv applied. */
export interface Rolled {
	total: number;
	/** e.g. "d8(5) + d6(2) +3"; the bonus-die parts carry their own sign. */
	expr: string;
	/** Present only when an advantage/disadvantage d20 was rolled. */
	advantageRoll?: AdvantageRoll;
	/** The NATURAL face of the first d20 (post reroll/floor, pre modifiers) — for nat-1/nat-20
	 *  outcomes (death saves, crits). Present only when the pool rolled a d20. */
	natural?: number;
}

/** Roll-manipulation effects a roll carries (L1 `reroll:`/`min_die:` facts — the roll path is
 *  their consumer). They apply to the POOL's own dice, not to signed bonus dice (GWF rerolls the
 *  weapon's dice, not a Bless die). */
export interface DieMods {
	/** Reroll (once, keep the new result) any die that lands ≤ this — GWF ≤2, Halfling Lucky 1. */
	reroll?: number;
	/** Treat a die below this AS this — Reliable Talent's d20 → 10. */
	minDie?: number;
}

/** Cost caps (not game balance): a dice term drives a roll loop + a string build, so an untrusted
 *  formula (shared content pack, later a plugin) must not be able to request a billion dice and
 *  freeze the tab. Bounds are far above any real spell (Meteor Swarm is 40d6) — they cap WORK, not
 *  legal values. Terms beyond them are clamped, not rejected, so a typo still rolls something. */
export const MAX_DICE_PER_TERM = 1000;
export const MAX_DIE_SIDES = 1000;

/** Roll one die with `sides` faces. */
const rollDie = (sides: number, rng: Rng) => 1 + Math.floor(rng() * sides);

/** "+N" / "−N" for a nonzero flat modifier (0 is never appended). */
const formatModifier = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Parse a single signed dice term ("1d4" / "-2d4" / "+1d6") into a `BonusDie`, or null if it
 *  isn't one. Used for effect bonus dice (Bless/Bane) where the sign matters. */
export function parseDiceTerm(term: string): BonusDie | null {
	const m = /^([+-]?)(\d+)d(\d+)$/.exec(term.trim());
	if (!m) return null;
	return {
		count: Math.min(Number(m[2]), MAX_DICE_PER_TERM),
		sides: Math.min(Number(m[3]), MAX_DIE_SIDES),
		sign: m[1] === '-' ? -1 : 1
	};
}

/** Parse every `NdM` token in a string into a pool ({sides: count}). "2d6 + 1d4" → {6:2, 4:1}.
 *  Counts/sides are cost-capped (see the caps above) so an untrusted formula can't blow the loop. */
export function parseDicePool(s: string): Record<number, number> {
	const out: Record<number, number> = {};
	for (const m of s.matchAll(/(\d+)d(\d+)/gi)) {
		const sides = Math.min(Number(m[2]), MAX_DIE_SIDES);
		const count = Math.min(Number(m[1]), MAX_DICE_PER_TERM);
		out[sides] = Math.min((out[sides] ?? 0) + count, MAX_DICE_PER_TERM);
	}
	return out;
}

/** Options for `rollPool` beyond the pool itself: injectable rng + roll-manipulation effects. */
export interface RollOptions extends DieMods {
	rng?: Rng;
}

/**
 * Roll a dice pool + flat mod. `advantage` (−1 disadvantage / 0 normal / +1 advantage) applies to
 * the FIRST d20 in the pool: roll two, keep the winner, expose the loser as `advantageRoll`.
 * `bonusDice` are the signed effect dice (Bless +1d4 / Bane −1d4). `opts` takes the rng (seeded in
 * tests) and the `reroll`/`min_die` effect facts — a bare `Rng` is accepted for existing callers.
 * Deterministic under a seeded rng.
 */
export function rollPool(
	dice: Record<number, number>,
	mod = 0,
	advantage = 0,
	bonusDice: BonusDie[] = [],
	opts: RollOptions | Rng = {}
): Rolled {
	const o: RollOptions = typeof opts === 'function' ? { rng: opts } : opts;
	const rng = o.rng ?? Math.random;
	// one pool die with reroll/floor applied; `label` spells out what happened (d6(1↻4), d20(3→10)).
	// `face` is the actual die result AFTER a reroll but BEFORE a min_die floor — a nat-1/nat-20 is
	// judged by what the die shows (Reliable Talent's "treat as 10" doesn't erase a natural 1).
	const rollOne = (sides: number): { v: number; face: number; label: string } => {
		let v = rollDie(sides, rng);
		let detail = `${v}`;
		if (o.reroll !== undefined && v <= o.reroll) {
			v = rollDie(sides, rng);
			detail += `↻${v}`;
		}
		const face = v;
		if (o.minDie !== undefined && v < o.minDie) {
			v = o.minDie;
			detail += `→${v}`;
		}
		return { v, face, label: `d${sides}(${detail})` };
	};
	const parts: string[] = [];
	let total = 0;
	let advantageRoll: AdvantageRoll | undefined;
	let natural: number | undefined;
	for (const [s, c] of Object.entries(dice).sort((a, b) => Number(b[0]) - Number(a[0]))) {
		const sides = Number(s);
		for (let k = 0; k < c; k++) {
			const r = rollOne(sides);
			if (sides === 20 && advantage !== 0 && k === 0) {
				// roll TWO d20 and keep the winner; the loser is surfaced (rendered struck through)
				const r2 = rollOne(20);
				const win = advantage > 0 ? Math.max(r.v, r2.v) : Math.min(r.v, r2.v);
				const winIsFirst = win === r.v;
				advantageRoll = { kept: win, dropped: winIsFirst ? r2.v : r.v };
				natural = winIsFirst ? r.face : r2.face; // the kept die's face (pre-floor)
				total += win;
				continue; // the advantage detail renders the d20, don't duplicate it in `parts`
			}
			if (sides === 20 && natural === undefined) natural = r.face;
			total += r.v;
			parts.push(r.label);
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
	return {
		total,
		expr,
		...(advantageRoll !== undefined ? { advantageRoll } : {}),
		...(natural !== undefined ? { natural } : {})
	};
}

/** Roll a dice formula string ("16d12 + 80", "8d6", "2d6+1d4-1"): parse the pool + trailing flat
 *  mod, then `rollPool`. Rolls EVERY dice group (the old compendium roller only did the first). */
export function rollFormula(formula: string, rng: Rng = Math.random): Rolled {
	const fm = /([+-]\s*\d+)\s*$/.exec(formula);
	const mod = fm?.[1] ? Number(fm[1].replace(/\s/g, '')) : 0;
	return rollPool(parseDicePool(formula), mod, 0, [], rng);
}

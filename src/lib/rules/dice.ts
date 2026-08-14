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

/** The two d20 of an advantage/disadvantage roll: the one kept and the one dropped, and WHICH of the
 *  two it was. The mode can't be recovered from the numbers — two d20 that both land on 12 look the
 *  same either way — and the UI frames the pair green or red by it. Optional so an entry persisted
 *  before it existed still loads; those fall back to comparing kept against dropped. */
interface AdvantageRoll {
	kept: number;
	dropped: number;
	mode?: 1 | -1;
	/** The die that was rolled FIRST. Recorded so the pair can be undone — a tap too many has to be
	 *  recoverable, and "no advantage" means "the die that stood before the second one", which the
	 *  kept/dropped pair alone can't say. Absent on entries logged before it existed; those simply
	 *  can't return to neutral. */
	original?: number;
}

/** Result of a roll: the total, a human-readable breakdown, and the two d20 if adv/disadv applied. */
export interface Rolled {
	total: number;
	/** e.g. "d8(5) + d6(2) +3"; the bonus-die parts carry their own sign. */
	expr: string;
	/** Present only when an advantage/disadvantage d20 was rolled. */
	advantageRoll?: AdvantageRoll;
	/** The NATURAL face of the first d20 — after a reroll, BEFORE a `min_die` floor, before modifiers.
	 *  Pre-floor on purpose: Reliable Talent's "treat a d20 below 10 as 10" must not erase a natural 1.
	 *  Drives nat-1/nat-20 outcomes (death saves, crits). Present only when the pool rolled a d20. */
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
		sign: m[1] === '-' ? -1 : 1,
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

/** Render a dice pool back to a string ({6:2, 4:1} → "2d6 + 1d4"), largest die first. Inverse of
 *  `parseDicePool` for display; empty pool → "". */
export function formatDicePool(pool: Record<number, number>): string {
	return Object.entries(pool)
		.sort((a, b) => Number(b[0]) - Number(a[0]))
		.map(([sides, count]) => `${count}d${sides}`)
		.join(' + ');
}

/** Options for `rollPool` beyond the pool itself: injectable rng + roll-manipulation effects. */
export interface RollOptions extends DieMods {
	rng?: Rng;
}

/** The rolled main pool: running total, rendered parts, and the adv/natural metadata. */
interface PoolResult {
	total: number;
	parts: string[];
	advantageRoll?: AdvantageRoll;
	natural?: number;
}

/** Roll the main pool (all NdM groups, highest die first). The FIRST d20 gets advantage/disadvantage
 *  — roll two, keep the winner, surface the loser as `advantageRoll`. `rollOne` carries the pool's
 *  reroll/min_die effects. Split out of `rollPool` (the bonus-dice/mod/formatting stays there). */
function rollPoolDice(
	dice: Record<number, number>,
	advantage: number,
	rollOne: (sides: number) => { v: number; face: number; label: string },
): PoolResult {
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
				advantageRoll = {
					kept: win,
					dropped: winIsFirst ? r2.v : r.v,
					mode: advantage > 0 ? 1 : -1,
					original: r.v,
				};
				natural = winIsFirst ? r.face : r2.face; // the kept die's face (pre-floor)
				total += win;
				continue; // the advantage detail renders the d20, don't duplicate it in `parts`
			}
			if (sides === 20 && natural === undefined) natural = r.face;
			total += r.v;
			parts.push(r.label);
		}
	}
	return {
		total,
		parts,
		...(advantageRoll !== undefined ? { advantageRoll } : {}),
		...(natural !== undefined ? { natural } : {}),
	};
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
	opts: RollOptions | Rng = {},
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
	const pool = rollPoolDice(dice, advantage, rollOne);
	const parts = pool.parts;
	let total = pool.total;
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
		...(pool.advantageRoll !== undefined ? { advantageRoll: pool.advantageRoll } : {}),
		...(pool.natural !== undefined ? { natural: pool.natural } : {}),
	};
}

/** One die as the UI shows it: the face it ended on, how many sides it had, its sign (a Bane die is
 *  −1d4) and the raw detail ("1↻4", "3→10") so a reroll/floor is still explainable on hover. */
export interface DieChip {
	sides: number;
	value: number;
	sign: number;
	detail: string;
}

/** Read an `expr` back into per-die chips + the trailing flat modifier. The roll toast/log render one
 *  chip per die, and `expr` is the only per-die record that survives into a persisted `log.jsonl`
 *  entry — so the display parses its own format rather than the roller carrying a second payload.
 *  Inverse of the `expr` built by `rollPool`; the adv/disadv d20 is NOT in here (it lives in
 *  `advantageRoll`). */
export function parseRollExpr(expr: string): { chips: DieChip[]; mod: number } {
	const chips: DieChip[] = [];
	for (const m of expr.matchAll(/([+−])?d(\d+)\(([^)]*)\)/g)) {
		const detail = m[3] ?? '';
		const faces = detail.match(/\d+/g) ?? [];
		chips.push({
			sides: Number(m[2]),
			// the LAST number is what the die finally counted as (post reroll ↻ and post floor →)
			value: Number(faces[faces.length - 1] ?? 0),
			sign: m[1] === '−' ? -1 : 1,
			detail,
		});
	}
	// no die ever ends in a bare signed number (they all close with `)`), so the tail is the flat mod
	const mod = /([+−])(\d+)\s*$/.exec(expr);
	return { chips, mod: mod ? (mod[1] === '−' ? -1 : 1) * Number(mod[2]) : 0 };
}

/** Chips + flat mod → an `expr`, the inverse of what `rollPool` joins. Not byte-identical to the
 *  original for a POSITIVE bonus die (the roller writes `+d4(3)`, this writes `d4(3)`) because the
 *  parse can't tell a pool die from one — but it round-trips through `parseRollExpr` to the same
 *  chips, which is all `expr` is for (the display parses its own format). */
const formatExpr = (chips: DieChip[], mod: number): string =>
	chips.map((c) => `${c.sign < 0 ? '−' : ''}d${c.sides}(${c.detail})`).join(' + ') +
	(mod ? ` ${formatModifier(mod)}` : '');

/**
 * Apply advantage to a roll that ALREADY happened: roll one more d20 and keep the better of the two.
 *
 * RAW-exact rather than a fudge — the rule is "roll a second d20 and take the higher", and rolling it
 * after the first is on the table changes nothing mechanically. It also matches how tables actually
 * play: the DM says "that has advantage" once the die is already down.
 *
 * Returns null when the roll can't take it: no d20 in the pool, or two dice already decided it.
 *
 * The two dice are compared by what they CONTRIBUTE, not by their raw faces. A die floored by
 * `min_die` (Reliable Talent's 3→10) contributed 10, and RAW would floor the new die the same way —
 * so the higher contribution is the right outcome either way, and the log entry doesn't have to carry
 * the roll's effect facts for this to be correct.
 */
export function amendWithAdvantage<T extends Rolled>(r: T, rng: Rng = Math.random): T | null {
	if (r.advantageRoll) return null;
	const { chips, mod } = parseRollExpr(r.expr);
	const index = chips.findIndex((c) => c.sides === 20 && c.sign > 0);
	const d20 = chips[index];
	if (!d20) return null;
	const fresh = rollDie(20, rng);
	const keptIsFresh = fresh > d20.value;
	const kept = keptIsFresh ? fresh : d20.value;
	return {
		...r,
		total: r.total - d20.value + kept,
		// the kept d20 renders from `advantageRoll`, so it must leave `expr` or it would show twice
		expr: formatExpr(
			chips.filter((_, k) => k !== index),
			mod,
		),
		advantageRoll: { kept, dropped: keptIsFresh ? d20.value : fresh, mode: 1, original: d20.value },
		natural: keptIsFresh ? fresh : (r.natural ?? d20.value),
	};
}

/**
 * Flip a roll that two d20 already decided: what was kept is dropped and what was dropped is kept.
 * No new die — both were rolled the moment advantage was applied, so switching between advantage and
 * disadvantage is a REINTERPRETATION of dice already on the table, not a re-roll. That is what makes
 * the d20 pill safe to tap twice: the second tap can't manufacture a better outcome, it can only pick
 * the other die that was already there.
 *
 * Returns null for a roll no pair decided (nothing to flip).
 */
export function flipAdvantage<T extends Rolled>(r: T): T | null {
	const adv = r.advantageRoll;
	if (!adv) return null;
	return {
		...r,
		total: r.total - adv.kept + adv.dropped,
		advantageRoll: {
			kept: adv.dropped,
			dropped: adv.kept,
			mode: (adv.mode ?? (adv.kept >= adv.dropped ? 1 : -1)) === 1 ? -1 : 1,
			...(adv.original !== undefined ? { original: adv.original } : {}),
		},
		natural: adv.dropped,
	};
}

/**
 * Undo a pair: back to the single die that was rolled first, as if advantage had never applied. The
 * second die really was rolled, and the log entry says the roll was amended — but a control you can
 * tap by accident has to be recoverable, and being stuck with an advantage you didn't mean is a worse
 * record than one corrected. Null when there is no pair, or when the entry predates `original`.
 */
export function clearAdvantage<T extends Rolled>(r: T): T | null {
	const adv = r.advantageRoll;
	if (!adv || adv.original === undefined) return null;
	const { chips, mod } = parseRollExpr(r.expr);
	const d20: DieChip = { sides: 20, value: adv.original, sign: 1, detail: `${adv.original}` };
	const { advantageRoll: _dropped, ...rest } = r;
	return {
		...(rest as T),
		total: r.total - adv.kept + adv.original,
		expr: formatExpr([d20, ...chips], mod),
		natural: adv.original,
	};
}

/**
 * One tap on the d20, cycling **advantage → disadvantage → neither**. The first tap rolls a second
 * die and keeps the better; the next picks the other die of that pair; the third puts the roll back
 * the way it landed. Only the first tap draws a die — the rest reinterpret two that are already on
 * the table — so tapping can never manufacture a better outcome, and a mis-tap is always one lap from
 * undone. The whole control in one call, so a caller can't implement half the cycle.
 *
 * Null when the roll has no d20 to amend.
 */
export function cycleAdvantage<T extends Rolled>(r: T, rng: Rng = Math.random): T | null {
	if (!r.advantageRoll) return amendWithAdvantage(r, rng);
	// advantage → disadvantage → neither; an entry with no recorded `original` can only flip
	return (r.advantageRoll.mode ?? 1) === 1
		? flipAdvantage(r)
		: (clearAdvantage(r) ?? flipAdvantage(r));
}

/** Roll a dice formula string ("16d12 + 80", "8d6", "2d6+1d4-1"): parse the pool + trailing flat
 *  mod, then `rollPool`. Rolls EVERY dice group (the old compendium roller only did the first). */
export function rollFormula(formula: string, rng: Rng = Math.random): Rolled {
	const fm = /([+-]\s*\d+)\s*$/.exec(formula);
	const mod = fm?.[1] ? Number(fm[1].replace(/\s/g, '')) : 0;
	return rollPool(parseDicePool(formula), mod, 0, [], rng);
}

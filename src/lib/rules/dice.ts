/*
 * The ONE dice roller. Pure: no Svelte, no toast, no logging — every caller (combat tap-roll, the
 * custom roll tray, compendium HP/damage) shares identical mechanics and it's unit-testable with a
 * seeded RNG. Before this, three copies of the roll loop had drifted (the compendium one only rolled
 * the first NdM group). A single roll path is also a correctness property: advantage, bonus dice and
 * rendering can't diverge across sites.
 *
 * It answers with WHAT HAPPENED, not with how to show it: `{total, dice, mod, advantageRoll?}`, one
 * `RolledDie` per die. `expr` is a rendering of that, kept only because entries already in
 * `log.jsonl` have nothing else — it used to BE the record, and the display parsed it back with a
 * regex to get its chips (ROLLER-PLAN finding A).
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

/** What a die was drawn FOR. Rendering reads it (a bonus die writes its sign, a pool die doesn't),
 *  and it is where "these are the doubled ones" will live when crits land — a property of the die
 *  rather than a field beside it. A named member, not a bare string (AI-CONVENTIONS §1.5). */
export const DIE_ROLE = {
	/** The roll's own dice — the weapon's d8, the check's d20. */
	pool: 'pool',
	/** A signed die an effect added: Bless +1d4, Bane −1d4. */
	bonus: 'bonus',
} as const;
export type DieRole = (typeof DIE_ROLE)[keyof typeof DIE_ROLE];

/**
 * ONE die, as it was actually rolled. This is the roll's record — the house contract is "value +
 * provenance, never a bare number" (CLAUDE.md), and until this existed the only per-die record was
 * the rendered `expr` string, which the display then parsed back with a regex (ROLLER-PLAN finding A).
 */
export interface RolledDie {
	sides: number;
	/** What the die counted for, BEFORE its sign — post-reroll and post-`min_die` floor. A Bane die
	 *  that shows 3 has `value: 3, sign: -1` and takes 3 off the total. */
	value: number;
	/** The face it ended on: after a reroll, BEFORE a floor. A nat 1 that Reliable Talent treats as
	 *  10 is still a natural 1, which is why this is not the same number as `value`. */
	face: number;
	sign: 1 | -1;
	/** The raw story of this die — "4", "1↻4" (rerolled), "3→10" (floored) — so a hover can explain
	 *  a value that isn't just the face. */
	detail: string;
	role: DieRole;
	/** Where the die came from ("Bless", "Greataxe"). The provenance a string could never hold; a
	 *  roll site fills it when it knows, so it stays optional. */
	source?: string;
}

/** Result of a roll: the total, the dice it was made of, and the two d20 if adv/disadv applied. */
export interface Rolled {
	total: number;
	/** Every die the roll drew, in the order it was rolled. THE record — read this, not `expr`. The
	 *  adv/disadv d20 is not in here; it lives in `advantageRoll` (slice 4 folds the two together). */
	dice: RolledDie[];
	/** The flat modifier added after the dice. */
	mod: number;
	/** e.g. "d8(5) + d6(2) +3" — a RENDERING of `dice` + `mod`, kept because it is what entries
	 *  already in `log.jsonl` carry and what an older build reads. Nothing new should read it:
	 *  `parseLegacyExpr` exists for those old entries and for nothing else. */
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

/** A dice term anywhere in a formula: `2d6`, and `d8` where the count is left implicit (= 1). ONE
 *  regex because the pool parser and the modifier parser must agree on what a die IS — whatever one
 *  of them skips, the other must not read as a plain number, which is precisely how UBUG-22 lost a
 *  `+3`. Global, so only use it with `matchAll`/`replace` (both leave `lastIndex` alone). */
const DICE_TERM = /(\d*)d(\d+)/gi;

/** Parse every dice term in a string into a pool ({sides: count}). "2d6 + 1d4" → {6:2, 4:1}.
 *  Counts/sides are cost-capped (see the caps above) so an untrusted formula can't blow the loop. */
export function parseDicePool(s: string): Record<number, number> {
	const out: Record<number, number> = {};
	for (const m of s.matchAll(DICE_TERM)) {
		const sides = Math.min(Number(m[2]), MAX_DIE_SIDES);
		const count = Math.min(m[1] ? Number(m[1]) : 1, MAX_DICE_PER_TERM);
		out[sides] = Math.min((out[sides] ?? 0) + count, MAX_DICE_PER_TERM);
	}
	return out;
}

/**
 * The flat modifier of a formula or damage segment: EVERY signed term that is not part of a die,
 * summed. The dice come out first, so a die's count can never be misread as a modifier
 * ("2d6+10d4" → 0) and a modifier counts wherever it sits. Reading only the TAIL is what made
 * `1d6+3+1d4` roll three short (UBUG-22) — reachable from content, since a homebrew
 * `heal:1d8+2+1d4` goes through here. Handles the unicode minus `signed()` writes as well as ASCII.
 *
 * An UNSIGNED number counts only as a leading value in a segment with no dice at all — Heal's "70",
 * a fixed "1 bludgeoning" weapon. With dice present it is ignored, because that is the statblock
 * average-damage form the shipped monsters use ("12 (2d6 + 5)" must roll 2d6+5, not 2d6+17), and
 * because damage strings carry prose ("1d20 vs AC 15"). A missing number beats a wrong one.
 */
export function parseFlatModifier(s: string): number {
	const rest = s.replace(DICE_TERM, ' ');
	let mod = rest === s ? Number(/^\s*(\d+)\b/.exec(rest)?.[1] ?? 0) : 0;
	for (const m of rest.matchAll(/([+\-−])\s*(\d+)/g)) mod += (m[1] === '+' ? 1 : -1) * Number(m[2]);
	return mod;
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
interface RollOptions extends DieMods {
	rng?: Rng;
}

/** The rolled main pool: running total, the dice themselves, and the adv/natural metadata. */
interface PoolResult {
	total: number;
	dice: RolledDie[];
	advantageRoll?: AdvantageRoll;
	natural?: number;
}

/** Roll the main pool (all NdM groups, highest die first). The FIRST d20 gets advantage/disadvantage
 *  — roll two, keep the winner, surface the loser as `advantageRoll`. `rollOne` carries the pool's
 *  reroll/min_die effects. Split out of `rollPool` (the bonus-dice/mod/rendering stays there). */
function rollPoolDice(
	dice: Record<number, number>,
	advantage: number,
	rollOne: (sides: number) => RolledDie,
): PoolResult {
	const rolled: RolledDie[] = [];
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
				const win = advantage > 0 ? Math.max(r.value, r2.value) : Math.min(r.value, r2.value);
				const winIsFirst = win === r.value;
				advantageRoll = {
					kept: win,
					dropped: winIsFirst ? r2.value : r.value,
					mode: advantage > 0 ? 1 : -1,
					original: r.value,
				};
				natural = winIsFirst ? r.face : r2.face; // the kept die's face (pre-floor)
				total += win;
				continue; // the pair renders from `advantageRoll`, don't duplicate it in the dice
			}
			if (sides === 20 && natural === undefined) natural = r.face;
			total += r.value;
			rolled.push(r);
		}
	}
	return {
		total,
		dice: rolled,
		...(advantageRoll !== undefined ? { advantageRoll } : {}),
		...(natural !== undefined ? { natural } : {}),
	};
}

/** Everything a pool roll can be given besides the dice themselves. One object rather than four
 *  positional arguments, because the middle of `rollPool(d, 0, 0, [], rng)` said nothing about
 *  what those zeros were (§2.8) — and because a `RollEffects` spreads straight into it. */
export interface RollPoolOptions extends RollOptions {
	/** Flat modifier added after the dice. */
	mod?: number;
	/** −1 disadvantage · 0 normal · +1 advantage. */
	advantage?: number;
	/** Signed effect dice (Bless +1d4 / Bane −1d4). */
	bonusDice?: BonusDie[];
}

/**
 * Roll a dice pool + flat mod. `advantage` applies to the FIRST d20 in the pool: roll two, keep the
 * winner, expose the loser as `advantageRoll`. `opts` also takes the rng (seeded in tests) and the
 * `reroll`/`min_die` effect facts — a bare `Rng` is accepted, which is the whole of what most
 * callers pass. Deterministic under a seeded rng.
 */
export function rollPool(dice: Record<number, number>, opts: RollPoolOptions | Rng = {}): Rolled {
	const o: RollPoolOptions = typeof opts === 'function' ? { rng: opts } : opts;
	const rng = o.rng ?? Math.random;
	const mod = o.mod ?? 0;
	const advantage = o.advantage ?? 0;
	const bonusDice = o.bonusDice ?? [];
	// one pool die with reroll/floor applied; `detail` spells out what happened (1↻4, 3→10). `face` is
	// the actual die result AFTER a reroll but BEFORE a min_die floor — a nat-1/nat-20 is judged by
	// what the die shows (Reliable Talent's "treat as 10" doesn't erase a natural 1).
	const rollOne = (sides: number): RolledDie => {
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
		return { sides, value: v, face, sign: 1, detail, role: DIE_ROLE.pool };
	};
	const pool = rollPoolDice(dice, advantage, rollOne);
	const rolled = pool.dice;
	let total = pool.total;
	for (const b of bonusDice)
		for (let k = 0; k < b.count; k++) {
			const v = rollDie(b.sides, rng);
			total += b.sign * v;
			rolled.push({
				sides: b.sides,
				value: v,
				face: v,
				sign: b.sign < 0 ? -1 : 1,
				detail: `${v}`,
				role: DIE_ROLE.bonus,
			});
		}
	total += mod;
	return {
		total,
		dice: rolled,
		mod,
		expr: formatExpr(rolled, mod),
		...(pool.advantageRoll !== undefined ? { advantageRoll: pool.advantageRoll } : {}),
		...(pool.natural !== undefined ? { natural: pool.natural } : {}),
	};
}

/**
 * Read an `expr` back into dice + the trailing flat modifier. **LEGACY ONLY.** `expr` used to be the
 * single per-die record, so a `log.jsonl` line written before `Rolled.dice` existed carries the dice
 * nowhere else — this is how those lines are still readable, and it is the only reason it survives
 * (ROLLER-PLAN, "explicitly not wanted": a formatted string as the record). Nothing that rolls today
 * should call it; go through `rehydrateRoll` at the point a stored roll is read.
 *
 * What it can and cannot recover: a floored die ("3→10") gives back both its face and its value; a
 * rerolled one ("1↻4") only the value it kept, since the discarded face is not the natural either
 * way. A positive bonus die is indistinguishable from a pool die in this format, so everything
 * unsigned comes back as `pool` — the sign is the only role marker the old string ever had.
 */
export function parseLegacyExpr(expr: string): { dice: RolledDie[]; mod: number } {
	const dice: RolledDie[] = [];
	for (const m of expr.matchAll(/([+−])?d(\d+)\(([^)]*)\)/g)) {
		const detail = m[3] ?? '';
		const faces = (detail.match(/\d+/g) ?? []).map(Number);
		// the LAST number is what the die finally counted as (post reroll ↻ and post floor →); a floor
		// is the one step that changes the value, so the face is the number before the arrow
		const value = faces[faces.length - 1] ?? 0;
		const floored = detail.includes('→') && faces.length > 1;
		const sign = m[1] === '−' ? -1 : 1;
		dice.push({
			sides: Number(m[2]),
			value,
			face: floored ? (faces[faces.length - 2] ?? value) : value,
			sign,
			detail,
			role: sign < 0 || m[1] === '+' ? DIE_ROLE.bonus : DIE_ROLE.pool,
		});
	}
	// no die ever ends in a bare signed number (they all close with `)`), so the tail is the flat mod
	const mod = /([+−])(\d+)\s*$/.exec(expr);
	return { dice, mod: mod ? (mod[1] === '−' ? -1 : 1) * Number(mod[2]) : 0 };
}

/** Dice + flat mod → the `expr` string. Now a pure RENDERING of the record rather than the record
 *  itself; `role` is what makes it exact, since a positive bonus die writes its `+` and a pool die
 *  does not — the distinction the old chip-based formatter documented that it could not keep. */
const formatExpr = (dice: RolledDie[], mod: number): string =>
	dice
		.map(
			(d) => `${d.sign < 0 ? '−' : d.role === DIE_ROLE.bonus ? '+' : ''}d${d.sides}(${d.detail})`,
		)
		.join(' + ') + (mod ? ` ${formatModifier(mod)}` : '');

/** A roll as it may come back off disk: everything a `Rolled` has, except that the per-die record
 *  may be missing — that is exactly what a `log.jsonl` line written before it existed looks like. */
export type StoredRoll = Omit<Rolled, 'dice' | 'mod'> & Partial<Pick<Rolled, 'dice' | 'mod'>>;

/**
 * A stored roll → a roll with its dice, filling them from `expr` when the entry predates them.
 * The ONE legacy seam: every reader of a persisted roll goes through here, so nothing downstream has
 * to know that two shapes ever existed. A roll that already carries dice is returned untouched.
 */
export function rehydrateRoll<T extends StoredRoll>(roll: T): Omit<T, 'dice' | 'mod'> & Rolled {
	const { dice, mod } = roll.dice
		? { dice: roll.dice, mod: roll.mod ?? 0 }
		: parseLegacyExpr(roll.expr);
	return { ...roll, dice, mod };
}

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
	const index = r.dice.findIndex((d) => d.sides === 20 && d.sign > 0);
	const d20 = r.dice[index];
	if (!d20) return null;
	const fresh = rollDie(20, rng);
	const keptIsFresh = fresh > d20.value;
	const kept = keptIsFresh ? fresh : d20.value;
	// the kept d20 renders from `advantageRoll`, so it leaves the dice or it would show twice
	const dice = r.dice.filter((_, k) => k !== index);
	return {
		...r,
		total: r.total - d20.value + kept,
		dice,
		expr: formatExpr(dice, r.mod),
		advantageRoll: { kept, dropped: keptIsFresh ? d20.value : fresh, mode: 1, original: d20.value },
		// the die's FACE, not its value: a d20 floored to 10 by Reliable Talent is still a natural 1.
		// The string this used to read back could not tell those apart and fell back to the value.
		natural: keptIsFresh ? fresh : (r.natural ?? d20.face),
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
function clearAdvantage<T extends Rolled>(r: T): T | null {
	const adv = r.advantageRoll;
	if (!adv || adv.original === undefined) return null;
	const d20: RolledDie = {
		sides: 20,
		value: adv.original,
		face: adv.original,
		sign: 1,
		detail: `${adv.original}`,
		role: DIE_ROLE.pool,
	};
	const dice = [d20, ...r.dice];
	const { advantageRoll: _dropped, ...rest } = r;
	return {
		...(rest as T),
		total: r.total - adv.kept + adv.original,
		dice,
		expr: formatExpr(dice, r.mod),
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

/** Roll a dice formula string ("16d12 + 80", "8d6", "2d6+1d4-1"): parse the pool + the flat mod, then
 *  `rollPool`. Rolls EVERY dice group (the old compendium roller only did the first) and counts every
 *  flat term, wherever it sits (UBUG-22 — it used to read only the tail). */
export function rollFormula(formula: string, rng: Rng = Math.random): Rolled {
	return rollPool(parseDicePool(formula), { mod: parseFlatModifier(formula), rng });
}

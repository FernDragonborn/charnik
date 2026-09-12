/*
 * The ONE dice roller. Pure: no Svelte, no toast, no logging — every caller (combat tap-roll, the
 * custom roll tray, compendium HP/damage) shares identical mechanics and it's unit-testable with a
 * seeded RNG. Before this, three copies of the roll loop had drifted (the compendium one only rolled
 * the first NdM group). A single roll path is also a correctness property: advantage, bonus dice and
 * rendering can't diverge across sites.
 *
 * It answers with WHAT HAPPENED, not with how to show it: `{total, dice, d20s, advantage, mod}`, one
 * `RolledDie` per die. `expr` is a rendering of that, kept only because entries already in
 * `log.jsonl` have nothing else — it used to BE the record, and the display parsed it back with a
 * regex to get its chips.
 *
 * Advantage is a MODE over the d20 it drew, not a fact about them: the dice are what happened, how
 * many of them count is an interpretation, and re-reading a roll the other way round must never draw
 * (`setAdvantage`).
 */

/** Injectable randomness; defaults to Math.random, seeded in tests. Returns [0,1). */
export type Rng = () => number;

/** A signed bonus/penalty die a roll gains from an effect (Bless +1d4 → {sides:4,count:1,sign:+1}). */
export interface BonusDie {
	sides: number;
	count: number;
	sign: number;
	/** Which effect gave it ("Bless"). Carried onto every `RolledDie` it becomes, so the roll's record
	 *  can tell a Bless d4 from a d4 the player typed — the one thing a count-by-sides pool cannot
	 *  hold, and the reason the fold hands dice over as a list rather than as a tally. */
	source?: string;
}

/** ONE flat contribution to a roll: what it added, and what added it. `Rolled.mod` is their sum;
 *  this is what the sum was MADE of, so "+2 from Bless" and "+2 someone typed" stay two facts
 *  instead of one number (`rules-core.md` ▸ every value carries its provenance). */
export interface FlatPart {
	amount: number;
	source?: string;
}

/** What a set of flat contributions comes to. The one place the sum is defined, so a request that
 *  carries parts and a result that reports a total cannot drift. */
export const flatTotal = (parts: FlatPart[]): number => parts.reduce((n, p) => n + p.amount, 0);

/** How a roll's d20 were read. An INTERPRETATION of dice already on the table, freely switchable —
 *  which is the whole point: the dice are a fact, the mode is not, so changing it must never draw.
 *  A named member, and the one place this fact lives (it used to be spelled three ways: a ±1 `mode`
 *  on the pair, a ±1 `advantageMode` on the toast line, and implied by `kept` vs `dropped`). */
export const ADVANTAGE_MODE = {
	neither: 'neither',
	advantage: 'advantage',
	disadvantage: 'disadvantage',
} as const;
export type AdvantageMode = (typeof ADVANTAGE_MODE)[keyof typeof ADVANTAGE_MODE];

/** Mode → the shape that says it: the modifier suffix of the shared `.advantage-cue` class
 *  (`styles/components.css`). Up-triangle, down-triangle, diamond — one glyph, drawn the same
 *  wherever a mode is shown (the roller's toggle, a completed roll's d20, the suggestion menu).
 *  Here beside the mode because it was being re-derived by hand at every one of those. */
export const ADVANTAGE_CUE: Record<AdvantageMode, 'up' | 'down' | 'neither'> = {
	[ADVANTAGE_MODE.advantage]: 'up',
	[ADVANTAGE_MODE.disadvantage]: 'down',
	[ADVANTAGE_MODE.neither]: 'neither',
};

/** Mode ↔ the ±1 axis every roll site speaks (it is arithmetic over effects). The two are different
 *  facts on purpose (docs/internals/roller.md), and this pair is the one seam between them. */
export const ADVANTAGE_SIGN: Record<AdvantageMode, number> = {
	[ADVANTAGE_MODE.advantage]: 1,
	[ADVANTAGE_MODE.disadvantage]: -1,
	[ADVANTAGE_MODE.neither]: 0,
};
export function advantageFromSign(sign: number): AdvantageMode {
	if (sign > 0) return ADVANTAGE_MODE.advantage;
	return sign < 0 ? ADVANTAGE_MODE.disadvantage : ADVANTAGE_MODE.neither;
}

/** The lap a tap on the cue takes. One order, wherever the tap happens. */
export const NEXT_ADVANTAGE: Record<AdvantageMode, AdvantageMode> = {
	[ADVANTAGE_MODE.neither]: ADVANTAGE_MODE.advantage,
	[ADVANTAGE_MODE.advantage]: ADVANTAGE_MODE.disadvantage,
	[ADVANTAGE_MODE.disadvantage]: ADVANTAGE_MODE.neither,
};

/** The pre-2026-08-22 shape of an advantage pair, as it still sits in `log.jsonl`. Read by
 *  `rehydrateRoll` and by nothing else — `d20s` + `advantage` replaced every field of it. */
interface LegacyAdvantageRoll {
	kept: number;
	dropped: number;
	mode?: 1 | -1;
	/** The die that was rolled FIRST. Absent on the oldest entries — see `drawOrderUnknown`. */
	original?: number;
}

/** What a die was drawn FOR. Rendering reads it (a bonus die writes its sign, a pool die doesn't),
 *  and it is where "these are the doubled ones" will live when crits land — a property of the die
 *  rather than a field beside it. A named member, not a bare string (AGENTS.md ▸ Taste (open enums, never booleans)). */
export const DIE_ROLE = {
	/** The roll's own dice — the weapon's d8, the check's d20. */
	pool: 'pool',
	/** A signed die an effect added: Bless +1d4, Bane −1d4. */
	bonus: 'bonus',
	/** A die the roll gained because it was a CRIT — the second set. It is a property of the die, not
	 *  a field beside the roll, which is what lets the display ride a crit's doubled dice in ONE
	 *  divided pill: they are the same damage, rolled twice, not two damages. */
	crit: 'crit',
} as const;
type DieRole = (typeof DIE_ROLE)[keyof typeof DIE_ROLE];

/** How a crit doubles damage. A rule OPTION, not a house rule: 5e RAW is *classic*, and *loyal* is
 *  the common table variant that trades the swinginess of a second roll for a guaranteed floor. Set
 *  in Settings and overridable per roll, because the table decides this mid-session as often as not.
 *  A named member so a third method can be added without a boolean growing a second meaning. */
export const CRIT_METHOD = {
	/** RAW: roll the damage dice twice and add both. */
	classic: 'classic',
	/** One set rolled + one set at its maximum. */
	loyal: 'loyal',
} as const;
export type CritMethod = (typeof CRIT_METHOD)[keyof typeof CRIT_METHOD];

/**
 * ONE die, as it was actually rolled. This is the roll's record — the house contract is "value +
 * provenance, never a bare number" (CLAUDE.md), and until this existed the only per-die record was
 * the rendered `expr` string, which the display then parsed back with a regex.
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

/** Result of a roll: the total, the dice it was made of, and how its d20 were read. */
export interface Rolled {
	total: number;
	/** Every die the roll drew EXCEPT its d20 candidates, in the order it was rolled. THE record —
	 *  read this, not `expr`. */
	dice: RolledDie[];
	/** The d20 that decide this roll, in the order they were DRAWN, and never more than one of them
	 *  counts (`keptD20`). One entry is an ordinary d20 test; a second appears the first time the roll
	 *  is read at advantage or disadvantage, and is kept forever after — switching the mode again
	 *  re-reads these dice instead of drawing (see `setAdvantage`). Empty for a damage roll.
	 *
	 *  A second POOL d20 (`{20: 2}`) is not a candidate and stays in `dice`: advantage has always
	 *  applied to the first d20 only, and nothing in the app rolls two. */
	d20s: RolledDie[];
	/** How those d20 are read. Not a property of the dice — an interpretation of them. */
	advantage: AdvantageMode;
	/** The flat modifier added after the dice. */
	mod: number;
	/** What that modifier was made of, when the roll site knew. Absent on a roll given a bare `mod`
	 *  (a formula, a legacy line) — and absent is honest there: nobody recorded where it came from. */
	modParts?: FlatPart[];
	/** e.g. "d8(5) + d6(2) +3" — a RENDERING of `dice` + `mod`, kept because it is what entries
	 *  already in `log.jsonl` carry and what an older build reads. Nothing new should read it:
	 *  `parseLegacyExpr` exists for those old entries and for nothing else. */
	expr: string;
	/** The reroll / bounds the POOL's dice were rolled under (Reliable Talent's floor, a Halfling's
	 *  reroll), when the roll carried any. Recorded because a roll can be re-read later: the d20 an
	 *  amendment draws has to be floored the same way the first one was, or one tap of the control
	 *  decides the roll with a die the rule says cannot stand. Absent when the roll had none. */
	mods?: DieMods;
	/** Set ONLY by the legacy reader, for a pair logged before the first-drawn die was recorded: the
	 *  two numbers are known, the order they came in is not. Such a roll can still be read either way
	 *  round — advantage and disadvantage are exact from the pair alone — but it can never go back to
	 *  `neither`, because "the die that stood first" would be a guess presented as a total. Delete
	 *  this and its branch once logs from before 2026-08-10 have rotated out. */
	drawOrderUnknown?: true;
}

/** The d20 that counts: the highest at advantage, the lowest at disadvantage, and otherwise the one
 *  that was drawn first. Derived, never stored — `kept`/`dropped` used to be fields, which is how a
 *  mode switch could disagree with the dice it was switching between. */
export function keptD20(roll: Pick<Rolled, 'd20s' | 'advantage'>): RolledDie | undefined {
	const [first, ...rest] = roll.d20s;
	if (!first || roll.advantage === ADVANTAGE_MODE.neither) return first;
	const better = roll.advantage === ADVANTAGE_MODE.advantage;
	// reduce keeps the FIRST of equal dice, so the pair always splits into one kept and one dropped
	return rest.reduce(
		(best, d) => ((better ? d.value > best.value : d.value < best.value) ? d : best),
		first,
	);
}

/** The d20 that were rolled and did not count — rendered struck through beside the one that did. */
export const droppedD20s = (roll: Pick<Rolled, 'd20s' | 'advantage'>): RolledDie[] => {
	const kept = keptD20(roll);
	return roll.d20s.filter((d) => d !== kept);
};

/** The NATURAL face of the d20 that counted — after a reroll, BEFORE a `min_die` floor, before
 *  modifiers. Pre-floor on purpose: Reliable Talent's "treat a d20 below 10 as 10" must not erase a
 *  natural 1. Drives nat-1/nat-20 outcomes (death saves, crits). Undefined when no d20 decided the
 *  roll. */
export const naturalOf = (roll: Pick<Rolled, 'd20s' | 'advantage'>): number | undefined =>
	keptD20(roll)?.face;

/** Roll-manipulation effects a roll carries (L1 `reroll:`/`min_die:` facts — the roll path is
 *  their consumer). They apply to the POOL's own dice, not to signed bonus dice (GWF rerolls the
 *  weapon's dice, not a Bless die). */
export interface DieMods {
	/** Reroll (once, keep the new result) any die that lands ≤ this — GWF ≤2, Halfling Lucky 1. */
	reroll?: number;
	/** Treat a die below this AS this — Reliable Talent's d20 → 10. */
	minDie?: number;
	/** Treat a die above this AS this — the ceiling to `minDie`'s floor. Nothing in 5e needs it today;
	 *  it exists because the dice tray takes `<10` in the same field as `>10`, and a bound that has
	 *  no home here would have to arrive later as a mechanism of its own. */
	maxDie?: number;
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

/** Parse a single signed dice term ("1d4" / "-2d4" / "+d6") into a `BonusDie`, or null if it isn't
 *  one. Used for effect bonus dice (Bless/Bane) where the sign matters, and by the dice tray for
 *  a typed dice token.
 *
 *  The count is optional, exactly as in `DICE_TERM`: "d4" is one d4 wherever it is written, and the
 *  two parsers disagreeing about that is the shape of UBUG-22. The unicode minus is accepted beside
 *  the ASCII one because `signed()` writes it, so a term read back off the UI comes in that way. */
export function parseDiceTerm(term: string): BonusDie | null {
	const m = /^([+\-−]?)(\d*)d(\d+)$/.exec(term.trim());
	if (!m) return null;
	return {
		count: Math.min(m[2] ? Number(m[2]) : 1, MAX_DICE_PER_TERM),
		sides: Math.min(Number(m[3]), MAX_DIE_SIDES),
		sign: m[1] === '-' || m[1] === '−' ? -1 : 1,
	};
}

/** A dice term anywhere in a formula: `2d6`, `d8` where the count is left implicit (= 1), and the sign
 *  that binds it. ONE regex because the pool parser and the modifier parser must agree on what a die
 *  IS — whatever one of them skips, the other must not read as a plain number, which is precisely how
 *  UBUG-22 lost a `+3`. The sign is captured because a pool keyed by sides cannot hold one, and a
 *  reader that skipped it ADDED `2d6-1d4`. Global, so only use it with `matchAll`/`replace` (both
 *  leave `lastIndex` alone). */
const DICE_TERM = /([+\-−]?)\s*(\d*)d(\d+)/gi;

/** Every dice term of a string, split by its sign: the added ones as a pool ({sides: count}), the
 *  SUBTRACTED ones as signed `BonusDie`s, which is the only shape that can express them. `rollPool`
 *  takes both, so a formula carrying a penalty die rolls what it says.
 *  Counts/sides are cost-capped (see the caps above) so an untrusted formula can't blow the loop. */
export function parseSignedDice(s: string): { pool: Record<number, number>; negative: BonusDie[] } {
	const pool: Record<number, number> = {};
	const negative: BonusDie[] = [];
	for (const m of s.matchAll(DICE_TERM)) {
		const sides = Math.min(Number(m[3]), MAX_DIE_SIDES);
		const count = Math.min(m[2] ? Number(m[2]) : 1, MAX_DICE_PER_TERM);
		if (m[1] === '-' || m[1] === '−') negative.push({ count, sides, sign: -1 });
		else pool[sides] = Math.min((pool[sides] ?? 0) + count, MAX_DICE_PER_TERM);
	}
	return { pool, negative };
}

/** The ADDED dice terms of a string as a pool. "2d6 + 1d4" → {6:2, 4:1}. A subtracted term is not one
 *  of them — `parseSignedDice` is what a caller able to roll a penalty die asks instead. */
export const parseDicePool = (s: string): Record<number, number> => parseSignedDice(s).pool;

/** A signed flat term, the shape `parseFlatModifier` sums. Named because the residue walk in
 *  `parseFormula` has to remove exactly what that sum consumed, or it reports a term twice. */
const SIGNED_NUMBER = /([+\-−])\s*(\d+)/g;

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
	// the dice come out WITH the sign that binds them, so a subtracted die's minus can never be read as
	// a flat term of its own — `-1d4` is one die, not "minus nothing"
	const rest = s.replace(DICE_TERM, ' ');
	let mod = rest === s ? Number(/^\s*(\d+)\b/.exec(rest)?.[1] ?? 0) : 0;
	for (const m of rest.matchAll(SIGNED_NUMBER)) mod += (m[1] === '+' ? 1 : -1) * Number(m[2]);
	return mod;
}

/** A dice term together with the sign that binds it. `DICE_TERM` alone leaves the `+` of `+1d4`
 *  behind, and a dangling operator is precisely what the residue walk treats as unaccounted. */
const SIGNED_DICE_TERM = /[+\-−]?\s*\d*d\d+/gi;

/** Punctuation a formula may carry around its terms — the statblock form's parentheses, the `;`
 *  between damage segments. It separates, it never contributes, so it is not residue. */
const FORMULA_PUNCTUATION = /[(),;.:]/g;

/** A bare word: a damage type, a label, the prose a content string carries beside its dice. A word
 *  can never make a total quietly smaller, which is the whole test for what may be reported. */
const PLAIN_WORD = /^\p{L}[\p{L}\p{M}'’-]*$/u;

/** A formula, fully accounted for: the pool, the flat modifier, and every fragment that is NEITHER.
 *  `parseDicePool` and `parseFlatModifier` each answer for their own half and silently drop the
 *  rest, which is the UBUG-22 failure class one layer up — and `plugins.md` makes the formula string
 *  a plugin's public API, so a sandboxed plugin whose formula half-parsed cannot otherwise tell. */
export interface ParsedFormula {
	dice: Record<number, number>;
	mod: number;
	/** The SUBTRACTED dice terms (`2d6-1d4`), which a pool keyed by sides cannot hold. Empty for every
	 *  shipped content string; a caller that rolls the pool hands these to `rollPool` as `bonusDice`. */
	bonusDice: BonusDie[];
	/** What neither half accounted for, verbatim, in reading order. Empty for every shipped content
	 *  string. A number here is one the roll did NOT include; a `+` is an operator whose operand was
	 *  never found. */
	issues: string[];
}

/**
 * Parse a formula into what it rolls plus what it could not account for. `rollFormula` is sugar over
 * this — call it directly when the formula came from CONTENT or a plugin, where an unaccounted
 * fragment is a data defect that has to be visible outside the moment of the roll.
 *
 * What is deliberately NOT an issue: a bare WORD (a damage type, prose beside the dice) contributes
 * nothing and never could, and a LEADING bare number is accounted for either way — counted when the
 * segment carries no dice ("70"), deliberately ignored when it does, because that is the statblock
 * average form the shipped monsters use ("12 (2d6 + 5)" rolls 2d6+5, never 2d6+17).
 */
export function parseFormula(formula: string): ParsedFormula {
	const residue = formula
		.replace(SIGNED_DICE_TERM, ' ')
		.replace(SIGNED_NUMBER, ' ')
		.replace(/^\s*\d+\b/, ' ');
	const { pool, negative } = parseSignedDice(formula);
	return {
		dice: pool,
		mod: parseFlatModifier(formula),
		bonusDice: negative,
		issues: residue
			.split(/\s+/)
			.map((fragment) => fragment.replace(FORMULA_PUNCTUATION, ''))
			.filter((fragment) => fragment && !PLAIN_WORD.test(fragment)),
	};
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
	dice: RolledDie[];
	d20s: RolledDie[];
}

/**
 * One die rolled under a set of `DieMods`: reroll first, then the bounds, with `detail` spelling out
 * what happened (1↻4, 3→10). `face` is the actual result AFTER a reroll but BEFORE a bound — a
 * nat-1/nat-20 is judged by what the die SHOWS, so Reliable Talent's "treat as 10" does not erase a
 * natural 1, which is why `face` is taken between the two steps and never after.
 *
 * Shared by the pool and by the die `setAdvantage` draws later: a roll's mods belong to the roll, not
 * to the moment it was made.
 */
function rollOneDie(sides: number, mods: DieMods, rng: Rng): RolledDie {
	let v = rollDie(sides, rng);
	let detail = `${v}`;
	if (mods.reroll !== undefined && v <= mods.reroll) {
		v = rollDie(sides, rng);
		detail += `↻${v}`;
	}
	const face = v;
	if (mods.minDie !== undefined && v < mods.minDie) v = mods.minDie;
	if (mods.maxDie !== undefined && v > mods.maxDie) v = mods.maxDie;
	if (v !== face) detail += `→${v}`;
	return { sides, value: v, face, sign: 1, detail, role: DIE_ROLE.pool };
}

/** Roll the main pool (all NdM groups, highest die first). The FIRST d20 is the roll's DECIDING die
 *  and goes to `d20s` rather than to the pool; at advantage or disadvantage a second one is drawn
 *  beside it, and which of the two counts is then a question for `keptD20`, not for this loop.
 *  `rollOne` carries the pool's reroll/min_die effects. */
function rollPoolDice(
	dice: Record<number, number>,
	advantage: number,
	rollOne: (sides: number) => RolledDie,
): PoolResult {
	const rolled: RolledDie[] = [];
	const d20s: RolledDie[] = [];
	for (const [s, c] of Object.entries(dice).sort((a, b) => Number(b[0]) - Number(a[0]))) {
		const sides = Number(s);
		for (let k = 0; k < c; k++) {
			const r = rollOne(sides);
			if (sides === 20 && k === 0) {
				d20s.push(r);
				if (advantage !== 0) d20s.push(rollOne(20));
				continue;
			}
			rolled.push(r);
		}
	}
	return { dice: rolled, d20s };
}

/**
 * The second copy of a die a crit adds. Every die the roll made gets one — RAW is "roll all of the
 * attack's damage dice twice", which is all of them and not just the weapon's, so a Hex d6 on the
 * damage line doubles like anything else. The flat modifier does not, and that is the half of the
 * rule tables get wrong.
 *
 * The twin keeps the original's SIGN and SOURCE — a doubled penalty die is still a penalty, and the
 * provenance is what lets the display put a die and its twin in one divided pill instead of showing
 * two unrelated dice. Its role is what says it was the crit's.
 */
function critTwin(
	die: RolledDie,
	method: CritMethod,
	rollOne: (sides: number) => RolledDie,
	maxDie: number | undefined,
): RolledDie {
	const source = die.source !== undefined ? { source: die.source } : {};
	if (method === CRIT_METHOD.classic)
		return { ...rollOne(die.sides), sign: die.sign, role: DIE_ROLE.crit, ...source };
	// loyal: the added set is taken at its maximum, still under any ceiling the roll carries
	const value = Math.min(die.sides, maxDie ?? die.sides);
	return {
		sides: die.sides,
		value,
		face: die.sides,
		sign: die.sign,
		detail: `${value}`,
		role: DIE_ROLE.crit,
		...source,
	};
}

/** Everything a pool roll can be given besides the dice themselves. One object rather than four
 *  positional arguments, because the middle of `rollPool(d, 0, 0, [], rng)` said nothing about
 *  what those zeros were (§2.8) — and because a `RollEffects` spreads straight into it. */
export interface RollPoolOptions extends RollOptions {
	/** Flat modifier added after the dice. */
	mod?: number;
	/** The same modifier told with its provenance. SUPERSEDES `mod` — a caller gives one or the
	 *  other, never both, so there is exactly one place the number comes from. */
	modParts?: FlatPart[];
	/** −1 disadvantage · 0 normal · +1 advantage. */
	advantage?: number;
	/** Signed effect dice (Bless +1d4 / Bane −1d4). */
	bonusDice?: BonusDie[];
	/** Set → this roll crit: every DIE it rolled gains a twin (`DIE_ROLE.crit`), by the given method.
	 *  The flat modifier is not doubled, which is the rule and also the only part of a crit players
	 *  reliably get wrong. Manual, never inferred from a natural 20: the same 20 is a crit on an
	 *  attack and just a 20 on a check, and a crit happens without one. */
	crit?: CritMethod;
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
	const mod = o.modParts ? flatTotal(o.modParts) : (o.mod ?? 0);
	const advantage = o.advantage ?? 0;
	const bonusDice = o.bonusDice ?? [];
	const rollOne = (sides: number): RolledDie => rollOneDie(sides, o, rng);
	const pool = rollPoolDice(dice, advantage, rollOne);
	// what the pool was rolled UNDER, kept only when there was something to keep: an amendment draws its
	// die later and has no other way to learn the floor it has to honour
	const mods: DieMods = {
		...(o.reroll !== undefined ? { reroll: o.reroll } : {}),
		...(o.minDie !== undefined ? { minDie: o.minDie } : {}),
		...(o.maxDie !== undefined ? { maxDie: o.maxDie } : {}),
	};
	const rolled = pool.dice;
	for (const b of bonusDice)
		for (let k = 0; k < b.count; k++) {
			const v = rollDie(b.sides, rng);
			rolled.push({
				sides: b.sides,
				value: v,
				face: v,
				sign: b.sign < 0 ? -1 : 1,
				detail: `${v}`,
				role: DIE_ROLE.bonus,
				...(b.source !== undefined && b.source !== '' ? { source: b.source } : {}),
			});
		}
	if (o.crit) for (const d of [...rolled]) rolled.push(critTwin(d, o.crit, rollOne, o.maxDie));
	const roll = { dice: rolled, d20s: pool.d20s, advantage: advantageFromSign(advantage), mod };
	return {
		...roll,
		...(o.modParts ? { modParts: o.modParts } : {}),
		...(Object.keys(mods).length ? { mods } : {}),
		total: totalOf(roll),
		expr: formatExpr(roll),
	};
}

/** What a roll comes to: its dice, the one d20 that counts, and the flat modifier. The one place the
 *  sum is defined, so re-reading a roll at a different advantage cannot drift from rolling it there. */
export const totalOf = (roll: Pick<Rolled, 'dice' | 'd20s' | 'advantage' | 'mod'>): number =>
	roll.dice.reduce((n, d) => n + d.sign * d.value, 0) + (keptD20(roll)?.value ?? 0) + roll.mod;

/**
 * Read an `expr` back into dice + the trailing flat modifier. **LEGACY ONLY.** `expr` used to be the
 * single per-die record, so a `log.jsonl` line written before `Rolled.dice` existed carries the dice
 * nowhere else — this is how those lines are still readable, and it is the only reason it survives
 * (docs/internals/roller.md: a formatted string is never the record). Nothing that rolls today
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

/** A roll → the `expr` string. Now a pure RENDERING of the record rather than the record itself;
 *  `role` is what makes it exact, since a positive bonus die writes its `+` and a pool die does not —
 *  the distinction the old chip-based formatter documented that it could not keep.
 *
 *  The d20 it shows is the one that COUNTED, never the pair: a build old enough to read `expr` for
 *  its dice can no longer find the pair beside it (`advantageRoll` is not written any more), so a
 *  string with no d20 in it would render a d20 test with no d20. The dropped die is simply not part
 *  of a rendering that has one slot for the roll. */
function formatExpr(roll: Pick<Rolled, 'dice' | 'd20s' | 'advantage' | 'mod'>): string {
	const kept = keptD20(roll);
	return (
		[...(kept ? [kept] : []), ...roll.dice]
			.map(
				(d) => `${d.sign < 0 ? '−' : d.role === DIE_ROLE.bonus ? '+' : ''}d${d.sides}(${d.detail})`,
			)
			.join(' + ') + (roll.mod ? ` ${formatModifier(roll.mod)}` : '')
	);
}

/** A roll as it may come back off disk: everything a `Rolled` has, except that the parts added since
 *  it was written may be missing, and an old advantage pair may be there instead — which is exactly
 *  what a `log.jsonl` line written by an earlier build looks like. */
export type StoredRoll = Omit<Rolled, 'dice' | 'mod' | 'd20s' | 'advantage'> &
	Partial<Pick<Rolled, 'dice' | 'mod' | 'd20s' | 'advantage'>> & {
		/** pre-2026-08-22 pair */
		advantageRoll?: LegacyAdvantageRoll;
		/** pre-2026-08-22 kept-d20 face, now derived by `naturalOf` */
		natural?: number;
	};

/** A d20 known only as its number → the die it stands for. Its detail is that number: an old pair
 *  recorded only what the d20 came to, and a die drawn to amend a roll has no reroll/floor story of
 *  its own (amending applies no effect facts — see `setAdvantage`). */
const plainD20 = (value: number, face = value): RolledDie => ({
	sides: 20,
	value,
	face,
	sign: 1,
	detail: `${value}`,
	role: DIE_ROLE.pool,
});

/** An old `{kept, dropped, mode?, original?}` pair → the dice in DRAW order + how they were read.
 *  `original` says which came first; without it only the pair is known, which every mode but
 *  `neither` can be answered from exactly (see `Rolled.drawOrderUnknown`). */
function legacyPair(
	adv: LegacyAdvantageRoll,
	natural: number | undefined,
): Pick<Rolled, 'd20s' | 'advantage'> & { drawOrderUnknown?: true } {
	const mode =
		(adv.mode ?? (adv.kept >= adv.dropped ? 1 : -1)) === 1
			? ADVANTAGE_MODE.advantage
			: ADVANTAGE_MODE.disadvantage;
	// the kept die's face is the roll's `natural`; the dropped one only ever had its value
	const kept = plainD20(adv.kept, natural ?? adv.kept);
	const dropped = plainD20(adv.dropped);
	const kptFirst = adv.original === undefined || adv.original === adv.kept;
	return {
		d20s: kptFirst ? [kept, dropped] : [dropped, kept],
		advantage: mode,
		...(adv.original === undefined ? { drawOrderUnknown: true as const } : {}),
	};
}

/**
 * A stored roll → a roll in the shape the roller produces today: per-die record, d20 candidates,
 * advantage as a mode. The ONE legacy seam — every reader of a persisted roll goes through here, so
 * nothing downstream has to know that three shapes ever existed. A roll already in today's shape is
 * returned untouched.
 */
export function rehydrateRoll(roll: StoredRoll): Rolled {
	const { advantageRoll, natural, total, expr } = roll;
	const parsed = roll.dice ? { dice: roll.dice, mod: roll.mod ?? 0 } : parseLegacyExpr(expr);
	const base = {
		total,
		expr,
		...parsed,
		// provenance is the point of recording it — a roll whose "+2" knew it came from Bless must
		// still know after a reload, exactly as its dice do
		...(roll.modParts ? { modParts: roll.modParts } : {}),
		// the floor travels with the roll: a re-read AFTER a reload draws its die the same way the
		// original was drawn, and a row written before this existed simply has none
		...(roll.mods ? { mods: roll.mods } : {}),
		...(roll.drawOrderUnknown ? { drawOrderUnknown: true as const } : {}),
	};
	if (roll.d20s && roll.advantage)
		return { ...base, d20s: roll.d20s, advantage: roll.advantage } satisfies Rolled;
	// a pair was stored apart from the dice; without one, the roll's own first d20 is the candidate
	if (advantageRoll) return { ...base, ...legacyPair(advantageRoll, natural) };
	const index = parsed.dice.findIndex((d) => d.sides === 20 && d.sign > 0);
	const d20 = parsed.dice[index];
	return {
		...base,
		dice: d20 ? parsed.dice.filter((_, k) => k !== index) : parsed.dice,
		d20s: d20 ? [natural === undefined ? d20 : { ...d20, face: natural }] : [],
		advantage: ADVANTAGE_MODE.neither,
	};
}

/**
 * Read a roll that ALREADY happened at a different advantage.
 *
 * RAW-exact rather than a fudge — the rule is "roll a second d20 and take the higher", and rolling it
 * after the first is on the table changes nothing mechanically. It also matches how tables actually
 * play: the DM says "that has advantage" once the die is already down.
 *
 * **Only the FIRST switch away from `neither` draws.** The second die stays on the roll forever after,
 * so every later switch — including back to `neither` and out again — re-reads dice already on the
 * table. That is the property the d20 pill was justified with, and until 2026-08-22 it was false:
 * going back to neutral DELETED the pair, so the next tap drew a fresh second die and a player who
 * kept cycling could keep drawing until they liked the result. The dice must survive a state change.
 *
 * The dice are compared by what they CONTRIBUTE, not by their raw faces. A die floored by `min_die`
 * (Reliable Talent's 3→10) contributed 10, and RAW would floor the new die the same way — so the
 * higher contribution is the right outcome either way, and the roll doesn't have to carry its effect
 * facts for this to be correct.
 *
 * Null when the roll can't take the mode: no d20 decided it, or — for `neither` — the entry is an old
 * pair whose draw order was never recorded, where "the die that stood first" would be a guess.
 */
export function setAdvantage<T extends Rolled>(
	roll: T,
	mode: AdvantageMode,
	rng: Rng = Math.random,
): T | null {
	if (!roll.d20s.length) return null;
	if (mode === roll.advantage) return roll;
	if (mode === ADVANTAGE_MODE.neither && roll.drawOrderUnknown) return null;
	const needsPair = mode !== ADVANTAGE_MODE.neither && roll.d20s.length < 2;
	// floored and rerolled exactly as the roll's own d20 was: RAW treats the second die the same way,
	// and at DISADVANTAGE the unfloored one would WIN — a Reliable Talent rogue's 6 deciding a roll
	// whose floor is 10, or a rerolled natural 1 standing as the roll's natural
	const d20s = needsPair ? [...roll.d20s, rollOneDie(20, roll.mods ?? {}, rng)] : roll.d20s;
	const next = { ...roll, d20s, advantage: mode };
	return {
		...next,
		// the total moves by the swap alone — a delta, not a recount, so a roll rehydrated from a line
		// whose dice no longer add up to its stored total keeps the total it was logged with
		total: roll.total - (keptD20(roll)?.value ?? 0) + (keptD20(next)?.value ?? 0),
		// re-rendered because the d20 it shows is the one that counts, and that just changed
		expr: formatExpr(next),
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
	// an old pair with no recorded draw order can't reach `neither` — it laps back to advantage instead
	return (
		setAdvantage(r, NEXT_ADVANTAGE[r.advantage], rng) ??
		setAdvantage(r, ADVANTAGE_MODE.advantage, rng)
	);
}

/** Roll a dice formula string ("16d12 + 80", "8d6", "2d6+1d4-1"): parse the pool + the flat mod, then
 *  `rollPool`. Rolls EVERY dice group (the old compendium roller only did the first) and counts every
 *  flat term, wherever it sits (UBUG-22 — it used to read only the tail).
 *
 *  Sugar over `parseFormula`, and it DROPS that parse's issues: a site that has somewhere to surface
 *  them calls `parseFormula` itself and rolls the pool it answers with. */
export function rollFormula(formula: string, rng: Rng = Math.random): Rolled {
	const { dice, mod, bonusDice } = parseFormula(formula);
	return rollPool(dice, { mod, rng, ...(bonusDice.length ? { bonusDice } : {}) });
}

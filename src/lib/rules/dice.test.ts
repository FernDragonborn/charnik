import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	rollPool,
	rollFormula,
	parseDicePool,
	parseFlatModifier,
	parseFormula,
	parseDiceTerm,
	DIE_ROLE,
	CRIT_METHOD,
	parseLegacyExpr,
	rehydrateRoll,
	totalOf,
	setAdvantage,
	cycleAdvantage,
	keptD20,
	droppedD20s,
	naturalOf,
	ADVANTAGE_MODE,
	type Rng,
	type Rolled,
} from './dice';
import { parseSignedDice } from './dice';
import { rngSequence } from '../../test-support/rng';

describe('parseDiceTerm', () => {
	it('parses a signed single dice term into a BonusDie', () => {
		expect(parseDiceTerm('1d4')).toEqual({ count: 1, sides: 4, sign: 1 });
		expect(parseDiceTerm('-1d4')).toEqual({ count: 1, sides: 4, sign: -1 });
		expect(parseDiceTerm('2d6')).toEqual({ count: 2, sides: 6, sign: 1 });
	});
	it('returns null for a non-term', () => {
		expect(parseDiceTerm('5')).toBeNull();
		expect(parseDiceTerm('garbage')).toBeNull();
	});
});

describe('parseDicePool', () => {
	it('sums every NdM group', () => {
		expect(parseDicePool('2d6 + 1d4')).toEqual({ 6: 2, 4: 1 });
		expect(parseDicePool('3d8')).toEqual({ 8: 3 });
		expect(parseDicePool('no dice here')).toEqual({});
	});
	it('reads an implicit count of one ("d8" is a die, not nothing)', () => {
		expect(parseDicePool('d8')).toEqual({ 8: 1 });
		expect(parseDicePool('d6 + 2d6')).toEqual({ 6: 3 });
	});
	it('leaves a SUBTRACTED term out — a pool keyed by sides cannot hold its sign', () => {
		expect(parseDicePool('2d6-1d4')).toEqual({ 6: 2 });
		expect(parseSignedDice('2d6-1d4')).toEqual({
			pool: { 6: 2 },
			negative: [{ count: 1, sides: 4, sign: -1 }],
		});
		// the unicode minus `signed()` writes counts the same, and a `+` term is an ordinary pool die
		expect(parseSignedDice('1d8 − 1d4 + 1d6').negative).toEqual([{ count: 1, sides: 4, sign: -1 }]);
	});
});

describe('parseFlatModifier (shared by the roller and the damage-segment parser)', () => {
	it('sums every signed term, wherever it sits', () => {
		expect(parseFlatModifier('1d6+3+1d4')).toBe(3);
		expect(parseFlatModifier('1d8 +3 slashing')).toBe(3);
		expect(parseFlatModifier('2d6-1')).toBe(-1);
		expect(parseFlatModifier('+2+3')).toBe(5);
	});
	it('reads the unicode minus `signed()` writes', () => {
		expect(parseFlatModifier('1d6 −1 bludgeoning')).toBe(-1);
	});
	it('takes an unsigned LEADING value only when the segment has no dice', () => {
		expect(parseFlatModifier('70')).toBe(70); // Heal
		expect(parseFlatModifier('1 bludgeoning')).toBe(1); // a fixed-damage weapon
		expect(parseFlatModifier('1d20 vs AC 15')).toBe(0);
	});
	it('reads the statblock average form as dice + the SIGNED mod only', () => {
		// the shipped monsters carry "12 (2d6 + 5)" — the 12 is the average, not a bonus
		expect(parseFlatModifier('12 (2d6 + 5)')).toBe(5);
		expect(parseFlatModifier('6 (1d12)')).toBe(0);
	});
	it('never mistakes a die count for a modifier', () => {
		expect(parseFlatModifier('1d10')).toBe(0);
		expect(parseFlatModifier('2d6+10d4')).toBe(0);
	});
});

describe('parseFormula (what the parse could not account for)', () => {
	const issues = (formula: string) => parseFormula(formula).issues;

	it('reports a number the roll did not include', () => {
		expect(issues('1d20 vs AC 15')).toEqual(['15']);
		expect(issues('3d6 fire and 2')).toEqual(['2']);
	});
	it('reports an operator whose operand was never found', () => {
		expect(issues('1d6+')).toEqual(['+']);
		expect(issues('+d4?')).toEqual(['?']);
		expect(issues('2d')).toEqual(['2d']);
	});
	it('says nothing about a formula it fully accounts for', () => {
		// every one of these is a shipped content string; the residue walk must be silent on them
		for (const f of ['8d6', '1d6+3+1d4', '2d6+3', '2d6 − 2', '10d6 + 40 force', '1d4 +4'])
			expect(issues(f)).toEqual([]);
	});
	it('says nothing about a WORD, which can never make a total smaller', () => {
		expect(issues('1d10 piercing; 2d6 cold')).toEqual([]);
		expect(issues("1d4 dm's luck")).toEqual([]);
	});
	it('says nothing about a leading bare number, counted or deliberately ignored', () => {
		expect(issues('70')).toEqual([]); // Heal — counted
		expect(issues('1 piercing')).toEqual([]);
		expect(issues('12 (2d6 + 5)')).toEqual([]); // the statblock average — ignored on purpose
	});
	it('answers with the same pool and modifier rollFormula rolls', () => {
		const parsed = parseFormula('2d6+1d4-1');
		expect(parsed.dice).toEqual(parseDicePool('2d6+1d4-1'));
		expect(parsed.mod).toBe(parseFlatModifier('2d6+1d4-1'));
	});
});

describe('rollPool', () => {
	it('rolls a single die', () => {
		// the whole record, pinned: the dice ARE the result, and `expr` is one rendering of them
		expect(rollPool({ 6: 1 }, rngSequence(0.5))).toEqual({
			total: 4,
			mod: 0,
			dice: [{ sides: 6, value: 4, face: 4, sign: 1, detail: '4', role: DIE_ROLE.pool }],
			d20s: [], // no d20 decided this one
			advantage: ADVANTAGE_MODE.neither,
			expr: 'd6(4)',
		});
	});

	it('appends a signed flat modifier', () => {
		expect(rollPool({ 6: 1 }, { rng: rngSequence(0.5), mod: 3 })).toMatchObject({
			total: 7,
			expr: 'd6(4) +3',
		});
		expect(rollPool({ 6: 1 }, { rng: rngSequence(0.5), mod: -2 })).toMatchObject({
			total: 2,
			expr: 'd6(4) −2',
		});
	});

	it('advantage rolls two d20 and keeps the higher, exposing the loser', () => {
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0.1, 0.9), advantage: 1 }); // d20 → 3, then 19
		expect(r.total).toBe(19);
		expect(r.d20s.map((d) => d.value)).toEqual([3, 19]); // draw order
		expect(keptD20(r)?.value).toBe(19);
		expect(r.advantage).toBe(ADVANTAGE_MODE.advantage);
	});

	it('disadvantage keeps the lower', () => {
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0.1, 0.9), advantage: -1 });
		expect(r.total).toBe(3);
		expect(keptD20(r)?.value).toBe(3);
		expect(droppedD20s(r).map((d) => d.value)).toEqual([19]);
	});

	it('adds signed bonus dice (Bless +1d4 / Bane −1d4)', () => {
		const bless = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.5, 0.5), bonusDice: [{ sides: 4, count: 1, sign: 1 }] },
		);
		expect(bless).toMatchObject({ total: 14, expr: 'd20(11) + +d4(3)' });
		const bane = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.5, 0.5), bonusDice: [{ sides: 4, count: 1, sign: -1 }] },
		);
		expect(bane).toMatchObject({ total: 8, expr: 'd20(11) + −d4(3)' });
	});

	it('sorts the pool high-sides first', () => {
		const r = rollPool({ 4: 1, 8: 1 }, rngSequence(0.5, 0.5)); // d8 then d4
		expect(r.expr).toBe('d8(5) + d4(3)');
		expect(r.total).toBe(8);
	});

	it('exposes the natural d20 face (nat-1/nat-20 outcomes)', () => {
		expect(naturalOf(rollPool({ 20: 1 }, { rng: rngSequence(0.999), mod: 5 }))).toBe(20);
		expect(naturalOf(rollPool({ 20: 1 }, { rng: rngSequence(0), mod: 5 }))).toBe(1);
		expect(naturalOf(rollPool({ 6: 1 }, rngSequence(0.5)))).toBeUndefined(); // no d20 in pool
	});
});

describe('rollPool · roll-manipulation (L1 reroll / min_die facts)', () => {
	it('rerolls a die that lands ≤ the threshold, keeping the new result (GWF ≤2)', () => {
		// d6 → 1 (≤2, reroll) → 5; the label shows both faces
		const r = rollPool({ 6: 1 }, { rng: rngSequence(0, 0.7), reroll: 2 });
		expect(r.total).toBe(5);
		expect(r.expr).toBe('d6(1↻5)');
	});

	// the boundary itself: the rule is "≤ the threshold", so a die landing exactly ON it rerolls.
	// Without this the `<=` could be a `<` and nothing would notice (a mutation proved it).
	it('rerolls a die that lands exactly ON the threshold', () => {
		const r = rollPool({ 6: 1 }, { rng: rngSequence(0.2, 0.7), reroll: 2 }); // d6 → 2 (=2) → 5
		expect(r.total).toBe(5);
		expect(r.expr).toBe('d6(2↻5)');
	});

	it('does NOT reroll a die above the threshold', () => {
		const r = rollPool({ 6: 1 }, { rng: rngSequence(0.5), reroll: 2 }); // d6 → 4, kept
		expect(r.total).toBe(4);
		expect(r.expr).toBe('d6(4)');
	});

	it('floors a die below the minimum AS the minimum (Reliable Talent d20 → 10)', () => {
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0.1), minDie: 10, mod: 3 }); // d20 → 3 → 10
		expect(r.total).toBe(13); // 10 + 3 mod
		expect(r.expr).toBe('d20(3→10) +3');
		expect(naturalOf(r)).toBe(3); // the NATURAL face is pre-floor (a nat-1 is still a nat-1)
	});

	it('applies reroll THEN floor in order (Halfling Lucky 1 + a floor)', () => {
		// d20 → 1 (reroll on 1) → 4, then floored to 10
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0, 0.15), reroll: 1, minDie: 10 });
		expect(r.total).toBe(10);
		expect(r.expr).toBe('d20(1↻4→10)');
	});

	it('accepts a bare Rng for the existing callers (back-compat)', () => {
		expect(rollPool({ 6: 1 }, rngSequence(0.5)).total).toBe(4);
	});
});

describe('rollFormula', () => {
	it('rolls EVERY dice group (the old compendium roller only did the first)', () => {
		const r = rollFormula('1d8 + 1d4', rngSequence(0.5, 0.5));
		expect(r.total).toBe(8); // 5 + 3
	});

	it('parses a trailing flat modifier', () => {
		const r = rollFormula('2d6 + 3', rngSequence(0.5, 0.5));
		expect(r.total).toBe(11); // 4 + 4 + 3
	});

	it('handles a monster HP formula', () => {
		const r = rollFormula('16d12 + 80', rngSequence(...Array(16).fill(0.5)));
		expect(r.total).toBe(16 * 7 + 80); // d12 at 0.5 → 7
	});

	// UBUG-22: the modifier used to be read by a TAIL regex, so any +N with dice after it was lost —
	// silently, and reachable from content (a homebrew `heal:1d8+2+1d4`) and from the plugin API.
	it('counts a flat modifier that is not at the end (UBUG-22)', () => {
		// maximal dice: 0.99 on a d6 → 6, on a d4 → 4
		expect(rollFormula('1d6+3+1d4', rngSequence(0.99, 0.99)).total).toBe(13);
	});

	it('counts a signed modifier that comes BEFORE any dice', () => {
		expect(rollFormula('+2 + 1d6', rngSequence(0.99)).total).toBe(8);
	});

	it('rolls a bare-count die and a dice-less flat value', () => {
		expect(rollFormula('d8+2', rngSequence(0.99)).total).toBe(10);
		expect(rollFormula('70').total).toBe(70); // Heal — no dice at all, and no rng drawn
	});

	it('rolls the statblock average form as its dice, not its average', () => {
		expect(rollFormula('12 (2d6 + 5)', rngSequence(0.99, 0.99)).total).toBe(17);
	});

	it('subtracts a negative modifier wherever it sits', () => {
		expect(rollFormula('2d6-1', rngSequence(0.99, 0.99)).total).toBe(11);
		expect(rollFormula('1d6-2+1d4', rngSequence(0.99, 0.99)).total).toBe(8);
	});

	it('SUBTRACTS a subtracted dice term instead of adding it', () => {
		// the tray's own parser always read `-1d4` as a penalty die; the formula path added it, so the
		// same string came to two different numbers — and `issues` reported nothing either way
		expect(rollFormula('2d6-1d4', rngSequence(0.99, 0.99, 0.99)).total).toBe(8); // 12 − 4
		const parsed = parseFormula('2d6-1d4');
		expect(parsed).toEqual({
			dice: { 6: 2 },
			mod: 0,
			bonusDice: [{ count: 1, sides: 4, sign: -1 }],
			issues: [],
		});
	});

	it('never reads a die COUNT as a modifier', () => {
		const r = rollFormula('2d6+10d4', rngSequence(...Array(12).fill(0.99)));
		expect(r.total).toBe(2 * 6 + 10 * 4); // the +10 belongs to d4, not to the total
	});

	it('ignores an unsigned number that is neither leading nor a die (prose, not a bonus)', () => {
		expect(rollFormula('1d20 vs AC 15', rngSequence(0.99)).total).toBe(20);
	});
});

describe('parseLegacyExpr (reading a roll off disk that predates `dice`)', () => {
	it('round-trips a rolled expr into per-die chips + the flat modifier', () => {
		const r = rollPool({ 8: 1, 6: 1 }, { rng: rngSequence(0.5, 0.5), mod: 3 });
		const { dice: chips, mod } = parseLegacyExpr(r.expr); // "d8(5) + d6(4) +3"
		expect(chips.map((c) => [c.sides, c.value, c.sign])).toEqual([
			[8, 5, 1],
			[6, 4, 1],
		]);
		expect(mod).toBe(3);
		expect(chips.reduce((n, c) => n + c.sign * c.value, 0) + mod).toBe(r.total);
	});

	it('takes the FINAL face of a rerolled/floored die and keeps the detail', () => {
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0, 0.15), reroll: 1, minDie: 10 });
		expect(parseLegacyExpr(r.expr).dice).toEqual([
			// value is what it counted for, face is what the die showed before the floor — the string
			// holds both, which is the one thing this reader can still recover exactly
			{ sides: 20, value: 10, face: 4, sign: 1, detail: '1↻4→10', role: DIE_ROLE.pool },
		]);
	});

	it('signs a negative bonus die and reads a negative modifier', () => {
		const r = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.5, 0.5), mod: -2, bonusDice: [{ sides: 4, count: 1, sign: -1 }] },
		);
		const { dice: chips, mod } = parseLegacyExpr(r.expr); // "d20(11) + −d4(3) −2"
		expect(chips.map((c) => c.sign)).toEqual([1, -1]);
		expect(mod).toBe(-2);
		expect(chips.reduce((n, c) => n + c.sign * c.value, 0) + mod).toBe(r.total);
	});

	it('is empty for a marker entry with no expr', () => {
		expect(parseLegacyExpr('')).toEqual({ dice: [], mod: 0 });
	});
});

/*
 * The record is the DICE now, not the string. What matters is that a roll answers with what happened
 * at all, that the string it still emits is a faithful rendering of that, and that a
 * roll read back off disk arrives in the same shape as one just rolled — no caller should ever have
 * to know which of the two it is holding.
 */
describe('Rolled.dice — the record, with `expr` as its rendering', () => {
	it('records every die with what it showed, what it counted for, and what drew it', () => {
		const r = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.1, 0.5), minDie: 10, bonusDice: [{ sides: 4, count: 1, sign: -1 }] },
		);
		// floored: it showed 3, it counted 10 — the two numbers the old string had to encode
		expect(r.d20s).toEqual([
			{ sides: 20, value: 10, face: 3, sign: 1, detail: '3→10', role: DIE_ROLE.pool },
		]);
		expect(r.dice).toEqual([
			{ sides: 4, value: 3, face: 3, sign: -1, detail: '3', role: DIE_ROLE.bonus },
		]);
		expect(r.total).toBe(totalOf(r));
	});

	it('renders a positive bonus die with its sign — the distinction the old formatter lost', () => {
		const r = rollPool(
			{ 20: 1 },
			{ rng: rngSequence(0.5, 0.5), bonusDice: [{ sides: 4, count: 1, sign: 1 }] },
		);
		expect(r.expr).toBe('d20(11) + +d4(3)'); // a pool d4 would read `d4(3)`
		expect(r.dice.map((d) => d.role)).toEqual([DIE_ROLE.bonus]);
	});

	it('leaves a roll that already has its dice exactly as it found it', () => {
		const fresh = rollPool({ 8: 2 }, rngSequence(0.5, 0.5));
		expect(rehydrateRoll(fresh)).toEqual(fresh);
	});

	it('fills the dice of a roll stored before they existed, from the string it did store', () => {
		const stored = rehydrateRoll({ expr: 'd8(5) + d6(4) +3', total: 12 });
		expect(stored.mod).toBe(3);
		expect(stored.dice.map((d) => [d.sides, d.value])).toEqual([
			[8, 5],
			[6, 4],
		]);
	});

	it('keeps the deciding d20 out of the pool, and renders the one that counted', () => {
		const r = rollPool({ 20: 1, 6: 1 }, { rng: rngSequence(0.3, 0.5), mod: 4 });
		expect(r.dice.map((d) => d.sides)).toEqual([6]);
		expect(r.d20s.map((d) => d.value)).toEqual([7]);
		expect(r.expr).toBe('d20(7) + d6(4) +4');
		// and at advantage the string follows the die that now counts, never both
		const adv = setAdvantage(r, ADVANTAGE_MODE.advantage, () => 0.9); // fresh 19
		expect(adv?.expr).toBe('d20(19) + d6(4) +4');
	});
});

describe('parseLegacyExpr · advantage-only pool', () => {
	it('still reads the modifier of an old advantage line, whose d20 lived beside the string', () => {
		// a pre-2026-08-22 advantage roll wrote its pair to `advantageRoll` and left ` +5` behind
		expect(parseLegacyExpr(' +5')).toEqual({ dice: [], mod: 5 });
		const roll = rehydrateRoll({
			expr: ' +5',
			total: 19,
			advantageRoll: { kept: 14, dropped: 7, mode: 1, original: 7 },
		});
		expect(roll.mod).toBe(5);
		expect(roll.d20s.map((d) => d.value)).toEqual([7, 14]); // draw order, from `original`
		expect(keptD20(roll)?.value).toBe(14);
	});
});

/*
 * UX-3 retroactive advantage: a roll that already landed can be READ at a different advantage. The
 * cases that matter are the two outcomes (the new die wins / loses), the shapes that can't take a
 * mode, and — the point of the whole model — that only the first switch ever draws a die.
 */
describe('setAdvantage', () => {
	/** A d20 roll as it comes back off DISK — an entry written before `Rolled` carried its dice, so
	 *  the amend path is exercised against exactly the shape the legacy reader hands it. */
	const rolled = (expr: string, total: number, natural?: number): Rolled =>
		rehydrateRoll({ expr, total, ...(natural !== undefined ? { natural } : {}) });
	const adv = (r: Rolled, rng?: Rng) => setAdvantage(r, ADVANTAGE_MODE.advantage, rng);

	it('keeps the fresh die when it beats the original, and raises the total by the difference', () => {
		const out = adv(rolled('d20(7) +4', 11, 7), () => 0.9); // → 19
		expect(out).not.toBeNull();
		expect(out?.d20s.map((d) => d.value)).toEqual([7, 19]); // in DRAW order, not kept-first
		expect(keptD20(out!)?.value).toBe(19);
		expect(droppedD20s(out!).map((d) => d.value)).toEqual([7]);
		expect(out?.total).toBe(23);
		expect(naturalOf(out!)).toBe(19);
	});

	it('keeps the original when the fresh die loses, and the total does not move', () => {
		const out = adv(rolled('d20(18) +4', 22, 18), () => 0.1); // → 3
		expect(keptD20(out!)?.value).toBe(18);
		expect(droppedD20s(out!).map((d) => d.value)).toEqual([3]);
		expect(out?.total).toBe(22);
		expect(naturalOf(out!)).toBe(18);
	});

	it('takes the deciding d20 out of the pool, so the line can lead with it', () => {
		const out = adv(rolled('d20(7) + d6(3) +4', 14, 7), () => 0.9);
		expect(out?.dice.map((d) => d.sides)).toEqual([6]);
		expect(out?.mod).toBe(4);
	});

	it('compares what the dice CONTRIBUTE, so a min_die floor is not undone', () => {
		// Reliable Talent: a natural 3 was floored to 10 and contributed 10; a fresh 7 must not win
		const out = adv(rolled('d20(3→10) +5', 15, 3), () => 0.31); // → 7
		expect(keptD20(out!)?.value).toBe(10);
		expect(naturalOf(out!)).toBe(3); // and the floor still doesn't erase the natural
		expect(out?.total).toBe(15);
	});

	it('re-reads a pair it already has instead of drawing another die', () => {
		const pair = rollPool({ 20: 1 }, { rng: rngSequence(0.1, 0.9), advantage: 1 });
		// an rng that throws if drawn from: switching mode must not touch it
		const out = setAdvantage(pair, ADVANTAGE_MODE.disadvantage, rngSequence());
		expect(out?.d20s).toEqual(pair.d20s);
		expect(keptD20(out!)?.value).toBe(3);
	});

	it('refuses a roll with no d20 in it (damage)', () => {
		expect(adv(rolled('d8(5) + d6(2) +3', 10))).toBeNull();
	});

	it("draws the second die under the ROLL's own floor, which decides it at disadvantage", () => {
		// Reliable Talent: a natural 3 floored to 10. RAW floors the amendment die too — and at
		// disadvantage an unfloored one WINS, so skipping the floor loses the rule by one tap
		const rogue = rollPool({ 20: 1 }, { rng: rngSequence(0.1), minDie: 10, mod: 11 });
		expect(rogue.mods).toEqual({ minDie: 10 });
		const pair = setAdvantage(rogue, ADVANTAGE_MODE.advantage, rngSequence(0.25)); // → 6 → 10
		expect(pair?.d20s.map((d) => d.value)).toEqual([10, 10]);
		const down = setAdvantage(pair!, ADVANTAGE_MODE.disadvantage);
		expect(keptD20(down!)?.value).toBe(10);
		expect(down?.total).toBe(21);
	});

	it('carries the floor across a reload, so a re-read after one honours it too', () => {
		const rogue = rollPool({ 20: 1 }, { rng: rngSequence(0.1), reroll: 1, minDie: 10 });
		expect(rehydrateRoll(rogue).mods).toEqual({ reroll: 1, minDie: 10 });
	});

	it('records no mods for a roll that carried none', () => {
		expect(rollPool({ 20: 1 }, rngSequence(0.5)).mods).toBeUndefined();
	});

	it('is a no-op for the mode the roll already has', () => {
		const r = rollPool({ 20: 1 }, rngSequence(0.5));
		expect(setAdvantage(r, ADVANTAGE_MODE.neither, rngSequence())).toEqual(r);
	});
});

/*
 * The d20 pill is a three-state control: advantage → disadvantage → neither. Only the FIRST tap
 * draws, so a lap round the cycle can never improve a roll — the property the control was justified
 * with, and the one going back to neutral used to break by forgetting the pair.
 */
describe('cycleAdvantage', () => {
	const plain = (expr: string, total: number): Rolled => rehydrateRoll({ expr, total });

	it('goes advantage → disadvantage → neither, and back to the roll as it landed', () => {
		const start = plain('d20(7) + d6(3) +4', 14);
		const adv = cycleAdvantage(start, () => 0.9); // fresh 19 beats 7
		expect(keptD20(adv!)?.value).toBe(19);
		expect(adv?.advantage).toBe(ADVANTAGE_MODE.advantage);
		expect(adv?.total).toBe(26);

		const dis = cycleAdvantage(adv!);
		expect(keptD20(dis!)?.value).toBe(7);
		expect(dis?.advantage).toBe(ADVANTAGE_MODE.disadvantage);
		expect(dis?.total).toBe(14);

		const none = cycleAdvantage(dis!);
		expect(none?.advantage).toBe(ADVANTAGE_MODE.neither);
		expect(none?.total).toBe(14); // exactly the roll we started from
		expect(none?.dice).toEqual(start.dice);
		expect(none?.expr).toBe(start.expr);
	});

	// the bug this model exists to kill: neutral used to DELETE the second die, so the next tap drew a
	// fresh one and a player could keep lapping until they liked the result
	it('never draws a second time — a full lap keeps the same two dice', () => {
		let r: Rolled | null = plain('d20(7) +4', 11);
		r = cycleAdvantage(r, () => 0.9); // the one draw: 19
		const pair = r!.d20s;
		// every further step gets an rng that throws the moment it is asked for a number
		for (let i = 0; i < 6; i++) {
			r = cycleAdvantage(r!, rngSequence());
			expect(r?.d20s).toEqual(pair);
		}
		expect(r?.advantage).toBe(ADVANTAGE_MODE.advantage); // 7 steps from neither = two full laps
	});

	it('undoes a NATIVE disadvantage back to the die that was rolled first', () => {
		const rolled = rollPool({ 20: 1 }, { rng: rngSequence(0.9, 0.1), mod: 2, advantage: -1 }); // 19 then 3, keeps 3
		expect(keptD20(rolled)?.value).toBe(3);
		const none = setAdvantage(rolled, ADVANTAGE_MODE.neither);
		expect(none?.total).toBe(21); // 19 + 2 — the die that stood before the second one
	});

	it('an old entry with no recorded draw order laps back to advantage instead of guessing', () => {
		// the pair is known, the order is not — so "the die that stood first" cannot be answered, and
		// a total built on a guess is worse than a mode that doesn't offer neutral
		const legacy = rehydrateRoll({
			expr: '+4',
			total: 7,
			advantageRoll: { kept: 3, dropped: 18, mode: -1 },
		});
		expect(legacy.drawOrderUnknown).toBe(true);
		expect(setAdvantage(legacy, ADVANTAGE_MODE.neither)).toBeNull();
		expect(cycleAdvantage(legacy)?.advantage).toBe(ADVANTAGE_MODE.advantage);
		expect(keptD20(cycleAdvantage(legacy)!)?.value).toBe(18);
	});
});

describe('rollPool · a ceiling, the mirror of the floor', () => {
	it('caps a die above the maximum AS the maximum, leaving its natural face alone', () => {
		const r = rollPool({ 20: 1 }, { rng: rngSequence(0.999), maxDie: 10, mod: 2 }); // d20 → 20 → 10
		expect(r.total).toBe(12);
		expect(r.expr).toBe('d20(20→10) +2');
		expect(naturalOf(r)).toBe(20);
	});

	it('leaves a die already under the ceiling untouched', () => {
		expect(rollPool({ 20: 1 }, { rng: rngSequence(0.1), maxDie: 10 }).expr).toBe('d20(3)');
	});
});

describe('rollPool · crits', () => {
	it('classic rolls every die a second time and adds it, leaving the modifier alone', () => {
		// 2d6 → 4, 4; the crit set → 2, 6. Modifier +3 is NOT doubled.
		const r = rollPool(
			{ 6: 2 },
			{ rng: rngSequence(0.5, 0.5, 0.2, 0.9), mod: 3, crit: CRIT_METHOD.classic },
		);
		expect(r.dice).toHaveLength(4);
		expect(r.dice.filter((d) => d.role === DIE_ROLE.crit)).toHaveLength(2);
		expect(r.total).toBe(4 + 4 + 2 + 6 + 3);
	});

	it('loyal adds one set at its maximum and draws nothing for it', () => {
		// one draw only: the rolled set. Over-drawing would throw.
		const r = rollPool({ 8: 1 }, { rng: rngSequence(0.5), mod: 4, crit: CRIT_METHOD.loyal });
		expect(r.total).toBe(5 + 8 + 4);
		expect(r.dice.map((d) => d.value)).toEqual([5, 8]);
	});

	it('doubles an effect die too — RAW doubles ALL the damage dice, not just the weapon’s', () => {
		const r = rollPool(
			{ 6: 1 },
			{
				rng: rngSequence(0.5, 0.5),
				bonusDice: [{ sides: 6, count: 1, sign: 1 }],
				crit: CRIT_METHOD.loyal,
			},
		);
		expect(r.dice).toHaveLength(4);
		expect(r.total).toBe(4 + 4 + 6 + 6);
	});

	it('keeps the sign of a die it doubles — a doubled penalty is still a penalty', () => {
		const r = rollPool(
			{},
			{
				rng: rngSequence(0.5),
				bonusDice: [{ sides: 4, count: 1, sign: -1 }],
				crit: CRIT_METHOD.loyal,
			},
		);
		expect(r.total).toBe(-3 - 4);
	});

	it('rolls exactly as before when no crit is asked for', () => {
		expect(rollPool({ 6: 1 }, rngSequence(0.5)).dice).toHaveLength(1);
	});
});

/*
 * Properties, not examples — the roller had none, and that was the gap
 * that let the advantage re-roll leak live so long. These four pin what must be true of EVERY roll,
 * whatever it drew, and they are the ones the design argued from rather than a coverage exercise.
 */
describe('rollPool · properties', () => {
	/** A pool of 1–4 groups over the real die sizes, so a property covers shapes an example can't. */
	const pool = fc
		.array(fc.tuple(fc.constantFrom(4, 6, 8, 10, 12, 20), fc.integer({ min: 1, max: 4 })), {
			minLength: 1,
			maxLength: 4,
		})
		.map((pairs) => Object.fromEntries(pairs) as Record<number, number>);
	const mod = fc.integer({ min: -10, max: 10 });
	/** A finite, deterministic rng — the roll is a pure function of it. */
	const seed = fc.array(fc.double({ min: 0, max: 0.999, noNaN: true }), { minLength: 300 });
	const cycled = (r: Rolled) => r.d20s.map((d) => d.value).sort((a, b) => a - b);

	it('a total is its dice plus the one d20 that counts plus the modifier — nothing else', () => {
		fc.assert(
			fc.property(pool, mod, seed, (dice, m, values) => {
				const r = rollPool(dice, { mod: m, rng: rngSequence(...values) });
				const fromDice = r.dice.reduce((n, d) => n + d.sign * d.value, 0);
				expect(r.total).toBe(fromDice + (keptD20(r)?.value ?? 0) + m);
			}),
		);
	});

	it('cycling the advantage state never changes the dice that were drawn', () => {
		fc.assert(
			fc.property(mod, seed, (m, values) => {
				const rng = rngSequence(...values);
				const first = rollPool({ 20: 1, 6: 2 }, { mod: m, rng });
				let r = first;
				const seen: number[][] = [];
				// three laps: only the FIRST switch away from neither may draw, ever
				for (let i = 0; i < 9; i++) {
					r = cycleAdvantage(r, rng) ?? r;
					seen.push(cycled(r));
					expect(r.dice).toEqual(first.dice);
				}
				expect(new Set(seen.map((s) => s.join(','))).size).toBe(1);
			}),
		);
	});

	it('the d20 that counts is never worse than the one that did not', () => {
		fc.assert(
			fc.property(seed, (values) => {
				const rng = rngSequence(...values);
				const advantaged = setAdvantage(
					rollPool({ 20: 1 }, { rng }),
					ADVANTAGE_MODE.advantage,
					rng,
				);
				if (!advantaged) return;
				const kept = keptD20(advantaged)?.value ?? 0;
				for (const dropped of droppedD20s(advantaged))
					expect(kept).toBeGreaterThanOrEqual(dropped.value);
			}),
		);
	});

	it('a full lap of the cycle returns the roll exactly as it landed', () => {
		fc.assert(
			fc.property(mod, seed, (m, values) => {
				const rng = rngSequence(...values);
				const landed = rollPool({ 20: 1, 8: 1 }, { mod: m, rng });
				const lap = cycleAdvantage(
					cycleAdvantage(cycleAdvantage(landed, rng) ?? landed, rng) ?? landed,
					rng,
				);
				expect(lap?.advantage).toBe(ADVANTAGE_MODE.neither);
				expect(lap?.total).toBe(landed.total);
				expect(lap?.expr).toBe(landed.expr);
			}),
		);
	});
});

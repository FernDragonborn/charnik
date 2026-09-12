import { describe, it, expect } from 'vitest';
import {
	PILL_KIND,
	ROLLER_ROLE,
	TOKEN_KIND,
	addToken,
	canRoll,
	damageParts,
	emptyLine,
	normalizeLine,
	parseRollerToken,
	rollerIssues,
	rollerNotes,
	testRoll,
	volleyOf,
	type ParsedRollerToken,
	type RollerLine,
	type RollerPill,
	type RollerResolver,
} from './roller';
import { ADVANTAGE_MODE, rollPool } from '$lib/rules/dice';

/* A stand-in vocabulary: one effect (a signed die with provenance) and one damage type. The real one
   reads the content graph and every locale's names; the LINE only ever sees this shape. */
const pill = (p: RollerPill): ParsedRollerToken => ({ kind: TOKEN_KIND.pill, pill: p });
const resolve: RollerResolver = (word) => {
	const w = word.toLowerCase();
	if (w === 'bless' || w === 'благословення')
		return pill({ kind: PILL_KIND.dice, text: word, count: 1, sides: 4, sign: 1, source: 'Bless' });
	if (w === 'bane')
		return pill({ kind: PILL_KIND.dice, text: word, count: 1, sides: 4, sign: -1, source: 'Bane' });
	if (w === 'fire' || w === 'вогонь')
		return pill({ kind: PILL_KIND.damageType, text: word, type: 'fire' });
	if (w === 'cold') return pill({ kind: PILL_KIND.damageType, text: word, type: 'cold' });
	if (w === 'trickster') return { kind: TOKEN_KIND.advantage, mode: ADVANTAGE_MODE.advantage };
	return null;
};

/** Build a line by typing tokens into it, which is the only way the app ever builds one. */
const type = (
	role: (typeof ROLLER_ROLE)[keyof typeof ROLLER_ROLE],
	...tokens: string[]
): RollerLine => tokens.reduce((line, t) => addToken(line, t, resolve), emptyLine(role));

describe('parseRollerToken', () => {
	it('reads dice with and without an explicit count, and keeps the sign', () => {
		expect(parseRollerToken('2d6', resolve)).toMatchObject({
			kind: TOKEN_KIND.pill,
			pill: { kind: PILL_KIND.dice, count: 2, sides: 6, sign: 1 },
		});
		expect(parseRollerToken('d20', resolve)).toMatchObject({
			pill: { kind: PILL_KIND.dice, count: 1, sides: 20 },
		});
		expect(parseRollerToken('-1d4', resolve)).toMatchObject({ pill: { sign: -1 } });
		expect(parseRollerToken('−1d4', resolve)).toMatchObject({ pill: { sign: -1 } });
	});

	it('takes a flat modifier signed or bare', () => {
		expect(parseRollerToken('+3', resolve)).toMatchObject({
			pill: { kind: PILL_KIND.flat, amount: 3 },
		});
		expect(parseRollerToken('3', resolve)).toMatchObject({ pill: { amount: 3 } });
		expect(parseRollerToken('−2', resolve)).toMatchObject({ pill: { amount: -2 } });
	});

	it('accepts both spellings of a bound, in both directions', () => {
		expect(parseRollerToken('>10', resolve)).toEqual({ kind: TOKEN_KIND.bound, min: 10 });
		expect(parseRollerToken('>=10', resolve)).toEqual({ kind: TOKEN_KIND.bound, min: 10 });
		expect(parseRollerToken('<5', resolve)).toEqual({ kind: TOKEN_KIND.bound, max: 5 });
		expect(parseRollerToken('<=5', resolve)).toEqual({ kind: TOKEN_KIND.bound, max: 5 });
	});

	it('reads adv / dis as how the line is READ, not as a pill', () => {
		expect(parseRollerToken('adv', resolve)).toEqual({
			kind: TOKEN_KIND.advantage,
			mode: ADVANTAGE_MODE.advantage,
		});
		expect(parseRollerToken('DIS', resolve)).toEqual({
			kind: TOKEN_KIND.advantage,
			mode: ADVANTAGE_MODE.disadvantage,
		});
	});

	it('takes a mode back OFF a line with neut', () => {
		expect(type(ROLLER_ROLE.test, 'd20', 'adv', 'neut').advantage).toBe(ADVANTAGE_MODE.neither);
	});

	it('resolves a name in ANY language the vocabulary knows, to the same pill', () => {
		expect(parseRollerToken('благословення', resolve)).toMatchObject({
			pill: { sides: 4, source: 'Bless' },
		});
		expect(parseRollerToken('вогонь', resolve)).toMatchObject({ pill: { type: 'fire' } });
	});

	it('lets a source whose whole mechanic is advantage set how the line is READ', () => {
		expect(type(ROLLER_ROLE.test, 'd20', 'trickster').advantage).toBe(ADVANTAGE_MODE.advantage);
	});

	it('keeps what it could not account for as raw text rather than dropping it', () => {
		expect(parseRollerToken('+d4?', resolve)).toEqual({
			kind: TOKEN_KIND.pill,
			pill: { kind: PILL_KIND.raw, text: '+d4?' },
		});
		expect(parseRollerToken('   ', resolve)).toBeNull();
	});
});

describe('a compound token typed without spaces', () => {
	it('splits into its signed terms and rolls', () => {
		const line = type(ROLLER_ROLE.damage, '2d6+3');
		expect(line.pills).toHaveLength(2);
		expect(line.pills[0]).toMatchObject({ kind: PILL_KIND.dice, count: 2, sides: 6, sign: 1 });
		expect(line.pills[1]).toMatchObject({ kind: PILL_KIND.flat, amount: 3 });
		expect(canRoll([line])).toBe(true);
	});

	it('takes a leading sign and several dice terms', () => {
		const line = type(ROLLER_ROLE.damage, '-2d4+1d6-1');
		expect(line.pills.map((p) => p.text)).toEqual(['-2d4', '+1d6', '-1']);
	});

	it('stays ONE raw fragment when a term means nothing — the roll still blocks', () => {
		const line = type(ROLLER_ROLE.test, '1d6+d4?');
		expect(line.pills).toEqual([{ kind: PILL_KIND.raw, text: '1d6+d4?' }]);
		expect(canRoll([line])).toBe(false);
	});

	it('does not cut a hyphenated label in half', () => {
		const line = type(ROLLER_ROLE.test, 'd20', "dm's-luck");
		expect(line.pills[1]).toMatchObject({ kind: PILL_KIND.note, text: "dm's-luck" });
	});
});

describe('bounds belong to a die', () => {
	it('lands on the last die in the line', () => {
		const line = type(ROLLER_ROLE.test, 'd20', '>10');
		expect(line.pills).toHaveLength(1);
		expect(line.pills[0]).toMatchObject({ kind: PILL_KIND.dice, sides: 20, min: 10 });
	});

	it('folds into the roll as a die mod', () => {
		expect(testRoll(type(ROLLER_ROLE.test, 'd20', '>10', '+7')).mods).toEqual({ minDie: 10 });
		expect(testRoll(type(ROLLER_ROLE.test, 'd20', '<15')).mods).toEqual({ maxDie: 15 });
	});

	it('stays raw when there is no die to bound — a floor over nothing is not a fact', () => {
		const line = type(ROLLER_ROLE.test, '>10');
		expect(line.pills[0]).toEqual({ kind: PILL_KIND.raw, text: '>10' });
	});
});

describe('the test line', () => {
	it('sends a sourced or negative die to the bonus dice and the rest to the pool', () => {
		const roll = testRoll(type(ROLLER_ROLE.test, 'd20', 'bless', 'bane', '+7'));
		expect(roll.dice).toEqual({ 20: 1 });
		expect(roll.mod).toBe(7);
		expect(roll.bonusDice).toEqual([
			{ sides: 4, count: 1, sign: 1, source: 'Bless' },
			{ sides: 4, count: 1, sign: -1, source: 'Bane' },
		]);
	});

	it('keeps a die and a modifier provenance instead of flattening it into the pool', () => {
		const roll = testRoll(type(ROLLER_ROLE.test, 'd20', 'bless', '+7'));
		// a die the player typed has no source, and the fold does not invent one for it
		expect(testRoll(type(ROLLER_ROLE.test, 'd20', '1d4')).bonusDice).toEqual([]);
		expect(roll.modParts).toBeUndefined();
		const rolled = rollPool(roll.dice, {
			bonusDice: roll.bonusDice,
			mod: roll.mod,
			rng: () => 0.5,
		});
		expect(rolled.dice.map((d) => d.source)).toEqual(['Bless']);
	});

	it('records what a NAMED modifier was made of, and nothing when nothing is named', () => {
		const line: RollerLine = {
			...emptyLine(ROLLER_ROLE.test),
			pills: [
				{ kind: PILL_KIND.flat, text: '+2', amount: 2, source: 'Bless' },
				{ kind: PILL_KIND.flat, text: '+3', amount: 3 },
			],
		};
		expect(testRoll(line).mod).toBe(5);
		expect(testRoll(line).modParts).toEqual([{ amount: 2, source: 'Bless' }, { amount: 3 }]);
	});

	it('takes the label a player wrote beside a die to the roll instead of dropping it', () => {
		expect(rollerNotes([type(ROLLER_ROLE.test, 'd20', "dm's-luck")])).toEqual(["dm's-luck"]);
		expect(rollerNotes([type(ROLLER_ROLE.test, 'd20')])).toEqual([]);
	});

	it('counts a modifier wherever it sits, not only at the end', () => {
		expect(testRoll(type(ROLLER_ROLE.test, 'd20', '+3', '2d6', '+1')).mod).toBe(4);
	});

	it('turns its own advantage toggle into the roller ±1', () => {
		const line = type(ROLLER_ROLE.test, 'd20', 'adv');
		expect(line.advantage).toBe(ADVANTAGE_MODE.advantage);
		expect(testRoll(line).advantage).toBe(1);
		expect(testRoll(type(ROLLER_ROLE.test, 'd20', 'dis')).advantage).toBe(-1);
		expect(testRoll(type(ROLLER_ROLE.test, 'd20')).advantage).toBe(0);
	});

	it('reads a volley as a count of the SAME set, not as more lines', () => {
		expect(volleyOf(type(ROLLER_ROLE.test, 'd20', '×3'))).toBe(3);
		expect(volleyOf(type(ROLLER_ROLE.test, 'd20', 'x2'))).toBe(2);
		expect(volleyOf(type(ROLLER_ROLE.test, 'd20'))).toBe(1);
	});
});

describe('damage types', () => {
	it('gives the untyped tail the type on its left, as a pill of its own', () => {
		const line = type(ROLLER_ROLE.damage, '2d6', '+3', 'fire', '1d8');
		const last = line.pills[line.pills.length - 1];
		expect(last).toMatchObject({ kind: PILL_KIND.damageType, type: 'fire', inherited: true });
	});

	it('drops the inherited pill the moment another type is named', () => {
		const line = type(ROLLER_ROLE.damage, '2d6', 'fire', '1d8', 'cold');
		expect(line.pills.filter((p) => p.kind === PILL_KIND.damageType)).toHaveLength(2);
		expect(line.pills.some((p) => p.kind === PILL_KIND.damageType && p.inherited)).toBe(false);
	});

	it('never inherits when there is nothing on the left to inherit from', () => {
		const line = type(ROLLER_ROLE.damage, '2d6', '+3');
		expect(line.pills.some((p) => p.kind === PILL_KIND.damageType)).toBe(false);
	});

	it('takes both orders, because the book writes one and the CSV the other', () => {
		expect(damageParts(type(ROLLER_ROLE.damage, '8d6', 'fire'))[0]).toMatchObject({
			dice: { 6: 8 },
			type: 'fire',
		});
		expect(damageParts(type(ROLLER_ROLE.damage, 'fire', '8d6'))).toMatchObject([
			{ dice: { 6: 8 }, type: 'fire' },
		]);
	});

	it('gives everything left of a type to that type, one part each', () => {
		const parts = damageParts(type(ROLLER_ROLE.damage, '1d6', 'cold', '2d6', '+3', 'fire'));
		expect(parts).toMatchObject([
			{ dice: { 6: 1 }, mod: 0, type: 'cold' },
			{ dice: { 6: 2 }, mod: 3, type: 'fire' },
		]);
	});

	it('rolls an untyped part rather than refusing — the number is not in doubt', () => {
		const line = type(ROLLER_ROLE.damage, '2d6');
		expect(damageParts(line)).toMatchObject([{ dice: { 6: 2 }, type: '' }]);
		expect(canRoll([line])).toBe(true);
		expect(rollerIssues([line])).toEqual([{ key: 'roller.issue.untypedDamage', blocking: false }]);
	});
});

describe('a word the vocabulary does not know', () => {
	it('is a homebrew damage TYPE on a damage line — content invents types freely', () => {
		const line = type(ROLLER_ROLE.damage, '2d6', 'ichor');
		expect(line.pills[1]).toMatchObject({ kind: PILL_KIND.damageType, type: 'ichor' });
		expect(damageParts(line)).toMatchObject([{ dice: { 6: 2 }, type: 'ichor' }]);
		expect(canRoll([line])).toBe(true);
	});

	it('is a label the player wrote anywhere else, and blocks nothing', () => {
		const line = type(ROLLER_ROLE.test, '1d4', 'dm’s luck');
		expect(line.pills[1]).toMatchObject({ kind: PILL_KIND.note, text: 'dm’s luck' });
		expect(canRoll([line])).toBe(true);
		expect(rollerIssues([line])).toEqual([]);
	});

	it('still blocks when it looks like arithmetic and is not — that is the whole test', () => {
		expect(canRoll([type(ROLLER_ROLE.test, 'd20', '+d4?')])).toBe(false);
		expect(canRoll([type(ROLLER_ROLE.test, 'd20', '3d')])).toBe(false);
	});
});

describe('a mode is a fact about d20s', () => {
	it('is not set by typing the word on a damage line — the menu withholds the row there', () => {
		const line = type(ROLLER_ROLE.damage, '2d6', 'adv');
		expect(line.advantage).toBe(ADVANTAGE_MODE.neither);
		// the word falls through to what any other word is on a damage line: its type
		expect(line.pills[1]).toMatchObject({ kind: PILL_KIND.damageType, type: 'adv' });
	});

	it('is set on a test line, by the word and by a named effect alike', () => {
		expect(type(ROLLER_ROLE.test, 'd20', 'adv').advantage).toBe(ADVANTAGE_MODE.advantage);
		expect(type(ROLLER_ROLE.test, 'd20', 'trickster').advantage).toBe(ADVANTAGE_MODE.advantage);
	});
});

describe('issues', () => {
	it('blocks the roll on a fragment it could not account for', () => {
		const line = type(ROLLER_ROLE.damage, '1d8', '+2', '+d4?', 'fire');
		expect(canRoll([line])).toBe(false);
		expect(rollerIssues([line])[0]).toMatchObject({ blocking: true });
	});

	it('blocks on a name the vocabulary knows TWICE, even on a damage line', () => {
		// the resolver answers with an ambiguous raw pill; a plain unknown word would become a damage
		// type here, which is how an ambiguous Bless typed the damage and dropped its +1d4
		const ambiguous: RollerResolver = () =>
			pill({ kind: PILL_KIND.raw, text: 'ray', ambiguous: true });
		const line = addToken(emptyLine(ROLLER_ROLE.damage), 'ray', ambiguous);
		expect(line.pills[0]).toMatchObject({ kind: PILL_KIND.raw, ambiguous: true });
		expect(rollerIssues([line])[0]).toMatchObject({
			key: 'roller.issue.ambiguous',
			blocking: true,
		});
	});

	it('has nothing to roll when the lines carry no value at all', () => {
		expect(canRoll([emptyLine(ROLLER_ROLE.test)])).toBe(false);
		expect(canRoll([type(ROLLER_ROLE.test, 'adv')])).toBe(false);
	});
});

describe('normalizeLine', () => {
	it('is idempotent — running it again neither adds nor drops an inherited pill', () => {
		const once = type(ROLLER_ROLE.damage, '2d6', 'fire', '1d8');
		expect(normalizeLine(once)).toEqual(once);
	});
});

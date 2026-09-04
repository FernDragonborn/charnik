import { describe, it, expect, beforeEach } from 'vitest';
import { RollerOrgan } from './roller.svelte';
import { rollerCandidates, type NamedRollSource } from './roller-vocabulary';
import { ROLLER_ROLE, damageParts, testRoll, type RollerLine } from './roller';
import { ADVANTAGE_MODE, CRIT_METHOD, DIE_ROLE, type Rng } from '$lib/rules/dice';
import { app } from '$lib/stores/app.svelte';

const SOURCES: NamedRollSource[] = [
	{
		key: 'bless',
		names: { en: 'Bless', uk: 'Благословення' },
		tokens: ['flat_bonus:attack+1d4'],
		active: true,
	},
	{ key: 'blur', names: { en: 'Blur' }, tokens: ['flat_bonus:ac+2'], active: false },
	{ key: 'fire', names: { en: 'fire' }, tokens: [], active: false, damageType: true },
	{ key: 'cold', names: { en: 'cold' }, tokens: [], active: false, damageType: true },
];

/** Every value the same, so a total is arithmetic rather than a guess: 0.5 → d6 4, d8 5, d20 11. */
const half: Rng = () => 0.5;

let organ: RollerOrgan;
beforeEach(() => {
	organ = new RollerOrgan();
	organ.candidates = rollerCandidates(SOURCES, 'en');
	// the organ reads the crit method off the app setting, so a test that changes it must not leak
	app.critMethod = CRIT_METHOD.classic;
});

/** Type a whole string into a line the way a person does — the trailing space is what parses. */
const typeInto = (index: number, text: string) => organ.type(index, text);

describe('typing', () => {
	it('parses a token on the space after it and leaves the tail as text', () => {
		typeInto(0, 'd20 +7 bl');
		expect(organ.lines[0]?.pills).toHaveLength(2);
		expect(organ.draft).toBe('bl');
	});

	it('opens the menu on a letter, and not over dice in progress', () => {
		typeInto(0, '2d');
		expect(organ.menu).toEqual([]);
		typeInto(0, 'bl');
		expect(organ.menu[0]?.candidate.key).toBe('bless');
	});

	it('previews what completing would insert, before Tab is pressed', () => {
		typeInto(0, 'bl');
		expect(organ.ghost).toBe('ess → +1d4');
	});

	it('takes the highlighted row on commit, with the provenance the menu promised', () => {
		typeInto(0, 'bl');
		organ.commit(0);
		expect(organ.lines[0]?.pills[0]).toMatchObject({ sides: 4, source: 'Bless' });
		expect(organ.draft).toBe('');
	});

	it('Esc closes the menu and leaves the text — the roll is not blocked by it', () => {
		typeInto(0, 'bl');
		organ.dismissMenu();
		expect(organ.menu).toEqual([]);
		typeInto(0, 'ble');
		expect(organ.menu.length).toBeGreaterThan(0);
	});

	it('↓ steps PAST the row that already looked selected', () => {
		typeInto(0, 'bl');
		expect(organ.menu).toHaveLength(2);
		// the top row is highlighted from the start — it is what the ghost previews
		expect(organ.highlight).toBe(0);
		organ.selectDown();
		expect(organ.highlight).toBe(1);
	});

	it('← / → cross a column of a multi-column menu, clamped at both ends', () => {
		typeInto(0, 'bl');
		organ.selectAcross(1);
		expect(organ.highlight).toBe(1);
		organ.selectAcross(1);
		expect(organ.highlight).toBe(1);
		organ.selectAcross(-1);
		expect(organ.highlight).toBe(0);
		organ.selectAcross(-1);
		expect(organ.highlight).toBe(0);
	});

	it('moves the caret into the menu and back out of its top', () => {
		// one match, so the row ↓ enters on IS the top row and ↑ leaves from it
		typeInto(0, 'bles');
		expect(organ.inMenu).toBe(false);
		organ.selectDown();
		expect(organ.inMenu).toBe(true);
		organ.selectUp();
		expect(organ.inMenu).toBe(false);
	});
});

describe('a compound token leaves the caret past ALL of itself', () => {
	it('keeps a modifier with the damage type it was typed for', () => {
		organ.addDamageLine();
		// "2d6+3 fire 1d6 cold" — the +3 belongs to the fire, the way it was written
		typeInto(1, '2d6+3 fire 1d6 cold ');
		expect(damageParts(organ.lines[1]!)).toMatchObject([
			{ dice: { 6: 2 }, mod: 3, type: 'fire' },
			{ dice: { 6: 1 }, mod: 0, type: 'cold' },
		]);
	});
});

describe('editing pills', () => {
	it('unfolds the last pill back into the exact text it was made from', () => {
		typeInto(0, 'd20 bless ');
		organ.caretLeft(0);
		expect(organ.draft).toBe('Bless');
		expect(organ.lines[0]?.pills).toHaveLength(1);
	});

	it('walks left token by token, folding each one back as it goes', () => {
		typeInto(0, 'd20 +7 bless ');
		organ.caretLeft(0);
		expect(organ.draft).toBe('Bless');
		// the second step re-folds Bless where it stood and opens the token before it
		organ.caretLeft(0);
		expect(organ.draft).toBe('+7');
		expect(organ.lines[0]?.pills.map((p) => p.text)).toEqual(['d20', 'Bless']);
		// typing now inserts AT the caret, not at the end of the line
		typeInto(0, '+2 ');
		expect(organ.lines[0]?.pills.map((p) => p.text)).toEqual(['d20', '+2', 'Bless']);
	});

	it('walks back out to the right', () => {
		typeInto(0, 'd20 +7 ');
		organ.caretLeft(0);
		organ.caretLeft(0);
		expect(organ.draft).toBe('d20');
		organ.caretRight(0);
		expect(organ.draft).toBe('+7');
		expect(organ.lines[0]?.pills.map((p) => p.text)).toEqual(['d20']);
	});

	it('steps over an inherited type instead of getting stuck on it', () => {
		organ.addDamageLine();
		typeInto(1, '2d6 fire 1d8 ');
		// [2d6][fire][1d8][fire·inherited] — the inherited pill is derived, so Backspace must reach 1d8
		expect(organ.lines[1]?.pills).toHaveLength(4);
		organ.caretLeft(1);
		expect(organ.draft).toBe('1d8');
	});

	it('nudges a dice pill up and off, and deletes it at zero', () => {
		typeInto(0, '2d6 ');
		organ.bumpPill(0, 0, 1);
		expect(organ.lines[0]?.pills[0]).toMatchObject({ count: 3, text: '3d6' });
		organ.bumpPill(0, 0, -2);
		expect(organ.lines[0]?.pills[0]).toMatchObject({ count: 1 });
		organ.bumpPill(0, 0, -1);
		expect(organ.lines[0]?.pills).toHaveLength(0);
	});

	it('moves a pill from one line to the other, re-deriving both', () => {
		organ.addDamageLine();
		typeInto(0, 'd20 2d6 ');
		organ.movePill(0, 1, 1);
		expect(organ.lines[0]?.pills).toHaveLength(1);
		expect(organ.lines[1]?.pills[0]).toMatchObject({ sides: 6 });
	});

	it('lands a header die in the line the caret is in', () => {
		organ.addDamageLine();
		organ.focus = 1;
		organ.addDie(8);
		expect(organ.lines[0]?.pills).toHaveLength(0);
		expect(organ.lines[1]?.pills[0]).toMatchObject({ sides: 8 });
	});
});

describe('rolling', () => {
	it('commits a half-typed token first, so pressing Roll never drops it', () => {
		typeInto(0, 'd20 +7');
		const [entry] = organ.roll(half);
		expect(entry?.total).toBe(11 + 7);
	});

	it('rolls damage as its own line, one part per type', () => {
		typeInto(0, 'd20 +5 ');
		organ.addDamageLine();
		typeInto(1, '1d8 +3 fire 1d6 cold ');
		const [entry] = organ.roll(half);
		expect(entry?.damage?.map((d) => d.type)).toEqual(['fire', 'cold']);
		expect(entry?.damage?.[0]?.total).toBe(5 + 3);
	});

	it('rolls damage with no test at all — Fireball: the target saves, not you', () => {
		organ.lines = [
			{ role: ROLLER_ROLE.damage, pills: [], advantage: ADVANTAGE_MODE.neither, crit: false },
		];
		organ.drafts = [''];
		typeInto(0, '8d6 fire ');
		const [entry] = organ.roll(half);
		expect(entry?.d20s).toEqual([]);
		expect(entry?.damage?.[0]?.total).toBe(8 * 4);
	});

	it('doubles the dice of a crit line and leaves its modifier alone', () => {
		organ.addDamageLine();
		typeInto(1, '1d8 +3 ');
		organ.toggleCrit(1);
		// the crit METHOD is a table setting, not a per-roll switch — the organ reads it from there
		app.critMethod = CRIT_METHOD.loyal;
		const [entry] = organ.roll(half);
		expect(entry?.damage?.[0]?.total).toBe(5 + 8 + 3);
		expect(entry?.damage?.[0]?.dice.filter((d) => d.role === DIE_ROLE.crit)).toHaveLength(1);
	});

	it('fires a volley as N instances of the same set, each its own record', () => {
		typeInto(0, 'd20 +5 ×3 ');
		const entries = organ.roll(half);
		expect(entries).toHaveLength(3);
		// each carries its own timestamp: an amendment rewrites ITS line, not a sibling's
		expect(new Set(entries.map((e) => e.at)).size).toBe(3);
	});

	it('reads a volley count off whichever line carries it, test or damage', () => {
		organ.lines = [
			{ role: ROLLER_ROLE.damage, pills: [], advantage: ADVANTAGE_MODE.neither, crit: false },
		];
		organ.drafts = [''];
		typeInto(0, '2d6 fire ×2 ');
		expect(organ.roll(half)).toHaveLength(2);
	});

	it('refuses to roll a line it could not fully account for', () => {
		typeInto(0, 'd20 +d4? ');
		expect(organ.rollable).toBe(false);
		expect(organ.roll(half)).toEqual([]);
	});

	it('cycles advantage without touching the dice it will roll', () => {
		typeInto(0, 'd20 ');
		organ.cycleAdvantage(0);
		expect(organ.lines[0]?.advantage).toBe(ADVANTAGE_MODE.advantage);
		organ.cycleAdvantage(0);
		expect(organ.lines[0]?.advantage).toBe(ADVANTAGE_MODE.disadvantage);
		organ.cycleAdvantage(0);
		expect(organ.lines[0]?.advantage).toBe(ADVANTAGE_MODE.neither);
	});
});

describe('prefill', () => {
	it('gives an attack an EDITABLE damage line rather than a hidden queue (UBUG-21)', () => {
		organ.prefill({
			label: 'Greataxe',
			test: { dice: { 20: 1 }, mod: 6 },
			damage: [{ dice: { 12: 1 }, mod: 3, type: 'slashing' }],
		});
		expect(organ.lines.map((l: RollerLine) => l.role)).toEqual([
			ROLLER_ROLE.test,
			ROLLER_ROLE.damage,
		]);
		// the damage half is real pills — a d6 added there goes to the DAMAGE and not to the d20, which
		// is the whole of UBUG-21. It lands after the type pill, so it inherits `slashing`.
		organ.focus = 1;
		organ.addDie(6);
		expect(damageParts(organ.lines[1] as RollerLine)).toMatchObject([
			{ dice: { 12: 1 }, mod: 3, type: 'slashing' },
			{ dice: { 6: 1 }, mod: 0, type: 'slashing' },
		]);
		expect(testRoll(organ.lines[0] as RollerLine).dice).toEqual({ 20: 1 });
	});

	it('has no second line when there is no damage — a check is one line', () => {
		organ.prefill({ label: 'Perception', test: { dice: { 20: 1 }, mod: 4 } });
		expect(organ.lines).toHaveLength(1);
	});
});

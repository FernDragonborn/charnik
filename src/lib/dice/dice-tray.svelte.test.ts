import { describe, it, expect, beforeEach } from 'vitest';
import { DiceTray } from './dice-tray.svelte';
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

let diceTray: DiceTray;
beforeEach(() => {
	diceTray = new DiceTray();
	diceTray.candidates = rollerCandidates(SOURCES, 'en');
	// the dice tray reads the crit method off the app setting, so a test that changes it must not leak
	app.critMethod = CRIT_METHOD.classic;
});

/** Type a whole string into a line the way a person does — the trailing space is what parses. */
const typeInto = (index: number, text: string) => diceTray.type(index, text);

describe('typing', () => {
	it('parses a token on the space after it and leaves the tail as text', () => {
		typeInto(0, 'd20 +7 bl');
		expect(diceTray.lines[0]?.pills).toHaveLength(2);
		expect(diceTray.draft).toBe('bl');
	});

	it('opens the menu on a letter, and not over dice in progress', () => {
		typeInto(0, '2d');
		expect(diceTray.menu).toEqual([]);
		typeInto(0, 'bl');
		expect(diceTray.menu[0]?.candidate.key).toBe('bless');
	});

	it('previews what completing would insert, before Tab is pressed', () => {
		typeInto(0, 'bl');
		expect(diceTray.ghost).toBe('ess → +1d4');
	});

	it('takes the highlighted row on commit, with the provenance the menu promised', () => {
		typeInto(0, 'bl');
		diceTray.commit(0);
		expect(diceTray.lines[0]?.pills[0]).toMatchObject({ sides: 4, source: 'Bless' });
		expect(diceTray.draft).toBe('');
	});

	it('Esc closes the menu and leaves the text — the roll is not blocked by it', () => {
		typeInto(0, 'bl');
		diceTray.dismissMenu();
		expect(diceTray.menu).toEqual([]);
		typeInto(0, 'ble');
		expect(diceTray.menu.length).toBeGreaterThan(0);
	});

	it('↓ steps PAST the row that already looked selected', () => {
		typeInto(0, 'bl');
		expect(diceTray.menu).toHaveLength(2);
		// the top row is highlighted from the start — it is what the ghost previews
		expect(diceTray.highlight).toBe(0);
		diceTray.selectDown();
		expect(diceTray.highlight).toBe(1);
	});

	it('← / → cross a column of a multi-column menu, clamped at both ends', () => {
		typeInto(0, 'bl');
		diceTray.selectAcross(1);
		expect(diceTray.highlight).toBe(1);
		diceTray.selectAcross(1);
		expect(diceTray.highlight).toBe(1);
		diceTray.selectAcross(-1);
		expect(diceTray.highlight).toBe(0);
		diceTray.selectAcross(-1);
		expect(diceTray.highlight).toBe(0);
	});

	it('moves the caret into the menu and back out of its top', () => {
		// one match, so the row ↓ enters on IS the top row and ↑ leaves from it
		typeInto(0, 'bles');
		expect(diceTray.inMenu).toBe(false);
		diceTray.selectDown();
		expect(diceTray.inMenu).toBe(true);
		diceTray.selectUp();
		expect(diceTray.inMenu).toBe(false);
	});
});

describe('a compound token leaves the caret past ALL of itself', () => {
	it('keeps a modifier with the damage type it was typed for', () => {
		diceTray.addDamageLine();
		// "2d6+3 fire 1d6 cold" — the +3 belongs to the fire, the way it was written
		typeInto(1, '2d6+3 fire 1d6 cold ');
		expect(damageParts(diceTray.lines[1]!)).toMatchObject([
			{ dice: { 6: 2 }, mod: 3, type: 'fire' },
			{ dice: { 6: 1 }, mod: 0, type: 'cold' },
		]);
	});
});

describe('editing pills', () => {
	it('unfolds the last pill back into the exact text it was made from', () => {
		typeInto(0, 'd20 bless ');
		diceTray.caretLeft(0);
		expect(diceTray.draft).toBe('Bless');
		expect(diceTray.lines[0]?.pills).toHaveLength(1);
	});

	it('walks left token by token, folding each one back as it goes', () => {
		typeInto(0, 'd20 +7 bless ');
		diceTray.caretLeft(0);
		expect(diceTray.draft).toBe('Bless');
		// the second step re-folds Bless where it stood and opens the token before it
		diceTray.caretLeft(0);
		expect(diceTray.draft).toBe('+7');
		expect(diceTray.lines[0]?.pills.map((p) => p.text)).toEqual(['d20', 'Bless']);
		// typing now inserts AT the caret, not at the end of the line
		typeInto(0, '+2 ');
		expect(diceTray.lines[0]?.pills.map((p) => p.text)).toEqual(['d20', '+2', 'Bless']);
	});

	it('walks back out to the right', () => {
		typeInto(0, 'd20 +7 ');
		diceTray.caretLeft(0);
		diceTray.caretLeft(0);
		expect(diceTray.draft).toBe('d20');
		diceTray.caretRight(0);
		expect(diceTray.draft).toBe('+7');
		expect(diceTray.lines[0]?.pills.map((p) => p.text)).toEqual(['d20']);
	});

	it('steps over an inherited type instead of getting stuck on it', () => {
		diceTray.addDamageLine();
		typeInto(1, '2d6 fire 1d8 ');
		// [2d6][fire][1d8][fire·inherited] — the inherited pill is derived, so Backspace must reach 1d8
		expect(diceTray.lines[1]?.pills).toHaveLength(4);
		diceTray.caretLeft(1);
		expect(diceTray.draft).toBe('1d8');
	});

	it('nudges a dice pill up and off, and deletes it at zero', () => {
		typeInto(0, '2d6 ');
		diceTray.bumpPill(0, 0, 1);
		expect(diceTray.lines[0]?.pills[0]).toMatchObject({ count: 3, text: '3d6' });
		diceTray.bumpPill(0, 0, -2);
		expect(diceTray.lines[0]?.pills[0]).toMatchObject({ count: 1 });
		diceTray.bumpPill(0, 0, -1);
		expect(diceTray.lines[0]?.pills).toHaveLength(0);
	});

	it('keeps a penalty die a penalty when its count is nudged', () => {
		// the pill's TEXT is what an unfold puts back in the draft, so a nudge that dropped the sign made
		// a double-click turn a Bane die into a bonus — an 8-point swing with nothing on screen to say so
		diceTray.prefill({
			label: 'Save',
			test: {
				dice: { 20: 1 },
				mod: 0,
				bonusDice: [{ count: 1, sides: 4, sign: -1, source: 'Bane' }],
			},
		});
		diceTray.bumpPill(0, 1, 1);
		expect(diceTray.lines[0]?.pills[1]).toMatchObject({ count: 2, sign: -1, text: '-2d4' });
		diceTray.unfold(0, 1);
		diceTray.commit(0);
		expect(diceTray.lines[0]?.pills[1]).toMatchObject({ count: 2, sides: 4, sign: -1 });
	});

	it('moves a pill from one line to the other, re-deriving both', () => {
		diceTray.addDamageLine();
		typeInto(0, 'd20 2d6 ');
		diceTray.movePill(0, 1, 1);
		expect(diceTray.lines[0]?.pills).toHaveLength(1);
		expect(diceTray.lines[1]?.pills[0]).toMatchObject({ sides: 6 });
	});

	it('taking a pill out leaves a never-moved caret AT the end, not one token short of it', () => {
		// the guard read `caretAt`, which clamps the AT_END sentinel to the line's length — so an
		// untouched caret reported "in front of the last pill" and was materialised one place left
		typeInto(0, '1d20 +3 +5 ');
		diceTray.removePill(0, 0);
		typeInto(0, '+9 ');
		expect(diceTray.lines[0]?.pills.map((p) => p.text)).toEqual(['+3', '+5', '+9']);
	});

	it('…and a bound still lands on the die it was typed for', () => {
		// `addToken` binds the last die LEFT of the caret, so the same slip turned a Reliable Talent
		// floor into an unaccounted fragment that blocked the roll
		diceTray.addDamageLine();
		typeInto(0, '1d6 1d20 ');
		diceTray.removePill(0, 0);
		typeInto(0, '>10 ');
		expect(diceTray.issues.filter((i) => i.blocking)).toEqual([]);
		expect(diceTray.rollable).toBe(true);
	});

	it('refuses a damage type dragged onto a test line — the menu withholds it there', () => {
		diceTray.addDamageLine();
		typeInto(1, '2d6 fire ');
		diceTray.movePill(1, 1, 0);
		expect(diceTray.lines[0]?.pills).toHaveLength(0);
		expect(diceTray.lines[1]?.pills.map((p) => p.text)).toContain('fire');
	});

	it('a damage part made only of EFFECT dice is still damage', () => {
		// `dealsDamage` is asked after the effects fold in: a `+1d6` rider on a weapon whose own damage
		// folds to zero (Unarmed Strike at STR 8, a Net at modifier 0) had no damage line at all
		diceTray.prefill({
			label: 'Strike',
			test: { dice: { 20: 1 }, mod: 5 },
			damage: [
				{
					dice: {},
					mod: 0,
					type: 'bludgeoning',
					bonusDice: [{ count: 1, sides: 6, sign: 1, source: 'Divine Favor' }],
				},
			],
		});
		expect(diceTray.lines.map((l) => l.role)).toContain(ROLLER_ROLE.damage);
	});

	it('lands a header die in the line the caret is in', () => {
		diceTray.addDamageLine();
		diceTray.focus = 1;
		diceTray.addDie(8);
		expect(diceTray.lines[0]?.pills).toHaveLength(0);
		expect(diceTray.lines[1]?.pills[0]).toMatchObject({ sides: 8 });
	});
});

describe('rolling', () => {
	it('commits a half-typed token first, so pressing Roll never drops it', () => {
		typeInto(0, 'd20 +7');
		const [entry] = diceTray.roll(half);
		expect(entry?.total).toBe(11 + 7);
	});

	it('rolls damage as its own line, one part per type', () => {
		typeInto(0, 'd20 +5 ');
		diceTray.addDamageLine();
		typeInto(1, '1d8 +3 fire 1d6 cold ');
		const [entry] = diceTray.roll(half);
		expect(entry?.damage?.map((d) => d.type)).toEqual(['fire', 'cold']);
		expect(entry?.damage?.[0]?.total).toBe(5 + 3);
	});

	it('rolls damage with no test at all — Fireball: the target saves, not you', () => {
		diceTray.lines = [
			{ role: ROLLER_ROLE.damage, pills: [], advantage: ADVANTAGE_MODE.neither, crit: false },
		];
		diceTray.drafts = [''];
		typeInto(0, '8d6 fire ');
		const [entry] = diceTray.roll(half);
		expect(entry?.d20s).toEqual([]);
		expect(entry?.damage?.[0]?.total).toBe(8 * 4);
	});

	it('doubles the dice of a crit line and leaves its modifier alone', () => {
		diceTray.addDamageLine();
		typeInto(1, '1d8 +3 ');
		diceTray.toggleCrit(1);
		// the crit METHOD is a table setting, not a per-roll switch — the dice tray reads it from there
		app.critMethod = CRIT_METHOD.loyal;
		const [entry] = diceTray.roll(half);
		expect(entry?.damage?.[0]?.total).toBe(5 + 8 + 3);
		expect(entry?.damage?.[0]?.dice.filter((d) => d.role === DIE_ROLE.crit)).toHaveLength(1);
	});

	it('fires a volley as N instances of the same set, each its own record', () => {
		typeInto(0, 'd20 +5 ×3 ');
		const entries = diceTray.roll(half);
		expect(entries).toHaveLength(3);
		// each carries its own timestamp: an amendment rewrites ITS line, not a sibling's
		expect(new Set(entries.map((e) => e.at)).size).toBe(3);
	});

	it('reads a volley count off whichever line carries it, test or damage', () => {
		diceTray.lines = [
			{ role: ROLLER_ROLE.damage, pills: [], advantage: ADVANTAGE_MODE.neither, crit: false },
		];
		diceTray.drafts = [''];
		typeInto(0, '2d6 fire ×2 ');
		expect(diceTray.roll(half)).toHaveLength(2);
	});

	it('refuses to roll a line it could not fully account for', () => {
		typeInto(0, 'd20 +d4? ');
		expect(diceTray.rollable).toBe(false);
		expect(diceTray.roll(half)).toEqual([]);
	});

	it('cycles advantage without touching the dice it will roll', () => {
		typeInto(0, 'd20 ');
		diceTray.cycleAdvantage(0);
		expect(diceTray.lines[0]?.advantage).toBe(ADVANTAGE_MODE.advantage);
		diceTray.cycleAdvantage(0);
		expect(diceTray.lines[0]?.advantage).toBe(ADVANTAGE_MODE.disadvantage);
		diceTray.cycleAdvantage(0);
		expect(diceTray.lines[0]?.advantage).toBe(ADVANTAGE_MODE.neither);
	});
});

describe('prefill', () => {
	it('gives an attack an EDITABLE damage line rather than a hidden queue (UBUG-21)', () => {
		diceTray.prefill({
			label: 'Greataxe',
			test: { dice: { 20: 1 }, mod: 6 },
			damage: [{ dice: { 12: 1 }, mod: 3, type: 'slashing' }],
		});
		expect(diceTray.lines.map((l: RollerLine) => l.role)).toEqual([
			ROLLER_ROLE.test,
			ROLLER_ROLE.damage,
		]);
		// the damage half is real pills — a d6 added there goes to the DAMAGE and not to the d20, which
		// is the whole of UBUG-21. It lands after the type pill, so it inherits `slashing`.
		diceTray.focus = 1;
		diceTray.addDie(6);
		expect(damageParts(diceTray.lines[1] as RollerLine)).toMatchObject([
			{ dice: { 12: 1 }, mod: 3, type: 'slashing' },
			{ dice: { 6: 1 }, mod: 0, type: 'slashing' },
		]);
		expect(testRoll(diceTray.lines[0] as RollerLine).dice).toEqual({ 20: 1 });
	});

	it('has no second line when there is no damage — a check is one line', () => {
		diceTray.prefill({ label: 'Perception', test: { dice: { 20: 1 }, mod: 4 } });
		expect(diceTray.lines).toHaveLength(1);
	});

	it("carries the label's ICU VALUES into the entry it rolls, not only its key", () => {
		// a numbered strike's name is a key plus its numbers; the tray used to forward the key alone, so
		// the recorded row asked the catalog for a numbering frame with no numbers in it
		diceTray.prefill({
			label: 'Unarmed Strike 1/2',
			labelKey: 'combat.log.attackNumbered',
			labelValues: { n: 1, of: 2, name: { catalog: 'attacks', id: 'unarmed_strike' } },
			test: { dice: { 20: 1 }, mod: 5 },
		});
		const [entry] = diceTray.roll();
		expect(entry?.labelKey).toBe('combat.log.attackNumbered');
		expect(entry?.labelValues).toEqual({
			n: 1,
			of: 2,
			name: { catalog: 'attacks', id: 'unarmed_strike' },
		});
		// and a tray reset forgets them, so the next roll does not inherit another roll's numbers
		diceTray.reset();
		expect(diceTray.roll()[0]?.labelValues).toBeUndefined();
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * The tray seam: what a roll site asks for, and what the roller organ becomes. These are the paths
 * UBUG-21 was about — a prefilled attack's damage used to be a queue the tray could neither show nor
 * edit — plus the routing that decides whether a request is a d20 TEST or a QUANTITY at all.
 * The toast is mocked because recording a roll must not need a DOM.
 */
const toastRoll = vi.fn();
vi.mock('$lib/dice/roll-toast', () => ({ toastRoll }));

const { RollTray } = await import('./roll-tray.svelte');
const { MenuOverlay } = await import('./menu-overlay.svelte');
const { ROLLER_ROLE, damageParts, testRoll } = await import('$lib/dice/roller');
const { ADVANTAGE_MODE } = await import('$lib/rules/dice');

let tray: InstanceType<typeof RollTray>;
beforeEach(() => {
	toastRoll.mockClear();
	tray = new RollTray();
});

describe('prefill', () => {
	it('gives an attack a test line AND an editable damage line (UBUG-21)', () => {
		// ONE request carries the whole action: the to-hit, the damage and what it is called
		tray.prefill({
			label: 'Greataxe',
			test: { dice: { 20: 1 }, mod: 6, advantage: -1 },
			damage: [{ dice: { 12: 1 }, mod: 3, type: 'slashing' }],
		});

		const lines = tray.organ.lines;
		expect(lines.map((l) => l.role)).toEqual([ROLLER_ROLE.test, ROLLER_ROLE.damage]);
		expect(lines[0]?.advantage).toBe(ADVANTAGE_MODE.disadvantage);
		// a die added to the damage line goes to the DAMAGE, which is the whole of the bug
		tray.organ.focus = 1;
		tray.organ.addDie(6);
		expect(testRoll(lines[0]!).dice).toEqual({ 20: 1 });
		expect(damageParts(tray.organ.lines[1]!).map((p) => p.dice)).toEqual([{ 12: 1 }, { 6: 1 }]);
	});

	it('carries an effect die into the line as a pill of its own, sign kept', () => {
		tray.prefill({
			label: 'Athletics',
			test: { dice: { 20: 1 }, mod: 5, bonusDice: [{ sides: 4, count: 1, sign: 1 }] },
		});
		// it stays an EFFECT die (not folded into the pool), so a pool reroll can never reach it
		expect(testRoll(tray.organ.lines[0]!).bonusDice).toEqual([{ sides: 4, count: 1, sign: 1 }]);
		expect(testRoll(tray.organ.lines[0]!).dice).toEqual({ 20: 1 });
	});

	it('puts the pool’s reroll/floor on the pool’s own dice', () => {
		tray.prefill({
			label: 'Stealth',
			test: { dice: { 20: 1 }, mod: 11, mods: { minDie: 10, reroll: 1 } },
		});
		expect(testRoll(tray.organ.lines[0]!).mods).toEqual({ minDie: 10, reroll: 1 });
	});

	it('a request with no test half builds NO test line — Fireball has no to-hit', () => {
		tray.prefill({
			label: 'Fireball',
			damage: [{ dice: { 6: 8 }, mod: 0, type: 'fire' }],
			note: '8d6 base',
		});
		expect(tray.organ.lines.map((l) => l.role)).toEqual([ROLLER_ROLE.damage]);
		expect(damageParts(tray.organ.lines[0]!)).toMatchObject([{ dice: { 6: 8 }, type: 'fire' }]);
		expect(tray.organ.note).toBe('8d6 base');
	});
});

describe('the generic dice-tray seam', () => {
	/** The overlay only needs somewhere to put a roll; the page geometry is not what is under test. */
	const overlayFor = (t: InstanceType<typeof RollTray>) => new MenuOverlay(() => ({ tray: t }));

	it('routes a formula with a d20 to the TEST line', () => {
		overlayFor(tray).handleTrayRequest({ label: 'Initiative', formula: '1d20 +4' });
		expect(tray.organ.lines.map((l) => l.role)).toEqual([ROLLER_ROLE.test]);
		expect(testRoll(tray.organ.lines[0]!)).toMatchObject({ dice: { 20: 1 }, mod: 4 });
	});

	it('routes a formula with no d20 to the DAMAGE line — a compendium "8d6 fire" is a quantity', () => {
		overlayFor(tray).handleTrayRequest({ label: 'Fireball', formula: '8d6 fire' });
		expect(tray.organ.lines.map((l) => l.role)).toEqual([ROLLER_ROLE.damage]);
		expect(damageParts(tray.organ.lines[0]!)).toMatchObject([{ dice: { 6: 8 }, type: 'fire' }]);
	});
});

describe('recordRolls', () => {
	it('logs a volley line by line and toasts it as ONE card — it was one action', () => {
		const at = Date.now();
		tray.recordRolls([
			{
				label: 'Ray',
				expr: '',
				dice: [],
				d20s: [],
				advantage: ADVANTAGE_MODE.neither,
				mod: 0,
				total: 5,
				at,
			},
			{
				label: 'Ray',
				expr: '',
				dice: [],
				d20s: [],
				advantage: ADVANTAGE_MODE.neither,
				mod: 0,
				total: 7,
				at: at + 1,
			},
		]);
		expect(tray.log).toHaveLength(2);
		expect(toastRoll).toHaveBeenCalledTimes(1);
		expect(toastRoll.mock.calls[0]?.[0]).toHaveLength(2);
	});

	it('stamps one action id across the lines, so a reload still knows it was one action', () => {
		const persisted: { group?: string }[] = [];
		const grouping = new RollTray((e) => persisted.push(e));
		const line = (at: number) => ({
			label: 'Ray',
			expr: '',
			dice: [],
			d20s: [],
			advantage: ADVANTAGE_MODE.neither,
			mod: 0,
			total: 5,
			at,
		});
		grouping.recordRolls([line(1), line(2), line(3)]);
		const groups = grouping.log.map((e) => e.group);
		expect(new Set(groups).size).toBe(1);
		expect(groups[0]).toBeTypeOf('string');
		// what was persisted must carry it too, or the fact dies with the session
		expect(persisted.every((e) => e.group === groups[0])).toBe(true);
	});

	it('leaves a lone roll ungrouped — being one line already says it', () => {
		tray.recordRolls([
			{
				label: 'Save',
				expr: '',
				dice: [],
				d20s: [],
				advantage: ADVANTAGE_MODE.neither,
				mod: 0,
				total: 5,
				at: 1,
			},
		]);
		expect(tray.log[0]?.group).toBeUndefined();
	});

	it('does nothing at all when the roll was refused', () => {
		tray.recordRolls([]);
		expect(tray.log).toHaveLength(0);
		expect(toastRoll).not.toHaveBeenCalled();
	});
});

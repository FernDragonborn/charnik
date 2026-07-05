import { describe, it, expect } from 'vitest';
import { rollEffectsFor, effectTag, pipClick } from './helpers';

const fx = (...tokens: string[]) => [{ effects: tokens }];

describe('pipClick — one click-to-set model (available left, spent right)', () => {
	it('clicking an available pip spends it + everything to its right', () => {
		expect(pipClick(0, 2, 3)).toBe(1); // [F F F] click rightmost available → 1 spent
		expect(pipClick(0, 0, 3)).toBe(3); // [F F F] click leftmost → all spent
		expect(pipClick(1, 1, 3)).toBe(2); // [F F S] click pip 1 → 2 spent
	});
	it('clicking a spent pip restores it + everything to its left', () => {
		expect(pipClick(3, 2, 3)).toBe(0); // [S S S] click rightmost spent → all restored
		expect(pipClick(3, 0, 3)).toBe(2); // [S S S] click leftmost spent → 1 restored
	});
	it('is the same formula the spell-slot handler already used (regression guard)', () => {
		const slot = (full: number, spent: number, i: number) =>
			i < full - spent ? full - i : full - i - 1;
		for (let full = 1; full <= 5; full++)
			for (let spent = 0; spent <= full; spent++)
				for (let i = 0; i < full; i++) expect(pipClick(spent, i, full)).toBe(slot(full, spent, i));
	});
});

describe('rollEffectsFor — advantage + bonus dice a roll picks up', () => {
	it('adds Bless (+1d4) and Bane (−1d4) group tokens to any save', () => {
		const r = rollEffectsFor(fx('flat-bonus:saves+1d4', 'flat-bonus:saves-1d4'), 'save.dex');
		expect(r.advantage).toBe(false);
		expect(r.bonusDice).toEqual([
			{ sides: 4, count: 1, sign: 1 },
			{ sides: 4, count: 1, sign: -1 }
		]);
	});

	it('fans "skills" group advantage out to a specific skill, not to saves', () => {
		expect(rollEffectsFor(fx('advantage:skills'), 'skill.stealth').advantage).toBe(true);
		expect(rollEffectsFor(fx('advantage:skills'), 'save.dex').advantage).toBe(false);
	});

	it('matches an exact target and ignores a different one', () => {
		expect(rollEffectsFor(fx('advantage:save.dex'), 'save.dex').advantage).toBe(true);
		expect(rollEffectsFor(fx('advantage:save.dex'), 'save.con').advantage).toBe(false);
	});

	it('ignores flat numeric bonuses (those fold into the modifier, not the dice)', () => {
		expect(rollEffectsFor(fx('flat-bonus:save.dex+2'), 'save.dex').bonusDice).toEqual([]);
	});
});

describe('effectTag — readable tags for the effects panel', () => {
	it('prettifies dotted flat-bonus targets', () => {
		expect(effectTag('flat-bonus:ac+2')).toBe('AC +2');
		expect(effectTag('flat-bonus:save.dex+1')).toBe('DEX save +1');
		expect(effectTag('flat-bonus:skill.stealth-1')).toBe('Stealth −1');
	});
});

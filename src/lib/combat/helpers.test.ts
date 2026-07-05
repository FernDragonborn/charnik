import { describe, it, expect } from 'vitest';
import { rollEffectsFor, effectTag } from './helpers';

const fx = (...tokens: string[]) => [{ effects: tokens }];

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

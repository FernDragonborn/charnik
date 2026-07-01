import { describe, it, expect } from 'vitest';
import { parseEffect, applyEffects, collectFlags, type ActiveEffect } from './index';
import { unarmoredAC, savingThrow } from '../rules/core';

describe('parseEffect (bounded vocabulary)', () => {
	it('parses numeric flat bonuses', () => {
		expect(parseEffect('flat-bonus:ac+1')).toMatchObject({
			kind: 'flat-bonus',
			target: 'ac',
			amount: 1
		});
		expect(parseEffect('flat-bonus:con-2')).toMatchObject({
			kind: 'flat-bonus',
			target: 'con',
			amount: -2
		});
	});
	it('keeps dice bonuses as dice (roll modifier, not a flat number)', () => {
		expect(parseEffect('flat-bonus:saves+1d4')).toMatchObject({
			kind: 'flat-bonus',
			target: 'saves',
			dice: '1d4'
		});
	});
	it('parses the non-numeric kinds', () => {
		expect(parseEffect('resist-immune:poison')).toMatchObject({
			kind: 'resist-immune',
			target: 'poison'
		});
		expect(parseEffect('apply-condition:paralyzed')).toMatchObject({
			kind: 'apply-condition',
			target: 'paralyzed'
		});
		expect(parseEffect('grant-resource:rage')).toMatchObject({
			kind: 'grant-resource',
			target: 'rage'
		});
		expect(parseEffect('set-override:ac:18')).toMatchObject({
			kind: 'set-override',
			target: 'ac',
			amount: 18
		});
	});
	it('flags unknown / malformed tokens instead of dropping them', () => {
		expect(parseEffect('teleport:far').kind).toBe('unknown');
		expect(parseEffect('garbage').kind).toBe('unknown');
	});
});

describe('applyEffects seam', () => {
	const ring: ActiveEffect = {
		source: 'Ring of Protection',
		layer: 'item',
		tokens: ['flat-bonus:ac+1']
	};

	it('on/off invariant: no effects leaves value and trace unchanged', () => {
		const base = unarmoredAC({ dexScore: 14 }); // 12
		const composed = applyEffects('ac', base, []);
		expect(composed.value).toBe(base.value);
		expect(composed.trace).toEqual(base.trace);
	});

	it('folds a matching flat bonus onto the core value, keeping provenance', () => {
		const base = unarmoredAC({ dexScore: 14 }); // 12
		const composed = applyEffects('ac', base, [ring]);
		expect(composed.value).toBe(13);
		expect(composed.trace.map((c) => c.source)).toContain('Ring of Protection');
	});

	it('ignores effects that target a different stat', () => {
		const base = unarmoredAC({ dexScore: 14 });
		const composed = applyEffects('initiative', base, [ring]);
		expect(composed.value).toBe(base.value);
	});

	it('the `saves` group applies to a specific save', () => {
		const base = savingThrow({ ability: 'wis', score: 10, level: 1, proficient: false }); // 0
		const bless: ActiveEffect = {
			source: 'Bless',
			layer: 'condition',
			tokens: ['flat-bonus:saves+1d4']
		};
		const flat: ActiveEffect = { source: 'Cloak', layer: 'item', tokens: ['flat-bonus:saves+1'] };
		const composed = applyEffects('save.wis', base, [bless, flat]);
		expect(composed.value).toBe(1); // +1 flat; the 1d4 is a note, not a flat value
		expect(composed.notes?.some((n) => /1d4/.test(n))).toBe(true);
	});

	it('set-override in the override layer wins', () => {
		const base = unarmoredAC({ dexScore: 20 }); // 15
		const wildShape: ActiveEffect = {
			source: 'Form',
			layer: 'override',
			tokens: ['set-override:ac:11']
		};
		expect(applyEffects('ac', base, [wildShape]).value).toBe(11);
	});

	it('keeps an unknown token as an inert note, value unchanged', () => {
		const base = unarmoredAC({ dexScore: 14 });
		const weird: ActiveEffect = {
			source: 'Homebrew',
			layer: 'feature',
			tokens: ['flat-bonus:ac+1', 'teleport:far']
		};
		const composed = applyEffects('ac', base, [weird]);
		expect(composed.value).toBe(13); // the good token still applies
	});
});

describe('collectFlags', () => {
	it('gathers non-numeric effect facts', () => {
		const effects: ActiveEffect[] = [
			{
				source: 'Rage',
				layer: 'feature',
				tokens: ['grant-resource:rage', 'resist-immune:bludgeoning']
			},
			{ source: 'Hold Person', layer: 'condition', tokens: ['apply-condition:paralyzed'] },
			{ source: 'Weird', layer: 'feature', tokens: ['teleport:far'] }
		];
		const flags = collectFlags(effects);
		expect(flags.resources).toContain('rage');
		expect(flags.resistImmune).toContain('bludgeoning');
		expect(flags.conditions).toContain('paralyzed');
		expect(flags.unknown).toContain('teleport:far');
	});
});

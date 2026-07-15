import { describe, it, expect } from 'vitest';
import { parseEffect, applyEffects, collectFlags, EFFECT_KINDS, type ActiveEffect } from './index';
import { EFFECT_KINDS as SCHEMA_EFFECT_KINDS } from '../content/schemas';
import { unarmoredAC, savingThrow } from '../rules/core';

describe('effect vocabulary', () => {
	it('the engine and the content schema list the same kinds (guard against drift)', () => {
		// the two lists are intentionally separate (effects is a removable module) — keep them equal
		expect([...EFFECT_KINDS].sort()).toEqual([...SCHEMA_EFFECT_KINDS].sort());
	});
});

describe('parseEffect (bounded vocabulary)', () => {
	it('parses numeric flat bonuses', () => {
		expect(parseEffect('flat_bonus:ac+1')).toMatchObject({
			kind: 'flat_bonus',
			target: 'ac',
			amount: 1
		});
		expect(parseEffect('flat_bonus:con-2')).toMatchObject({
			kind: 'flat_bonus',
			target: 'con',
			amount: -2
		});
	});
	it('keeps dice bonuses as dice (roll modifier, not a flat number)', () => {
		expect(parseEffect('flat_bonus:saves+1d4')).toMatchObject({
			kind: 'flat_bonus',
			target: 'saves',
			dice: '1d4'
		});
	});
	it('parses the non-numeric kinds', () => {
		expect(parseEffect('resist_immune:poison')).toMatchObject({
			kind: 'resist_immune',
			target: 'poison'
		});
		expect(parseEffect('apply_condition:paralyzed')).toMatchObject({
			kind: 'apply_condition',
			target: 'paralyzed'
		});
		expect(parseEffect('grant_resource:rage')).toMatchObject({
			kind: 'grant_resource',
			target: 'rage'
		});
		expect(parseEffect('set_override:ac:18')).toMatchObject({
			kind: 'set_override',
			target: 'ac',
			amount: 18
		});
	});
	it('structures resist_immune into a defense bucket + type (bare defaults to resist)', () => {
		expect(parseEffect('resist_immune:fire')).toMatchObject({ defense: 'resist', target: 'fire' });
		expect(parseEffect('resist_immune:immune:poison')).toMatchObject({
			defense: 'immune',
			target: 'poison'
		});
		expect(parseEffect('resist_immune:vulnerable:cold')).toMatchObject({
			defense: 'vulnerable',
			target: 'cold'
		});
	});
	it('structures a full grant_resource pool, leaves a bare one as just an id', () => {
		expect(parseEffect('grant_resource:rage:3:long').resource).toEqual({
			id: 'rage',
			max: 3,
			recharge: 'long'
		});
		expect(parseEffect('grant_resource:ki').resource).toBeUndefined();
	});
	it('flags unknown / malformed tokens instead of dropping them', () => {
		expect(parseEffect('teleport:far').kind).toBe('unknown');
		expect(parseEffect('garbage').kind).toBe('unknown');
	});
	it('parses disadvantage like advantage (its own kind + target)', () => {
		expect(parseEffect('disadvantage:skill.stealth')).toMatchObject({
			kind: 'disadvantage',
			target: 'skill.stealth'
		});
	});
	it('grant_proficiency carries ONE ladder level and canonicalizes a skill. prefix', () => {
		expect(parseEffect('grant_proficiency:stealth')).toMatchObject({
			target: 'stealth',
			proficiency: 'proficient'
		});
		// a `skill.`-prefixed target must not silently drop (audit A6)
		expect(parseEffect('grant_proficiency:skill.stealth')).toMatchObject({ target: 'stealth' });
		expect(parseEffect('grant_proficiency:expertise:stealth')).toMatchObject({
			target: 'stealth',
			proficiency: 'expertise'
		});
		// saves keep their prefix (derive tells them apart by it)
		expect(parseEffect('grant_proficiency:save.con')).toMatchObject({ target: 'save.con' });
	});
});

describe('applyEffects seam', () => {
	const ring: ActiveEffect = {
		source: 'Ring of Protection',
		layer: 'item',
		tokens: ['flat_bonus:ac+1']
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
			tokens: ['flat_bonus:saves+1d4']
		};
		const flat: ActiveEffect = { source: 'Cloak', layer: 'item', tokens: ['flat_bonus:saves+1'] };
		const composed = applyEffects('save.wis', base, [bless, flat]);
		expect(composed.value).toBe(1); // +1 flat; the 1d4 is a note, not a flat value
		expect(composed.notes?.some((n) => /1d4/.test(n))).toBe(true);
	});

	it('set_override in the override layer wins', () => {
		const base = unarmoredAC({ dexScore: 20 }); // 15
		const wildShape: ActiveEffect = {
			source: 'Form',
			layer: 'override',
			tokens: ['set_override:ac:11']
		};
		expect(applyEffects('ac', base, [wildShape]).value).toBe(11);
	});

	it('two colliding overrides resolve to the most potent (max), independent of order', () => {
		const base = unarmoredAC({ dexScore: 20 }); // 15
		const plate: ActiveEffect = {
			source: 'Plate',
			layer: 'override',
			tokens: ['set_override:ac:18']
		};
		const mage: ActiveEffect = {
			source: 'Mage Armor',
			layer: 'override',
			tokens: ['set_override:ac:13']
		};
		// both orderings must yield the SAME winner (18) — no ns-sort / scan-order dependence
		expect(applyEffects('ac', base, [plate, mage]).value).toBe(18);
		expect(applyEffects('ac', base, [mage, plate]).value).toBe(18);
		// the superseded override is explained, never silently dropped
		const notes = applyEffects('ac', base, [mage, plate]).notes ?? [];
		expect(notes.some((n) => /13.*overridden by 18/.test(n))).toBe(true);
	});

	it('clamps a hostile resource max (cost cap, not balance)', () => {
		expect(parseEffect('grant_resource:x:1000000000:short')).toMatchObject({
			resource: { id: 'x', max: 1000 }
		});
	});

	it('keeps an unknown token as an inert note, value unchanged', () => {
		const base = unarmoredAC({ dexScore: 14 });
		const weird: ActiveEffect = {
			source: 'Homebrew',
			layer: 'feature',
			tokens: ['flat_bonus:ac+1', 'teleport:far']
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
				tokens: ['grant_resource:rage', 'resist_immune:bludgeoning']
			},
			{ source: 'Hold Person', layer: 'condition', tokens: ['apply_condition:paralyzed'] },
			{ source: 'Weird', layer: 'feature', tokens: ['teleport:far'] }
		];
		const flags = collectFlags(effects);
		expect(flags.resources).toContain('rage');
		expect(flags.resistImmune).toContain('bludgeoning');
		expect(flags.conditions).toContain('paralyzed');
		expect(flags.unknown).toContain('teleport:far');
	});
	it('fills the disadvantage bucket (was a dead field — audit A5)', () => {
		const flags = collectFlags([
			{ source: 'Poisoned', layer: 'condition', tokens: ['disadvantage:skills'] }
		]);
		expect(flags.disadvantage).toContain('skills');
	});
});

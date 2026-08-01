import { describe, it, expect } from 'vitest';
import {
	parseSpeciesBoostChoice,
	asiBoost,
	speciesFixedAbilities,
	buildIssues,
	expertiseSlotsAtLevel,
	expertiseBudget
} from './derive';
import { makeRow } from '../content/test-utils';
import type { ContentGraph } from '../content/loader';

describe('parseSpeciesBoostChoice', () => {
	it('parses "AxB" into { amount: A, count: B } and rejects junk', () => {
		expect(parseSpeciesBoostChoice('1x2')).toEqual({ amount: 1, count: 2 });
		expect(parseSpeciesBoostChoice('  2x1 ')).toEqual({ amount: 2, count: 1 });
		expect(parseSpeciesBoostChoice('')).toBeNull();
		expect(parseSpeciesBoostChoice('nope')).toBeNull();
	});
});

describe('asiBoost', () => {
	it('+2 shape puts 2 on the first pick', () => {
		expect(asiBoost({ shape: '2', picks: ['str'] })).toEqual({ str: 2 });
	});
	it('+1/+1 shape puts 1 on each of two picks', () => {
		expect(asiBoost({ shape: '1-1', picks: ['str', 'dex'] })).toEqual({ str: 1, dex: 1 });
	});
	it('undefined / empty picks → no boost', () => {
		expect(asiBoost(undefined)).toEqual({});
		expect(asiBoost({ shape: '2', picks: [] })).toEqual({});
	});
});

describe('expertiseSlotsAtLevel (N4a level:count grants)', () => {
	it('sums the pairs whose unlock level ≤ the class level', () => {
		expect(expertiseSlotsAtLevel('1:2,6:2', 1)).toBe(2);
		expect(expertiseSlotsAtLevel('1:2,6:2', 5)).toBe(2);
		expect(expertiseSlotsAtLevel('1:2,6:2', 6)).toBe(4);
		expect(expertiseSlotsAtLevel('3:2,10:2', 20)).toBe(4);
	});
	it('is 0 for empty / undefined / garbage', () => {
		expect(expertiseSlotsAtLevel(undefined, 20)).toBe(0);
		expect(expertiseSlotsAtLevel('', 20)).toBe(0);
		expect(expertiseSlotsAtLevel('junk', 20)).toBe(0);
	});
});

describe('expertiseBudget (drafted-class expertise cap)', () => {
	const feat = (over: Record<string, unknown>) => ({
		...makeRow('class_feature', { class_id: 'rogue', ...over }),
		systems: ['5.5e']
	});
	const graph = {
		get: (id: string) => (id === 'rogue' ? makeRow('class', { id: 'rogue' }) : undefined),
		featuresForClass: () => [feat({ id: 'rogue_expertise', level: 1, expertise_slots: '1:2,6:2' })]
	} as unknown as ContentGraph;

	it("sums a class's active-feature grants at the class level", () => {
		expect(expertiseBudget([{ classId: 'rogue', subclassId: null, level: 1 }], graph, '5.5e')).toBe(
			2
		);
		expect(expertiseBudget([{ classId: 'rogue', subclassId: null, level: 6 }], graph, '5.5e')).toBe(
			4
		);
	});
	it('drops a feature of another system, and an unset class', () => {
		expect(expertiseBudget([{ classId: 'rogue', subclassId: null, level: 6 }], graph, '5e')).toBe(0);
		expect(expertiseBudget([{ classId: null, subclassId: null, level: 6 }], graph, '5.5e')).toBe(0);
	});
});

describe('speciesFixedAbilities', () => {
	const row = (effects: string[]) => makeRow('species', { effects });
	it('collects the abilities a flat_bonus effect raises, ignoring non-ability targets', () => {
		const set = speciesFixedAbilities([row(['flat_bonus:cha+2', 'flat_bonus:ac+1']), undefined]);
		expect([...set]).toEqual(['cha']); // ac is not an ability
	});
});

describe('buildIssues', () => {
	const base = { name: 'Hero', method: 'manual' as const, strict: true };
	const noDeps = {
		hasClass: true,
		pointsLeft: 0,
		classSkillCount: 0,
		skillChosenCount: 0,
		spellPicker: []
	};
	it('flags a missing name and a missing class', () => {
		const out = buildIssues({ ...base, name: '  ' }, { ...noDeps, hasClass: false });
		expect(out).toContain('Give your character a name.');
		expect(out).toContain('Pick a class (you can change it later).');
	});
	it('flags unspent point-buy points only in point-buy', () => {
		expect(buildIssues({ ...base, method: 'point_buy' }, { ...noDeps, pointsLeft: 3 })).toContain(
			'3 ability points unspent.'
		);
		expect(buildIssues({ ...base, method: 'manual' }, { ...noDeps, pointsLeft: 3 })).not.toContain(
			'3 ability points unspent.'
		);
	});
	it('a complete Strict draft has no issues; Free skips the Strict checks', () => {
		expect(buildIssues(base, noDeps)).toEqual([]);
		expect(buildIssues({ ...base, strict: false }, { ...noDeps, classSkillCount: 2 })).toEqual([]);
	});
	it('Strict flags too-few chosen skills', () => {
		expect(buildIssues(base, { ...noDeps, classSkillCount: 2, skillChosenCount: 0 })).toContain(
			'Choose 2 more skills.'
		);
	});
});

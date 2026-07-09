import { describe, it, expect } from 'vitest';
import { parseSpeciesBoostChoice, asiBoost, speciesFixedAbilities, buildIssues } from './derive';
import { makeRow } from '../content/test-utils';

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

describe('speciesFixedAbilities', () => {
	const row = (effects: string[]) => makeRow('species', { effects });
	it('collects the abilities a flat-bonus effect raises, ignoring non-ability targets', () => {
		const set = speciesFixedAbilities([row(['flat-bonus:cha+2', 'flat-bonus:ac+1']), undefined]);
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
		expect(buildIssues({ ...base, method: 'point-buy' }, { ...noDeps, pointsLeft: 3 })).toContain(
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

import { describe, it, expect } from 'vitest';
import {
	parseSpeciesBoostChoice,
	asiBoost,
	speciesFixedAbilities,
	buildTodos,
	type BuildTodoInput,
	expertiseSlotsAtLevel,
	expertiseBudget,
	halfFeatAbilities
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

describe('halfFeatAbilities (half-feat +1 targets)', () => {
	it('parses a comma list, "any" → all six, and empty → none', () => {
		expect(halfFeatAbilities('str,dex')).toEqual(['str', 'dex']);
		expect(halfFeatAbilities('any')).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
		expect(halfFeatAbilities('DEX, STR')).toEqual(['str', 'dex']); // normalized + stable order
		expect(halfFeatAbilities('')).toEqual([]);
		expect(halfFeatAbilities(undefined)).toEqual([]);
		expect(halfFeatAbilities('bogus')).toEqual([]);
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

describe('buildTodos', () => {
	/** A draft with nothing left to do — each test breaks exactly one thing. */
	const done: BuildTodoInput = {
		name: 'Hero',
		method: 'manual',
		strict: true,
		hasSpecies: true,
		needsSpeciesOption: false,
		hasBackground: true,
		hasClass: true,
		openSubclasses: [],
		pointsLeft: 0,
		classSkillCount: 0,
		skillChosenCount: 0,
		openFeatSlots: [],
		spellPicker: []
	};
	const kinds = (input: BuildTodoInput) => buildTodos(input).map((t) => t.kind);

	it('a finished draft has nothing left to do', () => {
		expect(buildTodos(done)).toEqual([]);
	});
	it('flags every empty origin field', () => {
		expect(
			kinds({ ...done, name: '  ', hasSpecies: false, hasBackground: false, hasClass: false })
		).toEqual(['name', 'species', 'class', 'background']);
	});
	it('a species with lineages needs one chosen', () => {
		expect(kinds({ ...done, needsSpeciesOption: true })).toEqual(['speciesOption']);
	});
	it('unspent points only count in point-buy', () => {
		expect(kinds({ ...done, method: 'point_buy', pointsLeft: 3 })).toEqual(['abilities']);
		expect(kinds({ ...done, method: 'manual', pointsLeft: 3 })).toEqual([]);
	});
	it('an empty field is required in Free too — only the over-cap check is Strict', () => {
		const short = { ...done, classSkillCount: 2, skillChosenCount: 0 };
		expect(buildTodos({ ...short, strict: false })[0]).toMatchObject({
			kind: 'skills',
			key: 'skills',
			values: { count: 2 },
			required: true
		});
	});
	it('every open subclass and feat slot is its own line, and carries where it came from', () => {
		const todos = buildTodos({
			...done,
			openSubclasses: [{ index: 0, className: 'Paladin', level: 3 }],
			openFeatSlots: [
				{ key: 'p-4', level: 4, className: 'Paladin' },
				{ key: 'p-8', level: 8, className: 'Paladin' }
			]
		});
		expect(todos.map((t) => t.kind)).toEqual(['subclass', 'feat', 'feat']);
		expect(todos[0]).toMatchObject({ index: 0, level: 3 });
		expect(todos.slice(1).map((t) => t.slotKey)).toEqual(['p-4', 'p-8']);
	});
});

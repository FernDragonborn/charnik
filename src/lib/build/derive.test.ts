import { describe, it, expect } from 'vitest';
import {
	parseSpeciesBoostChoice,
	asiBoost,
	speciesFixedAbilities,
	buildTodos,
	type BuildTodoInput,
	expertiseSlotsAtLevel,
	expertiseBudget,
	openSubclassChoices,
	halfFeatAbilities,
	classFeatureLines,
	buildSpellPicker
} from './derive';
import { makeRow } from '../content/test-utils';
import type { ContentGraph, LoadedRow } from '../content/loader';
import type { CharacterSheet } from '../character/derive';

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

describe('openSubclassChoices', () => {
	const graph = {
		get: (id: string) =>
			id === 'paladin' ? makeRow('class', { id: 'paladin', subclass_level: 3 }) : undefined,
	} as unknown as ContentGraph;
	const paladin = (level: number) => [{ classId: 'paladin', subclassId: null, level }];
	const named = (row: { data: Record<string, unknown> }) => String(row.data.id);

	it('asks once the class has reached the level its subclass is due at', () => {
		expect(openSubclassChoices(paladin(2), graph, named, () => true)).toEqual([]);
		expect(openSubclassChoices(paladin(3), graph, named, () => true)).toEqual([
			{ index: 0, className: 'paladin', level: 3 },
		]);
	});

	it('stays silent when the content offers no subclass to choose', () => {
		// the class declares a subclass level while nothing loaded can fill it: a content problem, and
		// a todo whose click opens an empty pane is not how the builder reports one
		expect(openSubclassChoices(paladin(5), graph, named, () => false)).toEqual([]);
	});

	it('is done once one is chosen', () => {
		const chosen = [{ classId: 'paladin', subclassId: 'devotion', level: 5 }];
		expect(openSubclassChoices(chosen, graph, named, () => true)).toEqual([]);
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
		originFeat: { name: '', owed: 0 },
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
	it('an under-cap spell line is a nudge, not a block, when the picker has nothing in it', () => {
		// a pack whose spells claim no class (srd-2014 ships exactly that) leaves the Strict pool empty:
		// a REQUIRED todo would block Create on a choice with no options behind it
		const profile = { className: 'Cleric', cantripCap: 4, preparedCap: 8 };
		const emptyPicker = [
			{ profile, groups: [], cantripsChosen: 0, leveledChosen: 0 }
		] as unknown as BuildTodoInput['spellPicker'];
		expect(buildTodos({ ...done, spellPicker: emptyPicker }).map((t) => t.required)).toEqual([
			false,
			false
		]);
		// …and with a pool it is required again, per tier: cantrips pickable, leveled not
		const cantripsOnly = [
			{
				profile,
				groups: [{ level: 0, spells: [{}] }],
				cantripsChosen: 0,
				leveledChosen: 0
			}
		] as unknown as BuildTodoInput['spellPicker'];
		expect(buildTodos({ ...done, spellPicker: cantripsOnly }).map((t) => t.required)).toEqual([
			true,
			false
		]);
	});
	it('a granted origin feat that still asks something is one line, naming the feat', () => {
		expect(buildTodos({ ...done, originFeat: { name: 'Skilled', owed: 3 } })[0]).toMatchObject({
			kind: 'originFeat',
			key: 'originFeat',
			values: { feat: 'Skilled', count: 3 },
			required: true
		});
		// nothing left to choose — a granted feat is not a todo just for being granted
		expect(kinds({ ...done, originFeat: { name: 'Alert', owed: 0 } })).toEqual([]);
	});
});


describe('classFeatureLines', () => {
	const feature = (over: Record<string, unknown>, system = '5.5e') => ({
		...makeRow('class_feature', { class_id: 'cleric', ...over }),
		systems: [system]
	});
	const rows = [
		feature({ id: 'channel_divinity', level: 2 }),
		feature({ id: 'destroy_undead', level: 5 }),
		feature({ id: 'blessed_strikes', level: 7 }),
		feature({ id: 'warding_flare', level: 1, subclass_id: 'light' }),
		feature({ id: 'radiance_of_dawn', level: 2, subclass_id: 'life' }),
		feature({ id: 'older_edition_only', level: 1 }, '5e')
	];
	// the subclass gate matches the feature's bare `subclass_id` against the chosen row's own `id`,
	// never against the ref the draft holds — the drift that made every subclass feature miss
	const graph = {
		get: (id: string) =>
			id === 'cleric'
				? makeRow('class', { id: 'cleric' })
				: id === 'subclass:SRD 5.2.1:light'
					? makeRow('subclass', { id: 'light' })
					: undefined,
		featuresForClass: () => rows
	} as unknown as ContentGraph;
	const lines = (over: Partial<{ subclassId: string | null; level: number }> = {}) =>
		classFeatureLines({
			classes: [{ classId: 'cleric', subclassId: null, level: 5, ...over }],
			graph,
			system: '5.5e',
			nameOf: (row: LoadedRow) => String(row.data.id)
		});

	it('marks what the level has reached as gained, and the look-ahead as not', () => {
		expect(lines().map((l) => [String(l.row.data.id), l.level, l.gained])).toEqual([
			['channel_divinity', 2, true],
			['destroy_undead', 5, true],
			['blessed_strikes', 7, false] // within the 3-level look-ahead
		]);
	});

	it("shows only the chosen subclass's features, and says they came from it", () => {
		const light = lines({ subclassId: 'subclass:SRD 5.2.1:light' });
		expect(light.map((l) => String(l.row.data.id))).toContain('warding_flare');
		expect(light.find((l) => l.row.data.id === 'warding_flare')?.fromSubclass).toBe(true);
		expect(light.map((l) => String(l.row.data.id))).not.toContain('radiance_of_dawn');
	});

	it("drops a feature belonging to the other edition", () => {
		expect(lines().map((l) => String(l.row.data.id))).not.toContain('older_edition_only');
	});

	it('stops the look-ahead where the caller says', () => {
		const near = classFeatureLines({
			classes: [{ classId: 'cleric', subclassId: null, level: 5 }],
			graph,
			system: '5.5e',
			nameOf: (row: LoadedRow) => String(row.data.id),
			lookaheadLevels: 1
		});
		expect(near.map((l) => l.level)).toEqual([2, 5]);
	});
});

describe('buildSpellPicker', () => {
	const spell = (id: string, level: number) => makeRow('spell', { id, level });
	const fireBolt = spell('fire_bolt', 0);
	const cureWounds = spell('cure_wounds', 1);
	const fireball = spell('fireball', 3);
	const wish = spell('wish', 9);
	const allSpells = [fireBolt, cureWounds, fireball, wish];
	const graph = {
		get: (id: string) => allSpells.find((s) => s.effectiveId === id)
	} as unknown as ContentGraph;
	const caster = (
		classId: string,
		access: LoadedRow[],
		maxSpellLevel: number,
		saveDC: number
	) => ({
		classId,
		accessSpellIds: access.map((s) => s.effectiveId),
		maxSpellLevel,
		saveDC: { value: saveDC }
	});
	const sheetOf = (...classes: ReturnType<typeof caster>[]) =>
		({ spellcasting: { classes } }) as unknown as CharacterSheet;

	it('Strict offers the class list up to the highest slot the character has', () => {
		const picker = buildSpellPicker({
			allSpells,
			sheet: sheetOf(caster('wizard', [fireBolt, fireball, wish], 3, 15)),
			graph,
			strict: true,
			selectedSpells: []
		});
		expect(picker[0]?.groups.map((g) => g.level)).toEqual([0, 3]); // wish is past maxSpellLevel
		expect(picker[0]?.groups[1]?.spells.map((s) => s.id)).toEqual(['fireball']);
	});

	it('Free lifts both gates', () => {
		const picker = buildSpellPicker({
			allSpells,
			sheet: sheetOf(caster('wizard', [fireBolt], 3, 15)),
			graph,
			strict: false,
			selectedSpells: []
		});
		expect(picker[0]?.groups.map((g) => g.level)).toEqual([0, 1, 3, 9]);
	});

	it('charges a spell on two class lists to ONE class, the same one the play sheet does', () => {
		// RV1/B11: Cure Wounds is on both lists; `casterForSpell` gives it to the higher save DC, and
		// the other class's tally must not count it a second time
		const picker = buildSpellPicker({
			allSpells,
			sheet: sheetOf(
				caster('cleric', [cureWounds], 3, 16),
				caster('wizard', [cureWounds, fireBolt], 3, 14)
			),
			graph,
			strict: true,
			selectedSpells: [cureWounds.effectiveId, fireBolt.effectiveId]
		});
		expect(picker[0]?.leveledChosen).toBe(1); // the cleric holds Cure Wounds
		expect(picker[1]?.leveledChosen).toBe(0);
		expect(picker[1]?.cantripsChosen).toBe(1); // and the wizard its own cantrip
	});

	it('a non-caster gets no picker at all', () => {
		expect(
			buildSpellPicker({ allSpells, sheet: sheetOf(), graph, strict: true, selectedSpells: [] })
		).toEqual([]);
	});
});

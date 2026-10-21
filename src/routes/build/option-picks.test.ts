/*
 * A class feature's options in the builder, against the shipped packs. SRD 5.1 ▸ Warlock: "At 2nd
 * level, you gain two eldritch invocations of your choice", growing down the Invocations Known
 * column; "At 3rd level … You gain one of the following features of your choice" (Pact Boon); and
 * "If an eldritch invocation has prerequisites, you must meet them to learn it."
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { OPTION_BLOCK } from '$lib/content/options';
import { build } from './build-view-model.svelte';
import { newClassRow } from './draft';
import type { FeatureChoice } from './option-picks.svelte';

const BOON = 'warlock_pact_boon';
const INVOCATIONS = 'warlock_eldritch_invocations';

async function draftWarlock(level: number) {
	build.reset();
	build.graph = await loadPacks('srd-2014');
	build.draft.system = '5e';
	build.draft.name = 'Valen';
	build.draft.classes = [
		{ ...newClassRow(), classId: 'class:SRD 5.1:warlock', subclassId: null, level },
	];
}

const choiceOf = (feature: string): FeatureChoice => {
	const choice = build.optionPicks.choices.find((c) => c.feature.id === feature);
	if (!choice) throw new Error(`${feature} asks for nothing`);
	return choice;
};
const optionOf = (choice: FeatureChoice, id: string) => {
	const option = choice.options.find((o) => o.id === id);
	if (!option) throw new Error(`no option ${id}`);
	return option;
};
const pick = (feature: string, id: string) => {
	const choice = choiceOf(feature);
	build.optionPicks.toggle(choice, optionOf(choice, id));
};

describe('feature options · the builder asks for what the feature row says to choose', () => {
	it('asks nothing at level 1, two invocations at 2, a boon at 3, and follows the table', async () => {
		await draftWarlock(1);
		expect(build.optionPicks.choices).toEqual([]);
		expect(build.todos.map((t) => t.kind)).not.toContain('options');

		await draftWarlock(2);
		expect(build.optionPicks.choices.map((c) => [c.feature.id, c.cap])).toEqual([[INVOCATIONS, 2]]);
		expect(choiceOf(INVOCATIONS).options).toHaveLength(32);
		expect(build.todos.find((t) => t.kind === 'options')?.values).toEqual({ count: 2 });

		await draftWarlock(3);
		expect(choiceOf(BOON).cap).toBe(1);
		expect(choiceOf(BOON).options.map((o) => o.id)).toEqual([
			'pact_of_the_chain',
			'pact_of_the_blade',
			'pact_of_the_tome',
		]);
		for (const [level, known] of [[5, 3], [7, 4], [9, 5], [12, 6], [15, 7], [18, 8], [20, 8]]) {
			build.draft.classes = build.draft.classes.map((c) => ({ ...c, level: level ?? 1 }));
			expect(choiceOf(INVOCATIONS).cap).toBe(known);
		}
	});

	it('stores a pick under its feature, and a boon replaces the boon it had', async () => {
		await draftWarlock(3);
		pick(BOON, 'pact_of_the_chain');
		pick(INVOCATIONS, 'beguiling_influence');
		expect(build.assembled.build.options).toEqual({
			[INVOCATIONS]: ['beguiling_influence'],
			[BOON]: ['pact_of_the_chain'],
		});
		expect(build.todos.find((t) => t.kind === 'options')?.values).toEqual({ count: 1 });
		pick(BOON, 'pact_of_the_tome');
		expect(choiceOf(BOON).picks).toEqual(['pact_of_the_tome']);
		pick(BOON, 'pact_of_the_tome');
		expect(choiceOf(BOON).picks).toEqual([]);
	});

	it('holds an invocation to its level and to the boon it names in Strict, and notes it in Free', async () => {
		await draftWarlock(3);
		const invocations = () => choiceOf(INVOCATIONS);
		const block = (id: string) =>
			build.optionPicks.blockOf(invocations(), optionOf(invocations(), id));
		expect(block('ascendant_step')).toBe(OPTION_BLOCK.level);
		expect(block('book_of_ancient_secrets')).toBe(OPTION_BLOCK.requires);
		expect(block('armor_of_shadows')).toBeNull();

		build.draft.strict = true;
		pick(INVOCATIONS, 'book_of_ancient_secrets');
		expect(invocations().picks).toEqual([]);
		pick(BOON, 'pact_of_the_tome');
		expect(block('book_of_ancient_secrets')).toBeNull();
		pick(INVOCATIONS, 'book_of_ancient_secrets');
		expect(invocations().picks).toEqual(['book_of_ancient_secrets']);

		build.draft.strict = false;
		pick(INVOCATIONS, 'ascendant_step');
		expect(invocations().picks).toEqual(['book_of_ancient_secrets', 'ascendant_step']);
	});

	it('2024: a druid chooses one of Elemental Fury’s two at level 7', async () => {
		build.reset();
		build.graph = await loadPacks('srd-2024');
		build.draft.system = '5.5e';
		const cls = (id: string, level: number) => ({
			...newClassRow(),
			classId: `class:SRD 5.2.1:${id}`,
			subclassId: null,
			level,
		});
		build.draft.classes = [cls('druid', 6)];
		expect(build.optionPicks.choices.map((c) => c.feature.id)).toEqual(['druid_primal_order']);
		build.draft.classes = [cls('druid', 7)];
		expect(choiceOf('druid_elemental_fury').options.map((o) => o.id)).toEqual([
			'potent_spellcasting',
			'primal_strike',
		]);
		expect(choiceOf('druid_elemental_fury').cap).toBe(1);
	});

	it('2024: a cleric chooses a Divine Order at 1 and Blessed Strikes at 7; a druid a Primal Order at 1', async () => {
		build.reset();
		build.graph = await loadPacks('srd-2024');
		build.draft.system = '5.5e';
		const cls = (id: string, level: number) => [
			{ ...newClassRow(), classId: `class:SRD 5.2.1:${id}`, subclassId: null, level },
		];
		build.draft.classes = cls('cleric', 1);
		expect(build.optionPicks.choices.map((c) => c.feature.id)).toEqual(['cleric_divine_order']);
		expect(choiceOf('cleric_divine_order').options.map((o) => o.id)).toEqual([
			'protector',
			'thaumaturge',
		]);
		build.draft.classes = cls('cleric', 7);
		expect(choiceOf('cleric_blessed_strikes').options.map((o) => o.id)).toEqual([
			'divine_strike',
			'cleric_potent_spellcasting',
		]);
		build.draft.classes = cls('druid', 1);
		expect(choiceOf('druid_primal_order').options.map((o) => o.id)).toEqual(['magician', 'warden']);
	});

	/*
	 * SRD 5.2.1 ▸ Warlock ▸ Eldritch Invocations: "You gain one invocation of your choice, such as Pact
	 * of the Tome", growing down the Invocations column of the Warlock Features table; "if an
	 * invocation requires you to be a level 5+ Warlock, you can select the invocation once you reach
	 * Warlock level 5."
	 */
	it('2024: a warlock is asked one invocation at level 1, and the Invocations column after it', async () => {
		build.reset();
		build.graph = await loadPacks('srd-2024');
		build.draft.system = '5.5e';
		const warlockAt = (level: number) => [
			{ ...newClassRow(), classId: 'class:SRD 5.2.1:warlock', subclassId: null, level },
		];
		build.draft.classes = warlockAt(1);
		expect(choiceOf(INVOCATIONS).options).toHaveLength(28);
		for (const [level, known] of [[1, 1], [2, 3], [5, 5], [7, 6], [9, 7], [12, 8], [15, 9], [18, 10], [20, 10]]) {
			build.draft.classes = warlockAt(level ?? 1);
			expect(choiceOf(INVOCATIONS).cap, `level ${level}`).toBe(known);
		}

		build.draft.classes = warlockAt(5);
		const block = (id: string) =>
			build.optionPicks.blockOf(choiceOf(INVOCATIONS), optionOf(choiceOf(INVOCATIONS), id));
		expect(block('witch_sight')).toBe(OPTION_BLOCK.level);
		expect(block('thirsting_blade')).toBe(OPTION_BLOCK.requires);
		expect(block('pact_of_the_blade')).toBeNull();
		pick(INVOCATIONS, 'pact_of_the_blade');
		expect(block('thirsting_blade')).toBeNull();
	});
});

/*
 * SRD 5.1 ▸ Fighter, Paladin and Ranger ▸ Fighting Style: "Choose one of the following options. You
 * can't take a Fighting Style option more than once, even if you later get to choose again." ▸
 * Champion: "At 10th level, you can choose a second option from the Fighting Style class feature."
 */
describe('feature options · a 2014 Fighting Style is one row offered by several features', () => {
	const STYLE = 'fighter_fighting_style';
	const SECOND = 'champion_additional_fighting_style';
	const draftFighter = async (level: number, extra: { classId: string; level: number }[] = []) => {
		build.reset();
		build.graph = await loadPacks('srd-2014');
		build.draft.system = '5e';
		build.draft.name = 'Kel';
		build.draft.classes = [
			{
				...newClassRow(),
				classId: 'class:SRD 5.1:fighter',
				subclassId: level >= 3 ? 'subclass:SRD 5.1:champion' : null,
				level,
			},
			...extra.map((c) => ({ ...newClassRow(), subclassId: null, ...c })),
		];
	};

	it('each feature offers the styles its own list names', async () => {
		await draftFighter(1, [
			{ classId: 'class:SRD 5.1:paladin', level: 2 },
			{ classId: 'class:SRD 5.1:ranger', level: 2 },
		]);
		const ids = (feature: string) => choiceOf(feature).options.map((o) => o.id);
		expect(ids(STYLE)).toEqual([
			'archery',
			'defense',
			'dueling',
			'great_weapon_fighting',
			'protection',
			'two_weapon_fighting',
		]);
		expect(ids('paladin_fighting_style')).toEqual([
			'defense',
			'dueling',
			'great_weapon_fighting',
			'protection',
		]);
		expect(ids('ranger_fighting_style')).toEqual([
			'archery',
			'defense',
			'dueling',
			'two_weapon_fighting',
		]);
	});

	it("a Champion's second pick is one of the Fighter's, and never the one already taken", async () => {
		await draftFighter(10);
		expect(choiceOf(SECOND).options).toHaveLength(6);
		pick(STYLE, 'defense');
		const second = choiceOf(SECOND);
		expect(build.optionPicks.blockOf(second, optionOf(second, 'defense'))).toBe(OPTION_BLOCK.taken);
		expect(build.optionPicks.canToggle(second, optionOf(second, 'defense'))).toBe(false);
		pick(SECOND, 'archery');
		expect(build.optionPicks.picks).toMatchObject({ [STYLE]: ['defense'], [SECOND]: ['archery'] });
	});
});

/*
 * SRD 5.1 ▸ Sorcerer ▸ Metamagic: "You gain two of the following Metamagic options of your choice.
 * You gain another one at 10th and 17th level." SRD 5.2.1: "you gain two Metamagic options of your
 * choice … You gain two more options at Sorcerer level 10 and two more at Sorcerer level 17."
 */
describe.each([
	['srd-2014', '5e', 'SRD 5.1', 8, [[3, 2], [10, 3], [17, 4]]],
	['srd-2024', '5.5e', 'SRD 5.2.1', 10, [[2, 2], [10, 4], [17, 6]]],
] as const)('feature options · Metamagic (%s)', (pack, system, source, offered, ladder) => {
	it('asks the options the edition prints, as many as its sorcerer level allows', async () => {
		for (const [level, cap] of ladder) {
			build.reset();
			build.graph = await loadPacks(pack);
			build.draft.system = system;
			build.draft.name = 'Ash';
			build.draft.classes = [
				{ ...newClassRow(), classId: `class:${source}:sorcerer`, subclassId: null, level },
			];
			const metamagic = choiceOf('sorcerer_metamagic');
			expect(metamagic.options).toHaveLength(offered);
			expect(metamagic.cap).toBe(cap);
		}
	});
});

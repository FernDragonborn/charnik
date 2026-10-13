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

	it('2024 ships no option of a class feature yet, so its warlock is asked nothing here', async () => {
		build.reset();
		build.graph = await loadPacks('srd-2024');
		build.draft.system = '5.5e';
		build.draft.classes = [
			{ ...newClassRow(), classId: 'class:SRD 5.2.1:warlock', subclassId: null, level: 5 },
		];
		expect(build.optionPicks.choices).toEqual([]);
	});
});

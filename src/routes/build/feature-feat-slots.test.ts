/*
 * A feat slot a CLASS FEATURE opens, against the shipped 2024 pack. SRD 5.2.1 ▸ Fighter ▸ Fighting
 * Style: "You have honed your martial prowess and gain a Fighting Style feat of your choice";
 * Champion ▸ Additional Fighting Style: "You gain another Fighting Style feat of your choice."
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { build } from './build-view-model.svelte';
import { newClassRow } from './draft';

const S = 'SRD 5.2.1';

async function draftClass(cls: string, level: number, subclass: string | null = null) {
	build.reset();
	build.graph = await loadPacks('srd-2024');
	build.draft.system = '5.5e';
	build.draft.name = 'Kel';
	build.draft.classes = [
		{ ...newClassRow(), classId: `class:${S}:${cls}`, subclassId: subclass, level },
	];
}
const draftFighter = (level: number) =>
	draftClass('fighter', level, level >= 3 ? `subclass:${S}:champion` : null);

const slotOf = (feature: string) => {
	const slot = build.feats.featureSlots.find((s) => s.key.endsWith(`:${feature}`));
	if (!slot) throw new Error(`${feature} opens no slot`);
	return slot;
};

describe('a class feature that grants a feat opens a slot for it', () => {
	it('a 1st-level fighter chooses a Fighting Style feat, and only one of those', async () => {
		await draftFighter(1);
		const slot = slotOf('fighter_fighting_style');
		expect(slot.level).toBe(1);
		expect(build.feats.optionsForSlot(slot.key, 1).map((f) => f.id).sort()).toEqual([
			'archery',
			'defense',
			'great_weapon_fighting',
			'two_weapon_fighting',
		]);
		// a grant is a feat: the improvement is what a level offers
		expect(build.feats.slotOffersAsi(slot.key)).toBe(false);
		expect(build.todos.find((t) => t.slotKey === slot.key)?.key).toBe('featureFeat');
	});

	it('the style taken is a feat of the character, and no level offers it again', async () => {
		await draftFighter(4);
		const slot = slotOf('fighter_fighting_style');
		build.feats.setSlotFeat(slot.key, `feat:${S}:defense`);
		expect(build.todos.find((t) => t.slotKey === slot.key)).toBeUndefined();
		const level4 = build.feats.featSlots.find((s) => s.level === 4);
		expect(level4).toBeDefined();
		expect(build.feats.featOptionBlocked(`feat:${S}:defense`, level4?.key ?? '')).toBe(true);
		expect(build.assembled.build.feats).toContain(`feat:${S}:defense`);
	});

	it("a Champion's second style is a second slot at 7th level", async () => {
		await draftFighter(6);
		expect(build.feats.featureSlots.map((s) => s.level)).toEqual([1]);
		await draftFighter(7);
		expect(build.feats.featureSlots.map((s) => s.level)).toEqual([1, 7]);
	});

	/*
	 * SRD 5.2.1 ▸ Paladin ▸ Fighting Style: "You gain a Fighting Style feat of your choice … Instead of
	 * choosing one of those feats, you can choose the option below." ▸ Blessed Warrior.
	 */
	it("a paladin's slot takes a style or Blessed Warrior, and the warrior is an option, not a feat", async () => {
		await draftClass('paladin', 2);
		const slot = slotOf('paladin_fighting_style');
		const offered = build.feats.optionsForSlot(slot.key, 2).map((row) => row.id);
		expect(offered).toEqual(expect.arrayContaining(['defense', 'blessed_warrior']));
		const warrior = build.feats.optionsForSlot(slot.key, 2).find((row) => row.id === 'blessed_warrior');
		build.feats.setSlotFeat(slot.key, warrior?.effectiveId ?? '');
		// answered: nothing is owed, so the character can be saved
		expect(build.todos.find((t) => t.slotKey === slot.key)).toBeUndefined();
		expect(build.assembled.build.feats).not.toContain(warrior?.effectiveId);
		expect(build.assembled.build.options).toMatchObject({ paladin_fighting_style: ['blessed_warrior'] });
	});

	it("a ranger's slot offers Druidic Warrior the same way", async () => {
		await draftClass('ranger', 2);
		const slot = slotOf('ranger_fighting_style');
		expect(build.feats.optionsForSlot(slot.key, 2).map((row) => row.id)).toContain('druidic_warrior');
	});

	it('a Fighting Style feat needs a Fighting Style feature: a wizard is not offered one', async () => {
		await draftClass('wizard', 4);
		const level4 = build.feats.featSlots.find((s) => s.level === 4);
		const offered = build.feats.optionsForSlot(level4?.key ?? '', 4).map((f) => f.id);
		expect(offered).not.toContain('archery');
		expect(offered).toContain('alert');
		await draftFighter(4);
		const fighter4 = build.feats.featSlots.find((s) => s.level === 4);
		expect(build.feats.optionsForSlot(fighter4?.key ?? '', 4).map((f) => f.id)).toContain('archery');
	});
});

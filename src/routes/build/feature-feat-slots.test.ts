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

async function draftFighter(level: number) {
	build.reset();
	build.graph = await loadPacks('srd-2024');
	build.draft.system = '5.5e';
	build.draft.name = 'Kel';
	build.draft.classes = [
		{
			...newClassRow(),
			classId: `class:${S}:fighter`,
			subclassId: level >= 3 ? `subclass:${S}:champion` : null,
			level,
		},
	];
}

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
});

/*
 * Weapon mastery, against the shipped packs (MASTERY-HALF).
 *
 * `mastery:<name>` has been on every 2024 weapon since the pack was written and was read by nothing.
 * This is the half that reads it: the ladder each class grants, and the rule that the property does
 * NOTHING until one of those picks unlocks that kind of weapon.
 *
 * The ladders are the SRD's own — the Weapon Mastery column of the Barbarian and Fighter Features
 * tables, and a flat two for the three classes whose feature names no table.
 */
import { describe, it, expect } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { masteryBudget } from '../build/derive';
import { newCharacter, characterSchema } from '../character/schema';
import { deriveSheet } from '../character/derive';
import { computeAttacks } from '../combat/attacks';
import { ITEM_TAG, parseItemTags } from './item-tags';

const S = 'SRD 5.2.1';
const entry = (classId: string, level: number) => [
	{ classId: `class:${S}:${classId}`, subclassId: null, level },
];

describe('weapon mastery · the ladder is shipped data', () => {
	it('each class unlocks what its own SRD table says, and 2014 has no such rule', async () => {
		const g2024 = await loadPacks('srd-2024');
		const at = (classId: string, level: number) =>
			masteryBudget(entry(classId, level), g2024, '5.5e');
		expect([at('barbarian', 1), at('barbarian', 4), at('barbarian', 10)]).toEqual([2, 3, 4]);
		expect([at('fighter', 1), at('fighter', 4), at('fighter', 10), at('fighter', 16)]).toEqual([
			3, 4, 5, 6,
		]);
		// the three whose feature names no table stay flat
		for (const classId of ['paladin', 'ranger', 'rogue'])
			expect([at(classId, 1), at(classId, 20)]).toEqual([2, 2]);
		expect(at('wizard', 20)).toBe(0);

		const g2014 = await loadPacks('srd-2014');
		expect(masteryBudget(entry('fighter', 20), g2014, '5e')).toBe(0);
	});

	it('every 2024 weapon carries a mastery property, and no 2014 weapon does', async () => {
		const withMastery = async (pack: string, system: '5e' | '5.5e') => {
			const graph = await loadPacks(pack);
			const weapons = graph
				.list('item', { system })
				.filter((r) => r.data.category === 'weapon' && !r.data.base_item_id);
			return weapons.filter((r) => parseItemTags(r.data.tags).get(ITEM_TAG.mastery)).length;
		};
		expect(await withMastery('srd-2024', '5.5e')).toBeGreaterThan(0);
		expect(await withMastery('srd-2014', '5e')).toBe(0);
	});
});

describe('weapon mastery · the attack row says it only when the character may use it', () => {
	it('a greataxe prints its mastery once the kind is drilled, and not before', async () => {
		const graph = await loadPacks('srd-2024');
		const character = characterSchema.parse(newCharacter('grog', 'Grog', '5.5e'));
		character.build.classes = [{ class: `class:${S}:barbarian`, level: 1 }];
		character.build.inventory = [
			{ item: `item:${S}:greataxe`, qty: 1, equipped: true, attuned: false },
		];

		const rowFor = () => {
			const sheet = deriveSheet(character, graph);
			return computeAttacks(character, sheet, graph).find((a) => a.id === 'greataxe');
		};
		const before = rowFor();
		expect(before, 'the greataxe is an attack row').toBeDefined();
		expect(before?.meta.mastery).toBeUndefined();

		// a weapon whose ONLY property is its mastery (mace, flail, morningstar) says nothing extra
		// rather than advertising a property the character cannot use
		expect(before?.meta.property).toBeDefined(); // the greataxe has `heavy`/`two_handed` besides

		character.build.masteries = ['greataxe'];
		// the shipped property, whatever the pack says it is — not a name from memory
		const greataxe = graph.get(`item:${S}:greataxe`);
		const shipped =
			greataxe?.type === 'item' ? parseItemTags(greataxe.data.tags).get(ITEM_TAG.mastery) : '';
		expect(rowFor()?.meta.mastery).toBe(shipped);
	});

	it('a weapon whose only property IS the mastery advertises nothing until it is drilled', async () => {
		const graph = await loadPacks('srd-2024');
		const character = characterSchema.parse(newCharacter('grog', 'Grog', '5.5e'));
		character.build.classes = [{ class: `class:${S}:fighter`, level: 1 }];
		character.build.inventory = [
			{ item: `item:${S}:mace`, qty: 1, equipped: true, attuned: false },
		];
		const rowFor = () =>
			computeAttacks(character, deriveSheet(character, graph), graph).find((a) => a.id === 'mace');

		expect(rowFor()?.meta.property).toBeUndefined();
		expect(rowFor()?.meta.mastery).toBeUndefined();

		character.build.masteries = ['mace'];
		expect(rowFor()?.meta.mastery).toBeTruthy();
	});
});

/** SRD 5.1, Dwarf ▸ Speed: "Your speed is not reduced by wearing heavy armor." Anybody else in armour
 *  too heavy for their Strength loses 10 feet. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, inventoryRow, newCharacter, type Character } from './schema';
import { deriveSheet } from './derive';
import type { ContentGraph } from '$lib/content/loader';

const S = 'SRD 5.1';

describe('5e · chain mail on Strength 10', () => {
	let graph: ContentGraph;
	beforeAll(async () => {
		graph = await loadPacks('srd-2014');
	});
	const cleric = (species: string): Character => {
		const c = newCharacter('armour_probe', 'Armour probe', '5e');
		c.build.species = `species:${S}:${species}`;
		c.build.classes = [classRow({ class: `class:${S}:cleric`, level: 1 })];
		c.build.abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
		c.build.inventory = [
			inventoryRow({ item: `item:${S}:chain_mail`, qty: 1, equipped: true, attuned: false }),
		];
		return c;
	};

	it('does not slow a Dwarf', () => {
		expect(deriveSheet(cleric('dwarf'), graph).speed.value).toBe(25);
	});

	it('slows a Human by 10 feet', () => {
		expect(deriveSheet(cleric('human'), graph).speed.value).toBe(20);
	});
});

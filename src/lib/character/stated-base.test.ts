import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, inventoryRow, newCharacter } from './schema';
import { deriveSheet } from './derive';
import { contributionText } from '../combat/effects-view';
import { shownTrace } from '../combat/shown-trace';
import type { ContentGraph } from '../content/loader';

describe.each([
	['srd-2014', '5e', 'SRD 5.1'],
	['srd-2024', '5.5e', 'SRD 5.2.1'],
] as const)('base Armor Class on the shipped rows (%s)', (pack, system, source) => {
	let graph: ContentGraph;
	beforeAll(async () => {
		graph = await loadPacks(pack);
	});
	const item = (id: string, extra = {}) =>
		inventoryRow({ item: `item:${source}:${id}`, equipped: true, attuned: true, ...extra });
	const character = (cls: string, items: ReturnType<typeof item>[]) => {
		const ch = newCharacter('probe', 'Probe', system);
		ch.build.classes = [classRow({ class: `class:${source}:${cls}`, level: 1 })];
		ch.build.abilities = { ...ch.build.abilities, dex: 14, con: 16, wis: 16 };
		ch.build.inventory = items;
		return deriveSheet(ch, graph).ac.value;
	};

	it('a barbarian keeps the shield and the cloak — RAW: "You can use a Shield and still gain this benefit"', () => {
		expect(character('barbarian', [])).toBe(15);
		expect(character('barbarian', [item('shield')])).toBe(17);
		expect(character('barbarian', [item('cloak_of_protection')])).toBe(16);
	});

	it('reads in the order it folds, one part per item: the base, then a Shield +2 as +4', () => {
		const ch = newCharacter('probe', 'Probe', system);
		ch.build.classes = [classRow({ class: `class:${source}:barbarian`, level: 1 })];
		ch.build.abilities = { ...ch.build.abilities, dex: 14, con: 16 };
		ch.build.inventory = [item('shield_1_2_or_3', { bonus: 2 }), item('cloak_of_protection')];
		const ac = deriveSheet(ch, graph).ac;
		expect(ac.value).toBe(15 + 4 + 1);
		expect(shownTrace(ac).map((t) => contributionText(t))).toEqual([
			'Unarmored Defense = 15',
			'Shield +2 +4',
			'Cloak of Protection +1',
		]);
	});

	it('one carried item is one part, however many ways it reaches the number', () => {
		const plate = system === '5e' ? 'plate' : 'plate_armor'; // the two SRDs' ids for it
		const parts = (items: ReturnType<typeof item>[]) => {
			const ch = newCharacter('probe', 'Probe', system);
			ch.build.abilities = { ...ch.build.abilities, dex: 14 };
			ch.build.inventory = items;
			return shownTrace(deriveSheet(ch, graph).ac).map((t) => contributionText(t));
		};
		// the plate's own 18 and its +3 are one part, and heavy armour's ignored DEX is no part at all
		const plateName = graph.get(`item:${source}:${plate}`)?.data.name_en;
		expect(parts([item('armor_1_2_or_3', { base: `item:${source}:${plate}`, bonus: 3 })])).toEqual([
			`${plateName} +3 +21`,
		]);
		// two different items stay two parts
		expect(parts([item('shield'), item('cloak_of_protection')])).toEqual([
			'Base +10',
			'DEX mod +2',
			'Shield +2',
			'Cloak of Protection +1',
		]);
	});

	it('a monk with a shield has no Unarmored Defense at all', () => {
		expect(character('monk', [])).toBe(15);
		expect(character('monk', [item('shield')])).toBe(14); // 10 + DEX 2 + the shield's 2
	});
});

describe('a stated BASE speed keeps the bonuses after it (2024)', () => {
	let graph: ContentGraph;
	beforeAll(async () => {
		graph = await loadPacks('srd-2024');
	});
	const S = 'SRD 5.2.1';
	const woodElf = (cls?: { id: string; level: number }) => {
		const ch = newCharacter('probe', 'Probe', '5.5e');
		ch.build.species = `species:${S}:elf`;
		ch.build.speciesOption = `species_option:${S}:elf_wood_elf`;
		if (cls) ch.build.classes = [classRow({ class: `class:${S}:${cls.id}`, level: cls.level })];
		return ch;
	};

	it('a Wood Elf walks 35, and a monk’s Unarmored Movement still adds to it', () => {
		expect(deriveSheet(woodElf(), graph).speed.value).toBe(35);
		expect(deriveSheet(woodElf({ id: 'monk', level: 2 }), graph).speed.value).toBe(45);
	});

	it('a Ring of Swimming is a swim speed of 40, a Cloak of the Manta Ray of 60', () => {
		const swimWith = (id: string) => {
			const ch = woodElf();
			ch.build.inventory = [
				inventoryRow({ item: `item:${S}:${id}`, equipped: true, attuned: true }),
			];
			return deriveSheet(ch, graph).swimSpeed.value;
		};
		expect(swimWith('ring_of_swimming')).toBe(40);
		expect(swimWith('cloak_of_the_manta_ray')).toBe(60);
	});
});

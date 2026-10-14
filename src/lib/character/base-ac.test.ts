import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, inventoryRow, newCharacter } from './schema';
import { deriveSheet } from './derive';
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

	it('a monk with a shield has no Unarmored Defense at all', () => {
		expect(character('monk', [])).toBe(15);
		expect(character('monk', [item('shield')])).toBe(14); // 10 + DEX 2 + the shield's 2
	});
});

/*
 * The `starting_equipment` grammar, and the kits both shipped packs carry: every class and every
 * background has one, and nothing a kit names is missing from its own edition.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import type { ContentGraph } from './loader';
import {
	KIT_PART,
	kitCoins,
	kitItemsById,
	kitOf,
	matchesAny,
	parseStartingKit,
	startingKitIssues,
} from './starting-equipment';

describe('parseStartingKit', () => {
	it('reads lines, alternatives, counts, coins, picks and the proficiency mark', () => {
		const [first, second] = parseStartingKit(
			'mace | warhammer?; 2*any.simple,melee + 15gp | any.artisans_tools/musical_instrument',
		);
		expect(first?.alternatives.map((a) => a.parts)).toEqual([
			[{ kind: KIT_PART.item, id: 'mace', count: 1, ifProficient: false }],
			[{ kind: KIT_PART.item, id: 'warhammer', count: 1, ifProficient: true }],
		]);
		expect(second?.alternatives.map((a) => a.parts)).toEqual([
			[
				{ kind: KIT_PART.any, tagSets: [['simple', 'melee']], count: 2 },
				{ kind: KIT_PART.coin, coin: 'gp', amount: 15 },
			],
			[{ kind: KIT_PART.any, tagSets: [['artisans_tools'], ['musical_instrument']], count: 1 }],
		]);
	});

	it('keeps a part it cannot read as its own text, and a blank cell is no kit', () => {
		expect(parseStartingKit('Chain Mail + 0*dagger')[0]?.alternatives[0]?.parts).toEqual([
			{ kind: KIT_PART.unread, text: 'Chain Mail' },
			{ kind: KIT_PART.unread, text: '0*dagger' },
		]);
		expect(parseStartingKit('')).toEqual([]);
		expect(parseStartingKit(undefined)).toEqual([]);
	});

	it('sums an alternative’s coins by coin', () => {
		const [line] = parseStartingKit('5sp + 10gp + 3gp');
		expect(kitCoins(line?.alternatives[0] ?? { parts: [] })).toEqual({ sp: 5, gp: 13 });
	});
});

const EDITIONS = [
	{ system: '5e', pack: 'srd-2014', classes: 12, backgrounds: 1 },
	{ system: '5.5e', pack: 'srd-2024', classes: 12, backgrounds: 4 },
] as const;

describe.each(EDITIONS)('the shipped kits — $system', ({ system, pack, classes, backgrounds }) => {
	let graph: ContentGraph;
	beforeAll(async () => {
		graph = await loadPacks(pack);
	});

	it('every class and every background hands one out', () => {
		const classRows = graph.list('class', { system });
		const backgroundRows = graph.list('background', { system });
		expect(classRows).toHaveLength(classes);
		expect(backgroundRows).toHaveLength(backgrounds);
		for (const row of [...classRows, ...backgroundRows]) expect(kitOf(row), row.id).not.toEqual([]);
	});

	it('names nothing its edition is missing', () => {
		expect(startingKitIssues(graph, system)).toEqual([]);
	});

	it('answers a pick only with the mundane items carrying its words', () => {
		const items = kitItemsById(graph, system, () => true);
		const simpleMelee = [...items.values()].filter((row) =>
			matchesAny(graph, row, [['simple', 'melee']]),
		);
		expect(simpleMelee.map((row) => row.id)).toContain('dagger');
		expect(simpleMelee.map((row) => row.id)).not.toContain('longsword');
		expect(simpleMelee.every((row) => !row.data.rarity)).toBe(true);
	});
});

describe('transcribed kits', () => {
	it('SRD 5.2.1 Fighter: (C) is 155 GP and nothing else', async () => {
		const graph = await loadPacks('srd-2024');
		const fighter = graph.list('class', { system: '5.5e' }).find((row) => row.id === 'fighter');
		const [line] = kitOf(fighter);
		expect(line?.alternatives).toHaveLength(3);
		expect(line?.alternatives[2]?.parts).toEqual([
			{ kind: KIT_PART.coin, coin: 'gp', amount: 155 },
		]);
	});

	it('SRD 5.1 Cleric: chain mail only if proficient', async () => {
		const graph = await loadPacks('srd-2014');
		const cleric = graph.list('class', { system: '5e' }).find((row) => row.id === 'cleric');
		expect(kitOf(cleric)[1]?.alternatives[2]?.parts).toEqual([
			{ kind: KIT_PART.item, id: 'chain_mail', count: 1, ifProficient: true },
		]);
	});
});

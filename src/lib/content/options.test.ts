/*
 * A row's OPTIONS against the shipped packs: an item's varieties fold the answer its inventory
 * entry gave, and what a character chose of a class feature is folded, listed and — where the
 * option says so — the source of that class's rituals.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { characterSchema, classRow, inventoryRow, newCharacter } from '../character/schema';
import { deriveSheet } from '../character/derive';
import { characterFeatures } from '../character/features';
import { rowName, type ContentGraph } from './loader';
import { groupRows } from './grouping';
import { itemRarities, optionJoinIssues, optionNamed, optionsOf } from './options';

const EDITIONS = [
	{ system: '5e', source: 'SRD 5.1', pack: 'srd-2014' },
	{ system: '5.5e', source: 'SRD 5.2.1', pack: 'srd-2024' },
] as const;

describe.each(EDITIONS)(
	'an item whose varieties are rows — $system',
	({ system, source, pack }) => {
		let graph: ContentGraph;
		beforeAll(async () => {
			graph = await loadPacks(pack);
		});

		const BELT = `item:${source}:belt_of_giant_strength`;
		const wearing = (choice: string | undefined, attuned = true) => {
			const c = newCharacter('b', 'Belt', system);
			c.build.classes = [classRow({ class: `class:${source}:fighter`, level: 1 })];
			c.build.abilities = { str: 12, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
			c.build.inventory = [
				inventoryRow({
					item: BELT,
					qty: 1,
					equipped: true,
					attuned,
					...(choice ? { choice } : {}),
				}),
			];
			return deriveSheet(characterSchema.parse(c), graph);
		};

		it('offers the five belts its table prints, each with a rarity of its own', () => {
			const belt = graph.get(BELT);
			if (!belt) throw new Error('no belt');
			const varieties = optionsOf(graph, belt);
			expect(varieties.map((v) => v.data.rarity)).toEqual([
				'rare',
				'very_rare',
				'very_rare',
				'legendary',
				'legendary',
			]);
			expect(optionNamed(graph, belt, 'no_such_belt')).toBeUndefined();
		});

		it('sets Strength to the score the chosen variety states, under the variety’s name', () => {
			const belt = graph.get(BELT);
			const hill = belt && optionNamed(graph, belt, 'belt_of_hill_giant_strength');
			if (!hill) throw new Error('no hill giant belt');
			const sheet = wearing('belt_of_hill_giant_strength');
			expect(sheet.abilities.str.score.value).toBe(21);
			expect(sheet.abilities.str.score.trace.map((t) => t.source)).toContain(rowName(hill));
			expect(wearing('belt_of_storm_giant_strength').abilities.str.score.value).toBe(29);
			expect(sheet.deriveIssues).toEqual([]);
		});

		it('an Ioun Stone raises a score by 2 and stops at 20', () => {
			const dexWith = (dex: number) => {
				const c = newCharacter('i', 'Ioun', system);
				c.build.classes = [classRow({ class: `class:${source}:fighter`, level: 1 })];
				c.build.abilities = { str: 10, dex, con: 10, int: 10, wis: 10, cha: 10 };
				c.build.inventory = [
					inventoryRow({
						item: `item:${source}:ioun_stone`,
						qty: 1,
						equipped: true,
						attuned: true,
						choice: 'ioun_stone_agility',
					}),
				];
				return deriveSheet(characterSchema.parse(c), graph).abilities.dex.score.value;
			};
			expect(dexWith(14)).toBe(16);
			expect(dexWith(19)).toBe(20);
		});

		it('ships no option that points at nothing', () => {
			expect(optionJoinIssues(graph, system)).toEqual([]);
		});

		it('files an entry the book prints once under every rarity it is found at', () => {
			const belt = graph.get(BELT);
			const ladder = graph.get(`item:${source}:weapon_1_2_or_3`);
			if (!belt || !ladder) throw new Error('rows missing');
			expect(itemRarities(belt, graph)).toEqual(['rare', 'very_rare', 'legendary']);
			// a ladder states its rarities on the row, so it needs no graph to say them
			expect(itemRarities(ladder)).toEqual(['uncommon', 'rare', 'very_rare']);
			const groups = groupRows([belt, ladder], 'rarity', { type: 'item', t: (key) => key, graph });
			expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
				['Legendary', ['belt_of_giant_strength']],
				['Rare', ['belt_of_giant_strength', 'weapon_1_2_or_3']],
				['Uncommon', ['weapon_1_2_or_3']],
				['Very Rare', ['belt_of_giant_strength', 'weapon_1_2_or_3']],
			]);
		});

		it('grants nothing until the player says which belt it is, or until it is attuned', () => {
			expect(wearing(undefined).abilities.str.score.value).toBe(12);
			expect(wearing('belt_of_hill_giant_strength', false).abilities.str.score.value).toBe(12);
		});
	},
);

describe('what a character chose of a class feature', () => {
	const S = 'SRD 5.1';
	let graph: ContentGraph;
	beforeAll(async () => {
		graph = await loadPacks('srd-2014');
	});

	const warlock = (options: Record<string, string[]>) => {
		const c = newCharacter('w', 'Warlock', '5e');
		c.build.classes = [classRow({ class: `class:${S}:warlock`, level: 3 })];
		c.build.options = options;
		return characterSchema.parse(c);
	};
	const TOME = {
		warlock_pact_boon: ['pact_of_the_tome'],
		warlock_eldritch_invocations: ['book_of_ancient_secrets', 'beguiling_influence'],
	};

	it('folds an option’s own tokens', () => {
		const sheet = deriveSheet(warlock(TOME), graph);
		expect(sheet.skills.deception.prof).toBe('proficient');
		expect(sheet.skills.persuasion.prof).toBe('proficient');
		expect(deriveSheet(warlock({}), graph).skills.deception.prof).not.toBe('proficient');
	});

	it('lists each as a feature, straight after the feature that asked', () => {
		const names = characterFeatures(warlock(TOME), graph).map((f) => rowName(f.row));
		expect(names.slice(names.indexOf('Pact Boon'), names.indexOf('Pact Boon') + 2)).toEqual([
			'Pact Boon',
			'Pact of the Tome',
		]);
		expect(names).toContain('Book of Ancient Secrets');
		expect(characterFeatures(warlock({}), graph).map((f) => rowName(f.row))).not.toContain(
			'Pact of the Tome',
		);
	});

	it('gives a warlock rituals through the Book of Ancient Secrets, and not without it', () => {
		const withBook = deriveSheet(warlock(TOME), graph).spellcasting;
		expect(withBook.classes[0]?.ritualSource).toBe('prepared');
		expect(withBook.ritualCasting).toBe(true);
		const without = deriveSheet(warlock({ warlock_pact_boon: ['pact_of_the_tome'] }), graph);
		expect(without.spellcasting.classes[0]?.ritualSource).toBeNull();
	});

	it('reports a pick that names no row instead of dropping it', () => {
		const sheet = deriveSheet(warlock({ warlock_pact_boon: ['pact_of_the_moon'] }), graph);
		expect(sheet.missing).toContain('option:pact_of_the_moon');
	});
});

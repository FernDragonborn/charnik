/*
 * Wild Shape, against the shipped packs (N2b). Every number asserted here is the SRD's own:
 *
 * SRD 5.1 ▸ Druid ▸ Wild Shape — "You can use this feature twice. You regain expended uses when you
 * finish a short or long rest"; the Beast Shapes table (2nd: CR 1/4, no flying or swimming speed ·
 * 4th: 1/2, no flying speed · 8th: 1); "you assume the beast's hit points and Hit Dice"; "a number
 * of hours equal to half your druid level (rounded down)"; Archdruid — "an unlimited number of times".
 *
 * SRD 5.2.1 ▸ Druid ▸ Wild Shape — the Wild Shape column of the Druid Features table (2 from level
 * 2, 3 from level 6, 4 from level 17); "You regain one expended use when you finish a Short Rest";
 * the Beast Shapes table (2: 4 known, CR 1/4, no Fly Speed · 4: 6, 1/2 · 8: 8, 1, Fly allowed);
 * "you gain a number of Temporary Hit Points equal to your Druid level"; "you retain your … Hit
 * Points"; Archdruid — "Whenever you roll Initiative and have no uses of Wild Shape left, you regain
 * one expended use of it."
 */
import { describe, it, expect } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import {
	newCharacter,
	characterSchema,
	type Character,
	classRow,
	inventoryRow,
} from '../character/schema';
import { setFormWorn } from '../play/form-shift';
import { deriveSheet } from '../character/derive';
import { isEligibleForm, type MonsterRow } from '../character/forms';
import type { ContentGraph } from './loader';

const EDITIONS = {
	'srd-2014': { source: 'SRD 5.1', system: '5e' },
	'srd-2024': { source: 'SRD 5.2.1', system: '5.5e' },
} as const;
type Pack = keyof typeof EDITIONS;

/** A druid of the given level with a sturdy body of their own: CON 16 (+3), STR 8, DEX 12. */
function druid(pack: Pack, level: number): Character {
	const { source, system } = EDITIONS[pack];
	const c = newCharacter('fern', 'Fern', system);
	c.build.classes = [classRow({ class: `class:${source}:druid`, level })];
	c.build.abilities = { str: 8, dex: 12, con: 16, int: 10, wis: 16, cha: 10 };
	return characterSchema.parse(c);
}

/** The same druid in a form: the play-state that says so, and the carrier effect that names the
 *  stat block — exactly what assuming one writes. */
function shaped(character: Character, pack: Pack, monster: string, hpBefore?: number): Character {
	const ref = `monster:${EDITIONS[pack].source}:${monster}`;
	const c = structuredClone(character);
	c.play.form = {
		id: 'wild_shape',
		monster: ref,
		worn: [],
		...(hpBefore === undefined ? {} : { hpBefore }),
	};
	c.play.effects = [{ iid: 'form', label: monster, source: ref, effects: [], positive: true }];
	return c;
}

const monster = (graph: ContentGraph, pack: Pack, id: string): MonsterRow => {
	const row = graph.get(`monster:${EDITIONS[pack].source}:${id}`);
	if (row?.type !== 'monster') throw new Error(`no monster ${id} in ${pack}`);
	return row;
};

describe('Wild Shape · the pool and the rules each edition states', () => {
	it('2014: two uses back on any rest, unlimited at 20; own hit points, no forms known ahead', async () => {
		const graph = await loadPacks('srd-2014');
		const at = (level: number) => deriveSheet(druid('srd-2014', level), graph);
		expect(at(1).resources.find((r) => r.id === 'wild_shape')).toBeUndefined();
		expect(at(2).resources.find((r) => r.id === 'wild_shape')).toMatchObject({
			max: 2,
			name: 'Wild Shape',
			recharge: { trigger: 'short', amount: 'all' },
		});
		expect(at(20).resources.find((r) => r.id === 'wild_shape')?.max).toBe(Infinity);

		expect(at(2).facts.forms).toEqual([
			{
				id: 'wild_shape',
				source: 'Wild Shape',
				creature: 'beast',
				maxCr: 0.25,
				without: ['swim', 'fly'],
				ownHp: true,
				hours: 1,
				casts: false,
				// "you can't use any of your special senses, such as darkvision, unless your new form
				// also has that sense"
				onlySenses: true,
				// "You automatically revert if you fall unconscious, drop to 0 hit points, or die."
				endsWhen: ['unconscious'],
				sheds: [],
				// "Equipment that merges with the form has no effect until you leave the form."
				wornOnly: true,
			},
		]);
		expect(at(4).facts.forms[0]).toMatchObject({ maxCr: 0.5, without: ['fly'], hours: 2 });
		expect(at(8).facts.forms[0]).toMatchObject({ maxCr: 1, without: [], hours: 4 });
		expect(at(17).facts.forms[0]?.casts).toBe(false);
		expect(at(18).facts.forms[0]?.casts).toBe(true);
		for (const level of [2, 8, 20]) expect(at(level).deriveIssues).toEqual([]);
	});

	it('2024: the Druid Features ladder, one use back on a short rest, known forms and temp HP', async () => {
		const graph = await loadPacks('srd-2024');
		const at = (level: number) => deriveSheet(druid('srd-2024', level), graph);
		const pool = (level: number) => at(level).resources.find((r) => r.id === 'wild_shape');
		expect([2, 5, 6, 16, 17, 20].map((level) => pool(level)?.max)).toEqual([2, 2, 3, 3, 4, 4]);
		expect(pool(2)?.recharge).toEqual({ trigger: 'short', amount: '1' });

		expect(at(2).facts.forms).toEqual([
			{
				id: 'wild_shape',
				source: 'Wild Shape',
				creature: 'beast',
				maxCr: 0.25,
				without: ['fly'],
				ownHp: false,
				tempHp: 2,
				known: 4,
				hours: 1,
				casts: false,
				onlySenses: false,
				// "until you use Wild Shape again, have the Incapacitated condition, or die"
				endsWhen: ['incapacitated'],
				// "you retain your creature type; Hit Points; Hit Point Dice; Intelligence, Wisdom, and
				// Charisma scores; class features; languages; and feats" — and no species trait
				sheds: ['species'],
				wornOnly: true,
			},
		]);
		expect(at(4).facts.forms[0]).toMatchObject({ maxCr: 0.5, known: 6, tempHp: 4 });
		expect(at(8).facts.forms[0]).toMatchObject({ maxCr: 1, known: 8, without: [] });
		expect(at(18).facts.forms[0]?.casts).toBe(true);
		expect(at(20).facts.initiativeRegain).toContainEqual({
			id: 'wild_shape',
			upTo: 1,
			source: 'Archdruid',
		});
		for (const level of [2, 8, 20]) expect(at(level).deriveIssues).toEqual([]);
	});
});

describe('Wild Shape · which stat blocks a level allows', () => {
	it.each([
		// the Beast Shapes table's own examples, then what each limit keeps out
		['srd-2014', 2, 'wolf', true],
		['srd-2014', 2, 'constrictor_snake', false], // CR 1/4, but it swims
		['srd-2014', 2, 'crocodile', false], // CR 1/2
		['srd-2014', 4, 'crocodile', true],
		['srd-2014', 4, 'giant_eagle', false], // CR 1, and it flies
		['srd-2014', 8, 'giant_eagle', true],
		['srd-2014', 8, 'wolf', true],
		// 2024 has no swim gate at all
		['srd-2024', 2, 'wolf', true],
		['srd-2024', 2, 'constrictor_snake', true],
		['srd-2024', 2, 'crocodile', false],
		['srd-2024', 4, 'crocodile', true],
		['srd-2024', 8, 'brown_bear', true],
	] as const)('%s druid %i · %s → %s', async (pack, level, id, allowed) => {
		const graph = await loadPacks(pack);
		const rules = deriveSheet(druid(pack, level), graph).facts.forms[0];
		expect(rules).toBeDefined();
		if (rules) expect(isEligibleForm(monster(graph, pack, id), rules)).toBe(allowed);
	});

	it('a beast is a Beast stat block: a dinosaur counts, a swarm of them does not', async () => {
		const graph = await loadPacks('srd-2024');
		const beasts = graph.list('monster', { system: '5.5e' }).filter((row) =>
			isEligibleForm(row, {
				id: 'x',
				source: 'x',
				creature: 'beast',
				without: [],
				ownHp: false,
				casts: false,
				onlySenses: false,
				endsWhen: [],
				sheds: [],
				wornOnly: false,
			}),
		);
		const types = new Set(beasts.map((row) => row.data.creature_type));
		expect([...types].sort()).toEqual(['beast', 'beast (dinosaur)']);
	});
});

describe('Wild Shape · what the stat block does to the sheet', () => {
	it.each(['srd-2014', 'srd-2024'] as const)(
		'%s: the body is the wolf’s, the mind stays the druid’s, and every number names the wolf',
		async (pack) => {
			const graph = await loadPacks(pack);
			const own = druid(pack, 4);
			const wolf = monster(graph, pack, 'wolf');
			const sheet = deriveSheet(shaped(own, pack, 'wolf'), graph);
			const before = deriveSheet(own, graph);

			for (const ability of ['str', 'dex', 'con'] as const)
				expect(sheet.abilities[ability].score.value).toBe(wolf.data[ability]);
			for (const ability of ['int', 'wis', 'cha'] as const)
				expect(sheet.abilities[ability].score.value).toBe(before.abilities[ability].score.value);
			expect(sheet.ac.value).toBe(wolf.data.ac);
			expect(sheet.speed.value).toBe(40);
			expect(sheet.ac.trace.at(-1)?.source).toBe('Wolf');
			// the stat block lists Perception and Stealth; the druid's own bonus stands where it is higher
			expect(sheet.skills.stealth.value).toBeGreaterThanOrEqual(4);
			expect(sheet.skills.perception.value).toBeGreaterThanOrEqual(before.skills.perception.value);
			expect(sheet.spellcasting.formBlock).toEqual({ source: 'Wolf' });
			expect(sheet.deriveIssues).toEqual([]);
			expect(sheet.missing).toEqual([]);
		},
	);

	it('2014: the hit points counted are the beast’s own', async () => {
		const graph = await loadPacks('srd-2014');
		const own = druid('srd-2014', 4);
		const sheet = deriveSheet(shaped(own, 'srd-2014', 'wolf', 20), graph);
		expect(sheet.maxHp.value).toBe(monster(graph, 'srd-2014', 'wolf').data.hp);
		expect(sheet.maxHp.trace.map((c) => c.source)).toEqual(['Wolf']);
	});

	it('2024: the druid keeps their Hit Points, whatever the wolf’s Constitution is', async () => {
		const graph = await loadPacks('srd-2024');
		const own = druid('srd-2024', 4);
		const sheet = deriveSheet(shaped(own, 'srd-2024', 'wolf'), graph);
		expect(sheet.abilities.con.score.value).not.toBe(16);
		expect(sheet.maxHp.value).toBe(deriveSheet(own, graph).maxHp.value);
	});

	it.each(['srd-2014', 'srd-2024'] as const)(
		'%s: Beast Spells lifts the casting block',
		async (pack) => {
			const graph = await loadPacks(pack);
			const sheet = deriveSheet(shaped(druid(pack, 18), pack, 'wolf'), graph);
			expect(sheet.spellcasting.formBlock).toBeUndefined();
		},
	);

	it('a form whose stat block is not loaded leaves the sheet the druid’s own', async () => {
		const graph = await loadPacks('srd-2024');
		const own = druid('srd-2024', 4);
		const sheet = deriveSheet(shaped(own, 'srd-2024', 'no_such_beast'), graph);
		expect(sheet.ac.value).toBe(deriveSheet(own, graph).ac.value);
		expect(sheet.missing).toContain('monster:SRD 5.2.1:no_such_beast');
	});
});

/* SRD 5.1 ▸ Wild Shape — "you can't use any of your special senses, such as darkvision, unless your
   new form also has that sense." SRD 5.2.1 has no such sentence, and its row does not state the
   rule (asserted with the pool above). An elf's Darkvision is 60 feet; the 2014 wolf lists no
   special sense and the 2014 giant badger lists Darkvision 30. */
describe('Wild Shape · the special senses a form leaves', () => {
	const elf = (pack: Pack): Character => {
		const c = druid(pack, 2);
		c.build.species = `species:${EDITIONS[pack].source}:elf`;
		return characterSchema.parse(c);
	};

	it('2014: a sense the form does not have is not the druid’s to use, and the form says so', async () => {
		const graph = await loadPacks('srd-2014');
		expect(deriveSheet(elf('srd-2014'), graph).senses['darkvision']?.value).toBe(60);

		const asWolf = deriveSheet(shaped(elf('srd-2014'), 'srd-2014', 'wolf', 10), graph);
		expect(asWolf.senses['darkvision']?.value).toBe(0);
		expect(asWolf.senses['darkvision']?.trace.at(-1)).toMatchObject({
			source: 'Wolf',
			op: 'set',
			amount: 0,
		});
	});

	it('2014: a sense the form has too stays, at the higher of the two', async () => {
		const graph = await loadPacks('srd-2014');
		const asBadger = deriveSheet(shaped(elf('srd-2014'), 'srd-2014', 'giant_badger', 10), graph);
		expect(asBadger.senses['darkvision']?.value).toBe(60);
	});
});

/* SRD 5.2.1 ▸ Wild Shape — "Your game statistics are replaced by the Beast's stat block, but you
   retain your creature type; Hit Points; Hit Point Dice; Intelligence, Wisdom, and Charisma scores;
   class features; languages; and feats." A species trait is not on the list. An elf's Darkvision
   is 60 feet and the 2024 riding horse lists no special sense. */
describe('Wild Shape · what a 2024 form leaves of the species', () => {
	const elf = (formSpecies?: Character['ui']['formSpecies']): Character => {
		const c = druid('srd-2024', 2);
		c.build.species = `species:${EDITIONS['srd-2024'].source}:elf`;
		if (formSpecies) c.ui.formSpecies = formSpecies;
		return characterSchema.parse(c);
	};
	const darkvision = (character: Character, graph: ContentGraph): number =>
		deriveSheet(character, graph).senses['darkvision']?.value ?? 0;

	it('sets the species’ traits aside by the text, and keeps them where the table says so', async () => {
		const graph = await loadPacks('srd-2024');
		expect(darkvision(elf(), graph)).toBe(60);
		expect(darkvision(shaped(elf(), 'srd-2024', 'riding_horse'), graph)).toBe(0);
		expect(darkvision(shaped(elf('kept'), 'srd-2024', 'riding_horse'), graph)).toBe(60);
	});

	it('2014 states no such rule: its form takes the senses it lacks and nothing else', async () => {
		const graph = await loadPacks('srd-2014');
		expect(deriveSheet(druid('srd-2014', 2), graph).facts.forms[0]?.sheds).toEqual([]);
	});
});

/* Both editions: "you choose whether your equipment falls …, merges into your new form, or is worn
   by it. Worn equipment functions as normal … Equipment that merges with the form has no effect".
   A Cloak of Protection is "+1 bonus to AC and saving throws". */
describe.each(['srd-2014', 'srd-2024'] as const)(
	'Wild Shape · equipment in a form — %s',
	(pack) => {
		const CLOAK = 'cloak';
		const cloaked = (): Character => {
			const c = druid(pack, 2);
			c.build.inventory = [
				inventoryRow({
					iid: CLOAK,
					item: `item:${EDITIONS[pack].source}:cloak_of_protection`,
					qty: 1,
					equipped: true,
					attuned: true,
				}),
			];
			return characterSchema.parse(c);
		};

		it('works only where the form wears it, and comes back when the form is left', async () => {
			const graph = await loadPacks(pack);
			const wisSave = (character: Character): number =>
				deriveSheet(character, graph).abilities.wis.save.value;
			const bare = wisSave(druid(pack, 2));
			expect(wisSave(cloaked())).toBe(bare + 1);

			const asWolf = shaped(cloaked(), pack, 'wolf', pack === 'srd-2014' ? 10 : undefined);
			// a form with hit points of its own is ended by having none, so the wolf is given some
			asWolf.play.hp.current = 5;
			const inWolf = wisSave(
				shaped(druid(pack, 2), pack, 'wolf', pack === 'srd-2014' ? 10 : undefined),
			);
			expect(wisSave(asWolf)).toBe(inWolf);

			const ctx = {
				graph,
				locale: 'en',
				rng: () => 0.5,
				derive: (character: Character) => deriveSheet(character, graph),
			};
			const worn = setFormWorn(asWolf, { row: CLOAK, worn: true }, ctx).character;
			expect(worn.play.form?.worn).toEqual([CLOAK]);
			expect(wisSave(worn)).toBe(inWolf + 1);
			expect(setFormWorn(worn, { row: CLOAK, worn: false }, ctx).character.play.form?.worn).toEqual(
				[],
			);
		});
	},
);

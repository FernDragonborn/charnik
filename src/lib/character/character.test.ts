import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { characterSchema, newCharacter, type Character } from './schema';
import { CHARACTER_SCHEMA_VERSION } from '../schema/version';
import {
	saveCharacter,
	loadCharacter,
	listCharacters,
	deleteCharacter,
	appendLog,
	readLog
} from './repository';

function sample(): Character {
	const c = newCharacter('mirt', 'Mirt', '5.5e');
	c.build.classes = [
		{ class: 'class:SRD 5.2.1:wizard', level: 3, subclass: 'subclass:SRD 5.2.1:evoker' }
	];
	c.build.abilities.int = 16;
	c.build.skills = ['arcana', 'history'];
	c.build.inventory = [
		{ item: 'item:SRD 5.2.1:longsword', qty: 1, equipped: true, attuned: false }
	];
	c.build.spells = [{ spell: 'spell:SRD 5.2.1:fireball', prepared: true, alwaysPrepared: false }];
	c.play.hp = { current: 14, temp: 0 };
	return characterSchema.parse(c);
}

describe('character schema', () => {
	it('newCharacter is valid and bound to its system', () => {
		const c = newCharacter('elf-1', 'Aria', '5e');
		expect(c.system).toBe('5e');
		expect(c.build.abilities.str).toBe(10);
		expect(c.play.hp.temp).toBe(0);
		expect(characterSchema.safeParse(c).success).toBe(true);
	});

	it('rejects an out-of-range ability score', () => {
		const c = newCharacter('x', 'X', '5e');
		(c.build.abilities as Record<string, number>).str = 40;
		expect(characterSchema.safeParse(c).success).toBe(false);
	});

	it('accepts a snake_case id — what slugify makes of any multi-word name (E3 regression)', () => {
		// slugify('Bob the Brave') → 'bob_the_brave'; the schema refusing `_` made saving impossible
		const c = newCharacter('bob_the_brave', 'Bob the Brave', '5e');
		expect(characterSchema.safeParse(c).success).toBe(true);
		// pre-E3 kebab ids in existing saves stay loadable
		expect(characterSchema.safeParse(newCharacter('elf-1', 'Aria', '5e')).success).toBe(true);
	});
});

describe('character migration v1→v2 (E3 kebab→snake refs)', () => {
	it('snakes content-ref id segments and skill ids on load, leaving source tags alone', async () => {
		const s = new MemoryStorage();
		// a v1 save written before the E3 id migration (kebab ids everywhere)
		const v1 = {
			schemaVersion: 1,
			id: 'grog',
			system: '5.5e',
			build: {
				name: 'Grog',
				abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 },
				species: 'species:SRD 5.2.1:half-orc',
				background: 'background:SRD 5.2.1:folk-hero',
				classes: [
					{
						class: 'class:SRD 5.2.1:barbarian',
						level: 5,
						subclass: 'subclass:SRD 5.2.1:path-of-the-berserker'
					}
				],
				feats: ['feat:SRD 5.2.1:great-weapon-master'],
				skills: ['animal-handling', 'sleight-of-hand', 'athletics'],
				expertise: ['animal-handling'],
				inventory: [
					{ item: 'item:SRD 5.2.1:studded-leather', qty: 1, equipped: true, attuned: false }
				],
				spells: [{ spell: 'spell:SRD 5.2.1:fire-bolt', prepared: true, alwaysPrepared: false }]
			},
			play: { hp: { current: 20, temp: 0 }, concentration: 'spell:SRD 5.2.1:hold-person' }
		};
		await s.write('characters/grog/character.json', JSON.stringify(v1));
		const res = await loadCharacter(s, 'grog');
		expect(res.ok).toBe(true);
		const c = res.character!;
		expect(c.schemaVersion).toBe(CHARACTER_SCHEMA_VERSION); // chained through every step
		expect(c.build.species).toBe('species:SRD 5.2.1:half_orc'); // id snaked, "SRD 5.2.1" source kept
		expect(c.build.background).toBe('background:SRD 5.2.1:folk_hero');
		expect(c.build.classes[0]!.subclass).toBe('subclass:SRD 5.2.1:path_of_the_berserker');
		expect(c.build.feats[0]).toBe('feat:SRD 5.2.1:great_weapon_master');
		expect(c.build.skills).toEqual(['animal_handling', 'sleight_of_hand', 'athletics']);
		expect(c.build.expertise).toEqual(['animal_handling']);
		expect(c.build.inventory[0]!.item).toBe('item:SRD 5.2.1:studded_leather');
		expect(c.build.spells[0]!.spell).toBe('spell:SRD 5.2.1:fire_bolt');
		expect(c.play.concentration).toBe('spell:SRD 5.2.1:hold_person');
	});

	it('v2→v3 re-snakes refs a v2 save still carried in kebab (the seeded demo)', async () => {
		const s = new MemoryStorage();
		// the pre-fix seeded demo: written AT v2 (so v1→v2 never ran) with kebab refs
		const v2 = {
			schemaVersion: 2,
			id: 'valen',
			system: '5.5e',
			build: {
				name: 'Valen',
				abilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
				species: 'species:SRD 5.2.1:elf',
				speciesOption: 'species_option:SRD 5.2.1:elf-high-elf',
				classes: [{ class: 'class:SRD 5.2.1:wizard', level: 3 }],
				inventory: [
					{ item: 'item:SRD 5.2.1:leather-armor', qty: 1, equipped: true, attuned: false }
				],
				spells: [{ spell: 'spell:SRD 5.2.1:fire-bolt', prepared: true, alwaysPrepared: false }]
			},
			play: { hp: { current: 14, temp: 0 } }
		};
		await s.write('characters/valen/character.json', JSON.stringify(v2));
		const res = await loadCharacter(s, 'valen');
		expect(res.ok).toBe(true);
		const c = res.character!;
		expect(c.schemaVersion).toBe(CHARACTER_SCHEMA_VERSION);
		expect(c.build.speciesOption).toBe('species_option:SRD 5.2.1:elf_high_elf');
		expect(c.build.inventory[0]!.item).toBe('item:SRD 5.2.1:leather_armor');
		expect(c.build.spells[0]!.spell).toBe('spell:SRD 5.2.1:fire_bolt');
	});
});

describe('character repository (in-memory)', () => {
	it('round-trips a character unchanged', async () => {
		const s = new MemoryStorage();
		const c = sample();
		await saveCharacter(s, c);
		const res = await loadCharacter(s, 'mirt');
		expect(res.ok).toBe(true);
		expect(res.character).toEqual(c);
	});

	it('keeps build and play separate — editing play never touches build', async () => {
		const s = new MemoryStorage();
		const c = sample();
		await saveCharacter(s, c);
		const loaded = (await loadCharacter(s, 'mirt')).character!;
		loaded.play.hp.current = 3;
		loaded.play.spellSlotsSpent = { '1': 2, '3': 1 };
		await saveCharacter(s, loaded);
		const again = (await loadCharacter(s, 'mirt')).character!;
		expect(again.build).toEqual(c.build); // build untouched
		expect(again.play.hp.current).toBe(3);
		expect(again.play.spellSlotsSpent).toEqual({ '1': 2, '3': 1 });
	});

	it('refuses to save an invalid character', async () => {
		const s = new MemoryStorage();
		const c = sample();
		(c.build as { name: string }).name = '';
		await expect(saveCharacter(s, c)).rejects.toThrow(/invalid character/);
	});

	it('reports a corrupt save instead of throwing; roster still lists it', async () => {
		const s = new MemoryStorage();
		await saveCharacter(s, sample());
		await s.write('characters/broken/character.json', '{ not json');
		const bad = await loadCharacter(s, 'broken');
		expect(bad.ok).toBe(false);
		expect(bad.error).toMatch(/invalid JSON/);

		const roster = await listCharacters(s);
		expect(roster.map((r) => r.id).sort()).toEqual(['broken', 'mirt']);
		expect(roster.find((r) => r.id === 'broken')?.error).toBeTruthy();
		const mirt = roster.find((r) => r.id === 'mirt')!;
		expect(mirt.level).toBe(3);
		expect(mirt.classes).toBe('wizard 3');
	});

	it('a broken save keeps its REAL edition for the roster badge, not a hardcoded default (D4)', async () => {
		const s = new MemoryStorage();
		// valid JSON but not a valid character (missing build/play) — its `system` is still readable
		await s.write(
			'characters/halfbad/character.json',
			'{"schemaVersion":3,"system":"5.5e","id":"halfbad"}'
		);
		// unreadable edition → no badge at all (never a wrong default)
		await s.write('characters/noedition/character.json', '{"schemaVersion":3,"id":"noedition"}');
		const roster = await listCharacters(s);
		expect(roster.find((r) => r.id === 'halfbad')?.system).toBe('5.5e');
		expect(roster.find((r) => r.id === 'noedition')?.system).toBeUndefined();
	});

	it('rejects a save from a newer schema (never silently drops data)', async () => {
		const s = new MemoryStorage();
		const c = sample();
		await saveCharacter(s, { ...c, schemaVersion: 999 });
		const res = await loadCharacter(s, 'mirt');
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/newer|migration/i);
	});

	it('deletes a character', async () => {
		const s = new MemoryStorage();
		await saveCharacter(s, sample());
		await deleteCharacter(s, 'mirt');
		expect((await loadCharacter(s, 'mirt')).ok).toBe(false);
		expect(await listCharacters(s)).toEqual([]);
	});
});

describe('roll log (log.jsonl, out of character.json)', () => {
	it('appends and reads newest-first, skipping corrupt lines', async () => {
		const s = new MemoryStorage();
		await appendLog(s, 'mirt', { t: 1, kind: 'attack', label: 'Longsword', result: 17 });
		await appendLog(s, 'mirt', { t: 2, kind: 'save', label: 'DEX', result: 9 });
		await s.write(
			'characters/mirt/log.jsonl',
			(await s.read('characters/mirt/log.jsonl')) + 'garbage\n'
		);
		const log = await readLog(s, 'mirt');
		expect(log.map((e) => e.label)).toEqual(['DEX', 'Longsword']);
		// the roll log is not part of the character file
		const c = (await loadCharacter(s, 'mirt')).character;
		expect(c).toBeUndefined(); // no character.json written in this test
	});
});

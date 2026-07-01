import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { characterSchema, newCharacter, type Character } from './schema';
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

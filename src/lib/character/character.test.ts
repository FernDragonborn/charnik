import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { rehydrateLogEntry, type RollLogEntry } from '../combat/roll';
import { ADVANTAGE_MODE, setAdvantage } from '../rules/dice';
import { characterSchema, newCharacter, type Character } from './schema';
import { CHARACTER_SCHEMA_VERSION } from '../schema/version';
import {
	saveCharacter,
	loadCharacter,
	listCharacters,
	deleteCharacter,
	appendLog,
	LOG_KIND,
	reviseLog,
	logLineFor,
	readLog,
	backupCharacter,
	listCharacterBackups,
	restoreCharacterBackup,
	uniqueCharacterId,
	writeCharacterPhoto,
	readCharacterPhoto,
	removeCharacterPhotos,
} from './repository';
import { attunedCount, bumpQty, carriedWeight, toggleAttuned, useOne } from './inventory';

function sample(): Character {
	const c = newCharacter('mirt', 'Mirt', '5.5e');
	c.build.classes = [
		{ class: 'class:SRD 5.2.1:wizard', level: 3, subclass: 'subclass:SRD 5.2.1:evoker' },
	];
	c.build.abilities.int = 16;
	c.build.skills = ['arcana', 'history'];
	c.build.inventory = [
		{ item: 'item:SRD 5.2.1:longsword', qty: 1, equipped: true, attuned: false },
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
						subclass: 'subclass:SRD 5.2.1:path-of-the-berserker',
					},
				],
				feats: ['feat:SRD 5.2.1:great-weapon-master'],
				skills: ['animal-handling', 'sleight-of-hand', 'athletics'],
				expertise: ['animal-handling'],
				inventory: [
					{ item: 'item:SRD 5.2.1:studded-leather', qty: 1, equipped: true, attuned: false },
				],
				spells: [{ spell: 'spell:SRD 5.2.1:fire-bolt', prepared: true, alwaysPrepared: false }],
				// refs too, and present in v1 twelve days BEFORE the rename that made this migration
				languages: ['language:SRD 5.2.1:deep-speech', 'language:SRD 5.2.1:common'],
			},
			play: { hp: { current: 20, temp: 0 }, concentration: 'spell:SRD 5.2.1:hold-person' },
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
		expect(c.build.languages).toEqual([
			'language:SRD 5.2.1:deep_speech',
			'language:SRD 5.2.1:common',
		]);
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
					{ item: 'item:SRD 5.2.1:leather-armor', qty: 1, equipped: true, attuned: false },
				],
				spells: [{ spell: 'spell:SRD 5.2.1:fire-bolt', prepared: true, alwaysPrepared: false }],
			},
			play: { hp: { current: 14, temp: 0 } },
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
			'{"schemaVersion":3,"system":"5.5e","id":"halfbad"}',
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

describe('the portrait file beside the character (PORTRAIT)', () => {
	const photoOf = (ext: string, mime: string, byte: number) => ({
		bytes: new Uint8Array([byte]),
		ext,
		mime,
	});

	it('writes the portrait into the character folder and reads it back', async () => {
		const s = new MemoryStorage();
		await saveCharacter(s, sample());
		const name = await writeCharacterPhoto(s, 'mirt', photoOf('webp', 'image/webp', 7));
		expect(name).toBe('photo.webp');
		expect(Array.from(await readCharacterPhoto(s, 'mirt', name))).toEqual([7]);
	});

	it('a second portrait REPLACES the first, even under another extension', async () => {
		const s = new MemoryStorage();
		await saveCharacter(s, sample());
		await writeCharacterPhoto(s, 'mirt', photoOf('webp', 'image/webp', 7));
		const name = await writeCharacterPhoto(s, 'mirt', photoOf('png', 'image/png', 9));
		// the save names ONE file, so a leftover under the old extension would be invisible + permanent
		const files = (await s.list('characters/mirt'))
			.map((e) => e.name)
			.filter((n) => n.startsWith('photo.'));
		expect(files).toEqual([name]);
		expect(Array.from(await readCharacterPhoto(s, 'mirt', name))).toEqual([9]);
	});

	it('removing takes the file with it — the way out leaves nothing behind', async () => {
		const s = new MemoryStorage();
		await saveCharacter(s, sample());
		await writeCharacterPhoto(s, 'mirt', photoOf('jpg', 'image/jpeg', 1));
		await removeCharacterPhotos(s, 'mirt');
		expect((await s.list('characters/mirt')).some((e) => e.name.startsWith('photo.'))).toBe(false);
		// the character itself is untouched
		expect((await loadCharacter(s, 'mirt')).ok).toBe(true);
	});

	it('a character with no folder at all is not an error to clear', async () => {
		await expect(removeCharacterPhotos(new MemoryStorage(), 'nobody')).resolves.toBeUndefined();
	});
});

describe('roll log (log.jsonl, out of character.json)', () => {
	it('appends and reads newest-first, skipping corrupt lines', async () => {
		const s = new MemoryStorage();
		await appendLog(s, 'mirt', { t: 1, kind: LOG_KIND.roll, label: 'Longsword', result: 17 });
		await appendLog(s, 'mirt', { t: 2, kind: LOG_KIND.roll, label: 'DEX', result: 9 });
		await s.write(
			'characters/mirt/log.jsonl',
			(await s.read('characters/mirt/log.jsonl')) + 'garbage\n',
		);
		const log = await readLog(s, 'mirt');
		expect(log.map((e) => e.label)).toEqual(['DEX', 'Longsword']);
		// the roll log is not part of the character file
		const c = (await loadCharacter(s, 'mirt')).character;
		expect(c).toBeUndefined(); // no character.json written in this test
	});

	it('carries the WHOLE roll to disk, and still reads a line written before it did', async () => {
		const s = new MemoryStorage();
		const roll: RollLogEntry = rehydrateLogEntry({
			label: 'Greataxe',
			expr: 'd20(14) +6',
			total: 20,
			natural: 14,
			at: 1000,
			damage: [{ type: 'slashing', expr: '1d12(7) +3', total: 10 }],
			advantageRoll: { kept: 14, dropped: 3, mode: 1 },
			note: 'advantage after the roll',
		});
		await appendLog(s, 'mirt', logLineFor(roll));
		// a line from before the record was unified: the flattened summary is all it ever had
		await s.write(
			'characters/mirt/log.jsonl',
			(await s.read('characters/mirt/log.jsonl')) +
				JSON.stringify({ t: 900, kind: 'roll', label: 'Old', result: 7, detail: 'd20(7)' }) +
				'\n',
		);

		const log = await readLog(s, 'mirt');
		const fresh = log.find((e) => e.label === 'Greataxe');
		// the damage, the advantage pair and the note used to be dropped on the way to disk
		expect(fresh?.roll).toEqual(roll);
		expect(fresh?.t).toBe(roll.at); // the line's time IS the roll's, not one invented at write
		expect(fresh?.result).toBe(20); // …and the flat summary an older build reads is still there
		expect(log.find((e) => e.label === 'Old')?.roll).toBeUndefined(); // legacy line still loads
	});

	it('an amendment REPLACES its own line instead of appending a second roll', async () => {
		const s = new MemoryStorage();
		const rolled: RollLogEntry = rehydrateLogEntry({
			label: 'Stealth',
			expr: 'd20(4) +7',
			total: 11,
			at: 500,
		});
		await appendLog(s, 'mirt', logLineFor(rolled));
		await appendLog(
			s,
			'mirt',
			logLineFor(rehydrateLogEntry({ label: 'Other', expr: 'd20(9)', total: 9, at: 600 })),
		);

		// the same roll read at advantage after the fact: its d20(4) plus a second one, rolled 11
		const amended = setAdvantage(rolled, ADVANTAGE_MODE.advantage, () => 0.5);
		if (!amended) throw new Error('the roll has a d20 — it can take advantage');
		await reviseLog(s, 'mirt', logLineFor(amended));

		const log = await readLog(s, 'mirt');
		expect(log).toHaveLength(2); // not three — the same roll, decided differently
		expect(log.find((e) => e.label === 'Stealth')?.roll?.total).toBe(18);
		// a roll that has already rotated off disk is a no-op, never an append
		await reviseLog(
			s,
			'mirt',
			logLineFor(rehydrateLogEntry({ label: 'Gone', expr: '', total: 0, at: 1 })),
		);
		expect((await readLog(s, 'mirt')).length).toBe(2);
	});

	it('BUG-4: concurrent appends all survive (per-slug serialization, no clobber)', async () => {
		const s = new MemoryStorage();
		// fire without awaiting each — the old read-modify-write would let later writes clobber earlier
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				appendLog(s, 'mirt', { t: i, kind: LOG_KIND.roll, label: `r${i}`, result: i }),
			),
		);
		const log = await readLog(s, 'mirt');
		expect(log.length).toBe(20);
		expect(new Set(log.map((e) => e.label)).size).toBe(20); // every entry kept, none lost
	});

	it('rotates the log file so it stays bounded (B4)', async () => {
		const s = new MemoryStorage();
		for (let i = 0; i < 150; i++)
			await appendLog(s, 'mirt', { t: i, kind: LOG_KIND.roll, label: `r${i}`, result: i });
		const log = await readLog(s, 'mirt');
		expect(log.length).toBe(100); // capped at LOG_MAX_LINES
		expect(log.map((e) => e.label).at(0)).toBe('r149'); // newest kept
		expect(log.map((e) => e.label).at(-1)).toBe('r50'); // oldest 50 dropped
	});
});

describe('unique character id (D14)', () => {
	it('appends a short suffix so two same-named characters never collide', async () => {
		const s = new MemoryStorage();
		const a = await uniqueCharacterId(s, 'hero');
		await saveCharacter(s, newCharacter(a, 'Hero', '5e'));
		const b = await uniqueCharacterId(s, 'hero');
		expect(a).toMatch(/^hero-[0-9a-f]{4}$/);
		expect(b).not.toBe(a); // retried past the existing dir
		expect(b).toMatch(/^hero-[0-9a-f]{4}$/);
	});
});

describe('rotating backups (B3)', () => {
	const t0 = 1_000_000_000_000;
	const min = 60_000;

	it('save tier throttles to one checkpoint per 10 min and keeps the newest 2', async () => {
		const s = new MemoryStorage();
		await saveCharacter(s, newCharacter('mirt', 'Mirt', '5e')); // first save: nothing to back up yet
		const bakDir = async () =>
			(await s.list('characters/mirt'))
				.filter((e) => e.name.startsWith('character.bak.save.'))
				.map((e) => e.name)
				.sort();

		await backupCharacter(s, 'mirt', 'save', t0);
		await backupCharacter(s, 'mirt', 'save', t0 + 5 * min); // within 10 min → throttled, skipped
		expect((await bakDir()).length).toBe(1);

		await backupCharacter(s, 'mirt', 'save', t0 + 11 * min); // past throttle → new checkpoint
		await backupCharacter(s, 'mirt', 'save', t0 + 22 * min); // → 3 written, pruned to newest 2
		const kept = await bakDir();
		expect(kept.length).toBe(2);
		expect(kept).toEqual([
			`character.bak.save.${t0 + 11 * min}.json`,
			`character.bak.save.${t0 + 22 * min}.json`,
		]);
	});

	it('launch tier keeps the newest 3, one per session', async () => {
		const s = new MemoryStorage();
		await saveCharacter(s, newCharacter('mirt', 'Mirt', '5e'));
		for (let i = 0; i < 5; i++) await backupCharacter(s, 'mirt', 'launch', t0 + i * min);
		const kept = (await s.list('characters/mirt'))
			.filter((e) => e.name.startsWith('character.bak.launch.'))
			.map((e) => e.name);
		expect(kept.length).toBe(3);
	});

	it('lists both rings newest-first, and puts one back as the live save', async () => {
		// the rings had two writers and no reader: five files per character that only a desktop user
		// who knew the layout could reach by renaming one by hand, and nobody on the web could
		const s = new MemoryStorage();
		const c = newCharacter('mirt', 'Mirt', '5e');
		await saveCharacter(s, c);
		await backupCharacter(s, 'mirt', 'save', t0);
		await backupCharacter(s, 'mirt', 'launch', t0 + min);

		const listed = await listCharacterBackups(s, 'mirt');
		expect(listed.map((b) => [b.tier, b.ts])).toEqual([
			['launch', t0 + min],
			['save', t0],
		]);

		// the live save moves on, then a snapshot is put back over it
		await saveCharacter(s, { ...c, build: { ...c.build, name: 'Mirt the Moneylender' } });
		expect((await loadCharacter(s, 'mirt')).character?.build.name).toBe('Mirt the Moneylender');

		const restored = await restoreCharacterBackup(s, 'mirt', listed[0]!.path);
		expect(restored.ok).toBe(true);
		expect((await loadCharacter(s, 'mirt')).character?.build.name).toBe('Mirt');
	});

	it('refuses a corrupt snapshot instead of writing it over a working character', async () => {
		// the reason to restore is that what you have is already broken; replacing it with something
		// worse, silently, is the one outcome this must not have
		const s = new MemoryStorage();
		await saveCharacter(s, newCharacter('mirt', 'Mirt', '5e'));
		await s.write('characters/mirt/character.bak.save.1.json', '{ not json');

		const res = await restoreCharacterBackup(
			s,
			'mirt',
			'characters/mirt/character.bak.save.1.json',
		);

		expect(res.ok).toBe(false);
		expect(res.error).toContain('invalid JSON');
		expect((await loadCharacter(s, 'mirt')).character?.build.name).toBe('Mirt');
	});

	it('a backup is a faithful copy of character.json', async () => {
		const s = new MemoryStorage();
		await saveCharacter(s, newCharacter('mirt', 'Mirt', '5e'));
		await backupCharacter(s, 'mirt', 'launch', t0);
		const live = await s.read('characters/mirt/character.json');
		const bak = await s.read(`characters/mirt/character.bak.launch.${t0}.json`);
		expect(bak).toBe(live);
	});
});

describe('inventory operations (shared by the builder draft and the play sheet)', () => {
	const list = [
		{ item: 'item:S:potion', qty: 2, equipped: false, attuned: false },
		{ item: 'item:S:cloak', qty: 1, equipped: true, attuned: true },
	];

	it('using one of a stack decrements it; using the last one drops the row', () => {
		expect(useOne(list, 'item:S:potion').find((e) => e.item === 'item:S:potion')?.qty).toBe(1);
		// a used-up stack must LEAVE, or every surface that counts rows still counts it as carried
		const emptied = useOne(useOne(list, 'item:S:potion'), 'item:S:potion');
		expect(emptied.some((e) => e.item === 'item:S:potion')).toBe(false);
	});

	it('quantity never goes below one — dropping the last is `remove`, not a zero row', () => {
		expect(bumpQty(list, 'item:S:cloak', -5).find((e) => e.item === 'item:S:cloak')?.qty).toBe(1);
	});

	it('weight counts the whole stack, not the row', () => {
		expect(carriedWeight(list, (ref) => (ref === 'item:S:potion' ? 0.5 : 1))).toBe(2);
	});

	it('attunement is counted from the entries, so the cap can be judged anywhere', () => {
		expect(attunedCount(list)).toBe(1);
		expect(attunedCount(toggleAttuned(list, 'item:S:potion'))).toBe(2);
	});
});

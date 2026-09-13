import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { BrowserStorage } from './browser';
import { saveCharacter, loadCharacter, listCharacters } from '../character/repository';
import { demoCharacter } from '../demo/sheet';

const fresh = () => new BrowserStorage('t' + Math.random().toString(36).slice(2));

describe('BrowserStorage (IndexedDB)', () => {
	it('round-trips files and synthesises parent dirs', async () => {
		const s = fresh();
		await s.write('characters/valen/character.json', '{"x":1}');
		expect(await s.read('characters/valen/character.json')).toBe('{"x":1}');
		expect(await s.exists('characters')).toBe(true);
		expect(await s.exists('characters/valen')).toBe(true);
		const kids = await s.list('characters');
		expect(kids.map((k) => k.name)).toEqual(['valen']);
		expect(kids[0]!.isDir).toBe(true);
	});

	it('lists only immediate children', async () => {
		const s = fresh();
		await s.write('a/b/c.txt', '1');
		await s.write('a/d.txt', '2');
		expect((await s.list('a')).map((k) => k.name)).toEqual(['b', 'd.txt']);
	});

	it('remove deletes the whole subtree', async () => {
		const s = fresh();
		await s.write('characters/valen/character.json', '{}');
		await s.write('characters/valen/log.jsonl', 'x');
		await s.remove('characters/valen');
		expect(await s.exists('characters/valen')).toBe(false);
		expect(await s.exists('characters/valen/character.json')).toBe(false);
	});

	it('round-trips bytes', async () => {
		const s = fresh();
		await s.writeBytes('photo.bin', new Uint8Array([1, 2, 3]));
		expect(Array.from(await s.readBytes('photo.bin'))).toEqual([1, 2, 3]);
	});

	it('rename refuses a missing source and an occupied target, like a real filesystem', async () => {
		// the flat keyspace merges both happily; `types.ts` promises neither, and the pack swap is
		// built on the refusal (Windows will not rename a directory onto an existing one)
		const s = fresh();
		await s.write('a/one.txt', 'A-one');
		await s.write('b/one.txt', 'B-one');
		await expect(s.rename('nope', 'elsewhere')).rejects.toThrow('no such path');
		await expect(s.rename('a', 'b')).rejects.toThrow('target exists');
		expect(await s.read('b/one.txt')).toBe('B-one');
		expect(await s.read('a/one.txt')).toBe('A-one');
		await s.remove('b');
		await s.rename('a', 'b');
		expect(await s.read('b/one.txt')).toBe('A-one');
	});

	it('rejects a path that traverses out of the root', async () => {
		const s = fresh();
		await expect(s.read('../secret')).rejects.toThrow('escapes storage root');
	});

	it('persists a character through the repository', async () => {
		const s = fresh();
		await saveCharacter(s, demoCharacter());
		expect((await listCharacters(s)).map((r) => r.id)).toContain('karroth');
		const res = await loadCharacter(s, 'karroth');
		expect(res.ok).toBe(true);
		expect(res.character?.build.name).toBe('Karroth the Red');
	});
});

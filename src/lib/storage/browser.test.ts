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

	it('persists a character through the repository', async () => {
		const s = fresh();
		await saveCharacter(s, demoCharacter());
		expect((await listCharacters(s)).map((r) => r.id)).toContain('valen');
		const res = await loadCharacter(s, 'valen');
		expect(res.ok).toBe(true);
		expect(res.character?.build.name).toBe('Valen the Blue');
	});
});

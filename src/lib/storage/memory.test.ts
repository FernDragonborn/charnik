import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { MemoryStorage } from './memory';

describe('MemoryStorage', () => {
	it('round-trips a written file', async () => {
		const s = new MemoryStorage();
		await s.write('content/srd/species.csv', 'id,name_en\nelf,Elf\n');
		expect(await s.exists('content/srd/species.csv')).toBe(true);
		expect(await s.read('content/srd/species.csv')).toContain('elf,Elf');
	});

	it('reports a file mtime on list (set at write time), undefined for dirs', async () => {
		const s = new MemoryStorage();
		const before = Date.now();
		await s.write('content/srd/species.csv', 'x');
		const [entry] = await s.list('content/srd');
		expect(entry!.name).toBe('species.csv');
		expect(entry!.mtime).toBeGreaterThanOrEqual(before);
		const [dir] = await s.list('content');
		expect(dir!.isDir).toBe(true);
		expect(dir!.mtime).toBeUndefined();
	});

	it('lists immediate children (dirs and files)', async () => {
		const s = new MemoryStorage();
		await s.write('content/srd/species.csv', 'x');
		await s.write('content/srd/spells.csv', 'x');
		await s.write('content/homebrew/feats.csv', 'x');

		const top = await s.list('content');
		expect(top.map((e) => e.name)).toEqual(['homebrew', 'srd']);
		expect(top.every((e) => e.isDir)).toBe(true);

		const srd = await s.list('content/srd');
		expect(srd.map((e) => e.name)).toEqual(['species.csv', 'spells.csv']);
		expect(srd.every((e) => !e.isDir)).toBe(true);
	});

	it('rejects path traversal (sandbox)', async () => {
		const s = new MemoryStorage();
		await expect(s.read('../secret')).rejects.toThrow(/escapes root/);
	});

	it('watch fires on write and remove, stops after unsubscribe', async () => {
		const s = new MemoryStorage();
		const cb = vi.fn();
		const off = s.watch('content', cb);
		await s.write('content/srd/x.csv', 'a');
		await s.remove('content/srd/x.csv');
		expect(cb).toHaveBeenCalledTimes(2);
		off();
		await s.write('content/srd/y.csv', 'b');
		expect(cb).toHaveBeenCalledTimes(2);
	});

	it('write→read identity for arbitrary text (property)', async () => {
		await fc.assert(
			fc.asyncProperty(fc.string(), async (txt) => {
				const s = new MemoryStorage();
				await s.write('a/b.txt', txt);
				return (await s.read('a/b.txt')) === txt;
			})
		);
	});
});

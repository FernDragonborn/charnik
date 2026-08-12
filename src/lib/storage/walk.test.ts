import { describe, it, expect } from 'vitest';
import { MemoryStorage } from './memory';
import { listFilesRecursive } from './walk';

describe('listFilesRecursive', () => {
	it('returns every file at any depth', async () => {
		const s = new MemoryStorage();
		await s.write('content/p/a.csv', 'a');
		await s.write('content/p/plugins/ns/main.js', 'b');
		expect(await listFilesRecursive(s, 'content/p')).toEqual([
			'content/p/a.csv',
			'content/p/plugins/ns/main.js'
		]);
	});

	it('a folder that is not there walks to nothing — a pack’s first install has none', async () => {
		expect(await listFilesRecursive(new MemoryStorage(), 'content/not-installed-yet')).toEqual([]);
	});

	/* The walk decides what an apply CARRIES ACROSS into the replacement tree. Answering `[]` for a
	   folder that is right there but unreadable drops the README, the notes and every hand-edited
	   file the diff had just promised to preserve — with the swap going ahead as if all was well. */
	it('a folder that IS there but unreadable throws, rather than reporting no files', async () => {
		const s = new MemoryStorage();
		await s.write('content/p/a.csv', 'a');
		s.list = () => Promise.reject(new Error('EACCES'));
		await expect(listFilesRecursive(s, 'content/p')).rejects.toThrow('EACCES');
	});
});

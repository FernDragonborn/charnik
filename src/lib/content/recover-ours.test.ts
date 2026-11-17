/** Startup recovery settles only the staging folders of packs this app installed or ships; a
 *  folder the user named `notes.prev` is theirs (audit-oct-27 D13). */
import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { recoverInterruptedApplies } from './provider';
import { packConfig } from './packs.svelte';

const enc = (s: string) => new TextEncoder().encode(s);

describe('startup recovery', () => {
	it('leaves a folder it did not make alone, and settles one it did', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/notes.prev/mine.csv', enc('id\nmine'));
		await s.writeBytes('content/srd-2024.new/a.csv', enc('id\nnew'));
		packConfig.packs = {};
		await recoverInterruptedApplies(s, ['srd-2024']);
		expect(await s.read('content/notes.prev/mine.csv')).toBe('id\nmine');
		// a bundled pack whose first install died: the half-built folder is promoted
		expect(await s.read('content/srd-2024/a.csv')).toBe('id\nnew');
	});

	it('gives the undo copy back when a swap stopped after setting it aside', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('id\nlive'));
		await s.writeBytes('content/p.old/a.csv', enc('id\nundo'));
		packConfig.packs = { p: { repo: 'https://github.com/x/y' } };
		await recoverInterruptedApplies(s, []);
		expect(await s.read('content/p.prev/a.csv')).toBe('id\nundo');
		expect(await s.exists('content/p.old')).toBe(false);
	});
});

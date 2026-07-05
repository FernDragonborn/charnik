import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { copyMissingRoots } from './provider';

/** The seed step for the desktop first-run: copy shipped content onto disk. Tested over the Storage
 *  seam (two MemoryStorages) so the risky copy/skip logic is covered without Tauri or fetch. */
describe('copyMissingRoots (desktop content seed)', () => {
	async function bundled() {
		const from = new MemoryStorage();
		await from.writeBytes(
			'content/srd-2024/classes_srd.csv',
			new TextEncoder().encode('id\nwizard')
		);
		await from.writeBytes(
			'content/srd-2024/spells_srd.csv',
			new TextEncoder().encode('id\nfireball')
		);
		await from.writeBytes(
			'content/srd-2014/classes_srd.csv',
			new TextEncoder().encode('id\nfighter')
		);
		return from;
	}

	it('copies every root byte-for-byte into an empty destination', async () => {
		const to = new MemoryStorage();
		await copyMissingRoots(await bundled(), to, ['content/srd-2024', 'content/srd-2014']);
		expect(await to.exists('content/srd-2024/classes_srd.csv')).toBe(true);
		expect(await to.read('content/srd-2024/spells_srd.csv')).toBe('id\nfireball');
		expect(await to.read('content/srd-2014/classes_srd.csv')).toBe('id\nfighter');
	});

	it('skips a root that already exists (never clobbers the user copy)', async () => {
		const to = new MemoryStorage();
		await to.writeBytes(
			'content/srd-2024/classes_srd.csv',
			new TextEncoder().encode('id\nMY EDIT')
		);
		await copyMissingRoots(await bundled(), to, ['content/srd-2024', 'content/srd-2014']);
		expect(await to.read('content/srd-2024/classes_srd.csv')).toBe('id\nMY EDIT'); // untouched
		expect(await to.exists('content/srd-2014/classes_srd.csv')).toBe(true); // the other root seeded
	});
});

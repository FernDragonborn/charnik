/** A fork never replaces a row the homebrew file already holds: Fireball forked in each edition, and
 *  an original forked a second time, keep every fork. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { MemoryStorage } from '../storage/memory';
import type { LoadedRow } from './loader';
import { homebrewFile, rowToDraft, UPSERT_MODE, upsertHomebrewRow } from './homebrew';

describe('a second fork of the same id', () => {
	let old: LoadedRow;
	let now: LoadedRow;
	beforeAll(async () => {
		const found = [
			(await loadPacks('srd-2014')).get('spell:SRD 5.1:fireball'),
			(await loadPacks('srd-2024')).get('spell:SRD 5.2.1:fireball'),
		];
		if (!found[0] || !found[1]) throw new Error('both packs ship Fireball');
		[old, now] = [found[0], found[1]];
	});
	const fork = (storage: MemoryStorage, row: LoadedRow, damage: string) =>
		upsertHomebrewRow(
			storage,
			'spell',
			{ ...rowToDraft(row), damage },
			{ file: homebrewFile('spell'), mode: UPSERT_MODE.fork },
		);

	it('in the other edition is kept beside the first, under an edition-qualified id', async () => {
		const storage = new MemoryStorage();
		expect(await fork(storage, old, '9d6 fire')).toEqual({ ok: true, id: 'fireball' });
		expect(await fork(storage, now, '10d6 fire')).toEqual({
			ok: true,
			id: 'fireball_5_5e',
			forkedBeside: { id: 'fireball', systems: '5e' },
		});
		const text = await storage.read(homebrewFile('spell'));
		expect([text.includes('9d6 fire'), text.includes('10d6 fire')]).toEqual([true, true]);
	});

	it('of the same original is kept beside the first, numbered', async () => {
		const storage = new MemoryStorage();
		await fork(storage, old, '9d6 fire');
		await fork(storage, old, '7d6 fire');
		const third = await fork(storage, old, '6d6 fire');
		expect(third.id).toBe('fireball_5e_2');
		const text = await storage.read(homebrewFile('spell'));
		expect(['9d6', '7d6', '6d6'].map((d) => text.includes(`${d} fire`))).toEqual([
			true,
			true,
			true,
		]);
	});

	it("an edit of the player's own row still replaces it in place", async () => {
		const storage = new MemoryStorage();
		await fork(storage, old, '9d6 fire');
		const edited = await upsertHomebrewRow(
			storage,
			'spell',
			{ ...rowToDraft(old), damage: '8d6 fire' },
			{ file: homebrewFile('spell'), mode: UPSERT_MODE.edit },
		);
		expect(edited).toEqual({ ok: true, id: 'fireball' });
		expect((await storage.read(homebrewFile('spell'))).includes('9d6 fire')).toBe(false);
	});
});

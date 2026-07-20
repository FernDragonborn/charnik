import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { copyMissingRoots, seedShippedContent } from './provider';
import { stampDirectives, type MetaKey } from './meta';
import { hashBody } from './hash';

/** A CSV with a correct `#content-hash` header for its body — an "untouched, app-seeded" file. */
async function stamped(body: string): Promise<string> {
	return stampDirectives(new Map<MetaKey, string>([['hash', await hashBody(body)]]), body);
}
const ROOTS = ['content/srd-2024'];
const P = 'content/srd-2024/spells_srd.csv';

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

describe('seedShippedContent (versioned re-seed on update)', () => {
	it('first run: seeds everything + records the version', async () => {
		const from = new MemoryStorage();
		await from.write(P, await stamped('id\nfireball_v1'));
		const to = new MemoryStorage();

		const { preserved } = await seedShippedContent(from, to, ROOTS, 1);

		expect(preserved).toEqual([]);
		expect(await to.read(P)).toContain('fireball_v1');
		expect(await to.read('content/.seed-version')).toBe('1');
	});

	it('UPDATE overwrites an untouched shipped file with the new bundled data', async () => {
		const from = new MemoryStorage();
		await from.write(P, await stamped('id\nfireball_v2')); // new shipped data
		const to = new MemoryStorage();
		await to.write(P, await stamped('id\nfireball_v1')); // old, unedited (hash matches body)
		// no version marker on disk → treated as older than v2

		const { preserved } = await seedShippedContent(from, to, ROOTS, 2);

		expect(preserved).toEqual([]);
		expect(await to.read(P)).toContain('fireball_v2'); // updated
		expect(await to.read(P)).not.toContain('fireball_v1');
		expect(await to.read('content/.seed-version')).toBe('2');
	});

	it('UPDATE preserves a file the user hand-edited (hash drift)', async () => {
		const from = new MemoryStorage();
		await from.write(P, await stamped('id\nfireball_v2'));
		const to = new MemoryStorage();
		// user edited the body but the recorded hash is stale → drift → their edit is kept
		const drifted = (await stamped('id\nfireball_v1')).replace('fireball_v1', 'MY_HOUSE_RULE');
		await to.write(P, drifted);

		const { preserved } = await seedShippedContent(from, to, ROOTS, 2);

		expect(preserved).toEqual([P]);
		expect(await to.read(P)).toContain('MY_HOUSE_RULE'); // user's edit survives
		expect(await to.read(P)).not.toContain('fireball_v2');
	});

	it('already at the current version: does not rewrite (only fills a missing root)', async () => {
		const from = new MemoryStorage();
		await from.write(P, await stamped('id\nfireball_v2'));
		const to = new MemoryStorage();
		await to.write(P, await stamped('id\nfireball_v1')); // stale content, but…
		await to.write('content/.seed-version', '2'); // …already marked current

		await seedShippedContent(from, to, ROOTS, 2);

		expect(await to.read(P)).toContain('fireball_v1'); // NOT rewritten
		expect(await to.read(P)).not.toContain('fireball_v2');
	});
});

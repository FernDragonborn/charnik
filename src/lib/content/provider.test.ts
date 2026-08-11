import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { discoverContentRoots, seedShippedContent } from './provider';
import { stampDirectives, type MetaKey } from './meta';
import { hashBody } from './hash';

/** A CSV with a correct `#content-hash` header for its body — an "untouched, app-seeded" file. */
async function stamped(body: string): Promise<string> {
	return stampDirectives(new Map<MetaKey, string>([['hash', await hashBody(body)]]), body);
}
const ROOTS = ['content/srd-2024'];
const P = 'content/srd-2024/spells_srd.csv';

/** A pack is a FOLDER under `content/` and the roots are found by scanning for those folders — no
 *  index file to keep in sync (AI-CONVENTIONS §1.6). These pin the three things that scan must get
 *  right: user-added packs appear, homebrew never does, and the order is deterministic. */
describe('discoverContentRoots (a pack is a folder)', () => {
	async function withPacks(): Promise<MemoryStorage> {
		const st = new MemoryStorage();
		await st.write('content/srd-2024/spells_srd.csv', 'id\nfireball');
		await st.write('content/srd-2014/spells_srd.csv', 'id\nfireball');
		await st.write('content/homebrew/spells_hb.csv', 'id\nmy_spell');
		await st.write('content/.seed-version', '5');
		return st;
	}

	it('finds every pack folder, excludes homebrew, and ignores loose files', async () => {
		expect(await discoverContentRoots(await withPacks())).toEqual([
			'content/srd-2014',
			'content/srd-2024'
		]);
	});

	// deterministic only — no consumer is allowed to read meaning into the order (the fold is
	// order-independent, a character filters to its own edition, the compendium sorts by name)
	it('returns the same order whatever order the folders came back in', async () => {
		const a = await discoverContentRoots(await withPacks());
		const b = await discoverContentRoots(await withPacks());
		expect(a).toEqual(b);
	});

	it('picks up a pack the user installed, with no code change', async () => {
		const st = await withPacks();
		await st.write('content/phb-homebrew/feats_phb.csv', 'id\nalert');
		expect(await discoverContentRoots(st)).toContain('content/phb-homebrew');
	});

	it('returns nothing (instead of throwing) when content/ does not exist yet', async () => {
		expect(await discoverContentRoots(new MemoryStorage())).toEqual([]);
	});
});

/** The bundled SRD is a PACK LIKE ANY OTHER, which above all means uninstalling it sticks: the seed
 *  fills a fresh data dir and refreshes what is still installed, and never resurrects what the user
 *  deleted. Tested over the Storage seam (two MemoryStorages) — no Tauri, no fetch. */
describe('seedShippedContent (an uninstalled pack stays uninstalled)', () => {
	const BOTH = ['content/srd-2024', 'content/srd-2014'];
	async function bundled() {
		const from = new MemoryStorage();
		await from.write('content/srd-2024/classes_srd.csv', await stamped('id\nwizard'));
		await from.write('content/srd-2014/classes_srd.csv', await stamped('id\nfighter'));
		return from;
	}

	it('a fresh data dir gets every bundled pack', async () => {
		const to = new MemoryStorage();
		await seedShippedContent(await bundled(), to, BOTH, 1);
		expect(await to.exists('content/srd-2024/classes_srd.csv')).toBe(true);
		expect(await to.exists('content/srd-2014/classes_srd.csv')).toBe(true);
	});

	it('an app update refreshes installed packs but does not bring back a deleted one', async () => {
		const to = new MemoryStorage();
		await to.write('content/srd-2024/classes_srd.csv', await stamped('id\nOLD'));
		await to.write('content/.seed-version', '1'); // seeded before; srd-2014 was uninstalled since

		await seedShippedContent(await bundled(), to, BOTH, 2);

		expect(await to.read('content/srd-2024/classes_srd.csv')).toContain('wizard'); // refreshed
		expect(await to.exists('content/srd-2014/classes_srd.csv')).toBe(false); // stays gone
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

	it('already at the current version: does not rewrite anything', async () => {
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

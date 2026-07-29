import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LoadedRow } from './loader';

/*
 * T5: the source/collision config PERSISTENCE round-trip (sources.test.ts covers the pure isRowActive
 * / detectCollisions). ARCH-2 moved persistence from localStorage to a FILE via the Storage seam, so
 * we mock the storage provider with an in-memory Storage: the toggle helpers mutate the live config +
 * WRITE the file, and initSourceConfig READS the file back (merged over defaults; corrupt → all-active,
 * plus a one-time migration from the old localStorage blob). We reset the shared singleton between
 * tests so one test's toggles don't leak into the next.
 */
import { MemoryStorage } from '../storage/memory';

let storage = new MemoryStorage();
vi.mock('../storage/provider', () => ({
	getUserStorage: () => storage
}));

const {
	isRowActive,
	toggleFile,
	toggleSource,
	setCollision,
	parseSourceConfig,
	initSourceConfig,
	sourceConfig
} = await import('./sources.svelte');

function memLocalStorage() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k),
		clear: () => m.clear(),
		key: () => null,
		length: 0
	};
}

const row = (over: Partial<LoadedRow> = {}): LoadedRow =>
	({
		type: 'spell',
		id: 'fireball',
		effectiveId: 'spell:SRD 5.1:fireball',
		source: 'SRD 5.1',
		systems: ['5e'],
		root: 'content/srd-2014',
		file: 'spells_srd.csv',
		sourceLang: 'en',
		data: { name_en: 'Fireball' },
		...over
	}) as unknown as LoadedRow;

const FILE = 'content/srd-2014/spells_srd.csv';
const CONFIG_PATH = 'collisions.json';

/** The persist chain is fire-and-forget; wait a tick so the file write lands before asserting. */
const flush = () => new Promise((r) => setTimeout(r, 0));
const readConfig = async () => {
	try {
		return await storage.read(CONFIG_PATH);
	} catch {
		return '';
	}
};

beforeEach(() => {
	storage = new MemoryStorage();
	vi.stubGlobal('localStorage', memLocalStorage());
	sourceConfig.disabledFiles = [];
	sourceConfig.disabledSources = [];
	sourceConfig.collisions = {};
});
afterEach(() => vi.unstubAllGlobals());

describe('source toggles mutate + persist to the file', () => {
	it('toggleFile hides the row, writes the file, and toggles back', async () => {
		expect(isRowActive(row())).toBe(true);
		toggleFile(FILE);
		expect(isRowActive(row())).toBe(false);
		await flush();
		expect(await readConfig()).toContain(FILE); // persisted to collisions.json
		toggleFile(FILE); // second toggle re-enables
		expect(isRowActive(row())).toBe(true);
		await flush();
		expect(await readConfig()).not.toContain(FILE);
	});

	it('toggleSource hides every row of a source tag', async () => {
		toggleSource('SRD 5.1');
		expect(isRowActive(row())).toBe(false);
		expect(isRowActive(row({ source: 'SRD 5.2.1' }))).toBe(true); // a different tag is unaffected
		await flush();
		expect(await readConfig()).toContain('SRD 5.1');
	});

	it('setCollision keeps the chosen source and hides the losers; "all" clears it', async () => {
		const srd = row(); // source SRD 5.1
		const hb = row({ source: 'Homebrew', effectiveId: 'spell:Homebrew:fireball' });
		setCollision('spell:fireball', 'SRD 5.1');
		expect(isRowActive(srd)).toBe(true); // the kept one
		expect(isRowActive(hb)).toBe(false); // the losing source
		await flush();
		expect(await readConfig()).toContain('spell:fireball');
		setCollision('spell:fireball', 'all'); // resolving to "all" removes the entry
		expect(isRowActive(hb)).toBe(true);
		await flush();
		expect(await readConfig()).not.toContain('spell:fireball');
	});
});

describe('parseSourceConfig merges over defaults', () => {
	it('a saved disabledSources comes back', () => {
		const cfg = parseSourceConfig(
			JSON.stringify({ disabledSources: ['SRD 5.1'], disabledFiles: [], collisions: {} })
		);
		expect(isRowActive(row(), cfg)).toBe(false);
	});

	it('a corrupt snapshot degrades to defaults (all active), never throws', () => {
		expect(isRowActive(row(), parseSourceConfig('{not valid json'))).toBe(true);
	});

	it('a partial snapshot is merged over defaults (missing keys filled)', () => {
		const cfg = parseSourceConfig(JSON.stringify({ disabledFiles: [FILE] }));
		expect(isRowActive(row(), cfg)).toBe(false); // disabledFiles applied
		expect(isRowActive(row({ root: 'content/srd-2024', file: 'x.csv' }), cfg)).toBe(true); // rest default
	});
});

describe('initSourceConfig reads the file (and migrates the legacy blob)', () => {
	it('loads a persisted file into the live config', async () => {
		await storage.write(
			CONFIG_PATH,
			JSON.stringify({ disabledSources: ['SRD 5.1'], disabledFiles: [], collisions: {} })
		);
		await initSourceConfig();
		expect(isRowActive(row())).toBe(false); // from the file, not defaults
	});

	it('migrates the old localStorage blob when no file exists yet', async () => {
		localStorage.setItem(
			'charnik:sources',
			JSON.stringify({ disabledFiles: [FILE], disabledSources: [], collisions: {} })
		);
		await initSourceConfig();
		expect(isRowActive(row())).toBe(false); // migrated
		await flush();
		expect(await readConfig()).toContain(FILE); // written to the file so the next run reads it there
	});

	it('a missing file with no legacy blob leaves the all-active defaults', async () => {
		await initSourceConfig();
		expect(isRowActive(row())).toBe(true);
	});
});

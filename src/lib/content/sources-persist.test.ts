import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LoadedRow } from './loader';
import {
	isRowActive,
	toggleFile,
	toggleSource,
	setCollision,
	loadSourceConfig,
	sourceConfig
} from './sources.svelte';

/*
 * T5: the source/collision config PERSISTENCE round-trip (sources.test.ts covers the pure isRowActive
 * / detectCollisions). Two halves: the toggle helpers mutate the live config + WRITE localStorage, and
 * loadSourceConfig READS a persisted snapshot back (merged over defaults; corrupt → all-active). We
 * stub an in-memory localStorage and reset the shared singleton between tests, so no module re-import
 * is needed.
 */
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
const KEY = 'charnik:sources';

beforeEach(() => {
	vi.stubGlobal('localStorage', memLocalStorage());
	// reset the shared singleton so one test's toggles don't leak into the next
	sourceConfig.disabledFiles.length = 0;
	sourceConfig.disabledSources.length = 0;
	for (const k of Object.keys(sourceConfig.collisions)) delete sourceConfig.collisions[k];
});
afterEach(() => vi.unstubAllGlobals());

describe('source toggles mutate + persist', () => {
	it('toggleFile hides the row, writes localStorage, and toggles back', () => {
		expect(isRowActive(row())).toBe(true);
		toggleFile(FILE);
		expect(isRowActive(row())).toBe(false);
		expect(localStorage.getItem(KEY)).toContain(FILE); // persisted
		toggleFile(FILE); // second toggle re-enables
		expect(isRowActive(row())).toBe(true);
		expect(localStorage.getItem(KEY)).not.toContain(FILE);
	});

	it('toggleSource hides every row of a source tag', () => {
		toggleSource('SRD 5.1');
		expect(isRowActive(row())).toBe(false);
		expect(isRowActive(row({ source: 'SRD 5.2.1' }))).toBe(true); // a different tag is unaffected
		expect(localStorage.getItem(KEY)).toContain('SRD 5.1');
	});

	it('setCollision keeps the chosen source and hides the losers; "all" clears it', () => {
		const srd = row(); // source SRD 5.1
		const hb = row({ source: 'Homebrew', effectiveId: 'spell:Homebrew:fireball' });
		setCollision('spell:fireball', 'SRD 5.1');
		expect(isRowActive(srd)).toBe(true); // the kept one
		expect(isRowActive(hb)).toBe(false); // the losing source
		expect(localStorage.getItem(KEY)).toContain('spell:fireball');
		setCollision('spell:fireball', 'all'); // resolving to "all" removes the entry
		expect(isRowActive(hb)).toBe(true);
		expect(localStorage.getItem(KEY)).not.toContain('spell:fireball');
	});
});

describe('loadSourceConfig reads a persisted snapshot', () => {
	it('a saved disabledSources comes back', () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({ disabledSources: ['SRD 5.1'], disabledFiles: [], collisions: {} })
		);
		expect(isRowActive(row(), loadSourceConfig())).toBe(false); // from persistence, not defaults
	});

	it('a corrupt snapshot degrades to defaults (all active), never throws', () => {
		localStorage.setItem(KEY, '{not valid json');
		expect(isRowActive(row(), loadSourceConfig())).toBe(true);
	});

	it('a partial snapshot is merged over defaults (missing keys filled)', () => {
		localStorage.setItem(KEY, JSON.stringify({ disabledFiles: [FILE] })); // no sources/collisions
		const cfg = loadSourceConfig();
		expect(isRowActive(row(), cfg)).toBe(false); // disabledFiles applied
		expect(isRowActive(row({ root: 'content/srd-2024', file: 'x.csv' }), cfg)).toBe(true); // rest default
	});
});

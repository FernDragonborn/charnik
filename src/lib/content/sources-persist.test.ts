import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LoadedRow } from './loader';

/*
 * T5: the source/collision config PERSISTENCE round-trip (sources.test.ts covers the pure isRowActive
 * / detectCollisions; this covers the reactive toggle helpers + load()). Each test gets a fresh
 * in-memory localStorage AND a fresh module (resetModules), so we can assert both directions: a toggle
 * mutates the live config + writes localStorage, and a re-import reads that persisted config back via
 * load() — the "my disabled sources survive a restart" story.
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
	vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe('source toggles mutate + persist', () => {
	it('toggleFile hides the row, writes localStorage, and toggles back', async () => {
		const { isRowActive, toggleFile } = await import('./sources.svelte');
		expect(isRowActive(row())).toBe(true);
		toggleFile(FILE);
		expect(isRowActive(row())).toBe(false);
		expect(localStorage.getItem(KEY)).toContain(FILE); // persisted
		toggleFile(FILE); // second toggle re-enables
		expect(isRowActive(row())).toBe(true);
		expect(localStorage.getItem(KEY)).not.toContain(FILE);
	});

	it('toggleSource hides every row of a source tag', async () => {
		const { isRowActive, toggleSource } = await import('./sources.svelte');
		toggleSource('SRD 5.1');
		expect(isRowActive(row())).toBe(false);
		expect(isRowActive(row({ source: 'SRD 5.2.1' }))).toBe(true); // a different tag is unaffected
		expect(localStorage.getItem(KEY)).toContain('SRD 5.1');
	});

	it('setCollision keeps the chosen source and hides the losers; "all" clears it', async () => {
		const { isRowActive, setCollision } = await import('./sources.svelte');
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

describe('load() reads persisted config on (re)import', () => {
	it('a saved disabledSources survives a fresh module load', async () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({ disabledSources: ['SRD 5.1'], disabledFiles: [], collisions: {} })
		);
		vi.resetModules();
		const { isRowActive } = await import('./sources.svelte');
		expect(isRowActive(row())).toBe(false); // config came back from persistence, not defaults
	});

	it('a corrupt snapshot degrades to defaults (all active), never throws', async () => {
		localStorage.setItem(KEY, '{not valid json');
		vi.resetModules();
		const { isRowActive } = await import('./sources.svelte');
		expect(isRowActive(row())).toBe(true); // fell back to empty config
	});

	it('a partial snapshot is merged over the defaults (missing keys filled)', async () => {
		localStorage.setItem(KEY, JSON.stringify({ disabledFiles: [FILE] })); // no sources/collisions keys
		vi.resetModules();
		const { isRowActive } = await import('./sources.svelte');
		expect(isRowActive(row())).toBe(false); // disabledFiles applied
		expect(isRowActive(row({ root: 'content/srd-2024', file: 'x.csv' }))).toBe(true); // others default-active
	});
});

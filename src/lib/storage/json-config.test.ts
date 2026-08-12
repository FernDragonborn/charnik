import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryStorage } from './memory';

const storage = new MemoryStorage();
vi.mock('./provider', () => ({ getUserStorage: () => storage }));

const { readConfigFile, readConfigSection, writeConfigSection, configWritesSettled } =
	await import('./json-config');

const FILE = 'charnik.config.json';
/** Writes are fire-and-forget (queued); wait for the queue, then read what a caller would read. */
const settled = async (): Promise<Record<string, unknown>> => {
	await configWritesSettled(FILE);
	return readConfigFile(FILE);
};

describe('a config file with several owners', () => {
	beforeEach(() => storage.remove(FILE));

	it('a section write preserves every other key — the whole point of sections', async () => {
		await storage.write(FILE, JSON.stringify({ ruleOptions: { capacity: true } }));
		writeConfigSection(FILE, 'contentPacks', { updates: 'notify' });
		expect(await settled()).toEqual({
			ruleOptions: { capacity: true },
			contentPacks: { updates: 'notify' }
		});
	});

	it('two owners writing at once both survive — the queue is per FILE, not per module', async () => {
		writeConfigSection(FILE, 'contentPacks', { updates: 'off' });
		writeConfigSection(FILE, 'ruleOptions', { capacity: true });
		expect(await settled()).toEqual({
			contentPacks: { updates: 'off' },
			ruleOptions: { capacity: true }
		});
	});

	it('a corrupt or missing file degrades to defaults instead of throwing', async () => {
		expect(await readConfigFile(FILE)).toEqual({}); // absent
		await storage.write(FILE, '{oops');
		expect(await readConfigSection(FILE, 'contentPacks')).toBeUndefined();
		await storage.write(FILE, '[]'); // valid JSON, wrong shape
		expect(await readConfigFile(FILE)).toEqual({});
	});

	it('a corrupt file is REPLACED by the next write, not merged into', async () => {
		await storage.write(FILE, 'not json at all');
		writeConfigSection(FILE, 'contentPacks', { updates: 'notify' });
		expect(await settled()).toEqual({ contentPacks: { updates: 'notify' } });
	});

	it('a burst collapses into ONE file write — reconciling the pack registry persists once', async () => {
		const write = vi.spyOn(storage, 'write');
		// what a content load does: forget each uninstalled pack, adopt each bundled one
		for (let n = 0; n < 10; n++) writeConfigSection(FILE, 'contentPacks', { packs: n });
		writeConfigSection(FILE, 'ruleOptions', { capacity: true });
		expect(await settled()).toEqual({
			contentPacks: { packs: 9 },
			ruleOptions: { capacity: true }
		});
		expect(write).toHaveBeenCalledTimes(1);
		write.mockRestore();
	});

	it('a write made after the flush has started is not swallowed by it', async () => {
		writeConfigSection(FILE, 'contentPacks', { updates: 'notify' });
		await Promise.resolve(); // the flush may or may not have read the file yet — neither may lose a write
		writeConfigSection(FILE, 'ruleOptions', { capacity: true });
		expect(await settled()).toEqual({
			contentPacks: { updates: 'notify' },
			ruleOptions: { capacity: true }
		});
	});
});

/* Most sections can lose a write in silence — a theme preference is not worth a dialog. The pack
   registry cannot: a pin says "do not update this pack mid-campaign", and one that never reached the
   disk still reads as pinned for the rest of the session and is gone at the next launch. So the
   writer reports how it went, and the tenant decides whether that matters. */
describe('a write that fails tells whoever asked', () => {
	beforeEach(() => storage.remove(FILE));

	it('reports null when it landed', async () => {
		const told: unknown[] = [];
		writeConfigSection(FILE, 'contentPacks', { updates: 'off' }, (e) => told.push(e));
		await configWritesSettled(FILE);
		expect(told).toEqual([null]);
	});

	it('reports the failure, and the session does not crash on it', async () => {
		const boom = new Error('disk full');
		const write = vi.spyOn(storage, 'write').mockRejectedValueOnce(boom);
		const told: unknown[] = [];

		writeConfigSection(FILE, 'contentPacks', { updates: 'off' }, (e) => told.push(e));
		await configWritesSettled(FILE);

		expect(told).toEqual([boom]);
		write.mockRestore();
	});
});

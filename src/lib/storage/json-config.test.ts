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
});

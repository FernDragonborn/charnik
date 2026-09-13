import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchStorage } from './fetch';

/*
 * T2: FetchStorage — the ENTIRE web-build content path. It's a read-only Storage over `fetch`, so we
 * drive it with a mocked global fetch and assert the four behaviours that matter: read/readBytes error
 * mapping, manifest-backed list/exists (with a network HEAD fallback), the read-only write guards, and
 * URL/base-prefix joining. `manifest` is cached, so a second list() must not re-fetch it.
 */
type FakeResponse = {
	ok: boolean;
	status: number;
	text?: () => Promise<string>;
	json?: () => Promise<unknown>;
	arrayBuffer?: () => Promise<ArrayBuffer>;
};

const okText = (body: string): FakeResponse => ({
	ok: true,
	status: 200,
	text: () => Promise.resolve(body),
	arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
});
const okJson = (data: unknown): FakeResponse => ({
	ok: true,
	status: 200,
	json: () => Promise.resolve(data),
});
const notFound = (): FakeResponse => ({ ok: false, status: 404 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('FetchStorage.read / readBytes', () => {
	it('returns the body text on a 200', async () => {
		fetchMock.mockResolvedValueOnce(okText('id,name\n1,a'));
		await expect(new FetchStorage().read('content/x.csv')).resolves.toBe('id,name\n1,a');
	});

	it('throws with the status on a non-ok response', async () => {
		fetchMock.mockResolvedValueOnce(notFound());
		await expect(new FetchStorage().read('content/missing.csv')).rejects.toThrow(
			'fetch content/missing.csv: 404',
		);
	});

	it('readBytes returns the raw bytes', async () => {
		fetchMock.mockResolvedValueOnce(okText('AB'));
		const bytes = await new FetchStorage().readBytes('content/x.bin');
		expect([...bytes]).toEqual([65, 66]); // 'A','B'
	});
});

describe('FetchStorage.list / exists (manifest-backed)', () => {
	const manifest = { roots: { 'content/srd-2024': ['spells_srd.csv', 'items_srd.csv'] } };

	it('lists a root from the manifest', async () => {
		fetchMock.mockResolvedValueOnce(okJson(manifest));
		const entries = await new FetchStorage().list('content/srd-2024');
		expect(entries).toEqual([
			{ path: 'content/srd-2024/spells_srd.csv', name: 'spells_srd.csv', isDir: false },
			{ path: 'content/srd-2024/items_srd.csv', name: 'items_srd.csv', isDir: false },
		]);
	});

	it('reports the manifest roots under a dir as SUBDIRECTORIES (pack discovery scans for these)', async () => {
		fetchMock.mockResolvedValueOnce(
			okJson({ roots: { 'content/srd-2024': ['spells_srd.csv'], 'content/srd-2014': [] } }),
		);
		expect(await new FetchStorage().list('content')).toEqual([
			{ path: 'content/srd-2024', name: 'srd-2024', isDir: true },
			{ path: 'content/srd-2014', name: 'srd-2014', isDir: true },
		]);
	});

	/* A bundled pack may carry plugins in `plugins/<ns>/`, which the vendoring step emits as its own
	   manifest key. Walking down to them over HTTP only works if each level reports the next. */
	it('walks a pack’s nested plugin folders, one manifest key per level', async () => {
		const nested = {
			roots: {
				'content/dark-sun': ['classes_srd.csv'],
				'content/dark-sun/plugins/rules': ['main.js', 'plugin.json'],
			},
		};
		fetchMock.mockResolvedValue(okJson(nested));
		const s = new FetchStorage();
		expect(await s.list('content')).toEqual([
			{ path: 'content/dark-sun', name: 'dark-sun', isDir: true },
		]);
		expect(await s.list('content/dark-sun')).toEqual([
			{ path: 'content/dark-sun/plugins', name: 'plugins', isDir: true },
			{ path: 'content/dark-sun/classes_srd.csv', name: 'classes_srd.csv', isDir: false },
		]);
		expect(await s.list('content/dark-sun/plugins/rules')).toHaveLength(2);
		expect(await s.exists('content/dark-sun/plugins/rules/main.js')).toBe(true);
	});

	it('does not report a root as a subdirectory of itself', async () => {
		fetchMock.mockResolvedValueOnce(okJson(manifest));
		const entries = await new FetchStorage().list('content/srd-2024');
		expect(entries.every((e) => !e.isDir)).toBe(true);
	});

	it('an unknown dir lists empty (no throw)', async () => {
		fetchMock.mockResolvedValueOnce(okJson(manifest));
		await expect(new FetchStorage().list('content/nope')).resolves.toEqual([]);
	});

	it('caches the manifest — a second list() does not re-fetch it', async () => {
		fetchMock.mockResolvedValueOnce(okJson(manifest));
		const s = new FetchStorage();
		await s.list('content/srd-2024');
		await s.list('content/srd-2024');
		expect(fetchMock).toHaveBeenCalledTimes(1); // manifest fetched once, then cached
	});

	it('a missing manifest degrades to an empty root set', async () => {
		fetchMock.mockResolvedValueOnce(notFound());
		await expect(new FetchStorage().list('content/srd-2024')).resolves.toEqual([]);
	});

	it('exists is true for a manifest-listed file, false for a sibling not listed', async () => {
		fetchMock.mockResolvedValue(okJson(manifest));
		const s = new FetchStorage();
		await expect(s.exists('content/srd-2024/spells_srd.csv')).resolves.toBe(true);
		await expect(s.exists('content/srd-2024/ghost.csv')).resolves.toBe(false);
	});

	it('exists falls back to a network HEAD for a path outside the manifest', async () => {
		fetchMock.mockResolvedValueOnce(okJson(manifest)); // manifest load
		fetchMock.mockResolvedValueOnce({ ok: true, status: 200 }); // HEAD hit
		await expect(new FetchStorage().exists('other/dir/file.csv')).resolves.toBe(true);
		expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('other/dir/file.csv'), {
			method: 'HEAD',
		});
	});
});

describe('FetchStorage — read-only guards + URL joining', () => {
	it('every write path throws', async () => {
		const s = new FetchStorage();
		await expect(s.write()).rejects.toThrow('read-only');
		await expect(s.writeBytes()).rejects.toThrow('read-only');
		await expect(s.mkdir()).rejects.toThrow('read-only');
		await expect(s.remove()).rejects.toThrow('read-only');
	});

	it('watch is a no-op returning an unsubscribe fn', () => {
		expect(typeof new FetchStorage().watch()).toBe('function');
	});

	it('rejects a traversing path — the browser would resolve `..` before the request', async () => {
		await expect(new FetchStorage('/charnik').read('content/../../etc/passwd')).rejects.toThrow(
			'escapes storage root',
		);
	});

	it('collapses double slashes when joining the base prefix', async () => {
		fetchMock.mockResolvedValueOnce(okText('x'));
		await new FetchStorage('/charnik').read('content/x.csv');
		expect(fetchMock).toHaveBeenCalledWith('/charnik/content/x.csv');
	});
});

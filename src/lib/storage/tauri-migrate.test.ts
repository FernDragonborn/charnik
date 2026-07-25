import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

/*
 * T3: the data-folder MOVE/MERGE orchestration (walkTree → copyFilesInto → verify → finalizeMove).
 * The pure diff math (migrate.ts) is already covered; this drives the SEQUENCING + rollback + pointer
 * swap over an in-memory filesystem behind the Tauri-fs mocks, so the "move my data folder" user story
 * is exercised end-to-end: happy move, target-inside-source guard, copy-failure rollback (source left
 * intact, half-copy swept), verify-failure rollback, cleanup-only failure, and a real merge.
 */
const h = vi.hoisted(() => {
	const files = new Map<string, { size: number; mtime: number }>();
	const state = { override: null as string | null };
	const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
	return { files, state, norm };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
	readTextFile: vi.fn(),
	readFile: vi.fn(),
	writeFile: vi.fn(),
	copyFile: vi.fn(),
	exists: vi.fn(),
	readDir: vi.fn(),
	stat: vi.fn(),
	mkdir: vi.fn(),
	remove: vi.fn(),
	rename: vi.fn(),
	watchImmediate: vi.fn()
}));
vi.mock('@tauri-apps/api/path', () => ({
	documentDir: vi.fn(async () => '/docs'),
	join: vi.fn(async (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'))
}));
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async (cmd: string, args?: { path?: string }) => {
		if (cmd === 'set_data_dir') h.state.override = args?.path ?? null;
		if (cmd === 'saved_data_dir') return h.state.override;
		return null;
	})
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }));

const { migrateDataDir, mergeDataDir, listDataDirFiles } = await import('./tauri');

// --- in-memory fs helpers, re-wired each test so state can't leak -------------------------------
const seed = (path: string, size: number, mtime = 1000) => h.files.set(h.norm(path), { size, mtime });
const at = (path: string) => h.files.has(h.norm(path));

const defaultCopy = async (from: string | URL, to: string | URL) => {
	const f = h.files.get(h.norm(String(from)));
	if (!f) throw new Error(`ENOENT ${String(from)}`);
	h.files.set(h.norm(String(to)), { ...f });
};

beforeEach(() => {
	vi.clearAllMocks();
	h.files.clear();
	h.state.override = null;

	vi.mocked(fs.copyFile).mockImplementation(defaultCopy);
	vi.mocked(fs.exists).mockImplementation(async (p: string | URL) => {
		const n = h.norm(String(p));
		return h.files.has(n) || [...h.files.keys()].some((k) => k.startsWith(n + '/'));
	});
	vi.mocked(fs.readDir).mockImplementation(async (p: string | URL) => {
		const prefix = h.norm(String(p)) + '/';
		const names = new Map<string, boolean>(); // name → isDirectory
		for (const k of h.files.keys()) {
			if (!k.startsWith(prefix)) continue;
			const rest = k.slice(prefix.length);
			const seg = rest.split('/')[0] ?? '';
			names.set(seg, (names.get(seg) ?? false) || rest.includes('/'));
		}
		return [...names].map(([name, isDirectory]) => ({ name, isDirectory })) as never;
	});
	vi.mocked(fs.stat).mockImplementation(async (p: string | URL) => {
		const f = h.files.get(h.norm(String(p)));
		if (!f) throw new Error(`ENOENT ${String(p)}`);
		return { size: f.size, mtime: new Date(f.mtime) } as never;
	});
	vi.mocked(fs.mkdir).mockResolvedValue(undefined as never);
	vi.mocked(fs.remove).mockImplementation(async (p: string | URL) => {
		const n = h.norm(String(p));
		for (const k of [...h.files.keys()]) if (k === n || k.startsWith(n + '/')) h.files.delete(k);
	});
});

describe('migrateDataDir (move into an empty target)', () => {
	it('copies every file, repoints the pointer, and deletes the old folder', async () => {
		seed('/data/old/characters/hero/character.json', 5);
		seed('/data/old/content/homebrew.csv', 8);

		const r = await migrateDataDir('/data/old', '/data/new', true);

		expect(r).toEqual({ ok: true, failures: [] });
		expect(at('/data/new/characters/hero/character.json')).toBe(true);
		expect(at('/data/new/content/homebrew.csv')).toBe(true);
		expect(at('/data/old/characters/hero/character.json')).toBe(false); // old deleted
		expect(h.state.override).toBe('/data/new'); // pointer swapped
		expect(invoke).toHaveBeenCalledWith('set_data_dir', { path: '/data/new' });
	});

	it('keeps the old folder when deleteOld is false', async () => {
		seed('/data/old/a.csv', 3);
		const r = await migrateDataDir('/data/old', '/data/new', false);
		expect(r.ok).toBe(true);
		expect(at('/data/old/a.csv')).toBe(true); // source preserved
		expect(at('/data/new/a.csv')).toBe(true);
	});

	it('refuses a target nested inside the source (would copy into itself)', async () => {
		seed('/data/old/a.csv', 3);
		const r = await migrateDataDir('/data/old', '/data/old/sub', true);
		expect(r).toEqual({ ok: false, stage: 'target_inside_source', failures: [] });
		expect(fs.copyFile).not.toHaveBeenCalled();
		expect(h.state.override).toBeNull(); // pointer untouched
	});

	it('on a copy error: reports stage=copy, sweeps the half-copy, leaves the source + pointer intact', async () => {
		seed('/data/old/a.csv', 3);
		seed('/data/old/b.csv', 4);
		vi.mocked(fs.copyFile).mockRejectedValueOnce(new Error('disk full'));

		const r = await migrateDataDir('/data/old', '/data/new', true);

		expect(r.ok).toBe(false);
		expect(r.stage).toBe('copy');
		expect(r.error).toContain('disk full');
		expect(at('/data/old/a.csv')).toBe(true); // source intact — nothing deleted
		expect([...h.files.keys()].some((k) => k.startsWith('/data/new/'))).toBe(false); // swept
		expect(h.state.override).toBeNull();
	});

	it('on a verify miss: reports stage=verify with the missing file, nothing deleted', async () => {
		seed('/data/old/keep.csv', 3);
		seed('/data/old/dropped.csv', 9);
		// copy silently drops one file → the size/presence check must catch it
		vi.mocked(fs.copyFile).mockImplementation(async (from: string | URL, to: string | URL) => {
			if (String(from).includes('dropped.csv')) return; // vanished mid-copy
			await defaultCopy(from, to);
		});

		const r = await migrateDataDir('/data/old', '/data/new', true);

		expect(r.ok).toBe(false);
		expect(r.stage).toBe('verify');
		expect(r.failures).toEqual(['dropped.csv']);
		expect(at('/data/old/dropped.csv')).toBe(true); // source untouched
		expect(h.state.override).toBeNull();
	});

	it('cleanup-only failure: move SUCCEEDED (data at new + pointer moved) but old-folder delete failed', async () => {
		seed('/data/old/a.csv', 3);
		vi.mocked(fs.remove).mockRejectedValueOnce(new Error('locked'));

		const r = await migrateDataDir('/data/old', '/data/new', true);

		expect(r.ok).toBe(true); // the move itself is done
		expect(r.stage).toBe('cleanup');
		expect(r.error).toContain('locked');
		expect(at('/data/new/a.csv')).toBe(true);
		expect(h.state.override).toBe('/data/new'); // pointer already swapped
	});
});

describe('mergeDataDir (into a non-empty target)', () => {
	it('copies only files the target lacks or the source has newer, keeping the target otherwise', async () => {
		seed('/data/old/a.csv', 3, 200); // target lacks → copy
		seed('/data/old/b.csv', 4, 100); // target has a NEWER b → keep target
		seed('/data/new/b.csv', 7, 300);
		seed('/data/new/c.csv', 2, 50); // target-only → untouched

		const r = await mergeDataDir('/data/old', '/data/new', true);

		expect(r).toEqual({ ok: true, failures: [] });
		expect(h.files.get('/data/new/a.csv')?.size).toBe(3); // copied from old
		expect(h.files.get('/data/new/b.csv')?.size).toBe(7); // target's newer copy kept, not overwritten
		expect(at('/data/new/c.csv')).toBe(true);
		expect(at('/data/old/a.csv')).toBe(false); // old deleted after a verified merge
		expect(h.state.override).toBe('/data/new');
	});
});

describe('listDataDirFiles', () => {
	it('walks the tree into relative, forward-slashed paths with sizes', async () => {
		seed('/data/dir/top.csv', 11);
		seed('/data/dir/nested/deep.json', 22);
		const files = await listDataDirFiles('/data/dir');
		expect(files).toContainEqual(expect.objectContaining({ path: 'top.csv', size: 11 }));
		expect(files).toContainEqual(expect.objectContaining({ path: 'nested/deep.json', size: 22 }));
	});
});

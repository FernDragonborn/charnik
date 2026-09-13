/*
 * REL-4 slice 3 — diff and apply, over MemoryStorage and a fake fetcher. The properties worth
 * pinning are the ones that would cost a user real data: a hand-edited file is never overwritten,
 * a failed download writes NOTHING, and a removal is reported (with its blast radius) rather than
 * silently applied.
 */
import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { stampWithHash } from '../hash';
import { diffPack, gitBlobSha, rowsRemovedBy, charactersReferencing, FILE_CHANGE } from './diff';
import {
	applyPackUpdate,
	cachePath,
	hasRollback,
	isPackWriteInFlight,
	isStaged,
	pluginsIn,
	pruneCache,
	recoverInterruptedApply,
	rollbackPack,
	stagePackUpdate,
} from './install';
import type { RemotePack } from './github';
import type { RemoteFetcher } from './types';
import type { ContentGraph, LoadedRow } from '../loader';

const REPO = { owner: 'o', repo: 'r', branch: 'main' };
const enc = (s: string) => new TextEncoder().encode(s);

/** A shipped file exactly as the app writes one: body + a matching `#content-hash` (no drift). */
async function shippedFile(body: string): Promise<string> {
	return stampWithHash(new Map([['source', 'Test']]), body);
}

const fetcherOf = (files: Record<string, string>): RemoteFetcher => ({
	getText: async () => ({ kind: 'error', message: 'not used' }),
	getBytes: async (url) => {
		const hit = Object.entries(files).find(([path]) => url.endsWith(path));
		return hit ? { kind: 'ok', bytes: enc(hit[1]) } : { kind: 'error', message: `404 ${url}` };
	},
});

describe('gitBlobSha', () => {
	it("matches git's own object id, so a tree listing can be compared without downloading", async () => {
		// `printf 'hello' | git hash-object --stdin`
		expect(await gitBlobSha(enc('hello'))).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
	});
});

describe('diffPack', () => {
	it('classifies added / changed / unchanged / removed', async () => {
		const s = new MemoryStorage();
		const same = await shippedFile('id\nsame');
		await s.writeBytes('content/p/same.csv', enc(same));
		await s.writeBytes('content/p/old.csv', enc(await shippedFile('id\nold')));
		await s.writeBytes('content/p/gone.csv', enc(await shippedFile('id\ngone')));
		const remote: RemotePack = {
			pack: 'p',
			files: [
				{ path: 'p/same.csv', sha: await gitBlobSha(enc(same)) },
				{ path: 'p/old.csv', sha: 'different-sha' },
				{ path: 'p/new.csv', sha: 'whatever' },
			],
		};
		const diff = await diffPack(s, remote);
		// `expectLocal` is the disk state each decision was made against — re-checked at apply time
		expect(diff.changes.map(({ path, kind }) => ({ path, kind }))).toEqual(
			expect.arrayContaining([
				{ path: 'p/old.csv', kind: FILE_CHANGE.changed },
				{ path: 'p/new.csv', kind: FILE_CHANGE.added },
				{ path: 'p/gone.csv', kind: FILE_CHANGE.removed },
			]),
		);
		expect(diff.changes.find((c) => c.path === 'p/new.csv')?.expectLocal).toBeNull();
		// an unchanged file produces no entry at all
		expect(diff.changes.some((c) => c.path === 'p/same.csv')).toBe(false);
	});

	it('a HAND-EDITED file is preserved, never listed as changed (the REL-3 rule, reused)', async () => {
		const s = new MemoryStorage();
		// body no longer matches its own recorded hash → the user edited it
		await s.writeBytes('content/p/mine.csv', enc('#content-hash: xxh64:stale\nid\nMY EDIT'));
		const diff = await diffPack(s, {
			pack: 'p',
			files: [{ path: 'p/mine.csv', sha: 'upstream' }],
		});
		expect(diff.changes).toMatchObject([
			{ path: 'p/mine.csv', kind: FILE_CHANGE.preserved, sha: 'upstream' },
		]);
	});

	it('preserves a file with NO hash at all — "I cannot verify this" is not "overwrite it"', async () => {
		// the case this closes: a CSV the user dropped into a pack folder themselves, which an update
		// then happens to ship under the same name
		const s = new MemoryStorage();
		await s.writeBytes('content/p/mine.csv', enc('id\nMY OWN FILE'));
		const diff = await diffPack(s, { pack: 'p', files: [{ path: 'p/mine.csv', sha: 'upstream' }] });
		expect(diff.changes).toMatchObject([
			{ path: 'p/mine.csv', kind: FILE_CHANGE.preserved, sha: 'upstream' },
		]);
	});

	it('but plugin CODE is always overwritable — it can never carry a hash to be verified by', async () => {
		// `main.js`/`plugin.json` have nowhere to put a `#content-hash`, so the rule above would freeze
		// every pack-shipped plugin at its installed version forever. Code has a stronger guarantee
		// instead: new bytes void the consent hash, so nothing runs unapproved (PLUGINS §6.3).
		const s = new MemoryStorage();
		await s.writeBytes('content/p/plugins/ns/main.js', enc('globalThis.x = 1;'));
		const diff = await diffPack(s, {
			pack: 'p',
			files: [{ path: 'p/plugins/ns/main.js', sha: 'upstream' }],
		});
		expect(diff.changes).toMatchObject([
			{ path: 'p/plugins/ns/main.js', kind: FILE_CHANGE.changed, sha: 'upstream' },
		]);
	});

	it("never proposes deleting a file the pack format doesn't cover — it isn't the update's", async () => {
		// a README, notes the user keeps beside the data, a leftover from an older layout
		const s = new MemoryStorage();
		await s.writeBytes('content/p/NOTES.md', enc('my house rules'));
		expect((await diffPack(s, { pack: 'p', files: [] })).changes).toEqual([]);
	});

	it("a file the user wrote is preserved even when upstream doesn't ship it — the guard decides the DELETE path too", async () => {
		// the removal half of the rule above: `removeDeleted` would otherwise take a CSV the user
		// dropped into the pack folder, because nothing upstream ever mentioned it
		const s = new MemoryStorage();
		await s.writeBytes('content/p/mine.csv', enc('id\nMY OWN FILE'));
		const diff = await diffPack(s, { pack: 'p', files: [] });
		expect(diff.changes).toMatchObject([{ path: 'p/mine.csv', kind: FILE_CHANGE.preserved }]);
	});

	it('notices a plugin file the pack no longer ships — code, nested two levels down', async () => {
		// a pack's plugins live in `plugins/<ns>/`; a flat listing would leave deleted executable code
		// sitting on disk forever
		const s = new MemoryStorage();
		await s.writeBytes('content/p/plugins/old-rules/main.js', enc('globalThis.x = 1;'));
		const diff = await diffPack(s, { pack: 'p', files: [] });
		expect(diff.changes).toMatchObject([
			{ path: 'p/plugins/old-rules/main.js', kind: FILE_CHANGE.removed },
		]);
	});
});

describe('applyPackUpdate', () => {
	const diff = {
		pack: 'p',
		changes: [
			{ path: 'p/a.csv', kind: FILE_CHANGE.added },
			{ path: 'p/b.csv', kind: FILE_CHANGE.changed },
		],
	};

	it('writes every file, byte for byte', async () => {
		const s = new MemoryStorage();
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\na', 'p/b.csv': 'id\nb' }),
			repo: REPO,
			diff,
		});
		expect(res.error).toBeUndefined();
		expect(res.written).toEqual(['p/a.csv', 'p/b.csv']);
		expect(await s.read('content/p/b.csv')).toBe('id\nb');
	});

	it('ALL-OR-NOTHING: a download that fails halfway leaves the disk untouched', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/b.csv', enc('id\nOLD BUT INTACT'));
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\na' }), // b.csv 404s
			repo: REPO,
			diff,
		});
		expect(res.error).toEqual({ kind: 'raw', message: expect.stringMatching(/b\.csv/) });
		expect(res.written).toEqual([]);
		expect(await s.exists('content/p/a.csv')).toBe(false); // the one that DID download
		expect(await s.read('content/p/b.csv')).toBe('id\nOLD BUT INTACT');
	});

	it('REFUSES a pack that re-tags its #content-source — that is a new pack, not an update', async () => {
		// identity is `source:id`, so applying this would rename every row at once and every
		// character reference into the pack would resolve to nothing
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('#content-source: Old Name\nid\na'));
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({
				'p/a.csv': '#content-source: New Name\nid\na',
				'p/b.csv': '#content-source: New Name\nid\nb',
			}),
			repo: REPO,
			diff,
		});
		expect(res.error).toEqual({
			kind: 'i18n',
			key: 'settings.packs.sourceChanged',
			values: { pack: 'p', from: 'Old Name', to: 'New Name' },
		});
		expect(res.written).toEqual([]);
		expect(await s.read('content/p/a.csv')).toContain('Old Name'); // untouched
		expect(await s.exists('content/p/b.csv')).toBe(false);
	});

	/* The sibling question, asked of the same bytes at the same moment: the test above catches a pack
	   CHANGING its identity, this one catches a pack WEARING another's. `#content-source` is what the
	   compendium prints as an entry's origin, and nothing in the format stops a publisher writing
	   whatever they like there — so a pack stamping the SRD's tag renders as official beside it. */
	describe('a pack claiming a source another pack already publishes under', () => {
		const installed = {
			rows: [{ type: 'spell', source: 'SRD 5.2.1', id: 'fireball', root: 'content/srd-2024' }],
		} as ContentGraph;
		const impostor = () =>
			fetcherOf({ 'p/a.csv': '#content-source: SRD 5.2.1\nid\na', 'p/b.csv': 'id\nb' });

		it('stops and names both packs, writing nothing', async () => {
			const s = new MemoryStorage();
			const res = await applyPackUpdate({
				storage: s,
				fetcher: impostor(),
				repo: REPO,
				diff,
				graph: installed,
			});

			expect(res.sourceClaim).toEqual({ source: 'SRD 5.2.1', owner: 'srd-2024' });
			expect(res.error).toMatchObject({ key: 'settings.packs.sourceClaimed' });
			expect(res.written).toEqual([]);
			expect(await s.exists('content/p/a.csv')).toBe(false);
		});

		it('installs on the second click — a fork of the same content legitimately carries its tag', async () => {
			const s = new MemoryStorage();
			const res = await applyPackUpdate({
				storage: s,
				fetcher: impostor(),
				repo: REPO,
				diff,
				graph: installed,
				acceptSourceClaim: true,
			});

			expect(res.error).toBeUndefined();
			expect(await s.read('content/p/a.csv')).toContain('SRD 5.2.1');
		});

		it('says nothing when the pack UPDATING is the one that owns the tag', async () => {
			const s = new MemoryStorage();
			const own = {
				rows: [{ type: 'spell', source: 'SRD 5.2.1', id: 'fireball', root: 'content/p' }],
			} as ContentGraph;

			const res = await applyPackUpdate({
				storage: s,
				fetcher: impostor(),
				repo: REPO,
				diff,
				graph: own,
			});

			expect(res.sourceClaim).toBeUndefined();
			expect(res.error).toBeUndefined();
		});
	});

	it('the same source tag applies normally — the check must not block ordinary updates', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('#content-source: Same\nid\nold'));
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({
				'p/a.csv': '#content-source: Same\nid\nnew',
				'p/b.csv': '#content-source: Same\nid\nb',
			}),
			repo: REPO,
			diff,
		});
		expect(res.error).toBeUndefined();
		expect(res.written).toEqual(['p/a.csv', 'p/b.csv']);
	});

	it('a FRESH install has no local source to clash with, so it proceeds', async () => {
		const s = new MemoryStorage();
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({
				'p/a.csv': '#content-source: Brand New\nid\na',
				'p/b.csv': '#content-source: Brand New\nid\nb',
			}),
			repo: REPO,
			diff,
		});
		expect(res.error).toBeUndefined();
		expect(res.written).toHaveLength(2);
	});

	it('a removal is only applied when explicitly asked for', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/gone.csv', enc('id\ngone'));
		const withRemoval = {
			pack: 'p',
			changes: [{ path: 'p/gone.csv', kind: FILE_CHANGE.removed }],
		};
		const args = { storage: s, fetcher: fetcherOf({}), repo: REPO, diff: withRemoval };
		const kept = await applyPackUpdate(args);
		expect(kept.removed).toEqual([]);
		expect(await s.exists('content/p/gone.csv')).toBe(true);

		const dropped = await applyPackUpdate({ ...args, removeDeleted: true });
		expect(dropped.removed).toEqual(['p/gone.csv']);
		expect(await s.exists('content/p/gone.csv')).toBe(false);
	});
});

/** Applying replaces the pack's FOLDER, so the properties worth pinning are about the folder as a
 *  whole: everything the update didn't mention survives, the approved picture is re-checked against
 *  the disk first, and the copy it replaced is still there to go back to. */
describe('apply is a folder swap', () => {
	const diffFor = async (s: MemoryStorage, path: string) => ({
		pack: 'p',
		changes: [
			{
				path,
				kind: FILE_CHANGE.changed,
				expectLocal: await gitBlobSha(await s.readBytes(`content/${path}`)),
			},
		],
	});

	it('keeps every file the update never mentioned — a README, notes, a preserved edit', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('id\nold'));
		await s.writeBytes('content/p/NOTES.md', enc('my house rules'));
		await s.writeBytes('content/p/plugins/ns/main.js', enc('globalThis.x = 1;'));

		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\nnew' }),
			repo: REPO,
			diff: await diffFor(s, 'p/a.csv'),
		});

		expect(res.error).toBeUndefined();
		expect(await s.read('content/p/a.csv')).toBe('id\nnew');
		expect(await s.read('content/p/NOTES.md')).toBe('my house rules'); // carried across the swap
		expect(await s.read('content/p/plugins/ns/main.js')).toBe('globalThis.x = 1;'); // nested too
	});

	it('REFUSES when a file moved on disk after the diff was shown — the approval is stale', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('id\nold'));
		const diff = await diffFor(s, 'p/a.csv');
		await s.writeBytes('content/p/a.csv', enc('id\nMY EDIT, made while the panel was open'));

		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\nnew' }),
			repo: REPO,
			diff,
		});

		expect(res.error).toMatchObject({ key: 'settings.packs.localChanged' });
		expect(res.written).toEqual([]);
		expect(await s.read('content/p/a.csv')).toContain('MY EDIT'); // untouched
	});

	/* The disk half can throw where the network half returns a value — a full disk, `EBUSY` from a
	   CSV open in Excel. Landing between the two renames leaves the pack folder ABSENT, and once the
	   in-flight flag drops the next rebuild reads that as an uninstall and takes the registry entry
	   (repo URL + pin) with it. So the swap settles itself before the throw escapes. */
	it('puts the pack back when the swap itself fails, before anyone can read it as uninstalled', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('id\nold'));
		const diff = await diffFor(s, 'p/a.csv');
		// fail the LAST rename — `.new` → live — which is the moment the pack does not exist
		const realRename = s.rename.bind(s);
		s.rename = async (from: string, to: string) => {
			if (from === 'content/p.new') throw new Error('EBUSY');
			return realRename(from, to);
		};

		await expect(
			applyPackUpdate({
				storage: s,
				fetcher: fetcherOf({ 'p/a.csv': 'id\nnew' }),
				repo: REPO,
				diff,
			}),
		).rejects.toThrow('EBUSY');

		s.rename = realRename;
		expect(await s.exists('content/p')).toBe(true); // …not a hole where the pack used to be
		expect(await s.read('content/p/a.csv')).toBe('id\nold'); // and it is the version we started with
		expect(await s.exists('content/p.new')).toBe(false);
	});

	it('leaves the previous version behind, and can roll back to it', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('id\nold'));
		await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\nnew' }),
			repo: REPO,
			diff: await diffFor(s, 'p/a.csv'),
		});
		expect(await hasRollback(s, 'p')).toBe(true);

		expect(await rollbackPack(s, 'p')).toBe(true);
		expect(await s.read('content/p/a.csv')).toBe('id\nold');
		expect(await hasRollback(s, 'p')).toBe(false); // one generation only, and it was just used
	});
});

/** The impact preview that runs before this could only see whole FILES the remote dropped — which
 *  upstream rarely does. Deleting or re-iding a row inside a CSV is the ordinary case, and it
 *  arrives looking exactly like any other changed file. */
describe('rows that would vanish from inside a changed file', () => {
	const row = (id: string): LoadedRow =>
		({
			type: 'spell',
			source: 'Test',
			id,
			root: 'content/p',
			file: 'spells.csv',
		}) as LoadedRow;
	const graph = { rows: [row('fireball'), row('shield')] } as ContentGraph;
	const applying = async (s: MemoryStorage, csv: string, opts = {}) =>
		applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/spells.csv': csv }),
			repo: REPO,
			diff: { pack: 'p', changes: [{ path: 'p/spells.csv', kind: FILE_CHANGE.changed }] },
			graph,
			...opts,
		});

	it('stops and names them instead of writing — nothing is lost silently', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/spells.csv', enc('id\nfireball\nshield'));

		const res = await applying(s, 'id\nfireball'); // upstream dropped `shield`

		expect(res.rowRemovals).toEqual(['spell:Test:shield']);
		expect(res.written).toEqual([]);
		expect(await s.read('content/p/spells.csv')).toContain('shield'); // untouched
	});

	it('applies once the user has accepted them', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/spells.csv', enc('id\nfireball\nshield'));

		const res = await applying(s, 'id\nfireball', { acceptRowRemovals: true });

		expect(res.error).toBeUndefined();
		expect(await s.read('content/p/spells.csv')).not.toContain('shield');
	});

	it('says nothing when the update only ADDS rows — additions can not break anyone', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/spells.csv', enc('id\nfireball\nshield'));

		const res = await applying(s, 'id\nfireball\nshield\nmage_hand');

		expect(res.error).toBeUndefined();
		expect(res.written).toEqual(['p/spells.csv']);
	});
});

/** A kill between the two renames is the one moment the pack can be missing. Each in-between state
 *  is distinguishable from the folders left on disk, which is why no journal is needed. */
describe('recovering an interrupted apply', () => {
	it('discards a half-built replacement when the pack is still live', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('id\nlive'));
		await s.writeBytes('content/p.new/a.csv', enc('id\nhalf-built'));

		await recoverInterruptedApply(s, 'p');

		expect(await s.read('content/p/a.csv')).toBe('id\nlive');
		expect(await s.exists('content/p.new')).toBe(false);
	});

	it('puts the pack back when it died between the two renames', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p.prev/a.csv', enc('id\nold'));
		await s.writeBytes('content/p.new/a.csv', enc('id\nnew'));

		await recoverInterruptedApply(s, 'p');

		expect(await s.read('content/p/a.csv')).toBe('id\nold'); // the version that was live
		expect(await s.exists('content/p.new')).toBe(false);
	});

	/* A lone `.prev` is NOT reachable from either writer: both keep the replacement tree on disk
	   until the very last rename, so at the only moment the pack is missing BOTH staging folders
	   exist. On its own it means the live folder left by another route — a file-manager delete —
	   and renaming it back handed the user a pack they had deleted, one launch later. */
	it('drops an orphaned .prev instead of resurrecting a pack the user deleted', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p.prev/a.csv', enc('id\nold'));

		await recoverInterruptedApply(s, 'p');

		expect(await s.exists('content/p')).toBe(false);
		expect(await s.exists('content/p.prev')).toBe(false);
	});

	it('promotes the replacement when there is no old copy to go back to', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p.new/a.csv', enc('id\nnew'));

		await recoverInterruptedApply(s, 'p');

		expect(await s.read('content/p/a.csv')).toBe('id\nnew');
	});

	/* Found on a real desktop once the file watcher was fixed: an apply's OWN writes make the watcher
	   fire (28 events for a three-file pack), whose debounced reload rebuilds the content graph — and
	   that is where recovery runs from. Reading `<pack>.new` as a dead run's litter is only true
	   BETWEEN runs; during one it is the tree the next rename is about to promote. */
	it('says an apply is in flight, so a rebuild triggered by its own writes leaves it alone', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('id\nold'));
		expect(isPackWriteInFlight()).toBe(false);

		let sawInFlight = false;
		const watching: RemoteFetcher = {
			getText: async () => ({ kind: 'error', message: 'not used' }),
			getBytes: async () => ({ kind: 'ok', bytes: enc('id\nnew') }),
		};
		// the write phase is where the staging folder exists; sample the flag from inside it
		const spy = s.writeBytes.bind(s);
		s.writeBytes = async (path: string, data: Uint8Array) => {
			if (path.startsWith('content/p.new')) sawInFlight ||= isPackWriteInFlight();
			return spy(path, data);
		};

		await applyPackUpdate({
			storage: s,
			fetcher: watching,
			repo: REPO,
			diff: { pack: 'p', changes: [{ path: 'p/a.csv', kind: FILE_CHANGE.changed }] },
		});

		expect(sawInFlight).toBe(true);
		expect(isPackWriteInFlight()).toBe(false); // …and cleared once the swap is done
	});

	/* A rollback is the same two renames in reverse, so the pack is just as absent — and the reader
	   that matters there is not recovery but `forgetUninstalledPacks`, which reads an absent folder
	   as an uninstall and drops the registry entry. Same flag, raised by every pack write. */
	it('says so during a rollback too, not only during an apply', async () => {
		const s = new MemoryStorage();
		await s.writeBytes('content/p/a.csv', enc('id\nold'));
		await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\nnew' }),
			repo: REPO,
			diff: { pack: 'p', changes: [{ path: 'p/a.csv', kind: FILE_CHANGE.changed }] },
		});

		let sawInFlight = false;
		const spy = s.rename.bind(s);
		s.rename = async (from: string, to: string) => {
			sawInFlight ||= isPackWriteInFlight();
			return spy(from, to);
		};
		expect(await rollbackPack(s, 'p')).toBe(true);

		expect(sawInFlight).toBe(true);
		expect(isPackWriteInFlight()).toBe(false);
	});
});

/** "Check and pre-download" only means anything if the bytes it fetched are still there, and still
 *  the right bytes, when the user finally clicks Apply — possibly offline, possibly next week. */
describe('the pre-download staging cache', () => {
	const bodyA = 'id\na';
	const offline: RemoteFetcher = {
		getText: async () => ({ kind: 'error', message: 'offline' }),
		getBytes: async () => ({ kind: 'error', message: 'offline' }),
	};
	const stagedDiff = async () => ({
		pack: 'p',
		changes: [{ path: 'p/a.csv', kind: FILE_CHANGE.added, sha: await gitBlobSha(enc(bodyA)) }],
	});

	it('a staged update applies with NO network at all', async () => {
		const s = new MemoryStorage();
		const diff = await stagedDiff();
		await stagePackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': bodyA }),
			repo: REPO,
			diff,
		});
		expect(await isStaged(s, diff)).toBe(true);

		const res = await applyPackUpdate({ storage: s, fetcher: offline, repo: REPO, diff });
		expect(res.error).toBeUndefined();
		expect(await s.read('content/p/a.csv')).toBe(bodyA);
		// the cache is content-addressed and SHARED, so apply does not delete by SHA — another pending
		// pack can be waiting on the same blob. `pruneCache` clears it against everything still pending.
		expect(await isStaged(s, diff)).toBe(true);
		await pruneCache(s, new Set());
		expect(await isStaged(s, diff)).toBe(false);
	});

	/* The per-pack and per-repo caps say nothing about the TOTAL a check may fetch, and `download`
	   mode fetches without asking anyone. Running out is not an error — the offer stands, it just
	   pays for its bytes at the click. */
	it('stops pre-downloading when the run is out of budget, and still offers the update', async () => {
		const s = new MemoryStorage();
		const diff = await stagedDiff();
		const budget = { left: 0 };

		const complete = await stagePackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': bodyA }),
			repo: REPO,
			diff,
			budget,
		});

		expect(complete).toBe(false);
		expect(await isStaged(s, diff)).toBe(false); // nothing cached…
		// …and the update still applies, off the network, exactly as an un-staged one always did
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': bodyA }),
			repo: REPO,
			diff,
		});
		expect(res.error).toBeUndefined();
		expect(await s.read('content/p/a.csv')).toBe(bodyA);
	});

	it('spends the budget as it fetches, so a later pack in the same run sees less of it', async () => {
		const s = new MemoryStorage();
		const diff = await stagedDiff();
		const budget = { left: 1024 };

		await stagePackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': bodyA }),
			repo: REPO,
			diff,
			budget,
		});

		expect(budget.left).toBe(1024 - enc(bodyA).byteLength);
	});

	it('a cache entry whose bytes do not match its name is a MISS, not a shortcut', async () => {
		const s = new MemoryStorage();
		const diff = await stagedDiff();
		const sha = diff.changes[0]?.sha ?? '';
		await s.writeBytes(cachePath(sha), enc('id\nTRUNCATED'));

		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': bodyA }),
			repo: REPO,
			diff,
		});
		expect(res.error).toBeUndefined();
		expect(await s.read('content/p/a.csv')).toBe(bodyA); // re-fetched, not the corrupt copy
	});

	it('bytes that do not match the SHA we diffed against are refused, not written', async () => {
		// raw.githubusercontent.com serving a different revision than the tree listing did: writing it
		// would leave content whose SHA still differs, i.e. an update that never stops reappearing
		const s = new MemoryStorage();
		const res = await applyPackUpdate({
			storage: s,
			fetcher: fetcherOf({ 'p/a.csv': 'id\nSOMETHING ELSE' }),
			repo: REPO,
			diff: await stagedDiff(),
		});
		expect(res.error).toEqual({
			kind: 'i18n',
			key: 'settings.packs.contentMoved',
			values: { path: 'p/a.csv' },
		});
		expect(await s.exists('content/p/a.csv')).toBe(false);
	});

	it('prune keeps what is still pending and drops the rest', async () => {
		const s = new MemoryStorage();
		await s.writeBytes(cachePath('keep-me'), enc('x'));
		await s.writeBytes(cachePath('stale'), enc('y'));
		await pruneCache(s, new Set(['keep-me']));
		expect(await s.exists(cachePath('keep-me'))).toBe(true);
		expect(await s.exists(cachePath('stale'))).toBe(false);
	});
});

describe('the impact preview — what a removal would break', () => {
	const row = (file: string, id: string): LoadedRow =>
		({ root: 'content/p', file, type: 'class', source: 'SRD 5.2.1', id }) as LoadedRow;
	const graph = {
		rows: [row('gone.csv', 'barbarian'), row('stays.csv', 'bard')],
	} as ContentGraph;

	it('lists the rows that would disappear, keyed as a character references them', () => {
		const diff = { pack: 'p', changes: [{ path: 'p/gone.csv', kind: FILE_CHANGE.removed }] };
		expect(rowsRemovedBy(graph, diff)).toEqual(['class:SRD 5.2.1:barbarian']);
	});
	it('no removals → nothing to warn about', () => {
		expect(
			rowsRemovedBy(graph, { pack: 'p', changes: [{ path: 'p/x.csv', kind: FILE_CHANGE.added }] }),
		).toEqual([]);
	});
	it('names the characters that reference them, and only those', () => {
		const characters = [
			{ slug: 'grog', json: '{"build":{"classes":[{"class":"class:SRD 5.2.1:barbarian"}]}}' },
			{ slug: 'scanlan', json: '{"build":{"classes":[{"class":"class:SRD 5.2.1:bard"}]}}' },
		];
		expect(charactersReferencing(characters, ['class:SRD 5.2.1:barbarian'])).toEqual([
			{ slug: 'grog', keys: ['class:SRD 5.2.1:barbarian'] },
		]);
	});
	it('a longer id that merely CONTAINS the key is not a match (quoted comparison)', () => {
		const characters = [{ slug: 'x', json: '{"c":"class:SRD 5.2.1:barbarian-variant"}' }];
		expect(charactersReferencing(characters, ['class:SRD 5.2.1:barbarian'])).toEqual([]);
	});
});

describe('pluginsIn — the installer must disclose code before installing', () => {
	it('finds the namespaces a pack would add', () => {
		expect(
			pluginsIn({
				pack: 'dark-sun',
				files: [
					{ path: 'dark-sun/items_srd.csv', sha: 'a' },
					{ path: 'dark-sun/plugins/my-homebrew/main.js', sha: 'b' },
					{ path: 'dark-sun/plugins/my-homebrew/plugin.json', sha: 'c' },
					{ path: 'dark-sun/plugins/other/main.js', sha: 'd' },
				],
			}),
		).toEqual(['my-homebrew', 'other']);
	});
	it('a data-only pack ships no code', () => {
		expect(pluginsIn({ pack: 'p', files: [{ path: 'p/a.csv', sha: 'x' }] })).toEqual([]);
	});
});

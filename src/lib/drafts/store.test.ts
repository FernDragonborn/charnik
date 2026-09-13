import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import {
	writeDraft,
	readDraft,
	deleteDraft,
	listDrafts,
	draftEffectiveId,
	draftsTargeting,
	findOrphanDrafts,
	repointDraft,
	findStaleDrafts,
	findUnreadableDrafts,
	deleteDraftFiles,
	discardDrafts,
	type DraftTarget,
} from './store';

const translateTarget: DraftTarget = {
	kind: 'translate',
	type: 'spell',
	source: 'SRD 5.2.1',
	id: 'fireball',
	locale: 'uk',
};

describe('draft store', () => {
	it('round-trips a self-contained draft (filename-safe despite `:` + spaces in the identity)', async () => {
		const s = new MemoryStorage();
		await writeDraft(s, translateTarget, { name: 'Вогняна куля', text: 'опис' }, 'xxh64:abc');
		const env = await readDraft(s, translateTarget);
		expect(env?.data.name).toBe('Вогняна куля');
		expect(env?.sourceHash).toBe('xxh64:abc');
		expect(env?.target).toEqual(translateTarget);
	});

	it('overwrites the same target — deterministic filename, one file, no duplicates', async () => {
		const s = new MemoryStorage();
		await writeDraft(s, translateTarget, { name: 'a', text: '' });
		await writeDraft(s, translateTarget, { name: 'b', text: '' });
		expect((await listDrafts(s)).length).toBe(1);
		expect((await readDraft(s, translateTarget))?.data.name).toBe('b');
	});

	it('deletes on save and lists what remains', async () => {
		const s = new MemoryStorage();
		const addTarget: DraftTarget = { kind: 'add', type: 'spell', addGuid: 'guid-1' };
		await writeDraft(s, translateTarget, { name: 'x', text: '' });
		await writeDraft(s, addTarget, { id: 'new-spell' });
		expect((await listDrafts(s)).length).toBe(2);
		await deleteDraft(s, translateTarget);
		expect((await listDrafts(s)).map((d) => d.target.kind)).toEqual(['add']);
		expect(await readDraft(s, translateTarget)).toBeNull();
	});

	it('refuses a draft from a different schema version WITHOUT removing it', async () => {
		// a read must not destroy what `findStaleDrafts` exists to warn about: the warning runs in one
		// place, the read in four, so opening Translate used to delete the unsaved work silently
		const s = new MemoryStorage();
		await writeDraft(s, translateTarget, { name: 'old', text: '' });
		const path = `drafts/${encodeURIComponent('translate:spell:SRD 5.2.1:fireball:uk')}.json`;
		const env = JSON.parse(await s.read(path));
		env.schemaVersion = 999; // pretend a newer app wrote it
		await s.write(path, JSON.stringify(env));
		expect(await readDraft(s, translateTarget)).toBeNull();
		expect(await s.exists(path)).toBe(true);
		expect((await findStaleDrafts(s)).length).toBe(1); // still there to be named, then discarded
		await discardDrafts(s, await findStaleDrafts(s));
		expect(await s.exists(path)).toBe(false);
	});

	it('a stray .json in drafts/ is UNREADABLE, not a draft with no target', async () => {
		// it parsed, so it counted as a readable draft — and every consumer then dereferenced a
		// `target` that was not there, taking the discard dialog down while it rendered
		const s = new MemoryStorage();
		await writeDraft(s, { kind: 'add', type: 'spell', addGuid: 'g1' }, { name: 'new' });
		await s.write('drafts/stray.json', JSON.stringify({ hello: 'world' }));
		expect((await listDrafts(s)).map((d) => d.target.kind)).toEqual(['add']);
		expect(await findStaleDrafts(s)).toEqual([]);
		expect(await findUnreadableDrafts(s)).toEqual(['drafts/stray.json']);
		await expect(discardDrafts(s, await findStaleDrafts(s))).resolves.toBeUndefined();
	});

	it('escapes the one unreserved character Windows forbids in a filename', async () => {
		const s = new MemoryStorage();
		const target = { kind: 'editor', type: 'item', source: 'My*Pack', id: 'axe' } as const;
		await writeDraft(s, target, { name: 'Axe' });
		expect((await s.list('drafts')).map((e) => e.name)).toEqual([
			'editor%3Aitem%3AMy%2APack%3Aaxe.json',
		]);
		expect(await readDraft(s, target)).not.toBeNull();
	});

	it('is empty when there is no drafts folder', async () => {
		expect(await listDrafts(new MemoryStorage())).toEqual([]);
	});

	it('effectiveId points a translate/editor draft at its row; an add draft has none', () => {
		expect(draftEffectiveId(translateTarget)).toBe('spell:SRD 5.2.1:fireball');
		expect(
			draftEffectiveId({ kind: 'editor', type: 'monster', source: 'SRD 5.1', id: 'goblin' }),
		).toBe('monster:SRD 5.1:goblin');
		expect(draftEffectiveId({ kind: 'add', type: 'spell', addGuid: 'g' })).toBeNull();
	});

	it('finds only drafts whose row is gone (add drafts are never orphans)', async () => {
		const s = new MemoryStorage();
		await writeDraft(s, translateTarget, { name: 'kept', text: '' }); // row exists
		const goneTarget: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'phb',
			id: 'gone',
			locale: 'uk',
		};
		await writeDraft(s, goneTarget, { name: 'orphan', text: '' }); // row missing
		await writeDraft(s, { kind: 'add', type: 'spell', addGuid: 'g1' }, { id: 'x' }); // add: never orphan
		const present = new Set(['spell:SRD 5.2.1:fireball']);
		const orphans = await findOrphanDrafts(s, (eid) => present.has(eid));
		expect(orphans.map((o) => o.data.name)).toEqual(['orphan']);
	});

	/* The mirror of the orphan scan, and what the content-pack update preview asks: a draft pointed
	   at a row an update is about to delete is orphaned exactly as a character's reference is — and
	   unlike a character, it is unsaved work that is listed nowhere else. */
	it('finds drafts pointed at rows that are ABOUT to go', async () => {
		const s = new MemoryStorage();
		await writeDraft(s, translateTarget, { name: 'doomed', text: '' });
		await writeDraft(
			s,
			{ kind: 'editor', type: 'monster', source: 'SRD 5.1', id: 'goblin' },
			{ name: 'safe' },
		);
		await writeDraft(s, { kind: 'add', type: 'spell', addGuid: 'g1' }, { id: 'x' });

		const hit = await draftsTargeting(s, ['spell:SRD 5.2.1:fireball', 'spell:SRD 5.2.1:absent']);

		expect(hit.map((d) => d.data.name)).toEqual(['doomed']);
		expect(await draftsTargeting(s, [])).toEqual([]); // no removals, no scan
	});

	it('re-points an orphan onto a new target, moving its data and clearing the old file', async () => {
		const s = new MemoryStorage();
		const from: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'phb',
			id: 'gone',
			locale: 'uk',
		};
		const to: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'SRD 5.1',
			id: 'chill_touch',
			locale: 'uk',
		};
		await writeDraft(s, from, { name: 'Дотик холоду', text: 'опис' }, 'xxh64:z');
		expect(await repointDraft(s, from, to)).toBe('moved');
		expect(await readDraft(s, from)).toBeNull();
		const moved = await readDraft(s, to);
		expect(moved?.data.name).toBe('Дотик холоду');
		expect(moved?.sourceHash).toBe('xxh64:z');
	});

	it('refuses to clobber an existing draft at the destination (conflict = a user choice)', async () => {
		const s = new MemoryStorage();
		const from: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'phb',
			id: 'gone',
			locale: 'uk',
		};
		const to: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'SRD 5.1',
			id: 'chill_touch',
			locale: 'uk',
		};
		await writeDraft(s, from, { name: 'incoming', text: '' });
		await writeDraft(s, to, { name: 'existing', text: '' });
		expect(await repointDraft(s, from, to)).toBe('conflict');
		expect((await readDraft(s, to))?.data.name).toBe('existing'); // untouched
		expect((await readDraft(s, from))?.data.name).toBe('incoming'); // source still there
		expect(await repointDraft(s, from, to, true)).toBe('moved'); // overwrite = user chose incoming
		expect((await readDraft(s, to))?.data.name).toBe('incoming');
		expect(await readDraft(s, from)).toBeNull();
	});

	it('finds stale-version drafts (without removing them) and discards on request', async () => {
		const s = new MemoryStorage();
		await writeDraft(s, translateTarget, { name: 'current', text: '' }); // current version
		const stale: DraftTarget = { kind: 'add', type: 'spell', addGuid: 'old' };
		await writeDraft(s, stale, { name_en: 'Old draft' });
		// hand-patch the add draft to a future schema version (a bumped app wrote it)
		const path = `drafts/${encodeURIComponent('add:old')}.json`;
		const env = JSON.parse(await s.read(path));
		env.schemaVersion = 999;
		await s.write(path, JSON.stringify(env));

		const staleDrafts = await findStaleDrafts(s);
		expect(staleDrafts.map((d) => d.target.kind)).toEqual(['add']);
		expect(await s.exists(path)).toBe(true); // NOT removed by the scan — warned first
		expect((await listDrafts(s)).length).toBe(1); // the current-version one still lists

		await discardDrafts(s, staleDrafts);
		expect(await s.exists(path)).toBe(false); // now gone
		expect(await findStaleDrafts(s)).toEqual([]);
	});

	it('reports a draft file that no longer parses, and leaves the readable ones alone', async () => {
		const s = new MemoryStorage();
		await writeDraft(s, translateTarget, { name: 'fine', text: '' });
		// a truncated write / a hand-edit that broke the JSON: the file is there, the content is not
		const broken = 'drafts/broken.json';
		await s.write(broken, '{"target":{"kind":"add"');

		expect(await findUnreadableDrafts(s)).toEqual([broken]);
		expect((await listDrafts(s)).length).toBe(1); // the good one is unaffected by its neighbour
		expect(await findStaleDrafts(s)).toEqual([]); // and it is not miscounted as a stale one

		await deleteDraftFiles(s, [broken]);
		expect(await s.exists(broken)).toBe(false);
		expect(await findUnreadableDrafts(s)).toEqual([]);
	});

	it('reports a missing source when re-pointing a draft that is not there', async () => {
		const s = new MemoryStorage();
		const from: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'phb',
			id: 'x',
			locale: 'uk',
		};
		const to: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'srd',
			id: 'y',
			locale: 'uk',
		};
		expect(await repointDraft(s, from, to)).toBe('missing');
	});
});

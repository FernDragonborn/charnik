import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import {
	writeDraft,
	readDraft,
	deleteDraft,
	listDrafts,
	draftEffectiveId,
	findOrphanDrafts,
	repointDraft,
	type DraftTarget
} from './store';

const translateTarget: DraftTarget = {
	kind: 'translate',
	type: 'spell',
	source: 'SRD 5.2.1',
	id: 'fireball',
	locale: 'uk'
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

	it('discards a draft from a different schema version (ephemeral WIP → not migrated) and removes it', async () => {
		const s = new MemoryStorage();
		await writeDraft(s, translateTarget, { name: 'old', text: '' });
		const path = `drafts/${encodeURIComponent('translate:spell:SRD 5.2.1:fireball:uk')}.json`;
		const env = JSON.parse(await s.read(path));
		env.schemaVersion = 999; // pretend a newer app wrote it
		await s.write(path, JSON.stringify(env));
		expect(await readDraft(s, translateTarget)).toBeNull();
		expect(await s.exists(path)).toBe(false);
	});

	it('is empty when there is no drafts folder', async () => {
		expect(await listDrafts(new MemoryStorage())).toEqual([]);
	});

	it('effectiveId points a translate/editor draft at its row; an add draft has none', () => {
		expect(draftEffectiveId(translateTarget)).toBe('spell:SRD 5.2.1:fireball');
		expect(
			draftEffectiveId({ kind: 'editor', type: 'monster', source: 'SRD 5.1', id: 'goblin' })
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
			locale: 'uk'
		};
		await writeDraft(s, goneTarget, { name: 'orphan', text: '' }); // row missing
		await writeDraft(s, { kind: 'add', type: 'spell', addGuid: 'g1' }, { id: 'x' }); // add: never orphan
		const present = new Set(['spell:SRD 5.2.1:fireball']);
		const orphans = await findOrphanDrafts(s, (eid) => present.has(eid));
		expect(orphans.map((o) => o.data.name)).toEqual(['orphan']);
	});

	it('re-points an orphan onto a new target, moving its data and clearing the old file', async () => {
		const s = new MemoryStorage();
		const from: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'phb',
			id: 'gone',
			locale: 'uk'
		};
		const to: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'SRD 5.1',
			id: 'chill_touch',
			locale: 'uk'
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
			locale: 'uk'
		};
		const to: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'SRD 5.1',
			id: 'chill_touch',
			locale: 'uk'
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

	it('reports a missing source when re-pointing a draft that is not there', async () => {
		const s = new MemoryStorage();
		const from: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'phb',
			id: 'x',
			locale: 'uk'
		};
		const to: DraftTarget = {
			kind: 'translate',
			type: 'spell',
			source: 'srd',
			id: 'y',
			locale: 'uk'
		};
		expect(await repointDraft(s, from, to)).toBe('missing');
	});
});

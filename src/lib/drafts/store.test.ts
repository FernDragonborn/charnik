import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { writeDraft, readDraft, deleteDraft, listDrafts, type DraftTarget } from './store';

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
});

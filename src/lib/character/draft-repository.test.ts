/*
 * Drafts are scratch work, so this file's job is mostly about what does NOT happen: a bad file must
 * not take the list down, and nothing here may throw past the caller.
 */
import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import {
	saveDraft,
	loadDraft,
	listDrafts,
	deleteDraft,
	type DraftRecord,
} from './draft-repository';

const record = (guid: string, savedAt: string, name = ''): DraftRecord => ({
	guid,
	savedAt,
	summary: { name, classes: 'wizard 3', level: 3, system: '5.5e' },
	draft: { name, speciesId: 'species:srd:elf' },
	classPicks: [['class:srd:wizard', { subclassId: 'subclass:srd:evoker' }]],
});

describe('draft repository', () => {
	it('round-trips a draft with its class-picks cache', async () => {
		const s = new MemoryStorage();
		await saveDraft(s, record('a', '2026-08-29T10:00:00Z', 'Hilda'));
		const back = await loadDraft(s, 'a');
		expect(back?.summary.name).toBe('Hilda');
		expect(back?.classPicks).toEqual([['class:srd:wizard', { subclassId: 'subclass:srd:evoker' }]]);
	});

	it('lists newest first', async () => {
		const s = new MemoryStorage();
		await saveDraft(s, record('old', '2026-08-01T10:00:00Z'));
		await saveDraft(s, record('new', '2026-08-29T10:00:00Z'));
		expect((await listDrafts(s)).map((d) => d.guid)).toEqual(['new', 'old']);
	});

	it('drops an unreadable draft instead of failing the whole list', async () => {
		const s = new MemoryStorage();
		await saveDraft(s, record('good', '2026-08-29T10:00:00Z'));
		await s.write('character-drafts/broken.json', '{ not json');
		await s.write('character-drafts/half.json', '{"guid":"half"}'); // no savedAt/summary/draft
		expect((await listDrafts(s)).map((d) => d.guid)).toEqual(['good']);
	});

	it('is quiet about a draft that is not there', async () => {
		const s = new MemoryStorage();
		expect(await listDrafts(s)).toEqual([]);
		expect(await loadDraft(s, 'nope')).toBeNull();
		await expect(deleteDraft(s, 'nope')).resolves.toBeUndefined();
	});

	it('deletes only the one asked for', async () => {
		const s = new MemoryStorage();
		await saveDraft(s, record('a', '2026-08-29T10:00:00Z'));
		await saveDraft(s, record('b', '2026-08-28T10:00:00Z'));
		await deleteDraft(s, 'a');
		expect((await listDrafts(s)).map((d) => d.guid)).toEqual(['b']);
	});
});

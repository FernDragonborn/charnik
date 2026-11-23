/** The unfinished build's session after Create: an autosave still pending must not write it back. */
import { describe, expect, it, vi } from 'vitest';
import type { Storage } from '#lib/storage/types.ts';

const { storage } = await vi.hoisted(async () => {
	const { MemoryStorage } = await import('#lib/storage/memory.ts');
	return { storage: new MemoryStorage() as Storage };
});
vi.mock('#lib/storage/provider.ts', () => ({ getUserStorage: () => storage }));

const { DraftSession } = await import('./draft-session.svelte');
const { blankDraft } = await import('./draft');
const { listDrafts } = await import('#lib/character/draft-repository.ts');

describe('DraftSession', () => {
	it('writes nothing for a build that became a character, under any identity', async () => {
		const draft = { ...blankDraft(), name: 'Aria' };
		const session = new DraftSession(() => ({ draft, classPicks: new Map(), isEditing: false }));
		await session.persist();
		expect(await listDrafts(storage)).toHaveLength(1);

		await session.discard();
		// the autosave the photo write armed, landing after Create
		await session.persist();
		expect(await listDrafts(storage)).toEqual([]);

		// and the next build typed into the same page is a draft again
		draft.name = 'Brann';
		await session.persist();
		expect((await listDrafts(storage)).map((d) => d.guid)).toEqual([session.guid]);
	});

	it('a write already on its way when Create lands does not leave the build behind as a draft', async () => {
		const draft = { ...blankDraft(), name: 'Cora' };
		const session = new DraftSession(() => ({ draft, classPicks: new Map(), isEditing: false }));
		const inFlight = session.persist(); // the debounce fired a moment before Create
		const created = session.guid;
		await session.discard();
		await inFlight;
		expect((await listDrafts(storage)).map((d) => d.guid)).not.toContain(created);
	});
});

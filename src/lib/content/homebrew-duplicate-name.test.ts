/** Two homebrew rows under one name coexist, each under an id the schema accepts. */
import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { saveHomebrewRow } from './homebrew';

describe('a second homebrew row under a name already taken', () => {
	it('is saved under an id of its own', async () => {
		const storage = new MemoryStorage();
		const draft = { name_en: 'My Item', systems: '5e', category: 'gear' };

		const first = await saveHomebrewRow(storage, 'item', draft);
		expect(first).toEqual({ ok: true, id: 'my_item' });

		// `-` is the formula language's minus, so the id rule (`a-z 0-9 _`) refuses `my_item-2`
		const second = await saveHomebrewRow(storage, 'item', draft);
		expect(second).toEqual({ ok: true, id: 'my_item_2' });
	});
});

/** The open character whose folder was deleted outside the app, and the answer that the file wins. */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	characters,
	loadRoster,
	openCharacter,
	removeCharacter,
	resolveConflict,
	saveCharacterGuarded,
	saveCharacterToStore,
	CONFLICT_CHOICE,
} from './store.svelte';
import { dirOf } from './repository';
import { newCharacter } from './schema';
import { getUserStorage } from '$lib/storage/provider';

beforeEach(async () => {
	await loadRoster();
	for (const entry of [...characters.roster]) await removeCharacter(entry.id);
	characters.active = null;
	characters.conflict = null;
});

describe('the open character whose folder was deleted outside the app', () => {
	it('"take the file" does not leave a sheet open that writes the folder back', async () => {
		await saveCharacterToStore(newCharacter('ghost', 'Ghost', '5.5e'));
		const open = await openCharacter('ghost');
		if (!open) throw new Error('the character just saved does not open');
		const storage = getUserStorage();
		await storage.remove(dirOf('ghost')); // the player deletes the folder in the file manager

		open.play.hp.current = 7;
		expect(await saveCharacterGuarded(open)).toBe(false);
		expect(characters.conflict).not.toBeNull(); // the question is asked, as it should be

		// the answer "the file's state wins": the file's state is that there is no character
		await resolveConflict(CONFLICT_CHOICE.file);
		expect(characters.roster.map((entry) => entry.id)).not.toContain('ghost');

		// the sheet is still on screen, and its next edit is an ordinary save
		const stillOpen = characters.active;
		if (stillOpen) {
			stillOpen.play.hp.current = 6;
			await saveCharacterGuarded(stillOpen);
		}
		expect(await storage.exists(dirOf('ghost'))).toBe(false);
		expect(characters.active).toBeNull();
	});
});

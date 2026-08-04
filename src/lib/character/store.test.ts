/*
 * CH10 verification — the roster CRUD store, driven over the real repository + a (fake) IndexedDB.
 * Asserts the observable behaviour of the shared `characters` store: save/open/remove keep the
 * roster + active + guid consistent. Behavioural, not shape-coupled.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
	characters,
	loadRoster,
	saveCharacterToStore,
	openCharacter,
	removeCharacter,
	ensureActiveCharacter,
	recreateDemoCharacter
} from './store.svelte';
import { newCharacter } from './schema';
import { getUserStorage } from '$lib/storage/provider';
import { DEMO_ID } from '$lib/demo/sheet';

// mirrors the internal marker path in store.svelte.ts (not exported — the persistent "demo already
// seeded once" flag). Tests drop it to simulate a pristine first run.
const DEMO_SEEDED_MARKER = 'demo-seeded.json';

// each test starts from an empty roster (the store is a shared singleton + IndexedDB persists)
beforeEach(async () => {
	await loadRoster(); // may seed the demo on the very first run
	for (const e of [...characters.roster]) await removeCharacter(e.id);
	characters.active = null;
});

describe('character store · roster CRUD (CH10)', () => {
	it('save adds to the roster and rotates the guid', async () => {
		const before = characters.guid;
		await saveCharacterToStore(newCharacter('valen', 'Valen', '5.5e'));
		expect(characters.roster.map((e) => e.id)).toContain('valen');
		expect(characters.guid).not.toBe(before);
	});

	it('open sets the active character; saving the active one refreshes it', async () => {
		await saveCharacterToStore(newCharacter('mira', 'Mira', '5.5e'));
		const opened = await openCharacter('mira');
		expect(opened?.id).toBe('mira');
		expect(characters.active?.id).toBe('mira');

		const edited = { ...characters.active! };
		edited.build.name = 'Mira the Bold';
		await saveCharacterToStore(edited);
		expect(characters.active?.build.name).toBe('Mira the Bold'); // active kept in sync
	});

	it('remove deletes from the roster and clears active when it was the active one', async () => {
		await saveCharacterToStore(newCharacter('gone', 'Gone', '5.5e'));
		await openCharacter('gone');
		expect(characters.active?.id).toBe('gone');
		await removeCharacter('gone');
		expect(characters.roster.map((e) => e.id)).not.toContain('gone');
		expect(characters.active).toBeNull();
	});

	it('removing a NON-active character leaves the active one intact', async () => {
		await saveCharacterToStore(newCharacter('keep', 'Keep', '5.5e'));
		await saveCharacterToStore(newCharacter('drop', 'Drop', '5.5e'));
		await openCharacter('keep');
		await removeCharacter('drop');
		expect(characters.active?.id).toBe('keep');
		expect(characters.roster.map((e) => e.id)).toEqual(['keep']);
	});
});

describe('character store · demo seed-once lifecycle', () => {
	it('seeds the demo on the FIRST run (no marker), and records the marker', async () => {
		const s = getUserStorage();
		// simulate a pristine first run: drop the marker + any characters
		await s.remove(DEMO_SEEDED_MARKER).catch(() => {});
		for (const e of [...characters.roster]) await removeCharacter(e.id);
		await loadRoster();
		expect(characters.roster.map((e) => e.id)).toContain(DEMO_ID);
		expect(await s.exists(DEMO_SEEDED_MARKER)).toBe(true);
	});

	it('deleting the demo does NOT resurrect it, and an empty roster yields no active character', async () => {
		await recreateDemoCharacter(); // demo present + marker set + active = demo
		await removeCharacter(DEMO_ID); // also clears active (it was the demo)
		// neither a roster reload nor ensureActiveCharacter brings the demo back
		await loadRoster();
		expect(characters.roster.map((e) => e.id)).not.toContain(DEMO_ID);
		const active = await ensureActiveCharacter();
		expect(active).toBeNull();
		expect(characters.roster.map((e) => e.id)).not.toContain(DEMO_ID);
	});

	it('with the demo gone, ensureActiveCharacter opens the first OWN character', async () => {
		// beforeEach leaves an empty roster with the marker set (no demo)
		await saveCharacterToStore(newCharacter('mira', 'Mira', '5.5e'));
		characters.active = null;
		const active = await ensureActiveCharacter();
		expect(active?.id).toBe('mira'); // the user's own character, NOT a resurrected demo
	});

	it('Restore demo re-seeds it and makes it active', async () => {
		// beforeEach already left active null; recreate must set it to the demo
		const demo = await recreateDemoCharacter();
		expect(demo.id).toBe(DEMO_ID);
		expect(characters.roster.map((e) => e.id)).toContain(DEMO_ID);
		expect(characters.active?.id).toBe(DEMO_ID);
	});
});

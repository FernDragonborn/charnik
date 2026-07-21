/*
 * Reactive character store. The Roster and Combat read `characters.roster` / `characters.active`
 * and key recompute on `characters.guid` (a rotating GUID per change — not a counter; see
 * charnik-guid-not-counter). Persistence goes through the repository over the runtime writable
 * Storage (`getUserStorage()`), so the same code works on web (IndexedDB) and Tauri (fs).
 */
import { getUserStorage } from '$lib/storage/provider';
import {
	saveCharacter,
	loadCharacter,
	listCharacters,
	deleteCharacter,
	type RosterEntry
} from './repository';
import type { Character } from './schema';
import { demoCharacter } from '$lib/demo/sheet';

export const characters = $state<{
	roster: RosterEntry[];
	active: Character | null;
	guid: string;
}>({ roster: [], active: null, guid: '' });

let seeded = false;

/** Rotate the recompute key so every view keyed on `characters.guid` re-renders after a change (a
 *  fresh GUID, not an incrementing counter — see charnik-guid-not-counter). */
const bumpGuid = () => (characters.guid = crypto.randomUUID());

/** Load the roster; on first ever run seed the demo character so there's something to play. */
export async function loadRoster(): Promise<void> {
	const s = getUserStorage();
	let roster = await listCharacters(s);
	if (roster.length === 0 && !seeded) {
		seeded = true;
		await saveCharacter(s, demoCharacter());
		roster = await listCharacters(s);
	}
	characters.roster = roster;
	bumpGuid();
}

/** Load a saved character by slug WITHOUT making it active (for the builder's edit/level-up).
 *  Returns null if the save is bad or missing. */
export async function loadCharacterBySlug(slug: string): Promise<Character | null> {
	const res = await loadCharacter(getUserStorage(), slug);
	return res.ok && res.character ? res.character : null;
}

/** The character every view edits: the one opened from the Roster, or the DEMO by default. The demo
 *  is just a normal seeded character — not a separate code path — LOADED from storage, so its edits
 *  (hidden spells, prepared, layout) persist across reloads and sync between pages exactly like any
 *  character. Seeds it on first run if the save is missing. */
export async function ensureActiveCharacter(): Promise<Character> {
	if (!characters.active) {
		const s = getUserStorage();
		const demo = demoCharacter();
		let res = await loadCharacter(s, demo.id);
		if (!res.ok || !res.character) {
			await saveCharacter(s, demo);
			res = await loadCharacter(s, demo.id);
		}
		characters.active = res.character ?? demo;
		bumpGuid();
	}
	return characters.active;
}

/** DEV: reset the demo to a fresh build — overwrites the persisted demo save, makes it active, and
 *  refreshes the roster. Lets a developer wipe accumulated demo edits (hidden spells, HP, layout…). */
export async function recreateDemoCharacter(): Promise<Character> {
	const demo = demoCharacter();
	await saveCharacter(getUserStorage(), demo);
	characters.active = demo;
	await loadRoster();
	bumpGuid();
	return demo;
}

/** Open a saved character as the active one (returns null if the save is bad/missing). */
export async function openCharacter(slug: string): Promise<Character | null> {
	characters.active = await loadCharacterBySlug(slug);
	bumpGuid();
	return characters.active;
}

/** Persist a character (create or update) and refresh the roster. */
export async function saveCharacterToStore(character: Character): Promise<void> {
	await saveCharacter(getUserStorage(), character);
	if (characters.active?.id === character.id) characters.active = character;
	await loadRoster();
}

/** Delete a character and refresh the roster. */
export async function removeCharacter(slug: string): Promise<void> {
	await deleteCharacter(getUserStorage(), slug);
	if (characters.active?.id === slug) characters.active = null;
	await loadRoster();
}

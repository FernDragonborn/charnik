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
	characters.guid = crypto.randomUUID();
}

/** Open a saved character as the active one (returns null if the save is bad/missing). */
export async function openCharacter(slug: string): Promise<Character | null> {
	const res = await loadCharacter(getUserStorage(), slug);
	characters.active = res.ok && res.character ? res.character : null;
	characters.guid = crypto.randomUUID();
	return characters.active;
}

/** Load a saved character by slug WITHOUT making it active (for the builder's edit/level-up). */
export async function loadCharacterBySlug(slug: string): Promise<Character | null> {
	const res = await loadCharacter(getUserStorage(), slug);
	return res.ok && res.character ? res.character : null;
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

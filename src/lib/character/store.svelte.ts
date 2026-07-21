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

/** The character every view should edit: the one opened from the Roster, or a SHARED demo when none
 *  is open. Lazily sets `characters.active` to a single demo so Combat and the Spellbook edit the
 *  SAME object (otherwise each page spins its own demo and per-character edits — hidden spells,
 *  prepared, layout — don't sync between them). */
export function activeOrDemo(): Character {
	if (!characters.active) {
		characters.active = demoCharacter();
		bumpGuid();
	}
	return characters.active;
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

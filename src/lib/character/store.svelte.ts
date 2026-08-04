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
import type { Storage } from '$lib/storage/types';
import { demoCharacter, DEMO_ID } from '$lib/demo/sheet';

export const characters = $state<{
	roster: RosterEntry[];
	active: Character | null;
	guid: string;
}>({ roster: [], active: null, guid: '' });

/** Persistent marker (a top-level file in dataDir) recording that the demo has ALREADY been seeded
 *  once. It survives reloads on every target — web IndexedDB and desktop fs alike, since it goes
 *  through the one Storage seam. Once set, the demo is never auto-reseeded, so DELETING it sticks;
 *  the only way back is the explicit "Restore demo" action. */
const DEMO_SEEDED_MARKER = 'demo-seeded.json';

/** Record that the demo has been seeded (write the persistent marker). */
const markDemoSeeded = (s: Storage): Promise<void> =>
	s.write(DEMO_SEEDED_MARKER, JSON.stringify({ seededAt: new Date().toISOString() }));

/** Seed the demo character ONCE, on the genuine first run only (marker absent). Idempotent: after the
 *  marker is set — including after the user deletes the demo — this is a no-op, so the demo never
 *  auto-resurrects behind the user's back. */
async function seedDemoIfFirstRun(s: Storage): Promise<void> {
	if (await s.exists(DEMO_SEEDED_MARKER)) return;
	await saveCharacter(s, demoCharacter());
	await markDemoSeeded(s);
}

/** Rotate the recompute key so every view keyed on `characters.guid` re-renders after a change (a
 *  fresh GUID, not an incrementing counter — see charnik-guid-not-counter). */
const bumpGuid = () => (characters.guid = crypto.randomUUID());

/** Load the roster; seeds the demo character on the FIRST ever run so there's something to play. */
export async function loadRoster(): Promise<void> {
	const s = getUserStorage();
	await seedDemoIfFirstRun(s);
	characters.roster = await listCharacters(s);
	bumpGuid();
}

/** Load a saved character by slug WITHOUT making it active (for the builder's edit/level-up).
 *  Returns null if the save is bad or missing. */
export async function loadCharacterBySlug(slug: string): Promise<Character | null> {
	const res = await loadCharacter(getUserStorage(), slug);
	return res.ok && res.character ? res.character : null;
}

/** The character every view (Combat / Spellbook) edits: the one opened from the Roster, or a sensible
 *  default. On first run that's the freshly-seeded demo; after the user deletes the demo it's the first
 *  of their OWN saved characters; with an empty roster it's `null` (the caller shows a "no character"
 *  empty state). The demo is NEVER auto-recreated here — deleting it sticks (only "Restore demo" brings
 *  it back). Loaded from storage, so edits persist and sync between pages like any character. */
export async function ensureActiveCharacter(): Promise<Character | null> {
	if (characters.active) return characters.active;
	const s = getUserStorage();
	await seedDemoIfFirstRun(s);
	// prefer the demo (present on first run / after a Restore); else the first non-broken saved
	// character (a user who deleted the demo but kept their own still lands on one); else nothing.
	const demo = await loadCharacter(s, DEMO_ID);
	if (demo.ok && demo.character) {
		characters.active = demo.character;
	} else {
		const first = (await listCharacters(s)).find((e) => !e.error);
		characters.active = first ? await loadCharacterBySlug(first.id) : null;
	}
	bumpGuid();
	return characters.active;
}

/** Reset the demo to a fresh build — overwrites the persisted demo save, makes it active, refreshes
 *  the roster (also (re)sets the seeded marker so the auto-seed logic stays consistent). Exposed in
 *  Settings ▸ Data as "Restore demo" and on `/dev`; wipes accumulated demo edits (HP, spells, layout). */
export async function recreateDemoCharacter(): Promise<Character> {
	const s = getUserStorage();
	const demo = demoCharacter();
	await saveCharacter(s, demo);
	await markDemoSeeded(s);
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

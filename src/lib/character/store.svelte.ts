/*
 * Reactive character store. The Roster and Combat read `characters.roster` / `characters.active`
 * and key recompute on `characters.guid` (a rotating GUID per change — not a counter; see
 * charnik-guid-not-counter). Persistence goes through the repository over the runtime writable
 * Storage (`getUserStorage()`), so the same code works on web (IndexedDB) and Tauri (fs).
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { detectPlatform, Platform, getUserStorage } from '$lib/storage/provider';
import {
	saveCharacter,
	loadCharacter,
	adoptCharacter,
	listCharacters,
	deleteCharacter,
	rosterEntryOf,
	uniqueCharacterId,
	copyCharacterPhoto,
	characterChangedOutside,
	characterSlugOfPath,
	CharacterConflictError,
	SAVE_MODE,
	type SaveMode,
	type RosterEntry,
	restoreCharacterBackup,
	type LoadResult,
} from './repository';
import type { Character } from './schema';
import type { Storage } from '$lib/storage/types';
import { demoCharacter, DEMO_ID } from '$lib/demo/sheet';
import { slugify } from '$lib/util/slug';
import { errText } from '$lib/util/format';
import { logger } from '$lib/diag/logger';

/** A save the repository refused because `character.json` is not the file this app last held: the
 *  state the player has, and what the file says now. Open until the player picks which one wins. */
export interface CharacterConflict {
	mine: Character;
	file: LoadResult;
}

export const characters = $state<{
	roster: RosterEntry[];
	active: Character | null;
	guid: string;
	conflict: CharacterConflict | null;
}>({ roster: [], active: null, guid: '', conflict: null });

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

/** Load the copy the play loop edits and writes back, so the file it came from is the one a later
 *  save is checked against. */
async function adoptBySlug(slug: string): Promise<Character | null> {
	const res = await adoptCharacter(getUserStorage(), slug);
	return res.ok && res.character ? res.character : null;
}

/**
 * Make the open character BE `next`, in the object every view already holds. Views take the active
 * character once, on mount, so replacing the object would leave each of them editing — and saving —
 * the one that was just superseded.
 */
function putIntoActive(next: Character): void {
	if (characters.active) Object.assign(characters.active, next);
	else characters.active = next;
	bumpGuid();
}

/** Put one character's line into the roster, where a save used to re-read every character to
 *  learn what it had just written. */
function upsertRosterEntry(character: Character): void {
	const entry = rosterEntryOf(character);
	characters.roster = [...characters.roster.filter((e) => e.id !== entry.id), entry].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	bumpGuid();
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
	const demo = await adoptBySlug(DEMO_ID);
	if (demo) {
		characters.active = demo;
	} else {
		const first = (await listCharacters(s)).find((e) => !e.error);
		characters.active = first ? await adoptBySlug(first.id) : null;
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
	await saveCharacter(s, demo, SAVE_MODE.overwrite);
	await markDemoSeeded(s);
	if (characters.active?.id === DEMO_ID) putIntoActive(demo);
	else characters.active = demo;
	await loadRoster();
	return characters.active ?? demo;
}

/** Open a saved character as the active one (returns null if the save is bad/missing). */
export async function openCharacter(slug: string): Promise<Character | null> {
	characters.active = await adoptBySlug(slug);
	bumpGuid();
	return characters.active;
}

/** Persist a character (create or update) and put its line in the roster. THROWS on a failure — the
 *  callers that can act on one (the reload flusher, the level-up handoff) want it; everything on the
 *  play loop goes through `saveCharacterGuarded` instead. A save refused because the file changed
 *  outside the app opens the conflict question before it throws. */
export async function saveCharacterToStore(
	character: Character,
	mode: SaveMode = SAVE_MODE.checked,
): Promise<void> {
	try {
		await saveCharacter(getUserStorage(), character, mode);
	} catch (e) {
		// the builder's refused write is the MERGED character, which no caller holds; the play loop's
		// is the live copy, which may move on before the player answers
		if (e instanceof CharacterConflictError)
			await raiseConflict(mode === SAVE_MODE.build ? e.character : character);
		throw e;
	}
	// the builder's copy carries the play it opened with, so it is never the one left open
	if (mode !== SAVE_MODE.build && characters.active?.id === character.id)
		characters.active = character;
	upsertRosterEntry(character);
}

/** The builder's save: its `build` over the file as it is at this moment, so what the table did
 *  while the builder was open is not written back as it was when the builder opened. Answers
 *  `false` for a save that was refused and is being asked about — the builder stays open for the
 *  answer — and throws for one that failed. */
export async function saveBuildToStore(character: Character): Promise<boolean> {
	try {
		await saveCharacterToStore(character, SAVE_MODE.build);
		return true;
	} catch (e) {
		if (e instanceof CharacterConflictError) return false;
		throw e;
	}
}

async function raiseConflict(mine: Character): Promise<void> {
	characters.conflict = { mine, file: await loadCharacter(getUserStorage(), mine.id) };
}

/** What the player may answer a conflict with. */
export const CONFLICT_CHOICE = { mine: 'mine', file: 'file', copy: 'copy' } as const;
export type ConflictChoice = (typeof CONFLICT_CHOICE)[keyof typeof CONFLICT_CHOICE];

/**
 * Settle an open conflict the way the player chose. `mine` writes their state over the file,
 * `file` takes the file's state onto the screen, and `copy` keeps both: their state becomes a new
 * character, which is the one left open, and the file is not touched.
 */
export async function resolveConflict(choice: ConflictChoice): Promise<void> {
	const conflict = characters.conflict;
	if (!conflict) return;
	const storage = getUserStorage();
	const mine = conflict.mine;
	const open = characters.active?.id === mine.id;
	if (choice === CONFLICT_CHOICE.mine) {
		await saveCharacter(storage, mine, SAVE_MODE.overwrite);
		if (open && characters.active !== mine) putIntoActive(mine);
		upsertRosterEntry(mine);
	} else if (choice === CONFLICT_CHOICE.file) {
		const theirs = await adoptBySlug(mine.id);
		if (open && theirs) putIntoActive(theirs);
		await loadRoster();
	} else {
		const copy: Character = {
			...$state.snapshot(mine),
			id: await uniqueCharacterId(storage, slugify(mine.build.name)),
			uid: crypto.randomUUID(), // a second character, not the first one twice
			rev: 0,
		};
		copy.build.name = t('character.conflict.copyName', { name: mine.build.name });
		if (copy.build.photo) await copyCharacterPhoto(storage, mine.id, copy.id, copy.build.photo);
		await saveCharacter(storage, copy);
		await adoptBySlug(mine.id); // the file stays as it is, and is the one the app now holds
		if (open) putIntoActive(copy);
		await loadRoster();
	}
	characters.conflict = null;
}

let stopWatching: (() => void) | null = null;

/** Watch `characters/` the way `content/` is watched (desktop only — the web store has no folder
 *  anyone else writes to), and ask the conflict question the moment the open character's file stops
 *  being the one this app holds, instead of at the next save. */
export function startCharacterWatcher(): void {
	if (stopWatching || detectPlatform() !== Platform.Desktop) return;
	const storage = getUserStorage();
	stopWatching = storage.watch('characters', (path) => {
		const active = characters.active;
		if (!active || characters.conflict || characterSlugOfPath(path) !== active.id) return;
		characterChangedOutside(storage, active.id)
			.then(async (changed) => {
				if (changed && characters.active === active && !characters.conflict)
					await raiseConflict(active);
			})
			// a file caught mid-write by its other writer: the next event, or the next save, asks again
			.catch((e: unknown) => logger.warn('character: watch check failed', { error: errText(e) }));
	});
}

export function stopCharacterWatcher(): void {
	stopWatching?.();
	stopWatching = null;
}

/** One id for the failure, so a disk that stays full replaces its notice instead of stacking one per
 *  HP tick. Same pattern as the draft autosave's. */
const SAVE_FAILED_TOAST = 'character-save-failed';

/**
 * Persist a character and SAY SO when it does not happen. Every play-loop write — the combat
 * autosave, a rest, a spell prepared, a pin — used to be `void saveCharacterToStore(c)`, so a locked
 * `character.json` or a character the schema refuses (an exhaustion ladder past 20) stopped persisting
 * for the whole session in silence, and the next load returned the sheet as it was before the failure.
 *
 * Returns whether it landed, for the few callers that care; the rest fire and forget, which is now
 * safe because the failure has a channel of its own.
 */
export async function saveCharacterGuarded(character: Character): Promise<boolean> {
	try {
		await saveCharacterToStore(character);
		return true;
	} catch (e) {
		// a refused save has its own channel — the question on screen — and is not a broken disk
		if (e instanceof CharacterConflictError) return false;
		toast(t('character.notSaved'), {
			id: SAVE_FAILED_TOAST,
			description: t('character.notSavedBody'),
		});
		return false;
	}
}

/**
 * Put one of a character's snapshots back as its live save, and make what is on screen agree.
 *
 * Reloads the roster (the name and level may have moved) and puts the snapshot into the open
 * character when it is the active one — leaving the in-memory sheet from before the restore would
 * show one state while the disk holds another.
 */
export async function restoreBackup(slug: string, path: string): Promise<LoadResult> {
	const res = await restoreCharacterBackup(getUserStorage(), slug, path);
	if (!res.ok) return res;
	// into the object the views hold: a copy left behind would write the pre-restore state back
	if (characters.active?.id === slug && res.character) putIntoActive(res.character);
	await loadRoster();
	return res;
}

/** Delete a character and refresh the roster. */
export async function removeCharacter(slug: string): Promise<void> {
	await deleteCharacter(getUserStorage(), slug);
	if (characters.active?.id === slug) characters.active = null;
	await loadRoster();
}

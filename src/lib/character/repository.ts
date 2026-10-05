/*
 * Character persistence over the `Storage` interface (so it works on Tauri fs, node-fs,
 * in-memory, or browser storage — desktop and web alike).
 *
 * Layout: `characters/<slug>/character.json` (+ optional `photo.*` sibling by name, and an
 * append-only `log.jsonl` kept OUT of character.json so it can't bloat it). Writes are
 * atomic in the real impls (temp→rename). On load, saves are migrated forward via the
 * schemaVersion registry, then validated; a corrupt/invalid save is reported, never thrown
 * past the caller (roster keeps listing the others).
 */
import type { Storage, FileEntry } from '../storage/types';
import { migrate, CHARACTER_SCHEMA_VERSION, type Versioned } from '../schema/version';
import { CHARACTER_MIGRATIONS } from './migrations';
import { characterSchema, parseCharacter, type Character } from './schema';
import type { PickedPhoto } from './photo';
import { SYSTEMS } from '../rules/pipeline';
import { errText } from '../util/format';
import { logger, redactPath } from '../diag/logger';

const CHARACTERS_DIR = 'characters';
/** A character's own folder, relative to the data folder. */
export const dirOf = (slug: string) => `${CHARACTERS_DIR}/${slug}`;
const fileOf = (slug: string) => `${dirOf(slug)}/character.json`;

export interface LoadResult {
	ok: boolean;
	character?: Character;
	/** Present when the save couldn't be loaded (missing / bad JSON / invalid / too new). */
	error?: string;
	/** Best-effort system read from the raw JSON even when the full parse failed, so the roster can
	 *  badge a broken save with its REAL edition instead of a hardcoded guess (D4). */
	system?: Character['system'];
}

export interface RosterEntry {
	id: string;
	name: string;
	/** Optional: a broken save whose edition couldn't even be read has none (D4) — the UI hides the
	 *  badge rather than showing a wrong default. */
	system?: Character['system'];
	level: number;
	/** e.g. "Wizard 3 / Fighter 1" — best-effort from class refs (id segment). */
	classes: string;
	error?: string;
}

// --- rotating backups (B3) -----------------------------------------------------
// No DB → recover a clobbered/corrupted save from a sibling snapshot. Two rings, keyed by the
// snapshot's epoch-ms IN THE FILENAME (so throttle/prune need no mtime, and it's testable on the
// in-memory Storage). `save` = a checkpoint of the PREVIOUS saved state, throttled so a busy session
// doesn't churn near-identical copies; `launch` = one snapshot per app session. Together the recovery
// set is: current → −10 min → −20 min → this launch → last launch → 2 launches ago.
const BACKUP_KEEP = { save: 2, launch: 3 } as const;
const SAVE_BACKUP_THROTTLE_MS = 10 * 60 * 1000;
type BackupTier = keyof typeof BACKUP_KEEP;
const backupName = (tier: BackupTier, ts: number) => `character.bak.${tier}.${ts}.json`;

/** Existing backups for one tier, newest-first, timestamp parsed from the filename. */
async function listBackups(
	storage: Storage,
	id: string,
	tier: BackupTier,
): Promise<{ ts: number; path: string }[]> {
	let entries: FileEntry[];
	try {
		entries = await storage.list(dirOf(id));
	} catch {
		return [];
	}
	const prefix = `character.bak.${tier}.`;
	return entries
		.filter((e) => !e.isDir && e.name.startsWith(prefix) && e.name.endsWith('.json'))
		.map((e) => ({
			ts: Number(e.name.slice(prefix.length, -'.json'.length)) || 0,
			path: `${dirOf(id)}/${e.name}`,
		}))
		.sort((a, b) => b.ts - a.ts);
}

/** Snapshot the CURRENT `character.json` into the rotating ring for `tier`, then prune to the newest
 *  N. The `save` tier skips if the last checkpoint is <10 min old (throttle). Best-effort — a backup
 *  failure must never break the save itself. */
export async function backupCharacter(
	storage: Storage,
	id: string,
	tier: BackupTier,
	now = Date.now(),
): Promise<void> {
	let current: string;
	try {
		current = await storage.read(fileOf(id));
	} catch {
		return; // nothing saved yet → nothing to back up
	}
	const existing = await listBackups(storage, id, tier);
	if (tier === 'save' && existing[0] && now - existing[0].ts < SAVE_BACKUP_THROTTLE_MS) return;
	const path = `${dirOf(id)}/${backupName(tier, now)}`;
	await storage.write(path, current);
	// prune: keep the newest N (the just-written one is newest)
	for (const b of [{ ts: now, path }, ...existing].slice(BACKUP_KEEP[tier])) {
		try {
			await storage.remove(b.path);
		} catch {
			/* best-effort */
		}
	}
}

/** One snapshot the rings hold, as the restore UI needs it. */
export interface CharacterBackup {
	tier: BackupTier;
	/** When it was taken — epoch ms, read from the filename. */
	ts: number;
	/** dataDir-relative path, and the handle `restoreCharacterBackup` is given. */
	path: string;
}

/**
 * Every snapshot of one character, both rings merged, newest first — the READER the two writers
 * never had. Without it the whole recovery set was write-only: five files per character that only
 * a desktop user who knew the layout could reach by renaming one by hand, and that nobody on the
 * web could reach at all (`AGENTS.md` ▸ Reverse states).
 */
export async function listCharacterBackups(
	storage: Storage,
	id: string,
): Promise<CharacterBackup[]> {
	const tiers = await Promise.all(
		(Object.keys(BACKUP_KEEP) as BackupTier[]).map(async (tier) =>
			(await listBackups(storage, id, tier)).map((b) => ({ tier, ...b })),
		),
	);
	return tiers.flat().sort((a, b) => b.ts - a.ts);
}

/**
 * Put one snapshot back as the live save.
 *
 * The snapshot goes through the SAME parse → migrate → validate the live file gets, so a corrupt or
 * unmigratable one is refused with its reason rather than written over a working character — the
 * whole point of restoring is that the thing you have is already broken.
 *
 * The state being replaced is checkpointed on the way out only as far as the `save` ring's 10-minute
 * throttle allows, so it is NOT a guaranteed undo — what makes a wrong restore recoverable is that
 * the other snapshots are untouched, which is what the confirm promises.
 */
export async function restoreCharacterBackup(
	storage: Storage,
	id: string,
	path: string,
): Promise<LoadResult> {
	let raw: string;
	try {
		raw = await storage.read(path);
	} catch (e) {
		return { ok: false, error: `cannot read snapshot: ${errText(e)}` };
	}
	const res = readSavedCharacter(raw);
	if (!res.ok || !res.character) {
		logger.error('character: snapshot refused on restore', { error: res.error });
		return res;
	}
	logger.info('character: restoring snapshot', { snapshot: redactPath(path) });
	// through `saveCharacter`, so the restore is checkpointed into the ring like any other write and
	// the id is re-anchored to the folder it is landing in (a hand-copied snapshot may carry another)
	// — and as an `overwrite`, because a snapshot is by definition not the file's current revision
	// — and it stays the character it is being put back as: a snapshot from before characters had a
	// `uid` was just given a new one by its migration, and a hand-copied one may carry another's
	const live = await loadCharacter(storage, id);
	const restored = { ...res.character, id, uid: live.character?.uid ?? res.character.uid };
	await saveCharacter(storage, restored, SAVE_MODE.overwrite);
	return { ok: true, character: restored };
}

/** Character ids already launch-snapshotted this session — one snapshot per app run, not per open. */
const launchSnapshotted = new Set<string>();

/** Take the once-per-session launch snapshot of a character (B3). No-op after the first call per id. */
export async function snapshotCharacterOnLaunch(storage: Storage, id: string): Promise<void> {
	if (launchSnapshotted.has(id)) return;
	launchSnapshotted.add(id);
	try {
		await backupCharacter(storage, id, 'launch');
	} catch (e) {
		logger.warn('character: launch snapshot failed', { error: errText(e) });
	}
}

/**
 * One queue per character: every task that reads-then-writes a file in a character's folder runs
 * after the one before it. `character.json` and `log.jsonl` are both rewritten whole, from callers
 * that fire and forget, so two overlapping tasks would each read the same "before" and the later
 * write would erase the earlier one. A task must not enqueue onto its own slug — it would wait for
 * itself.
 */
const characterQueues = new Map<string, Promise<unknown>>();
export function enqueue<T>(slug: string, task: () => Promise<T>): Promise<T> {
	const prior = characterQueues.get(slug) ?? Promise.resolve();
	const next = prior.catch(() => {}).then(task);
	characterQueues.set(slug, next);
	// drop the queue once it drains so the map doesn't retain a slug forever; the caller holds `next`
	// and owns its rejection, this branch only tidies
	void next
		.finally(() => {
			if (characterQueues.get(slug) === next) characterQueues.delete(slug);
		})
		.catch(() => {});
	return next;
}

/**
 * The text of each `character.json` as this app last read it for editing or wrote it, per storage.
 * It is what "the file on disk is not the one the app last wrote" is asked of: a hand edit and a
 * sync tool's copy both keep or reuse a `rev`, and the bytes are the one thing neither can match by
 * accident. Compared rather than an mtime because `Storage` reports one only through a directory
 * listing, a sync tool rewrites it without changing a byte, and the web store has none to trust.
 */
const heldFiles = new WeakMap<Storage, Map<string, string>>();
function heldBy(storage: Storage): Map<string, string> {
	let held = heldFiles.get(storage);
	if (!held) heldFiles.set(storage, (held = new Map()));
	return held;
}

/** How a write treats the file already on disk. */
export const SAVE_MODE = {
	/** The play loop: refused when the file moved on from the copy being saved. */
	checked: 'checked',
	/** The builder: only what the builder owns is written, over the file as it is right now. */
	build: 'build',
	/** A state the player chose over the file's — a restore, the demo, "keep mine". Never refused. */
	overwrite: 'overwrite',
} as const;
export type SaveMode = (typeof SAVE_MODE)[keyof typeof SAVE_MODE];

/** A save that was REFUSED because the file is not the one this copy came from. Carries what would
 *  have been written, so whoever asks the player has it to offer. */
export class CharacterConflictError extends Error {
	constructor(readonly character: Character) {
		super(`character "${character.id}" changed on disk since it was read`);
		this.name = 'CharacterConflictError';
	}
}

/** The `rev` a stored file states, or `undefined` when it cannot be read as one — which is itself a
 *  file this app did not write. */
function revOf(raw: string): number | undefined {
	try {
		const rev = (JSON.parse(raw) as { rev?: unknown } | null)?.rev ?? 0;
		return typeof rev === 'number' ? rev : undefined;
	} catch {
		return undefined;
	}
}

/** What the builder owns of a character: the build, and the two authoring choices it folds into
 *  `ui`. Everything else is the file's, because the table kept playing while the builder was open. */
function mergeBuildOver(onDisk: Character, built: Character): Character {
	return {
		...onDisk,
		build: built.build,
		ui: { ...onDisk.ui, strict: built.ui.strict, shortRestMode: built.ui.shortRestMode },
	};
}

/**
 * Write a character (validates first; refuses to persist an invalid one), in its turn on the
 * character's queue. Checkpoints the PREVIOUS saved state into the rotating `save` backup ring first
 * (throttled — B3).
 *
 * Every write carries the next `rev`, and the copy handed in is told which one it now is. A
 * `checked` write is refused with `CharacterConflictError` when the file states another `rev` than
 * the copy does, and every write but `overwrite` is refused when the file's bytes are not the ones
 * this app last held — nothing is written, and the caller asks the player which state wins.
 */
export function saveCharacter(
	storage: Storage,
	character: Character,
	mode: SaveMode = SAVE_MODE.checked,
): Promise<void> {
	return enqueue(character.id, async () => {
		// validated INSIDE the task, so a save that waited its turn writes the state as it is now
		const res = characterSchema.safeParse(character);
		if (!res.success) {
			const issues = res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
			// the one way a save can be refused rather than fail — worth a line of its own, because the
			// user sees a toast and the reason is a schema path they have no way to report back
			logger.error('character: refusing to save invalid', { issues });
			throw new Error(`refusing to save invalid character: ${issues}`);
		}
		const id = res.data.id;
		const held = heldBy(storage);
		const current = (await storage.exists(fileOf(id))) ? await storage.read(fileOf(id)) : null;
		let next = res.data;
		let rev = next.rev;
		if (current !== null) {
			const onDisk = revOf(current);
			if (mode === SAVE_MODE.build) {
				const stored = readSavedCharacter(current).character;
				if (stored) next = mergeBuildOver(stored, next);
			}
			const heldText = held.get(id);
			const editedOutside = heldText !== undefined && heldText !== current;
			const staleCopy = mode === SAVE_MODE.checked && onDisk !== next.rev;
			if (mode !== SAVE_MODE.overwrite && (editedOutside || staleCopy)) {
				logger.warn('character: save refused, the file changed', { editedOutside, staleCopy });
				throw new CharacterConflictError(next);
			}
			rev = Math.max(onDisk ?? 0, next.rev);
			// snapshot the state we're about to overwrite (throttled), so a bad save is recoverable
			try {
				await backupCharacter(storage, id, 'save');
			} catch (e) {
				// best-effort — never block a save on a backup failure, but a recovery set that has
				// silently stopped being written is exactly what nobody finds out until they need it
				logger.warn('character: save backup failed', { error: errText(e) });
			}
		}
		const text = JSON.stringify({ ...next, rev: rev + 1 }, null, 2);
		await storage.mkdir(dirOf(id));
		await storage.write(fileOf(id), text);
		held.set(id, text);
		character.rev = rev + 1;
	});
}

/**
 * Load a character as the copy the app will EDIT: the same parse → migrate → validate, and the
 * file's text is remembered as the state this app holds, so a later save can tell a file somebody
 * else changed from the one it read. The roster and the builder read without adopting — neither
 * holds the copy the play loop writes back.
 */
export function adoptCharacter(storage: Storage, slug: string): Promise<LoadResult> {
	return enqueue(slug, async () => {
		let raw: string;
		try {
			raw = await storage.read(fileOf(slug));
		} catch {
			heldBy(storage).delete(slug);
			return { ok: false, error: `not found: ${slug}` };
		}
		heldBy(storage).set(slug, raw);
		return readSavedCharacter(raw);
	});
}

/** Has `character.json` stopped being the text this app holds? Asked when the folder watcher
 *  reports a change, in the character's queue so the app's own write has finished being recorded.
 *  A file that is gone, or one never adopted, is not a change to ask the player about. */
export function characterChangedOutside(storage: Storage, slug: string): Promise<boolean> {
	return enqueue(slug, async () => {
		const heldText = heldBy(storage).get(slug);
		if (heldText === undefined || !(await storage.exists(fileOf(slug)))) return false;
		return (await storage.read(fileOf(slug))) !== heldText;
	});
}

/** The slug a path under the data folder names, when that path is a character's own save. */
export function characterSlugOfPath(path: string): string | null {
	const parts = path.split(/[/\\]/);
	return parts.length === 3 && parts[0] === CHARACTERS_DIR && parts[2] === 'character.json'
		? (parts[1] ?? null)
		: null;
}

/** The portrait's file name inside a character folder — one per character, so picking a new one
 *  REPLACES the old rather than leaving a folder of orphans the user has to recognise. */
const photoNameOf = (ext: string) => `photo.${ext}`;

/** Write a character's portrait and return the name to store in `build.photo`. Any portrait already
 *  in the folder is removed first, including one with a different extension — the name is the only
 *  reference, so a leftover file would be invisible and permanent. */
export async function writeCharacterPhoto(
	storage: Storage,
	id: string,
	photo: PickedPhoto,
): Promise<string> {
	await storage.mkdir(dirOf(id));
	await removeCharacterPhotos(storage, id);
	const name = photoNameOf(photo.ext);
	await storage.writeBytes(`${dirOf(id)}/${name}`, photo.bytes);
	return name;
}

/** Read a stored portrait's bytes. Throws like any other missing file — a character whose photo was
 *  deleted from the folder renders without one, which is the caller's decision to make. */
export function readCharacterPhoto(
	storage: Storage,
	id: string,
	name: string,
): Promise<Uint8Array> {
	return storage.readBytes(`${dirOf(id)}/${name}`);
}

/** Give a second character its own copy of a portrait, under the same name. A portrait that cannot
 *  be read is left behind: the copy renders without one, as the original would. */
export async function copyCharacterPhoto(
	storage: Storage,
	from: string,
	to: string,
	name: string,
): Promise<void> {
	let bytes: Uint8Array;
	try {
		bytes = await readCharacterPhoto(storage, from, name);
	} catch {
		return;
	}
	await storage.mkdir(dirOf(to));
	await storage.writeBytes(`${dirOf(to)}/${name}`, bytes);
}

/** Remove every portrait file in a character's folder (the way OUT of having one). Best-effort per
 *  file: a folder that cannot be listed simply has nothing to remove. */
export async function removeCharacterPhotos(storage: Storage, id: string): Promise<void> {
	let entries: FileEntry[];
	try {
		entries = await storage.list(dirOf(id));
	} catch {
		return;
	}
	for (const e of entries)
		if (!e.isDir && e.name.startsWith('photo.'))
			try {
				await storage.remove(e.path);
			} catch {
				/* best-effort — a portrait we cannot delete is not a reason to fail the save */
			}
}

/** A collision-free character id: the readable slug plus a short random suffix (`hero-a3f9`), retried
 *  against storage so two same-named characters never silently overwrite each other (D14). Existing
 *  saves are untouched — only a newly-created character gets a suffix. */
export async function uniqueCharacterId(storage: Storage, base: string): Promise<string> {
	const stem = base || 'hero';
	for (let attempt = 0; attempt < 50; attempt++) {
		const id = `${stem}-${crypto.randomUUID().replace(/-/g, '').slice(0, 4)}`;
		if (!(await storage.exists(dirOf(id)))) return id;
	}
	// 50 misses is astronomically unlikely; a full uuid then guarantees uniqueness.
	return `${stem}-${crypto.randomUUID()}`;
}

/** Load one character: parse → migrate → validate. Never throws for a bad save. */
export async function loadCharacter(storage: Storage, slug: string): Promise<LoadResult> {
	let raw: string;
	try {
		raw = await storage.read(fileOf(slug));
	} catch {
		return { ok: false, error: `not found: ${slug}` };
	}
	return readSavedCharacter(raw);
}

/** The same parse → migrate → validate over bytes already in hand, so a SNAPSHOT is put through
 *  exactly what the live save is put through before anything is written over. */
function readSavedCharacter(raw: string): LoadResult {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch (e) {
		return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
	}
	// best-effort real edition for a broken save's roster badge (D4) — before migrate/validate
	const rawSystem = (data as { system?: unknown } | null)?.system;
	const known = SYSTEMS.includes(rawSystem as Character['system']);
	const sys = known ? { system: rawSystem as Character['system'] } : {};
	try {
		data = migrate(data as Versioned, CHARACTER_MIGRATIONS, CHARACTER_SCHEMA_VERSION);
	} catch (e) {
		logger.error('character: migration failed', { error: errText(e) });
		return { ok: false, error: `migration failed: ${(e as Error).message}`, ...sys };
	}
	const res = parseCharacter(data);
	if (!res.success) {
		logger.error('character: save failed validation', {
			issues: res.error.issues.map((i) => i.path.join('.')).join(', '),
		});
		return {
			ok: false,
			error: res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
			...sys,
		};
	}
	return { ok: true, character: res.data };
}

/**
 * Every saved character as RAW json, keyed by slug. Deliberately unparsed: the one caller (the
 * content-pack update preview, REL-4 slice 3) asks "does any character mention this content id",
 * and a broken or older-schema save must still answer that question honestly — parsing it first
 * would drop exactly the saves most at risk. Path knowledge stays here, not at the call site.
 */
export async function readCharacterFiles(
	storage: Storage,
): Promise<{ slug: string; json: string }[]> {
	if (!(await storage.exists(CHARACTERS_DIR))) return [];
	const slugs = (await storage.list(CHARACTERS_DIR)).filter((e) => e.isDir).map((e) => e.name);
	const files = await Promise.all(
		slugs.map(async (slug) => ({
			slug,
			json: await storage.read(fileOf(slug)).catch(() => ''),
		})),
	);
	return files.filter((f) => f.json !== '');
}

/** The roster line a character reads as — what a save updates in place of re-reading every file. */
export function rosterEntryOf(c: Character): RosterEntry {
	return {
		id: c.id,
		name: c.build.name,
		system: c.system,
		level: c.build.classes.reduce((n, cl) => n + cl.level, 0),
		classes: c.build.classes.map((cl) => `${cl.class.split(':').pop()} ${cl.level}`).join(' / '),
	};
}

/** List the roster. Bad saves become entries with an `error` (they still show up). */
export async function listCharacters(storage: Storage): Promise<RosterEntry[]> {
	if (!(await storage.exists(CHARACTERS_DIR))) return [];
	// SMELL-5: load rosters in parallel — each is an independent read and the result is sorted by name
	// at the end, so load order is irrelevant.
	const slugs = (await storage.list(CHARACTERS_DIR)).filter((e) => e.isDir).map((e) => e.name);
	const out = await Promise.all(
		slugs.map(async (slug): Promise<RosterEntry> => {
			const res = await loadCharacter(storage, slug);
			if (res.ok && res.character) return rosterEntryOf(res.character);
			return {
				id: slug,
				name: slug,
				...(res.system ? { system: res.system } : {}), // real edition if readable, else no badge
				level: 0,
				classes: '',
				error: res.error ?? 'unknown error',
			};
		}),
	);
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Delete a character folder (character.json, log, photo). */
export async function deleteCharacter(storage: Storage, slug: string): Promise<void> {
	logger.info('character: deleting');
	heldBy(storage).delete(slug);
	await storage.remove(dirOf(slug));
}

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
import {
	migrate,
	CHARACTER_SCHEMA_VERSION,
	type Migration,
	type Versioned
} from '../schema/version';
import { characterSchema, parseCharacter, type Character } from './schema';
import { SYSTEMS } from '../rules/pipeline';

/** Snake-case the ID segment of a content ref `type:source:id` (only the id part — the `source`
 *  like "SRD 5.1" is display and left alone), or a bare skill id. Non-strings pass through. */
const snakeRef = (ref: unknown): unknown => {
	if (typeof ref !== 'string' || ref === '') return ref;
	const i = ref.lastIndexOf(':');
	return i === -1
		? ref.replace(/-/g, '_')
		: ref.slice(0, i + 1) + ref.slice(i + 1).replace(/-/g, '_');
};
const snakeRefs = (arr: unknown): unknown => (Array.isArray(arr) ? arr.map(snakeRef) : arr);

/**
 * E3 migration (v1→v2): content ids became snake_case, so a saved character's REFS are rewritten.
 * Build refs (species/classes/subclass/feats/inventory/spells/background) + skill/expertise arrays
 * + the concentration ref are snaked. Runtime `play.effects` tokens are left as-is (user-entered,
 * ambiguous with the `-` minus operator; the user re-adds them) — a pragmatic, safe scope.
 */
const migrateV1toV2: Migration<Versioned> = (data) => {
	const d = data as unknown as Record<string, unknown>;
	const build = (d.build ?? {}) as Record<string, unknown>;
	const play = (d.play ?? {}) as Record<string, unknown>;
	for (const key of ['species', 'speciesOption', 'background'] as const)
		if (typeof build[key] === 'string') build[key] = snakeRef(build[key]);
	for (const key of ['feats', 'skills', 'expertise'] as const) build[key] = snakeRefs(build[key]);
	// spells are `{spell: ref, …}` objects, not bare refs
	if (Array.isArray(build.spells))
		build.spells = build.spells.map((s) => {
			const ss = s as Record<string, unknown>;
			return { ...ss, spell: snakeRef(ss.spell) };
		});
	if (Array.isArray(build.classes))
		build.classes = build.classes.map((c) => {
			const cc = c as Record<string, unknown>;
			return { ...cc, class: snakeRef(cc.class), subclass: snakeRef(cc.subclass) };
		});
	if (Array.isArray(build.inventory))
		build.inventory = build.inventory.map((it) => {
			const ii = it as Record<string, unknown>;
			return { ...ii, item: snakeRef(ii.item) };
		});
	if (typeof play.concentration === 'string') play.concentration = snakeRef(play.concentration);
	if (Array.isArray(play.effects))
		play.effects = play.effects.map((e) => {
			const ee = e as Record<string, unknown>;
			return typeof ee.source === 'string' ? { ...ee, source: snakeRef(ee.source) } : ee;
		});
	return { ...d, build, play, schemaVersion: 2 } as unknown as Versioned;
};

/**
 * v2→v3: re-run the SAME ref-snaking. Why: the seeded DEMO character was written at v2 with
 * kebab refs (demo/sheet.ts predated the E3 id rename but was never migrated — it is built fresh,
 * so migrateV1toV2 never saw it). snakeRef is idempotent on already-snake ids, so re-running is
 * safe for every legitimate v2 save; only stale kebab refs change.
 */
const migrateV2toV3: Migration<Versioned> = (data) =>
	({
		...(migrateV1toV2(data) as unknown as Record<string, unknown>),
		schemaVersion: 3
	}) as unknown as Versioned;

/** Forward migrations keyed by the version they upgrade FROM. */
const CHARACTER_MIGRATIONS: Record<number, Migration<Versioned>> = {
	1: migrateV1toV2,
	2: migrateV2toV3
};

const CHARACTERS_DIR = 'characters';
const dirOf = (slug: string) => `${CHARACTERS_DIR}/${slug}`;
const fileOf = (slug: string) => `${dirOf(slug)}/character.json`;
const logOf = (slug: string) => `${dirOf(slug)}/log.jsonl`;

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
	tier: BackupTier
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
			path: `${dirOf(id)}/${e.name}`
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
	now = Date.now()
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

/** Character ids already launch-snapshotted this session — one snapshot per app run, not per open. */
const launchSnapshotted = new Set<string>();

/** Take the once-per-session launch snapshot of a character (B3). No-op after the first call per id. */
export async function snapshotCharacterOnLaunch(storage: Storage, id: string): Promise<void> {
	if (launchSnapshotted.has(id)) return;
	launchSnapshotted.add(id);
	try {
		await backupCharacter(storage, id, 'launch');
	} catch {
		/* best-effort */
	}
}

/** Write a character (validates first; refuses to persist an invalid one). Checkpoints the PREVIOUS
 *  saved state into the rotating `save` backup ring first (throttled — B3). */
export async function saveCharacter(storage: Storage, character: Character): Promise<void> {
	const res = characterSchema.safeParse(character);
	if (!res.success) {
		throw new Error(
			`refusing to save invalid character: ${res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`
		);
	}
	// snapshot the state we're about to overwrite (throttled), so a bad save is recoverable
	try {
		await backupCharacter(storage, character.id, 'save');
	} catch {
		/* best-effort — never block a save on a backup failure */
	}
	await storage.mkdir(dirOf(character.id));
	await storage.write(fileOf(character.id), JSON.stringify(res.data, null, 2));
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
		return { ok: false, error: `migration failed: ${(e as Error).message}`, ...sys };
	}
	const res = parseCharacter(data);
	if (!res.success) {
		return {
			ok: false,
			error: res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
			...sys
		};
	}
	return { ok: true, character: res.data };
}

/** List the roster. Bad saves become entries with an `error` (they still show up). */
export async function listCharacters(storage: Storage): Promise<RosterEntry[]> {
	if (!(await storage.exists(CHARACTERS_DIR))) return [];
	const out: RosterEntry[] = [];
	for (const entry of await storage.list(CHARACTERS_DIR)) {
		if (!entry.isDir) continue;
		const slug = entry.name;
		const res = await loadCharacter(storage, slug);
		if (res.ok && res.character) {
			const c = res.character;
			out.push({
				id: c.id,
				name: c.build.name,
				system: c.system,
				level: c.build.classes.reduce((n, cl) => n + cl.level, 0),
				classes: c.build.classes.map((cl) => `${cl.class.split(':').pop()} ${cl.level}`).join(' / ')
			});
		} else {
			out.push({
				id: slug,
				name: slug,
				...(res.system ? { system: res.system } : {}), // real edition if readable, else no badge
				level: 0,
				classes: '',
				error: res.error ?? 'unknown error'
			});
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Delete a character folder (character.json, log, photo). */
export async function deleteCharacter(storage: Storage, slug: string): Promise<void> {
	await storage.remove(dirOf(slug));
}

// --- roll log (append-only sibling; kept out of character.json) ---------------

export interface LogEntry {
	t: number; // epoch ms
	kind: string; // "attack" | "save" | "check" | "damage" | "custom" …
	label: string;
	result?: number;
	detail?: string;
}

/** Cap on retained roll-log lines on disk — the log is a rolling history, not an archive, so it
 *  can't grow without bound (B4). Older lines drop off the front when the file exceeds this. */
const LOG_MAX_LINES = 500;

/** Per-slug append chain (BUG-4): `appendLog` is read-modify-write and fire-and-forget from the
 *  combat view, so two fast rolls would both read the same `prev` and the second write would clobber
 *  the first. Chaining each slug's appends serializes the read→write so entries can't race. */
const appendChains = new Map<string, Promise<void>>();

/** Append one roll-log line (`log.jsonl`, one JSON object per line), rotating out the oldest lines
 *  past `LOG_MAX_LINES` so the file stays bounded. Serialized per slug so concurrent appends don't
 *  lose entries (BUG-4). */
export function appendLog(storage: Storage, slug: string, entry: LogEntry): Promise<void> {
	const prior = appendChains.get(slug) ?? Promise.resolve();
	const next = prior.catch(() => {}).then(() => writeLogLine(storage, slug, entry));
	appendChains.set(slug, next);
	// drop the chain once it drains so the map doesn't retain a slug forever
	void next.finally(() => {
		if (appendChains.get(slug) === next) appendChains.delete(slug);
	});
	return next;
}

async function writeLogLine(storage: Storage, slug: string, entry: LogEntry): Promise<void> {
	let prev = '';
	try {
		prev = await storage.read(logOf(slug));
	} catch {
		/* first entry */
	}
	const lines = prev ? prev.split('\n').filter((l) => l.trim()) : [];
	lines.push(JSON.stringify(entry));
	const kept = lines.length > LOG_MAX_LINES ? lines.slice(lines.length - LOG_MAX_LINES) : lines;
	await storage.write(logOf(slug), kept.join('\n') + '\n');
}

/** Read the whole roll log, newest first. Bad lines are skipped. */
export async function readLog(storage: Storage, slug: string): Promise<LogEntry[]> {
	let raw: string;
	try {
		raw = await storage.read(logOf(slug));
	} catch {
		return [];
	}
	const out: LogEntry[] = [];
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line) as LogEntry);
		} catch {
			/* skip corrupt line */
		}
	}
	return out.reverse();
}

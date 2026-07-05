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
import type { Storage } from '../storage/types';
import {
	migrate,
	CHARACTER_SCHEMA_VERSION,
	type Migration,
	type Versioned
} from '../schema/version';
import { characterSchema, parseCharacter, type Character } from './schema';

/** Forward migrations keyed by the version they upgrade FROM. Empty at v1. */
export const CHARACTER_MIGRATIONS: Record<number, Migration<Versioned>> = {};

const CHARACTERS_DIR = 'characters';
const dirOf = (slug: string) => `${CHARACTERS_DIR}/${slug}`;
const fileOf = (slug: string) => `${dirOf(slug)}/character.json`;
const logOf = (slug: string) => `${dirOf(slug)}/log.jsonl`;

export interface LoadResult {
	ok: boolean;
	character?: Character;
	/** Present when the save couldn't be loaded (missing / bad JSON / invalid / too new). */
	error?: string;
}

export interface RosterEntry {
	id: string;
	name: string;
	system: Character['system'];
	level: number;
	/** e.g. "Wizard 3 / Fighter 1" — best-effort from class refs (id segment). */
	classes: string;
	error?: string;
}

/** Write a character (validates first; refuses to persist an invalid one). */
export async function saveCharacter(storage: Storage, character: Character): Promise<void> {
	const res = characterSchema.safeParse(character);
	if (!res.success) {
		throw new Error(
			`refusing to save invalid character: ${res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`
		);
	}
	await storage.mkdir(dirOf(character.id));
	await storage.write(fileOf(character.id), JSON.stringify(res.data, null, 2));
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
	try {
		data = migrate(data as Versioned, CHARACTER_MIGRATIONS, CHARACTER_SCHEMA_VERSION);
	} catch (e) {
		return { ok: false, error: `migration failed: ${(e as Error).message}` };
	}
	const res = parseCharacter(data);
	if (!res.success) {
		return {
			ok: false,
			error: res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')
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
			out.push({ id: slug, name: slug, system: '5e', level: 0, classes: '', error: res.error });
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

/** Append one roll-log line (`log.jsonl`). One JSON object per line. */
export async function appendLog(storage: Storage, slug: string, entry: LogEntry): Promise<void> {
	const line = JSON.stringify(entry) + '\n';
	let prev = '';
	try {
		prev = await storage.read(logOf(slug));
	} catch {
		/* first entry */
	}
	await storage.write(logOf(slug), prev + line);
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

/*
 * Unfinished characters, on disk.
 *
 * A build in progress is not a Character — it has no class yet, no name, and would fail every
 * schema the roster relies on — so it lives in its own folder rather than as a half-valid save:
 * `character-drafts/<guid>.json`. One file per draft, keyed by a GUID because a draft has no name
 * to be keyed by and may never get one.
 *
 * The stored shape is the builder's own `DraftState` plus the class-picks cache, verbatim. That is
 * deliberate and it is why nothing here validates: a draft is the user's unfinished work, not data
 * anything computes from, so a shape this file cannot read is dropped from the list rather than
 * being repaired into something the user did not build. Only `assembleCharacter` — at Create — has
 * to produce something valid.
 */
import type { Storage } from '../storage/types';

const DRAFTS_DIR = 'character-drafts';
const fileOf = (guid: string) => `${DRAFTS_DIR}/${guid}.json`;

/** One saved draft. `draft` and `classPicks` are opaque here — the builder owns their shape. */
export interface DraftRecord<TDraft = unknown, TPicks = unknown> {
	guid: string;
	/** ISO. Sorts the roster's unfinished section, newest first. */
	savedAt: string;
	/** What the roster shows when there is no name yet. */
	summary: { name: string; classes: string; level: number; system: string };
	draft: TDraft;
	/** `[classRef, picks][]` — a Map does not survive JSON. */
	classPicks: [string, TPicks][];
}

export async function saveDraft(storage: Storage, record: DraftRecord): Promise<void> {
	if (!(await storage.exists(DRAFTS_DIR))) await storage.mkdir(DRAFTS_DIR);
	await storage.write(fileOf(record.guid), JSON.stringify(record, null, '\t'));
}

export async function loadDraft(storage: Storage, guid: string): Promise<DraftRecord | null> {
	return readRecord(storage, fileOf(guid));
}

export async function deleteDraft(storage: Storage, guid: string): Promise<void> {
	if (await storage.exists(fileOf(guid))) await storage.remove(fileOf(guid));
}

/** Newest first. A file that will not parse is skipped, never thrown past the caller — one bad
 *  draft must not take the roster down with it. */
export async function listDrafts(storage: Storage): Promise<DraftRecord[]> {
	if (!(await storage.exists(DRAFTS_DIR))) return [];
	const files = (await storage.list(DRAFTS_DIR)).filter(
		(e) => !e.isDir && e.name.endsWith('.json'),
	);
	const records = await Promise.all(files.map((f) => readRecord(storage, f.path)));
	return records
		.filter((r): r is DraftRecord => r !== null)
		.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function readRecord(storage: Storage, path: string): Promise<DraftRecord | null> {
	try {
		const parsed: unknown = JSON.parse(await storage.read(path));
		if (!parsed || typeof parsed !== 'object') return null;
		const record = parsed as Partial<DraftRecord>;
		return record.guid && record.savedAt && record.summary && record.draft
			? (record as DraftRecord)
			: null;
	} catch {
		return null; // unreadable or not JSON — it is scratch work, so dropping it is the right call
	}
}

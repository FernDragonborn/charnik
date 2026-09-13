/*
 * Draft cache — persists in-progress content edits (translate / add / editor) so a form that's closed
 * for any reason (nav away, reload, crash) restores its last state. Storage-agnostic (over the one
 * `Storage` seam), so desktop writes real files under `<dataDir>/drafts/` and web uses IndexedDB.
 *
 * Design (docs/work/authoring.md ▸ DRAFT-CACHE):
 *   - ONE self-contained JSON per draft, NO manifest/index — discover by scanning `drafts/` + reading
 *     each. A lost/corrupt file loses only that draft, never the set (same principle as the removed
 *     `_pack.json` and content's self-describing `#content-` headers).
 *   - Identity lives IN the file (`target`), so the filename is just a safe, deterministic name — this
 *     sidesteps the Windows filename hazard (a raw `effectiveId` = `type:source:id` has illegal `:`).
 *   - Versioning FOLLOWS the content schema (no separate draft schema). Drafts are ephemeral WIP, so a
 *     version mismatch = DISCARD, never migrate.
 */
import type { Storage } from '$lib/storage/types';
import type { ContentType } from '$lib/content/schemas';
import { CONTENT_SCHEMA_VERSION } from '$lib/schema/version';

const DRAFTS_DIR = 'drafts';

/** What a draft is editing. translate/editor point at an existing row; add is a brand-new entry (no id
 *  yet) identified by a stable per-session GUID (`crypto.randomUUID`). */
export type DraftTarget =
	| { kind: 'translate'; type: ContentType; source: string; id: string; locale: string }
	| { kind: 'editor'; type: ContentType; source: string; id: string }
	| { kind: 'add'; type: ContentType; addGuid: string };

/** A self-contained draft file: its own identity + the edited model + provenance. Generic over the
 *  edited-data shape `D` (WikiEditDraft for translate, a row for add/editor) so callers stay typed. */
export interface DraftEnvelope<D extends object = Record<string, unknown>> {
	/** Rides the content schema (there is no separate draft schema). */
	schemaVersion: number;
	target: DraftTarget;
	/** The row's `#content-hash` when the draft was taken — lets a restore flag "source changed". */
	sourceHash?: string;
	savedAt: string;
	/** The edited fields; shape is `kind`-dependent. */
	data: D;
}

/** A canonical, collision-free key string for a target — the basis of its filename. */
function keyString(target: DraftTarget): string {
	switch (target.kind) {
		case 'translate':
			return `translate:${target.type}:${target.source}:${target.id}:${target.locale}`;
		case 'editor':
			return `editor:${target.type}:${target.source}:${target.id}`;
		case 'add':
			return `add:${target.addGuid}`;
	}
}

/** The draft's file path. `encodeURIComponent` makes the key a valid, collision-free (reversible)
 *  filename on every OS — no `:` / space hazard, and deterministic so re-editing the same target
 *  overwrites its one file instead of piling duplicates. `*` is escaped by hand: it is one of the
 *  nine characters `encodeURIComponent` leaves alone, and the only one Windows refuses in a name —
 *  a pack whose `#content-source` carries it failed the write with ENOENT. */
function draftPath(target: DraftTarget): string {
	return `${DRAFTS_DIR}/${encodeURIComponent(keyString(target)).replace(/\*/g, '%2A')}.json`;
}

/** Write (or overwrite) the draft for `target`. Atomic via the Storage impl; parents auto-created. */
export async function writeDraft<D extends object>(
	storage: Storage,
	target: DraftTarget,
	data: D,
	sourceHash?: string,
): Promise<void> {
	const envelope: DraftEnvelope<D> = {
		schemaVersion: CONTENT_SCHEMA_VERSION,
		target,
		...(sourceHash !== undefined ? { sourceHash } : {}),
		savedAt: new Date().toISOString(),
		data,
	};
	await storage.write(draftPath(target), JSON.stringify(envelope, null, 2));
}

/** Read the draft for `target`, or null if none / unreadable / a different schema version (ephemeral
 *  WIP → a mismatch is not migrated).
 *
 *  It does NOT remove the stale file. `findStaleDrafts` exists to list exactly those before they go,
 *  and the read has three call sites the warning does not gate — so opening Translate deleted the
 *  unsaved work the discard dialog would otherwise have named. Removal belongs to `discardDrafts`,
 *  which has a user behind it. */
export async function readDraft<D extends object = Record<string, unknown>>(
	storage: Storage,
	target: DraftTarget,
): Promise<DraftEnvelope<D> | null> {
	const path = draftPath(target);
	if (!(await storage.exists(path))) return null;
	const envelope = await parseDraft<D>(storage, path);
	if (!envelope) return null;
	if (envelope.schemaVersion !== CONTENT_SCHEMA_VERSION) return null;
	return envelope;
}

/** Delete the draft for `target` (called on a successful save). No-op if it's already gone. */
export async function deleteDraft(storage: Storage, target: DraftTarget): Promise<void> {
	const path = draftPath(target);
	if (await storage.exists(path)) await storage.remove(path);
}

/** The content row a draft points at (`type:source:id`), or null for an `add` draft (no row yet).
 *  Basis of orphan detection: a translate/editor target whose effectiveId resolves to no row is an
 *  orphan. */
export function draftEffectiveId(target: DraftTarget): string | null {
	return target.kind === 'add' ? null : `${target.type}:${target.source}:${target.id}`;
}

/** Drafts whose target row matches `predicate`. An `add` draft has no target row yet, so it never
 *  matches — the two callers below both mean "a draft pointing at an existing entry". */
async function draftsWhoseRow(
	storage: Storage,
	predicate: (effectiveId: string) => boolean,
): Promise<DraftEnvelope[]> {
	return (await listDrafts(storage)).filter((d) => {
		const eid = draftEffectiveId(d.target);
		return eid !== null && predicate(eid);
	});
}

/** Drafts whose target row no longer exists (deleted / renamed / source disabled) — the orphan set the
 *  reassign dialog resolves. `rowExists` is the content graph's membership test (`(eid) => !!graph.get`).
 *  `add` drafts are never orphans (they have no row yet; they're reached via the drafts list). */
export function findOrphanDrafts(
	storage: Storage,
	rowExists: (effectiveId: string) => boolean,
): Promise<DraftEnvelope[]> {
	return draftsWhoseRow(storage, (eid) => !rowExists(eid));
}

/**
 * Drafts pointed at any of these rows — the same question `findOrphanDrafts` asks, aimed at rows
 * that are about to GO rather than rows already gone. The content-pack update preview needs it: an
 * unfinished translation of a spell an update deletes is orphaned exactly as a character's reference
 * to it is, and unlike a character it is unsaved work with nowhere else to be seen.
 *
 * A draft is matched by its TARGET, not by scanning its bytes the way a character save is. That is
 * not a shortcut — a draft's target is a structured field, and its data holds edited cells, which
 * reference other content by bare id and never by the composite `type:source:id` a save uses.
 */
export function draftsTargeting(storage: Storage, rowKeys: string[]): Promise<DraftEnvelope[]> {
	if (rowKeys.length === 0) return Promise.resolve([]);
	const doomed = new Set(rowKeys);
	return draftsWhoseRow(storage, (eid) => doomed.has(eid));
}

/** Outcome of a re-point: the move happened, or the destination already holds a draft (the caller must
 *  let the user choose which survives before retrying with `overwrite`), or the source was gone. */
export type RepointResult = 'moved' | 'conflict' | 'missing';

/** Re-target an (orphan) draft onto a different entry: copy its data under the new key, delete the old
 *  file. Refuses to clobber an existing draft at `to` unless `overwrite` — a conflict is a user choice
 *  (which of the two drafts to keep), never a silent overwrite. */
export async function repointDraft(
	storage: Storage,
	from: DraftTarget,
	to: DraftTarget,
	overwrite = false,
): Promise<RepointResult> {
	const env = await readDraft(storage, from);
	if (!env) return 'missing';
	if (!overwrite && (await readDraft(storage, to))) return 'conflict';
	await writeDraft(storage, to, env.data, env.sourceHash);
	await deleteDraft(storage, from);
	return 'moved';
}

/** Every draft file on disk, split into the ones that parse and the ones that do NOT. Unreadable
 *  files are not dropped on the floor: a draft is the user's unfinished work, and a file that can no
 *  longer be read is the same loss as a stale-schema one — it just has a different cause (NULL-1). */
async function scanDrafts(
	storage: Storage,
): Promise<{ drafts: DraftEnvelope[]; unreadable: string[] }> {
	if (!(await storage.exists(DRAFTS_DIR))) return { drafts: [], unreadable: [] };
	const drafts: DraftEnvelope[] = [];
	const unreadable: string[] = [];
	for (const entry of await storage.list(DRAFTS_DIR)) {
		if (entry.isDir || !entry.name.endsWith('.json')) continue;
		const envelope = await parseDraft(storage, entry.path);
		if (envelope) drafts.push(envelope);
		else unreadable.push(entry.path);
	}
	return { drafts, unreadable };
}

/** Every parseable draft on disk REGARDLESS of schema version. The version-filtered
 *  {@link listDrafts} and the stale-version scan both build on this. */
async function listAllDrafts(storage: Storage): Promise<DraftEnvelope[]> {
	return (await scanDrafts(storage)).drafts;
}

/** Draft files that no longer parse (a truncated write, a hand-edit that broke the JSON). Surfaced
 *  beside the stale ones so unfinished work never disappears without a word; the paths are all there
 *  is to show, since nothing inside them can be read. */
export async function findUnreadableDrafts(storage: Storage): Promise<string[]> {
	return (await scanDrafts(storage)).unreadable;
}

/** Delete draft files by PATH — the unreadable ones, which have no target to delete by. */
export async function deleteDraftFiles(storage: Storage, paths: string[]): Promise<void> {
	for (const path of paths) await storage.remove(path);
}

/** Every current-version draft on disk (for the pending-drafts / orphan surface). Corrupt or
 *  wrong-version files are skipped, never thrown on. */
export async function listDrafts(storage: Storage): Promise<DraftEnvelope[]> {
	return (await listAllDrafts(storage)).filter((e) => e.schemaVersion === CONTENT_SCHEMA_VERSION);
}

/** Drafts saved under a DIFFERENT content-schema version — ephemeral WIP that can't be migrated, so it
 *  will be discarded. Surfaced (before removal) so the user is WARNED their unsaved work is being
 *  dropped, rather than it vanishing silently on the next read (PLAN DRAFT-CACHE backlog). */
export async function findStaleDrafts(storage: Storage): Promise<DraftEnvelope[]> {
	return (await listAllDrafts(storage)).filter((e) => e.schemaVersion !== CONTENT_SCHEMA_VERSION);
}

/** Delete the given stale drafts (called after the user acknowledges the discard warning). */
export async function discardDrafts(storage: Storage, drafts: DraftEnvelope[]): Promise<void> {
	for (const d of drafts) await deleteDraft(storage, d.target);
}

const DRAFT_KINDS: ReadonlySet<string> = new Set(['translate', 'editor', 'add']);

/**
 * Is this parsed JSON actually a draft envelope? Anything else that lands in `drafts/` — a stray
 * `.json`, a hand-edit that broke the shape — parses fine and then has no `target`, which every
 * consumer dereferences: the discard dialog threw while RENDERING, and `discardDrafts` stopped at it
 * mid-loop with an unhandled rejection. Routing it to `findUnreadableDrafts` instead is what that
 * list is for — it is handled by PATH and needs no target.
 */
function isDraftEnvelope(value: unknown): value is DraftEnvelope {
	if (typeof value !== 'object' || value === null) return false;
	const env = value as Record<string, unknown>;
	if (typeof env.schemaVersion !== 'number') return false;
	const target: unknown = env.target;
	if (typeof target !== 'object' || target === null) return false;
	const kind: unknown = (target as Record<string, unknown>).kind;
	return typeof kind === 'string' && DRAFT_KINDS.has(kind);
}

/** Read + JSON-parse a draft file, or null if it's corrupt / unparseable / not a draft at all
 *  (never throws). */
async function parseDraft<D extends object = Record<string, unknown>>(
	storage: Storage,
	path: string,
): Promise<DraftEnvelope<D> | null> {
	try {
		const parsed: unknown = JSON.parse(await storage.read(path));
		// `D` stays the caller's assertion about `data`, as it always was; the envelope around it is
		// what is checked here
		return isDraftEnvelope(parsed) ? (parsed as DraftEnvelope<D>) : null;
	} catch {
		return null;
	}
}

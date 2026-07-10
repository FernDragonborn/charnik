/*
 * Draft cache — persists in-progress content edits (translate / add / editor) so a form that's closed
 * for any reason (nav away, reload, crash) restores its last state. Storage-agnostic (over the one
 * `Storage` seam), so desktop writes real files under `<dataDir>/drafts/` and web uses IndexedDB.
 *
 * Design (docs/PLAN.md DRAFT-CACHE):
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

export const DRAFTS_DIR = 'drafts';

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
 *  overwrites its one file instead of piling duplicates. */
function draftPath(target: DraftTarget): string {
	return `${DRAFTS_DIR}/${encodeURIComponent(keyString(target))}.json`;
}

/** Write (or overwrite) the draft for `target`. Atomic via the Storage impl; parents auto-created. */
export async function writeDraft<D extends object>(
	storage: Storage,
	target: DraftTarget,
	data: D,
	sourceHash?: string
): Promise<void> {
	const envelope: DraftEnvelope<D> = {
		schemaVersion: CONTENT_SCHEMA_VERSION,
		target,
		...(sourceHash !== undefined ? { sourceHash } : {}),
		savedAt: new Date().toISOString(),
		data
	};
	await storage.write(draftPath(target), JSON.stringify(envelope, null, 2));
}

/** Read the draft for `target`, or null if none / unreadable / a different schema version (ephemeral
 *  WIP → a mismatch is discarded, not migrated; the stale file is removed). */
export async function readDraft<D extends object = Record<string, unknown>>(
	storage: Storage,
	target: DraftTarget
): Promise<DraftEnvelope<D> | null> {
	const path = draftPath(target);
	if (!(await storage.exists(path))) return null;
	const envelope = await parseDraft<D>(storage, path);
	if (!envelope) return null;
	if (envelope.schemaVersion !== CONTENT_SCHEMA_VERSION) {
		await storage.remove(path); // ephemeral WIP from another schema → drop it
		return null;
	}
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

/** Drafts whose target row no longer exists (deleted / renamed / source disabled) — the orphan set the
 *  reassign dialog resolves. `rowExists` is the content graph's membership test (`(eid) => !!graph.get`).
 *  `add` drafts are never orphans (they have no row yet; they're reached via the drafts list). */
export async function findOrphanDrafts(
	storage: Storage,
	rowExists: (effectiveId: string) => boolean
): Promise<DraftEnvelope[]> {
	const drafts = await listDrafts(storage);
	return drafts.filter((d) => {
		const eid = draftEffectiveId(d.target);
		return eid !== null && !rowExists(eid);
	});
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
	overwrite = false
): Promise<RepointResult> {
	const env = await readDraft(storage, from);
	if (!env) return 'missing';
	if (!overwrite && (await readDraft(storage, to))) return 'conflict';
	await writeDraft(storage, to, env.data, env.sourceHash);
	await deleteDraft(storage, from);
	return 'moved';
}

/** Every parseable draft on disk REGARDLESS of schema version (corrupt/unparseable files skipped).
 *  The version-filtered {@link listDrafts} and the stale-version scan both build on this. */
async function listAllDrafts(storage: Storage): Promise<DraftEnvelope[]> {
	if (!(await storage.exists(DRAFTS_DIR))) return [];
	const out: DraftEnvelope[] = [];
	for (const entry of await storage.list(DRAFTS_DIR)) {
		if (entry.isDir || !entry.name.endsWith('.json')) continue;
		const envelope = await parseDraft(storage, entry.path);
		if (envelope) out.push(envelope);
	}
	return out;
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

/** Read + JSON-parse a draft file, or null if it's corrupt / unparseable (never throws). */
async function parseDraft<D extends object = Record<string, unknown>>(
	storage: Storage,
	path: string
): Promise<DraftEnvelope<D> | null> {
	try {
		return JSON.parse(await storage.read(path)) as DraftEnvelope<D>;
	} catch {
		return null;
	}
}

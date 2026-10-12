/*
 * The IO around `locale-merge.ts`: what every writer of `content/` does with the file it is about to
 * replace.
 *
 * Three writers replace a pack file whole — a pack update (`remote/install.ts`), the bundled seed and
 * the bundled restore (`provider.ts`) — and each of them goes through `keepLocalTranslations`, so a
 * translation survives all three by the same rule rather than by three.
 *
 * **A file with translations at stake is copied aside before it is replaced.** The merge keeps what
 * it can, and three things it cannot: a row the incoming file dropped or re-ided, a merge that is
 * simply wrong, and the reader who wants to see what the text was. A log line cannot hold any of
 * that — it carries ids, never prose (`diag/logger.ts` ▸ redaction) — so the copy is the only record.
 * One run's copies share a folder under `content-backups/`, outside `content/`, where every folder
 * is a pack.
 */
import { logger } from '$lib/diag/logger';
import type { Storage } from '$lib/storage/types';
import { CONTENT_DIR } from './disk';
import { gitBlobSha } from './hash';
import {
	carryLocaleCells,
	touchedTranslations,
	translatedRowIds,
	type CarryReport,
} from './locale-merge';

export const TRANSLATION_BACKUP_DIR = 'content-backups';
/** Runs kept. A run is one update or one seed, so this is weeks of history, not megabytes of it. */
const BACKUP_RUNS_KEPT = 10;

/** One writer's pass over `content/`: what it merged, and where the files it replaced were copied. */
export interface CarryRun {
	storage: Storage;
	/** `content-backups/<when>` — created by the first file that needs it. */
	backupDir: string;
	/** dataDir-relative path → what the merge did to that file */
	files: Record<string, CarryReport>;
}

/** Where a run keeps its copy of one content file: the same path, below the run's folder. */
const backupPath = (run: CarryRun, path: string): string =>
	`${run.backupDir}/${path.slice(CONTENT_DIR.length + 1)}`;

/** `2026-10-07T16-41-17` — sortable as text, and legal in a Windows folder name. */
const runStamp = (now: Date): string => now.toISOString().slice(0, 19).replace(/:/g, '-');

/** A run folder's name back as epoch ms, or null for a folder this module did not name. */
export function backupRunTime(folder: string): number | null {
	const stamp = /^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)$/.exec(folder);
	const time = stamp ? Date.parse(`${stamp[1]}:${stamp[2]}:${stamp[3]}Z`) : NaN;
	return Number.isNaN(time) ? null : time;
}

export function beginCarryRun(storage: Storage, now: Date = new Date()): CarryRun {
	return { storage, backupDir: `${TRANSLATION_BACKUP_DIR}/${runStamp(now)}`, files: {} };
}

/** The merge of `incoming` over the file at `path`, or null when no translation is at stake. Reads
 *  only — what is done with the answer is the caller's. */
async function mergeOver(
	storage: Storage,
	path: string,
	incoming: Uint8Array,
): Promise<{ localBytes: Uint8Array; text: string; report: CarryReport } | null> {
	if (!path.endsWith('.csv') || !(await storage.exists(path))) return null;
	const localBytes = await storage.readBytes(path);
	const decoder = new TextDecoder();
	const { text, ...report } = await carryLocaleCells(
		decoder.decode(incoming),
		decoder.decode(localBytes),
		{ upstream: await gitBlobSha(incoming) },
	);
	return touchedTranslations(report) ? { localBytes, text, report } : null;
}

/**
 * The translated rows replacing `path` with `incoming` would leave with nowhere to go, by row id —
 * the merge as a dry pass, so a writer that asks first can name them before anything is written.
 */
export async function translationsOrphanedBy(
	storage: Storage,
	path: string,
	incoming: Uint8Array,
): Promise<string[]> {
	return (await mergeOver(storage, path, incoming))?.report.orphaned ?? [];
}

/** How many translated rows a run could not carry. A writer with no preview says this afterwards. */
export const orphanedIn = (run: CarryRun): number =>
	Object.values(run.files).reduce((count, report) => count + report.orphaned.length, 0);

/**
 * The bytes to write at `path` in place of `incoming`: the same bytes, unless the file already there
 * carries translations — then the merged file, with the one it replaces copied into the run's backup
 * folder first.
 */
export async function keepLocalTranslations(
	run: CarryRun,
	path: string,
	incoming: Uint8Array,
): Promise<Uint8Array> {
	const merge = await mergeOver(run.storage, path, incoming);
	if (merge === null) return incoming;
	const { localBytes, text, report } = merge;
	run.files[path] = report;
	await run.storage.writeBytes(backupPath(run, path), localBytes);
	return report.carried.length > 0 || report.outdated.length > 0
		? new TextEncoder().encode(text)
		: incoming;
}

/**
 * Copy aside a file that is about to be DELETED, if it holds translations. There is no incoming side
 * to merge into, so every translated row in it is orphaned and the copy is all that is kept of them.
 */
export async function setAsideRemovedTranslations(run: CarryRun, path: string): Promise<void> {
	if (!path.endsWith('.csv') || !(await run.storage.exists(path))) return;
	const localBytes = await run.storage.readBytes(path);
	const orphaned = translatedRowIds(new TextDecoder().decode(localBytes));
	if (orphaned.length === 0) return;
	run.files[path] = { carried: [], replaced: [], outdated: [], orphaned };
	await run.storage.writeBytes(backupPath(run, path), localBytes);
}

/** Close a run: say what it did, and drop the backup folders past the ones kept. */
export async function finishCarryRun(run: CarryRun): Promise<void> {
	const merged = Object.entries(run.files);
	if (merged.length === 0) return;
	for (const [file, report] of merged)
		logger.info('content: translations carried', {
			file,
			carried: report.carried.length,
			replaced: report.replaced,
			outdated: report.outdated,
			orphaned: report.orphaned,
			backup: run.backupDir,
		});
	// best-effort: a backup folder that outlives its turn costs disk, and failing the update that
	// just succeeded over it would cost the update
	const runs = (await run.storage.list(TRANSLATION_BACKUP_DIR).catch(() => []))
		.filter((entry) => entry.isDir)
		.map((entry) => entry.path)
		.sort()
		.reverse();
	for (const stale of runs.slice(BACKUP_RUNS_KEPT)) await run.storage.remove(stale).catch(() => {});
}

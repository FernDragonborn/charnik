/*
 * Undoing an applied update (audit-oct-27 D8): the previous version the swap kept beside the pack
 * comes back, and the user says what becomes of what they changed since (`ROLLBACK_MODE`).
 */
import type { Storage } from '$lib/storage/types';
import { listFilesRecursive } from '$lib/storage/walk';
import { isProtectedFromOverwrite } from '../disk';
import {
	backupPathOf,
	beginCarryRun,
	finishCarryRun,
	keepLocalTranslations,
	pruneBackupRuns,
	type CarryRun,
} from '../translation-carry';
import { localPath } from './diff';
import {
	duringPackWrite,
	previousDir,
	recoverInterruptedApply,
	stagingDir,
	swapInNewTree,
	type StagedFile,
} from './install';

/** What happens to what the user changed in the pack since the update they are undoing
 *  (audit-oct-27 D8). The dialog says each of the three. */
export const ROLLBACK_MODE = {
	/** The pack as it stands now is copied into `content-backups/`, where the backups list can put
	 *  it back; then the previous version returns as it was. */
	keepAsBackup: 'keepAsBackup',
	/** The previous version returns through the same merge an update applies: a file the user made
	 *  their own stays, and translations carry over. */
	carryChanges: 'carryChanges',
	/** The previous version returns as it was, and what changed since is gone. */
	discardChanges: 'discardChanges',
} as const;
export type RollbackMode = (typeof ROLLBACK_MODE)[keyof typeof ROLLBACK_MODE];

/** What a rollback did. `backupDir` is set when the pack as it stood was copied aside. */
export interface RolledBack {
	backupDir?: string;
}

/** Roll one applied update back to the copy the swap kept. One generation only — the next apply
 *  replaces it — so this is "undo the last update", not a history. Null when there is nothing to
 *  roll back to. */
export async function rollbackPack(
	storage: Storage,
	pack: string,
	mode: RollbackMode = ROLLBACK_MODE.discardChanges,
): Promise<RolledBack | null> {
	if (!(await storage.exists(previousDir(pack)))) return null;
	if (mode === ROLLBACK_MODE.carryChanges) {
		await rollBackCarrying(storage, pack);
		return {};
	}
	const run = beginCarryRun(storage);
	const backedUp = mode === ROLLBACK_MODE.keepAsBackup && (await copyPackAside(run, pack));
	await swapPreviousIn(storage, pack);
	if (backedUp) await pruneBackupRuns(storage);
	return backedUp ? { backupDir: run.backupDir } : {};
}

/** Copy every file of the live pack into the run's backup folder. False when there was none. */
async function copyPackAside(run: CarryRun, pack: string): Promise<boolean> {
	const files = await listFilesRecursive(run.storage, localPath(pack));
	for (const path of files)
		await run.storage.writeBytes(backupPathOf(run, path), await run.storage.readBytes(path));
	return files.length > 0;
}

async function swapPreviousIn(storage: Storage, pack: string): Promise<void> {
	const live = localPath(pack);
	const prev = previousDir(pack);
	// the pack is absent between the two renames below, exactly as it is during an apply
	await duringPackWrite(async () => {
		const scratch = stagingDir(pack);
		try {
			await storage.remove(scratch).catch(() => {});
			if (await storage.exists(live)) await storage.rename(live, scratch);
			await storage.rename(prev, live);
			await storage.remove(scratch).catch(() => {});
		} catch (e) {
			// the same settling `swapInNewTree` does, for the same reason and the same window: a throw
			// between the two renames leaves the pack folder missing, and once the in-flight flag drops
			// the next rebuild reads that as an uninstall and takes the repo URL and the pin with it
			await recoverInterruptedApply(storage, pack);
			throw e;
		}
	});
}

/**
 * The previous version, applied over the live pack the way an update is: a file the overwrite guard
 * protects keeps the user's bytes, every other file takes the previous bytes with the translations
 * the live one carries merged in, and a file only the update brought is dropped unless it is the
 * user's. The previous copy is consumed, as by a plain rollback.
 */
async function rollBackCarrying(storage: Storage, pack: string): Promise<void> {
	const live = localPath(pack);
	const prev = previousDir(pack);
	const run = beginCarryRun(storage);
	const staged: StagedFile[] = [];
	const fromPrevious = new Set<string>();
	for (const path of await listFilesRecursive(storage, prev)) {
		const below = path.slice(prev.length + 1);
		const livePath = `${live}/${below}`;
		fromPrevious.add(livePath);
		if ((await storage.exists(livePath)) && (await isProtectedFromOverwrite(storage, livePath)))
			continue; // the user's own file: carried over as it stands by the swap
		staged.push({
			path: `${pack}/${below}`,
			bytes: await keepLocalTranslations(run, livePath, await storage.readBytes(path)),
		});
	}
	const dropping = new Set<string>();
	for (const path of await listFilesRecursive(storage, live))
		if (!fromPrevious.has(path) && !(await isProtectedFromOverwrite(storage, path)))
			dropping.add(path);
	await duringPackWrite(async () => {
		await swapInNewTree(storage, pack, staged, dropping);
		await storage.remove(prev).catch(() => {});
	});
	await finishCarryRun(run);
}

/** Is there something to roll back to? Drives the "undo this update" button. */
export const hasRollback = (storage: Storage, pack: string): Promise<boolean> =>
	storage.exists(previousDir(pack));

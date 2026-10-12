/*
 * The way back out of `content-backups/` — the reader and the restore for the copies
 * `translation-carry.ts` sets aside before a file holding translations is replaced.
 *
 * A restore puts the copied files back through the same swap an apply uses (`swapInNewTree`), so the
 * pack it replaces is kept as `<pack>.prev` and "undo this update" reverses it. The copy itself stays
 * where it is: it leaves with its run, when ten newer ones have been taken.
 */
import type { Storage } from '$lib/storage/types';
import { listFilesRecursive } from '$lib/storage/walk';
import { localPath } from './remote/diff';
import { swapInNewTree } from './remote/install';
import { TRANSLATION_BACKUP_DIR, backupRunTime } from './translation-carry';

/** One run's copies, as the restore UI needs them. */
export interface TranslationBackup {
	/** `content-backups/<when>` — the handle `restoreTranslationBackup` is given. */
	path: string;
	/** When the run replaced the files — epoch ms, read from the folder name. */
	when: number;
	/** pack folder → the files of it this run copied aside, as paths below the pack */
	packs: Record<string, string[]>;
}

/** Every run that still holds copies, newest first. */
export async function listTranslationBackups(storage: Storage): Promise<TranslationBackup[]> {
	const backups: TranslationBackup[] = [];
	for (const run of await storage.list(TRANSLATION_BACKUP_DIR).catch(() => [])) {
		const when = run.isDir ? backupRunTime(run.name) : null;
		if (when === null) continue;
		const packs: Record<string, string[]> = {};
		for (const path of await listFilesRecursive(storage, run.path)) {
			const [pack = '', ...below] = path.slice(run.path.length + 1).split('/');
			if (below.length > 0) (packs[pack] ??= []).push(below.join('/'));
		}
		if (Object.keys(packs).length > 0) backups.push({ path: run.path, when, packs });
	}
	return backups.sort((a, b) => b.when - a.when);
}

/**
 * Put one pack's files back as one run copied them. Returns the files restored, below the pack —
 * empty when the run holds none for this pack or the pack is not installed, and then nothing moved.
 */
export async function restoreTranslationBackup(
	storage: Storage,
	backupPath: string,
	pack: string,
): Promise<string[]> {
	const root = `${backupPath}/${pack}`;
	if (!(await storage.exists(localPath(pack))) || !(await storage.exists(root))) return [];
	const below = (await listFilesRecursive(storage, root)).map((path) =>
		path.slice(root.length + 1),
	);
	const files: { path: string; bytes: Uint8Array }[] = [];
	for (const file of below)
		files.push({ path: `${pack}/${file}`, bytes: await storage.readBytes(`${root}/${file}`) });
	await swapInNewTree(storage, pack, files, new Set());
	return below;
}

/** A renamed pack takes its copies along: they are listed under the folder they would go back into. */
export async function renameTranslationBackups(
	storage: Storage,
	from: string,
	to: string,
): Promise<void> {
	for (const run of await storage.list(TRANSLATION_BACKUP_DIR).catch(() => []))
		if (run.isDir && (await storage.exists(`${run.path}/${from}`)))
			await storage.rename(`${run.path}/${from}`, `${run.path}/${to}`);
}

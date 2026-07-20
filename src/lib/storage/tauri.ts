/*
 * The runtime desktop/mobile `Storage` impl — real filesystem via `@tauri-apps/plugin-fs`.
 *
 * This is the ONLY file above the seam that imports Tauri (docs/PLAN.md invariant). Everything
 * else uses the `Storage` interface and never knows which impl backs it. Paths are relative to a
 * lazily-resolved `dataDir` root (OS app-data by default); we join them to an absolute path and
 * reject `..` traversal here, mirroring `NodeStorage` — the Tauri capabilities/fs-scope enforce
 * the same boundary a second time (defence in depth, see docs/SECURITY.md).
 *
 * Writes are atomic (temp sibling → rename), matching the "no DB → atomic temp→rename" invariant.
 * `dataDir` resolution is lazy (a cached Promise) so `getUserStorage()` can stay synchronous while
 * the async `appDataDir()` lookup happens on first use.
 */
import {
	readTextFile,
	readFile,
	writeFile,
	copyFile,
	exists as fsExists,
	readDir,
	stat as fsStat,
	mkdir as fsMkdir,
	remove as fsRemove,
	rename as fsRename,
	watchImmediate
} from '@tauri-apps/plugin-fs';
import { appConfigDir, documentDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import type { Storage, FileEntry } from './types';
import { errText } from '../util/format';
import {
	copyFailures,
	mergeCopyList,
	mergeFailures,
	isSameOrInside,
	type DirFile
} from './migrate';

/** The user's data root is a VISIBLE, self-named folder (not a hidden per-app dir) — see
 *  docs/PLAN.md "Data directory & config". */
const DATA_DIR_NAME = 'charnik';
/** Tiny app-managed pointer (in the OS app-config dir) recording a user-chosen data location. */
const POINTER_FILE = 'config.json';

/** Absolute path of the pointer config — lives in appConfig, OUTSIDE the data root it points at. */
async function pointerPath(): Promise<string> {
	return join(await appConfigDir(), POINTER_FILE);
}

/** The user's saved data-dir choice, or null if none / unreadable. */
async function readDataDirOverride(): Promise<string | null> {
	try {
		const p = await pointerPath();
		if (!(await fsExists(p))) return null;
		const saved = JSON.parse(await readTextFile(p))?.dataDir;
		return typeof saved === 'string' && saved ? saved : null;
	} catch {
		return null;
	}
}

/** Persist a user-chosen data dir to the pointer (used by the first-run + settings folder picker). */
export async function setDataDirOverride(dir: string): Promise<void> {
	await fsMkdir(await appConfigDir(), { recursive: true });
	await writeFile(
		await pointerPath(),
		new TextEncoder().encode(JSON.stringify({ dataDir: dir }, null, 2))
	);
}

/** Resolve the writable data root: an explicit user choice, else the default `<Documents>/charnik`. */
async function resolveDataDir(): Promise<string> {
	return (await readDataDirOverride()) ?? defaultDataDir();
}

/** The user's previously saved data-dir choice, or null on first run (drives the first-run picker). */
export async function getSavedDataDir(): Promise<string | null> {
	return readDataDirOverride();
}

/** The proposed default data dir (`<Documents>/charnik`) shown in the first-run picker. */
export async function defaultDataDir(): Promise<string> {
	return join(await documentDir(), DATA_DIR_NAME);
}

/** Grant the fs plugin runtime access to `dir` (a user-picked folder outside the static scope);
 *  redundant-but-harmless for the default. Backed by the `allow_data_dir` Rust command. */
export async function grantDataDirScope(dir: string): Promise<void> {
	await invoke('allow_data_dir', { path: dir });
}

/** Open the OS folder picker; resolves to the chosen directory, or null if cancelled. */
export async function pickDataDir(): Promise<string | null> {
	const chosen = await open({ directory: true, multiple: false });
	return typeof chosen === 'string' ? chosen : null;
}

/** The active data dir (the saved choice or the default) — for display in settings. */
export async function currentDataDir(): Promise<string> {
	return resolveDataDir();
}

/** Open the folder picker and propose `<picked parent>/charnik` as the move target. Grants fs-scope
 *  for the target right away (session-only — nothing is persisted until the move flow commits): the
 *  dialog plugin auto-extends scope for the PICKED path, but the flow then reads/copies into the
 *  `charnik` child, and we must not bet on that extension being recursive. Null if cancelled. */
export async function pickTargetDataDir(): Promise<string | null> {
	const parent = await pickDataDir();
	if (!parent) return null;
	const target = await join(parent, DATA_DIR_NAME);
	await grantDataDirScope(target);
	return target;
}

/** Open the active data folder in the OS file manager (shows content/ + characters/). */
export async function openDataDir(): Promise<void> {
	await openPath(await resolveDataDir());
}

/** Persist a chosen data folder WITHOUT moving anything — "just read from here now". Used when the
 *  user has already copied their data across by hand (the repoint-only branch of the change flow). */
export async function repointDataDir(dir: string): Promise<void> {
	await grantDataDirScope(dir);
	await setDataDirOverride(dir);
}

/** True when `dir` has no entries (or doesn't exist yet) — the precondition for an automatic move. */
export async function dirIsEmpty(dir: string): Promise<boolean> {
	if (!(await fsExists(dir))) return true;
	return (await readDir(dir)).length === 0;
}

/** Walk a folder subtree into a flat list of files (relative path + size + mtime). Directories are
 *  not listed — `copyTree` recreates them from each file's path. */
async function walkTree(dir: string): Promise<DirFile[]> {
	const out: DirFile[] = [];
	async function recurse(abs: string, rel: string): Promise<void> {
		for (const e of await readDir(abs)) {
			const childAbs = await join(abs, e.name);
			const childRel = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory) await recurse(childAbs, childRel);
			else {
				const info = await fsStat(childAbs);
				out.push({ path: childRel, size: info.size, mtime: info.mtime?.getTime() });
			}
		}
	}
	if (await fsExists(dir)) await recurse(dir, '');
	return out;
}

/** The current data folder's files — for the merge dialog's name table (see docs/PLAN.md). */
export async function listDataDirFiles(dir: string): Promise<DirFile[]> {
	return walkTree(dir);
}

/** Where a failed move broke, so the UI can say exactly what went wrong:
 *  - `target-inside-source` — chosen folder is nested in the current one (would copy into itself).
 *  - `copy` — an fs error while copying (permissions, disk full, path too long…); `error` has the text.
 *  - `verify` — copy finished but files are missing / wrong size (`failures` lists them); nothing deleted.
 *  - `cleanup` — the MOVE SUCCEEDED (data safe at the new folder) but deleting the OLD folder failed. */
type MigrateStage = 'target_inside_source' | 'copy' | 'verify' | 'cleanup';

export interface MigrateOutcome {
	ok: boolean;
	/** Which step failed — absent on full success. */
	stage?: MigrateStage;
	/** Source files that didn't reach the target (only set for `stage: 'verify'`). */
	failures: string[];
	/** Human-readable reason for a thrown fs error (`copy`/`cleanup` stages). */
	error?: string;
}

/** Copy each listed file `oldDir → newDir`, recreating parent folders. Throws on the first fs error.
 *  NB: mtime survives on Windows (CopyFileEx) but NOT on Linux (`std::fs::copy`) — so a later merge's
 *  "newer" comparison treats Linux-copied files as fresh. Verification compares size, not mtime. */
async function copyFilesInto(oldDir: string, newDir: string, files: DirFile[]): Promise<void> {
	await fsMkdir(newDir, { recursive: true });
	for (const file of files) {
		const to = await join(newDir, ...file.path.split('/'));
		const from = await join(oldDir, ...file.path.split('/'));
		const lastSep = Math.max(to.lastIndexOf('/'), to.lastIndexOf('\\'));
		if (lastSep > 0) await fsMkdir(to.slice(0, lastSep), { recursive: true });
		await copyFile(from, to);
	}
}

/** Repoint the pointer at `newDir`, then (if asked) delete the old folder — the shared tail of both a
 *  move and a merge, once the copy has been verified. A delete failure is non-fatal (`cleanup`). */
async function finalizeMove(
	oldDir: string,
	newDir: string,
	deleteOld: boolean
): Promise<MigrateOutcome> {
	await grantDataDirScope(newDir);
	await setDataDirOverride(newDir);
	if (deleteOld) {
		try {
			await fsRemove(oldDir, { recursive: true });
		} catch (e) {
			return { ok: true, stage: 'cleanup', failures: [], error: errText(e) };
		}
	}
	return { ok: true, failures: [] };
}

/** Best-effort removal of a half-copied target after a failed move. Only safe on the EMPTY-target
 *  path (the folder held nothing but our fresh copies) — without it a retry would find a non-empty
 *  folder and confusingly open the conflict dialog on the app's own leftovers. */
async function discardFailedCopy(newDir: string): Promise<void> {
	try {
		await fsRemove(newDir, { recursive: true });
	} catch {
		// leftover junk is cosmetic; the retry path still works via the conflict dialog
	}
}

/** Move the data folder into an EMPTY target: copy every file `oldDir → newDir`, verify the copy is
 *  complete (each source file present at the right size), then repoint and delete the old folder (when
 *  `deleteOld`). On any failure the SOURCE folder is left intact and the pointer stays on the old dir
 *  (half-copied target files are swept away) — except a `cleanup` failure, where the move already
 *  succeeded and only the old folder lingers. */
export async function migrateDataDir(
	oldDir: string,
	newDir: string,
	deleteOld: boolean
): Promise<MigrateOutcome> {
	if (isSameOrInside(newDir, oldDir))
		return { ok: false, stage: 'target_inside_source', failures: [] };

	const source = await walkTree(oldDir);
	try {
		await copyFilesInto(oldDir, newDir, source);
	} catch (e) {
		await discardFailedCopy(newDir);
		return { ok: false, stage: 'copy', failures: [], error: errText(e) };
	}

	const failures = copyFailures(source, await walkTree(newDir));
	if (failures.length) {
		await discardFailedCopy(newDir);
		return { ok: false, stage: 'verify', failures };
	}

	return finalizeMove(oldDir, newDir, deleteOld);
}

/** Merge the data folder into a NON-empty target: copy only the files the target lacks or that the
 *  source has a newer copy of (newer-wins; undatable collisions keep the target). Verify every source
 *  file is present afterwards, then repoint and delete the old folder (when `deleteOld`). Same
 *  failure/rollback contract as `migrateDataDir`. */
export async function mergeDataDir(
	oldDir: string,
	newDir: string,
	deleteOld: boolean
): Promise<MigrateOutcome> {
	if (isSameOrInside(newDir, oldDir))
		return { ok: false, stage: 'target_inside_source', failures: [] };

	const source = await walkTree(oldDir);
	const target = await walkTree(newDir);
	const toCopy = mergeCopyList(source, target);
	try {
		await copyFilesInto(oldDir, newDir, toCopy);
	} catch (e) {
		return { ok: false, stage: 'copy', failures: [], error: errText(e) };
	}

	const failures = mergeFailures(source, toCopy, await walkTree(newDir));
	if (failures.length) return { ok: false, stage: 'verify', failures };

	return finalizeMove(oldDir, newDir, deleteOld);
}

export class TauriStorage implements Storage {
	/** Cached absolute data root (lazy — resolved on first op, then reused). */
	#root: Promise<string> | null = null;

	constructor(private readonly resolveRoot: () => Promise<string> = resolveDataDir) {}

	#dataDir(): Promise<string> {
		return (this.#root ??= this.resolveRoot());
	}

	/** dataDir-relative path → absolute, rejecting escapes outside the root. */
	private async abs(path: string): Promise<string> {
		const rel = path.replace(/^\/+/, '');
		if (rel.split('/').includes('..')) throw new Error(`path escapes storage root: ${path}`);
		return join(await this.#dataDir(), rel);
	}

	private async parent(abs: string): Promise<string> {
		const i = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'));
		return i <= 0 ? abs : abs.slice(0, i);
	}

	async read(path: string): Promise<string> {
		return readTextFile(await this.abs(path));
	}
	async readBytes(path: string): Promise<Uint8Array> {
		return readFile(await this.abs(path));
	}
	async write(path: string, data: string): Promise<void> {
		await this.writeBytes(path, new TextEncoder().encode(data));
	}
	/** Atomic: write a temp sibling, then rename into place (crash-safe). */
	async writeBytes(path: string, data: Uint8Array): Promise<void> {
		const full = await this.abs(path);
		await fsMkdir(await this.parent(full), { recursive: true });
		const tmp = `${full}.tmp-${Math.random().toString(36).slice(2)}-${Date.now()}`;
		await writeFile(tmp, data);
		await fsRename(tmp, full);
	}
	async exists(path: string): Promise<boolean> {
		return fsExists(await this.abs(path));
	}
	async list(dir: string): Promise<FileEntry[]> {
		const full = await this.abs(dir);
		if (!(await fsExists(full))) return [];
		const entries = await readDir(full);
		const prefix = dir.replace(/^\/+|\/+$/g, '');
		return Promise.all(
			entries.map(async (e) => {
				// stat each file for its mtime (readDir entries don't carry it); dirs skip it
				let mtime: number | undefined;
				if (!e.isDirectory) {
					const info = await fsStat(await this.abs(prefix ? `${prefix}/${e.name}` : e.name));
					mtime = info.mtime ? info.mtime.getTime() : undefined;
				}
				return {
					path: prefix ? `${prefix}/${e.name}` : e.name,
					name: e.name,
					isDir: e.isDirectory,
					mtime
				};
			})
		);
	}
	async mkdir(path: string): Promise<void> {
		await fsMkdir(await this.abs(path), { recursive: true });
	}
	async remove(path: string): Promise<void> {
		await fsRemove(await this.abs(path), { recursive: true });
	}
	/** Watch a subtree. The plugin's unwatch is async; bridge it to the sync unsubscribe the
	 *  `Storage` contract returns (calls detach once the watcher has attached). */
	watch(dir: string, onChange: (path: string) => void): () => void {
		const rootPromise = this.#dataDir();
		const unwatch = this.abs(dir).then((full) =>
			watchImmediate(
				full,
				(e) => {
					for (const p of e.paths) rootPromise.then((root) => onChange(toRel(root, p)));
				},
				{ recursive: true }
			)
		);
		return () => void unwatch.then((fn) => fn()).catch(() => {});
	}
}

/** Turn an absolute watched path back into a dataDir-relative, forward-slashed path. */
function toRel(root: string, abs: string): string {
	const a = abs.replace(/\\/g, '/');
	const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
	return a.startsWith(r + '/') ? a.slice(r.length + 1) : a;
}

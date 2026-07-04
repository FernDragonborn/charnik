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
	exists as fsExists,
	readDir,
	mkdir as fsMkdir,
	remove as fsRemove,
	rename as fsRename,
	watchImmediate
} from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import type { Storage, FileEntry } from './types';

/** Resolve the writable data root once (OS app-data dir for this app id). */
async function resolveDataDir(): Promise<string> {
	return appDataDir();
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
		return entries.map((e) => ({
			path: prefix ? `${prefix}/${e.name}` : e.name,
			name: e.name,
			isDir: e.isDirectory
		}));
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

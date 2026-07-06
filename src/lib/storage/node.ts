/*
 * A node:fs implementation of the `Storage` interface, sandboxed to a root directory.
 *
 * NOT the runtime impl (that is Tauri fs) — this backs integration tests and any CLI/
 * tooling that needs to read the real `content/` tree without Tauri. Path traversal
 * outside the root is rejected, mirroring the capability scope of the Tauri impl.
 */
import { readFile, writeFile, readdir, mkdir as fsMkdir, rm, rename, stat } from 'node:fs/promises';
import { existsSync, watch as fsWatch } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import type { Storage, FileEntry } from './types';

export class NodeStorage implements Storage {
	constructor(private readonly root: string) {}

	/** Resolve a dataDir-relative path and reject escapes outside the root. */
	private abs(path: string): string {
		const full = resolve(this.root, path);
		if (full !== this.root && !full.startsWith(this.root + sep)) {
			throw new Error(`path escapes storage root: ${path}`);
		}
		return full;
	}

	async read(path: string): Promise<string> {
		return readFile(this.abs(path), 'utf8');
	}
	async readBytes(path: string): Promise<Uint8Array> {
		return new Uint8Array(await readFile(this.abs(path)));
	}
	async write(path: string, data: string): Promise<void> {
		await this.writeBytes(path, new TextEncoder().encode(data));
	}
	/** Atomic: write a temp sibling then rename into place. */
	async writeBytes(path: string, data: Uint8Array): Promise<void> {
		const full = this.abs(path);
		await fsMkdir(dirname(full), { recursive: true });
		const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
		await writeFile(tmp, data);
		await rename(tmp, full);
	}
	async exists(path: string): Promise<boolean> {
		return existsSync(this.abs(path));
	}
	async list(dir: string): Promise<FileEntry[]> {
		const full = this.abs(dir);
		if (!existsSync(full)) return [];
		const entries = await readdir(full, { withFileTypes: true });
		return Promise.all(
			entries.map(async (e) => {
				const isDir = e.isDirectory();
				const mtime = isDir ? undefined : (await stat(join(full, e.name))).mtimeMs;
				return {
					path: (dir ? join(dir, e.name) : e.name).split(sep).join('/'),
					name: e.name,
					isDir,
					mtime
				};
			})
		);
	}
	async mkdir(path: string): Promise<void> {
		await fsMkdir(this.abs(path), { recursive: true });
	}
	async remove(path: string): Promise<void> {
		await rm(this.abs(path), { recursive: true, force: true });
	}
	watch(dir: string, onChange: (path: string) => void): () => void {
		const w = fsWatch(this.abs(dir), { recursive: true }, (_e, name) => {
			if (name) onChange((dir ? join(dir, name.toString()) : name.toString()).split(sep).join('/'));
		});
		return () => w.close();
	}

	/** Convenience for tooling: does the root exist as a directory. */
	async rootExists(): Promise<boolean> {
		return existsSync(this.root) && (await stat(this.root)).isDirectory();
	}
}

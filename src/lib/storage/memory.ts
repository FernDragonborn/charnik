import type { FileEntry, Storage } from './types';

/** Normalize to `/`-separated, root-relative; reject traversal (sandbox). */
function norm(p: string): string {
	const parts = p
		.replace(/\\/g, '/')
		.split('/')
		.filter((s) => s && s !== '.');
	if (parts.includes('..')) throw new Error(`path escapes root: ${p}`);
	return parts.join('/');
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * In-memory `Storage` for tests (and a reference impl). No real filesystem; safe to use
 * freely in unit/integration tests instead of touching the user's data.
 */
export class MemoryStorage implements Storage {
	private files = new Map<string, Uint8Array>();
	private dirs = new Set<string>(['']);
	private watchers = new Map<string, Set<(path: string) => void>>();

	private emit(path: string): void {
		for (const [dir, cbs] of this.watchers) {
			if (dir === '' || path === dir || path.startsWith(dir + '/')) {
				for (const cb of cbs) cb(path);
			}
		}
	}

	private ensureAncestors(path: string): void {
		const parts = path.split('/');
		for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'));
	}

	async read(path: string): Promise<string> {
		return dec.decode(await this.readBytes(path));
	}

	async readBytes(path: string): Promise<Uint8Array> {
		const k = norm(path);
		const v = this.files.get(k);
		if (!v) throw new Error(`no such file: ${k}`);
		return v;
	}

	async write(path: string, data: string): Promise<void> {
		await this.writeBytes(path, enc.encode(data));
	}

	async writeBytes(path: string, data: Uint8Array): Promise<void> {
		const k = norm(path);
		this.ensureAncestors(k);
		this.files.set(k, data);
		this.emit(k);
	}

	async exists(path: string): Promise<boolean> {
		const k = norm(path);
		return this.files.has(k) || this.dirs.has(k);
	}

	async list(dir: string): Promise<FileEntry[]> {
		const base = norm(dir);
		const prefix = base ? base + '/' : '';
		const out = new Map<string, FileEntry>();
		const consider = (full: string, isDir: boolean) => {
			if (!full || !full.startsWith(prefix)) return;
			const rest = full.slice(prefix.length);
			if (!rest) return;
			const slash = rest.indexOf('/');
			if (slash === -1) {
				out.set(full, { path: full, name: rest, isDir });
			} else {
				const top = rest.slice(0, slash);
				out.set(prefix + top, { path: prefix + top, name: top, isDir: true });
			}
		};
		for (const f of this.files.keys()) consider(f, false);
		for (const d of this.dirs) consider(d, true);
		return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	async mkdir(path: string): Promise<void> {
		const k = norm(path);
		this.ensureAncestors(k);
		if (k) this.dirs.add(k);
	}

	async remove(path: string): Promise<void> {
		const k = norm(path);
		this.files.delete(k);
		this.dirs.delete(k);
		// Recursive, matching the node/Tauri impls: removing a dir removes its contents.
		const prefix = k + '/';
		for (const f of [...this.files.keys()]) if (f.startsWith(prefix)) this.files.delete(f);
		for (const d of [...this.dirs]) if (d.startsWith(prefix)) this.dirs.delete(d);
		this.emit(k);
	}

	watch(dir: string, onChange: (path: string) => void): () => void {
		const k = norm(dir);
		let set = this.watchers.get(k);
		if (!set) {
			set = new Set();
			this.watchers.set(k, set);
		}
		set.add(onChange);
		return () => {
			this.watchers.get(k)?.delete(onChange);
		};
	}
}

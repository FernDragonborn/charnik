/*
 * Writable browser Storage — IndexedDB (via `idb`), used for the pure-web build. One object
 * store keyed by full path → { isDir, data }. Directory semantics are synthesised over the flat
 * key space (mkdir writes a marker; list scans immediate children by prefix; remove deletes the
 * subtree). Chosen over OPFS for universal reach (every desktop browser + iOS Safari + Android).
 * The compiled Tauri apps use a real-fs impl behind the same `Storage` interface.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { Storage, FileEntry } from './types';

const DB_NAME = 'charnik';
const STORE = 'fs';

interface Node {
	isDir: boolean;
	data?: string | Uint8Array;
}

const norm = (p: string) => p.replace(/^\/+|\/+$/g, '');
const name = (p: string) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);

type Listener = { dir: string; fn: (path: string) => void };

export class BrowserStorage implements Storage {
	#db: Promise<IDBPDatabase>;
	#listeners = new Set<Listener>();

	constructor(dbName = DB_NAME) {
		this.#db = openDB(dbName, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
			}
		});
	}

	async #get(path: string): Promise<Node | undefined> {
		return (await this.#db).get(STORE, path);
	}
	async #put(path: string, node: Node) {
		await (await this.#db).put(STORE, node, path);
	}
	/** Ensure every ancestor directory of `path` exists (idempotent). */
	async #ensureParents(path: string) {
		const parts = norm(path).split('/').slice(0, -1);
		let acc = '';
		for (const seg of parts) {
			acc = acc ? `${acc}/${seg}` : seg;
			if (!(await this.#get(acc))) await this.#put(acc, { isDir: true });
		}
	}
	#notify(path: string) {
		for (const l of this.#listeners) if (path === l.dir || path.startsWith(`${l.dir}/`)) l.fn(path);
	}

	async read(path: string): Promise<string> {
		const n = await this.#get(norm(path));
		if (!n || n.isDir || n.data == null) throw new Error(`not a file: ${path}`);
		return typeof n.data === 'string' ? n.data : new TextDecoder().decode(n.data);
	}
	async readBytes(path: string): Promise<Uint8Array> {
		const n = await this.#get(norm(path));
		if (!n || n.isDir || n.data == null) throw new Error(`not a file: ${path}`);
		return typeof n.data === 'string' ? new TextEncoder().encode(n.data) : n.data;
	}
	async write(path: string, data: string): Promise<void> {
		const p = norm(path);
		await this.#ensureParents(p);
		await this.#put(p, { isDir: false, data });
		this.#notify(p);
	}
	async writeBytes(path: string, data: Uint8Array): Promise<void> {
		const p = norm(path);
		await this.#ensureParents(p);
		await this.#put(p, { isDir: false, data });
		this.#notify(p);
	}
	async exists(path: string): Promise<boolean> {
		return (await this.#get(norm(path))) !== undefined;
	}
	async mkdir(path: string): Promise<void> {
		const p = norm(path);
		await this.#ensureParents(p);
		if (!(await this.#get(p))) await this.#put(p, { isDir: true });
	}
	async list(dir: string): Promise<FileEntry[]> {
		const d = norm(dir);
		const prefix = d ? `${d}/` : '';
		const keys = (await (await this.#db).getAllKeys(STORE)) as string[];
		const out: FileEntry[] = [];
		for (const key of keys) {
			if (!key.startsWith(prefix) || key === d) continue;
			const rest = key.slice(prefix.length);
			if (rest.includes('/')) continue; // not an immediate child
			const n = (await this.#get(key))!;
			out.push({ path: key, name: name(key), isDir: n.isDir });
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}
	async remove(path: string): Promise<void> {
		const p = norm(path);
		const db = await this.#db;
		const keys = (await db.getAllKeys(STORE)) as string[];
		const tx = db.transaction(STORE, 'readwrite');
		for (const key of keys) if (key === p || key.startsWith(`${p}/`)) await tx.store.delete(key);
		await tx.done;
		this.#notify(p);
	}
	watch(dir: string, onChange: (path: string) => void): () => void {
		const l: Listener = { dir: norm(dir), fn: onChange };
		this.#listeners.add(l);
		return () => this.#listeners.delete(l);
	}
}

/*
 * Writable browser Storage — IndexedDB (via `idb`), used for the pure-web build. One object
 * store keyed by full path → { isDir, data }. Directory semantics are synthesised over the flat
 * key space (mkdir writes a marker; list scans immediate children by prefix; remove deletes the
 * subtree). Chosen over OPFS for universal reach (every desktop browser + iOS Safari + Android).
 * The compiled Tauri apps use a real-fs impl behind the same `Storage` interface.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Storage, FileEntry } from './types';
import { sandboxRelative } from './path';

const DB_NAME = 'charnik';
const STORE = 'fs';

interface Node {
	isDir: boolean;
	data?: string | Uint8Array;
}

/** The store's shape, declared to `idb` rather than left to inference: without it every `get` is a
 *  `Promise<any>` and every key list an `any[]`, so the one boundary where the browser hands us back
 *  whatever it stored is also the one place nothing is checked (LINT-1's `no-unsafe-*` pass). */
interface CharnikDB extends DBSchema {
	[STORE]: { key: string; value: Node };
}

/** The seam's sandbox, then the flat-keyspace form IndexedDB is keyed by. The traversal check is
 *  not theoretical here — `types.ts` promises every implementation enforces it, and this one used to
 *  strip slashes and nothing else. */
const norm = (p: string) => sandboxRelative(p);
const name = (p: string) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);

type Listener = { dir: string; fn: (path: string) => void };

export class BrowserStorage implements Storage {
	#db: Promise<IDBPDatabase<CharnikDB>>;
	#listeners = new Set<Listener>();

	constructor(dbName = DB_NAME) {
		this.#db = openDB<CharnikDB>(dbName, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
			},
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
		const keys = await (await this.#db).getAllKeys(STORE);
		const out: FileEntry[] = [];
		for (const key of keys) {
			if (!key.startsWith(prefix) || key === d) continue;
			const rest = key.slice(prefix.length);
			if (rest.includes('/')) continue; // not an immediate child
			const n = await this.#get(key);
			if (!n) continue; // key came from getAllKeys, but tolerate a concurrent delete
			out.push({ path: key, name: name(key), isDir: n.isDir });
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}
	async remove(path: string): Promise<void> {
		const p = norm(path);
		const db = await this.#db;
		const keys = await db.getAllKeys(STORE);
		const tx = db.transaction(STORE, 'readwrite');
		for (const key of keys) if (key === p || key.startsWith(`${p}/`)) await tx.store.delete(key);
		await tx.done;
		this.#notify(p);
	}
	/** Key-prefix move: IndexedDB has no directories, so "renaming a folder" is re-keying every
	 *  entry under it. One transaction, so a half-moved tree can't be observed. */
	async rename(from: string, to: string): Promise<void> {
		const src = norm(from);
		const dst = norm(to);
		const db = await this.#db;
		const keys = await db.getAllKeys(STORE);
		// A flat keyspace re-keys happily, so without these two the web build is the one
		// implementation that neither refuses nor reports a bad move: a missing source succeeded as a
		// no-op, and an occupied destination MERGED the two trees. Both real filesystems throw, and
		// `types.ts` promises exactly that — "overwriting an existing target is not promised".
		const under = (root: string) => (k: IDBValidKey) =>
			k === root || (typeof k === 'string' && k.startsWith(`${root}/`));
		if (!keys.some(under(src))) throw new Error(`no such path: ${src}`);
		if (keys.some(under(dst))) throw new Error(`rename target exists: ${dst}`);
		const tx = db.transaction(STORE, 'readwrite');
		for (const key of keys) {
			if (key !== src && !key.startsWith(`${src}/`)) continue;
			const value = await tx.store.get(key);
			// a key listed a moment ago with nothing behind it is not a node to move — writing the
			// `undefined` through (which the untyped store used to allow) would plant an entry that
			// every later read treats as a real file
			if (value === undefined) continue;
			await tx.store.delete(key);
			await tx.store.put(value, dst + key.slice(src.length));
		}
		await tx.done;
		this.#notify(src);
		this.#notify(dst);
	}
	watch(dir: string, onChange: (path: string) => void): () => void {
		const l: Listener = { dir: norm(dir), fn: onChange };
		this.#listeners.add(l);
		return () => this.#listeners.delete(l);
	}
}

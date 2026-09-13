/*
 * A read-only `Storage` over HTTP `fetch` — the WEB content source. The shipped content is
 * served as static assets (see tools/build-static-content.mjs); this reads them. Since HTTP
 * has no directory listing, `list()` consults the generated `content/manifest.json`.
 *
 * Read-only: characters/homebrew on the web live in a separate writable store (IndexedDB/
 * OPFS). Writes here throw. `watch` is a no-op (static assets don't change at runtime).
 */
import type { Storage, FileEntry } from './types';
import { sandboxRelative } from './path';

interface Manifest {
	roots: Record<string, string[]>;
}

export class FetchStorage implements Storage {
	private manifest: Promise<Manifest> | null = null;

	/** `basePrefix` = the app base path ('' on desktop-style root, '/charnik' on Pages). */
	constructor(
		private readonly basePrefix = '',
		private readonly manifestPath = 'content/manifest.json',
	) {}

	private url(path: string): string {
		// sandboxed like every other impl (`types.ts`): `../../x` appended to the base is resolved by
		// the browser BEFORE the request, so the seam is the only thing that can refuse it
		return `${this.basePrefix}/${sandboxRelative(path)}`.replace(/\/{2,}/g, '/');
	}

	private loadManifest(): Promise<Manifest> {
		if (!this.manifest) {
			this.manifest = fetch(this.url(this.manifestPath)).then((r) =>
				r.ok ? (r.json() as Promise<Manifest>) : { roots: {} },
			);
		}
		return this.manifest;
	}

	async read(path: string): Promise<string> {
		const r = await fetch(this.url(path));
		if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
		return r.text();
	}
	async readBytes(path: string): Promise<Uint8Array> {
		const r = await fetch(this.url(path));
		if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
		return new Uint8Array(await r.arrayBuffer());
	}
	async exists(path: string): Promise<boolean> {
		const m = await this.loadManifest();
		const slash = path.lastIndexOf('/');
		const dir = slash === -1 ? '' : path.slice(0, slash);
		const name = slash === -1 ? path : path.slice(slash + 1);
		if (m.roots[dir]) return m.roots[dir].includes(name) || m.roots[path] !== undefined;
		// fall back to a network check for anything not in the manifest
		return fetch(this.url(path), { method: 'HEAD' })
			.then((r) => r.ok)
			.catch(() => false);
	}
	async list(dir: string): Promise<FileEntry[]> {
		const m = await this.loadManifest();
		const files = (m.roots[dir] ?? []).map((name) => ({
			path: `${dir}/${name}`,
			name,
			isDir: false,
		}));
		// HTTP has no directory listing, so the manifest's KEYS stand in for one: a root that sits
		// under `dir` reports as a SUBDIRECTORY. Without this, listing `content/` came back empty and
		// pack discovery (which scans for folders) saw nothing on the web build.
		const prefix = dir === '' ? '' : `${dir}/`;
		const subdirs = new Set<string>();
		for (const root of Object.keys(m.roots)) {
			if (root === dir || !root.startsWith(prefix)) continue;
			const name = root.slice(prefix.length).split('/')[0];
			if (name) subdirs.add(name);
		}
		return [
			...[...subdirs].map((name) => ({ path: `${prefix}${name}`, name, isDir: true })),
			...files,
		];
	}

	async write(): Promise<void> {
		throw new Error('FetchStorage is read-only');
	}
	async writeBytes(): Promise<void> {
		throw new Error('FetchStorage is read-only');
	}
	async mkdir(): Promise<void> {
		throw new Error('FetchStorage is read-only');
	}
	async remove(): Promise<void> {
		throw new Error('FetchStorage is read-only');
	}
	async rename(): Promise<void> {
		throw new Error('FetchStorage is read-only');
	}
	watch(): () => void {
		return () => {};
	}
}

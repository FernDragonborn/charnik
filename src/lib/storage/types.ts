/**
 * The one file-IO seam for the whole app.
 *
 * Paths are relative to the configured `dataDir` root and are sandboxed by the
 * implementation (traversal outside the root is rejected). Nothing above this interface
 * imports Tauri directly:
 *   - runtime impl  = Tauri fs (`@tauri-apps/plugin-fs`), scoped by capabilities
 *   - test impl     = `MemoryStorage` (and later a node-fs impl for temp-dir tests)
 *
 * See docs/PLAN.md (Architecture) and docs/SECURITY.md.
 */
export interface FileEntry {
	/** Path relative to the dataDir root, using `/` separators. */
	path: string;
	/** Final path segment. */
	name: string;
	isDir: boolean;
}

export interface Storage {
	read(path: string): Promise<string>;
	readBytes(path: string): Promise<Uint8Array>;
	/** Atomic write (temp → rename in real impls). */
	write(path: string, data: string): Promise<void>;
	writeBytes(path: string, data: Uint8Array): Promise<void>;
	exists(path: string): Promise<boolean>;
	/** Immediate children of a directory (non-recursive). */
	list(dir: string): Promise<FileEntry[]>;
	mkdir(path: string): Promise<void>;
	remove(path: string): Promise<void>;
	/** Watch a directory subtree; returns an unsubscribe function. */
	watch(dir: string, onChange: (path: string) => void): () => void;
}

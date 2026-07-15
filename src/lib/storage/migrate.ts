/*
 * Pure diff/validation math for MOVING the data dir (characters + content) to a new folder.
 *
 * The filesystem walk/copy lives in `tauri.ts` (the one Tauri-fs seam); this module is pure so the
 * two decisions that matter — "is the copy complete enough to delete the source?" and "what do the
 * two folders share/differ on?" — are unit-testable without touching disk. A `DirFile` is one file
 * with a dataDir-relative, forward-slashed path plus its size and (best-effort) mtime.
 */
export interface DirFile {
	/** Path relative to the folder root, `/`-separated. */
	path: string;
	/** Size in bytes — the integrity check after a copy (we just wrote these, so size match ⇒ ok). */
	size: number;
	/** Last-modified epoch ms, when the fs reports it. Shown in the merge dialog to spot the newer file. */
	mtime?: number | undefined;
}

const byPath = (files: DirFile[]): Map<string, DirFile> => new Map(files.map((f) => [f.path, f]));

/** Which source files did NOT make it to the target (missing or wrong size). Empty ⇒ copy is complete
 *  and it is safe to delete the source. */
export function copyFailures(source: DirFile[], target: DirFile[]): string[] {
	const tgt = byPath(target);
	const fails: string[] = [];
	for (const s of source) {
		const t = tgt.get(s.path);
		if (!t || t.size !== s.size) fails.push(s.path);
	}
	return fails;
}

/** Which side of a name collision is newer, to drive the table highlight. `null` when the file is on
 *  only one side; `unknown` when a side's mtime is missing so we can't compare. */
type Newer = 'source' | 'target' | 'same' | 'unknown' | null;

/** One row of the conflict table: a file present in the current folder, the chosen folder, or both. */
export interface ConflictRow {
	path: string;
	/** The file in the CURRENT (old) data folder, if present there. */
	source?: DirFile | undefined;
	/** The file in the CHOSEN (new) folder, if present there. */
	target?: DirFile | undefined;
	newer: Newer;
}

function whichNewer(source?: DirFile, target?: DirFile): Newer {
	if (!source || !target) return null;
	if (source.mtime == null || target.mtime == null) return 'unknown';
	if (source.mtime === target.mtime) return 'same';
	return source.mtime > target.mtime ? 'source' : 'target';
}

/** Build the conflict table: every file across both folders, collisions (present in both) first so the
 *  user sees the overlaps up top, then the rest — each group sorted by path. */
export function conflictRows(source: DirFile[], target: DirFile[]): ConflictRow[] {
	const src = byPath(source);
	const tgt = byPath(target);
	const rows: ConflictRow[] = [];
	for (const path of new Set([...src.keys(), ...tgt.keys()])) {
		const s = src.get(path);
		const t = tgt.get(path);
		rows.push({ path, source: s, target: t, newer: whichNewer(s, t) });
	}
	const bothFirst = (r: ConflictRow) => (r.source && r.target ? 0 : 1);
	return rows.sort((a, b) => bothFirst(a) - bothFirst(b) || a.path.localeCompare(b.path));
}

/** For a MERGE: which source files to copy into a non-empty target — those the target lacks, or where
 *  the source is strictly newer. On a name collision we can't date (missing mtime), keep the target
 *  file untouched (the safer default for the folder the user pointed at). */
export function mergeCopyList(source: DirFile[], target: DirFile[]): DirFile[] {
	const tgt = byPath(target);
	return source.filter((s) => {
		const t = tgt.get(s.path);
		if (!t) return true;
		if (s.mtime == null || t.mtime == null) return false;
		return s.mtime > t.mtime;
	});
}

/** After a merge, what failed: any source file NOT present in the target, or a copied file whose size
 *  doesn't match. Empty ⇒ the merged folder holds every source file and it's safe to delete the old. */
export function mergeFailures(
	source: DirFile[],
	copied: DirFile[],
	targetAfter: DirFile[]
): string[] {
	const tgt = byPath(targetAfter);
	const fails: string[] = [];
	for (const s of source) if (!tgt.has(s.path)) fails.push(s.path);
	for (const c of copied) {
		const t = tgt.get(c.path);
		if (t && t.size !== c.size) fails.push(c.path);
	}
	return [...new Set(fails)];
}

/** True when `child` is the same as, or nested inside, `parent` — so we never copy a folder into
 *  itself or delete the source out from under a fresh copy. Case-insensitive, separator-agnostic. */
export function isSameOrInside(child: string, parent: string): boolean {
	const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
	const c = norm(child);
	const p = norm(parent);
	return c === p || c.startsWith(p + '/');
}

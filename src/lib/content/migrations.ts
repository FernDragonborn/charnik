/*
 * Forward migration of CONTENT rows across a `#content-schema:` bump (DATA-VER-1, task 6).
 *
 * The unit is a FILE, not a row: the schema version is declared once in the header, so every row in
 * the file is at that version and a step transforms them together (a column split, a renamed value,
 * an id re-slugging — the E3 kebab→snake pass is exactly the shape this would have taken).
 *
 * It is wired up while the registry is EMPTY on purpose, and not as somewhere to put future work:
 * without it a pack declaring a schema this build has never heard of loads in silence and renders
 * whatever its columns happen to mean here. Now that file says so in content health, which is the
 * half that matters before the first migration ever exists.
 *
 * `CONTENT_SCHEMA_VERSION` is the target. Registering a step is: bump the constant, add the
 * `from → transform` entry below for each type the change touches, and re-stamp the shipped CSVs.
 */
import {
	CONTENT_SCHEMA_VERSION,
	migrate,
	type Migration,
	type Versioned,
} from '$lib/schema/version';
import type { ContentType } from './schemas';

/** A file's rows carried together with the version they were authored at. */
export interface VersionedRows extends Versioned {
	rows: Record<string, string>[];
}

/**
 * Per-type migration steps, keyed by the version they upgrade FROM. Empty today: the content schema
 * has never been bumped. A type absent from here has no steps, which is only an error if a file
 * actually declares an older version — `migrate` says so rather than guessing.
 */
export const CONTENT_MIGRATIONS: Partial<
	Record<ContentType, Record<number, Migration<VersionedRows>>>
> = {};

/** What a file's `#content-schema:` said, or the current version when it says nothing. Absent is
 *  treated as current rather than as 0: an unstamped hand-authored CSV is written against TODAY's
 *  columns, and demanding a migration for it would flag every homebrew file ever hand-made. */
export function declaredSchema(value: string | undefined): number {
	const n = Number(value);
	return value === undefined || !Number.isFinite(n) ? CONTENT_SCHEMA_VERSION : n;
}

/** Migration outcome. `error` set ⇒ the rows come back UNTOUCHED and the caller surfaces the reason:
 *  refusing to guess beats loading rows under a shape they were not written for. */
export interface MigrationResult {
	rows: Record<string, string>[];
	error?: string;
}

/** Bring one file's rows up to `CONTENT_SCHEMA_VERSION`. Never throws — the loader's contract is that
 *  a bad file becomes an issue, not an exception. */
export function migrateRows(
	type: ContentType,
	rows: Record<string, string>[],
	from: number,
): MigrationResult {
	if (from === CONTENT_SCHEMA_VERSION) return { rows };
	try {
		const out = migrate<VersionedRows>(
			{ schemaVersion: from, rows },
			CONTENT_MIGRATIONS[type] ?? {},
			CONTENT_SCHEMA_VERSION,
		);
		return { rows: out.rows };
	} catch (e) {
		return { rows, error: e instanceof Error ? e.message : String(e) };
	}
}

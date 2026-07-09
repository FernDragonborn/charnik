/*
 * Test-only helpers for building content rows without the full graph. `makeRow` is the typed
 * replacement for the old `{ … } as unknown as LoadedRow` factories scattered across the content
 * tests: tests name a content type + only the columns under test, and get a properly-typed row.
 */
import type { ContentType, RowData } from './schemas';
import type { LoadedRow, LoadedRowOf } from './loader';

/**
 * Build a `LoadedRow` of type `T` from partial data, for tests. This is the test-data boundary — the
 * ONE sanctioned assertion here stands in for the fact that a test supplies only a few columns (not a
 * full valid model) and the row's identity is synthesised. Everything downstream reads it fully typed.
 * `data` is loose (a test names only the columns under test); the returned ROW is precisely typed.
 */
export function makeRow<T extends ContentType>(
	type: T,
	data: Record<string, unknown> = {},
	source = 'SRD 5.2.1'
): LoadedRow {
	const id = String(data.id ?? data.name_en ?? '');
	// `data` downcasts the loose test input (RowData IS a Record<string, unknown> — a narrowing, not an
	// `unknown` bypass). `row` is a genuine LoadedRowOf<T>; the `as LoadedRow` only works around TS not
	// assigning a generic union member to its own union — no shape is invented.
	const row: LoadedRowOf<T> = {
		type,
		source,
		id,
		effectiveId: `${type}:${source}:${id}`,
		systems: [],
		data: data as RowData<T>,
		root: 'test',
		file: `${type}.csv`
	};
	return row as LoadedRow;
}

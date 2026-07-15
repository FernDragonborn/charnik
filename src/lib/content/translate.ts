/*
 * Translation write-path: save a content row's localized PROSE into its own CSV file, in place.
 *
 * Translations live IN the content file (the `<base>_<loc>` columns — name_uk, text_uk, material_uk,
 * …), NOT in a separate overlay: the file is rewritten with the one row's localized columns filled,
 * and its `#content-hash` is RE-STAMPED so the app's own edit isn't flagged as external drift
 * (DATA-VER-1). Only prose columns of the single matching row change; every other row + column is
 * preserved. Storage-agnostic (same path serves desktop Tauri fs + web IndexedDB); no Svelte/Tauri.
 */
import Papa from 'papaparse';
import type { Storage } from '$lib/storage/types';
import type { LoadedRow } from './loader';
import { parseContentDirectives, stampDirectives } from './meta';
import { hashBody } from './hash';

/** The localizable prose bases a translation can set — kept in sync with the loader's
 *  PROSE_LOCALE_COL (re-attach) and detail.ts's localized read. */
const TRANSLATABLE_BASES = ['name', 'text', 'material', 'higher_level'] as const;

/** Coverage of a row's translation into `locale`, for the list marker: `done` = both the required
 *  prose (name + text) present, `partial` = one of them, `none` = neither. material/higher_level are
 *  optional (not every row has them), so they don't gate the marker. */
export function translationStatus(
	data: Record<string, unknown>,
	locale: string
): 'none' | 'partial' | 'done' {
	const has = (base: string) => {
		const v = data[`${base}_${locale}`];
		return typeof v === 'string' && v.trim() !== '';
	};
	const name = has('name');
	const text = has('text');
	if (name && text) return 'done';
	return name || text ? 'partial' : 'none';
}
type TranslatableBase = (typeof TRANSLATABLE_BASES)[number];
/** base → translated text for one locale (only provided bases are written). */
export type TranslationDraft = Partial<Record<TranslatableBase, string>>;

/**
 * Write `prose` for `locale` into `row`'s CSV file, in place. Returns nothing; throws only if the
 * row is missing from its file (a caller bug). Re-stamps `#content-hash` + `updated-at`.
 */
export async function saveTranslation(
	storage: Storage,
	row: Pick<LoadedRow, 'root' | 'file' | 'id'>,
	locale: string,
	prose: TranslationDraft
): Promise<void> {
	const path = `${row.root}/${row.file}`;
	const raw = await storage.read(path);
	const { directives, body } = parseContentDirectives(raw);
	const parsed = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
	const rows = parsed.data;
	const fields = parsed.meta.fields ? [...parsed.meta.fields] : [];

	const target = rows.find((r) => r.id === row.id);
	if (!target) throw new Error(`saveTranslation: row "${row.id}" not found in ${path}`);

	for (const base of TRANSLATABLE_BASES) {
		const val = prose[base];
		if (val === undefined) continue; // leave untouched bases alone
		const col = `${base}_${locale}`;
		target[col] = val;
		if (!fields.includes(col)) fields.push(col); // new column (e.g. first material_uk) → add to header
	}

	const newBody = Papa.unparse({ fields, data: rows }, { newline: '\r\n' });
	// re-stamp: the app edited the data on purpose, so the recorded hash should follow (no drift nag)
	directives.set('hash', await hashBody(newBody));
	directives.set('updated-at', new Date().toISOString().slice(0, 10));
	await storage.write(path, stampDirectives(directives, newBody));
}

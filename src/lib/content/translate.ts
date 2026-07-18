/*
 * Translation write-path + localization-status derivation: save a content row's localized PROSE and its
 * tracked per-locale STATUS into its own CSV file, in place.
 *
 * Translations live IN the content file (the `<base>_<loc>` columns — name_uk, text_uk, material_uk, …),
 * NOT in a separate overlay: the file is rewritten with the one row's localized columns filled, and its
 * `#content-hash` is RE-STAMPED so the app's own edit isn't flagged as external drift (DATA-VER-1). Only
 * the matching row's touched columns change; every other row + column is preserved. The tracked status
 * rides the same mechanic in a `loc_status_<loc>` column. Storage-agnostic (same path serves desktop
 * Tauri fs + web IndexedDB); no Svelte/Tauri.
 */
import Papa from 'papaparse';
import type { Storage } from '$lib/storage/types';
import type { LoadedRow } from './loader';
import {
	PROSE_BASES,
	LOC_STATUS,
	LOC_STATUS_COL_BASE,
	isLocStatus,
	type ProseBase,
	type LocStatus
} from './schemas';
import { parseContentDirectives, stampDirectives } from './meta';
import { hashBody } from './hash';

/** Prose COVERAGE of a row into `locale` — purely "is the prose physically there?", derived from the
 *  cells. Feeds the l10n-status default (unset status → not_started/started) and the content-health
 *  lint; it is NOT the tracked status the user sets (that's {@link locStatus}). `done` = both required
 *  bases (name + text) present, `partial` = one, `none` = neither. material/higher_level are optional
 *  (not every row has them) so they don't gate coverage. Compared via COVERAGE members, not bare strings. */
export const COVERAGE = { none: 'none', partial: 'partial', done: 'done' } as const;
export type Coverage = (typeof COVERAGE)[keyof typeof COVERAGE];

export function translationCoverage(data: Record<string, unknown>, locale: string): Coverage {
	const has = (base: string) => {
		const v = data[`${base}_${locale}`];
		return typeof v === 'string' && v.trim() !== '';
	};
	const name = has('name');
	const text = has('text');
	if (name && text) return COVERAGE.done;
	return name || text ? COVERAGE.partial : COVERAGE.none;
}

/**
 * The tracked localization status of `data`'s translation into `locale`, for the translate view's list
 * marker + status control. Precedence:
 *   1. `locale` IS the row's source language → always `reviewed` (nothing to translate it into).
 *   2. an explicit `loc_status_<locale>` cell → that status (this is how `machine` / `reviewed` — which
 *      can't be inferred from prose — are known, and the only way to reach `reviewed`).
 *   3. otherwise DERIVE a default from prose coverage: no prose → `not_started`, some → `started`. So a
 *      legacy already-translated row reads `started` (not a false `not_started`) and a pristine row
 *      needs no stored value.
 * A junk cell that isn't a known status falls through to the derived default (never trusted).
 */
export function locStatus(
	data: Record<string, unknown>,
	sourceLang: string,
	locale: string
): LocStatus {
	if (locale === sourceLang) return LOC_STATUS.reviewed;
	const stored = data[`${LOC_STATUS_COL_BASE}_${locale}`];
	if (isLocStatus(stored)) return stored;
	return translationCoverage(data, locale) === COVERAGE.none
		? LOC_STATUS.notStarted
		: LOC_STATUS.started;
}

/** base → translated text for one locale (only provided bases are written). */
export type TranslationDraft = Partial<Record<ProseBase, string>>;

/**
 * Set columns on ONE row in its CSV file, in place: fill the given `columns` on the row whose `id`
 * matches, add any brand-new column to the header, and RE-STAMP `#content-hash` + `updated-at` so the
 * app's own edit isn't seen as external drift. The shared mechanic behind {@link saveTranslation}
 * (prose columns) and {@link saveLocStatus} (the status column). Throws only if the row is missing from
 * its file (a caller bug); `who` names the caller for that error.
 */
async function patchRowColumns(
	storage: Storage,
	row: Pick<LoadedRow, 'root' | 'file' | 'id'>,
	columns: Record<string, string>,
	who: string
): Promise<void> {
	const path = `${row.root}/${row.file}`;
	const raw = await storage.read(path);
	const { directives, body } = parseContentDirectives(raw);
	const parsed = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
	const rows = parsed.data;
	const fields = parsed.meta.fields ? [...parsed.meta.fields] : [];

	const target = rows.find((r) => r.id === row.id);
	if (!target) throw new Error(`${who}: row "${row.id}" not found in ${path}`);

	for (const [col, val] of Object.entries(columns)) {
		target[col] = val;
		if (!fields.includes(col)) fields.push(col); // new column (e.g. first material_uk) → add to header
	}

	const newBody = Papa.unparse({ fields, data: rows }, { newline: '\r\n' });
	// re-stamp: the app edited the data on purpose, so the recorded hash should follow (no drift nag)
	directives.set('hash', await hashBody(newBody));
	directives.set('updated-at', new Date().toISOString().slice(0, 10));
	await storage.write(path, stampDirectives(directives, newBody));
}

/** Write `prose` for `locale` into `row`'s CSV file, in place (only the provided bases). */
export async function saveTranslation(
	storage: Storage,
	row: Pick<LoadedRow, 'root' | 'file' | 'id'>,
	locale: string,
	prose: TranslationDraft
): Promise<void> {
	const columns: Record<string, string> = {};
	for (const base of PROSE_BASES) {
		const val = prose[base];
		if (val === undefined) continue; // leave untouched bases alone
		columns[`${base}_${locale}`] = val;
	}
	await patchRowColumns(storage, row, columns, 'saveTranslation');
}

/** Set the tracked localization `status` for `locale` on `row`, in place (the `loc_status_<locale>`
 *  column). Same in-file + re-stamp mechanic as {@link saveTranslation}. */
export async function saveLocStatus(
	storage: Storage,
	row: Pick<LoadedRow, 'root' | 'file' | 'id'>,
	locale: string,
	status: LocStatus
): Promise<void> {
	await patchRowColumns(
		storage,
		row,
		{ [`${LOC_STATUS_COL_BASE}_${locale}`]: status },
		'saveLocStatus'
	);
}

/*
 * The tracked status of a row's translation into one locale, and the column it is stored in.
 * Beside the schemas rather than in them: the loader, the translate view and the row type all
 * read it, and none of it is a row's shape.
 */
/** Tracked localization status of a row's translation into ONE locale — set in the translate view and
 *  stored per-locale in a `loc_status_<loc>` column (in-file, beside the prose). `reviewed` and
 *  `machine` are set ONLY explicitly; an UNSET column derives a default from prose coverage (no prose →
 *  not_started, some prose → started), so legacy already-translated rows read right and pristine rows
 *  need no write. EXTENSIBLE: add a member here + a marker glyph + a `translate.status.<x>` i18n key and
 *  it appears in the control/marker automatically (both iterate LOC_STATUS_ORDER). Object order =
 *  display order (rawest → done). Compare via the named members, never bare strings. */
export const LOC_STATUS = {
	notStarted: 'not_started',
	machine: 'machine',
	started: 'started',
	/** was translated, and the source prose has moved since — set by `locale-merge.ts`, cleared by hand */
	outdated: 'outdated',
	reviewed: 'reviewed',
} as const;
export type LocStatus = (typeof LOC_STATUS)[keyof typeof LOC_STATUS];

/** The statuses in display order (control buttons + marker legend) — LOC_STATUS insertion order. */
export const LOC_STATUS_ORDER = Object.values(LOC_STATUS);

/** Narrow a raw cell to a known status. Unknown junk (a hand-typed bad value) is NOT a status, so the
 *  reader treats the column as unset and derives the default rather than trusting it. */
export function isLocStatus(value: unknown): value is LocStatus {
	return typeof value === 'string' && (LOC_STATUS_ORDER as readonly string[]).includes(value);
}

/** Column base for the per-locale tracked status (`loc_status_uk`, `loc_status_pt-BR`). One source of
 *  truth shared by the loader re-attach, the translate write path and the column-key type below. */
export const LOC_STATUS_COL_BASE = 'loc_status';

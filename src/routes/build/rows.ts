/*
 * Row lookups and the two slot sentinels the build view-model and its subsystems both need.
 *
 * A LEAF on purpose (§7.4b): the view-model imports `feat-slots`, which needs these, so holding them
 * in the view-model makes the two import each other. It re-exports everything here, so importing
 * either module works.
 */
import { buildDetail, entryMeta, localizedName, localizedProse, type DetailModel } from '$lib/content/detail';
import { app } from '$lib/stores/app.svelte';
import { splitList, type ContentType } from '$lib/content/schemas';

import { titleCase } from '$lib/util/format';
import type { LoadedRow, LoadedRowByType } from '$lib/content/loader';

/** Type guard: is this row of content type `T`? (A predicate is needed — TS won't narrow a union by
 *  a bare `row.type === type` comparison against a generic `T`.) */
function isRowOfType<T extends ContentType>(row: LoadedRow, type: T): row is LoadedRowByType<T> {
	return row.type === type;
}

/** Narrow a looked-up row to a known content type (or undefined if it's a different type / missing).
 *  Lets the build derive read type-specific columns without a cast. */
export function rowOfType<T extends ContentType>(
	row: LoadedRow | undefined,
	type: T
): LoadedRowByType<T> | undefined {
	return row && isRowOfType(row, type) ? row : undefined;
}

/** Localised display name for a content row (falls back to EN). Thin wrapper over the shared
 *  `localizedName` (AUDIT F9) that adds the undefined-row guard + the active-locale default. */
export function rowName(row: LoadedRow | undefined, locale = app.activeLocale): string {
	return row ? localizedName(row, locale) : '';
}

/** Localised body text for a content row (falls back to EN, then empty) — `rowName`'s sibling, for
 *  the sheet blocks that print a feature's or trait's prose straight onto the sheet.
 *
 *  Content prose is markdown, and the sheet renders these as a two-line clamp rather than an
 *  article, so the syntax is stripped rather than rendered: `_Origin Feat_` reading as literal
 *  underscores is worse than losing the emphasis. The full article, markdown intact, is one click
 *  away in the inspector. */
export function rowText(row: LoadedRow | undefined, locale = app.activeLocale): string {
	if (!row) return '';
	return localizedProse(row, 'text', locale)
		.replace(/[*_`]+/g, '')
		.replace(/^#+\s*/gm, '')
		.replace(/\s*\n+\s*/g, ' ')
		.trim();
}

/**
 * The rows whose displayed name contains `query`, case-insensitively — what every builder search box
 * means by typing. One implementation because three had it: the inspector's option list, the
 * sectioned picker's sections, and the language chips.
 *
 * An empty query returns the list untouched, so a caller never has to special-case it.
 */
export function filterByName<T extends LoadedRow>(rows: T[], query: string): T[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return rows;
	return rows.filter((row) => rowName(row).toLowerCase().includes(needle));
}

/**
 * The article model for a row, in the locale the UI is being read in.
 *
 * `buildDetail` takes a locale because the compendium and the translator pass their own; everything
 * in the builder means "the one the user is reading", and four places said so a character at a time.
 */
export const rowDetail = (row: LoadedRow | undefined, type: ContentType): DetailModel | null =>
	row ? buildDetail(row, type, undefined, app.activeLocale) : null;

/** The catalog lookup a formatter needs, passed in rather than reached for: this module has no
 *  component to read `$_` from, and the units phrasing is a translated sentence. */
type Translate = (
	key: string,
	options?: { values?: Record<string, string | number>; default?: string },
) => string;

/**
 * A skill id as a person reads it. The catalog is the source; `titleCase` is the fallback so a
 * homebrew pack shipping a nineteenth skill reads as a name rather than as its own key.
 */
export const skillLabel = (id: string, t: Translate): string =>
	t(`skillName.${id}`, { default: titleCase(id) });

/**
 * The one line of meta a picker entry carries under (or beside) its name.
 *
 * A grid cell is the whole entry — there is no hover teaser behind it, because what a teaser would
 * have said fits here (ui.md §3). Every value comes from a DECLARED column; a type with nothing
 * short to say gets nothing, never a sentence mined out of its prose.
 */
export function pickerMeta(row: LoadedRow, t: Translate): string {
	/** A snake_case enum value as a person reads it. Takes the column's own type rather than
	 *  `unknown`: `String(anything)` on a column that turned out to be an object prints
	 *  `[object Object]` into the UI, and only the type-aware lint catches that. */
	const label = (value: string | undefined) => titleCase(value ?? '');
	if (row.type === 'class')
		return [row.data.hit_die, row.data.saves.map((s) => s.toUpperCase()).join(', ')]
			.filter(Boolean)
			.join(' · ');
	// the same sentence the sheet's own origin card prints, so a species reads identically in both
	if (row.type === 'species')
		return t('build.origin.speciesMeta', {
			values: { size: label(row.data.size), feet: row.data.speed, metres: Math.round(row.data.speed * 0.3) },
		});
	if (row.type === 'background') return splitList(row.data.skills).map(label).join(', ');
	if (row.type === 'feat') return label(row.data.category);
	// the item picker groups BY category, so repeating it on every row of its own section says
	// nothing; rarity is the part that still differs inside one
	if (row.type === 'item') return label(row.data.rarity);
	return entryMeta(row);
}

/** Sentinel a feat slot holds when the choice is an Ability Score Improvement (not a feat). */
export const ASI = '__asi__';
/** The SRD feat id representing an ASI — filtered out of the feat picker (handled as boosts). */
export const ASI_FEAT_ID = 'ability_score_improvement';

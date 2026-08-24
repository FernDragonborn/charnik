/*
 * The multi-locale NAME projection — the one place "what is this row called, and in which
 * languages" is answered. Two surfaces depend on it agreeing with itself: the compendium search
 * indexes every locale's name so a match in any language finds the row, and the roller's suggestion
 * menu resolves a typed word the same way. Two copies of this would be two answers to one question.
 */
import { LOCALE_TAG, type ContentGraph, type LoadedRow } from './loader';

/** Locale column grammar, name half only — what `localesOf` discovers the locale list from. */
const NAME_LOCALE_COL = new RegExp(`^name_(${LOCALE_TAG})$`);

/** The name to SHOW out of a locale→name map: the active locale, else English, else whatever there
 *  is. Empty only when the row is named in no language at all. */
export const localizedName = (names: Record<string, string>, locale: string): string =>
	names[locale] || names.en || Object.values(names)[0] || '';

/** Every locale a row is NAMED in → its name there, empty columns skipped so `localizedName`'s
 *  fallback chain only ever sees real translations. `locales` is what to look for — usually
 *  `localesOf(graph)`, so a locale present only in homebrew is still found. */
export function namesByLocale(row: LoadedRow, locales: Iterable<string>): Record<string, string> {
	const names: Record<string, string> = {};
	for (const locale of locales) {
		const value = row.data[`name_${locale}`];
		if (value) names[locale] = String(value);
	}
	return names;
}

/** The locales the DATA actually carries (from its `name_*` columns); always includes `en`. Data-
 *  driven, never a hardcoded list — a user dropping in a `name_de` column becomes searchable and
 *  roller-typeable for free. */
export function localesOf(graph: ContentGraph): string[] {
	const set = new Set(['en']);
	for (const r of graph.rows)
		for (const k of Object.keys(r.data)) {
			const m = NAME_LOCALE_COL.exec(k);
			if (m?.[1]) set.add(m[1]);
		}
	return [...set];
}

/*
 * Reading a content row's PROSE — the localized text itself, and the same text with its markdown
 * stripped for the sheets that print it as running text.
 *
 * Split out of `detail.ts` because the article MODEL and "what does this row say" are two jobs: the
 * override layer (`overrides.svelte.ts`) needs the second without the first, and the sheets that
 * print a feature's text never build a `DetailModel` at all. The read itself stays ONE rule, so a row
 * says the same thing wherever it is printed.
 */
import type { LoadedRow } from './loader';
import { asText } from '../util/format';

/** A cell's text: a list column joins, anything else goes through the shared `asText` (so an object
 *  from a homebrew cell renders empty rather than "[object Object]"). */
export const cellText = (v: unknown): string =>
	Array.isArray(v) ? v.map((x: unknown) => asText(x)).join(', ') : asText(v);

/** A localized prose CELL: target locale → en → a legacy bare column (so pre-localization data like
 *  a plain `material` still renders). */
export const localizedCell = (
	data: Record<string, unknown>,
	base: string,
	locale: string,
): string => cellText(data[`${base}_${locale}`] ?? data[`${base}_en`] ?? data[base]);

/** The same read, given a ROW — what every surface that renders a row's text calls. */
export const localizedProse = (row: LoadedRow, base: string, locale: string): string =>
	localizedCell(row.data, base, locale);

/** A row's prose with its markdown syntax STRIPPED rather than rendered — for the sheets that print
 *  a feature's or trait's text as plain running text. `_Origin Feat_` reading as literal underscores
 *  is worse than losing the emphasis, and neither sheet is an article renderer. */
export const plainProse = (row: LoadedRow, locale: string): string =>
	stripProse(localizedProse(row, 'text', locale));

/** The strip itself, over prose that did not come from a row — a player's own words go through the
 *  same rule, or their rewrite would print asterisks where the shipped text prints none. */
export const stripProse = (prose: string): string =>
	prose
		.replace(/[*_`]+/g, '')
		.replace(/^#+\s*/gm, '')
		.replace(/\s*\n+\s*/g, ' ')
		.trim();

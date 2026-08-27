/*
 * Row lookups and the two slot sentinels the build view-model and its subsystems both need.
 *
 * A LEAF on purpose (§7.4b): the view-model imports `feat-slots`, which needs these, so holding them
 * in the view-model makes the two import each other. It re-exports everything here, so importing
 * either module works.
 */
import { localizedName, localizedProse } from '$lib/content/detail';
import { app } from '$lib/stores/app.svelte';
import type { ContentType } from '$lib/content/schemas';
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

/** Sentinel a feat slot holds when the choice is an Ability Score Improvement (not a feat). */
export const ASI = '__asi__';
/** The SRD feat id representing an ASI — filtered out of the feat picker (handled as boosts). */
export const ASI_FEAT_ID = 'ability_score_improvement';

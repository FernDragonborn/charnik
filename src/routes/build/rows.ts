/*
 * Row lookups and the two slot sentinels the build view-model and its subsystems both need.
 *
 * A LEAF on purpose (§7.4b): the view-model imports `feat-slots`, which needs these, so holding them
 * in the view-model makes the two import each other. It re-exports everything here, so importing
 * either module works.
 */
import { entryMeta, localizedName, localizedProse } from '$lib/content/detail';
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

/** The catalog lookup a formatter needs, passed in rather than reached for: this module has no
 *  component to read `$_` from, and the units phrasing is a translated sentence. */
type Translate = (key: string, options?: { values?: Record<string, string | number> }) => string;

/**
 * The one line of meta a picker entry carries under (or beside) its name.
 *
 * A grid cell is the whole entry — there is no hover teaser behind it, because what a teaser would
 * have said fits here (ui.md §3). Every value comes from a DECLARED column; a type with nothing
 * short to say gets nothing, never a sentence mined out of its prose.
 */
export function pickerMeta(row: LoadedRow, t: Translate): string {
	/** A snake_case enum value as a person reads it. */
	const label = (value: unknown) => titleCase(String(value ?? '').replace(/_/g, ' '));
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

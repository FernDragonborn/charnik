/*
 * Compendium grouping + filtering — per content type. Every type gets its own primary
 * groupings (spells by level, monsters by CR, …) plus a universal "Source" grouping and an
 * "A–Z" fallback; and a primary filter facet plus the always-present Source filter. Pure —
 * the page just drives these.
 */
import { rowName, type LoadedRow } from './loader';
import { titleCase } from '$lib/util/format';
import type { Translate } from '$lib/i18n';
import { SYSTEMS, type ContentType } from './schemas';
import { sourceLabel } from './detail';
import { HOMEBREW_SOURCE } from './homebrew';

/** A homebrew row ranks ABOVE a shipped one — so a fork-to-homebrew edit always sits above the SRD
 *  original it overrides (the decided collision default: coexist, don't hide — PLAN Editor mode). */
const homebrewRank = (r: LoadedRow) => (r.source === HOMEBREW_SOURCE ? 0 : 1);

/** Homebrew-first, then A–Z — for the flat "A–Z" grouping (which already sorted by name). */
const compareRows = (a: LoadedRow, b: LoadedRow): number =>
	homebrewRank(a) - homebrewRank(b) || rowName(a).localeCompare(rowName(b));

/** Float homebrew rows to the top of a group while PRESERVING the existing relative order otherwise
 *  (JS sort is stable) — so grouped views only change when a homebrew row is present, never reshuffle
 *  the shipped order. */
const homebrewFirst = (rows: LoadedRow[]): LoadedRow[] =>
	[...rows].sort((a, b) => homebrewRank(a) - homebrewRank(b));

/** How new a row's edition is. SYSTEMS is ordered oldest→newest, so its index IS the ranking and no
 *  edition id is named here — a `'5.5e' ===` test would be the 5e-ism docs/internals/compatibility.md warns of. */
const editionRank = (r: LoadedRow): number =>
	Math.max(-1, ...r.systems.map((s) => (SYSTEMS as readonly string[]).indexOf(s)));

/**
 * Comparator for a BROWSE list: by displayed name, newest edition first within an article's pair.
 *
 * A list view must apply this itself. `groupRows` only sorts stably on one key, so a list that skips
 * it renders raw graph order — which is file order, and that looks alphabetical only by accident of
 * how the SRD CSVs happen to be written; a homebrew file (rows appended as authored) or any content
 * pack ordered differently renders unsorted. Newest-edition-first used to fall out of the order the
 * content roots happened to load in; it is said out loud here instead, in the layer that cares.
 * Sort the whole pool BEFORE any cap, so the visible window is the first N by name, not a slice of
 * an arbitrary order.
 */
export const byDisplayName =
	(nameOf: (row: LoadedRow) => string, locale?: string) =>
	(a: LoadedRow, b: LoadedRow): number =>
		nameOf(a).localeCompare(nameOf(b), locale) || editionRank(b) - editionRank(a);

export interface Grouping {
	key: string;
	/** The catalog key for the label. A grouping is named by what it groups BY, which is the app's own
	 *  vocabulary — and this module is pure and has no locale, so the view says the word. Most read
	 *  from `contentField`, the same catalog the homebrew form labels its inputs from; the three that
	 *  do not are display choices rather than column names (an item's `category` reads as "Type"). */
	labelKey: string;
}

/** Type-specific groupings (Source + A–Z are appended for every type). */
const GROUPINGS: Partial<Record<ContentType, Grouping[]>> = {
	spell: [
		{ key: 'level', labelKey: 'contentField.level' },
		{ key: 'school', labelKey: 'contentField.school' },
	],
	monster: [
		{ key: 'cr', labelKey: 'contentField.cr' },
		{ key: 'creature_type', labelKey: 'compendium.groupByType' },
	],
	item: [
		// `category` carries the kind since ITEM-TAGS folded `item_type` away — and it groups better
		// than that column ever did, which had 54 distinct values because magic rows held prose in it.
		{ key: 'category', labelKey: 'compendium.groupByType' },
		{ key: 'rarity', labelKey: 'contentField.rarity' },
	],
	class_feature: [{ key: 'class_id', labelKey: 'contentField.class_id' }],
	feat: [{ key: 'category', labelKey: 'contentField.category' }],
	background: [{ key: 'source', labelKey: 'contentField.source' }],
	species: [{ key: 'source', labelKey: 'contentField.source' }],
	species_option: [{ key: 'species_id', labelKey: 'compendium.groupBySpecies' }],
	language: [{ key: 'category', labelKey: 'contentField.category' }],
};

/** The primary filter facet for a type (Source is always offered on top of this). */
const FACET: Partial<Record<ContentType, Grouping>> = {
	spell: { key: 'school', labelKey: 'contentField.school' },
	monster: { key: 'creature_type', labelKey: 'compendium.groupByType' },
	item: { key: 'rarity', labelKey: 'contentField.rarity' },
	feat: { key: 'category', labelKey: 'contentField.category' },
	class_feature: { key: 'class_id', labelKey: 'contentField.class_id' },
};

const cap = (s: string) => titleCase(s);

export function groupingsFor(type: ContentType): Grouping[] {
	const base = GROUPINGS[type] ?? [];
	const out = [...base];
	if (!out.some((g) => g.key === 'source'))
		out.push({ key: 'source', labelKey: 'contentField.source' });
	out.push({ key: 'none', labelKey: 'compendium.groupByAZ' });
	return out;
}

export function facetFor(type: ContentType): Grouping | null {
	return FACET[type] ?? null;
}

// The grouping/facet key is a runtime config string, so `r.data` is a union with no shared index —
// scan entries (rather than index by a dynamic key) to read the cell type-safely, no cast.
const fieldVal = (r: LoadedRow, key: string): string => {
	for (const [column, v] of Object.entries(r.data))
		if (column === key)
			return v == null || v === '' ? '' : String(Array.isArray(v) ? v.join(', ') : v);
	return '';
};

/** Distinct non-empty values of a field across rows (for filter chips), sorted. */
export function distinctValues(rows: LoadedRow[], key: string): string[] {
	const set = new Set<string>();
	for (const r of rows) {
		const v = fieldVal(r, key);
		if (v) set.add(v);
	}
	return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** CR sorts numerically (with 1/8 < 1/4 < 1/2 < 1); spell levels ascending; else A–Z. */
const crValue = (s: string) =>
	s.includes('/') ? Number(s.split('/')[0]) / Number(s.split('/')[1]) : Number(s);

/** Group rows by the chosen key into labelled buckets, ordered sensibly.
 *
 *  Takes the translator rather than answering with keys: a heading is a WORD composed with a value
 *  (a spell level, a CR) as often as it is the bucket's own data, and a caller that got back
 *  `{key, values} | string` would have to re-decide which of the two it was holding. */
export function groupRows(
	rows: LoadedRow[],
	key: string,
	type: ContentType,
	t: Translate,
): { label: string; rows: LoadedRow[] }[] {
	if (key === 'none') {
		return [{ label: '', rows: [...rows].sort(compareRows) }];
	}
	const buckets = new Map<string, LoadedRow[]>();
	for (const r of rows) {
		const raw = key === 'source' ? r.source : fieldVal(r, key);
		const k = raw || '—';
		const bucket = buckets.get(k) ?? [];
		bucket.push(r);
		buckets.set(k, bucket);
	}
	const keys = [...buckets.keys()];
	if (type === 'spell' && key === 'level') keys.sort((a, b) => Number(a) - Number(b));
	else if (type === 'monster' && key === 'cr') keys.sort((a, b) => crValue(a) - crValue(b));
	else keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

	const label = (k: string) => {
		if (type === 'spell' && key === 'level')
			return k === '0'
				? t('spellLevel.cantrips')
				: t('spellLevel.group', { values: { level: Number(k) } });
		if (type === 'monster' && key === 'cr') return t('compendium.groupCR', { values: { cr: k } });
		if (key === 'source') return sourceLabel(k);
		// a bucket's own value is DATA — a homebrew school reads exactly as its author wrote it
		return cap(k);
	};
	return keys.map((k) => ({ label: label(k), rows: homebrewFirst(buckets.get(k) ?? []) }));
}

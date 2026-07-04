/*
 * Compendium grouping + filtering — per content type. Every type gets its own primary
 * groupings (spells by level, monsters by CR, …) plus a universal "Source" grouping and an
 * "A–Z" fallback; and a primary filter facet plus the always-present Source filter. Pure —
 * the page just drives these.
 */
import type { LoadedRow } from './loader';
import type { ContentType } from './schemas';
import { sourceLabel } from './detail';

export interface Grouping {
	key: string;
	label: string;
}

/** Type-specific groupings (Source + A–Z are appended for every type). */
const GROUPINGS: Partial<Record<ContentType, Grouping[]>> = {
	spell: [
		{ key: 'level', label: 'Level' },
		{ key: 'school', label: 'School' }
	],
	monster: [
		{ key: 'cr', label: 'CR' },
		{ key: 'creature_type', label: 'Type' }
	],
	item: [
		{ key: 'item_type', label: 'Type' },
		{ key: 'rarity', label: 'Rarity' }
	],
	class_feature: [{ key: 'class_id', label: 'Class' }],
	feat: [{ key: 'category', label: 'Category' }],
	background: [{ key: 'source', label: 'Source' }],
	species: [{ key: 'source', label: 'Source' }],
	species_option: [{ key: 'species_id', label: 'Species' }],
	language: [{ key: 'category', label: 'Category' }]
};

/** The primary filter facet for a type (Source is always offered on top of this). */
const FACET: Partial<Record<ContentType, Grouping>> = {
	spell: { key: 'school', label: 'School' },
	monster: { key: 'creature_type', label: 'Type' },
	item: { key: 'rarity', label: 'Rarity' },
	feat: { key: 'category', label: 'Category' },
	class_feature: { key: 'class_id', label: 'Class' }
};

const cap = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const ordinal = (n: number) =>
	`${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;

export function groupingsFor(type: ContentType): Grouping[] {
	const base = GROUPINGS[type] ?? [];
	const out = [...base];
	if (!out.some((g) => g.key === 'source')) out.push({ key: 'source', label: 'Source' });
	out.push({ key: 'none', label: 'A–Z' });
	return out;
}

export function facetFor(type: ContentType): Grouping | null {
	return FACET[type] ?? null;
}

const fieldVal = (r: LoadedRow, key: string): string => {
	const v = r.data[key];
	return v == null || v === '' ? '' : String(Array.isArray(v) ? v.join(', ') : v);
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

/** Group rows by the chosen key into labelled buckets, ordered sensibly. */
export function groupRows(
	rows: LoadedRow[],
	key: string,
	type: ContentType
): { label: string; rows: LoadedRow[] }[] {
	if (key === 'none') {
		return [
			{
				label: '',
				rows: [...rows].sort((a, b) => String(a.data.name_en).localeCompare(String(b.data.name_en)))
			}
		];
	}
	const buckets = new Map<string, LoadedRow[]>();
	for (const r of rows) {
		const raw = key === 'source' ? r.source : fieldVal(r, key);
		const k = raw || '—';
		(buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r);
	}
	const keys = [...buckets.keys()];
	if (type === 'spell' && key === 'level') keys.sort((a, b) => Number(a) - Number(b));
	else if (type === 'monster' && key === 'cr') keys.sort((a, b) => crValue(a) - crValue(b));
	else keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

	const label = (k: string) => {
		if (type === 'spell' && key === 'level')
			return k === '0' ? 'Cantrips' : `${ordinal(Number(k))} level`;
		if (type === 'monster' && key === 'cr') return `CR ${k}`;
		if (key === 'source') return sourceLabel(k);
		return cap(k);
	};
	return keys.map((k) => ({ label: label(k), rows: buckets.get(k)! }));
}

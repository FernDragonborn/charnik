/*
 * Global fuzzy search over the content graph. Two Fuse indexes with different rebuild
 * triggers (see the plan):
 *  - nameIndex: over every locale's name (cross-language), rebuilt only on content change.
 *  - textIndex: over the active-locale-or-EN article text, rebuilt on content OR locale
 *    change. Edition is never part of an index — it's a cheap post-filter on results, so
 *    toggling editions never rebuilds anything.
 * Both are blind projections over `graph.rows`, so any new type/homebrew/edition is searchable
 * automatically.
 */
import Fuse, { type FuseResultMatch } from 'fuse.js';
import { LOCALE_TAG, type ContentGraph, type LoadedRow } from './loader';
import { isBrowsable, type ContentType } from './schemas';

export interface NameDoc {
	effectiveId: string;
	type: ContentType;
	id: string;
	source: string;
	systems: string[];
	names: Record<string, string>; // locale → name (for display)
	nameAll: string[]; // every locale's name (indexed key)
}
export interface TextDoc {
	effectiveId: string;
	type: ContentType;
	id: string;
	source: string;
	systems: string[];
	names: Record<string, string>;
	text: string; // active-locale-or-EN, plain text
}

export interface SearchResult {
	effectiveId: string;
	type: ContentType;
	id: string;
	source: string; // disambiguates same-slug rows across editions/sources in the deep-link
	systems: string[];
	name: string; // display name in the active locale (EN fallback)
	snippet: string; // set for text-only matches
}

/** Strip HTML tags + markdown markers so matches hit prose, not markup. */
export const plainText = (s: string) =>
	s
		.replace(/<[^>]+>/g, ' ')
		.replace(/[*_#>`~|]+/g, ' ')
		.replace(/&[a-z]+;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** Locales present in the data (from `name_*` columns); always includes `en`. */
// F11: the ONE locale grammar (was `[a-z]{2,3}` — subtag locales like pt-BR were unsearchable)
const NAME_LOCALE_COL = new RegExp(`^name_(${LOCALE_TAG})$`);
function localesOf(graph: ContentGraph): string[] {
	const set = new Set(['en']);
	for (const r of graph.rows)
		for (const k of Object.keys(r.data)) {
			const m = NAME_LOCALE_COL.exec(k);
			if (m?.[1]) set.add(m[1]);
		}
	return [...set];
}

const base = (r: LoadedRow) => ({
	effectiveId: r.effectiveId,
	type: r.type,
	id: r.id,
	source: r.source,
	systems: r.systems
});

// Both index projections carry every locale's name (not just the active one) so a name match in ANY
// language surfaces the row and the UI can still show the active-locale label. Empty columns are
// skipped so `displayName`'s fallback chain sees only real translations.
function displayNamesByLocale(row: LoadedRow, locales: string[]): Record<string, string> {
	const names: Record<string, string> = {};
	for (const locale of locales) {
		const value = row.data[`name_${locale}`];
		if (value) names[locale] = String(value);
	}
	return names;
}

function buildNameDocs(graph: ContentGraph): NameDoc[] {
	const locales = localesOf(graph);
	return graph.rows
		.filter((r) => isBrowsable(r.type))
		.map((r) => {
			const names = displayNamesByLocale(r, locales);
			return { ...base(r), names, nameAll: [...new Set(Object.values(names))] };
		});
}

function buildTextDocs(graph: ContentGraph, locale: string): TextDoc[] {
	const locales = localesOf(graph);
	return graph.rows
		.filter((r) => isBrowsable(r.type))
		.map((r) => ({
			...base(r),
			names: displayNamesByLocale(r, locales),
			text: plainText(String(r.data[`text_${locale}`] || r.data.text_en || ''))
		}));
}

const OPTS = {
	ignoreLocation: true,
	minMatchCharLength: 3,
	includeMatches: true,
	includeScore: true
};

export const makeNameIndex = (graph: ContentGraph) =>
	new Fuse(buildNameDocs(graph), { ...OPTS, threshold: 0.3, keys: ['nameAll'] });

export const makeTextIndex = (graph: ContentGraph, locale: string) =>
	new Fuse(buildTextDocs(graph, locale), { ...OPTS, threshold: 0.34, keys: ['text'] });

const displayName = (names: Record<string, string>, locale: string) =>
	names[locale] || names.en || Object.values(names)[0] || '';

function snippetFor(text: string, matches: readonly FuseResultMatch[] | undefined): string {
	const m = matches?.find((x) => x.key === 'text');
	const at = m?.indices?.[0]?.[0] ?? 0;
	const start = Math.max(0, at - 24);
	const s = text.slice(start, start + 72).trim();
	return (start > 0 ? '…' : '') + s + (start + 72 < text.length ? '…' : '');
}

export interface SearchOpts {
	editions: string[];
	locale: string;
	limit?: number;
}

/** Project a matched doc into a result row. `snippet` is empty for name matches and a text excerpt
 *  for text matches — the only field that differs between the two index passes. */
const toSearchResult = (doc: NameDoc | TextDoc, locale: string, snippet: string): SearchResult => ({
	effectiveId: doc.effectiveId,
	type: doc.type,
	id: doc.id,
	source: doc.source,
	systems: doc.systems,
	name: displayName(doc.names, locale),
	snippet
});

/** name hits first, then text-only hits (deduped), post-filtered to active editions. */
export function searchContent(
	nameIndex: Fuse<NameDoc>,
	textIndex: Fuse<TextDoc>,
	query: string,
	{ editions, locale, limit = 30 }: SearchOpts
): SearchResult[] {
	const q = query.trim();
	if (q.length < 2) return [];
	const inEdition = (systems: string[]) => systems.some((s) => editions.includes(s));
	// Name pass runs first and wins on collision (deduped by effectiveId), so a name match keeps its
	// empty snippet even if the same row also matches on text — name relevance beats a text excerpt.
	const out = new Map<string, SearchResult>();

	for (const h of nameIndex.search(q, { limit })) {
		const d = h.item;
		if (!inEdition(d.systems) || out.has(d.effectiveId)) continue;
		out.set(d.effectiveId, toSearchResult(d, locale, ''));
	}
	for (const h of textIndex.search(q, { limit })) {
		const d = h.item;
		if (!inEdition(d.systems) || out.has(d.effectiveId)) continue;
		out.set(d.effectiveId, toSearchResult(d, locale, snippetFor(d.text, h.matches)));
	}
	return [...out.values()].slice(0, limit);
}

/*
 * What the orphan-draft dialog shows of a draft whose entry is gone: the draft's own fields beside
 * the entry it may be tied to, and that entry's list ordered by how close each candidate is to what
 * the draft was editing. Pure, so the dialog stays a thin view over it.
 */
import { cellText } from '#lib/content/prose.ts';
import { foldForSearch } from '#lib/util/search-fold.ts';

/** Columns that are a row's identity, its prose or its mechanics rather than a fact a person reads at
 *  a glance: the prose is shown as prose, and the rest would only be noise in a two-column grid. */
const NOT_A_FIELD = /^(id|systems|effects|(name|text|higher_level|material)(_[a-z-]+)?)$/;

/** How many fields the grid shows — enough to recognise the entry, few enough to read at a glance. */
const FIELD_LIMIT = 8;

export interface DraftField {
	column: string;
	value: string;
}

/** The draft's readable fields, in its own column order, the empty ones left out. */
export function draftFields(data: Record<string, unknown>): DraftField[] {
	const fields: DraftField[] = [];
	for (const [column, raw] of Object.entries(data)) {
		if (NOT_A_FIELD.test(column)) continue;
		const value = cellText(raw).trim();
		if (value) fields.push({ column, value });
		if (fields.length === FIELD_LIMIT) break;
	}
	return fields;
}

/** The words a name or an id is made of, folded the way search folds them. */
const wordsOf = (text: string): string[] =>
	foldForSearch(text)
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word.length > 1);

/** How many words a candidate shares with what the draft was editing — its old id and its name. */
export function closeness(was: readonly string[], candidate: readonly string[]): number {
	const wanted = new Set(was.flatMap(wordsOf));
	return new Set(candidate.flatMap(wordsOf))
		.values()
		.filter((word) => wanted.has(word))
		.toArray().length;
}

/** Candidates, closest first; ties keep the order they came in. */
export function byCloseness<R>(
	candidates: readonly R[],
	was: readonly string[],
	wordsOfCandidate: (row: R) => string[],
): { rows: R[]; closest: R | null } {
	const scored = candidates.map((row, at) => ({
		row,
		at,
		score: closeness(was, wordsOfCandidate(row)),
	}));
	scored.sort((a, b) => b.score - a.score || a.at - b.at);
	const first = scored[0];
	return { rows: scored.map((s) => s.row), closest: first && first.score > 0 ? first.row : null };
}

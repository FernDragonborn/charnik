/*
 * Do the resource JOINS resolve? — the check `resource_option.resource_id` never had.
 *
 * A pool is declared by a `grant_resource:<id>:…` token on whatever grants it (a class feature, a
 * feat, an item). Two other things REFER to that id: a `resource_option` row, which is the spend the
 * pool pays for, and a `resource` row, which is what the pool is called. Neither reference was
 * checked against anything — a typo'd `resource_id` made the option silently never appear, with no
 * diagnostic anywhere, while `spell_lists` has had exactly this check (and a "did you mean") since
 * it was written.
 *
 * It lives HERE rather than in the loader because answering it means reading inside an effect token,
 * and the loader is deliberately independent of the removable effects engine (CLAUDE.md). A
 * content-health pass may import it — and does, so the ids come from `parseToken`, not from a second
 * regex that would drift from the grammar.
 */
import { parseToken, splitGuard } from '$lib/effects/token-parser';
import { didYouMean } from '$lib/util/suggest';
import type { ContentGraph, LoadedRow } from './loader';
import { tokensOf } from './loader';

/** One unresolved reference, in the shape the content-health panel renders. */
export interface JoinIssue {
	/** `root/file` of the row that points at nothing. */
	file: string;
	id: string;
	message: string;
	detail: string;
}

/** Every pool id something in this edition actually GRANTS. */
export function grantedPoolIds(graph: ContentGraph, system: string): Set<string> {
	const out = new Set<string>();
	for (const row of graph.rows) {
		if (!row.systems.includes(system)) continue;
		for (const token of tokensOf(row)) {
			// `splitGuard` FIRST: a guarded grant (`is_raging ? grant_resource:…`) parses to `unknown`
			// otherwise, and the pool would look ungranted — turning a working option into a false
			// report, which is the one thing a checker like this must never do
			const id = parseToken(splitGuard(token).token).resource?.id;
			if (id !== undefined) out.add(id);
		}
	}
	return out;
}

const where = (row: LoadedRow): string => `${row.root}/${row.file}`;

/**
 * Rows that name a resource pool nothing grants. Both directions, because both are the same slip
 * with different consequences: an OPTION that can never be offered, and a NAME that will never be
 * read. Empty when the graph has no resource content at all — a pack without pools isn't broken.
 */
export function resourceJoinIssues(graph: ContentGraph, system: string): JoinIssue[] {
	const granted = grantedPoolIds(graph, system);
	if (granted.size === 0) return [];
	const out: JoinIssue[] = [];
	for (const row of graph.rows) {
		if (!row.systems.includes(system)) continue;
		if (row.type !== 'resource_option' && row.type !== 'resource') continue;
		const referenced = row.type === 'resource_option' ? String(row.data.resource_id) : row.id;
		if (granted.has(referenced)) continue;
		const hint = didYouMean(referenced, granted);
		out.push({
			file: where(row),
			id: row.id,
			message:
				row.type === 'resource_option'
					? `This option spends a resource nothing gives the character, so it never appears${hint || '. Check the id against the feature that grants the pool.'}`
					: `This names a resource nothing gives the character, so the name is never used${hint || '. Check the id against the feature that grants the pool.'}`,
			detail: `${row.type === 'resource_option' ? 'resource_id' : 'id'} "${referenced}"`,
		});
	}
	return out;
}

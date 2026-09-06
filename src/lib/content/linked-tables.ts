/*
 * Which article owns which LINKED TABLE. A class, a subclass, a species and a resource say almost
 * nothing on their own row — their mechanical content lives in a second table joined by a foreign
 * key (`content.md` ▸ nested data uses linked tables, not JSON in a cell). So authoring one of these
 * from the UI and stopping there leaves a row that can never be given any content, which is the
 * shape of unfinished a user only discovers after doing the work (HOMEBREW-LINKED).
 *
 * Pure: the table of links, the query over it, and the draft a new child row starts from.
 * `LinkedRows` is the markup over these — so the join rules are node-testable without a component.
 */
import type { ContentType } from './schemas';
import type { ContentGraph, LoadedRow } from './loader';
import { localizedName } from './detail';
import { asText } from '$lib/util/format';

export interface LinkSpec {
	/** The type whose rows belong to this article. */
	child: ContentType;
	/** The child column naming the parent row. */
	fk: string;
	/** Parent columns copied onto a new child row, so the joins a person cannot guess are filled
	 *  (a subclass feature also needs the `class_id` the subclass itself carries). */
	carry?: readonly string[];
	/** A child column that must be EMPTY for the parent to own the row: a class's own features are
	 *  the ones no subclass has claimed, or a class article would list every subclass's rows too. */
	unclaimed?: string;
	/** Column seeded on a new child row, because the schema requires it and blank is not valid. */
	seed?: Readonly<Record<string, string>>;
}

export const LINKED_TABLES: Partial<Record<ContentType, LinkSpec>> = {
	class: { child: 'class_feature', fk: 'class_id', unclaimed: 'subclass_id', seed: { level: '1' } },
	subclass: {
		child: 'class_feature',
		fk: 'subclass_id',
		carry: ['class_id'],
		seed: { level: '1' },
	},
	species: { child: 'species_option', fk: 'species_id' },
	resource: { child: 'resource_option', fk: 'resource_id' },
};

/** The linked table this row owns, if any. */
export const linkOf = (row: LoadedRow): LinkSpec | undefined => LINKED_TABLES[row.type];

/** A linked row's level, when its table has one (class features read in level order); else 0. */
export const linkedLevel = (row: LoadedRow): number =>
	Number((row.data as Record<string, unknown>).level) || 0;

/**
 * The rows of `parent`'s linked table, in reading order. Matched on edition OVERLAP rather than
 * source equality — a homebrew feature written for the SRD cleric carries its own source tag and
 * must still attach (`loader.ts` ▸ featuresForClass says why).
 */
export function linkedRowsOf(graph: ContentGraph, parent: LoadedRow, locale = 'en'): LoadedRow[] {
	const link = linkOf(parent);
	if (!link) return [];
	return graph
		.list(link.child)
		.filter((r) => {
			const data = r.data as Record<string, unknown>;
			return (
				data[link.fk] === parent.id &&
				(!link.unclaimed || !data[link.unclaimed]) &&
				r.systems.some((s) => parent.systems.includes(s))
			);
		})
		.sort(
			(a, b) =>
				linkedLevel(a) - linkedLevel(b) ||
				localizedName(a, locale).localeCompare(localizedName(b, locale), locale),
		);
}

/** The draft a new linked row starts from: the joins the user cannot guess, plus the parent's
 *  editions and whatever the child's schema requires non-blank. */
export function linkedPrefill(parent: LoadedRow): Record<string, string> {
	const link = linkOf(parent);
	if (!link) return {};
	const data = parent.data as Record<string, unknown>;
	return {
		...Object.fromEntries((link.carry ?? []).map((c) => [c, asText(data[c])])),
		...(link.seed ?? {}),
		[link.fk]: parent.id,
		systems: parent.systems.join(','),
	};
}

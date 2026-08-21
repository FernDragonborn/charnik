/*
 * What a resource pool is CALLED (RES-NAME).
 *
 * `grant_resource:<id>:…` names a pool by ID, and the id is identity: the key in
 * `play.resourcesSpent` on disk and what `resource_option.resource_id` joins to. It is NOT a name —
 * the engine only ever title-cased it, which is wrong the moment the two differ. In the shipped SRD
 * they already do: 2024's monk pool is granted as `focus` by the feature "Monk's Focus" and the
 * rules call it **Focus Points**; `bardic_inspiration` is granted by two different features, so no
 * granting feature can own the name either.
 *
 * So the name comes from a `resource` content row, which also makes it translatable — a name
 * computed inside the engine never could be. The engine keeps its `titleCase(id)` as the fallback,
 * so a pool with no row still displays: content ADDS a name, it is not required to have one.
 */
import type { ContentGraph, LoadedRow } from '../content/loader';
import { rowName } from '../content/loader';
import type { ResourceDef } from '../effects/facts';
import type { System } from '../rules/pipeline';

/** Pool id → its authored name, for the active edition + enabled sources. Ids with no row are
 *  absent, which is what leaves the engine's fallback in charge. */
export function resourceNames(
	graph: ContentGraph,
	system: System,
	isActive: (row: LoadedRow) => boolean,
): Map<string, string> {
	const out = new Map<string, string>();
	for (const row of graph.list('resource', { system })) {
		if (!isActive(row) || out.has(row.id)) continue; // first active row wins, like every other scan
		out.set(row.id, rowName(row));
	}
	return out;
}

/** The pools, each carrying the name content gives it (or the one the engine derived, unchanged). */
export const namedResources = (defs: ResourceDef[], names: Map<string, string>): ResourceDef[] =>
	defs.map((d) => {
		const name = names.get(d.id);
		return name === undefined ? d : { ...d, name };
	});

/*
 * schemaVersion convention (pinned at P1, see docs/PLAN.md decision #5).
 *
 * Both CONTENT rows and CHARACTER files carry a `schemaVersion` from day 1 so saves made
 * by an old build can be migrated forward by a newer one. Bump the relevant constant when
 * a breaking shape change lands, and register a migration step here.
 *
 * Migrations are pure data transforms (vN -> vN+1), chained until the data reaches the
 * current version. They never reach back into UI or Storage.
 */

export const CONTENT_SCHEMA_VERSION = 1;
// Desktop content SEED version — bump whenever the shipped SRD CSVs change (data, ids, headers). On
// update, a desktop install whose on-disk seed version is older is RE-SEEDED (untouched shipped files
// overwritten, user-edited ones preserved). v1 = the 0.4.0 snake_case + redone-SRD baseline.
export const CONTENT_SEED_VERSION = 1;
// v2 (E3): content ids migrated kebab→snake, so saved character refs are rewritten forward.
// v3: the same snaking re-run — the v2-SEEDED demo character still carried kebab refs.
export const CHARACTER_SCHEMA_VERSION = 3;

export interface Versioned {
	schemaVersion: number;
}

/** A single forward step. Keyed by the version it upgrades FROM. */
export type Migration<T = unknown> = (data: T) => T;

/**
 * Run registered migrations until `data.schemaVersion` reaches `target`.
 * Throws if the data is newer than this build can handle, or a step is missing.
 */
export function migrate<T extends Versioned>(
	data: T,
	migrations: Record<number, Migration<T>>,
	target: number
): T {
	if (typeof data.schemaVersion !== 'number') {
		throw new Error('missing schemaVersion');
	}
	if (data.schemaVersion > target) {
		throw new Error(
			`data schemaVersion ${data.schemaVersion} is newer than supported ${target}; update the app`
		);
	}
	let cur = data;
	while (cur.schemaVersion < target) {
		const step = migrations[cur.schemaVersion];
		if (!step) throw new Error(`no migration from schemaVersion ${cur.schemaVersion}`);
		const next = step(cur);
		if (next.schemaVersion <= cur.schemaVersion) {
			throw new Error(`migration from ${cur.schemaVersion} did not advance schemaVersion`);
		}
		cur = next;
	}
	return cur;
}

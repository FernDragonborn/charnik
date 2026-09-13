/*
 * schemaVersion convention (pinned at P1, see docs/plan.md decision #5).
 *
 * Both CONTENT rows and CHARACTER files carry a `schemaVersion` from day 1 so saves made
 * by an old build can be migrated forward by a newer one. Bump the relevant constant when
 * a breaking shape change lands, and register a migration step here.
 *
 * Migrations are pure data transforms (vN -> vN+1), chained until the data reaches the
 * current version. They never reach back into UI or Storage.
 */

// v2 (ITEM-TAGS): eight sparse item columns fold into `tags`, and `base_item_id` replaces the prose
// parenthetical `item_type` used to name a base weapon in. See content/migrations.ts.
export const CONTENT_SCHEMA_VERSION = 2;
// Desktop content SEED version — bump whenever the shipped SRD CSVs change (data, ids, headers). On
// update, a desktop install whose on-disk seed version is older is RE-SEEDED (untouched shipped files
// overwritten, user-edited ones preserved). v1 = the 0.4.0 snake_case + redone-SRD baseline.
// v2: the seeded bytes were CRLF on Windows (git's autocrlf, since fixed with `-text` in the content
// repo) while every published blob is LF — so the pack updater saw all 15 files as changed forever.
// Re-seeding rewrites them as LF; the hash is EOL-normalised, so no hand-edit is mistaken for one.
// v3: the shipped SRD gained `resources_srd.csv` in both editions (RES-NAME). A NEW FILE is the case
// this counter exists for and the easiest one to forget — nothing about an existing file changed, so
// nothing looked stale; a desktop install seeded at v2 would simply never receive it, and every pool
// would keep showing a title-cased id with no way for the user to tell why.
// v4: ITEM-TAGS reshaped both items CSVs (schema v2). Every shipped file's bytes changed, so an
// install left at v3 would keep reading v1 items through the migration instead of the real thing.
// v5: `srd-2014/class_casting_srd.csv` is a NEW FILE (a 2014 caster read zero cantrips and zero
// prepared without it) — the exact case v3's note describes, missed again — and the 2014 spells file
// now carries the `classes` column that makes a 2014 caster creatable at all. An install left at v4
// receives neither, plus none of the rules data of the 18 content commits beside them.
// v6: `unconscious` carries `disadvantage:attack` itself in both packs. It nested `prone`, which is
// where that token lived, and the engine expands `apply_condition` exactly one level — so an install
// left at v5 keeps a condition that names Prone and imposes none of it.
export const CONTENT_SEED_VERSION = 6;
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
	target: number,
): T {
	if (typeof data.schemaVersion !== 'number') {
		throw new Error('missing schemaVersion');
	}
	if (data.schemaVersion > target) {
		throw new Error(
			`data schemaVersion ${data.schemaVersion} is newer than supported ${target}; update the app`,
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

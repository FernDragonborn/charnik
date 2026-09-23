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
// v3 (CONDEFF): conditions and runtime effects are ONE type, so a state row carries `kind` and the
// `valence` open enum in place of `negative` — a boolean whose default was inverted between the two.
export const CONTENT_SCHEMA_VERSION = 3;
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
// v7: Magic Initiate says what it teaches (`spell_choice*`), and Acolyte and Sage say which list the
// SRD pins it to — an install left at v6 has the feat as prose, so its spells reach no sheet.
// v8: both packs ship TOOL rows — 25 in 2024 (each with the ability its check uses, which that SRD
// states) and 36 in 2014 (which states in so many words that it does not). An install left at v7 has
// nothing to be proficient WITH, so the tool proficiency it can now take lists nothing — and the
// Soldier's own tool was the slug `choose_one_kind_of_gaming_set`, an id no row will ever have.
// v9: CONDEFF — conditions and effects are one content type, so every state row carries `kind` and
// `valence` in place of the inverted `negative`. An install left at v8 keeps four files whose
// columns this build no longer reads, which shows as every buff rendering as if it were neutral.
// v10: the ammunition a weapon spends exists as rows — 2024's five (each carrying the `ammo:<kind>`
// its weapons already named), 2014's four promoted from gear to `ammunition`. An install left at v9
// has weapons that name a kind nothing in its inventory can be.
// v11: BEAST-DATA — every stat block states its `attacks` as a column, and the 2014 pack gains the
// 116 creatures of SRD 5.1's two appendices (every ordinary animal is in there). An install left at
// v10 has a 2014 druid with no legal Wild Shape form and no creature that can state an attack.
// v12: `see_invisibility` and `gladiator` keep the ids somebody had to fix by hand — the 5.1 source
// splits a word mid-name ("See I nvisibility", "Gladiato r") and the converter now repairs it, so a
// re-run stops renaming those two rows and orphaning every reference to them.
// v13: every 2014 class spell list is complete. The Tabyltop conversion the `classes` column was
// read from keeps only some of each page's columns, so 551 of the SRD's 778 list entries survived it;
// the official CC-BY PDF has all of them. An install left at v12 has a bard with nothing at 1st level
// and a wizard 51 spells short of the list they are allowed to prepare from.
// v14: MASTERY-HALF's content half — the 2024 class features that grant Weapon Mastery say HOW MANY
// kinds of weapon, off the Weapon Mastery column of their own Features table. An install left at v13
// has five classes whose mastery picks cap at zero, so every weapon's shipped `mastery:` stays inert.
export const CONTENT_SEED_VERSION = 14;
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

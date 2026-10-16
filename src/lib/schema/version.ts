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
// v15: the rows whose own text says "immune to the Charmed condition" or "Darkvision with a range
// of 60 feet" carry that as a token (`condition_immunity`, `senses.<name>`) rather than only as
// prose, in both editions, and the ten `+1/+2/+3` rows gained the `bonus_choice` column that lets a
// player say which one they found. An install left at v14 has a paladin whose aura says nothing, a
// dwarf who cannot see in the dark, and a +3 weapon that adds nothing.
// v16: the three 5.5e rows whose resistance is a type the item someone FOUND names — Ring of
// Resistance, Armor of Resistance, Dragon Scale Mail — ask for it through the new `choice_options`
// column and fold the answer via `item_choice`. An install left at v15 has three magic items whose
// resistance is a sentence nothing reads.
// v17: Cloak of Displacement and Spellguard Shield say what an ATTACKER rolling at you gets
// (`disadvantage:attacked`), in both editions, rather than only as prose. An install left at v16 has
// two magic items whose whole point is a sentence the sheet never states.
// v18: the fourteen rows whose defence carries a QUALIFIER — "+2 AC against ranged attacks",
// "advantage on saving throws against spells", "advantage on saves to avoid the Poisoned condition"
// — say it in tokens (`ac.ranged`, `saves.spell`, `saves.magical`, `saves.poisoned`) rather than only
// as prose. An install left at v17 reads eleven magic items as doing nothing.
// v19: the 2014 Champion is three rows of prose less. Both crit features say which d20 face crits
// FOR THEM (`crit_threshold`, 19 then 18), and Remarkable Athlete adds half a proficiency bonus
// ROUNDED UP to every Strength, Dexterity and Constitution check (`partial_up`, `check.<ability>`).
// An install left at v18 has a Champion whose 19 is an ordinary number and whose seventh level does
// nothing at all.
// v20: Dominate Beast, Person and Monster and Geas carry their upcast durations, and three 2014
// spells have their whole "At Higher Levels" back, Moonbeam's damage scaling with it. An install
// left at v19 casts a 7th-level Dominate Beast for one minute.
// v21: 2014 Hold Monster takes one more creature per slot above 5th, as its text and 2024's row say.
// v22: 2024 Skilled says its three picks reach tools (`skill_choice_kinds`). An install left at v21
// offers skills only.
// v23: the rows that state a Climb or Swim Speed "equal to your Speed" fold it (two 2014 items, three
// 2024 items, Roving and Second-Story Work). An install left at v22 reads those as a note.
// v24: ritual casting reaches a shipped sheet — every class says what it rituals from, and the 29
// spells SRD 5.1 tags as rituals carry the tag. An install left at v23 offers no ritual cast at all.
// v25: the eight 2024 mastery properties say what they do — a new file, `weapon_properties_srd.csv`.
// An install left at v24 prints `vex` on an attack row and nothing about it.
// v26: every class says whether it knows or prepares its spells (`prepare_style`), and 2024 Magic
// Initiate rituals the spell it keeps prepared. An install left at v25 calls a 2014 bard's known
// spells "prepared".
// v27: Graze and Topple state the number their rule gives a formula for (`grant_value`). An install
// left at v26 names the property and leaves the arithmetic to the player.
// v28: the Light property has a row in both packs and states its extra attack; Cleave, Nick and
// 2024 Two-Weapon Fighting say what they do to one. A new 2014 file, `weapon_properties_srd.csv`.
// v29: the plain weapon properties each SRD defines (Finesse, Heavy, Reach, Thrown, …) have rows in
// both packs. An install left at v28 explains Light and no other property a weapon carries.
// v30: Heavy puts its disadvantage on the attacks its rule names — by score in 2024, by size in 2014.
// v31: twelve 2014 magic items carry the tables their text points at, and the three whose resistance
// is the type of the copy somebody found ask for it. An install left at v30 reads "see the table"
// over nothing.
// v32: a druid's Wild Shape is a pool with a form to assume — its uses, which beasts a level allows,
// and whose hit points are counted, in both packs. An install left at v31 has a druid whose Wild
// Shape is a paragraph.
// v33: every table SRD 5.1 prints inside a magic item is in the 2014 pack, the six items whose
// rarity varies have rows, and the Deck of Many Things reads through to its last card.
// v34: each pack ships its Character Advancement table as `advancement_srd.csv` — a new file — and
// the 2014 Evocation school no longer carries that table as a class feature.
// v35: four 2014 monster cells the source prints and the pack had empty — two swarms' resistances,
// and the hit points of the druid and the spy.
// v36: a 2024 druid's use of Wild Shape buys Wild Companion, Land's Aid, Nature's Sanctuary and
// Wild Resurgence's spell slot — four option rows, a `granted_by` column and the Wild Resurgence pool.
// v37: each Wild Shape row states what ends the form without being asked — unconscious in 2014,
// Incapacitated in 2024.
// v38: Sneak Attack's roll says it is once per turn, in both packs.
// v39: class features lose their `resource` column, which was empty and read by nothing.
// v40: both packs carry the Avatar of Death, the stat block each SRD prints inside the Deck of Many
// Things.
// v41: the 2014 monsters carry their condition immunities in a column of their own, and the 116
// appendix rows no longer open their text with the stat block their columns already state.
// v42: 22 spells of the 2024 pack and 21 of the 2014 one carry the effect their own text states on
// its target — Mage Armor, Shield, Bless, Haste, Fly and the rest. An install left at v41 casts
// them and nothing on the sheet moves.
// v43: the 2014 `+1/+2/+3` rows state the rarity of each rung, as SRD 5.1 prints it beside the
// number ("uncommon (+1), rare (+2), or very rare (+3)"). An install left at v42 shows all three
// rungs of every such item as very rare.
// v44: the 2014 Wild Shape row states that a form leaves the druid no special sense it lacks itself
// (`form:wild_shape:only_senses`). An install left at v43 keeps an elf's Darkvision in a wolf.
// v45: both packs gain `options_srd.csv` — the varieties of the six items whose rarity varies, and
// a 2014 warlock's Pact Boons and Eldritch Invocations, which its two feature rows now `choose`.
// An install left at v44 never receives the file, and its Belt of Giant Strength stays a sentence.
// v46: the 2024 druid's Elemental Fury is a choice — its feature row says `choose`, and Potent
// Spellcasting and Primal Strike are options. An install left at v45 is asked nothing at level 7.
// v47: a 2024 druid's Wild Resurgence gives a use back for a spell slot (`spend_slot`), and an
// Archdruid's Nature Magician turns uses into one slot. An install left at v46 has neither option.
// v48: both Wild Shape rows state that equipment works only where the form wears it, and the 2024
// one that the form sheds the species' traits. An install left at v47 keeps both in a wolf.
// v49: Ammunition, +1, +2, or +3 is ammunition rather than a weapon, so the base it asks for is an
// arrow or a bolt. An install left at v48 offers it every sword.
// v50: Unarmored Defense, Mage Armor, Draconic Resilience and the Robe of the Archmagi work out the
// BASE Armor Class (`set_base`), so a shield and a cloak still add; the Wood Elf's speed and the
// Ring of Swimming's and Cloak of the Manta Ray's swim speeds are bases the same way. An install left
// at v49 sets the whole value and drops what came before it.
// v51: items carry `instance_name`, what one found instance of a `+1/+2/+3` row with no base is
// called — "Wand of the War Mage". An install left at v50 names the wand by its heading.
// v52: the 2014 Fighting Styles are option rows, each offered by every feature that lists it, and the
// four features `choose` one. An install left at v51 is asked nothing and Great Weapon Fighting
// rerolls nothing.
// v53: the 2024 Fighter's Fighting Style and the Champion's Additional Fighting Style open a feat slot
// of their own (`feat_choice`). An install left at v52 offers the style only in a level's slot.
// v54: the 2024 Paladin's and Ranger's Fighting Style do too, and offer Blessed Warrior and Druidic
// Warrior as option rows the slot may take instead. An install left at v53 asks them nothing.
// v55: the 2024 Figurine of Wondrous Power carries its whole entry — the Giant Fly's stat block and
// the seven figurines after it. An install left at v54 stops at the Ebony Fly.
// v56: Metamagic is a choice in both packs — eight 2014 options and ten 2024 ones, the feature row
// `choose`-ing them by sorcerer level. An install left at v55 is asked nothing.
export const CONTENT_SEED_VERSION = 56;
// v2 (E3): content ids migrated kebab→snake, so saved character refs are rewritten forward.
// v3: the same snaking re-run — the v2-SEEDED demo character still carried kebab refs.
// v4: a character has a `uid`, and its inventory and class rows an id of their own — a class row
// saved while slot picks were keyed by its index takes those keys onto its id.
export const CHARACTER_SCHEMA_VERSION = 4;

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

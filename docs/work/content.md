# Content and data — open work

> Tracker. Shipped rows, converters, packs and versioning. The rules are
> [`../internals/content.md`](../internals/content.md) and [`../internals/packs.md`](../internals/packs.md); the
> ORDER is [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **CIRCLE-OF-THE-LAND · the land a druid chooses, and its spells.** SRD 5.1: a terrain of eight
  at level 2, each a table of circle spells by druid level, and a bonus cantrip; SRD 5.2.1: a land
  type chosen at each Long Rest (arid, polar, temperate, tropical) with its own table. Option rows
  on FEATURE-SPELLS (`mechanics.md`), the bonus cantrip an option's `cantrips`.
- [ ] **SPECIES-SPELLS · the spells a lineage or legacy grants at character level 3 and 5.** SRD
  5.2.1 Elven Lineages, Fiendish Legacies and Gnomish Lineage; SRD 5.1 tiefling's Infernal Legacy
  (thaumaturgy, hellish rebuke at 3rd, darkness at 5th). `spell@level` where the level is the
  character's (FEATURE-SPELLS).
- [~] **PROSE-MARKDOWN · the tables in content prose are Markdown; four are not, and want a look.**
  124 of the 128 tables across the two packs are Markdown tables now, each rewritten only where its
  HTML was RECTANGULAR — a header row of `<th>`, every row the same width, no `colspan`/`rowspan`,
  nothing in a cell Markdown has no inline form for — and each checked to render the same cells,
  emphasis included, through the app's own pipeline. Whitespace the page layout left inside a cell
  is collapsed. The `<b>` and `<em>` the audit counted were all inside those tables.
  **Four stay HTML, each a defect of the source conversion rather than of Markdown:**
  - **The four 2024 ability-score blocks** — `find_steed`, `giant_insect`, `summon_dragon` and the
    Giant Fly inside `figurine_of_wondrous_power`. Each row is right: twelve cells, the score, its
    modifier and its save for three abilities. The HEADER is wrong: it names nine columns
    (`MOD SAVE` with no cell over the score) and pads the rest with a `colspan`, and two of the four
    have no header row at all. The fix is a header of `| | | MOD | SAVE |` ×3 typed over the cells
    that are already there. These are the three stat blocks COMPANION needs transcribed as rows
    anyway (`../work/mechanics.md` ▸ COMPANION), so the two may want deciding together.
  `renderContentMarkdown` keeps its HTML-table workaround (blank lines forced around `<table>`,
  emphasis mopped up inside cells) while any of these ship, and for homebrew that writes HTML.

- [~] **MASTERY-HALF · weapon mastery. The picks, the rules text, the numbers and the extra attacks ship; the tail is surfaces.**
  The weapon half was always data — every 2024 weapon carries its one `mastery:<name>` (5.5e only;
  2014 has no such rule) — and nothing read it, because RAW the property does nothing until a feature
  unlocks that KIND of weapon for you.
  **What shipped.** `mastery_slots` on the five 2024 class features that grant Weapon Mastery, in the
  same `count@level` ladder `expertise_slots` uses and read by the same `countAtLevel`. The ladders
  are the SRD's own: Barbarian and Fighter have a Weapon Mastery column in their Features table
  (`2@1,1@4,1@10` and `3@1,1@4,1@10,1@16`); Paladin, Ranger and Rogue name no table and stay flat at
  two. `build.masteries` holds the picked weapon KINDS as bare ids; the picker is a capped chip pane
  off the Attacks card, and the attack row prints the mastery **only** when a pick unlocks it —
  matched on `ResolvedItem.kindId`, because a +1 Greataxe is still a Greataxe. 2014 caps at 0, so
  nothing of this leaks into it. Screenshot: `design-preview/mastery-picked.png`.
  **Multiclass grants SUM**, and that is RAW rather than a convenience: the 2024 multiclassing rules
  name their exceptions (Extra Attack, Spellcasting, alternative AC) and Weapon Mastery is not one of
  them, so a Fighter 1 / Barbarian 1 drills five kinds.
  **Each property says what it does.** The eight are `weapon_property` rows — a name and SRD 5.2.1's
  own sentence, keyed by the word the weapon's tag carries (`../internals/content.md` ▸ A column, or a
  tag) — and the attack row and the mastery picker print the name and explain it on hover and focus.
  **So does every plain property**, in both editions: Ammunition, Finesse, Heavy, Light, Loading,
  Reach, Thrown, Two-Handed and Versatile from each SRD's Properties section, and 2014's Special.
  Range is defined there too and has no row, because no weapon carries it as a word — its numbers
  ride on `thrown` and `ammunition`. An item's article explains its Mastery and Properties cells
  from those rows, in the compendium and in every picker that shows the article
  (`design-preview/item-article-properties.png`).
  **Two of them state a number** — Graze the damage a miss still deals, Topple the DC of the save it
  forces — and the row prints it (`grant_value`, `../internals/effects.md` ▸ §2). Graze's token reads
  `max(0,attack_mod)`: RAW names the modifier and says nothing of a negative one, and damage that
  heals is the reading nobody plays, so that is RAI and said here.
  **Two of them are an extra attack**, and so is the Light property in both editions: `extra_attack`
  on the property's row, offered as a row of its own under the weapon that says its cost and its
  damage on its face, costing what the row says and marked once made (`combat/attack-properties.ts`, `SheetRolls.extraAttackRoll`). Light grants it,
  a drilled Nick makes it free, Cleave grants its own, 2024 Two-Weapon Fighting keeps the modifier.
  The builder's Attacks card says the same attack in its Notes cell — who grants it, what it costs,
  what it rolls — with the rules' text on hover and focus (`design-preview/builder-extra-attack.png`).
  Both costs are driven in the running app: a free one spends no slot, a Bonus Action one spends
  the pip and is refused with its reason when the pip is already gone.
  **Heavy is a roll mode**: a guarded `disadvantage:attack` on the property's row, read per attack
  — under Strength 13 for a melee weapon and Dexterity 13 for a ranged one in 2024, for a Small
  creature in 2014. The row says `Disadvantage (Heavy)` and the tap rolls with it.
  **Vex, Sap, Slow and Push stay text**: each acts on a creature, and the app has no target.
  **What is left:** **an attack row prints only the weapon's first property.** It explains all of them on hover
     and focus, as the article does; the sub-line has room for one word, and which words earn the
     space is a layout question for COMBAT-RAIL's session.
  `versatile:1d10` is still the other half of this shape: data with no mechanic reading it, and a grip
  the player CHOOSES, so it wants a control before it can mean anything.
- [ ] **SRD-TRANSCRIPTION · shipped rows are typed by hand from the SRD, and nothing parses it.**
  The local sources are `tools/srd-src/` (gitignored): SRD 5.1 as PDF, HTML and text, SRD 5.2.1 as
  Markdown. A row or a token is written by reading the source and typing what it says, and the
  content-repo commit quotes the sentence it stands on. A script may do what is purely structural
  — add an empty column to every row — and never reads the SRD.
  **A source's layout is not its text.** The HTML and text conversions of SRD 5.1 split words and
  sentences where the page did ("hit po ints", a paragraph ending mid-sentence at a column break)
  and flatten dashes; repair those against the PDF while typing.
  A producer sibling that converts whole chapters is put AFTER the engine work by the maintainer
  (`../internals/content.md` ▸ Where the shipped data comes from). Until it exists a re-run is a
  re-write: whoever regenerates a pack must carry the hand-typed columns across, and the app
  repo's content tests are what fail if they do not.
- [ ] **RULES-TEXT · the packs carry the SRD's ROWS and none of its rules chapters.** Both packs hold
  spells, items, monsters, classes, species, feats, backgrounds, languages and states — every
  row-shaped thing — and nothing else, because a converter that walks rows produces rows. So text
  the CC-BY licence entitles us to ship simply is not here, and the app cannot quote the rule it
  implements even to explain a number it just folded.
  **What found this:** the same-effect rule. `resolver.ts` enforces it and `effects.md` now quotes
  it, but grepping both packs for it returns nothing — it lives in SRD 5.1 ▸ Spellcasting ▸ Casting
  a Spell and SRD 5.2.1 ▸ Casting Spells, neither of which is a row. The same is true of every
  general rule the engine leans on: advantage, cover, resting, carrying capacity.
  **Why it is worth having rather than tidy:** a stat that can explain itself already carries the
  trace; the sentence behind the trace is the half a player reads out at the table, and today the
  only way to settle an argument is to leave the app. It is also the shape a compendium entry for
  a RULE would need — the same surface the states and conditions already use.
  **It is a producer sibling's job, not this repo's**, like the spell lists and for the same reason:
  the source is a PDF, mining it is prose work, and what lands here is a CSV diff a human reads.
  What has to be decided first is the row SHAPE — a rules chapter is nested sections, not the flat
  `id, name, text` every current type is, and flattening it wrongly is harder to undo than to design.

- [ ] **STRUCTURE-FROM-TEXT · facts that still sit in prose and would be better as columns.** None
  block the loader; each raises fidelity where the UI later wants a structured filter. Ability
  bonuses ship as data (2014 species `effects` + `boost_choice`, 2024 backgrounds
  `ability_choices`), and a monster's saves, resistances, immunities, condition immunities,
  vulnerabilities, senses and skills are columns. What is left, in order — every value typed by
  hand from the local source (SRD-TRANSCRIPTION):
  - **An Armor Class's own note has no column.** "13 (natural armor)", "12 (15 with mage armor)":
    `ac` is a number. The 116 appendix rows of the 2014 pack keep that one line at the top of their
    text, which is all that is left of the stat block they used to repeat there; the 201 chapter
    rows, and the 2024 pack, do not carry the note at all.
  - **Legendary actions are prose in both packs** (2014: 23 rows, 2024: 30); nothing reads them
    yet. A proficiency bonus needs no column — it follows from `cr`.
- [~] **E4 · the spells whose effect is still only prose.** A cast leaves the spell's own effect
  tokens on the caster (`../internals/rules-core.md` ▸ Spellcasting), and the row of a spell that
  rolls nothing is captioned from those tokens, resolved against the sheet
  (`combat/effects-view.ts` ▸ `effectsCaption`) — so a spell says what it does because its data
  does, and the hardcoded name list that used to say it is gone. 25 spells of the 2024 pack and 24
  of the 2014 one carry tokens — Haste doubling Speed (`double`) and Heroism's Temporary Hit Points each
  turn (`on_event:turn_start:temp_hp`) among them — each typed from the sentence of its own text that states it.
  What is left, grouped by what each waits on:
  - **A choice made at the cast.** Enhance Ability (which ability), Protection from Energy and
    Fire Shield (which damage type), Enlarge/Reduce (which of the two): the token would need the
    answer the way an item's `item_choice` does, and a cast asks nothing yet.
  - **A word the vocabulary lacks.** 2014 Stoneskin
    resists NONMAGICAL damage; Protection from Poison's advantage is against one condition; Jump,
    Freedom of Movement, Death Ward and Sanctuary state rules about events the app does not see.
  - **A spell cast on SOMEONE ELSE still lands on the caster.** The model is "a cast applies to
    self" and the carrier is also what holds concentration, so a Bless laid on three allies shows
    its d4 on the caster's own rolls until the effects switch or a re-cast says otherwise. Saying
    who a cast is for is a control on the cast, and wants a design before it is a column.
  - **`castingIcon` and `durationToRounds` still read English out of a column's text** ("bonus",
    "1 minute"). Both read a declared column and neither a description, so no number is mined from
    prose; they are English-only, which a pack in another language would meet first.
- **Won't-do, recorded so they are not re-audited:** **B11**, a size cap on `Storage.read()` — the
  path that mattered is capped where a pack is fetched (`MAX_REMOTE_BYTES`, `MAX_PACK_FILES`,
  `MAX_PACK_BYTES`, `MAX_PREFETCH_BYTES` in `content/remote/types.ts`), and what is left would guard
  a file the USER put in their own data folder, which is not a trust boundary and is precisely where
  a cap rejects legitimately large homebrew; **B24**, incremental per-file reparse — a full reload
  of both shipped packs is about 90 ms, and `articles`, `byEffectiveId`, locale discovery and
  `resolveRefs` all span files.

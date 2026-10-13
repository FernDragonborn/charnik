# Content and data — open work

> Tracker. Shipped rows, converters, packs and versioning. The rules are
> [`../internals/content.md`](../internals/content.md) and [`../internals/packs.md`](../internals/packs.md); the
> ORDER is [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **PROSE-MARKDOWN · the tables in content prose are HTML; make them Markdown — its own session.**
  211 `<table>` blocks across the two packs (2014: 116 in monsters, 16 in class features; 2024: 49 in
  items, 16 in spells, 11 in class features, 3 in species), plus 70 `<em>`, 34 `<b>` and one `<span>`.
  The renderer already takes both — `renderContentMarkdown` parses Markdown and sanitizes raw HTML in
  one pass — so nothing is broken today. What is wrong is that a column the USER is invited to edit in
  a table processor holds two notations for the same thing, and the HTML one is the notation they
  cannot read or write by hand.
  **Why it is a session and not a pass:** a Markdown table is only equivalent when the source table is
  RECTANGULAR. A monster stat block's tables are the ones most likely not to be, so the conversion has
  to be checked, not trusted — and it is 211 diffs in the content repo, each of which a human reads.
  **Do the audit with it, not after:** the same pass answers where else HTML is doing a job Markdown
  does (`<b>`/`<em>` are plain `**`/`_`), and whether anything left is load-bearing enough to keep.
  The one pipeline note that bounds the work: `renderContentMarkdown` force-feeds blank lines around
  `<table>` and then mops up emphasis left literal inside its cells — a workaround that exists only
  because of these blocks, and that comes out with them.

- [~] **MASTERY-HALF · weapon mastery. The picks, the rules text, the numbers and the extra attacks ship; the tail is surfaces.**
  The weapon half was always data — every 2024 weapon carries its one `mastery:<name>` (5.5e only;
  2014 has no such rule) — and nothing read it, because RAW the property does nothing until a feature
  unlocks that KIND of weapon for you.
  **What shipped.** `mastery_slots` on the five 2024 class features that grant Weapon Mastery, in the
  same `level:count` grammar `expertise_slots` uses and read by the same function — which is now
  named for the grammar (`slotsGrantedAtLevel`) rather than for one of its two columns. The ladders
  are the SRD's own: Barbarian and Fighter have a Weapon Mastery column in their Features table
  (`1:2,4:1,10:1` and `1:3,4:1,10:1,16:1`); Paladin, Ranger and Rogue name no table and stay flat at
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
  **What is left, in the order it is worth doing:**
  1. **2014 Two-Weapon Fighting has no row to carry `extra_attack:light:modifier`** — the 2014
     fighting styles are prose inside one `fighter_fighting_style` row, the same blocker GWF-2014
     names and sizes (`mechanics.md`). A player's own effect carrying the token folds today.
  2. **An attack row prints only the weapon's first property.** It explains all of them on hover
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
- [ ] **MAGIC-ITEM-VOCAB · the magic items that are still prose, and the vocabulary each one wants —
  0.8.0.** Everything the bounded vocabulary can already SAY is folded (239 rows). What is left is
  not unauthored: it is items whose text states a real, passive, mechanical benefit that the
  vocabulary has no way to name. Each carries a `note:` today, so the sheet says the thing and the
  player applies it by hand. Grouped by the gap, because the gap is the work — the rows follow for
  free once it closes.

  **Six gaps are closed, and their grammar is `../internals/effects.md` ▸ Targets:** a qualifier on
  a defence (`ac.ranged`, `saves.spell`), a choice the item asks per instance (`choice_options` +
  `item_choice`), a bonus stated as a range (`bonus_choice` + `item_bonus`), a
  sense (`senses.<name>`), attack rolls made against you (`attacked`), and a movement mode stated
  as the walking speed (`speed.climb`, and the `speed` variable a mode's value may read). The roll-time control
  that would APPLY a qualified defence is deliberately not built: it needs the player to say what a
  save is against, which is a design question of its own.

  **Two pieces are left:**

  1. **A row that is one entry in the book and several items at the table**, the same in BOTH
     editions. The 2014 pack carries every table SRD 5.1 prints inside a magic item — thirty-four,
     typed by hand as the HTML the 2024 pack uses and pinned by count — and the six items whose
     rarity "varies": Belt of Giant Strength, Figurine of Wondrous Power, Ioun Stone, Potion of
     Giant Strength, Potions of Healing and Spell Scroll. A Belt of Giant Strength sets Strength to
     a number its VARIETY states, an Ioun Stone does a different thing per stone, and neither
     `bonus_choice` (a `+N` capped at ten) nor `choice_options` (a word substituted into a target)
     says "this variety sets 23". Until one does, those rows are text in both packs.
     **The direction:** a variety is an OPTION of the row with tokens of its own —
     what N2 calls a feature CHOICE (a Pact Boon, a 2014 Fighting Style), asked
     here of an inventory row instead of the build. One mechanism for both, and an option's own
     `rarity` settles piece 2 as well.

     **Measured, so it is not re-taken.**
     - *What an inventory row can be answered with today.* Two fields on `inventoryEntry`, each
       declared by a column on the item and each read in exactly one way: `bonus` (declared by
       `bonus_choice`) is a NUMBER, handed to the row's own tokens as the `item_bonus` variable
       (`effects/context.ts` ▸ `withItemBonus`, read at `derive-gather.ts` and `combat/attacks.ts`);
       `choice` (declared by `choice_options`) is a WORD, substituted for the `item_choice` segment
       of the row's tokens (`token-parser.ts` ▸ `withItemChoice`). Both are asked on the inventory
       row (`routes/combat/inventory.svelte.ts`). Neither can carry tokens of its own, which is the
       whole gap: "this variety sets 23" is a different TOKEN per answer, not a different word in
       one.
     - *What "an option of a row" already is.* Two content types, each naming its parent by a
       column typed to it: `species_option` (`species_id`; 65 references across 21 files, picked
       once into `build.speciesOption`) and `resource_option` (`resource_id`; 17 across 9, the
       honest size of the next one). The builder's own slot pattern is narrower than its name:
       `build.slotPicks` holds feats and nothing else, and what a class asks beyond feats is a flat
       array of ids per question (`build.masteries`, `build.forms`).
     - *The rows that would use it.* Items, the same in both packs: Belt of Giant Strength (five
       varieties in its own table — type, Strength, rarity), Potion of Giant Strength (five),
       Potions of Healing (four), Spell Scroll (ten), Figurine of Wondrous Power and Ioun Stone
       (varieties as prose, no table). Class features whose options are in the row's prose: 2014
       Fighting Style under three classes and the Champion's second, Metamagic (eight), Pact Boon
       (three). Class features that NAME a choice whose options are not in the pack at all: the
       Eldritch Invocations row of both editions, and 2024 Metamagic — those want rows typed
       before they want a column.

     **The shape — one content type, `option`. It is signed off, and nothing of it is built:**

     | column | what it says |
     | --- | --- |
     | `option_of` | the parent row as `<type>:<id>` (`item:belt_of_giant_strength`, `class_feature:warlock_pact_boon`), matched by edition and not by source, as `featuresForClass` matches a feature to its class — so a homebrew option attaches to an SRD row |
     | `effects` | the option's own tokens, folded at the parent's layer with the parent's origin |
     | `rarity` | an item variety's own rarity; blank inherits the parent's |
     | `requires` | the id of another option the character must hold (an invocation that names a boon) |
     | `level` | the class level an option opens at; blank is the parent's own |
     | `ritual_source` | the column a class, subclass and feat row already carry, read by the same function |

     The PARENT says how many: `choose` on a class-feature row, in the `level:count` grammar
     `expertise_slots` and `mastery_slots` use and read by the same `slotsGrantedAtLevel`. An item
     says nothing — an instance is one variety. The ANSWER lives where the parent's other answers
     do: an inventory row's existing `choice` holds the option's id, and the build gains
     `options`, feature id → option ids. `choice_options` stays as it is: a damage type is a
     word the vocabulary already knows, and a row per word would be rows that say nothing.

     **What it deliberately does not do.** It does not fold `species_option` into itself — that
     type carries three columns of its own and a `kind`, and merging it is a migration with no
     player-visible gain. It does not make a consumable act: a Potion of Healing's variety gives it
     a name and a rarity on the row, and drinking stays the player's.

  2. **A range row is filed under one rarity.** Both packs state a rarity per rung inside
     `bonus_choice`, as each SRD prints it beside the number, and the article and the inventory
     row say the rung's. What still reads the row's own `rarity` column is everything that files a
     row in ONE place: the compendium's rarity grouping and facet, the picker's rarity band, the
     list's sub-line. So `weapon_1_2_or_3` is found under Very Rare and not under Uncommon. A row
     cannot stand in three groups without being three entries, which is piece 1's question — a
     variety with a `rarity` of its own is what a list would file.

  **The rows that stay prose, each for a reason the vocabulary cannot fix by growing a word:**
  - *Shield of Missile Attraction* wants resistance qualified by the SOURCE of the damage rather than
    its type, and the type slot is deliberately free-form, so a qualifier written there is
    indistinguishable from a pack's own damage type.
  - *Belt of Dwarvenkind* twice over: its advantage is gated on not being a dwarf, which no guard can
    ask; and "your Constitution increases by 2, to a maximum of 20" cannot be said — within a layer the
    fold order is set → floor → cap → mult → add, so a `set_override:con:20:cap` fires before the
    `+2`, and `min(con_score+2,20)` is correctly refused as a dependency cycle. It folds its +2 and
    its note states the ceiling.
  - *Holy Avenger's* advantage is an aura it grants to others. 2014's *Necklace of Adaptation* says
    "harmful gases and vapours", which is not the Poisoned condition its 2024 text names.
  - *Armor of Vulnerability* turns ONE answer into three facts (resist one of
    bludgeoning/piercing/slashing, vulnerable to the other two), which no single substitution says;
    *Ring of Elemental Command's* plane brings resistance, movement and a page of other text with it.
  - *Goggles of Night* add 60 feet to a Darkvision you already have, and the `item` layer folds
    BEFORE `feature`, so a species floor would land after the goggles' add
    (`../internals/effects.md` ▸ Targets).
  - *Robe of Scintillating Colors'* disadvantage is charge-gated and applies only to creatures that
    can see you. 2014's *Armor of Invulnerability* resists "nonmagical damage", which is not a type
    the vocabulary can name; 2014's *Cloak of Elvenkind* needs its hood UP, an action.
  - A charged item with a RANDOM starting pool ("1d8 + 1 charges") says no pool: the vocabulary
    takes a literal max.

  **What will never fold, and should stop being counted as missing:** consumables (potions, oils —
  drinking is not a modelled event), objects with their own stat block (Mirror of Life Trapping,
  Instant Fortress, Apparatus of the Crab, Iron Flask), and summon items (Horn of Valhalla, Deck of
  Many Things). These are complete as prose.

- [~] **E4 · the spells whose effect is still only prose.** A cast leaves the spell's own effect
  tokens on the caster (`../internals/rules-core.md` ▸ Spellcasting), and the row of a spell that
  rolls nothing is captioned from those tokens, resolved against the sheet
  (`combat/effects-view.ts` ▸ `effectsCaption`) — so a spell says what it does because its data
  does, and the hardcoded name list that used to say it is gone. 25 spells of the 2024 pack and 24
  of the 2014 one carry tokens, each typed from the sentence of its own text that states it.
  What is left, grouped by what each waits on:
  - **A choice made at the cast.** Enhance Ability (which ability), Protection from Energy and
    Fire Shield (which damage type), Enlarge/Reduce (which of the two): the token would need the
    answer the way an item's `item_choice` does, and a cast asks nothing yet.
  - **A word the vocabulary lacks.** Haste doubles Speed and no kind multiplies but `halve`;
    Heroism's Temporary Hit Points each turn want an executor verb that gives them; 2014 Stoneskin
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

# Content and data — open work

> Tracker. Shipped rows, converters, packs and versioning. The rules are
> [`../internals/content.md`](../internals/content.md) and [`../internals/packs.md`](../internals/packs.md); the
> ORDER is [`plan.md`](../plan.md) ▸ Implementation order.

- [x] **ITEM-TEMPLATES · a magic item that is "any melee weapon" gets told which one.**
  `inventoryEntry.base` holds the player's answer, `resolveItem` merges it exactly as an authored
  `base_item_id` merges, and the Inventory panel asks the question on the row itself — the chooser
  stays after a pick, because the base is theirs to change. **The tell is the category-defining tag,
  not an empty one**: every real weapon row says `simple` or `martial` and every real armour says
  `armor:<weight>` or `ac`, while a template carries only `attunement` — the old "no tags and no
  damage" test matched no shipped row at all (they all carry `attunement`) and would have called a
  net, which does no damage, a template. ~20 rows per edition needed this, Flame Tongue among them.
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

- [ ] **CONVERTERS-SUNSET · `tools/srd/` is retired. DECIDED: delete it, once the row count has a
  home.** **Do not audit them** — reading 3 500 lines to improve code that is going is the expensive
  kind of thorough.
  The two halves collapsed into one: content will be produced by a sibling repository instead (see
  `AGENTS.md` ▸ The content lives in another repo, which states the naming convention and the rule
  that only SRD-derived rows cross into the shipped pack). A converter cut down to "here is the row
  count" would be a converter that converts nothing, and a folder whose name lies is worse than no
  folder.
  **The first of the two commits has landed.** `charnik-content-srd` carries `manifest.json` (34
  files, 3219 rows) and a zero-dependency `check.mjs` that counts by quote state and exits 1 on
  drift — proved against the app's own papaparse loader over every shipped file. So the pack is
  guarded on its own now, and what is left is the deletion: the folder goes, and the standing
  "never re-run a converter to re-stamp" hazard goes with it (`AGENTS.md`, `tooling.md`).
  Nothing else in them needs rescuing: the one lesson that outlives the code — a source's typography
  is not evidence, so repair the spacing before a name is compared or turned into an id — is recorded
  in `content.md` ▸ Where the shipped data comes from.
  **What weakens, said plainly:** today the assertion compares the emitted rows against the SOURCE. A
  manifest compares them against a number we wrote down, which catches a truncated file or a bad
  hand-edit but is a snapshot, not a cross-check. That is a real loss and worth naming rather than
  papering over; the producer that replaces this will want its own count assertion anyway, so the
  manifest is the interface it writes against.

  The shipped CSVs are the artifact; the converters are how they were produced once, not what the app
  runs. Eleven files, ~3 500 lines of offline prose extraction, re-run rarely, carrying a documented
  destructive trap — a re-run regenerates rows and drops `conditions_srd.csv`'s `max_level`
  (`AGENTS.md` ▸ The ways to hurt yourself) — and holding a second, informal account of what a valid
  row is, next to the authoritative one in `src/lib/content/schemas.ts`. Deletion over addition
  applies to tooling as much as to `src/`.

  What has durable value and must survive either decision: the CSV output contract and the
  `type:source:id` identity, which already live in `schemas.ts`; the stamping discipline, which lives
  in `restamp.ts`; and the row-count assertion against the source, which is the only thing standing
  between a silent extraction loss and a shipped pack that is quietly short. That last one has no
  home outside the converters today — if they go, it needs one, and that is the real work in this
  item rather than the deletion itself.

  The `see_i_nvisibility` slug is settled and was not the generator's fault: SRD 5.1 itself prints
  "See I nvisibility", the same OCR artifact as its "Extra A ttack" heading, and the slug is a faithful
  rendering of it. The row is transcribed as `see_invisibility` now, name included. Nothing in the
  generator needs finding — but a name-matching converter must squash whitespace before comparing, as
  `convert-2014-spell-lists.mjs` does, because the source's typography cannot be trusted.

- [~] **MASTERY-HALF · weapon mastery. The CHARACTER half is built; the eight EFFECTS are not.**
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
  **What is left is the eight mastery EFFECTS** (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex),
  and most of them act on a creature the app does not model — Push moves the target, Sap gives its
  next attack disadvantage, Topple forces a save. Those are `note:` work by the same argument that
  keeps Favored Enemy prose. Graze, Nick and Vex touch the character's own numbers and are the ones
  worth a token. `versatile:1d10` is still the other half of this shape: data with no mechanic
  reading it, and a grip the player CHOOSES, so it wants a control before it can mean anything.
- [x] **BARD-LIST-2014 · the 2014 Bard spell list was missing its 1st-level half — and so was a third
  of every other class's list.** The item read the symptom right and the cause wrong: the SRD 5.1
  document has its "1st Level" and "2nd Level" Bard headings. What lost them is the **Tabyltop
  conversion** the 2014 converters read, which keeps only some of each page's columns — the SRD prints
  these lists several columns to a page, and 551 of the document's 778 entries survive that. So the
  Bard lost a whole column (its 1st-level block) and every other class lost a slice: the counts this
  item recorded as "complete" were short by 30% (wizard 153 of 204, cleric 75 of 105, ranger 20 of 37).
  **`convert-2014-spell-lists.mjs` reads WotC's own CC-BY PDF now** (`pdfjs-dist` over
  `SRD_CC_v5.1.pdf`), and what that document names is exactly the 319 spells this pack ships — so the
  run asserts the CORRESPONDENCE rather than a count somebody wrote down: every shipped row must come
  out carrying a class, and a list name matching no row fails the run. 211 class tags gained, none
  lost, no other column touched. The shipped sizes are pinned in `spell_lists_content.test.ts`:
  bard 112, cleric 105, druid 105, paladin 31, ranger 37, sorcerer 120, warlock 64, wizard 204.
- [ ] **STRUCTURE-FROM-TEXT · facts that still sit in prose and would be better as columns.** None
  block the loader; each raises fidelity where the UI later wants a structured filter. In priority
  order: species ability bonuses as `effects` (`flat_bonus:con+2`) rather than only prose — 5e on
  the species, 5.5e on the background; a monster's `saving_throws`, `damage_resist/immune`,
  `condition_immune`, `legendary_actions` and `proficiency_bonus`, all of which live in `text_en`
  today; and `resource` on class features (rage and ki counts), currently unparsed. Each arrives
  through a `schemaVersion` migration, and each number comes from the converter, never from memory.
- [x] **SUBCLASS-LEVEL-2024 · every 2024 subclass unlocks at level 3**, and the shipped
  `subclass_level` says so for all twelve — the cleric, sorcerer, warlock, druid and wizard that
  carried the 2014 value read 3, against each `#### Level 3: <Class> Subclass` heading in the source.
  The per-system override column this item wanted turned out to be nothing: the editions are separate
  packs with separate files, so each simply states its own number.

- [x] **MAGIC-ITEM-EFX · every shipped magic item that changes a number says which one.** An
  equipped magic item that changes no number is a wrong number, and most of them used to change
  none. (GLOBAL content task, surfaced by DEMO-1 gap 2, 2026-08-04.) **FIRST TRANCHE DONE 2026-08-09 — 14 items × both editions,
  each read off that edition's own SRD text.** The plumbing was already there (an `effects` column,
  equipped/attuned rows flowing through `gatherEffects`); every magic-item row simply shipped EMPTY.
  Authored: Cloak/Ring of Protection (`flat_bonus:ac+1;flat_bonus:saves+1`), Stone of Good Luck
  (`ability_checks`+`saves`), Amulet of Health / Headband of Intellect / Gauntlets of Ogre Power
  (**`set_override:<abil>:19:floor`** — the FLOOR mode matters: RAW "no effect if already 19 or higher",
  and a plain set would drag a 20 down), Ring of Swimming (`set_override:speed.swim:40`), Boots of the
  Winterlands (`damage_sensitivity:resist:cold`), Boots/Cloak of Elvenkind + Eyes of the Eagle (Stealth /
  Perception advantage), Bracers of Defense (the guard `not is_wearing_armor and not is_wearing_shield ?
  flat_bonus:ac+2`), Mantle of Spell Resistance + Ring of Spell Turning (`note:` — the vocabulary has no
  "against spells" save qualifier, so they stay text rather than fold too broadly). **Edition
  divergences kept:** 2014 Boots of Elvenkind are qualified ("checks that rely on moving silently" —
  folded, qualifier noted) and the 2014 Cloak needs its hood UP (an action), so it stays text while the
  2024 one folds. **Converter preservation FIXED** — `convert-items.mjs` and the 2014 converter emitted
  `effects: ''`, so a re-run wiped the authoring (verified by doing exactly that, then re-running to
  prove the fix: byte-identical output, same hash). The `existingColById` helper the other two
  converters had each copied is now one export in `tools/srd/lib.mjs`. Hashes re-stamped;
  `items_content.test.ts` pins the values + drift.
  **SECOND TRANCHE DONE 2026-08-21 — 23 items in 2024, 12 in 2014**, again read off each edition's own
  shipped text. Named damage types fold (`damage_sensitivity:resist:<type>` — Staff of Fire/Frost, Brooch of
  Shielding, Cloak of Arachnida, Periapt of Proof against Poison, Armor of Invulnerability's b/p/s);
  UNQUALIFIED advantage on a named roll folds (Sentinel Shield + Rod of Alertness →
  `advantage:initiative;advantage:skill.perception`, Cloak of the Bat → stealth, Quarterstaff of the
  Acrobat → acrobatics); the `+N` weapons fold through the D9 weapon path (Holy Avenger +3, Vorpal +3,
  Staff of the Magi +2 with `flat_bonus:spell_attack+2`, Berserker Axe +1 with `flat_bonus:hp_max+level`);
  Frost Brand's rider is the typed-damage form `flat_bonus:damage:cold+1d6`; Boots of Striding and
  Springing is `set_override:speed:30:floor`; the Robe of the Archmagi is a GUARDED expression set,
  `not is_wearing_armor ? set_override:ac:15+dex_mod` (a set_override is not limited to a literal — the
  test pins AC 15).
  **Edition divergences found in the shipped text, kept rather than smoothed:** 2014's Armor of
  Invulnerability resists "nonmagical damage", which is not a type the vocabulary can NAME, so it stays
  a note while 2024's b/p/s folds; 2014's Scarab of Protection has no +1 AC (that is a 2024 addition),
  so only 2024 folds one. **Content gap noticed, not fixed:** several 2014 rows ship with an EMPTY
  `text_en` (`vorpal_sword`, `rod_of_alertness`, `dragon_scale_mail`, `boots_of_striding_and_springing`,
  `talisman_of_pure_good`) and `frost_brand`/`brooch_of_shielding` are truncated mid-sentence — those
  editions were skipped rather than authored from memory (the no-invented-data rule).
  **New gate:** `items_content.test.ts` now runs EVERY shipped item token through a real `deriveSheet`
  and demands no `unknown target` issue — a known kind with a dead target parses fine and then folds
  onto nothing, which the "known kind" check alone never caught.
  **App-verified (first tranche):** demo Karroth's attuned Cloak now
  reads AC 14 → **15** with "Cloak of Protection +1" in the trace, and every save +1
  (`design-preview/magic-item-efx.png`).

  **THIRD AND FOURTH PASSES DONE — 24 rows in 2014, 55 in 2024, and the item closes.** The largest
  family had been skipped entirely: the **+N weapons**, which fold through the D9 per-weapon path, so
  a +2 sword raises its OWN to-hit and damage and no other weapon's (asserted against a plain longsword
  in the same hand). Sun Blade, Defender, Dragon Slayer, Giant Slayer, Dwarven Thrower, Nine Lives
  Stealer, Scimitar of Speed, Dagger of Venom, Luck Blade, Mace of Smiting, the four staves and the Rod
  of Lordly Might. Armour and shields gained their AC, the Staff of Power pays out on all five stats its
  text names, and the **Bracers of Archery are the first user of the widened `grant_proficiency`** —
  longbow and shortbow proficiency plus a `damage.<weapon_id>`-scoped +2 that the dagger in the other
  hand does not pick up.

  **Where the line falls now, and why it is the right place to stop:** every remaining untokenized row
  either states no passive benefit at all (a potion, a rope, an item with its own stat block), or names
  one the vocabulary cannot NAME — a GM-chosen damage type, "+2 AC against ranged attacks", a bonus set
  by the row's own rarity — or one gated on a state the app does not hold (a helm that still has a ruby,
  a sworn enemy, a linked Elemental Plane). Those carry a `note:` instead, so the sheet says the thing
  rather than staying blank.

  **One RAW shape the engine cannot say, recorded rather than fudged:** "your Constitution increases by
  2, to a maximum of 20" (Belt of Dwarvenkind). Within a layer the fold order is set → floor → cap →
  mult → add, so a `set_override:con:20:cap` fires BEFORE the `+2` and does nothing; a self-referencing
  expression (`min(con_score+2,20)`) is correctly refused as a dependency cycle. The belt folds its +2
  and its note states the ceiling, which the player applies with the manual override every value
  already has. One row per edition needs this, so it buys no machinery.

  **FIFTH AND SIXTH PASSES — the 2014 half catches up.** The pass above stopped where the 2014 pack
  ran out of readable text; ITEM-TEXT-2014 (below) fixed the extractor, and the rows it unlocked were
  then authored against their own SRD 5.1 text: Vorpal Sword, Dragon Slayer, Giant Slayer, Dwarven
  Thrower, Mace of Smiting, Luck Blade and Staff of Striking take their +N, Dwarven Plate and Dragon
  Scale Mail their AC, Frost Brand its cold rider and fire resistance, the Rod of Alertness its two
  advantages. Each lands on the token its 2024 twin already carried — the asymmetry WAS the missing
  text, not an edition divergence.

  **54 charged items now say their pool** rather than describing it — every wand, most staves, the
  rings, the trident — generated from the sentence that states the count and the dawn recharge, then
  read back one by one against that sentence. A random starting pool ("1d8 + 1 charges") is
  deliberately not matched: the vocabulary takes a literal max. Two items with no recharge in their
  text say `consumable` rather than borrowing a dawn nobody wrote.

  **Coverage: 2014 went 54 → 113 rows with effects, 2024 96 → 126.** What remains is consumables
  (potions, oils), objects with their own stat block (a mirror, a fortress, an iron flask) and
  benefits the vocabulary cannot name — none of them a passive benefit while worn, wielded or attuned.
- [x] **ITEM-TEXT-2014 · the 2014 pack has its item descriptions back.** 89 magic rows shipped with
  an EMPTY `text_en` and two more were cut mid-sentence, so a fifth of the pack could never be given
  effects — there was nothing to read them off.

  **The extractor was dropping them, and the source had them all along.** `convert-2014.mjs` built
  `text_en` from the paragraphs that do NOT contain an `<em>`, because the italic type line lives in
  one. In SRD 5.1 the description usually shares that paragraph with the type line, so the filter took
  the entry with it — and a body paragraph that merely italicises a spell name went the same way. The
  fix strips the meta span out of its own paragraph and keeps everything else.

  **Re-running the converter needed the documented care** (`AGENTS.md` ▸ Re-running a converter):
  it rewrote eleven files it had no business changing, `conditions_srd.csv`'s `max_level` among them,
  so every file but `items_srd.csv` was checked out again. `existingEffectsById` did its job — all 54
  previously authored `effects` cells survived the regeneration untouched.

  **Guarded by a COUNT, not a sample:** `items_content.test.ts` demands that no magic item in either
  pack ships with an empty description. The failure was silent and wholesale, so the assert has to be.

- [ ] **MAGIC-ITEM-VOCAB · the magic items that are still prose, and the vocabulary each one wants —
  0.8.0.** MAGIC-ITEM-EFX folded everything the bounded vocabulary can already SAY (239 rows). What is
  left is not unauthored: it is items whose text states a real, passive, mechanical benefit that the
  vocabulary has no way to name. Each carries a `note:` today, so the sheet says the thing and the
  player applies it by hand. Grouped by the gap, because the gap is the work — the rows follow for
  free once it closes.

  1. **A QUALIFIER on a defence** (~12 rows, both editions). "Advantage on saving throws against
     spells" (Mantle of Spell Resistance, Ring of Spell Turning, Spellguard Shield, 2014's Scarab of
     Protection), "+2 AC against ranged attack rolls" (Arrow-Catching Shield), "resistance to damage
     from Ranged weapon attacks" (Shield of Missile Attraction), "advantage on saves to avoid the
     Poisoned condition" (Necklace of Adaptation, Periapt of Health). A bare `advantage:saves` folds
     far too broadly, which is exactly why these stayed text.
     **Shape: reuse SCOPED-BONUS's decision** — the qualifier lives in the TARGET namespace, not in a
     new segment (`advantage:saves.spell`, `flat_bonus:ac.ranged+2`,
     `damage_sensitivity:resist:ranged_weapon`), over a CLOSED qualifier set (spell · magical ·
     ranged_weapon · poison · breath). The roll path already matches scopes; what it lacks is a scope
     for the thing coming AT you, which is the design half.

  2. **A choice the ITEM asks, answered per instance** (~8 rows). Ring of Resistance, Armor of
     Resistance and Potion of Resistance name a damage type the GM picks; Armor of Vulnerability picks
     one of three; Dragon Scale Mail's resistance follows the dragon; Ring of Elemental Command follows
     the plane.
     **Shape: D16's "player choice at a slot", pointed at an inventory row rather than a build slot.**
     The answer belongs on `build.inventory[]`, NOT on the content row — two Rings of Resistance in one
     party are different rings, and the content row is shared. Nothing stores a per-instance answer
     yet; that is the whole of this piece.

  3. **A bonus the row states as a RANGE** (10 rows). `weapon_1_2_or_3`, `armor_1_2_or_3`,
     `shield_1_2_or_3`, `ammunition_1_2_or_3` and `wand_of_the_war_mage_1_2_or_3`, in both editions —
     one row standing for three bonuses. **These are the most-used magic items at a real table**, which
     is what earns them a place here over rarer rows that fold.
     **DECIDED: the same per-instance answer as (2), not three rows per item.** A player does not own
     "a Weapon +1", they own a +1 Longsword — and the SRD prints ONE entry per kind, so one row is what
     is faithful to the book. Three rows would also fix a lie in three places instead of removing it:
     every one of these rows says `rarity: very_rare` today, which is already wrong for its +1 and +2.
     **It costs almost nothing, because the tokens exist.** Holy Avenger and Dwarven Thrower already
     carry `flat_bonus:attack+3;flat_bonus:damage+3` in their own `effects` column. So this is one
     field on `inventoryEntry` beside `base`, the chooser the row already shows for a template, and
     `resolveItem` emitting those two tokens from the answer (`flat_bonus:ac+N` for armour and shield).
     No new grammar.
     **Rarity comes from the pair (category, N), not from N**: armour runs rare → very rare →
     legendary while the other four run uncommon → rare → very rare. A five-row table, and it changes
     no number on the sheet — rarity is a browsing fact.
     **A named magic weapon is not in scope and needs nothing**: the `+1/+2/+3` row is "Any Simple or
     Martial", a MUNDANE base, and Holy Avenger already states its own +3 and its own `legendary`.

  4. **A climb speed** (2 rows). There is `speed.fly` and `speed.swim` and no `speed.climb`
     (Slippers of Spider Climbing, Gloves of Swimming and Climbing). **Sized: ~8 lines and two catalog
     strings** — one entry in `NUMERIC_TARGETS`, one field on `CharacterSheet` fed by the existing
     `movementOf`, a third chip beside the two already in `SheetDefenses`. No decision in it; the
     shape exists three times.
     **One tail that is NOT that shape:** both items say "a Climb Speed equal to your Speed", an
     expression over another speed. The ctx exposes `base_speed`, which is the species' base BEFORE
     effects — close, but a character under Longstrider or in heavy armour would read wrong. Either
     the ctx grows the effective speed, or these two keep a note while `speed.climb` serves the
     literal-value items.

  5. **Senses — two questions for the design session, and they are yours** (~14 rows: Goggles of
     Night, Eyes of Minute Seeing, Crystal Ball of True Seeing, the Belt of Dwarvenkind's darkvision,
     nine species). `darkvision`, `truesight`, `blindsight` and `tremorsense` appear NOWHERE in
     `src/` today — not a target, not a sheet field, not a catalog string. So the token is the easy
     half and the answer to these two is what decides its shape:
     **DECIDED: a sense is a MECHANIC, and it is a chip on the Defenses card.**
     Mechanic, because two sources of darkvision take the GREATER range — a species' 60 ft under
     Goggles of Night's 120 ft is 120 ft, which is stacking, and stacking is what `note:` cannot do.
     So `senses.<name>` is a numeric target folding by max.
     The card needs no new vocabulary: the premise that "a sense is a name plus a range, and this card
     speaks in chips" was wrong — `SheetDefenses.svelte` already carries `fly 30 ft` and `swim 30 ft`
     as exactly that chip, next to the damage sensitivities, under a comment calling the card "what is
     true of your body". A sense chip is the same shape beside them.

  6. **Attack rolls made AGAINST you** (Cloak of Displacement, both editions). The engine models the
     dice YOU roll: `rollEffectsFor` takes the rolling thing's scopes, and an attack aimed at you has
     none of them. So this wants a second, small fact channel — "what an attacker rolling at me gets"
     — that the sheet displays and the roller never folds, since we do not roll the monster's dice.
     Cheapest first cut is display: the sheet says "attack rolls against you have disadvantage" where
     it already says what is true of your body, and no roll changes.

  **What will never fold, and should stop being counted as missing:** consumables (potions, oils —
  drinking is not a modelled event), objects with their own stat block (Mirror of Life Trapping,
  Instant Fortress, Apparatus of the Crab, Iron Flask), and summon items (Horn of Valhalla, Deck of
  Many Things). These are complete as prose.

- [ ] **D6 / D10 / E4 · mechanics from prose → columns.** `effectHint`/`healDice`/`durationToRounds`/
  `castingIcon` hardcode spell names EN-only; most SRD spells still ship EMPTY `effects` columns (E4)
  so there are no tokens to summarize. Tracked live under UBUG-9 (the caption idea) — E4 is its blocker.
- [x] **RES-NAME · a resource pool has a NAME of its own.** `ResourceDef.name` was `titleCase(id)`,
  which is wrong for exactly the pools that matter (2024 `focus` is "Focus Points", 2014 `ki` is "Ki
  Points") and could never be translated. A `resource` content type carries it; `resource-names.ts`
  resolves id→name once per derive so pools and their spend-options cannot disagree; the engine
  keeps `titleCase` as the fallback, so a name is something content ADDS. **The name never belonged
  to the grant** — `bardic_inspiration` is granted by two features — so it is not a token segment
  and not a column on the granting feature. Translation reaches it because the Translate view asks
  `hasProse(type)`, not `isBrowsable`.
- [ ] **B11 · size-cap on `Storage.read()` — LOCAL reads only, which is why it stays YAGNI.** The
  path that mattered is already capped, by REL-4: `MAX_REMOTE_BYTES` (8 MB, one response),
  `MAX_PACK_FILES` (200) + `MAX_PACK_BYTES` (50 MB) read off the tree listing before a byte is
  fetched, and a whole-run `MAX_PREFETCH_BYTES` budget (`content/remote/types.ts`). What B11 would
  add on top is `size` on `FileEntry` (still absent, `storage/types.ts`) plus a cap in every storage
  impl — guarding a file the USER put in their own dataDir, which is not a trust boundary and is
  precisely where a cap rejects legitimately-large homebrew. Recorded, not queued.
- [x] **B24 · granular per-file watcher reparse — measured, then answered the cheap way.** A full
  reload of both shipped packs is ~90 ms for 2866 rows, so incremental parsing is a **won't-do**:
  it would rebuild `articles`, `byEffectiveId`, locale discovery and `resolveRefs` incrementally,
  every one of which spans files. What was genuinely wrong is fixed — the watcher filters on
  `isPackFile`, the same predicate that decides what a pack ships, so an editor's temp files no
  longer cost a full rebuild and the watcher cannot disagree with the pack differ.
- **UBUG-9 · Spell-block summary caption is weak for non-damage spells (think about).** The bold
  caption per spell row (`SpRow.spe` = `dmg || effectHint(row.data)`) is great for damage (`1d10 fire`)
  but for the rest it's mostly a flat "utility" — except a few HAND-CURATED cases (`effectHint`
  hardcodes `mage hand`→"utility", a self-range teleport→"teleport" so Misty Step reads well, etc.).
  Goal: that descriptive style EVERYWHERE (Misty Step "teleport", Mage Armor "set AC 13", Bless
  "+1d4 attacks & saves"…), not a generic "utility". This is AUDIT **D6** (`effectHint` hardcodes
  spell names, EN-only, against the data-driven grain). **Idea to explore:** derive the caption from
  the spell's EFFECT TOKENS via the existing engine (parse `flat_bonus`/`set_override`/`apply_condition`/
  `speed`… into a short human phrase) instead of a hardcoded name list — the engine already parses these
  into typed facts, so a `factsToSummary(facts)` could render "set AC 13" / "+1d4 saves" / "teleport"
  data-drivenly + localized. Blocked partly by **E4** (most SRD spells still ship EMPTY `effects`
  columns — no tokens to summarize yet); until encoded, a per-spell content `summary_*` column is the
  fallback. Cross-ref D6 + E4.
- [x] **REL-3 · Desktop content re-seed on update.** A `CONTENT_SEED_VERSION` marker re-seeds
  shipped files on update, preserving any the user hand-edited (hash drift). The "bump it whenever
  shipped SRD data changes" rule lives on the constant itself (`schema/version.ts`).
- [x] **REL-4 · Content packs from a URL.** Paste a repo URL, install its packs, update them without
  an app build — and the shipped SRD is one of those packs, which is what took rules data out of the
  release cycle. Design of record: `docs/internals/packs.md`, with `plugins.md` for the plugins that
  ride along and `security.md` §5/§7 for the network and consent boundaries. Code comments name
  slices; git holds what each one did.
- [x] **UBUG-4 · a desktop install had no content folders.** Desktop now seeds the shipped CSVs
  into `<dataDir>/content/` on first run and loads from there; web still reads the bundle over
  fetch. Hand-edited files survive seeding by hash drift. Verified on a real install.
- **UBUG-4b · Tauri .msi install has no content folders.** After installing the built `.msi`, there's
  no `content/` (CSV) directory created, so the app has no data. First-run on desktop must create the
  dataDir + seed the shipped SRD content (the `static/content` bundle) into it (Tauri fs). Wire the
  first-run seed / resource-copy in the Tauri layer. (Relates to `dataDir` resolution + the Storage
  seam — the web target seeds via fetch; desktop needs the equivalent copy-on-first-run.)

## Data versioning
- **DATA-VER-1 · content versioning — BUILT (2026-07-06, tasks 1–5; task 6 closed 2026-08-14).**
  Design-of-record: a
  `#content-<key>:` directive header block (leading comment lines before the CSV column row) carries
  per-FILE `type`/`source`/`systems`/`url`/`license`/`id`(uuidv7)/`updated-at`/`schema`/`hash` — the
  per-row `source`/`systems` COLUMNS are dropped (the file is the unit of source+edition; split files
  for mixed). Shipped: `content/meta.ts` (`parseContentDirectives` / `checkFileMeta`→`MetaIssue`),
  `content/hash.ts` (`xxhash-wasm`, normalized-body `xxh64:` hash = the change DETECTOR, Excel-resave
  safe), `FileEntry.mtime`, all SRD CSVs migrated (2815 rows, 0 metaIssues / 0 drift), and the loader
  surfaces `graph.metaIssues` / `driftItems` → `ContentMetaModal` (missing required source/license)
  + `HashDriftModal` (body edited after the last stamp), per-session dismiss. Missing meta never
  hard-blocks — machine keys (id/hash/updated-at/schema/type) auto-fill; human keys (source/license)
  prompt; a missing `systems` defaults to both editions.

  **Task 6 — the write-back — DONE 2026-08-14.** Both dialogs' confirm buttons now write
  (`content/restamp.ts`); the in-app authoring stamp had already landed with Editor mode
  (`homebrew.ts`). Four things about it are decisions, not implementation details:
  - **It re-stamps a file the app did not create, deliberately.** The neighbouring invariant is "the
    app writes only files it owns", and it exists so a hand-edit is never silently clobbered. Here
    the user has ASKED and only the two stamp lines move. Without it a drifted file is unfixable
    from inside the app — `isProtectedFromOverwrite` refuses to refresh anything failing its own
    hash, so the file freezes at whatever it drifted to and the only cure is a terminal command, in
    a project built for people who do not have one.
  - **ONE stamping function, shared with `pnpm restamp`**, so a file stamped from the terminal and
    one stamped from the UI are byte-identical and the load-time check agrees with both.
  - **The original BOM + EOL survive byte-for-byte.** A pack diff compares git blob SHAs, so
    rewriting 2000 line endings to fix one header line would report the whole file as changed
    against a repo where nothing moved — the same trap `core.autocrlf` sets (content.md ▸ The content
    repo), re-created from inside the app.
  - **"Don't ask again" is content-editing mode**, a persisted setting (`app.contentEditingMode`)
    that adopts a hand-edit instead of asking AND mutes both prompts — and is reachable again in
    Settings ▸ Content health, because an answer must not be a door that locks behind you (the same
    rule as REL-4's `dismissedMissing`). Auto-adoption skips a pack mid-swap: an apply re-checks disk
    state before its rename, so an unattended stamp landing mid-swap would cancel a user's update.
  - **`CONTENT_MIGRATIONS` is wired with an EMPTY registry** (`content/migrations.ts`), and the
    reason is not "somewhere to put future steps": a pack declaring a schema this build never heard
    of used to load in silence and render whatever its columns happened to mean here. It is now a
    content-health warning, and the rows still load — flagged beats silently reinterpreted. The unit
    is a FILE (the version is declared once in its header); absent ⇒ current, so a hand-authored CSV
    is not asked to migrate.

  Web is read-only and now says so by NOT prompting: it still detects both conditions and lists them
  in content health, but a dialog whose only button cannot work is worse than no dialog. Git holds
  the full design log (per-key rules, fill-classes, drift copy).

- [x] **2014 casting data.** 2014 **spell_slots** emitted (the full/half/pact matrices are
  edition-identical — spell_slots.test asserts `full`==core — so re-tagged 5e). 2014 casters
  (caster=full/half/pact → the derive's `slot_table ?? caster` lookup) now get their slots.
  Remaining: 2014 **class_casting** counts — **scoped 2026-08-09, and it's smaller than written.** The
  PREPARED half already works: `preparedCap` falls back to the 2014 formula (`abilityMod + effective
  level`, min 1) whenever a table value is absent, so a 2014 cleric/druid/wizard is already right. What's
  missing is purely DATA: `content/srd-2014/class_casting_srd.csv` **doesn't exist**, so every 2014 caster
  reports **cantripCap 0**, and known-casters (bard/sorcerer/warlock/ranger) get the prepared FORMULA
  instead of their table's "Spells Known" (a 2014 bard 1 should read 2 cantrips / 4 known, not 0 / CHA+1).
  **DONE** — `tools/srd/convert-2014-casting.mjs` emits all 140 rows (seven casters × 20 levels;
  paladin has neither column in 2014). The converter route was the right one after all: the source is
  HTML, where every class table is a real `<table>` of `<td>` cells — the space-aligned form is the
  `.txt` beside it, which nothing reads.
  **The trap was the header, not the numbers.** Four of the seven classes split "Cantrips Known"
  across two header rows ("Cantrips" above, a bare "Known" below) while the rest keep it whole, and
  the warlock table carries a THIRD Known column — Invocations Known — that is not a spell count. So
  a column is found by the whole spelling where it exists and by position otherwise, never by
  trusting one header string, and each run prints every ladder for a human to read against the book.
  The numbers are pinned literally in `class_features_content.test.ts`: a bard 1 reads 2 cantrips /
  4 known, a sorcerer 20 reads 6 / 15. Prepared casters get only the cantrip half — 2014 has no
  prepared-spells column, that is a 2024 invention, so the formula still owns the rest.

- [x] **BEAST-DATA · a beast row can fight, and the 2014 pack has its animals.** All three holes
  closed, in the converters:
  - **`attacks` is a column in both editions**, written as
    `<name>:<+hit>:<reach or range>:<dice> <type>[, <dice> <type>]`, attacks joined by `; ` — a
    compound column with its own grammar, like `damage` (`tools/srd/lib.mjs ▸ attackRecord`). A
    second damage part is taken only after the word "plus", which is how both SRDs write damage that
    is ADDED; every other number later in the sentence is an alternative (a versatile grip, a swarm
    at half HP) or a condition, and folding those in gave a veteran's longsword both of its dice at
    once. Three creatures in each pack carry no attacks, and all of them have none in the source (a
    shrieker, a frog, a sea horse).
  - **The 2014 pack ships 317 creatures, not 201.** SRD 5.1's monster CHAPTER is what the Tabyltop
    JSON holds, and it contains no ordinary animals at all — every one of them is in Appendix MM-A
    "Miscellaneous Creatures" (95 stat blocks) and MM-B "Nonplayer Characters" (21), which live only
    in the HTML and had never been converted. So the doc's earlier claim that 5.1 has "no separate
    appendix" was wrong, and with it the belief that the missing wolf was a licence gap. A 2014
    druid now has 74 beasts at CR ≤ 1 to choose from where it had none.
  - **2014 states its saves and damage defences.** `str_save`…`cha_save`, `resistances`,
    `immunities` and `vulnerabilities` come off the JSON's own fields and the appendix's own
    paragraphs, so the two editions' monster schemas no longer differ.
  - **The JSON is lossy and the HTML is the check.** Fifteen chapter entries carry an empty `actions`
    array and a few descriptions are typo'd past Tabyltop's own parser ("H it:10 (2d6 + 3)"), so a
    chapter row with no attacks from the JSON is filled from the same document's HTML. Same source,
    same rules — a value is either in it or absent, never guessed.

- [x] **MONK-MOVEMENT · Unarmored Movement's ladder is in the row.** Every monk from level 2 to 20
  walked at 30 feet: the feature's text says "+10 feet" and then defers to the Monk table, so the row
  carried no token at all. It needed no class-tables-as-data pass — `step()` IS the table, which
  `monk_martial_arts` already shows by carrying its die ladder off that same table. Both editions
  print the same rungs (`step(class_level.monk, 2->10, 6->15, 10->20, 14->25, 18->30)`, read off each
  edition's own progression table), under the armour guard `monk_unarmored_defense` already uses.
  `class_features_content.test.ts` pins all eight rungs per edition.

- [x] **Tauri fs Storage** impl + platform factory.

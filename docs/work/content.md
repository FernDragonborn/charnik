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
- [ ] **MASTERY-HALF · weapon mastery is half-modelled.** The WEAPON half is data and shipped: every
  2024 weapon carries its one mastery property as `mastery:<name>` (5.5e only — 2014 has no such
  rule, so only the 2024 converter writes it). The CHARACTER half does not exist: RAW the property
  does nothing until a feature unlocks it, and the five SRD classes that grant Weapon Mastery at
  level 1 each unlock it for N kinds of weapon of the player's CHOICE, N growing per the class table
  and one swappable on a long rest. That is build state (`build.masteries`, re-editable at level-up
  like every other chosen option) plus the eight mastery effects, none of which exist.
  `versatile:1d10` is the same shape: data with no mechanic reading it.
- [ ] **STRUCTURE-FROM-TEXT · facts that still sit in prose and would be better as columns.** None
  block the loader; each raises fidelity where the UI later wants a structured filter. In priority
  order: species ability bonuses as `effects` (`flat_bonus:con+2`) rather than only prose — 5e on
  the species, 5.5e on the background; a monster's `saving_throws`, `damage_resist/immune`,
  `condition_immune`, `legendary_actions` and `proficiency_bonus`, all of which live in `text_en`
  today; and `resource` on class features (rage and ki counts), currently unparsed. Each arrives
  through a `schemaVersion` migration, and each number comes from the converter, never from memory.
- [ ] **SUBCLASS-LEVEL-2024 · every 2024 subclass unlocks at level 3**, but the seeded
  `subclass_level` carries the 2014 value. Wants a per-system override column rather than a second
  row.

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

  **Still not authorable: the 89 magic rows in the 2014 pack that ship with an EMPTY `text_en`**
  (`vorpal_sword`, `gloves_of_thievery`, `weapon_of_warning`, `mithral_armor`, `winged_boots`…). There
  is nothing to read them off, and nothing here is written from memory — which is also why the 2024
  pack got more than twice as many rows in this pass. Extracting that text is a CONVERTER job, not an
  authoring one; it is filed as its own item below.
- [ ] **ITEM-TEXT-2014 · 89 magic items in the 2014 pack ship with an EMPTY `text_en`.** The row
  exists, with its category, rarity and cost — and no description at all: `vorpal_sword`,
  `rod_of_alertness`, `gloves_of_thievery`, `weapon_of_warning`, `mithral_armor`, `winged_boots`,
  `dragon_scale_mail`, `boots_of_striding_and_springing`, `talisman_of_pure_good` and eighty more.
  A few others (`frost_brand`, `brooch_of_shielding`) are truncated mid-sentence.

  **It is a CONVERTER job, not an authoring one.** SRD 5.1 has the text; the 2014 extractor did not
  pick it up — the same class of miss as the "Extra A ttack" OCR artifact that cost the 2014 paladin
  its Extra Attack row. Writing the descriptions by hand is exactly the invented-data failure
  `AGENTS.md` names, so it waits for the extractor rather than for a patient afternoon.

  **What it currently blocks:** every one of those rows is unauthorable for MAGIC-ITEM-EFX, which is
  why the 2024 pack got more than twice as many tokenized rows in the same pass. Closing this reopens
  a fifth of the 2014 magic items for tokens.

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

- [ ] **BEAST-DATA · a beast row cannot fight, and the 2014 pack has almost no beasts.** Two
  holes, both found writing [`../research/wild-shape.md`](../research/wild-shape.md), both blocking
  N2b and 2024 Primal Strike:
  - `monsters_srd.csv` has **no attacks column in either edition** — a stat block's attacks live in
    `text_en` prose. Every other combat number (ac, hp, the six scores, cr, speed, senses, skills) is
    a declared column, so this is the one place the monster schema stops being data. Reading them out
    of the prose in `src/` is the thing AGENTS.md forbids; the column is authored, in both editions.
  - The 2014 pack ships **four** beasts — stirge (CR 1/8, flying), plesiosaurus (CR 2), triceratops
    (CR 5), tyrannosaurus (CR 8). A 2014 druid may take CR 1/4 with no flying or swimming speed at
    level 2, so **no legal form exists at levels 2-7**. The wolf, crocodile and giant eagle its own
    Beast Shapes table names are not in the file. 2024 ships 69 beasts at CR ≤ 1, so this is a 2014
    conversion gap, not a licence one.
  - Related asymmetry worth fixing in the same pass: 2014 monsters carry no `*_save` and no
    `resistances`/`immunities`/`vulnerabilities` columns, which 2024 does. The 2014 Wild Shape rule
    "use the creature's bonus if it is higher" has data for skills and none for saves.

- [ ] **MONK-MOVEMENT · Unarmored Movement's ladder is not in the row.** The feature's shipped text
  says "+10 feet" and then defers to the Monk table for the increase, and that table is not in the
  cell (nor anywhere else in the pack). So the token is unwritable: a bare `flat_bonus:speed+10`
  would be silently wrong from level 6 up, which is the failure class that passes every gate. Same
  shape as the 2014 casting counts above — a class TABLE the pack does not carry — and cheapest to
  fix in the same pass, since both want the same thing: the per-level class tables as data.

- [x] **Tauri fs Storage** impl + platform factory.

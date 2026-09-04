# Content and data — open work

> Tracker. Shipped rows, converters, packs and versioning. The rules are
> [`../internals/content.md`](../internals/content.md) and [`../internals/packs.md`](../internals/packs.md); the
> ORDER is [`plan.md`](../plan.md) ▸ Implementation order.

- [~] **MAGIC-ITEM-EFX · Tokenize the shipped SRD magic-item effects (GLOBAL content task,
  surfaced by DEMO-1 gap 2, 2026-08-04).** **FIRST TRANCHE DONE 2026-08-09 — 14 items × both editions,
  each read off that edition's own SRD text.** The plumbing was already there (an `effects` column,
  equipped/attuned rows flowing through `gatherEffects`); every magic-item row simply shipped EMPTY.
  Authored: Cloak/Ring of Protection (`flat_bonus:ac+1;flat_bonus:saves+1`), Stone of Good Luck
  (`ability_checks`+`saves`), Amulet of Health / Headband of Intellect / Gauntlets of Ogre Power
  (**`set_override:<abil>:19:floor`** — the FLOOR mode matters: RAW "no effect if already 19 or higher",
  and a plain set would drag a 20 down), Ring of Swimming (`set_override:speed.swim:40`), Boots of the
  Winterlands (`resist_immune:resist:cold`), Boots/Cloak of Elvenkind + Eyes of the Eagle (Stealth /
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
  shipped text. Named damage types fold (`resist_immune:resist:<type>` — Staff of Fire/Frost, Brooch of
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
  (`design-preview/magic-item-efx.png`). **REMAINING (the `[~]`):** the other ~240 magic items — mostly
  charges/activated procedures (RECHARGE-3), GM-chosen variants (Ring/Armor of Resistance),
  weapon-scoped bonuses (the open §A `damage:<qualifier>` gap) and the generic +1/+2/+3 rows that need
  one row per tier.
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

- [~] **2014 casting data** — 2014 **spell_slots** now emitted (the full/half/pact matrices are
  edition-identical — spell_slots.test asserts `full`==core — so re-tagged 5e). 2014 casters
  (caster=full/half/pact → the derive's `slot_table ?? caster` lookup) now get their slots.
  Remaining: 2014 **class_casting** counts — **scoped 2026-08-09, and it's smaller than written.** The
  PREPARED half already works: `preparedCap` falls back to the 2014 formula (`abilityMod + effective
  level`, min 1) whenever a table value is absent, so a 2014 cleric/druid/wizard is already right. What's
  missing is purely DATA: `content/srd-2014/class_casting_srd.csv` **doesn't exist**, so every 2014 caster
  reports **cantripCap 0**, and known-casters (bard/sorcerer/warlock/ranger) get the prepared FORMULA
  instead of their table's "Spells Known" (a 2014 bard 1 should read 2 cantrips / 4 known, not 0 / CHA+1).
  Fix = the rows, in the same shape 2024 already ships. **A converter is no longer assumed to be the
  route** — the 2014 tables are space-aligned text where a parser slips a column and the numbers go
  wrong SILENTLY, and the remaining 2014 gaps (these counts, the tables `convert-2014.mjs` drops, the
  truncated feature prose) are small enough to author by hand against the source and cheaper to
  verify than to parse. Whichever route: the numbers land with a per-class assert against the SRD
  text, because this is the failure class that passes every other gate.
  Also still open: backfilling the truncated 2014 class-feature prose, and the tables lost with it
  (N2b names the same bug).

- [x] **Tauri fs Storage** impl + platform factory.

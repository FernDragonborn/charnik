# Full-project audit — 2026-07-14

Findings from a whole-`src/` correctness audit (rules math verified against SRD 5.1 / 5.2.1,
invariants checked against CLAUDE.md + PLAN.md, CSS against the token contract, shipped data
against the schemas). All quality gates were GREEN when these were found — none of this is
covered by lint/tests yet, which is exactly why it's catalogued here.

**IDs are stable** (`A2`, `B6`, …) — they're referenced in planning discussions; don't renumber.
Status: `[ ]` open · `[~]` partially done / decided · `[x]` fixed. When an item graduates into
real work, tick it here and (if it grew a design) move the design into PLAN.md proper.

---

## A · Rules-math bugs (pure core — wrong numbers on the sheet)

- [ ] **A1 · Heavy armor + negative DEX lowers AC.** `rules/core.ts armoredAC` does
  `Math.min(dexMod, dexCap)`; heavy-armor rows carry `armor_dex_cap = 0`, so DEX 8 gives
  chain mail AC 15. RAW (both editions): heavy armor **ignores** Dex entirely. Fix:
  `dexCap === 0` ⇒ Dex contribution is 0 (medium armor with negative Dex stays as-is — RAW
  applies it). Add golden test: chain mail + DEX 8 = AC 16.
- [ ] **A2 · Multiclass max-die HP overcount.** VERIFIED both editions, rule identical
  (PHB'14 / PHB'24 multiclassing): the max-die level-1 HP is granted **once per character** —
  for level 1 of the FIRST class; level 1 of every later class uses avg-rounded-up + CON.
  `character/derive.ts` calls `maxHpForClass` per class, so every class gets its max die →
  Fighter 3 / Wizard 2 is +2 HP high. Fix shape (decided): `maxHpForClass` gains an
  `includesCharacterLevel1` flag, true only for `build.classes[0]`; pin in PLAN that
  `classes[0]` MEANS "the class taken at character level 1" (BuildVM already preserves index
  0). No system branch needed. NB the hit-dice POOL (short rest, → B2/UBUG-1) is per-die-type
  across classes in both editions — the existing `hitDiceSpent: Record<die, n>` shape already
  matches.
- [ ] **A3 · Heavy-armor `str_min` ignored.** The column is loaded (13/15 in SRD items) but
  derive never applies the −10 ft speed penalty nor emits an explainability note.
- [ ] **A4 · `stealth_disadvantage` is display-only.** Never reaches Stealth rolls (blocked on
  the disadvantage vocab gap, → A5/EFX-1).
- [x] **A5 · `disadvantage` missing from the effect vocabulary.** FIXED 2026-07-15 (EFX-1):
  full kind (parse/apply-note/flags/rollEffectsFor + `netAdvantage` cancel rule); passives take
  ±5 from adv/dis on the underlying check.
- [x] **A6 · `grant-proficiency:skill.<id>` silently dropped.** FIXED 2026-07-15 (EFX-1):
  `parseEffect` canonicalizes the target in ONE place (`skill.` strips, `save.` stays); the
  granted level is a single ladder value (`proficient`/`expertise`), never two booleans.
- [ ] **A7 · Attack-row heuristics (minor).** `computeAttacks` adds proficiency
  unconditionally (no weapon-proficiency check — if this is deliberate leniency, say so in
  PLAN); `parseDamage` would double-count a bonus die in a "2d6+1d4"-style damage string
  (first `[+-]\d` parsed as the flat mod) — not triggered by current SRD data, fragile.

## B · Unfinished invariants (CLAUDE.md/PLAN promise it; code doesn't do it)

- [x] **B1 · Effect duration auto-expiry not implemented.** FIXED 2026-07-15 (EFX-4):
  `nextTurn` expires round-timed effects with a toast (an expiring cast-linked effect also ends
  its concentration); rests expire what they outlive (short = ≤ 600 rds, long = all timed);
  the panel shows REMAINING rounds and typed durations re-anchor to "from now".
- [ ] **B2 · Dead play-state fields: `hitDiceSpent`, `deathSaves`, `exhaustion`.** Schema-only;
  no UI, no logic. Short rest can't spend hit dice (see UBUG-1 — same work), long rest doesn't
  restore them, death saves have no tracker, exhaustion levels have no effects.
- [ ] **B3 · No rotating backups for character.json.** Atomic temp→rename exists
  (`storage/tauri.ts writeBytes`); the "autosave + rotating backups" invariant's backup half
  doesn't.
- [ ] **B4 · Roll log never persisted.** `appendLog`/`readLog` (repository.ts) are used only by
  tests; the RollTray log is in-memory, `log.jsonl` is never written. Also `appendLog` is
  read-all + rewrite, not an append (fine while unused; fix when wiring).
- [ ] **B5 · Two-dimensional source filtering applied only in the compendium.** `isRowActive`
  has exactly one call site. Ctrl+K search (CommandPalette/search docs), ALL builder pickers
  (species/class/feat/spell/item/language), and the spellbook show rows from disabled
  files/sources and the losing side of resolved collisions.
- [~] **B6 · Source/collision config lives in localStorage, not the dataDir.** DECIDED
  (2026-07-14): move it behind the Storage seam as files in the dataDir
  (`collisions.json` + the source toggles; desktop = real file, web = same code path via
  BrowserStorage/IndexedDB). Main motive: the data-folder move/merge feature copies the
  dataDir but silently loses these settings; also WebView2-profile storage dies on
  reinstall/webview-data clear, and a plain JSON next to the CSVs matches "own your data".
  Watcher only watches `content/`, so a root-level config file can't cause a reload loop.
  Load becomes async — fold into the existing async startup.
- [ ] **B7 · Units invariant half-done.** ft→m only for speed (CombatStrip); lb→kg nowhere
  (no ×0.4536 in the codebase); `carryingCapacity` is computed by derive but rendered NOWHERE,
  and the optional-capacity toggle doesn't exist.
- [ ] **B8 · i18n drop-in is fiction; coverage narrow.** Catalogs are bundled via a Vite
  template import (`i18n/index.ts`), so "drop in a locale JSON without a rebuild" doesn't work
  despite the module comment claiming it. `$_()` is used in ~10 files; the build page, combat
  blocks, most dialogs and `buildIssues` messages are hardcoded EN.
- [ ] **B9 · Rule-based blocks/penalties absent.** The notes/trace infra exists, but no rule
  emits a block (e.g. "spellcasting blocked: wearing armor without proficiency" — PLAN's own
  example). Related: passives never receive the ±5 advantage/disadvantage adjustment
  (core.ts comment defers it to effects; no code does it).

## C · Design-token / CSS violations

- [ ] **C1 · Hardcoded colors (~15 sites).** `color: #fff` ×8 (should be
  `--color-accent-text`), `background: #221c10` (EffectDurationMenu — breaks on the light
  theme), `#1a1400` (settings), borders `#5a4d28`/`#2c4a45` (PanelCard/SpellHead), shadows
  `#000a` (CombatMenus/EffectDurationMenu). Also pointless fallbacks
  `var(--color-danger, #d06a52)` — the token exists in tokens.css (drop the fallback or the
  hardcode). Candidates for missing tokens: a gold border (`#5a4d28`), a teal border
  (`#2c4a45`), an overlay shadow.

- [ ] **C2 · Same class name, different styles across components** (css-name-collisions.mjs,
  2026-07-14). Svelte scoping prevents runtime bleed, but the names lie to the reader and
  invite copy-paste drift: `.visually-hidden` (build/+page redefines the app.css GLOBAL util
  — worst of the set), `.skill-name` + `.category-block` (PanelCard vs CombatMenus), `.spent`
  (PanelCard vs Turnbar), `.used` (ResourceBar vs Turnbar), `.bar-label`, `.eyebrow`, `.pick`
  + more (run `node tools/visual/css-name-collisions.mjs` for the live list). Fold into the
  planned combat-class rename pass; `.visually-hidden` local copy should just be deleted.
- [ ] **C3 · Cross-file CSS duplicate clusters** (css-dups.mjs). Repeated declaration blocks
  across components — hoist candidates for components.css: flex-column page shells
  (compendium vs translate `.page`), chip-on state (Chip vs CombatStrip), warn-tag colors
  (DraftsPane ×2 vs ContentHealth), `flex:1;min-width:0` truncation trio, etc. Same follow-up
  as the jscpd CSS ratchet — one pass, hoist the shared vocabulary.

## D · Structure / size / smells

- [ ] **D1 · `routes/build/+page.svelte` is 1032 lines** — violates the "no 1k+ line files"
  rule. Next worst: PanelCard 775, CombatMenus 759, EditContentForm 733. Split per the
  house pattern (VM + blocks + curated global CSS).
- [ ] **D2 · Two sources of truth for the editions union.** `rules/pipeline.ts System`
  ('5e'|'5.5e' literal) vs `stores/app.svelte.ts SystemId` (derived from schema `SYSTEMS`).
  Either move the SYSTEMS const into the rules layer or accept + document the pipeline copy.
  UPDATE: actually four sources — see F7.
- [ ] **D3 · Demo hardcode in CombatVM:** `pinned = {'fire-bolt': true, shield: true}` — every
  character starts with demo pins; not persisted per character (belongs in `ui`).
- [ ] **D4 · Roster fallback for broken saves hardcodes `system: '5e'`** (repository.ts).
- [ ] **D5 · `standardActions` is edition-blind.** One list for both systems using 2024 terms
  (Utilize, Study); 2014 names differ (Use an Object; no Study action).
- [ ] **D6 · `effectHint` hardcodes spell names** ('mage hand', 'counter'…, EN-only) as a
  curated fallback — against the data-driven grain; candidate for a content column instead.

## E · Data / locale content

- [ ] **E1 · `static/content/srd-2024/` has no `languages_srd.csv`** (2014 has one) → a 5.5e
  character gets an empty language picker. Convert from SRD 5.2.1 via a converter (NEVER
  hand-author — house rule).
- [ ] **E2 · uk.json violations:** tagline "Твої персонажі — твої" is ти-form (rule: formal
  «ви» / impersonal); typo "створюте" → "створюйте" in `demo.body`.

## EFX · Effects-engine buildout (IMPLEMENTED 2026-07-15; order was EFX-2 → 1 → 4 → 3)

Insight: PLAN's effects spec (bounded vocab incl. disadvantage/expertise/hpMax/damage/passive
targets, L2 expressions, lifecycle) was RICHER than the implementation — this was a buildout to
the existing spec, not a redesign. Architecture unchanged: bounded vocab (no DSL), the single
`applyEffects` seam, `{value, trace, notes}`, removable module, eslint fence. 342 tests green.

- [x] **EFX-1 · Vocabulary to spec.** DONE: `disadvantage` kind end-to-end (parse / apply-note /
  flags / `rollEffectsFor` / `netAdvantage` cancel rule); `grant-proficiency:[expertise:]` as ONE
  ladder level (expertise-without-proficiency unrepresentable); target canonicalization in
  `parseEffect` (fixes A5/A6); `hp-max` + `passive.<skill>` routed THROUGH `applyEffects`
  (Toughness/Aid work; passives take ±5 adv/dis); `attack`/`damage` flat + dice effects wired
  into weapon AND spell-attack rolls. Plugin seam prep: `plugin:` namespace reserved + handler
  contract pinned in PLAN (doc-only).
- [x] **EFX-2 · Gathering coverage.** DONE: `gatherEffects` walks class rows, base class features
  (level-gated, same source + edition), the chosen subclass row and ITS features; casting a
  spell auto-applies its own tokens as a runtime effect (duration parsed from the spell's
  duration text, linked via `source` — re-cast refreshes, replacing/clearing concentration
  removes it).
- [x] **EFX-3 · Effects catalog as content.** DONE: `effects_srd.csv` ships in both edition
  roots (Bless/Bane/Shield of Faith/Guidance/Haste/covers — curated per PLAN, tokens now
  RAW-richer than the old presets, e.g. Bless also buffs attack rolls); `effectSchema`
  simplified to tokens + `negative` + `duration_rounds`; the "+" menu reads
  `graph.list('effect')` per edition; `EFFECT_PRESETS` hardcode deleted; data-gate test
  validates every shipped row + token.
- [x] **EFX-4 · Lifecycle.** DONE: round expiry with notice on `nextTurn` (cast-linked expiry
  also ends concentration); rests expire what they outlive (short ≤ 600 rds, long = all timed);
  panel shows REMAINING rounds; typed/bumped durations mean "from now". Exhaustion-as-effects
  stays open (→ B2 — needs the exhaustion UI first).
- L2 value-expressions (`prof*2`, `ceil(level/2)`) and the L3 plugin sandbox stay deferred per
  PLAN. Data note: SRD conditions/features CSVs still carry mostly EMPTY `effects` columns —
  the ENGINE is ready; encoding the tokens into shipped data is follow-up content work.

## F · Semantic duplicates the refactor didn't catch (found 2026-07-14, second pass)

Invisible to jscpd (different shapes, <35 tokens) and knip (all used). Each is a "Reuse before
you write" violation; the fix is one shared home (mostly `util/format.ts` next to `ordinal`)
plus imports. Verify with a differential test before merging where bodies differ (MECH6).

- [ ] **F1 · `titleCase` ×6.** `combat/helpers.titleCase` (shared, `-` only); local copy in
  `build/+page.svelte:31` (`[-_]`); `effects/index.titleCaseId` (`[-_]`); label fallbacks in
  `content/detail.ts:40` + `content/homebrew.ts:117` (`_`); `content/grouping.cap` (`_`).
  One `titleCase` in `util/format.ts` handling `[-_]` covers all six.
- [ ] **F2 · `signed` ×4.** `combat/helpers.signed` is EXPORTED shared — yet
  `build/+page.svelte:32` defines an identical local; `rules/dice.formatModifier` and
  `content/detail.ts:82` are the same body again. Home: `util/format.ts` (dice.ts is pure
  core and must not import combat helpers).
- [ ] **F3 · Ability-list const ×5.** `['str','dex',…]` in `character/schema.ABILITIES`,
  `content/schemas.ABILITIES`, `detail.ABILS`, `combat/helpers.ABIL`, inline at
  `helpers.ts:242`. One const (rules layer owns it — `Ability` type already lives there),
  the rest derive/import.
- [ ] **F4 · `SKILL_IDS` duplicates `SKILL_ABILITY` keys.** `combat/helpers.ts:205` hand-lists
  the 18 skills; `character/derive.SKILL_ABILITY` already owns them →
  `Object.keys(SKILL_ABILITY)`.
- [ ] **F5 · Ability-mod formula re-inlined.** `content/detail.ts:55` + `:244` compute
  `Math.floor((score-10)/2)` instead of `rules/core.abilityModifier` — compendium math can
  drift from the sheet.
- [ ] **F6 · `errText` ×2 + inline ×3.** Identical helpers in `storage/tauri.ts:175` and
  `settings/StorageSettings.svelte:50`; the `e instanceof Error ? e.message : String(e)`
  pattern again in translate/+page and updater (×2). One `errText` in a shared util.
- [ ] **F7 · `SYSTEMS` const ×2.** `character/schema.ts:20` and `content/schemas.ts:19` both
  define `['5e','5.5e'] as const` — supersedes D2's count: editions have FOUR sources of
  truth (2 consts + `pipeline.System` type + derived `SystemId`). Pick one owner.
- [ ] **F8 · Escape-close handler ×9 dialogs.** Same `e.key === 'Escape'` close wiring in
  ConfirmDialog, CommandPalette, ContentMetaModal, LanguagePicker, SchemaDiscardDialog,
  OrphanDialog, HashDriftModal, DataMigrationDialog, DataConflictDialog. Fold into the shared
  dialog-shell behavior A11Y-1 already plans (one action = focus trap + Escape + backdrop).
- [ ] **F9 · Localized-name lookup ×4.** The `name_${locale} ?? name_en` read exists as
  `build/state.rowName`, compendium `localName` (`+page.svelte:60`), inline in
  translate/+page:143 and search.ts:78 (+ `detail.localized` for the general case). One
  shared `localizedName(row, locale)`.

- [ ] **F10 · New catches from the surface.mjs dup-detector (2026-07-14).** `tools/surface.mjs`
  now emits a "Duplicate suspects" section in SURFACE.md (same-name defs ×2+ files,
  identical param-normalized one-liner bodies, identical literal arrays; scans ALL of src incl.
  routes + .svelte scripts). First run confirmed F1/F2/F3/F6/F7/F8 AND found what the manual
  audit missed: a THIRD `SYSTEMS` const (GeneralSettings.svelte), `inEdition` ×3
  (search.ts / compendium / translate), `norm` ×4 path normalizers (browser/memory/migrate/
  layout), `PROSE_BASES` = `TRANSLATABLE_BASES` (translate.ts even comments "kept in sync
  with" — manual sync the array detector caught), and the localStorage persistence pattern
  (`load`/`persist`/`STORAGE_KEY`) duplicated between sources.svelte.ts and app.svelte.ts.
  The live list is SURFACE.md's "Duplicate suspects" — review it there; this item tracks
  burning down the initial 32.

## G · Typing gaps (2026-07-14; strategy: strict types + user stories are the primary bug nets)

Baseline is HEALTHY: strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess on and
clean, zero `any`/`ts-ignore` in src, typed loader (discriminated LoadedRow) real. The gaps
are the "last untyped layer" — places the compiler is blindfolded on top of good types:

- [ ] **G1 · 37× `String()`/`Number()` coercions over already-typed row data** (helpers.ts ×11,
  character/spellcasting.ts ×9, …) — leftovers from the `Record<string,unknown>` era. Worst:
  `String(row.data.concentration) === 'true'` (boolean via string compare). Remove the
  coercions so type changes surface at compile time.
- [ ] **G2 · `ab as Ability` ×12 in `build/+page.svelte` markup** — one untyped iteration
  re-cast at every use; fix the iterator's type once.
- [ ] **G3 · Character-schema records looser than the domain:** `abilityBoosts` keys should be
  `Ability`; `spellSlotsSpent` keys are `"1".."9" | "pact"` in practice; `panelColumns` ids
  are a known union. Encode them — wrong states become unrepresentable.
- [ ] **G4 · Seams that downgrade typed data:** `effectHint(d: Record<string, unknown>)` and
  detail.ts `localized()` accept untyped bags though callers hold typed rows.
- [ ] **G5 · No-op cast `character.system as System`** (derive.ts) — masks the SYSTEMS
  duplication; dies with F7's single-source fix.

## T · Test-coverage holes (`pnpm test:coverage`, 2026-07-14)

Overall: 69.8% statements / 55.5% branches. The gates were green while whole modules sat at
zero — coverage was never part of the loop. Worst first (target the risk, not the percent):

- [ ] **T1 · `content/store.svelte.ts` at 5%.** The freshly-refactored load/reload
  error-capture paths (content.error, resetContentGraph on failure) have NO tests — the one
  place a regression would strand users on an endless "Loading…".
- [ ] **T2 · `storage/fetch.ts` at 0%.** FetchStorage — the ENTIRE web-build content path —
  is untested (BOM handling, 404s, manifest listing).
- [ ] **T3 · Data-move orchestration untested.** `storage/tauri.ts` at 2%: pure `migrate.ts`
  is covered (98%), but `walkTree`/`copyFilesInto`/`migrateDataDir`/`mergeDataDir`/
  `finalizeMove` — the sequencing, rollback and pointer-swap logic — never run under test.
  They're Storage-shaped; a node/memory-backed contract test could cover the flow.
- [ ] **T4 · View-models thin on tests.** build state.svelte.ts 24% (hydrate/edit/save flows
  untested), combat roll.svelte.ts 38%, panel.svelte.ts 23%, combat state 51%/30% branches.
- [ ] **T5 · Config/persistence edges.** sources.svelte.ts load/persist (localStorage round-
  trip) untested; content/provider.ts seeding 41%; detail.ts 59%; homebrew.ts
  upsert/remove branches partial.
- Strategy note (user, 2026-07-14, two-phase): DURING active development bugs are caught by
  user-story walkthroughs + strict typing (group G); tests stay purely functional/behavioral
  for blocks that may be fully rewritten (effects engine, DiceTray) — no coverage gate, no
  chasing percentages. PRE-RELEASE, once functionality is ~ready, a dedicated
  **test-hardening pass** lays proper coverage over everything so updates can't silently
  break the app — T1–T5 are the input list for that pass. Only T1/T2/T3 may be worth
  covering earlier, since they guard real user stories today (broken content bundle on an
  install, the web build, the data-folder move).

Verified CLEAN in this pass (2026-07-14, tools that hadn't been run before): `madge --circular`
— no import cycles (110 files); `pnpm build` — green, no prerender errors; `pnpm audit` — no
known vulnerabilities; en.json ↔ uk.json key sets — identical; disable-comment inventory —
23 across 14 files, mostly deliberate a11y-ignores on dialog backdrops (EditContentForm has 6,
worth a look during D1-style splits).

Audit-scope boundaries (STILL not covered; candidates for separate passes): visual/runtime
run-through (shot.mjs + manual), `src-tauri/` Rust + capabilities, `tools/srd` converters
(count-asserts vs sources), mutation testing, the 72 jscpd CSS clone clusters beyond C3's
cross-file set, workflows beyond release/pages.

## N · (moved) Planned feature systems

N1–N6 (inventory view, class-feature engine, builder redesign, skills fixes, adjacent gaps,
currency) are FEATURE PLANS, not audit findings — they live in **`docs/PLAN.md` → "Planned
feature systems (N1–N6)"**. IDs stay stable; cross-references from there back to EFX-*/B*/D*
point at THIS file.

## W · Working-tree findings (2026-07-14 refactor review; uncommitted state)

- [ ] **W1 · `pnpm-workspace.yaml` placeholder:** `simple-git-hooks: set this to true or false`
  — literal pending-decision string in `allowBuilds`. Set an explicit `false` (the project's
  own postinstall runs the CLI) or `true`.
- [ ] **W2 · Content-load error surface inconsistent.** The new `<Loading error={content.error}>`
  pattern covers combat + compendium; `translate/+page.svelte` and `spellbook/+page.svelte`
  still hang on "Loading…" forever if the content load fails; the build page silently renders
  empty pickers.
- [ ] **W3 · Version drift:** `src-tauri/Cargo.toml` = 0.2.0 vs 0.3.0 in package.json +
  tauri.conf.json (tauri.conf wins at build time; still confusing). Sync.
- [ ] **W4 · `mergeDataDir` doc nit:** comment claims "same failure/rollback contract as
  migrateDataDir", but merge can't sweep half-copied files (non-empty target). Also record in
  PLAN that merge+deleteOld intentionally discards the source copy of a collision the target
  won (newer-wins is what the dialog promises).
- [ ] **W5 · `walkTree` has no symlink-cycle guard** (data-dir move would recurse forever on a
  looped symlink). Edge; low priority.
- [ ] **W6 · SessionStart surface-hook didn't fire/deliver** in a live session (SURFACE.md was
  stale at session start; only the caveman plugin hook's output arrived). Verify project-hook
  delivery on Windows (`claude --debug`; the command uses sh redirects — needs Git Bash).

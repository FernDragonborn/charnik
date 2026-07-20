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

- [x] **A1 · Heavy armor + negative DEX lowers AC.** FIXED 2026-07-15. `rules/core.ts armoredAC`
  now special-cases `dexCap === 0` ⇒ Dex contribution is 0 (no bonus, no penalty); light (null)
  and medium (2) still apply a negative Dex mod (the cap is an upper bound only), matching RAW in
  both editions. Golden tests added (plate + DEX 8 = 18; medium 14 + DEX 8 = 13; light 11 + DEX 8
  = 10).
- [x] **A2 · Multiclass max-die HP overcount.** FIXED 2026-07-15. `maxHpForClass` gained an
  `includesCharacterLevel1` flag: true only for `build.classes[0]` (the class taken at character
  level 1) → it grants the die MAX on level 1; every later multiclass gets avg-rounded-up on ALL
  its levels, including its first. `character/derive.ts` passes `i === 0`. Golden test: Fighter 3 /
  Wizard 2, CON 14 → 40 (was 42, the +2 overcount). Rule identical both editions, no system branch.
  NB the hit-dice POOL (short rest, → B2/UBUG-1) is per-die-type across classes in both editions —
  the existing `hitDiceSpent: Record<die, n>` shape already matches.
- [ ] **A3 · Heavy-armor `str_min` ignored.** The column is loaded (13/15 in SRD items) but
  derive never applies the −10 ft speed penalty nor emits an explainability note.
- [ ] **A4 · `stealth_disadvantage` is display-only.** Never reaches Stealth rolls (blocked on
  the disadvantage vocab gap, → A5/EFX-1).
- [x] **A5 · `disadvantage` missing from the effect vocabulary.** FIXED 2026-07-15 (EFX-1):
  full kind (parse/apply-note/flags/rollEffectsFor + `netAdvantage` cancel rule); passives take
  ±5 from adv/dis on the underlying check.
- [x] **A6 · `grant_proficiency:skill.<id>` silently dropped.** FIXED 2026-07-15 (EFX-1):
  `parseEffect` canonicalizes the target in ONE place (`skill.` strips, `save.` stays); the
  granted level is a single ladder value (`proficient`/`expertise`), never two booleans.
- [ ] **A7 · Attack-row heuristics (minor).** `computeAttacks` adds proficiency
  unconditionally (no weapon-proficiency check — if this is deliberate leniency, say so in
  PLAN); `parseDamage` would double-count a bonus die in a "2d6+1d4"-style damage string
  (first `[+-]\d` parsed as the flat mod) — not triggered by current SRD data, fragile.

Deep effects-system review, 2026-07-16 (A8–A18):

- [ ] **A8 · Multiclass saves = union of ALL classes.** `character/derive.ts:287-292` adds every
  class's save proficiencies; RAW grants saves from the FIRST class only. The builder writes
  `build.saves` correctly (first class, `build/state.svelte.ts` assemble) — the derive union on top
  is the bug. Fighter/Wizard gets STR+CON+INT+WIS.
- [ ] **A9 · Same-layer `set` resolution "highest wins" is wrong for restrictive sets.**
  `rules/pipeline.ts:69` folds competing sets by `Math.max` — grappled (`set_override:speed:0`)
  vs any other same-layer speed set → the character keeps moving. CONFIRMED (user 2026-07-16).
  "Most potent" is contextual, not always max; potency model TBD (for penalty-type stats the
  restrictive set must win).
- [x] **A10 · Ability scores bypass the pipeline entirely.** FIXED (EXPR-4, 2026-07-17): scores
  fold through the pipeline in `effects/dag.ts` — base + boosts + `flat_bonus`/`set_override`
  contributions (their real layers), traced, clamped 0..30; `AbilityBlock.score` is a `Computed`
  (hover explains a species +2 CON); Headband's `set_override:int:19` applies at the override
  layer; guarded/expression ability tokens resolve via the dependency DAG. Remaining from the
  original note: `abilityBoosts` values are still unclamped ints at the BUILD stage (G3).
- [x] **A11 · Same-name effects stack.** FIXED (EXPR-5, 2026-07-17): the DAG gather dedupes runtime
  (`condition`-layer) effects by `(source label + token list)` — two Bless casts apply their `1d4`
  once — and expands each condition id ONCE regardless of how many sources apply it (two Frightened
  sources → one `disadvantage:attack`). Build-layer effects still stack (a repeatable feat applies
  each time). Complements the pre-existing `set`-op combine (`overriddenSetNotes`).
- [ ] **A12 · Short-rest expiry compares TOTAL duration, not remaining.**
  `routes/combat/resources.svelte.ts:71`: `e.durationRounds <= 600` — an effect with 1000 total
  rounds and 1 remaining survives the hour; a fresh 600-round one is wiped. Use `remainingRounds`
  (already in `combat/helpers.ts`).
- [ ] **A13 · Long rest doesn't end concentration unconditionally.** Concentration clears only via
  an expiring LINKED effect (`resources.svelte.ts:73`); a concentration spell with no self-tokens
  (Hold Person) has no linked effect → concentration survives the night.
- [ ] **A14 · HP clamp is one-sided.** Heal clamps to max, damage floors at 0
  (`combat/state.svelte.ts:147-152`), but when `hp_max` DROPS (Aid expires) `hp.current` stays
  above max until the next heal. Also `play.hp.max ?? sheet.maxHp.value` (:138) — a manual max
  override silently disables ALL `hp_max` effects (Aid on top of a manual max vanishes).
- [x] **A15 · Cantrip scaling absent.** FIXED (EXPR-5, 2026-07-17): `cantripDieMultiplier`
  (rules/spellcasting.ts — 5/11/17 steps, identical both editions) scales a level-0 spell's damage
  dice in `spellRow`, so Fire Bolt shows AND rolls 2d10 at character level 5 (3d10 at 11, 4d10 at
  17). Data-driven off the `level==0` flag; a homebrew cantrip overrides via its own `damage`
  column. (The `higher_level` prose stays unparsed — the multiplier is the rule, not the text.)
- [ ] **A16 · `apply_condition` expansion holes** (`derive.ts:217-231`): (a) condition row lookup
  has NO edition filter (a 5.5e condition row can apply to a 5e character when both roots load) —
  class features right beside it DO filter `systems`; (b) `graph.rows.find` = first match, source
  namespacing ignored; (c) no dedupe (see A11); (d) one-level only; (e) ordering vs future L2
  guards unspecified (expansion must run AFTER guard resolution).
- [ ] **A17 · Casting never spends spell slots.** `cast()` (`combat/state.svelte.ts:328`) spends
  only the action-economy slot; level-N slot pips are manual. The schema comment
  (`character/schema.ts:136`) claims "spells spend their slot and are blocked when exhausted" —
  doc lies about code. No slot-level model at all: no upcast choice, no "no 3rd-level slots left"
  gate. (Ties to PLAN L10; ritual L8/L13 also unbuilt — `class.ritual` is a dead column, E7.)
- [ ] **A18 · Multiclass caster collapses to `classes[0]` across the UI.** Per-class profiles exist
  (L11 core fix, `character/spellcasting.ts`) but: cast uses `spellcasting.classes[0]` for
  DC/attack/heal-mod (`state.svelte.ts:342`), `preparedCap` is `classes[0]` (:412), and BOTH
  prepared togglers (combat `togglePrepared`, spellbook `togglePrepare`) gate every spell against
  the first class's cap. A Wizard 3 / Cleric 2 casts cleric spells off INT. (Backlog line ~1678
  knew the DC half; scope is wider.) Cross-ref D13.

## B · Unfinished invariants (CLAUDE.md/PLAN promise it; code doesn't do it)

- [x] **B1 · Effect duration auto-expiry not implemented.** FIXED 2026-07-15 (EFX-4):
  `nextTurn` expires round-timed effects with a toast (an expiring cast-linked effect also ends
  its concentration); rests expire what they outlive (short = ≤ 600 rds, long = all timed);
  the panel shows REMAINING rounds and typed durations re-anchor to "from now".
- [ ] **B2 · Dead play-state fields: `hitDiceSpent`, `deathSaves`, `exhaustion`.** Schema-only;
  no UI, no logic. Short rest can't spend hit dice (see UBUG-1 — same work), long rest doesn't
  restore them, death saves have no tracker, exhaustion levels have no effects. `exhaustion`
  design DECIDED (2026-07-15) → PLAN.md EXPR section: data-driven per-system ladder (effect tokens
  keyed by level, cumulative in 2014 / uniform via the `exhaustion` L2 var in 2024), always
  manually settable; part of the broader conditions-as-data model (closes A4/B9).
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
- [ ] **B10 · Resource pip render is O(max) — unbounded content can OOM the view.** Both
  `ResourceBar.svelte:19` and `PanelCard.svelte:229` do `{#each range(r.max) …}`, and
  `range` (`combat/helpers.ts:51`) is `Array.from({length: n})` — so a resource's `max`
  becomes that many allocated array entries + DOM `<button>` pips. `max` comes from a
  `grant_resource:<id>:<max>:<recharge>` token with NO cap in `parseEffect`
  (`effects/index.ts:89`, `max: Number(m[2])`), and content is untrusted input (shared
  packs). A single cell `grant_resource:x:1000000000` allocates a billion-element array →
  the tab OOMs before rendering. Today the pip UI is only sane up to ~6-ish points anyway.
  **Fix = make the render O(1) above a small threshold, not just cap the number:** render
  individual pips up to a THRESHOLD (≈12), and above it switch to the compact numeric
  `spent/max` control (± buttons + the `N/max` label that already renders alongside the
  pips) so cost is bounded regardless of `max`. This is the general "cap the COST of a
  number where it drives a loop/alloc/DOM-count, not its VALUE" rule (see the plugin
  cost-cap discussion in PLAN.md → PLG); the same class covers the dice roller loop
  (`rules/dice.ts:73`). Present-day content-path hardening — not gated on plugins.
  UPDATE: the DATA cap is now in (`MAX_RESOURCE_MAX = 1000` in `parseEffect`), so the
  billion-array OOM is gone — but 1000 pips still renders badly; the O(1) threshold
  (pips ≤ ~12, else numeric `spent/max` control) is the remaining UI work here.
- [ ] **B11 · `Storage.read()` has no size cap — `FileEntry` exposes no size to gate on.** The
  seam (`storage/types.ts`) slurps a whole file into a string with `read(path)`, and `FileEntry`
  carries `mtime` but not `size`, so nothing can reject an oversized file BEFORE reading it into
  memory. Untrusted content (shared CSV packs; later `plugins/<ns>/main.js` with its ≤256 KB spec
  cap) can therefore be read wholesale first. Fix = add `size` to `FileEntry` (the same `stat`
  that already fills `mtime` returns it — near-free) and have discovery/loaders check it from
  `list()` and skip over-cap files without a `read()`. Serves both the content path (SECURITY #8
  "file size caps", currently unenforced) and plugin loading. Deferred implementation: it's a
  cross-cutting interface change (types + Tauri fs + memory impl + consumers) with no consumer yet.

Deep effects-system review, 2026-07-16 (B12–B26):

- [x] **B12 · The loader REJECTS unknown effect kinds — violates "unknown → inert note".** DONE:
  `effectsField` no longer refines; tokens are kept verbatim and classified downstream.
  `content/schemas.ts:91` (`effectsField` refine) fails the whole ROW when a token doesn't start
  with a known kind. Consequence: ANY vocabulary growth (L2 guards start with a condition, not a
  kind; `plugin:`; future `reroll:`/`min_die:`) is a breaking change — new content kills rows in
  older apps instead of degrading. **DECIDED (user 2026-07-16): the loader never rejects a token —
  unknown degrades to inert text + a content-health WARNING; if the user has explicitly dismissed/
  skipped it, skip silently.** Only `parseEffect` classifies tokens.
- [ ] **B13 · Third silent token class: recognized kind, unconsumed target.** A known kind whose
  target no consumer reads vanishes with no note and no content-health (e.g. a typo'd target).
  There is no exhaustiveness accounting: every parsed token must be either applied or surfaced as
  unsupported. Related: `action`/`bonus`/`reaction` targets are honored by `TurnEconomy.slotMax`
  but exist in NO documented vocabulary (PLAN L1 list, PLUGINS.md §4.4) — code extended the vocab
  silently; shipped Haste uses `flat_bonus:action+1`.
- [ ] **B14 · `collectFlags` has zero production consumers; the effects panel shows only
  `play.effects`.** The "panel lists ALL active effects (auto-applied vs text-only) so nothing is
  silently lost" invariant is unimplemented for content-borne effects (item/feature buffs and
  their unknown tokens are invisible outside stat traces).
- [ ] **B15 · Derive ignores source filtering entirely** (extends B5): `gatherEffects`/`deriveSheet`
  read `graph.get`/`graph.rows` raw — a DISABLED file/source and the LOSING side of a resolved
  collision still feed the character's stats.
- [x] **B16 · `CHARACTER_MIGRATIONS = {}` though the DSL rename already shipped.** DONE: registry
  now carries the v1→v2 E3 ref migration (`migrateV1toV2`).
  (`character/repository.ts:21`.) The kebab→snake token rename (6f02ff0) silently inerts any
  saved `play.effects` tokens written before it. Wider: the TOKEN GRAMMAR is not versioned at
  all — `schemaVersion` covers JSON shape, not token strings inside play-state; every future DSL
  change (L2!) is silent corruption of saved effects without a migration.
- [ ] **B17 · `effectInstance` violates refs-not-copies.** `play.effects` stores BAKED tokens +
  label copied from the catalog at add-time (`character/schema.ts:92-105`); fixing a catalog row
  doesn't propagate to active buffs, and the baked label doesn't re-localize.
- [ ] **B18 · Provenance/notes are baked EN strings — explainability can't localize.**
  `gatherEffects` bakes `name_en` (`derive.ts:138` etc.), `applyEffects` composes English notes
  ("advantage on skill.stealth"), `why()` concatenates them, the roll log too. The
  `{value, trace, notes}` contract needs structured facts (source ref + op + params) localized at
  render; strings baked at derive are untranslatable. The longer this waits the more consumers
  bake in.
- [ ] **B19 · Durations tick only in combat.** Rounds advance only via `nextTurn`; out of combat
  `play.round` is frozen → a 10-round Bless cast outside combat never expires (only a rest clears
  it). No real-time/out-of-combat expiry model.
- [ ] **B20 · Defenses are display-only.** `damage()` has no concept of damage TYPE — resist/
  immune/vulnerable render in CombatStrip and are never applied. Blocked by data too: spell
  damage type is unstructured (`damage: "8d6 fire"` one string; `items.damage_type` exists but
  the HP flow takes a bare number).
- [x] **B21 · Split-brain effect consumers (three universes).** FIXED 2026-07-16 (L2R-6): the
  sheet exposes `resolvedEffects` (the one resolve stage's output — guards evaluated, conditions
  expanded, item/feature effects included) and BOTH `rollEffectsFor` (combat rolls) and
  `TurnEconomy.slotMax` (action economy) consume it instead of raw `play.effects`. A magic
  weapon's `flat_bonus:attack+1`, a feature's `advantage:…`, Action-Surge-as-content and
  panel-applied condition expansion now reach rolls/economy. Remaining (→ D7): the scans still
  re-`parseEffect` the shared list rather than reading typed facts; expression-valued
  attack/damage bonuses still resolve only sheet-side.
- [ ] **B22 · Duplicate `source:id` rows apply twice.** The loader dedupes only `byEffectiveId`
  (`loader.ts:327-337`) but keeps both rows in `graph.rows` — the class-feature scan and
  condition expansion iterate `graph.rows` directly, so a duplicated id contributes its tokens
  ×2 while `get()` sees one row.
- [ ] **B23 · `tests/integration/` doesn't exist.** CLAUDE.md + TESTING.md describe an integration
  tier (temp content roots, watcher self-write test, save/load round-trip…) as a convention;
  the repo has only `tests/fixtures/` with one CSV. Either build the tier or stop documenting it
  as present.
- [ ] **B24 · Watcher reloads EVERYTHING on any change** — CLAUDE.md promises "reparse only the
  changed file". `watcher.ts` debounces into a full `reloadContent()`. Perf-only today; the
  invariant should be re-worded or implemented.
- [ ] **B25 · Subclass casting is a UI lie.** `subclasses.csv` carries caster columns +
  `caster_from_level` (schemas.ts:252-264) and the homebrew FORM offers them (homebrew.ts:86,113),
  but `deriveSpellcasting` reads only class rows — Eldritch Knight / Arcane Trickster get no
  slots, no DC (PLAN L6 designed-not-built; the authoring form shouldn't offer dead fields).
- [ ] **B26 · Feature source-pinning blocks homebrew extension of SRD classes.**
  `derive.ts:181` (`f.source !== classRow.source`) means PHB features a user adds for the SRD
  fighter (their own source tag) never match — contradicts "users add non-SRD content
  themselves". DIRECTION (discussion 2026-07-16, pending confirm): match on
  `(class_id, edition)` + respect `isRowActive` (B15), and treat the same `(class_id, level, id)`
  from two sources as a COLLISION resolved by the existing keep-one/keep-all UI, with a
  warn+apply-one default. `graph.featuresForClass` (loader.ts:397) is an unused divergent
  duplicate of this query — fold it in (D18).

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

Deep effects-system review, 2026-07-16 (D7–D19):

- [x] **D7 · Token scans scattered across ~8 sites; no resolve stage.** DONE (EXPR-3 opened the one
  resolve stage; EXPR-5, 2026-07-17 closed the typed-facts half): `collectFacts` parses every
  RESOLVED token ONCE and resolves L2 values ONCE per derive into `CharacterSheet.facts`
  (`EffectFacts`). Every consumer reads that object — `applyEffects` folds `facts.numeric`,
  proficiency/defense/resource/adv-dis scans read their typed arrays, the roll path
  (`rollEffectsFor`) and action economy (`slotMax`) read it too — none re-`parseEffect`s the shared
  list. Killed the old per-stat `collectFlags`/`collectResources` re-scans. `parseEffect` no longer
  runs O(stats × tokens) per derive. Cross-ref B21.
- [ ] **D8 · Two parallel dice-tray stacks.** `lib/dice/tray.svelte.ts` (DiceTrayRequest contract:
  registry + formula string + roll-instantly fallback; comment claims "the seam every caller talks
  to") vs `routes/combat/roll.svelte.ts` RollTray (pool-based, never registers the contract). Two
  roll-request representations, two log paths — violates shared-control-=-one-component in its own
  seam.
- [ ] **D9 · `computeAttacks` is a data→string→reparse round-trip.** Builds `dmg` as a display
  string with the mod baked in (helpers.ts:413), then `attackRoll` re-parses it via `parseDamage`
  (A7's fragility is a symptom). Also no magic-weapon path at all: no bonus column and item effect
  tokens don't reach rolls (B21) — a +1 sword is mechanically inert.
- [ ] **D10 · Text-heuristics tier where data columns belong** (D6 is one member): `healDice`
  regexes `text_en` for healing dice (helpers.ts:123 — UA-only homebrew heals nothing),
  `durationToRounds` parses duration prose (:220), `castingIcon` regexes casting_time (:351).
  Mechanics must be columns; prose is display.
- [ ] **D11 · Two `Recharge` unions.** `rules/spellcasting.ts:14` (`short|long|day|dawn`) vs
  `effects/index.ts:33` (`short|long|other`). `rest()` handles short/long only: `day`/`dawn` are
  unproducible, `other` never recharges (undocumented whether that's intended manual). One owner.
- [ ] **D12 · `set_override` tokens are forced to the `override` layer** (`effects/index.ts:178`
  ignores `eff.layer`) while the pipeline is designed for layered sets ("an override-layer set
  beats an item-layer one") and PLUGINS.md lets plugin contributions set at feature/item layers.
  Token path and plugin path give the same op different semantics.
- [ ] **D13 · Prepared-toggle logic duplicated with DIVERGENT semantics.** Combat
  `togglePrepared` (state.svelte.ts:378) vs spellbook `togglePrepare` (+page.svelte:82): near-
  identical cap check + toast, but combat's `preparedCount` counts `s.prepared` (may include
  always-prepared) while spellbook excludes `alwaysPrepared` — the two pages enforce different
  caps. One shared helper; also both use `classes[0]` (A18).
- [ ] **D14 · Character id = `slugify(name)`** (build/state.svelte.ts:663) — two "Hero"s silently
  overwrite each other's save. Violates the GUID-for-shareable-data principle; id should be a
  GUID with the slug as display/folder hint.
- [ ] **D15 · `assemble` hardcodes `attuned: false`** (build/state.svelte.ts:653) — ANY builder
  edit/level-up wipes every item's attunement.
- [ ] **D16 · No "player choice" dimension in the content model.** Half-feat "+1 to one ability of
  your choice" (Resilient), Magic Initiate's spell picks, feat-granted expertise — content with a
  CHOICE is unrepresentable (tokens are static; a feat slot holds only a ref). Related smell:
  THREE ASI mechanisms already coexist (species effect tokens, `abilityBoosts`, the `boost_choice`
  `NxM` mini-grammar) — a fourth ad-hoc one for feats would compound it. PLAN's "half-feat +1
  handled in source step" has no mechanism behind it.
- [ ] **D17 · `ENUM_OPTS.kind = EFFECT_KINDS` in the homebrew form** (homebrew.ts) — but `kind` as
  a COLUMN belongs to `spell_slots` (values full/half/third/pact). Verify what the form renders
  for a spell_slots row; wrong option list if lookup types are authorable.
- [ ] **D18 · `graph.featuresForClass` (loader.ts:397) has no consumer** and diverges from
  derive's inline feature query (no system/level gates). Fold into the B26 fix; one query owner.
- [ ] **D19 · Minor pile:** `hpBar` divides by max=0 → NaN (state.svelte.ts:418); `missing[]`
  refs not deduped (derive.ts); `passiveSkills` pins not persisted (belongs in `ui`, cf. D3);
  `RollEffects.flat` carries a "callers must ignore it for save/skill keys or it double-counts"
  contract in a comment instead of the type (helpers.ts:66); `exhaustion` hardcoded `max(6)` in
  the schema (schema.ts:133) vs the decided data-driven ladder.

## E · Data / locale content

- [ ] **E1 · `static/content/srd-2024/` has no `languages_srd.csv`** (2014 has one) → a 5.5e
  character gets an empty language picker. Convert from SRD 5.2.1 via a converter (NEVER
  hand-author — house rule).
- [ ] **E2 · uk.json violations:** tagline "Твої персонажі — твої" is ти-form (rule: formal
  «ви» / impersonal); typo "створюте" → "створюйте" in `demo.body`.

Deep effects-system review, 2026-07-16 (E3–E7):

- [x] **E3 · Content ids are kebab-case; L2 makes `-` the minus operator.** DONE: `slug()` +
  converter id-templates + dedupe suffix + `idField` grammar + `slugify` + `SKILL_ABILITY` +
  `RARITIES` all snake; all SRD CSVs regenerated (counts asserted); v1→v2 character-ref migration.
  Shipped SRD is kebab
  throughout (`acid-splash`, `animal-handling`); `idField` (schemas.ts:65) and the resource-id
  grammar in `parseEffect` (effects/index.ts:98) both ALLOW `-`; so `class_level.blood-hunter`,
  `resource.lay-on-hands`, `has_condition.<kebab>` are unparseable as expressions. **DECIDED
  (user 2026-07-16): migrate ids to snake_case EVERYWHERE** — idField regex, SRD regeneration via
  the converters (never hand-edit), resource/condition ids, and a saved-character ref migration
  (B16 machinery); character folder slugs too, for one grammar.
- [ ] **E4 · Shipped tokens ahead of the vocabulary.** `effects_srd.csv` Haste row uses
  `flat_bonus:action+1` — a target documented nowhere (B13). Also the EFX note stands: most SRD
  condition/feature rows still carry EMPTY `effects` columns (engine ready, data not encoded).
- [ ] **E5 · `class_casting` requires a row per EXACT level** (character/spellcasting.ts:94) — a
  sparse table (rows only where counts change) silently yields caps of 0 and spells vanish.
  Either fill-down in the lookup or document the density requirement for homebrew.
- [ ] **E6 · `classes.saves` schema demands EXACTLY 2** (`z.array(Ability).length(2)`,
  schemas.ts:208-211) — a homebrew class with 1 or 3 save proficiencies fails validation and the
  row is dropped. Arbitrary stiffness against the homebrew-first stance.
- [ ] **E7 · Dead columns shipped in the schema:** `class_feature.resource` (schemas.ts:246 — zero
  consumers; resources come only from `grant_resource` tokens) and `class.ritual` (read nowhere;
  spell-side `ritual` only renders a chip). Either wire or drop from schema + authoring form.

## EFX · Effects-engine buildout (IMPLEMENTED 2026-07-15; order was EFX-2 → 1 → 4 → 3)

Insight: PLAN's effects spec (bounded vocab incl. disadvantage/expertise/hpMax/damage/passive
targets, L2 expressions, lifecycle) was RICHER than the implementation — this was a buildout to
the existing spec, not a redesign. Architecture unchanged: bounded vocab (no DSL), the single
`applyEffects` seam, `{value, trace, notes}`, removable module, eslint fence. 342 tests green.

- [x] **EFX-1 · Vocabulary to spec.** DONE: `disadvantage` kind end-to-end (parse / apply-note /
  flags / `rollEffectsFor` / `netAdvantage` cancel rule); `grant_proficiency:[expertise:]` as ONE
  ladder level (expertise-without-proficiency unrepresentable); target canonicalization in
  `parseEffect` (fixes A5/A6); `hp_max` + `passive.<skill>` routed THROUGH `applyEffects`
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

- [ ] **F11 · Locale-column grammar ×3, diverged.** Loader `LOCALE_COL` accepts BCP-47 with
  subtags (`name_pt-BR`), `search.ts:58` accepts only `[a-z]{2,3}` (pt-BR names exist but are
  UNSEARCHABLE), `detail.ts:51` `PROSE_LOC` is a third copy. One exported grammar
  (2026-07-16 review).

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

## SPEC · Effects-spec / docs findings (2026-07-16 deep review)

Holes and self-contradictions in the L2/PLG specs (PLAN.md EXPR/PLG + PLUGINS.md) and doc↔code
drift. Spec items must be resolved IN the docs (amend first, per PLUGINS.md's own rule) — most
gate EXPR-1/2 or PLG-2.

> **ALL RESOLVED IN DOCS 2026-07-16** (spec-first amendments, no code changed). Map:
> **SPEC1** → PLUGINS.md §4.2 (ctx split into `ctx.build`/`ctx.play`, hashed separately for memo).
> **SPEC2** → PLAN.md EXPR "Type & resolution rules" (ability/derived vars = effective; writers→readers DAG).
> **SPEC3** → same block (per-enum literal whitelist; ordered enums allow ordinal compare).
> **SPEC4** → same block (absent-but-whitelisted var = 0/false, not fallback; `spellcasting_mod` rule).
> **SPEC5** → same block (`if()` type = the eval-taken branch; mixed → content-health warn).
> **SPEC6** → PLAN.md EXPR examples (`armor_type` guard on Unarmored Defense; `d20_tests`/`save.death` flagged PROPOSED).
> **SPEC7** → same block (ONE resolve stage: gather→guards→expand→dedupe→facts).
> **SPEC8** → PLUGINS.md §4.4a (compute-once/memo vs fold-per-carrying-occurrence; returned-token layer/source).
> **SPEC9** → PLUGINS.md §6.3 (length-prefixed, domain-separated consent hash).
> **SPEC10** → PLAN.md EXPR block (per-sheet `deriveIssues` channel, like `missing`, into content-health).
> **SPEC11** → SECURITY.md #4 (real `kind:target:value` vocab; no `op`/`when`/`scope` dimension; `{value,trace,notes}`).
> **SPEC12** → TESTING.md (integration tier + rule-block/concentration/rest coverage marked ASPIRATIONAL).
> **SPEC13** → ORPHANS.md (knip GREEN banner; `healDice`/`castingIcon` corrected as live).
> **SPEC14** → PLAN.md (`grant-slot`→`grant_slot` ×3; L11 "first caster" note updated — core is per-class).

- [x] **SPEC1 · PLUGINS.md contradicts itself about `ctx`.** §4.2 pins "the WHOLE context" as
  build numbers only; §8.4 says a `passive` handler reads the dependency-resolved state incl.
  `bloodied`/`raging`/`concentrating`; §8.6's example reads `ctx.resources`. Three different ctx
  in one doc. Plus memo economics: the pre-pass memoizes on (token, ctx-hash) — once ctx includes
  hp/flags, EVERY HP tick misses the whole cache and re-runs all plugin tokens (~20 ms budget per
  derive), killing PLG-SEC 13's "most derives cost zero". Direction: split ctx into a stable
  build-ctx and a play-ctx, hash separately (or let a handler declare what it reads).
- [x] **SPEC2 · L2 `<ability>_mod`: base or effective? UNPINNED.** Effects can WRITE ability
  scores while expressions READ them — the same dependency problem §8.4 solves for guards, but
  the spec discusses only guards. Likely answer: effective (post-ability-stage) with
  expression-writers ordered before readers in the DAG; cycle → content-health. Must be pinned in
  the EXPR grammar section; also note derive.ts's current hardcoded two-stage cascade
  (scores-first) is exactly what EXPR-3's DAG replaces.
- [x] **SPEC3 · Enum comparisons undefined in the L2 grammar.** The spec's own example
  `armor_type==heavy ? …` is unparseable by its own rules (no string type, unknown ident = parse
  error — `heavy` is neither). Same for `size` ordinals. Whitelist enum literals per enum-typed
  variable.
- [x] **SPEC4 · Absent-but-whitelisted variable semantics unpinned.** `class_level.rogue` on a
  non-rogue: 0 or degrade-to-fallback? (Sneak-Attack-style content in a shared pack depends on
  it; §8.6 hints `?? 0`.) `spellcasting_mod` on a non-caster / WHICH class on a multiclass —
  undefined.
- [x] **SPEC5 · `if()` with mixed branch types.** `if(is_bloodied, 1d4, 0)` — dice in one branch,
  int in the other; the value type is "int OR dice formula" with no unification rule.
- [x] **SPEC6 · Worked examples use targets that don't exist** (`flat_bonus:d20_tests+…`,
  `advantage:save.death` — neither in PLUGINS.md §4.4 nor in code), and both Unarmored-Defense
  examples lack the `armor_type==none ?` guard (as written they'd override AC in plate). The
  "PHB on L2 needs L1 targets to grow" scoping note is honest — but the examples present the gap
  as already solved.
- [x] **SPEC7 · Where guards are resolved is unspecified.** Must be ONE resolve stage
  (gather → guards → condition expansion → dedupe → typed facts) that every consumer reads —
  else 8+ scan sites each fork conditional logic (D7/B21). Guard × `apply_condition`-expansion
  ordering also unstated (expansion after guards).
- [x] **SPEC8 · Plugin fold-count ambiguity.** "Called once per distinct token per derive" — two
  ITEMS carrying the same `plugin:` token: folded once or twice? And returned `tokens` ride at
  which layer/source (the carrying effect's? always `feature`?) — unstated.
- [x] **SPEC9 · Consent hash `sha256(main.js ‖ plugin.json)` lacks a length prefix/delimiter** —
  boundary ambiguity: the same concatenation with bytes moved across the file boundary keeps the
  hash while both files differ. Hash with length-prefix or hash the two files separately.
- [x] **SPEC10 · Derive-time errors have no route into content-health.** L2 parse/eval failures
  are character-dependent (undefined var for THIS build) and happen in derive; `issues` is a
  loader-time list. The spec says "surfaces in content-health" — the mechanism doesn't exist and
  isn't designed.
- [x] **SPEC11 · SECURITY.md describes an L1 vocab (`kind/target/op/value/when/scope`) that never
  existed** — `when`/`scope` dimensions appear nowhere else; sync it with the real vocabulary
  (and with L2 guards once they land).
- [x] **SPEC12 · TESTING.md describes the integration tier + high-risk coverage as the current
  gate** while `tests/integration/` doesn't exist (B23) and most listed high-risk tests
  (rule-blocks, concentration prompts, rests/hit-dice) are unimplemented. Mark aspirational vs
  actual.
- [x] **SPEC13 · ORPHANS.md is stale/wrong:** `healDice` marked "likely dead" but `spellRow`
  (helpers.ts:573) calls it today; `castingIcon` (marked ❓) is used. Re-run knip and re-triage.
- [x] **SPEC14 · Post-rename doc drift:** PLAN still spells `grant-slot` (kebab) in the
  spellcasting design; PLAN L11's note "deriveSheet returns only the FIRST caster" is stale (core
  is per-class; the collapse is in the UI, A18).

## L2R · Post-EXPR-2/3 implementation review (2026-07-16, fresh-eyes pass over the L2 code)

Found by a review of the freshly-landed EXPR-2/3 commits (f250c68, 7b71b4e) + E3 (f11fab4);
ALL FIXED SAME DAY unless marked open. Kept for the record — the IDs are referenced from tests.

- [x] **L2R-1 · E3 broke saving any multi-word character.** `character/schema.ts` slug regex
  allowed hyphens but NOT underscores while post-E3 `slugify` emits snake_case →
  `saveCharacter` refused every id like `bob_the_brave`. FIXED: regex accepts `[a-z0-9_-]`
  (hyphens stay for pre-E3 saves); regression test in character.test.ts.
- [x] **L2R-2 · Guard ctx was fail-open for conditions (and self-fulfilling).** derive built the
  `conditions` set from ALL `apply_condition` tokens with guards STRIPPED but not evaluated —
  `hp_percent<=25 ? apply_condition:rage` set `is_raging` at full HP; `has_condition.x ?
  apply_condition:x` bootstrapped itself. FIXED: two-pass resolve (pass 1 = empty
  condition/resource state → survivors define conditions/resources → pass 2 = authoritative);
  also closes the ctx-resources inconsistency (guarded grant_resource pools now feed guards).
- [x] **L2R-3 · A guard parse/eval error DROPPED the token** — violated the pinned "degrades to
  inert text, never dropped" fallback; any free-text unknown token containing `?` also vanished.
  FIXED: broken guard → issue + token kept verbatim (parses as `unknown` → inert note).
- [x] **L2R-4 · `set_override` resolving to dice vanished silently** (applyEffects handled only
  amount/error). FIXED: degrades to an "unresolved" note.
- [x] **L2R-5 · Ability-score targets silently ignored L2** (extends A10): a guarded or
  expression-valued `flat_bonus:str+…` and any `set_override:<ability>` disappeared with no
  trace. FIXED: surfaced as deriveIssues; then EXPR-4 (2026-07-17) closed the rest — the DAG now
  APPLIES them through the pipeline (A10 closed).
- [x] **L2R-6 · Roll path + action economy read raw `play.effects`** — guarded tokens parsed as
  `unknown` and lost their advantage/dice even when true; content-borne effects never reached
  rolls (B21). FIXED: sheet exposes `resolvedEffects` (the one resolve stage's output);
  `rollEffectsFor` + `TurnEconomy.slotMax` consume it. Closes the roll/economy halves of B21.
- [x] **L2R-7 · `spellcasting_mod` ignored the carrying class** (SPEC4 pins: a class feature's
  token reads THAT class's mod). FIXED: `ActiveEffect.classId` + per-effect ctx provider
  (`withSpellcastingMod`); unscoped tokens keep the primary caster.
- [x] **L2R-8 · deriveIssues had no consumer and a string shape.** FIXED: `EffectIssue
  {source, token, reason}` (SPEC10 shape); combat page publishes the open character's issues via
  the `deriveHealth` store; ContentHealth renders them + a static `lintEffectTokens` pass
  (mixed-type `if()` warn, `unusual die dN` warn — the spec-promised soft warns).
- [x] **L2R-9 · Chained comparisons silently wrong:** `5<=level<=10` parsed as `(5<=level)<=10`
  → always true. FIXED: a chain is a parse error ("use and").
- [x] **L2R-10 · Enum `!=` matched on an ABSENT enum var** (`armor_type!=heavy` true with no play
  ctx) — contradicted SPEC4 fail-closed. FIXED: absent enum fails every comparison.
- [x] **L2R-11 · Dotted-id lookups returned inherited Object.prototype members**
  (`class_level.constructor` → a function → truthy guard). FIXED: `Object.hasOwn` guard in the
  ctx adapter. Security-hardening (read-only; no pollution was possible).
- [x] **L2R-12 · Dice cost cap bypassable via addition** (`1000d6+1000d6+…` within the length
  cap). FIXED: per-side clamp in `addValues` (the roller's parse re-clamp was the only net).
- [x] **L2R-13 · New duplicates the L2 code added** (against "reuse before you write"): ability
  list ×2 (expr.ts/context.ts), dice caps re-declared with a "kept in sync" comment, size/armor
  enum lists, a second dot-split. FIXED: `rules/core` now owns `ABILITY_IDS`/`SIZES`/
  `ARMOR_TYPES` (schema.ts + content/schemas re-export — two old F3 copies also folded);
  `rules/dice` exports its caps; expr.ts exports `splitDottedName` + the dotted-family sets.
  F3's remaining copies (detail.ABILS, combat/helpers.ABIL, inline) still open.
- [x] **L2R-14 · Per-derive re-parsing** (extends D7's perf note): every stat × token re-ran
  `parseEffect` AND the L2 expression parser per derive. FIXED: bounded memo caches on both
  parsers (content token sets are finite; ASTs immutable).
- [x] **L2R-15 · `grant_resource` still accepted kebab ids** E3 left unreadable from
  `resource.<id>` expressions. FIXED: id grammar snake-only (kebab degrades to inert+visible,
  better than a silently unreachable pool).
- [ ] **L2R-16 · `is_raging` reads a hardcoded `rage` condition id** — now a named const
  (`RAGE_CONDITION_ID`) but still code, not data; dies with the conditions-as-data ladder (B2).

Second fresh-eyes pass + call-chain walk (2026-07-16, later the same day):

- [x] **L2R-17 · E3 missed the DEMO character — the seed/fallback was fully broken.**
  `demo/sheet.ts` carried kebab refs (`elf-high-elf`, `leather-armor`, `fire-bolt`, …) and kebab
  resource ids; it is built FRESH at the current schemaVersion, so the v1→v2 ref migration never
  touches it — every ref missed against the snake content (combat fallback, first-run roster seed,
  spellbook page all consume it). FIXED: demo ids snaked (verified against shipped CSVs) AND a
  **v2→v3 migration** (same idempotent snaking re-run) repairs the already-SEEDED demo saves in
  users' storage; CHARACTER_SCHEMA_VERSION=3; migration test added. Caught by reading the
  `demoCharacter() → characterSchema.parse (current version, no migration) → deriveSheet` chain.
- [x] **L2R-18 · Absent enum var masked authoring errors.** `evalEnumCompare` returned no-match
  BEFORE validating the literal/operator — `armor_type==tiny` or `size` ordinal misuse reported
  nothing when the variable was absent. FIXED: membership + ordered-enum checks precede the
  absence fail-closed return.
- [x] **L2R-19 · `speciesFixedAbilities` (build picker) didn't strip guards** — a guarded species
  ASI parsed as `unknown` and escaped the free-choice exclusion. FIXED: `splitGuard` first.
- [x] **L2R-20 · `gatherEffects` was 6 near-identical push blocks** (one even pushed token-less
  species rows). FIXED: one `pushRow(row, layer, classId?)` helper.
- [x] **L2R-21 · `tokensOf` lived in character/derive but is a content-row accessor** — the
  ContentHealth settings component had to import the derive aggregator for it. FIXED: moved to
  `content/loader` (its natural home next to `LoadedRow`); derive/combat/settings import it there.
- Panel path (`groupEffects`/`parseResourceEffect`/`effectTag`) still parses raw `play.effects` —
  deliberate for the "what did I add" list, but guarded tokens render as unknown there; folds into
  B14/B17 (panel shows resolved facts) when that lands. NOT fixed here.

## S · Security / robustness (2026-07-16 review; complements docs/SECURITY.md)

- [ ] **S1 · `TauriStorage.abs` traversal check misses backslashes.** `tauri.ts:289-293` splits on
  `/` and rejects `..` segments — but on Windows `read('..\\x')` passes the validator (one
  segment `..\x`) and `join` resolves it. The fs-scope is the remaining line of defence (holds:
  escapes leave the allowed scope), but the seam's own validation — which is ALL the web/memory
  impls have conceptually — is half-broken. Normalize `\`→`/` before splitting.
- [ ] **S2 · `allow_data_dir` is invokable with ANY path** (lib.rs:6) — any renderer JS can extend
  the fs scope to an arbitrary directory, recursive+write. By design (the folder-picker escape
  hatch) and gated by CSP/no-remote-code, but it's the single widest capability: consider
  restricting to paths returned by the dialog plugin, or at least document it as accepted risk in
  SECURITY.md §9 (minimal Rust surface).

## PLG · L3 plugin implementation review (2026-07-20)

Fresh-eyes + call-chain walk over the whole L3 module (host / sandbox / registry / store /
`token-parser` plugin kind / `apply` merge-seam / `derive` pre-pass / Settings UI / dev route /
`tools/plugin-test`). The security containment (read-once TOCTOU-closed buffer, QuickJS zero-cap
sandbox, host-side revalidation, fail-closed, length-prefixed consent hash) is SOUND — the finds
cluster in the reactive store's async wiring and in untested degradation paths. Decisions taken
inline (user, 2026-07-20).

- [x] **PLG-1 · `rebuildEvaluator` race → leaked WASM runtime.** `plugin-store.svelte.ts`: every
  toggle (consent/enable/disable/kill/refresh) calls the async rebuild, which disposed the handle,
  cleared the registry, then `await import()` + `await createSandboxEvaluator()` before registering.
  Two overlapping calls interleave at the awaits: the loser's built evaluator overwrites
  `evaluatorHandle` WITHOUT `dispose()` → an orphaned QuickJS runtime + WASM context leaks on every
  race (rapid enable→disable, or a toggle during the startup `refreshPlugins`), and last-COMPLETED
  (not last-INTENDED) wins the registry. FIXED (**generation-guard + build-before-swap**,
  `plugin-store.svelte.ts`): a monotonic `rebuildGen` captured on entry; the new evaluator is built
  BEFORE the old is disposed and the swap is atomic; a superseded in-flight rebuild disposes what it
  built and bails. Rebuild is a fold-to-final-prefs (order-irrelevant, no queue needed) — latest gen
  wins, stale is discarded. (No dedicated concurrency unit-test yet → PLG-T1.)
- [x] **PLG-2 · transient `evaluator === null` window during async rebuild.** Same method: between
  `clearPluginEvaluator()` and the later `registerPluginEvaluator()` sat two awaits; a derive firing
  in that gap (HP tick, `reloadContent`, the other VM's `plugins.version` read) degraded ALL
  `plugin:` tokens to inert notes, then flipped back on `version++` — a visible flicker of plugin
  effects. FIXED: the same build-before-swap (the old evaluator keeps serving until the atomic
  swap; no null gap).
- [x] **PLG-3 · fail-closed counter was `namespace`-only → cross-character poisoning.**
  `plugin-registry.ts`: 3 consecutive failures disable a plugin for the session, but the counter was
  keyed by namespace alone — a handler that fails only on character A's ctx (a bug at level > 15, a
  ctx field A lacks) disabled the plugin for characters B/C too, for the whole session. FIXED
  (**key by `(namespace, characterId)`** — the disabled state is a property of the exact
  plugin×character pair and persists per character across switches; `character.id` threads in as one
  `scope` arg to `expandPluginEffects` from the `deriveSheet` seam — no `PluginCtx` change; the memo
  is already per-character via `buildJson`). Verified by a per-character fail-closed test.
- [ ] **PLG-4 · aggregate-budget starvation (low).** `plugin-registry.ts` `expandPluginEffects`: an
  uncached token reached only AFTER the 20 ms aggregate line degrades + `continue`s BEFORE it can be
  memoized → it degrades on EVERY re-derive. A `plugin:` token that consistently sorts late in a
  large effect list may never compute (ordering-dependent). Documented; unlikely to bite (20 ms is
  many sandbox calls) — revisit if real content hits it.
- [x] **PLG-5 · naming: `ns` → `namespace`, `fn` → `handlerName` everywhere.** Terse author-facing
  identifiers (the `ns`/`fn` fields ride the `plugin:<…>:<…>` token AND the `plugin.json` manifest a
  user hand-writes) violated the verbose-names + names-match-in-code-and-docs rules. FIXED across all
  L3 code, the manifest key (zod schema + fixtures), docs/PLUGINS.md, and tests. Token grammar is now
  `plugin:<namespace>:<handlerName>` (positional; only the manifest key literally changed — free now,
  pre-release, no plugins in the wild). `tools/rename-ns`/`-fn` guarded regexes protected values like
  `test-ns` and generic non-plugin `fn` vars.
- [ ] **PLG-6 · plugin health has no UI surface — a runtime auto-disable is invisible (backlog).**
  The session fail-closed disable (`isDisabled`, 3 failures) lives entirely inside `plugin-registry.ts`
  with no getter, and the per-token degrade reasons go only into the derive `issues` channel — so a
  plugin that SILENTLY stopped working still shows "enabled" in Settings ▸ Plugins, and the user has
  no idea WHY or WHERE it dropped out. Backlog: a **plugin-health section in Settings** that reports,
  per plugin, why + where it was disabled — the auto-disable state and its last failure reason
  (surface `failCounts`/last-reason from the registry via a small read API), plus the per-character
  scope (PLG-3: "disabled for THIS character") and a link to the affected sheet/stat. Ties to the
  existing content-health / `deriveHealth` channel (L2R-8) — likely the same panel, a plugins tab.
  Also expose a manual "re-enable / retry" that clears the fail counter (today only a full rebuild or
  restart does). NOT built.
- [~] **PLG-7 · plugin-author DX — honest mistakes must produce a fixable message, not a puzzle.**
  Goal: the tool "just works" — every failure the app CAN detect tells the author WHAT/WHERE, no
  silent drops, no generic errors. DONE (reusing the existing `deriveIssues` → content-health
  channel, no new UI):
  · **A — real main.js load error surfaced.** `plugin-sandbox.ts` now extracts the actual thrown
    value (`SyntaxError: … / ReferenceError: …`) via `context.dump` into `LoadedPlugin.loadError`,
    the evaluator exposes `loadError(namespace)`, and the registry's degrade reason becomes
    `plugin "<ns>": main.js failed to load: <real error>` instead of a misleading "handler not
    registered". (Was: the JS error `.dispose()`d unread; author saw nothing.)
  · **B — validation names the field path.** `validateResult` now prefixes the zod issue path
    (`invalid result: contributions.ac.0.layer: Required`) instead of a bare "Required".
  Tests: syntax/throw-at-load surface the real message; a broken plugin degrades with its load
  error; a wrong result shape names the offending path.
  STILL OPEN: **C — a returned token with a typo'd but KNOWN-kind target** (`flat_bonus:armorclass+1`)
  still folds onto nothing silently (this is the general B13 "known kind, dead target" gap, now
  reachable via plugins — fix belongs with B13's exhaustiveness accounting). **D — the richer surface**
  (per-plugin health with the load error + last failure + a retry) is PLG-6.
- [ ] **PLG-8 · deep-link errors to the docs (backlog, gated on docs existing).** Once PLUGINS.md
  (and the effect-token vocab docs) are published/hostable, every author-facing error — the load
  error, the `invalid result: <path>` validation messages, unknown-token / bad-target-key reasons,
  the `plugin:test` CLI rejections — should carry a link to the exact doc section for that failure,
  so the author jumps straight to the fix rather than searching. Needs a stable anchor scheme in the
  docs + an error→anchor map keyed by the failure CLASS (not the message string). Applies beyond L3 —
  the same "an error carries its doc link" rule should cover content/effect authoring errors too
  (content-health entries). Blocked on the docs being a linkable target.
- [ ] **PLG-9 · "did you mean?" fuzzy suggestions for a typo'd effect token (backlog).** When a token
  fails against a KNOWN, finite vocabulary — an unknown effect kind (`flt_bonus` → `flat_bonus`), a
  bad target (`armorclass`/`armor_class` → `ac`), a skill/condition/resource id typo, a plugin
  `bad target key "X"` — the error should append the nearest valid candidate(s) by edit distance:
  "unknown target 'armorclass' — did you mean 'ac'?". Turns a dead-end into a one-glance fix. Needs a
  small fuzzy/Levenshtein helper (a proven tiny dep, e.g. `didyoumean2`/`fastest-levenshtein`) + the
  candidate sets, which already exist (`EFFECT_KINDS`, the `TARGET_KEY_RE` targets, `SKILL_ABILITY`
  keys, condition/resource ids). Only suggest when the input is CLOSE (distance ≤ ~2) and the slot is
  a closed vocabulary — never for free-text (`args`, guard expressions). Spans all effect authoring
  (the homebrew form, CSV content-health, plugin results), cross-ref B12/B13; pairs with PLG-8 (a
  suggestion + a doc link is the ideal message).
- [~] **PLG-T1 · `plugin-store.svelte.ts` test coverage.** DONE: the `pluginStatus` state machine
  (broken / needs_consent / code_changed / disabled / enabled) is covered in `plugin-store.test.ts`.
  STILL OPEN: the async flows — `consentAndEnable`/`disablePlugin`/`enableConsented`/`setKillSwitch`
  and the PLG-1 generation-guard race — need a suite that mocks `./plugin-sandbox` + `storage/provider`
  (Desktop platform); not yet written.
- [~] **PLG-T2 · degrade-path coverage.** DONE (`plugin.test.ts` / `plugin-host.test.ts`):
  aggregate-budget exhaustion (busy-clock fake), `noteSuccess` resetting the fail streak mid-session,
  and `loadPluginPrefs` on corrupt/partial localStorage. STILL OPEN: memo LRU eviction at `MEMO_MAX`.
- [x] **PLG-P1 · performance guarantees.** `plugin-perf.test.ts` — work-count regression guards
  (assert WORK done, not wall-clock, so CI-stable): the zero-plugin fast path never touches the
  evaluator; a build-only handler is computed ONCE across 500 play ticks (memo §4.2); one token on
  100 carriers = 1 compute + 100 folds; a play-reading handler re-runs only on distinct play states;
  the aggregate budget bounds sandbox calls per derive; a real QuickJS call stays under the 5 ms
  CALL_BUDGET. `plugin.bench.ts` — throughput numbers (`vitest bench`). Measured: fast path ≈ 3 µs
  (~350k/s), memo hit ≈ 2.5 µs, real QuickJS arithmetic call ≈ 0.13 ms (~7.5k/s, 37× under budget),
  sandbox boot (module load + 1 plugin) ≈ 38 ms one-time & lazy (only when ≥1 plugin is enabled).
- Confirmed CLEAN by tracing (ruled out): resource-`max` NaN into ctx (clamped `[0,MAX]` in
  `apply.ts`); `args` injection through the sandbox wrapper (`JSON.stringify`-escaped, positional);
  recursion via returned `tokens` (`plugin:` filtered, no re-feed); stale memo across an evaluator
  swap (`clearPluginMemo` on every rebuild); consent bypass / TOCTOU (read-once buffer, exact-hash
  gate, hidden-mutate handlers caught by the in-sandbox `try`); reactivity (both build/combat VMs
  `void plugins.version` inside `$derived.by`, so enable/disable re-derives live).

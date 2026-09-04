# Charnik — Testing plan

Companion to [plan.md](../plan.md). Tests are the **primary verification gate** —
every roadmap phase ships a runnable suite (`pnpm test`) that proves it.

## Principle
Push logic into a **pure, framework-free core** (rules + effects + content) so most
tests are fast pure-function units. Keep Svelte components thin and SvelteKit endpoints
as trivial wrappers (logic lives in core, not in `+server.ts`), so few component tests
are needed and endpoints barely need testing.

**Effects isolation:** the **effects module is optional/removable** — its tests live
apart, and **rules-core tests MUST NOT import the effects module** (proves the core
stands alone and the engine can be ripped out without breaking core or UI). Test the
derived-value contract `{value, trace, notes}` both with effects applied and with the
engine disabled (identical shape; trace = base-only when off).

## Runner & layers (Vitest)
- **Unit** — co-located `*.test.ts` next to source (`src/lib/rules/core.ts` +
  `core.test.ts`; same for effects interpreter, stacking pipeline, content
  parse/merge/locale, leveling/XP, multiclass slot math). Node env.
- **Integration** *(PARTLY BUILT. There is still no `tests/integration/` directory; what exists is
  `tests/` holding the cases that need the real world — `live-github.test.ts` (opt-in via
  `CHARNIK_LIVE_NETWORK=1`) and `content-repo.test.ts` — plus co-located suites that already cover
  much of the list below over `MemoryStorage`/`NodeStorage`. The gap is the tier's SHAPE, not its
  coverage; treat the list as the target)* —
  `tests/**`; run against the **node/in-memory `Storage`
  impl** (NOT Tauri), backed by per-test **temp dirs** (`os.tmpdir()`) where real fs is
  wanted; **never** the user's real `content/`/`characters/`. The Tauri `Storage` impl is
  thin and covered by e2e, not unit/integration. Cover:
  CSV scan→merge across files/roots, in-memory index, `source:id` namespacing,
  collision detect+resolve (keep-one/keep-all), two-dim enable (file AND source),
  `systems` filter, L2 locale + EN fallback, **atomic UTF-8-BOM/CRLF writes**,
  **watcher ignores self-writes** (no write→reload loop), character save/load
  round-trip, `log.jsonl` append + rotation, autosave/backups, bundle export/import,
  missing-content handling.
- **Component (thin)** — co-located `*.svelte.test.ts` for reactive bits only: point-buy
  math + remaining points, live ability/skill/weight totals, **effects panel
  (auto-applied vs text/manual)**, live system(5e↔5.5e) + language switch recompute.
  Svelte 5 → Vitest **browser mode** (`vitest-browser-svelte`/Playwright provider) for
  accurate rune reactivity; jsdom + `@testing-library/svelte` fallback if overkill.
- **E2E (deferred)** — **Tauri WebDriver (`tauri-driver`)** smoke flows later (build char,
  level-up, live switches, add homebrew via UI, resolve collision, play loop, print/
  export). Component tests still use Vitest browser mode, independent of Tauri.
- **Visual regression (present)** — **`tools/visual/shot.mjs`** (Playwright + `pixelmatch`) drives
  the **web SPA in headless Chromium** against the `pnpm dev` server (`localhost:5173`, `BASE` env
  overrides), screenshots key route states, and pixel-diffs vs `tools/visual/baseline/` (0-px gate).
  `node tools/visual/shot.mjs --update` refreshes the baseline BEFORE a change; a bare run compares.
  Companion CSS tools live beside it (`css-dups.mjs` / `css-classes.mjs` / `css-name-collisions.mjs`
  / `rename-class.mjs` / `hoist-class.mjs`). **Layer caveat:** this driver reaches the **webview DOM
  only**. It cannot exercise the Tauri desktop shell (the web build uses FetchStorage/IndexedDB, so
  `invoke`/Tauri-fs code never runs under it) and it cannot click **native OS dialogs** — e.g. the
  data-dir **folder picker** (Rust `blocking_pick_folder`, audit S2) lives outside any webview.
  Verifying that path needs a manual `pnpm tauri dev` run (or a future `tauri-driver` E2E + an
  OS-level dialog automator). So "no driver for the S2 dialog" means *this layer*, not "no driver".

## Measured once, not a standing gate
Seven detection methods were run across the whole suite. The findings are applied; what stays here is
what the measurements **rule out**, so nobody spends the hours again on a question already answered.

**Nothing to hunt for.** Zero snapshots anywhere (`toMatchSnapshot` and friends have never been used,
so the ban below has nothing to catch), zero dead tests, zero over-mocked tests, zero tests of a
dependency rather than our shim. A scan for cases whose every assertion is
`toBeDefined`/`toBeTruthy`/`not.toThrow` returned no real hit — every candidate stood beside a
structural assertion or was a type-narrowing guard. Redo it only per file, per suspicion.

**Coverage uniqueness is nearly blind here.** Running each test file alone under v8 coverage (~7 min)
found thirteen files whose statements no other file misses — and twelve were false positives: data
gates asserting on real shipped CSV through loader code other tests also walk, a source-text scanner
that executes nothing by design, an opt-in network test. Statement coverage cannot tell running a line
from asserting about it, so it produces one true positive per sweep at best.

**Mutation (Stryker, `src/lib/rules`).** 1 021 mutants, 15 min, **82.37% total / 84.02% of covered**:

| File | Score | Survived | Unreached |
| --- | ---: | ---: | ---: |
| `spellcasting.ts` | 88.79 | 24 | 2 |
| `proficiency.ts` | 86.36 | 6 | 0 |
| `dice.ts` | 82.71 | 63 | 6 |
| `core.ts` | 78.64 | 42 | 2 |
| `pipeline.ts` | 75.00 | 25 | 10 |

Half the survivors are `StringLiteral` mutants in error copy nothing asserts — cheap to kill, rarely
worth it. `dice.ts:379-387`'s `minDie`/`maxDie` comparison mutants (`<` → `<=`) are **equivalent
mutants**: at the boundary the mutated branch assigns the value the die already holds, so no test can
separate them. Do not try to close them. `pipeline.ts`'s 10 unreached mutants are the one real gap,
and closing them means new tests against a fresh measurement.

**A survivor list is a list of candidates, not of gaps** — Stryker also reported the `reroll`/`minDie`/
`maxDie` guards as surviving replacement by `true`, and hand-checking each showed 32-35 failing tests.
Confirm every machine finding by hand before believing it.

**Redoing the mutation run.** `pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner`, a
config with `testRunner: "vitest"`, `plugins: ["@stryker-mutator/vitest-runner"]` (pnpm will not find
it by glob), `mutate: ["src/lib/rules/**/*.ts", "!**/*.test.ts"]`, `coverageAnalysis: "perTest"`, and a
vitest config keeping only the `node` project — a Chromium launch per mutant costs more than the whole
node suite. Then remove all of it again. **`inPlace: true` is mandatory and it bites:** the default
sandbox copies the repo per run, which means copying an 11 GB `src-tauri/target` (it filled the disk
mid-copy) and it breaks content resolution, because `../charnik-content-srd` does not exist beside a
sandbox. In place, Stryker stamps `// @ts-nocheck` across every TS file and swaps one line at a time —
do not edit or run anything while it works, commit first so a crash is one `git checkout -- .` away,
and delete `.stryker-tmp` afterwards or `eslint .` reports 1 193 parse errors about "multiple
candidate TSConfigRootDirs" that mean nothing.

**Targeted probes beat a sweep.** Breaking one behaviour on purpose and running the tests that should
notice answers "would this fail if the code were wrong" directly, in seconds. Pick the mutation to
settle a question you already have; `git checkout -- <file>` in a `finally` so a crashed run cannot
leave the tree dirty.

## Duplication is a missing fixture, not a redundant test
`config/jscpd.json` excludes `**/*.test.ts`. Lifting the exclusion measures **4.21%** duplicated
lines, and reading every pair found no shared assertion — it is `beforeEach` bodies, object factories,
and per-case content graphs. Three clusters are deliberately left alone, so a fresh scan does not
re-raise them:

- **`routes/combat/combat.test.ts`** — only four of its 32 `beforeEach` bodies are the same four
  lines; the rest differ in ways that matter. One helper over 110 VM tests risks an ordering bug to
  save ~30 lines.
- **`content/remote/install.test.ts`** — each repetition seeds `MemoryStorage` into a different
  pre-apply state. The scaffolding IS the test setup.
- **`styles/customThemes` ↔ `themeFiles`** — the two `theme()` builders differ in the token value each
  suite asserts on. Sharing them costs the coverage.

## Cross-system
Parameterize rules/effects tests `describe.each(['5e','5.5e'])`; assert known
divergences: ASI source (species vs background), weapon mastery (5.5e-only),
encumbrance tiers (5e-only), over-capacity→5 ft, multiclass slot rules.

## High-risk modules (extra coverage)
Per [plan.md] these historically break (Aurora failed several). Every item below has coverage except
one: **long-rest re-prepare** is asserted nowhere. Rule-blocks live in `character/derive.test.ts`
(worn armor → `spellcasting.armorBlock` + the `armor_proficiency` issue); concentration and rests in
`routes/combat/combat.test.ts` (prompt on damage, a long rest ends it unconditionally, spent slots
and HP restored, Hit Dice, the 5.5e −1 exhaustion ladder, per-rest recharge policies).
- **Effects engine** — every vocab verb; stacking order; cap clamping (20/30, half-feat
  +1); unknown-effect → falls back to text/manual (never silently dropped); global
  toggle off → manual/text only; **custom/temporary effects** apply; **duration
  countdown → auto-expire** on round advance; predefined `effects.csv` catalog loads;
  **provenance trace** lists correct contributions; **rule-blocks detected** (e.g.
  non-proficient worn armor → spellcasting blocked + disadvantage).
- **Multiclass spellcasting** — multiclass slot table, per-class save DC, Pact Magic
  kept separate, prepared/known counts.
- **Concentration** — set/replace/drop; prompt-on-damage logic (pure decision fn).
- **Level-up** — HP apply (roll/avg/fixed), feature/ASI-feat at slot levels, slot &
  proficiency growth; single- and multiclass.
- **Rests** — short/long restore HP/hit dice/slots/per-rest resources; 5.5e long rest
  −1 exhaustion; long-rest re-prepare.

## Golden values
**Hand-derive** expected numbers for canonical SRD characters (L1 Fighter; a multiclass
caster; a character with stacking effects) and assert explicit values. **No snapshots
for math** (they lock in bugs); snapshots only for stable serialization shapes
(character.json, bundle).

## Property-based (fast-check)
`mod = floor((score-10)/2)` over 1..30; prof bonus by level; capacity linear in STR ×
size, push/drag/lift = 2×carry; **effect stacking is order-stable & idempotent for
declared-commutative bonuses**; save→load identity; merge row-count = Σ enabled rows;
locale resolve never throws (missing locale→EN, EN→id).
**The roller** (`docs/internals/roller.md`): a total is its dice plus the ONE d20 that counts plus
the modifier and nothing else; cycling the advantage state never changes the multiset of dice drawn
(the property a re-roll leak once violated — see that doc on why the mode may not draw); the kept
d20 is never worse than a dropped one; a full lap of the cycle returns the roll exactly as it landed.

## Determinism
Inject a **seeded RNG** for dice (4d6 stat roll, the dice roller, HP rolls on level-up)
so tests are repeatable; all derived stats otherwise deterministic.

## Fixtures = contract
Tests exercise the real data shape from two places. `src/test-support/real-content.ts` loads the
shipped CSVs through `tools/content-repo.mjs` — twelve suites read it, the data gates
(`items_content`, `conditions_content`, `resources_content`, `content_stamps`, `effects_catalog`,
`spell_slots`, `class_features_content`) among them; `loadPacks(...packs)` there loads a named subset
when a suite wants one edition or one pack rather than everything. `tests/fixtures/content/` holds the hand-authored
edge cases shipped data cannot carry, such as the underfilled homebrew pack `meta.test.ts` reads.

Everything else is built over `MemoryStorage` through **`src/test-support/fixtures.ts`**:
`makeTempContentRoot(files)` writes CSVs into one in-memory root and returns the loaded graph,
throwing if the fixture itself fails to load so a typo fails where it was written; its
`makeTempContentStorage` sibling hands back the storage when a test needs to rewrite and reload; and
`buildCharacter(overrides)` shallow-merges `build`/`play` over a fresh character and parses it.
Randomness comes from **`src/test-support/rng.ts`** — `rngSequence(...draws)` yields exactly the
values given and throws on an over-draw, because the assertions here are hand-derived faces (0.5 is
a 4 on a d6, an 11 on a d20) that a seeded PRNG would make unexplainable. That is why there is no
`seedRng(seed)`: an explicit sequence is the shape this suite actually needs.

## Test ↔ phase map (each phase self-verifies)
P2 content store (integration: parse/merge/index/collision/filter/locale/watch/writes) ·
P3 schema + converter (fixture conformance; converter output validates) ·
P4 rules+effects core (unit + property, per-system) ·
P5 i18n (lookup/fallback/discovery/RTL/collation) ·
P6 compendium + content-health (search/sort unit; diagnostics detect seeded problems) ·
P7 character store (build/runtime round-trip, log, backups, bundle, missing-content) ·
P8 build/level-up/multiclass/XP (unit + property) ·
P9 sheet (component math, effects panel, play-state/rests) ·
P12 export/print (deferred e2e).

## CI
GitHub Actions (free for public repos), **in place**: `ci.yml` (lint + test), `codeql.yml`,
`pages.yml` (the web demo) and `release.yml` (the desktop matrix). All three of the workflows that
need rules data check the CONTENT repo out into `.content-srd/` and set `CHARNIK_CONTENT` —
`actions/checkout` refuses a path outside the workspace, so the sibling-folder layout that needs no
config locally cannot be used there.

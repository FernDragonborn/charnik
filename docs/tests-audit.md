# Test suite audit — what carries no weight

A one-off inventory of tests that are **dead**, **duplicated**, or **tautological**, so the suite can
be cut without losing a single real guard. Everything in [the list](#the-list) is applied; the file
stays as the record of what was measured, how, and what the measurements refused to confirm.

Scope: `src/**/*.test.ts` + `tests/**/*.test.ts`. As measured: **100 files, 19 405 lines,
1 460 authored cases in 364 `describe` blocks**, expanded by `.each` to **1 883 executed**. After
the changes below: 19 144 lines and 1 873 executed. Zero `skip`/`todo`/`only` in source. (A glob
returns 101 paths: one is the `__screenshots__/Roller.browser.test.ts` *directory*, not a test.)

Jurisdiction for every call in here is [internals/testing.md](internals/testing.md) — and the audit
sends two corrections back to it: the doc's claim that rule-blocks, concentration and rests are
largely uncovered is stale (all three are tested; only long-rest re-prepare is not), and the three
fixture helpers it specifies were never built.

## Method

1. **Duplication (jscpd).** `config/jscpd.json` excludes `**/*.test.ts`, so test duplication has
   never been measured. A one-off run with the exclusion lifted (`minTokens` 25) gives the raw pairs.
2. **Static shapes.** Weak-only assertions (`toBeDefined`/`toBeTruthy`/`not.toThrow`), assertions over
   a literal the test itself built, snapshots over math, tests of a dependency rather than our shim.
3. **Coverage uniqueness.** Each test file runs alone under v8 coverage; a file whose covered
   statements are fully contained in the union of every other file's is a candidate for carrying
   nothing of its own.
4. **Implementation-derived expectations.** The shape the AI-test literature calls tautological: the
   expected value is produced by the same production call under test, so a bug moves both sides
   together.
5. **Mutation score.** Stryker is **not installed** — a standing mutation gate buys little against a
suite already this green, and it costs two dependencies plus a run nobody has 15 minutes for. To redo
the measurement: `pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner`, a config with
`testRunner: "vitest"`, `plugins: ["@stryker-mutator/vitest-runner"]` (pnpm will not find it by glob),
`mutate: ["src/lib/rules/**/*.ts", "!**/*.test.ts"]`, `coverageAnalysis: "perTest"`, and a vitest
config that keeps only the `node` project — a Chromium launch per mutant costs more than the whole
node suite. Then remove all of it again.

**`inPlace: true` is mandatory here, and it bites.** The default sandbox copies the repo per run,
which means copying an 11 GB `src-tauri/target` — the first attempt filled the disk mid-copy — and it
breaks content resolution, because `../charnik-content-srd` does not exist beside a sandbox. In place,
Stryker stamps `// @ts-nocheck` across every TS file and swaps one line at a time: **do not edit or
run anything while it works**, commit first so a crash is one `git checkout -- .` away, and delete
`.stryker-tmp` afterwards or `eslint .` reports 1 193 parse errors about "multiple candidate
TSConfigRootDirs" that mean nothing.

**Mutation probes.** Break one behaviour on purpose, run the tests that should notice, revert. The
   only method that answers "would this test fail if the code were wrong" directly.
6. **Mutation score (Stryker, one-off).** The same question asked exhaustively — 1 021 mutants over
   `src/lib/rules`. The tool is not a dependency; see [Reproducing it](#reproducing-it).
7. **Manual classification.** Every machine hit is read on both sides before it becomes a finding.

## Categories

| Category | Meaning |
| --- | --- |
| `dead` | Tests a path that no longer exists, or asserts what the source now contradicts. |
| `duplicate` | The same assertion is already made elsewhere (cited). |
| `tautological` | Passes on any implementation that does not crash. |
| `over-mocked` | Only proves the mock was configured. |
| `snapshot-over-math` | A snapshot locking a computed number — banned by `testing.md`. |
| `keep` | Looks weak, deliberately guards a documented target. Do not touch. |

---

## Step 1 — duplication (jscpd, exclusion lifted)

**100 sources, 19 405 lines, 1 012 duplicated lines (5.22%), 147 clones across 48 file pairs.**

Most of it is **intra-file**: the same character-build or plugin-host setup pasted into case after
case. That is boilerplate wanting a helper, not a redundant test, and it is recorded as such.

Worst intra-file offenders:

| Lines | Clones | File |
| ---: | ---: | --- |
| 173 | 21 | `src/lib/character/derive.test.ts` |
| 161 | 22 | `src/routes/combat/combat.test.ts` |
| 133 | 18 | `src/lib/content/remote/install.test.ts` |
| 65 | 10 | `src/routes/build/build.test.ts` |
| 64 | 7 | `src/lib/effects/resolve.test.ts` |

Cross-file pairs — where a genuinely redundant case is likeliest:

| Lines | Pair |
| ---: | --- |
| 37 + 28 + 18 | `effects/plugin-perf` ↔ `plugin-sandbox` ↔ `plugin` |
| 33 | `content/conditions_content` ↔ `content/items_content` |
| 24 | `character/derive` ↔ `routes/combat/combat` |
| 18 + 17 + 8 + 8 + 7 | `build/sheet-diff` ↔ `character/derive` / `build` / `combat` / `spell-picks` / `content/loader` |
| 15 + 12 | `components/Roller.browser` ↔ `dice/roller.svelte` ↔ `dice/roller-vocabulary` |
| 15 | `components/ContentMetaModal.browser` ↔ `components/HashDriftModal.browser` |
| 11 | `character/derive` ↔ `routes/build/picker` |
| 7 + 7 | `content/loader` ↔ `content/spellAccess` / `content/reload` |
| 6 | `styles/customThemes` ↔ `styles/themeFiles` |

The single largest clone in the repo is `src/lib/combat/helpers.test.ts:87-104` ↔ `:139-156` (18
lines, 130 tokens).

---

## Step 2 — static shapes

**Snapshots: none.** No `toMatchSnapshot`, `toMatchInlineSnapshot` or `toMatchFileSnapshot` anywhere
in the suite, so `testing.md`'s ban on snapshots over math has nothing to catch. The category is
closed. One stored PNG exists under `src/lib/components/__screenshots__/` for a Roller browser case.

**Weak-only assertions: none that carry nothing.** Scanning all 1 460 cases for a body whose every
assertion is `toBeDefined` / `toBeTruthy` / `not.toThrow` — and counting `expect.element(…)`,
`fc.assert(…)` and same-file assertion helpers as real assertions — leaves 4 hits, all false
positives on reading: three are `.test(…)` regex calls the scanner mistook for a case, and the fourth
(`effects/context.test.ts:160`) asserts `r.error` is truthy beside a second real assertion. That one
is a **strengthening** candidate, not a deletion: it would still pass if the error carried the wrong
kind.

`toBeUndefined()` is deliberately not counted as weak here — in this suite it is nearly always the
point of the test (no armour block, no dead-end row, no `aria-activedescendant`), which is a real
assertion about absence.

**Unused source exports (knip): 10.** knip reports exports that nothing _outside_ their own file
imports — not unreferenced symbols. Nine were used inside their own module and only the `export`
keyword was surplus (`activeClassFeatures`, `applyFailed`, `ASI_SHAPES`, `adoptRowIds`,
`draftStateSchema`, `SlotMaps`, `LogKind`, `LegacyAdvantageRoll`, `DieRole`); they are file-local
now. One, `Size` in `rules/core.ts`, was genuinely dead — `content/schemas.ts` declares its own —
and is deleted. No dead test rode on any of them.

**Repeated case titles: 3, all legitimate.** `strips anything executable` twice in
`content/markdown.browser.test.ts` (block renderer and inline renderer are two functions),
`loads with no errors and no hash drift` in `conditions_content` and `items_content` (two datasets),
`fires onclick when clicked` in `EyeToggle` and `Pin` (two components). Nothing to merge.

`markdown.browser.test.ts` is in the browser project for a real reason — DOMPurify needs a DOM — so
its Chromium launch is not avoidable.

---

## Step 3 — coverage uniqueness

Each of the 100 test files ran alone under v8 coverage (~7 min total). Union: **8 500 statements
reached**. A file's *unique* count is the statements no other test file executes.

**Thirteen files have a unique count of zero**, and reading them shows the metric's blind spot rather
than thirteen useless tests:

| Covered | File | Why zero unique |
| ---: | --- | --- |
| 0 | `content/prose-is-not-data.test.ts` | Reads `src/` as text; executes nothing by design |
| 5 | `storage/path.test.ts` | Exhausts one 5-statement guard that `memory.test.ts` also touches once |
| 162 | `tests/live-github.test.ts` | Skips without `CHARNIK_LIVE_NETWORK=1` — only module-load runs |
| 164–1 371 | `content_stamps`, `schemas`, `effects_catalog`, `conditions_content`, `resources_content`, `items_content` | Data gates: same loader code, different CSVs. Their value is the data assertion, invisible to coverage |
| 162 | `dice/roll-toast.test.ts` | Formatting over `rules/dice` paths other tests also walk |
| 187 | `storage/browser.test.ts` | The IndexedDB impl, reached by the character store tests too |
| 275 | `effects/whitespace-tolerance.test.ts` | Property sweep over the token parser other tests enter |
| 281 | `effects/plugin-perf.test.ts` | **Confirmed duplicate** — see the engine section |

So the metric produced exactly one true positive (`plugin-perf`), and it is one another method found
independently. **Statement coverage cannot see the difference between running a line and asserting
something about it** — six of these files assert on real shipped CSV data while executing nothing the
loader tests do not.

Full subset relations (A executes nothing outside B): `effects_catalog` ⊂ `items_content`, `schemas` ⊂
`items_content` and ⊂ `resources_content`, `path` ⊂ `memory`, `live-github` ⊂ seven others.

Per-file wall time is flat — 3.2–6.3 s, dominated by Vitest startup — so there is no expensive-test
tail to trim either.

---

## Step 4 — findings by domain

### Content — `src/lib/content/**`, `tests/**` (36 files, ~4 600 lines)

**Nothing to cut.** Every jscpd pair in this domain was read on both sides and rejected:

- `remote/install.test.ts` (133 dup lines) — `new MemoryStorage()` + `applyPackUpdate(…)` scaffolding
  repeated across ~30 tests, each pinning a distinct property from `packs.md` (all-or-nothing apply,
  hand-edit preservation, source-claim warning, folder-swap recovery, cache staging). Boilerplate.
- `conditions_content` ↔ `items_content` — the same harness shape over two different authored
  datasets. Not the same test.
- `remote/updates.test.ts`, `loader.test.ts` — repeated seeding before assertions on 14–15 distinct
  code paths; the cross-file overlap is a fixture builder, not a case.
- `homebrew`, `class_features_content`, `provider`, `translate`, `spellAccess` — the "repeats" are
  local helpers already hoisted to the top of each file and reused. Already correct.
- `effects_catalog` ↔ `spell_slots` — shared `Papa.parse` boilerplate over different data gates; the
  file already says so in a comment.

`loader.test.ts`'s 6 weak-looking assertions each sit beside a stronger, structurally specific one in
the same case. None is standalone.

**Do not touch:** `tests/live-github.test.ts` — opt-in via `CHARNIK_LIVE_NETWORK=1` and never run in
CI, but it is the only place the design's core assumption is checked against the real GitHub API: a
tree entry's blob `sha` equals `gitBlobSha` of the bytes `raw.` serves, plus the ETag→`unchanged`
path. No fake can prove either.

**Helper extraction:** `detail.test.ts:6-8` and `grouping.test.ts:7-9` define a byte-identical `row()`
wrapper around `makeRow` — hoist into `test-utils.ts` (~3 lines each, cosmetic).

### Engine — `src/lib/effects`, `src/lib/rules`, `src/lib/dice` (19 files, ~5 565 lines)

The only domain with real duplicates.

- `src/lib/rules/core.test.ts:45-125` · **duplicate** · the whole
  `describe.each<System>(['5e','5.5e'])('system-agnostic formulas (%s)', () => {…})` block runs
  **byte-identically twice**: the callback takes no parameter, so nothing inside ever reads the
  iterated system, and the one call that takes one (`carryingCapacity({ strScore: 15, system: '5e' })`,
  line 123) hardcodes `'5e'`. This is not AGENTS.md's protected cross-system parameterisation — that
  requires the system to reach the code under test. The real divergence is already asserted
  separately in `describe('edition divergence')` at :127-148. **Action:** drop `.each`, keep a plain
  `describe`. ~10 cases stop running twice for nothing.
- `src/lib/effects/plugin-perf.test.ts:92-97`, `:99-106`, `:108-115` · **duplicate** ·
  three memo-economics tests restate what `plugin.test.ts:182-192`, `:273-282` and `:283-291` already
  prove, at larger N (500 play ticks / 100 carriers / 5×20 derives instead of 2). A memo boundary is
  binary: if it holds for N=2 it holds for N=500. **Action:** keep the correctness examples in
  `plugin.test.ts`; drop these three or repurpose them as an actually-timed throughput check.
- `src/lib/effects/context.test.ts:162,164` · **tautological (weak)** · `expect(r.error).toBeTruthy()`
  proves an error surfaced but never what it says, unlike the file's own stronger pattern
  (`resolve.test.ts:95` asserts the detail text). **Action:** strengthen to name the offending token —
  not a deletion.

**Performance-test verdict** (`plugin-perf.test.ts`): mostly a real guard, not a flake generator. Four
of five tests in the first block count *work done* (evaluator calls) and are deterministic. `:117-136`
busy-loops against the 20 ms aggregate budget with ~2× headroom, and the real-QuickJS block averages
200 calls against a 5 ms ceiling — wide enough to be a "not pathologically slow" floor rather than a
timing assertion.

**Do not touch:** `rules/dice.test.ts:533-606` — the four roller properties `roller.md` names by name;
`effects/plugin-sandbox.test.ts` (whole file) — runs the real QuickJS-in-WASM sandbox and proves
containment claims a fake evaluator cannot; `effects/resolve.test.ts` (whole file) — the dependency-DAG
behaviour `effects.md` §4 and `plugins.md` §8.4 reference.

**Helper extraction:** `resolve.test.ts` defines `liveCtx` verbatim twice (:196-209, :337-350);
`rules/spellcasting.test.ts` redefines `pool`/`pools` verbatim (:141-148, :203-210); the three plugin
files each hand-roll a near-identical `ctx()`/`carrier()` fixture — one `plugin-test-fixtures.ts` would
absorb all of it.

### Character, build and the views — `src/lib/character`, `src/lib/build`, `src/routes` (19 files, ~6 650 lines)

**Nothing to cut.** Every jscpd pair here — including the repo's worst file (`character/derive.test.ts`,
173 duplicated lines) and its single largest clone (`combat/helpers.test.ts:87-104` ↔ `:139-156`) — is
a fixture builder, a `beforeEach`, or an object factory repeated because each case needs its own
isolated content graph. No pair shared an assertion.

- The two `derive.test.ts` files test unrelated modules that share a filename: `character/derive.ts`
  is the sheet aggregator (`deriveSheet`), `build/derive.ts` is the builder page's pure helpers.
- Spellcasting's three homes are three layers: `rules/spellcasting` (isolated math),
  `content/spell_slots` (CSV→table parsing), `character/spellcasting` (the wired-together result via
  `loadContent` + `deriveSheet`). No assertion is reproduced across them.
- The four weak-looking assertions in `routes/build/build.test.ts` (:123, :163, :275, :304) are
  type-narrowing guards standing beside real assertions on production output.
- `card-placement.browser.test.ts` (real `getBoundingClientRect`, RTL) and
  `picker-reading.browser.test.ts` (real `KeyboardEvent`, real `document.activeElement`) both earn
  their Chromium launch.

**Helper extraction — and the root cause of the repo's whole duplication number:**
`character/derive.test.ts` alone holds **nine** `…Graph()` builders that each do
`new MemoryStorage()` → `st.write('c/<table>_srd.csv', …)` → `loadContent(st, ['c'])`;
`combat.test.ts` repeats a four-line `beforeEach` across ~8 `describe` blocks and hand-builds a
`ResourceOption` per test; `combat/helpers.test.ts` defines `cls`/`sheetOf` identically three times;
`build.test.ts` re-runs `build.reset(); build.graph = graph;` inside ~20 cases on top of the
`beforeEach` that already does it. `testing.md` §"Fixtures = contract" names three helpers —
`makeTempContentRoot(files)`, `buildCharacter(overrides)`, `seedRng(seed)` — as the answer to exactly
this. **None of the three exists** (zero hits repo-wide). The duplication is a documented helper that
was never built, not sloppy tests.

### Platform and components — `src/lib/storage`, `components`, `styles`, `util`, `i18n`, `schema`, `diag`, `drafts`, `actions` (24 files, ~1 898 lines)

- `components/HashDriftModal.browser.test.ts:34-42` · **duplicate** · "Escape skips" repeats
  `components/ContentMetaModal.browser.test.ts:40-53`. Both dispatch `Escape` at the dialog and assert
  `onSkip` — but neither modal handles Escape: both delegate to `DialogShell`'s `use:dismissOnEscape`.
  Six components use `DialogShell` and **it has no test of its own**, so the shared wiring is covered
  twice, in two arbitrary consumers, and not at all for the other four. **Action:** one
  `DialogShell.browser.test.ts` (Escape + backdrop click), drop both copies. ~9 lines, and coverage
  goes up.
- `src/lib/components/__screenshots__/Roller.browser.test.ts/…-1.png` — a gitignored leftover from a
  past local failure. Nothing asserts against it; no visual baseline lives here. Safe to delete.

**Do not touch:** `storage/fetch.test.ts:152-154` — the one-line `typeof` check is the only guard on
`overview.md`'s "on web, `watch` is a no-op" contract; `storage/memory.test.ts:40-43` — looks like a
copy of `path.test.ts`'s traversal coverage but proves the *wiring* (that `read` calls the guard).

**Recorded so nobody re-discovers it as a bug:** `MemoryStorage.list()` sorts its output;
`NodeStorage.list()` and `TauriStorage.list()` return raw directory order. Every production caller
either sorts explicitly or documents why order cannot matter, so the fake-vs-real divergence is real
but inert.

**Helper extraction:** `styles/customThemes.test.ts:4-9` ↔ `styles/themeFiles.test.ts:16-21` (near
identical `theme()` builders); `drafts/store.test.ts` declares a `from`/`to` `DraftTarget` pair inline
three times; `storage/tauri-migrate.test.ts` repeats a before/after path assertion pair.

---

## Step 5 — implementation-derived expectations

Eleven assertions compare a production call against the same production call. Ten are **invariance
properties**, not tautologies — `hashFile(crlfBom)` equals `hashFile(a)` because line endings must not
change a hash, `meaning(spaceEveryDelimiter(t))` equals `meaning(t)` because whitespace is formatting.
The transformation is the assertion; both sides moving together is the point.

The eleventh is not:

- `effects/plugin-host.test.ts:124` · **tautological** · `expect(await consentHash('a','b')).toBe(await
  consentHash('a','b'))` under the title "is deterministic". `consentHash` is a SHA-256 over
  length-prefixed bytes with no salt, clock or randomness, so this passes for every implementation
  that is not deliberately random — including one that hashes the wrong bytes entirely. Its two
  siblings (`:126` boundary collision, `:129` any change alters the hash) also survive a salted hash,
  so the determinism claim is the only thing standing here and it is stated in the weakest possible
  form. **Action:** assert a golden hex digest for known inputs — one line, and it pins determinism,
  the algorithm and the length-prefix framing at once.

## Step 6 — mutation probes

Five deliberate breakages, each reverted immediately, run against the tests that should catch them.

| Mutation | Result |
| --- | --- |
| `abilityModifier` divisor 2 → 3 | **caught** — 18 of 28 in `rules/core.test.ts` |
| 5e long-rest hit dice: half → third | **caught** — 1 failure, precisely targeted |
| `carryingCapacity`: 5e/5.5e branch inverted | **caught** by `-t "edition divergence"`; **SURVIVED** `-t "system-agnostic"` (20 passed) |
| Plugin memo disabled (every call misses) | **caught** by `plugin.test.ts` alone (3 failures) *and* by `plugin-perf.test.ts` |
| `dismissOnEscape` listens for Enter | **caught** by both `ContentMetaModal` and `HashDriftModal` |

Three of these settle open questions:

- **Finding 1 gets worse.** The doubled `system-agnostic` block executes 20 cases, calls
  `carryingCapacity` — and does not notice when its edition branch is inverted. It is not merely
  redundant; it reads as cross-system coverage while providing none. The block that actually guards
  the divergence is the plain `describe` beside it.
- **Finding 2 is safe to act on.** Deleting the three `plugin-perf` memo tests loses no guard:
  `plugin.test.ts` on its own turns red when the memo is disabled.
- **Finding 3 has an order.** Both modal tests genuinely catch a broken `dismissOnEscape`, so they are
  real guards, not decoration. The `DialogShell` test must exist **before** either copy is removed —
  delete first and the wiring is unguarded for all six consumers.

The suite as a whole answered well: every mutation was caught by something, and the two arithmetic
ones by precisely the tests that own that rule.

---

## Step 7 — the mutation score

Stryker over `src/lib/rules` — the module where a wrong number is worst and every function is pure,
so a surviving mutant is a gap rather than an equivalent mutation. 1 021 mutants, 15 minutes,
**82.37% total / 84.02% of covered code**: 841 killed, 160 survived, 20 never reached.

| File | Score | Killed | Survived | No coverage |
| --- | ---: | ---: | ---: | ---: |
| `spellcasting.ts` | 88.79 | 206 | 24 | 2 |
| `proficiency.ts` | 86.36 | 38 | 6 | 0 |
| `dice.ts` | 82.71 | 330 | 63 | 6 |
| `core.ts` | 78.64 | 162 | 42 | 2 |
| `pipeline.ts` | 75.00 | 105 | 25 | 10 |

Stryker's own "high" threshold is 80. Nothing here needs rescuing.

**Finding 1, settled by measurement.** Re-running `core.ts` alone after the `describe.each` collapse
gives **78.64 / 79.41, 162 killed, 42 survived, 2 uncovered — identical to the digit**. Ten cases were
executing twice and killing nothing the single run did not already kill.

Half the survivors are `StringLiteral` mutants in error copy and note text — a message replaced by
`""` that nothing asserts. Cheap to kill, rarely worth it. Three groups were worth reading:

- **The always-prepared exclusion was never asserted** (fixed, finding 6 below).
- **The encumbrance note's number is unasserted** (fixed, finding 7 below).
- **The dice options are guarded after all — the report was wrong here.** Stryker listed the
  `reroll` / `minDie` / `maxDie` guards in `dice.ts:379-387` as surviving replacement by `true`.
  Hand-checking each says otherwise: `reroll → true` fails 35 of 64 tests, `minDie → true` fails
  32, `maxDie → true` fails 35. They are **false survivors**, most plausibly mis-attributed by
  `coverageAnalysis: "perTest"`. What genuinely survives is the comparison pair (`v < o.minDie` →
  `<=`, `v > o.maxDie` → `>=`) and those are **equivalent mutants**: at the boundary the mutated
  branch assigns the value the die already holds, so no test can ever tell them apart. Unkillable
  by construction, not a gap. The one thing worth adding was a case pinning that the reroll rule is
  "≤ the threshold" — a die landing exactly on it rerolls — which two other tests only implied.

  **A survivor list is a list of candidates, not of gaps.** Every machine finding in this audit was
  confirmed by hand before it was believed; this entry is why that rule exists.

---

## The list

Everything the audit changed, largest first. Seven items, all applied — the suite went from 1 883
executed cases to 1 872, losing fifteen and gaining four.

| # | Where | Category | Action |
| --- | --- | --- | --- |
| 1 | `rules/core.test.ts:45` | duplicate | Drop `.each<System>(['5e','5.5e'])` → plain `describe`. Ten cases stop running twice, and the block stops posing as edition coverage it does not provide (mutation-proven). |
| 2 | `effects/plugin-perf.test.ts:92-115` | duplicate | Delete three memo tests (~24 lines); `plugin.test.ts` alone catches a disabled memo (mutation-proven). |
| 3 | `components/HashDriftModal.browser.test.ts:34-42` + `ContentMetaModal.browser.test.ts:40-53` | duplicate | Write `DialogShell.browser.test.ts` **first**, then drop both copies. Both currently catch a broken `dismissOnEscape`, so order matters. |
| 4 | `effects/plugin-host.test.ts:124` | tautological | Replace `f(a,b) === f(a,b)` with a golden hex digest — passes today for any non-random implementation. |
| 5 | `effects/context.test.ts:162,164` | tautological | Strengthen — assert what the error says, not that one exists. |
| 6 | `rules/spellcasting.test.ts:238` | tautological | The fixture held one spell of each kind, so `preparedLeveledCount` returns 1 whether always-prepared spells are excluded or exclusively counted — the test's name was the only thing asserting it. Fixture made asymmetric. |
| 7 | `rules/core.test.ts:130` | weak assertion | The encumbrance note asserted its English `text` only; the translated UI renders `params`, where `strScore * 5` could become `/ 5` unnoticed. Now asserts key and params too. |

Plus one file that is not a test: `src/lib/components/__screenshots__/…-1.png`, a gitignored leftover
from a past local failure. Delete.

**That is the whole harvest: ~35 lines deleted out of 19 405, three assertions sharpened, and one
Chromium launch's worth of duplication.** Zero dead tests, zero over-mocked tests, zero snapshots,
zero tests of a dependency. For 1 460 cases across seven detection methods — two of which break the
code on purpose — that is a clean result, and the audit is better read as evidence than as a cleanup
queue.

The pattern in what did turn up is worth naming: **every real finding was a test whose name promised
more than its assertion delivered.** A `describe.each` that reads as cross-system coverage and passes
no system; a fixture with one spell of each kind under a title about excluding one kind; a hash
compared to itself under the word "deterministic"; an English sentence asserted where the translated
UI renders a number. None of them were noise, and none would have been found by reading for
duplication alone — it took breaking the code to see them.

## What the audit actually found

The 5.22% duplication was **not redundant tests**. It was one missing helper, three times over:
`testing.md` §"Fixtures = contract" specified `makeTempContentRoot(files)`, `buildCharacter(overrides)`
and `seedRng(seed)`, none of which existed, so every suite needing a content graph hand-rolled
`new MemoryStorage()` → `st.write('c/<table>_srd.csv', …)` → `loadContent(st, ['c'])` — nine times in
`character/derive.test.ts` alone, and again across `sheet-diff`, `build`, `combat`, `spell-picks`,
`picker`, `item-tags`.

**Built, in `src/test-support/`.** `fixtures.ts` holds `makeTempContentRoot` (plus
`makeTempContentStorage` for tests that reload) and `buildCharacter`; `rng.ts` holds `rngSequence`,
hoisted out of `dice.test.ts` where it was already the right helper in the wrong place. Seven suites
migrated, 126 lines gone, no assertion touched. `seedRng(seed)` was deliberately not built and the
doc now says why: this suite asserts hand-derived faces, so an explicit sequence of draws is the
shape it needs and a seeded PRNG would hide every expected number.

The second structural gap: `DialogShell` and `dismissOnEscape` are shared by six components and have
no test of their own, which is *why* two consumers ended up testing them.

## Reproducing it

The probes are one-offs, kept here rather than in `tools/` — nothing needs them on a schedule.

**Duplication.** Copy `config/jscpd.json`, drop `"**/*.test.ts"` from `ignore`, point `pattern` at
`{src,tests}/**/*.test.ts`, set `minTokens` to 25 and `threshold` to 100, then
`npx jscpd -c <copy>` with the `json` reporter. Group the report's `duplicates[]` by file pair.

**Weak-only cases.** Per `it`/`test` body, count `expect[.(]` and `fc.assert(` against
`.toBeDefined(`/`.toBeTruthy(`/`.not.toThrow(`. Blank out comments first (prose like "one render per
test (…)" parses as a case) and treat a call to a same-file helper that itself asserts as an
assertion — without those two rules the false-positive rate is ~85%.

**Mutation probes.** Replace one string in a source file, run the tests that should notice, then
`git checkout -- <file>` in a `finally` so a crashed run cannot leave the tree dirty. Pick the
mutation to answer a question you already have — "does this test still guard anything if I delete its
neighbour" — rather than sweeping blindly; a full mutation run over 19 405 lines of tests costs hours,
and five targeted breakages answered every open question in this audit.

**Coverage uniqueness.** Per test file:
`npx vitest run <file> --coverage.enabled --coverage.provider=v8 --coverage.reporter=json
--coverage.all=false --coverage.reportsDirectory=<dir>`, then union the `s` entries with a count > 0
across files and look for a file whose statements are all shared. ~5 s per file, ~7 min for the suite.
Read Step 3 before trusting the output.

## Corrections this audit sent back to the docs

- `internals/testing.md` ▸ High-risk modules claimed rule-blocks, concentration and rests were
  largely uncovered. They are covered — `character/derive.test.ts` (armour block), and
  `routes/combat/combat.test.ts` for the rest. The one item genuinely uncovered is **long-rest
  re-prepare**, and the doc now says only that.
- `internals/testing.md` ▸ Fixtures = contract described `tests/fixtures/` and three helpers as if
  they existed. It now describes what tests actually load, and the missing helpers are open work in
  [plan.md](plan.md) ▸ Backlog ▸ Code quality.

---

## What was implemented

Every finding above is applied. The duplication the audit set out to measure went from
**1 012 duplicated lines (5.22%, 147 clones)** to **806 (4.21%, 123 clones)** — and the part that
went is the part that was worth going, because none of it was coverage.

| Change | Effect |
| --- | --- |
| `makeTempContentRoot` + `buildCharacter` (`src/test-support/fixtures.ts`) | Zero `loadContent(st, …)` call sites left in the suite; ~180 lines |
| `rngSequence` hoisted to `src/test-support/rng.ts` | One seeded-draw helper, not one per file |
| `pluginCtx` + `carrier` (`src/test-support/plugin-fixtures.ts`) | Three drifted 30-line ctx copies become one; 88 lines |
| `liveCtx`, slot `pool`, `cls`/`sheetOf`/`prep`, `row()` hoisted | Five fixtures that existed two or three times now exist once |
| 23 × `build.reset(); build.graph = graph;` deleted | The `beforeEach` had already done it |
| Nine exports narrowed to file scope, one dead type deleted | knip is quiet |

The suite runs **1 873 cases** (from 1 883): fifteen redundant ones gone, five added — four for
`DialogShell`, one pinning the reroll boundary.

### Deliberately not done

- **`combat.test.ts`, 161 duplicated lines.** Only four of its 32 `beforeEach` bodies are the same
  four lines; the rest differ in ways that matter (extra abilities, a different graph, a transient
  the singleton has to be reset). Forcing one helper over 110 VM tests risks an ordering bug to
  save ~30 lines.
- **`remote/install.test.ts`, 133 lines.** Each repetition is a `MemoryStorage` seeded into a
  different pre-apply state; the scaffolding IS the test setup, not a fixture.
- **`styles/customThemes` ↔ `themeFiles`.** The two `theme()` builders differ in the token value
  each suite is asserting on (`rgb(0 20 40)` vs `#012`). Sharing them would cost the coverage.
- **`pipeline.ts`, 10 unreached mutants.** Closing those means writing new tests against a fresh
  measurement, and Stryker is no longer installed — a separate piece of work, not a cleanup.


# Charnik — Testing plan

Companion to [PLAN.md](./PLAN.md). Tests are the **primary verification gate** —
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
- **Unit** — co-located `*.test.ts` next to source (`src/lib/rules/abilities.ts` +
  `abilities.test.ts`; same for effects interpreter, stacking pipeline, content
  parse/merge/locale, leveling/XP, multiclass slot math). Node env.
- **Integration** *(ASPIRATIONAL — not built yet; `tests/integration/` does not exist as of
  2026-07-16, AUDIT B23; this describes the intended tier, not current coverage)* —
  `tests/integration/**`; run against the **node/in-memory `Storage`
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

## Cross-system
Parameterize rules/effects tests `describe.each(['5e','5.5e'])`; assert known
divergences: ASI source (species vs background), weapon mastery (5.5e-only),
encumbrance tiers (5e-only), over-capacity→5 ft, multiclass slot rules.

## High-risk modules (extra coverage)
Per [PLAN.md] these historically break (Aurora failed several). **Coverage status (2026-07-16):**
the effects engine, multiclass spellcasting, and level-up math have unit tests today; the
**rule-blocks** (armor→spellcasting), **concentration** prompt fn, and **rests** (hit-dice /
per-rest resources / 5.5e long-rest −1 exhaustion) items below are still LARGELY UNIMPLEMENTED —
they describe the target coverage, not what exists. Treat an unchecked item here as a TODO.
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

## Determinism
Inject a **seeded RNG** for dice (4d6 stat roll, the dice roller, HP rolls on level-up)
so tests are repeatable; all derived stats otherwise deterministic.

## Fixtures = contract
A small canonical **SRD-subset** of CSVs in `tests/fixtures/` doubles as test data **and**
the shipped seed → tests exercise the real data shape. Include rows with effects (both
in-vocab and deliberately out-of-vocab) and a deliberate cross-source collision.
Helpers: `makeTempContentRoot(files)`, `buildCharacter(overrides)`, `seedRng(seed)`.

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
GitHub Actions is **free for public repos**; add a minimal `lint + test` workflow **on
first push to GitHub**, not now.

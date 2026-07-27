# CONVENTIONS — house working-rules

**What this is.** A distilled, self-contained record of the working conventions the maintainer
has settled on for Charnik — the "how we do things here" that isn't derivable from the code or
the other docs. It exists so any assistant (Claude Code) or contributor picking up the repo
starts with the same rules the maintainer already taught, without needing a private memory.

**How to read it.** Each rule is stated as **Rule → Why → How to apply**. These complement, and
never override, `CLAUDE.md` (architecture invariants) and the spec docs (`docs/PLAN.md` is
authoritative; companions `TESTING.md`, `SECURITY.md`, `FRONTEND.md`). Where a rule touches
architecture, `CLAUDE.md` wins; this file adds the *practice* around it.

> Terminology: "the maintainer" / "the user" = the single developer who owns the project. Many
> of these rules originated as direct corrections during development — treat them as settled
> decisions, not suggestions.

---

## 1. Data & rules fidelity (hard rules)

### 1.1 Never hallucinate game data
**Rule.** NEVER fabricate or hand-author content data (spells, items, classes, stats, costs,
mechanics) from memory. All D&D/SRD data MUST come from a **real source** pulled via tooling
(download the official SRD or a verified CC-BY machine-readable dataset, then convert with the
scripts in `tools/srd/`).

**Why.** Memory-authored data carries silent errors (wrong damage dice, costs, weights, class
skill lists, 5e/5.5e divergences) that schema tests do NOT catch — they validate *shape*, not
*correctness*. Wrong canon data poisons the whole app.

**How to apply.**
- Need a dataset or network? Say so and use the console (curl/git/WebFetch). Don't guess.
- Verify the source LICENSE (CC-BY-4.0, SRD-only; keep WotC attribution). Avoid open5e (mixes
  non-SRD OGL). Verified sources: 5.5e = SRD 5.2.1 (`downfallx/dnd-5e-srd-markdown`),
  5e = SRD 5.1 (`Tabyltop/CC-SRD`). Rejected `BTMorton/dnd-5e-srd` (OGL 1.0a, not CC-BY).
- Converters assert row count vs source (`assertCount`). Always tag rows by their SRD edition;
  never claim both editions unverified. Applies to ANY reference/factual data task.

### 1.2 SRD RAW fidelity
**Rule.** Charnik's mechanical output MUST equal the SRD rules for the active edition
(5e = SRD 5.1, 5.5e = SRD 5.2.1). This is the correctness bar for every rules/effects/derive
decision.

**Why.** It's a tracking tool — a wrong number is a broken tool, not a preference. RAW is the
spec, not a heuristic to invent around.

**How to apply.**
- Derive answers from actual SRD RAW text of BOTH editions, not intuition or a convenient global
  rule. RAW is often per-effect (e.g. Headband of Intellect = set-to-19 "unless already higher";
  grappled = speed 0 AND blocks speed bonuses) — there is no single universal max/min rule.
- If the maintainer proposes something that **deviates from RAW**, say so immediately and explain
  why it's a deviation. Do NOT start implementing it. Proceed only on an explicit override with a
  stated reason.
- A RAW-correct behavior that's currently unimplementable → log it as a **KNOWN RAW GAP**, not a
  design choice.
- When answering rules questions, tag options as RAW-forced (no real choice) vs free
  architectural choice, so decisions are only asked where SRD genuinely leaves room.

### 1.3 Engine scope = the whole game; shipped data = SRD-only
**Rule.** The engine must be able to represent the **entire PHB, official rulebooks, and popular
homebrew** — not just the SRD. Wire mechanics as data-driven rules even when no *shipped* SRD row
uses them. Never hardcode a "SRD-only" assumption into the rules core or schemas. This does NOT
change shipping: shipped data stays SRD-only; users add the rest.

**Why.** So "should we bother, no SRD subclass uses this?" never recurs — the answer is always
*support it*. A homebrew/PHB author dropping in CSV rows must Just Work.

**How to apply.** Multiclass-casting subclasses (Eldritch Knight / Arcane Trickster), one-third
casters, non-SRD feats, etc. are expressed as data + the bounded effect vocabulary, not code.

### 1.4 Class & caster mechanics are pure data
**Rule.** Class and spellcasting mechanics must be **fully data-driven** — a homebrew/third-party
class is added as CSV rows with **zero code changes**. Never write `if (className === …)`.

**Why.** The app is FOSS + user-owned data; people bring official-non-SRD and independent classes.
Validate the architecture against real third-party classes: **Artificer** (half-caster, rounds up,
Infusions) and **Blood Hunter** (martial + hemocraft resources; Profane Soul pact-ish subclass
caster).

**How to apply.** Express per-class rules as descriptor columns: `caster_share`
(`full|half|half-up|third|none` — Artificer's round-up is just `half-up`), `slot_table` (id → an
arbitrary `spell_slots` table), `prepare_style`, `spell_ability`, `ritual`. Non-spell mechanics
(Infusions, Crimson Rite, Rage, Ki) = **resources** via `grant-resource` tokens. Truly exotic logic
the bounded vocab can't express → the future plugin sandbox, never baked-in code.

---

## 2. TypeScript & code quality

### 2.1 Strict typing is a hard gate
**Rule.** New code is always **fully typed**. The linter BANS type-escape hatches: `any`
(`no-explicit-any`), non-null `!` (`no-non-null-assertion`), `@ts-ignore`/`@ts-nocheck`
(`ban-ts-comment`), unsafe `as` casts. **Avoid the `undefined` type** — if a value can be absent,
model it deliberately (explicit union / default / discriminated state), not a bare `T | undefined`.
If `undefined` seems truly needed, **consult the maintainer first**.

**Why.** Typing offloads whole classes of bugs to the compiler; escape hatches quietly defeat that.

**How to apply.** Write typed from the start; if tempted to reach for `any`/`!`/`ts-ignore` or
`| undefined`, stop and either type it properly or ask. Null-checks are their own track (expect a
separate pass). Lean on the compiler — it catches a lot.

### 2.2 Model related state as ONE typed object
**Rule.** Group related state into a single **typed object with an interface**, not a spray of
separate fields. This is TypeScript — model the domain, don't write it like loose JS.

**Why.** Level-up state once got scattered across 7 view-model fields when it was obviously one
thing (an `EditContext | null`).

**How to apply.** When several `$state`/vars move together and mean one concept, make an
`interface` and a single `field: T | null`. Prefer union types over bare `string` for closed sets.
Parse a grammar in ONE place and expose a typed result.

### 2.3 Compare against named constants, not bare string literals
**Rule.** Don't compare against bare string literals (`kind === 'showhide'`, `res === 'attack'`).
Use an **enum / named const / `as const` union member** so a typo is a compile error, not a silent
no-op. A type union alone isn't enough — the **comparison** must be against a named member.

**Why.** String-literal comparisons are unchecked; a misspelling compiles fine and fails silently,
which lets a later human programmer break it invisibly.

**How to apply.** This is **proactive**: whenever you touch code with a bare-string comparison,
replace it with a named const right then — don't defer. Applies to `spellGroupBy`, `overlay.kind`,
spell `resolution`, effect kinds (`EFFECT_KIND`), panel ids, etc.

### 2.4 Verbose, self-evident names
**Rule.** Prefer verbose, self-evident names for functions, parameters, helpers, and CSS classes.
A reader should know what a thing does from its **name + what's passed to it**, without opening the
body. No cryptic abbreviations (`one`, `fmt`, `cmodrow`, `aedot`).

**Why.** Cryptic names force readers into the body; verbose names (`rollDie`, `formatModifier`,
`modifier-row`) make call sites and markup self-documenting, and terse CSS names invite the
class-collision bugs already hit.

**How to apply.** `rollDie(sides, rng)` not `one(sides, rng)`; `modifier-row` not `cmodrow`. Use
kebab-case + full words for CSS, with a component/feature prefix when a name could collide across
`<style>` blocks. Short loop locals (`i`, `k`) are still fine. The existing cryptic combat classes
are flagged for an opportunistic rename pass — do it when touching the file, not big-bang.

### 2.5 One name per fact
**Rule.** If a word names a fact in one place, every other place must reuse **that** name. Only the
**case convention** may differ where the context warrants (`is_bloodied` in the snake_case DSL ↔
`isBloodied` in a camelCase ctx JSON). Never `bloodied` here and `is_bloodied` there.

**Why.** Two names for one fact = doc/codegen divergence and reader friction; docs are generated
from specs, so a name drift becomes a *published* inconsistency.

**How to apply.** When exposing an existing fact on a new surface (ctx object, schema column, CSS
class, i18n key), grep for its existing name first and transliterate the case — never rename.

### 2.6 Comments carry WHY; functions & files stay small
**Rule.** Comments explain **why** this exists and why it's done this way — not a play-by-play of
*what* the code does. If you can't capture a function's essence in its **name**, that's a smell —
it's doing too much; split it.

**Size limits (machine-enforced, 2026-07-27).** Aligned to industry best practice (sweet spot
~150–300 lines; split by ~400), applied to **logic only** — `eslint` `max-lines` warns at **400** and
`max-lines-per-function` at **80** (both skip blank lines + comments), scoped to `**/*.ts` (which
covers `.svelte.ts` view-models — pure logic) and **NOT** `.svelte` (mostly markup + CSS, so a line
count there measures the wrong thing). Warnings, never errors — CI (`eslint .`, no `--max-warnings`)
stays green; the warning is the "time to split by concern" signal, not a gate. Tests are exempt.

**Svelte files** have **no line rule** — the guideline for components is *single responsibility /
cohesion*, not a line count (there is no established Svelte max-lines). Keep a component to one job
(one card, one panel, one dialog); push shared CSS to a confined/global sheet (§3.x) so the file
measures logic + its own markup, not duplicated styles.

**Why.** A clear name + small unit is self-documenting and reviewable; sprawling functions/files
hide bugs and can't be reasoned about. Machine-enforcing the threshold keeps it objective instead of
eyeballed.

**How to apply.** When a name won't capture the whole function, or the `max-lines` warning fires,
split by concern rather than comment around it. Current logic over the 400-line line (split targets,
worst first): `combat/helpers.ts` (junk-drawer → split by concern), `character/derive.ts` (core agg —
higher risk), `build/state.svelte.ts` + `combat/state.svelte.ts` (VMs), `effects/apply.ts`. Spend
comments on the non-obvious *why*. (Exception: genuinely over-complex logic warrants a short
what-it-does note.)

---

## 3. Duplication & reuse

### 3.1 Reuse before you write (see CLAUDE.md)
The primary rule lives in `CLAUDE.md` ("Reuse before you write"): before writing ANY `src/` code,
regenerate and consult **`docs/SURFACE.md`** (`node tools/surface.mjs`, ~0.15s) and grep for the
concept — a class name, a formatter, a helper — before creating one. A shared class lives in
exactly ONE place (`styles/components.css`); a shared control is ONE component. `knip` is the
back-stop, not the goal.

### 3.2 Don't dismiss small duplicates
**Rule.** Do NOT wave off small/local duplication as "minor, not worth it." Trivial local dups
accumulate until ~20% of the codebase is duplicates.

**Why.** They compound. A repeated construction / predicate / sentinel-compare is worth extracting
to ONE seam — even a one-liner.

**How to apply.** Distinguish a **real dup** (repeated *logic/code* → dedup) from **cheap repeated
O(1) Map lookups** across decoupled stages (NOT a dup — deduping there just couples modules; leave
it, but *say why*, don't hand-wave). A scattered bare-string compare is both a dup and a
literal-compare (see 2.3).

---

## 4. CSS, theming & UI

### 4.1 Every new UI must be theme-able
**Rule.** Style ONLY via the design tokens in `styles/tokens.css` — `var(--color-*)`,
`var(--font-size-*)`, `var(--radius*)`, `var(--space-*)`, `var(--tracking-label)`. **Never**
hardcode a hex/rgb color, a px font-size/radius, or a raw literal. A hardcoded value doesn't
respond to `[data-theme=…]`, so it silently breaks every custom theme.

**Why.** Charnik ships user-authored custom themes (Settings ▸ Themes → runtime injector →
`[data-theme=id]`). One hardcoded colour = a spot that stays wrong under a user's theme.

**How to apply.** Reuse an existing token; if a genuinely new shade is needed, add a **semantic**
token to BOTH theme blocks (`:root` dark + `[data-theme='light']`) in `tokens.css`, never an inline
literal. Alpha tints → `color-mix(in srgb, var(--token) N%, transparent)` (auto-themes). The
stylelint `color-no-hex` guard enforces the colour half.

### 4.2 Before hoisting a CSS class to global, grep the name
**Rule.** When extracting a shared class into the GLOBAL `styles/components.css`, first grep
`class="…name…"` and `\.name[ ,{]` across `src`. A global rule applies to EVERY element with that
class app-wide, so a common name collides with existing scoped classes that reuse the same name for
something different.

**Why.** Hoisting a `.field` input-base globally bled onto `.field` form-row wrappers across views
(46k px of drift, caught only by the visual harness). Renamed to `.text-field` → 0px. Svelte scopes
component styles, so two files can both use `.field` locally with no clash until one goes global.

**How to apply.** Pick specific, collision-unlikely names for global utilities (`.text-field`,
`.dialog-card`, not `.field`/`.row`/`.item`). Workflow: capture the visual baseline BEFORE, migrate
keeping EXACT values (base + local deltas), then re-shoot to confirm 0px.

### 4.3 Every interactive element must signal it's clickable
**Rule.** Give every clickable element a visible affordance: `cursor: pointer`, a hover state
(background/halo/border change), and a visible `:focus-visible` ring. Don't ship click targets that
look inert.

**Why.** Users can't discover or confidently hit targets that give no feedback, especially tiny
ones (dots, pips, icons).

**How to apply.** Make the hover halo a colour that contrasts with the row-hover background (a
same-colour halo blends away — that exact bug happened). Enlarge tiny hit areas with a transparent
`::before` inset. Semantic colours still apply (see 4.5).

### 4.4 A shared control is ONE component
**Rule.** A UI control that appears in more than one place (topbar, dialogs, panels) must be a
**single shared component**, not re-inlined per site — so it looks and behaves identically
everywhere.

**Why.** Re-inlining drifts; copies diverge in style/behaviour over time. One component is the
single source of truth.

**How to apply.** Concrete case: the language switch is `LangSwitcher.svelte`, used by both the
topbar and dialogs. Every attention dialog shows it top-right so the user can switch language to
read the dialog. Before inlining a button/toggle that already exists, extract or reuse it.

### 4.5 Semantic colours & design discipline
**Rule.** Keep semantic colours consistent: **crimson** = important/danger, **teal** =
good/confirmation, **gold** = neutral marker. Visibility = open/closed **eye** (teal = shown);
state = **toggle switch**. Avoid templated AI-default looks (cream + terracotta). Shipped theme =
slate + heraldic crimson + gold; Space Grotesk / Inter / JetBrains Mono.

**How to apply.** Record durable design decisions in `docs/PLAN.md` (authoritative) in the same
change. Throwaway mocks live in `design-preview/`. Icons: bundle SVGs from flaticon.com /
streamlinehq.com (not emoji — emoji render as boxes in headless tests); keep CC-BY attribution.

---

## 5. Dependencies

### 5.1 Prefer proven libraries over DIY
**Rule.** A proven, battle-tested library is the **default** over hand-rolled code. **Any**
ordinary dependency is fine — don't ration deps, don't treat "one dep" as a ceiling, and never use
"it avoids a dependency" / "zero-dep" as the deciding argument. Judge on solution quality, not
dep-count symbolism.

**Why.** A dependency that definitely works beats fragile hand-rolled code. And the maintainer may
not maintain the app for years — a library gets upstream security fixes (via Dependabot); DIY code
doesn't. (Concrete: after native HTML5 drag failed repeatedly, `svelte-dnd-action` was chosen over
hand-rolled pointer DnD.)

**How to apply.** For anything complex + error-prone (drag-and-drop, date/time, parsing,
virtualization, hashing), reach for a mature, popular library. Use **vanilla library APIs only** (no
forks/patches/monkey-patching, so version bumps stay clean one-liners). The ONLY consult-first case
is a huge, project-reshaping dependency (Tailwind-scale) — flag those yourself; add anything
ordinary without asking. "Minimal deps" in `CLAUDE.md` means avoid junk/unmaintained packages, NOT
ration proven ones.

---

## 6. Testing

### 6.1 Test behavior, not code shape
**Rule.** Assert **behavior** (observable inputs → outputs at a stable boundary), NOT the **form**
of the code (specific method names, how many methods, private helpers). A refactor's whole point is
often to merge methods, so a test coupled to method shape breaks even when functionality is
preserved.

**Why.** A safety-net test exists to prove functionality is unchanged across a shape change. If the
test knows the shape, it can't do that job.

**How to apply.** Test at a stable boundary (e.g. view-model → set draft choices, assert the
assembled Character / derived sheet stats — not `usePip`/`slotClick` each exist). Prefer pure
functions with input→output contracts. Before merging duplicate impls, a **differential test**
(both produce the same output for the same input) is the behavioral proof.

### 6.2 Two-phase testing strategy
**Rule.** **During active development**, the primary bug nets are (1) user-story walkthroughs and
(2) strict typing that makes wrong states unrepresentable. Tests carry a **maximally functional**
role only — behavioral checks at stable boundaries for blocks under active development that may be
fully rewritten (effects system, DiceTray). **Pre-release**, lay tests over everything properly.

**Why.** Coverage % during churn tests code that's about to be deleted; the same effort pre-release
buys real update-safety.

**How to apply.** Don't propose coverage ratchets/gates now. Keep in-flux tests behavioral at seams
so they survive rewrites. Pure rules-math keeps its golden/property tests regardless (golden values
are hand-derived from SRD; no snapshots for math — they lock in bugs). Track a "pre-release
test-hardening pass" as a roadmap item, not a today-task.

### 6.3 Run the full CI gate before committing
**Rule.** Before ANY commit, reproduce the **entire** CI locally: `pnpm test && pnpm lint &&
pnpm build`. A green subset is a false green.

**Why.** `svelte-check`/`pnpm check` type-checks but does NOT catch build/prerender-time failures;
`pnpm test` runs BOTH the node project AND the `*.browser.test.ts` Chromium project. A commit once
landed without `pnpm build` and CI fell.

**How to apply.** CI (`.github/workflows/ci.yml`) runs exactly `pnpm test` → `pnpm lint` →
`pnpm build`; run all three and only commit when all pass. `knip` and `jscpd` are part of
`pnpm lint`.

---

## 7. Refactoring & bug-fixing mechanics

### 7.1 Splitting large files — use a script, not the model
**Rule.** When splitting/extracting code out of a file, do it with a **script** (node/sed
line-slicing: read original → write ranges to new files → small targeted edits for import/export
fixups). Do NOT re-Write the content through the model.

**Why.** Passing a big file's content through the model to "retype it into two files" silently
drifts — reworded comments, dropped lines, subtle logic changes. Mechanical extraction preserves
the bytes exactly.

**How to apply.** `git mv` the primary half to keep history, then a script carves the secondary
file out by line ranges and deletes those ranges from the first; finish with small Edits for
cross-file imports. **After slicing, re-read the doc comments in each new file** and fix any the
split made stale (a header describing moved-out work, a "see below" pointing across the new seam) —
but if they still read correctly, leave them untouched; don't churn.

### 7.2 How to split a large Svelte view
**Rule.** Split large Svelte views this way:
1. **Per-view view-model** → `state.svelte.ts`: a typed `class` with `$state`/`$derived` fields +
   **arrow-method** actions (arrow so `this` survives being passed to markup), exported as a
   singleton (`export const combat = new VM()`).
2. **Pure helpers/constants/types** → sibling `helpers.ts` (no runes) — reusable + unit-testable.
3. **Components import the singleton** and expose state to markup via reactive read-aliases
   (`const x = $derived(vm.x)`) so sliced markup keeps bare names; writes/binds go through `vm.*`.
4. **Shared UI CSS → one curated global `styles/components.css`** (tokens-based); view-specific CSS
   stays scoped. Never split a view into "area chunks" that each re-scope shared classes — that
   duplicates CSS.

**How to apply.** Gate every stage on `pnpm exec svelte-check` (know the baseline error count;
don't add new) + `pnpm build` + `pnpm test` + a pixel-identical screenshot. Run `pnpm format`
before committing (script-spliced files aren't prettier-clean, and CI lint is `prettier --check` —
this broke CI once). When prefixing state refs in JS scopes, never touch `<style>`/`class="…"`
(`\bdice\b` would hit `.dice-grid`).

### 7.3 Lean on TS + Svelte tooling for cross-scope wiring
**Rule.** Maximally use TypeScript types and Svelte's own tooling so scopes/modules wire together
correctly — especially around classes, `.svelte.ts` rune modules, context, and cross-component
state. Let the compiler catch wiring mistakes instead of finding them at runtime.

**How to apply.** Give shared state an explicit typed shape; type `getContext`/`setContext` with a
typed key so consumers get inference, not `unknown`. Prefer idiomatic Svelte 5 primitives
(`$state`/`$derived`, arrow-method fields) over ad-hoc wiring. A green `svelte-check` is the
correctness gate for cross-scope moves.

### 7.4 Fix the root cause, don't guess
**Rule.** On bugfixes, **find the root cause before writing any fix**. Do NOT ship a plausible
patch and hope.

**Why.** Guessed fixes waste round-trips, erode trust, and often mask the real cause. (History: the
Combat drag bug got two guessed patches — `draggable` timing, then `dataTransfer.setData` — both
failed.)

**How to apply.** Reproduce/inspect the actual mechanism first (read the code path end to end, add
a probe, check known-issue databases for the specific tech) BEFORE proposing a fix. State the
identified root cause explicitly, then fix *that*, not a symptom. If unsure of the cause, say so and
investigate. For interaction-heavy fixes (drag/hover), the maintainer verifies in the running UI —
don't push until they confirm.

---

## 8. Git, status & collaboration hygiene

### 8.1 Commit at discretion; never push unasked
**Rule.** **Committing is allowed at your own discretion** when it's a meaningful, verified
checkpoint (a fix/feature landed, build/lint/test green). **Pushing is the only git action that
requires explicit permission that turn** — never `git push` unless the maintainer says so in the
current turn. A single "push" authorizes that turn only; it does NOT authorize pushing later
commits.

### 8.2 Commit straight to main
**Rule.** This is a **solo project** — commit directly on `main`, no feature branches. The generic
"branch first before committing" convention does not apply here. (Pushing `main` is still gated per
8.1.)

### 8.3 Mark status done only when implemented
**Rule.** In `AUDIT.md` (and any todo/status list), a fix may be proposed / designed / written up,
but the checkbox stays `[ ]` (open) or `[~]` (decided/in-flight) until the change is **actually in
code and verified**. Only then flip to `[x]`.

**Why.** A premature `[x]` makes the status list lie — readers trust `[x]` as "handled in the
codebase" — and hides real remaining work.

### 8.4 Don't blind-delete "dead" code in active dev
**Rule.** knip/unused-export findings are NOT auto-delete candidates. Before removing dead code,
judge whether it's **scaffolding for a planned feature** — if so, KEEP it and note that it needs
wiring (comment + AUDIT entry).

**Why.** Deleting planned-but-unwired code causes churn (re-adding later) and loses the intent
signal (e.g. the `kilograms` helper mirrors `metres` for a carrying-capacity display not rendered
yet). Truly orphaned (no plan) → delete; planned → keep + mark (`@public` JSDoc silences knip) +
note the gap.

### 8.5 Answer "should I…?" questions before acting
**Rule.** When the maintainer asks a diagnostic/confirmation question ("do I set `fullscreen: true`
for this?", "чи треба X?"), **answer and explain first** — do NOT jump to editing files. Give the
explanation + the exact change, then stop. Only edit if they explicitly ask you to.

**Why.** They often want to try the change themselves after understanding it; a preemptive edit
takes that away.

---

## 9. i18n, UX details & identity

### 9.1 Ukrainian UI copy uses formal "ви"
**Rule.** All Ukrainian UI strings (i18n catalogs, `uk.json`, any user-facing copy) use the
**formal** second person **"ви"**, never informal **"ти"** — "використовуйте" not "використовуй",
"ваше" not "твоє". Prefer impersonal phrasing where natural (it sidesteps the choice entirely). The
app's Ukrainian tone is polite/formal. *(This governs product copy only, not chat.)*

### 9.2 Friendly source labels in the UI
**Rule.** Never surface the raw source tags "SRD 5.1" / "SRD 5.2.1" in the UI — too technical.
Display **"D&D 5e" / "D&D 5.5e"** (or "5" / "5.5").

**How to apply.** Keep "SRD 5.1"/"SRD 5.2.1" as the underlying `source` value — it's the CC-BY
attribution AND part of the `type:source:id` identity, so it must stay exact. Add a **display map**
(source → friendly label) at the render layer only.

### 9.3 Shortcuts match the physical key; links include `base`
**Rule.** All keyboard shortcuts must fire on **any keyboard layout**. Match the **physical key**
via `e.code` (`'KeyK'`, `'Digit1'`), NOT `e.key` (layout-dependent — a Cyrillic layout yields `"к"`
for the K key, so `e.key.toLowerCase() === 'k'` fails). Separately: **all internal
links/navigation must include `base`** (`$app/paths`) — nav, wordmark, palette `goto`, view tabs —
else they 404 under the GitHub Pages subpath `/charnik`.

### 9.4 Identify shareable state with a GUID, not a counter
**Rule.** For any content/data-state identity that could be shared, exported, or imported between
users, use a **GUID** (`crypto.randomUUID()`), NOT a monotonic per-instance counter.

**Why.** Charnik is standalone (desktop + web) and data (content packs, characters, homebrew) is
passed around. A local counter isn't globally meaningful — two instances' "version 3" differ, and
an imported dataset's counter collides. A fresh GUID works as a cache key, for equality, and for
future sync/import dedup. (E.g. the content store rotates `guid = crypto.randomUUID()` on each
`reloadContent()`; derived indexes key off the guid.)

---

## 10. Repo tooling (use it before hand-rolling)

The repo ships its own tooling under `tools/` — check there BEFORE hand-rolling analysis.

- **`node tools/surface.mjs`** (~0.15s) regenerates `docs/SURFACE.md`, the reuse-surface catalog
  (tokens, global CSS classes, shared components, stores, lib exports) + a "Duplicate suspects"
  section. Consult it + grep BEFORE writing any `src/` code. A SessionStart hook auto-regens it;
  a pre-commit hook regens + `git add`s it. Never hand-edit it.
- **Visual regression:** `tools/visual/shot.mjs` — Playwright screenshots of key routes/states,
  pixel-diffed vs a saved baseline. `--update` captures the baseline (run BEFORE changes); no-arg
  compares. Use it for **every** CSS/layout change. Notes: the dev server is often NOT on 5173
  (read `pnpm dev`'s output and pass `BASE=http://localhost:PORT`); the shot **clips at viewport
  height, not true fullPage**, so below-the-fold UI (effects panel, column bottoms) is a blind spot
  — capture the specific element instead.
- **CSS analysis:** `tools/visual/css-dups.mjs`, `css-name-collisions.mjs`, `css-classes.mjs`;
  refactor helpers `hoist-class.mjs`, `rename-class.mjs`.
- **`pnpm knip`** — GREEN and a hard gate (part of `pnpm lint`). Don't reintroduce unused exports;
  un-export rather than exporting "just in case".
- **`pnpm jscpd`** — copy-paste detector, threshold 1.8% (part of `pnpm lint` + pre-commit).
- **eslint `no-restricted-imports`** gates two invariants: `@tauri-apps/*` only in
  `lib/storage/tauri.ts` + `lib/update/**`; `src/lib/rules/**` must not import effects.
- Also: `tools/srd/*` (SRD converters), `tools/build-static-content.mjs` (predev/prebuild).

---

## 11. Working style (how the maintainer collaborates)

The maintainer is **highly design-detail-driven** and iterates intensely on visuals (alignment,
spacing, pill widths, colour, wording, units), and catches CSS bugs and global-class collisions
fast. They will not accept "looks roughly right."

- **Verify visual work by RENDERING a screenshot** — don't just describe. Headless Chrome works;
  render tall enough (content clips), keep image width ≤ 2000px to view it back, crop regions to
  inspect detail.
- **Offer 2–3 rendered variants** when a design choice is open (ability tile, inventory, tags) — the
  maintainer picks from *seeing* them, not from names/ASCII.
- Global CSS keeps colliding in the mocks — when baking a mock, use **Svelte scoped styles** (or
  BEM) to kill it permanently; don't reuse short generic class names as both a component and a
  modifier.
- Build views by faithfully **baking the `design-preview/*.html` mocks** + wiring live data, not
  simplified from scratch.
- Record durable design decisions in `docs/PLAN.md` as they're made, in the same change.

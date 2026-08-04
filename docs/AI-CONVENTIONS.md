# CONVENTIONS — house working-rules

**What this is.** A distilled, self-contained record of the working conventions the maintainer
has settled on for Charnik — the "how we do things here" that isn't derivable from the code or
the other docs. It exists so any assistant (Claude Code) or contributor picking up the repo
starts with the same rules the maintainer already taught, without needing a private memory.

**How to read it.** Each rule is stated as **Rule → Why → How to apply**. These complement, and
never override, `CLAUDE.md` (architecture invariants) and the spec docs (`docs/PLAN.md` is
authoritative; companions `TESTING.md`, `SECURITY.md`). Where a rule touches
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

### 1.2 SRD fidelity — RAW by default, RAI when RAW is silly, always surface
**Rule.** Charnik's mechanical output defaults to the SRD **RAW** (Rules As Written) for the active
edition (5e = SRD 5.1, 5.5e = SRD 5.2.1). **BUT** where RAW is ambiguous, self-contradictory, or an
obvious artifact of the ruleset's sheer volume (a dumb/unintended literal result), follow **RAI**
(Rules As Intended — the designers' clear intent: official Sage Advice / errata / obvious design
purpose) instead of a robotic literal reading. Either way, **surface the interpretation** so the
table can override; where RAW and RAI genuinely diverge as a real table choice, **offer both**, don't
hardcode one. (Maintainer's stance, 2026-08-02.)

**Why.** It's a tracking tool — a wrong number is a broken tool. RAW is the spec, not a heuristic to
invent around — but a huge ruleset has genuine cracks, and blindly shipping a dumb literal result
serves no one. RAI resolves the cracks toward what the game means.

**The hard boundary — RAI interprets RULES, it never invents DATA.** §1.1 [never hallucinate game
data] is UNCHANGED and absolute: spells/items/stats/costs always come from a real SRD source, never
from memory. RAI is "how to interpret a mechanic", never "fabricate content." RAI is not "because I
prefer it" — it triggers only on ambiguous/contradictory/clearly-unintended RAW, not taste.

**How to apply.**
- Derive answers from actual SRD text of BOTH editions, not intuition or a convenient global rule.
  RAW is often per-effect (Headband of Intellect = set-to-19 "unless already higher"; grappled =
  speed 0 AND blocks speed bonuses) — no single universal rule.
- Clean RAW → follow it. Ambiguous/contradictory/obviously-unintended RAW → follow RAI **and say so**
  (note the interpretation + why). Never silently pick an interpretation.
- Where RAW and RAI diverge as a legitimate table decision (e.g. Magic Missile = one save vs per-dart;
  2014 "separate save per source" vs 2024 dropping it) → **offer the choice** ([[play-tracker-surfaces-never-forces]]),
  don't bake one in.
- A RAW/RAI-correct behavior that's currently unimplementable → log it as a **KNOWN GAP**, not a
  design choice.
- When answering rules questions, tag options as RAW-forced (no real choice) / RAI-resolved (RAW was
  silly) / free architectural choice, so decisions are asked only where the rules genuinely leave room.

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

### 1.5 CSV columns are OPEN enums, never binary/boolean flags
**Rule.** When a data column expresses a *policy* or *kind*, model it as a **named-member enum**
(`as const` union), not a two-state boolean or an implicit binary. Add a new policy as a new enum
member; never fork the model with a second boolean.

**Why.** Game rules grow in unforeseen ways. A boolean bakes in the assumption that there are exactly
two cases — the moment RAW needs a third (and it always does), you either mis-model it or bolt on a
second flag and the combinations explode. An enum extends by one readable member with zero schema
churn, and the TS union makes every consumer's `switch` re-check exhaustiveness. Concrete case
(2026-08-02): resource `recharge` looked binary (`short|long`), but 2024 Second Wind is "regain ONE
use on a short rest, all on a long rest" — a third policy. Because `Recharge` was already an enum, the
fix was one member (`short_one`) + one `rest()` branch, not a new `partialRecharge` boolean column.

**How to apply.** Pick descriptive member names that name the *behaviour* (`short_one`, `half_up`),
keep the union in ONE owner module (D11), and handle the new member everywhere the compiler flags.
A future different amount → another member (or generalize *then*, YAGNI), still not a boolean.

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

**Size limits (machine-enforced, 2026-07-27).** Aligned to industry best practice, applied to
**logic only** — `eslint` `max-lines` warns at **400** and `max-lines-per-function` at **80** (both
skip blank lines + comments), scoped to `**/*.ts` (which covers `.svelte.ts` view-models — pure logic)
and **NOT** `.svelte` (mostly markup + CSS, so a line count there measures the wrong thing). Warnings,
never errors — CI (`eslint .`, no `--max-warnings`) stays green; the warning is the "time to split by
concern" signal, not a gate. Tests are exempt.

Three companion rules on the same scope catch what a line count misses: **`complexity` warn 20** (size
≠ tangle — a short function with 20+ branches is still unreasonable; set at the standard 20, not 12, so
a clean `switch(kind)` dispatch isn't false-flagged), **`max-depth` warn 4** (deep nesting → invert
with early returns / extract), **`max-params` warn 4** (machine-enforces §2.2 — 5+ positional params
means group them into a typed object). All warn-only.

**The 400-line warn is the TRIGGER, not the target.** Once a logic file crosses 400, splitting it so
each resulting file sits *just under 400* is not enough — split so every result holds **at most ~300
logic lines, and preferably nearer ~200**. Aim for the ~200 sweet spot; treat 300 as the ceiling, 400
as "should have split already". (Same spirit for functions: 80 warns, but a healthy function is much
shorter.)

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

### 2.7 Errors surface, never vanish silently
**Rule.** An error is either **handled** (recover + carry on) or **surfaced** (returned as a Result /
pushed to `issues` / shown via `toast`/`notice` / set on `content.error`) — never swallowed into
nothing. No empty `catch {}`. A **best-effort** swallow (a failure the user genuinely shouldn't be
bothered with — a backup write, a watcher teardown, an existence probe) is allowed ONLY with a comment
saying *why it's safe to ignore*, and (once the logger lands — deferred) a `logger.debug`.

**Why.** Silent failure is the worst failure: the app misbehaves and no one — user or developer — can
tell what went wrong. Audited 2026-07-27: the codebase already follows this (51 `catch`, **0 empty, 0
`return-null` swallows**; the 3 `.catch(() => …)` are a boolean existence probe, a watcher teardown,
and a debounced theme write with a localStorage fallback — all justified). This rule **codifies the
existing practice** so it doesn't regress, it isn't a cleanup task.

**How to apply.** Catch → recover, or return/throw something the caller surfaces. If you must ignore,
comment the *why*. The missing piece is a real logging story (diagnostics for user bug reports) —
**deferred to its own session**; until then keep surfacing through `issues`/`toast`/`content.error`.

### 2.8 Options object over positional boolean flags
**Rule.** Don't pass bare positional booleans/flags — `cast(row, e, true, false)` is unreadable at the
call site. Use a named **options object** (`cast(row, e, { ritual: true })`) or an enum/union. Same
family as §2.2 (typed state) and §2.3 (enums over bare strings); `max-params` (§2.6) enforces the count
half, this covers the readability half.

**Why.** `foo(x, true, false)` tells the reader nothing about what the booleans mean; `{ ritual: true }`
is self-documenting and order-independent, and new options don't shift positions.

### 2.9 `$derived` is pure; side effects live in `$effect`
**Rule.** A Svelte `$derived` (and any getter feeding one) is a **pure computation** — it reads reactive
state and returns a value, with **no side effects** (no mutating other state, no IO, no `toast`, no
store writes). Anything that *acts* on a change belongs in an `$effect`.

**Why.** Svelte re-runs deriveds whenever their deps change, sometimes more than once; a side effect
inside one fires unpredictably and creates reactive loops / order bugs that are painful to trace. Pure
deriveds are the whole reason the `{value, trace}` core is testable and the UI is a thin shell.

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

**MANDATORY — full-screen dialogs carry a language switcher.** Any dialog/modal/banner that
covers the whole viewport (backdrop overlay, `alertdialog`/`dialog`, first-run, mobile warning,
…) MUST include `LangSwitcher` top-right. Rationale: it can appear *before* the user has reached
the topbar switch (or while covering it), so it may be the only text on screen — a user who can't
read the current locale must still be able to switch. `DialogShell` already bakes it in
(`.dialog-lang-corner`); a bespoke full-screen component adds it by hand. No exceptions.

### 4.5 Semantic colours & design discipline
**Rule.** Keep semantic colours consistent: **crimson** = important/danger, **teal** =
good/confirmation, **gold** = neutral marker. Visibility = open/closed **eye** (teal = shown);
state = **toggle switch**. Avoid templated AI-default looks (cream + terracotta). Shipped theme =
slate + heraldic crimson + gold; Space Grotesk / Inter / JetBrains Mono.

**How to apply.** Record durable design decisions in `docs/PLAN.md` (authoritative) in the same
change. Throwaway mocks live in `design-preview/`. Icons: bundle SVGs from flaticon.com /
streamlinehq.com (not emoji — emoji render as boxes in headless tests); keep CC-BY attribution.

### 4.6 Frontend architecture & UX pattern contract
**Rule.** Components are a **thin shell** — no D&D math in a `.svelte` file; they bind to the pure
core's `{value, trace, notes}` and render. A view's reactive state + actions live in ONE typed
`state.svelte.ts` VM class exported as a singleton (e.g. `combat`); components read via
`const x = $derived(vm.x)` (bare names in markup) and write through `vm.*`. Pure stateless
helpers/constants/types sit in sibling `*.ts` (unit-testable). Live switches
(`activeSystem`/`activeLocale`/`theme` + per-character `layout`) flow through reactive stores,
never a reload. Then apply these cross-cutting UX invariants in **every** component:
1. **State on/off → a toggle `Switch`** (teal when on), never a checkbox.
2. **Visibility (show/hide on the sheet) → an eye icon** (`EyeToggle`, teal = shown) — distinct
   from a state switch.
3. **Every auto-calc value → a hover/focus provenance popover** listing each `{source, op, amount}`
   + rule notes (AC, DCs, attack bonus, mods, passives, max HP, capacity…). A manually-overridden
   value shows a `manual` marker instead of a breakdown.
4. **Any value is click-to-edit** (manual override, anytime, independent of auto-calc).
5. **Lists are keyboard-navigable** — ↑/↓ highlight, **Enter = left-click**, Home/End, type-ahead
   (palette, spell/attack lists, roll log, compendium, every dropdown).
6. **Units** — imperial primary, **metric in parentheses** (`30 ft (9 m)`).
7. **Resource/slot/economy pips are click-to-set** — click a filled pip → empties it + all after;
   click an empty pip → fills it + all before (available-left / spent-right).
8. **Panels** — header = collapse chevron (▾) + title + right-aligned actions + drag-handle (⠿);
   panels collapse, show/hide, and drag-reorder **within the two-column area only** (never a free
   canvas).
9. **Icon slots take emoji OR image** — SRD ships no art (emoji/SVG fallback); homebrew/user
   entities may set an image.

**Why.** These are cross-cutting *conventions of intent* — which control means "state" vs
"visibility", how provenance surfaces, how pips fill — that can't be read out of the code or made
executable (there's no test for "teal = good"). Pinning them keeps every new panel consistent with
the shipped sheet instead of re-deciding per component. (Folded 2026-08-04 from the retired
`FRONTEND.md`; its component *inventory* is now the generated `docs/SURFACE.md`.)

**How to apply.** Reuse the existing primitives (`Switch`, `EyeToggle`, `RollButton`,
`DialogShell`, …) — grep `SURFACE.md` first (§4.4; CLAUDE.md "Reuse before you write"). Colours
follow the semantic roles in **§4.5**. The Combat view is the reference implementation
(`src/routes/combat/state.svelte.ts` + its `blocks/panels/*`).

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

### 8.6 Plan diverges from reality → sync it with the code, in the same change
**Rule.** Whenever you notice a plan / spec / status line that **contradicts what the code (or the
SRD source) actually does** — a `[x]` that isn't really wired, a design note the implementation
outgrew, a "binary recharge" claim after the enum gained a member, a feature described one way but
built another — **fix the doc in the same change** that surfaces the divergence. Don't leave the
stale line "for later"; either correct it now or, if it's out of the current scope, add a dated note
flagging the drift. The plan is only useful while it tells the truth.

**Why.** A plan that lies is worse than no plan — the next session (you or the maintainer) trusts it
and builds on a false premise. This is the same discipline as §8.3 (status honesty) and CLAUDE.md's
"update `docs/PLAN.md` in the same change when a decision proves wrong", generalized: docs track
impl, always. Concrete cases this session: `recharge` "is binary" → corrected once `short_one` landed
(EFFECTS.md); N2-PLAN's onEvent sketch "regain one, auto" → corrected to the SRD reality (player
choice, regain-all, own long-rest gate) the moment the SRD was checked.

### 8.7 Retiring / migrating a plan doc — grep `[ ]` AND `[~]`, verify transfer before deleting
**Rule.** Before deleting or folding a plan/status doc into another — or whenever you answer "what's
still open in X?" — enumerate the unfinished work by grepping for **both `[ ]` (open) AND `[~]`
(partial/in-flight)**, not just unchecked boxes: a `[~]` is unfinished work too (§8.3). Also sweep the
prose for non-checkbox deferral markers (`deferred`, `відкладено`, `лишилось`, `follow-up`, `TODO`,
`блокер`) — not every open item is a checkbox. Then, before the doc is deleted:
1. **Lift every open/partial item** into its new home (roadmap backlog entries), plus any non-obvious
   design rationale ("why we chose X / rejected Y") that isn't already captured in code, tests, or
   another spec. The *done-work* record and the full design archaeology stay recoverable in **git
   history**, so only the OPEN tails + the load-bearing "why" need to travel.
2. **Watch for STALE notes superseded by a later `[x]`** — an early "this is blocked / not done" line
   that a subsequent item already closed. Don't re-lift already-done work as if it were open (this
   session: an old "SpellRow flattens → ice_knife blocked" note had been superseded by the `[x]`
   multitype-damage item; the `heal` "not done" note likewise).
3. **Re-point every cross-reference** (other docs' `[[wikilinks]]` / markdown links, memory pointers)
   off the doomed doc so nothing dangles, then delete with `git rm`.

**Why.** "Closed 10/10" on the header doesn't mean *nothing* is left — deliberately-scoped follow-ups
and `[~]` partials still represent real backlog, and if they live only in a doc you delete, they
vanish from the roadmap. Grepping just `[ ]` misses the partials; trusting the header misses both.
This is §8.6 (docs track truth) applied at the moment a doc dies. Concrete case: retiring
`UPCAST-PLAN.md` — its five deferred tails (roller, authoring-UI, duration day-tail, preview tooltip,
invocation-scope) were lifted into `PLAN.md` as backlog items, the delta-combine / cantrip-retained /
N6 decisions were preserved as the "why", and every cross-doc link into it was re-pointed, all BEFORE
the `git rm`. (`CONCENTRATION-PLAN.md` was retired the same way right after — fully implemented, its
Model C + CON-save-reminder principle folded into `PLAN.md`, no open items to lift.)

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
- **Visual regression:** `tools/visual/shot.mjs` — Playwright **full-page** screenshots of key
  routes/states, pixel-diffed vs a saved baseline. `--update` captures the baseline (run BEFORE
  changes); no-arg compares (exit 1 + a per-state drift summary on any change); `--filter=<substr>`
  runs/updates a subset. Use it for **every** CSS/layout change. Each state gets a fresh page load
  (no cross-state leakage) and animations/transitions/caret are frozen, so captures are deterministic.
  Coverage includes **interaction states** (open menu, command palette, selected compendium entry) via
  per-state `prep` fns with a self-validating `ready` selector — add more by following the pattern in
  the file (covering the exact UI a change touches beats eyeballing). Baselines are machine/font-
  specific → gitignored, so regenerate locally. Note: the dev server is often NOT on 5173 — read
  `pnpm dev`'s output and pass `BASE=http://localhost:PORT`.
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
- **Never punt a CSS/visual task as "I can't verify it visually."** You can, end to end: run
  `shot.mjs` for the covered states, and for anything it doesn't cover (a menu, dialog, edit-mode,
  a selected entry) write a one-off Playwright `.mjs` **inside the repo** (e.g. `tools/visual/_x.mjs`
  so `import { chromium } from 'playwright'` resolves `node_modules` — a script in a tmp dir throws
  module-not-found), drive to the state, `page.screenshot(...)`, then **open the PNG** to actually
  see it; delete the script after. A compose-a-shared-class-in-markup CSS refactor is
  computed-style-identical, so the pixel-diff is a safety net for a slip, not a sign change is
  expected — and composing a shared class in markup has **no** global-selector collision risk (that
  risk is only for adding a generic name like `.section`/`.group` to a global group-selector).
- **Offer 2–3 rendered variants** when a design choice is open (ability tile, inventory, tags) — the
  maintainer picks from *seeing* them, not from names/ASCII.
- Global CSS keeps colliding in the mocks — when baking a mock, use **Svelte scoped styles** (or
  BEM) to kill it permanently; don't reuse short generic class names as both a component and a
  modifier.
- Build views by faithfully **baking the `design-preview/*.html` mocks** + wiring live data, not
  simplified from scratch.
- Record durable design decisions in `docs/PLAN.md` as they're made, in the same change.

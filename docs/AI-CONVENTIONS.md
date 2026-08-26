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
  2014 "separate save per source" vs 2024 dropping it) → **offer the choice** (CONVENTIONS §4.8),
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

### 1.6 No manifests or index files — discover by scanning, describe in-band

**Rule.** A set of things on disk is discovered by **scanning the folder**, and each thing describes
**itself**, in itself. Do not add a sidecar file that lists, indexes or versions other files.
For content that means the `#content-*` header block inside each CSV; for anything else it means the
metadata rides the artefact.

**Why.** A manifest is a second source of truth that immediately starts drifting from the files it
claims to describe: rename a file and you edit two places, delete one and the index lies, hand-edit a
row and the manifest's version is stale. It also taxes the *author* — this project's whole premise is
that a non-technical person owns their data as plain CSV, and "also remember to bump the JSON" is
exactly the tax that premise exists to remove. Prior art already in the tree: `drafts/store.ts`
("ONE self-contained JSON per draft, **NO manifest/index** — discover by scanning"), and every content
CSV carrying its own `#content-source` / `-license` / `-id` / `-hash`.

**The case that settled it (2026-08-10, REL-4).** Designing content packs fetched from a URL, a
`pack.json` manifest was proposed — version, file list, license, source tag — and rejected. Going
in-band turned out **strictly better**, not merely equal:
- a pack is a **folder**, so the folder listing IS the file list — no format to keep in sync;
- matching by the in-band **`#content-id`** GUID makes a rename a no-op, where a path-keyed manifest
  would have produced a duplicate;
- **per-file `#content-hash`** answers "did *this* file change", which is finer-grained than a
  pack-level semver *and* lines up exactly with the per-file hand-edit check REL-3 already does.

**How to apply.** Reach for scanning + in-band metadata first, every time — the pull toward "just add a
small index" is constant and it is what this rule exists to resist. If a new sidecar looks unavoidable,
say why in the PR: the bar is that the fact genuinely cannot live inside any single artefact.

**Legitimate exceptions — these are NOT the artefact this rule is aimed at, do not "clean them up":**
- **`plugins/<ns>/plugin.json`** — a plugin is *code*, not data, and its manifest carries the **consent
  hash**, a security artefact that needs a stable, non-executable subject to hash (§4 / SECURITY.md).
- **`collisions.json`** — records a decision *between* several sources. It cannot live in one of them
  without making that file authoritative over the others; PLAN keeps it deliberately separate from
  `charnik.config.json` for the same reason.
- **Single-field markers** (`demo-seeded.json`, `content/.seed-version`) — these state one fact about
  the install, they do not index anything.
- **`charnik.config.json`** — app configuration (settings, toggles, and the `contentPacks` registry
  section) — not a description of data. It has several owners, so each writes ONE top-level section
  via `storage/json-config.ts`; the dev-only content-clone pointer is a separate file in the app
  repo, `charnik.dev.json`.
- **`static/content/manifest.json`** (web build) — HTTP genuinely has no directory listing, so
  `FetchStorage` needs one to `list()` at all. It is GENERATED by scanning at build time, gitignored,
  and never hand-authored, so it cannot drift from the files it describes. Desktop ignores it and
  scans the real folder. Don't extend it into a content description — it holds paths, nothing else.

---

### 1.7 A new content TYPE is not a backwards-compatible content change

**Rule.** Content ships from its own repo on its own schedule (CLAUDE.md, REL-4) — that is the point
of the split. So a content change lands on app builds that are ALREADY INSTALLED, and only some kinds
of change are safe there. Adding rows, fixing values, adding a locale column: safe, an older build
reads what it understands. Adding a new content **type** (a new `CONTENT_TYPES` entry and a
`<type>_*.csv` beside the others): **not** safe — every older build calls that file an unknown type
and skips it, with a warning the user did nothing to earn.

**Two things follow, and BOTH are easy to forget.**
1. **Bump `CONTENT_SEED_VERSION`** whenever the shipped set of files changes — a NEW file is the
   easiest case to miss, because nothing about an existing file looks stale. Without the bump a
   desktop install seeded at the old version simply never receives it.
2. **Do not declare `#content-type:` on a file whose type is new.** Left to the filename, an older
   build reports a WARNING and skips one file; declared explicitly, the same build reports an ERROR.
   Both skip it, so the quieter one is the kinder one.

**Why it is a rule and not a note.** The failure is silent in the direction that matters: the app is
FINE — the missing file only removes something additive — so the only signal is a warning about a
file the user never touched. The message names the real cause ("content newer than the app —
updating Charnik would read it") precisely because a typo is no longer the likeliest explanation.

**The case that made it (2026-08-21, RES-NAME).** Adding the `resource` type shipped
`resources_srd.csv` to the content repo; the maintainer pulled content, kept the installed app, and
got two "unknown content type" warnings. Nothing was broken — pool names fell back to a title-cased
id, exactly as designed — but the seed version had not been bumped either, so the file would not have
arrived at all on the next app update.

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

**Exception — don't over-tighten loose partial-map keys (WON'T-DO).** The play-state partial maps
(`abilityBoosts`, `spellSlotsSpent`, `hitDiceSpent`, `resourcesSpent`, `panelColumns`) stay
`z.record(z.string())` + `noUncheckedIndexedAccess` (so a read is `V | undefined`) — that is the
*honest* type. Branding the key to a finite union would make the type LIE (claim a value is defined
when the runtime slot is absent) for a near-zero gain and a migration. This is a deliberate carve-out,
not debt to "fix" later.

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

**FILES follow the same rule, and the mechanical version of it is: a module that exports one class
is named after that class** (`RollTray` → `roll-tray.svelte.ts`, `ActionExecutor` →
`action-executor.svelte.ts`). One-word module names read fine to whoever just wrote them and stop
reading fine the moment a sibling lands: this session shipped `roll.svelte.ts` next to
`rolls.svelte.ts` — the tray and the roll semantics, distinguished by an `s` — and
`updates.svelte.ts` next to `update-state.svelte.ts`. Renamed 2026-08-14 (`git mv`, so blame
survives). If the class name is itself vague, that is the thing to fix first: `Rolls` became
`SheetRolls` before the file could be named after it.

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
and **NOT** `.svelte` (mostly markup + CSS, so a line count there measures the wrong thing). **What
to measure in a `.svelte` instead: the non-comment lines inside its `<script>`** — that is the logic,
and logic is what belongs in the view-model (§7.2). Judged that way the ranking inverts: a 575-line
`RollRow.svelte` is 90% markup and fine, while a 550-line `+layout.svelte` carrying 221 lines of
script is not. Never quote a `.svelte` file's total line count as debt. Warnings,
never errors — CI (`eslint .`, no `--max-warnings`) stays green; the warning is the "time to split by
concern" signal, not a gate. Tests are exempt.

Three companion rules on the same scope catch what a line count misses: **`complexity` warn 20** (size
≠ tangle — a short function with 20+ branches is still unreasonable; set at the standard 20, not 12, so
a clean `switch(kind)` dispatch isn't false-flagged), **`max-depth` warn 4** (deep nesting → invert
with early returns / extract), **`max-params` warn 4** (machine-enforces §2.2 — 5+ positional params
means group them into a typed object). All warn-only.

**A comment does not keep a changelog.** Git already holds what the code used to be, who changed it
and when — a source file repeating that is a diary nobody updates. Two lines to hold on to:
- **an example of a VALUE earns its place** (`e.g. "5e,5.5e"`, `e.g. `full`, `pact``) — it shows the
  shape faster than a sentence. An example from the project's HISTORY does not;
- **past tense is allowed only when it names a failure that RETURNS if the code is undone.** "The
  prune used to sit behind this return, so switching modes stranded every staged byte" is a guard
  and must stay. "Split out of the old monolithic page", "went 2026-08-14", "reversing the note that
  used to sit here" are diary entries — delete them, and drop dates and session references with
  them ("this session" means nothing at the next one).

**Auditing comment VOLUME.** Comments themselves are wanted; the objection is to volume that carries
nothing. Run the audit in this order: **measure the repo's baseline first** (Charnik sits at a 27%
comment share, median 26%, p90 42% — so a 28% file is normal here). Then apply the ratio **only to
BIG files**: on a small one it ranks by SIZE, not by verbosity — a necessary 5-line header over 18
lines of code reads as 47% and looks guilty, while a wasted paragraph in a 350-line file hides at 2%.
Never present a small file's percentage as evidence. **Judge small files paragraph by paragraph**,
one test: *is there a reader who, without this, makes a mistake?* If not, cut it. Look hardest at the
header of a small NEW file — comments carried along with moved code sit at the house median; the ones
written from scratch are the heavy ones.

**`pnpm loc` is how you read these numbers** (§10) — it counts exactly what the rules above count,
so a file's size means one thing here. `wc -l` disagrees by roughly a third and has misled a planning
pass in this repo already.

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
split by concern rather than comment around it. **`pnpm loc` is the current list** — don't keep a
copy of it here, it goes stale the moment a carve lands (this paragraph named `combat/helpers.ts`
for a month after it was split). Spend comments on the non-obvious *why*. (Exception: genuinely
over-complex logic warrants a short what-it-does note.)

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

### 3.3 Deliberate non-duplicates — do NOT merge these
**Rule.** A handful of look-alikes are kept separate ON PURPOSE. `surface.mjs`/`knip` still flag them
as suspects, and every session runs "Reuse before you write" (3.1) — so each is a standing risk of a
well-meaning wrong merge. Do NOT collapse:
- **`EFFECT_KINDS`** (`content/schemas`) vs the effect-vocab in **`effects/token-parser`** — SEPARATE so
  content validation doesn't depend on the removable effects module; a drift test in `effects.test.ts`
  keeps them aligned, NOT a shared import.
- **`formatModifier`** (`rules/dice`, pure core) vs **`signed`** (`util/format`) — same body, but the
  hot roll-path core must not pull `util`; the duplication is the accepted cost.
- **`displayNamesByLocale`** / translate name-reads vs **`localizedName`** — DIFFERENT semantics: search
  indexes ALL locales with no fallback; translate uses `?? ''` (empty = "not translated", NOT EN
  fallback). Merging breaks both.
- The **`cap`/`label` LABELS maps** in `content/detail`, `homebrew`, `grouping` — they share only the
  `titleCase` fallback (already factored out); the maps themselves are genuinely different.

**Why.** "One thing in one place" (CLAUDE.md) is about *shared logic*, not incidental body-similarity;
merging a same-shaped-but-differently-purposed pair couples modules or silently changes behavior.

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

**The house dialog shape.** The orphan-draft reassign dialog (`design-preview/orphan-popup.html`) is
the approved template every later attention dialog bakes from: centered modal on a dim backdrop; a
round badge header + title + optional count pill ("1 of 2") + one muted subtitle sentence; a
**two-pane body** whenever the decision needs a comparison (the user's work left, the thing being
chosen right, with a searchable picker + live preview); footer = destructive action far-left, then a
spacer, then Skip → secondary → primary. Share the shell through the global `.dialog` classes rather
than re-styling per dialog.

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
change. Throwaway mocks live in `design-preview/`, and so does every screenshot or rendered preview
you produce — never the repo root, never a temp dir: the folder is gitignored for images, the
maintainer already opens it, and a scratchpad path is one they cannot find. Icons follow **§4.7**
(drawn via `Icon.svelte`, never a font glyph or emoji).

### 4.6 Frontend architecture & UX pattern contract
**Rule.** Components are a **thin shell** — no D&D math in a `.svelte` file; they bind to the pure
core's `{value, trace, notes}` and render. A view's reactive state + actions live in ONE typed
VM class named after itself (`CombatVM` → `combat-view-model.svelte.ts`, §2.4) and exported as a
singleton (e.g. `combat`); components read via
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
(`src/routes/combat/combat-view-model.svelte.ts` + its `blocks/panels/*`).

### 4.7 Icons are drawn, never typed

**Rule.** A character that is **text** stays text — `−`, `≥`, `∞`, `×`, an arrow inside a sentence are
set at text size and the font was designed for them. A character standing in for an **icon** is DRAWN:
`<Icon name="…" />` (`src/lib/components/Icon.svelte`, Lucide paths bundled locally), or plain CSS
geometry when the shape is trivial. No emoji-as-icon, no icon FONT.
**One exception worth naming: a −/+ pair.** Half a stepper drawn and half typed reads worse than
either choice made consistently, so a pair goes together.

**Why.** A font glyph doing an icon's job fails three different ways, and all three get worse as the
display shrinks or the page is zoomed out — which is where this app gets used (phone, laptop at
1920×1080 zoomed out):
- **Rasterisation.** A small filled glyph with no vertical stem has nothing to hint against, so its
  diagonals blur together. `◆` at cue size rendered as a rounded blob (maintainer, 2026-08-10).
- **Font fallback.** A glyph the app's fonts don't carry is substituted from whatever the OS has, at
  that font's metrics — `⇈` drew its two arrows at visibly different heights for exactly this reason.
- **Presentation drift.** `⚠`, `☀`, `✦` and friends render as colour emoji on one platform and
  monochrome on another, so the same build is not the same UI on two machines.

**How to apply.** `<Icon name="…" size={13} />` — the name is Lucide's own, so a new glyph is one
import + one map entry in `Icon.svelte`. Two icons stay hand-drawn because no set has them:
`DamageIcon` (thirteen damage types) and `EyeIcon` (the open/closed pair). For a trivial geometric
indicator, CSS is lighter than an SVG and exact: the roll card's advantage cues are three `clip-path`
polygons filled with `currentColor` at a size we choose, with no font in the path (`RollRow.svelte`).

**An icon-only control names itself.** Its glyph used to BE its accessible name; an SVG has none, so
pass `label` (→ `aria-label` + `role="img"`). Beside a text label, leave `label` unset or a screen
reader reads it twice.

**An icon never lives in a STRING.** Not in an i18n catalog (a translator would carry, or drop, the
app's iconography), not in a status/kind map. Map to an `IconName` and render it — `DialogShell`'s
`badge`, `DraftsPane`'s kinds and translate's status marks are the worked examples. The sweep of
~100 sites is done: **PLAN · UBUG-19**.

### 4.8 A play-tracker SURFACES and suggests — it never auto-applies

**Rule.** When a feature triggers on a game event, the app **highlights** the option, reminds the
player, and pre-fills a smart default (a suggested DC, the likely amount) — and the **player clicks**
to resolve it. Never silently mutate play-state on the player's behalf.

**Why.** Most RAW features are "you *can*", i.e. a choice, and auto-doing them steals it. The tracker
does not hold full game state either — what counts as one *instance* of damage, whether you "attacked
an enemy" this turn — so it cannot correctly auto-decide. Forcing also breaks on corrections: a
concentration prompt on every Damage press fires again when someone enters 72, then 71, then +1 to
fix it.

**How to apply.** Conditional abilities are always listed, greyed when unavailable, highlighted with
a notice when their window opens. A mandatory save (concentration on damage) is an on-demand button
beside its indicator — like the death-save button at 0 HP — carrying a suggested but editable DC, not
an auto-popup. Prefer *event → reminder* over an auto-mutating event bus. Same family as §1.2 (offer
both readings, don't hardcode one).

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
fully rewritten (the effects system, the roller). **Pre-release**, lay tests over everything properly.

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

**How to apply.** CI (`.github/workflows/ci.yml`) runs `pnpm check` → `pnpm test` → `pnpm lint` →
`pnpm build`; run them all and only commit when all pass. `knip` and `jscpd` are part of `pnpm lint`.

**A RELEASE obliges the type-aware pass too.** `pnpm lint:typed` (`config/eslint.typed.config.js` —
floating promises, await-thenable, dead casts) is CI-only: it builds the whole TS program, **~9m30**,
so it runs in no git hook and nothing local catches its errors — they accumulate silently and surface
on push. **The trigger, needing no further confirmation: the maintainer asks to fill in the CHANGELOG,
or asks directly to prepare a release.** On either, run every step in order before tagging, and start
the typed pass early in the background (`run_in_background`) so it overlaps the rest of the release
work. For an ordinary commit the same config scoped to your own diff —
`npx eslint -c config/eslint.typed.config.js <files>` — returns in seconds and covers what you wrote;
the whole-repo run only adds drift someone else caused.

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
1. **Per-view view-model** → `<view>-view-model.svelte.ts` (§2.4 — the file is named after the class
   it exports): a typed `class` with `$state`/`$derived` fields +
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

### 7.2b The comment-revision pass — a SEPARATE commit, after the split lands

**Rule.** §7.1 lets you fix only the comments the split itself made stale, and otherwise says don't
churn. Bringing a file's comments up to the CURRENT conventions is a different job: do it as its own
commit, after the extraction is green — never inside it.

**Why.** A reworded comment inside a byte-preserving move hides whether the code changed too. Split
the commits and each diff answers one question: this one moved lines, that one only touched prose.

**What the pass revises** (in a file you were already in — this is not a repo-wide sweep):
- a comment that narrates WHAT the code does → make it WHY, or delete it (§2.6);
- a comment naming a function, file, flag or directive that no longer exists;
- a comment written before a convention existed and now contradicting it (§1.5 open enums, §2.5 one
  name per fact, §4.7 drawn icons).

A comment that is still correct is left alone. The pass fixes lies and noise, not style.

### 7.3 Lean on TS + Svelte tooling for cross-scope wiring
**Rule.** Maximally use TypeScript types and Svelte's own tooling so scopes/modules wire together
correctly — especially around classes, `.svelte.ts` rune modules, context, and cross-component
state. Let the compiler catch wiring mistakes instead of finding them at runtime.

**How to apply.** Give shared state an explicit typed shape; type `getContext`/`setContext` with a
typed key so consumers get inference, not `unknown`. Prefer idiomatic Svelte 5 primitives
(`$state`/`$derived`, arrow-method fields) over ad-hoc wiring. A green `svelte-check` is the
correctness gate for cross-scope moves.

### 7.4b A file that belongs somewhere else MOVES — and `git mv` is how

**Rule.** When a module (or a symbol inside one) turns out to belong in a different folder or file,
move it as part of the change that discovered it. A thing living in the wrong place is a small, real
tax: readers look in the wrong file, and the wrong module ends up importing the right one.

**The signals, in order of how loud they are:**
- **an import cycle** (`madge --circular`, §10) — almost always one module doing two jobs, a leaf's
  policy plus the orchestration over it. Move the leaf out. `content/disk.ts` came out of
  `provider.ts` this way, and `build/rows.ts` out of the build view-model, both because a new sibling
  needed the leaf and got the whole module instead;
- **a symbol imported from outside its home more than from inside it** — its home is now a detour;
- **a name that only makes sense once you know which folder you are in.**

**How to apply.** `git mv`, never delete-and-recreate — blame is the record of why a line exists, and
a recreated file starts that record over. Then rewrite the imports mechanically. **If the basename
is ambiguous across folders, the rewrite must be DIRECTORY-AWARE**: two modules both called
`state.svelte.ts` meant a plain string swap sent `build/`'s imports at the combat view-model, which
was the exact ambiguity the rename existed to remove (2026-08-14). The gate that catches it is
`svelte-check`, so run it before the commit, not after.

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
**Rule.** In `PLAN.md` (and any todo/status list), a fix may be proposed / designed / written up,
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

### 8.5 A question asks for INFORMATION — answer it, then stop
**Rule.** When the maintainer asks something, that is a request for information, not permission to
act on the answer. This covers every form of it, not just "should I…?":
- **"чи треба X? / do I set `fullscreen: true`?"** — a diagnostic question;
- **"propose / suggest / запропонуй"** — they want the proposal, so they can choose;
- **"explain / поясни / how does X work"** — they want to understand it;
- **"tell me / розкажи / скажи"** — they want to be told, and "скажи, як це зробити" asks for the
  method, never for the result;
- **"is there anything that…? / чи є щось…?"** — they want the finding and will decide what to do
  with it.

The imperative mood is what makes these easy to misread: «розкажи», «поясни», «запропонуй» are
grammatically commands, and they command SPEECH — not the work being spoken about.

**Why.** The maintainer often wants to make the change themselves, or to weigh the options before any
of them is committed to. A preemptive edit takes the decision away and hides which parts were their
call.

**How to apply.** Answer, give the exact change you WOULD make, then stop and let them reply. Act
only on an instruction ("роби", "давай", "do it"). A long answer is still an answer — length is not a
licence to start. The one exception is a standing instruction already given for that run (an explicit
autonomous handoff), and even inside one, a direct question is still a question.

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

**The other direction, and it is the one that actually rots (added 2026-08-14).** The rule above
fires when you NOTICE a stale line. That is not enough on its own: the ten drifts found by reading
PLAN end-to-end that day had all survived several passes precisely because nobody was looking at
those lines — four sat inside items already ticked `[x]`, which is where nobody re-reads. So the
rule has a second, non-optional half:

> **Finishing something, renaming something, or deleting something is not done until the docs that
> describe it are updated in the SAME commit.** The doc set is a grep away, so there is no excuse
> for guessing which files: before committing, grep `docs/` + `CLAUDE.md` for every identifier the
> change touched — the function, the file, the directive, the constant, the item id. Each hit is
> either still true or it is the drift.

**The two smells to grep FOR**, both from that day's ten:
- **A requirement in the present tense that is now built** — "the installer *must say so* before
  installing", "*still owes*", "*remain to wire*", "does not exist *yet*". Shipped work described as
  owed makes the project look unfinished and sends the next session to re-do it. Grep: `still owes`,
  `remain to`, `not yet`, `TODO`, `OPEN (`.
- **A name that no longer exists** — `hashBody` (now `restampText`), `#charnik-type:` (never parsed;
  it is `#content-type:`), `_pack.json` (rejected with every other manifest, §1.6). Grep the OLD
  name at the moment you rename, not later.

**Rank the fix by what a reader would DO with the lie**, because they are not equal. Worst is a doc
that instructs building what the architecture forbids — `_pack.json` was still specced in the data
model of a project whose §1.6 bans manifests, so a reader following the data model would have built
the banned thing. Next is a summary that contradicts its own body (REL-4's header claimed nine
unfixed security findings above a section reporting twelve fixed) — the header is what people read.
Last, and still worth fixing, is shipped work listed as owed.

### 8.6b The plan is PRUNED, not accumulated — closed work leaves, the "why" stays

**Rule.** `docs/PLAN.md` is a working document, not an archive. When work CLOSES, its narrative
leaves; only what future work must still respect stays. Two shapes of this:
- **A superseded section** (a "current focus" that is no longer current, a design supplanted by a
  later decision) → run the §8.7 sweep and **delete it**. Do not keep it renamed "Previous / CLOSED /
  kept for the reasoning". The sweep is the safeguard; the deletion is the point.
- **A closed `[x]` item** → at the moment it is ticked, split it. The *done narrative* ("we changed
  X, here is how, verified by Y") is git's job — delete it. A **locked decision, a rejected
  alternative, or a constraint the next person must not re-litigate** is not narrative: keep it, but
  move it to where it belongs (the relevant spec section, a code comment, a test name) rather than
  leaving it as a checkbox nobody will ever untick.

**Measured 2026-08-11:** PLAN was 2391 lines, of which **598 sat inside `[x]` items** — closed work
occupying as much of the file as open work (627 lines). That is the tax this rule exists to stop.

**Why.** A plan people stop reading is worse than a short one. Every kept-for-history block is one
more thing a future reader must classify as live or dead, and that classification is not free — it is
exactly how PLAN ended up with two competing "what's next" lists, the stale one sitting above the
real one. Git holds the full text forever, so "we might want the reasoning" costs one `git log -p`,
not a permanent tax on every read. (Maintainer, 2026-08-11: *"давай хоча б спробуємо"* not to bloat
the plan — recorded because the reflex to keep is strong and mine defaulted to keeping.)

**The trigger, so it actually happens.** Prune when an item closes and when a wave closes — not "some
day". A cleanup nobody schedules is the same as no rule.

**How to apply.** Same sweep either way — run §8.7 exactly as for a whole doc: grep `[ ]` AND `[~]`, sweep the prose for
deferral words, and **verify each unique item survives somewhere that is not this section** — its
own ledger, a code comment, a test. In the case that produced this rule the two load-bearing bits
were already elsewhere (the L3-`onEvent` decision in `N2-PLAN.md`, the recharge-generosity tie-break
in `effects/apply.ts` with a test pinning it), and one prose-only tail — "Evergreen Wild Shape needs
Wild Shape tracked" — was already carried by `N2-PLAN.md`. Then delete. If something is unique,
MOVE it first; the rule is not licence to drop content, only to stop shelving it. When in doubt about
a closed item, ask: *would someone doing the NEXT piece of work be wrong without this?* If no, it is
narrative and git has it.

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
4. **Verify by COUNTING, never by reading.** Before committing a bulk edit, diff the structure
   against `HEAD` and expect every number to match except the one you meant to change:

   ```sh
   for pat in '^- \*\*' '^\*\*' '^#' '^- \[ \]' '^- \[~\]' '^  - \[ \]' '^- \[x\]'; do
     echo "$pat  $(git show HEAD:docs/PLAN.md | grep -c "$pat")  ->  $(grep -c "$pat" docs/PLAN.md)"
   done
   # and the ids themselves, not just the totals
   diff <(git show HEAD:docs/PLAN.md | grep -o '^- \[ \] \*\*[A-Za-z0-9-]*' | sort)         <(grep -o '^- \[ \] \*\*[A-Za-z0-9-]*' docs/PLAN.md | sort)
   ```

   Any unexplained delta is content you dropped. Explain each one out loud before committing — "44→40
   because R2–R5 merged into one line" is fine; a number you cannot account for is not.
5. **An item does NOT end at the next `- [`.** A block runs until the next construct at the same
   level — which in PLAN also means a bold-heading paragraph (`^\*\*Data versioning …**`), a
   non-checkbox bullet (`^- \*\*DATA-VER-1 …`), or a markdown heading. And a `[x]` item may own
   NESTED `  - [ ]` tails that are live backlog. Stop at `^- |^\*\*|^#`, and check the nested count
   separately — `^- \[ \]` will not see them.

**Why (4 and 5 specifically, learned the hard way 2026-08-11).** Pruning ~40 closed items from PLAN
dropped content TWICE — first a bold-heading paragraph plus the `DATA-VER-1` item below it, then
three nested `[ ]` UPCAST tails that had no other home. Both times the sweep had been "done" by
reading, and both times the loss was caught only by the count diff. Reading does not scale past a few
blocks; counting does, and it is three seconds.

**Why.** "Closed 10/10" on the header doesn't mean *nothing* is left — deliberately-scoped follow-ups
and `[~]` partials still represent real backlog, and if they live only in a doc you delete, they
vanish from the roadmap. Grepping just `[ ]` misses the partials; trusting the header misses both.
This is §8.6 (docs track truth) applied at the moment a doc dies. Concrete case: retiring
`UPCAST-PLAN.md` — its five deferred tails (roller, authoring-UI, duration day-tail, preview tooltip,
invocation-scope) were lifted into `PLAN.md` as backlog items, the delta-combine / cantrip-retained /
N6 decisions were preserved as the "why", and every cross-doc link into it was re-pointed, all BEFORE
the `git rm`. (`CONCENTRATION-PLAN.md` was retired the same way right after — fully implemented, its
Model C + CON-save-reminder principle folded into `PLAN.md`, no open items to lift.)

### 8.8 Every line of prose carries information, or it goes

**Rule.** Don't write volume for its own sake — in a doc, a PLAN entry, a commit body, or a comment.
If a line adds nothing the reader lacks, cut it.

**Why.** Almost every doc in this repo is read by an assistant or by the one maintainer. Prose
written to look thorough is pure cost: they scroll past 200 lines to find the 2 that matter.

**How to apply.** A doc that tracks work states what is OPEN — what closed lives in git, so link the
SHA instead of retelling it (§8.6b). One reason per fact, once, in one place: two homes for the same
reasoning means one of them rots. A commit body says what changed and why it was wrong before, not a
tour. Cut restatements of what the code says, headings with nothing under them, and hedging. An
explanation the maintainer explicitly asked for is not filler — give that one in full.

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

### 9.5 A message says what happened, what it means, and what to do — the token goes underneath
**Rule.** Any string a USER can see when something goes wrong (a loader/derive issue, a toast, a
dialog, a form error) is a sentence in their words, answering three things: **what happened**, **what
it means for their sheet**, **what to change**. The exact technical particular — the effect token,
the column name, the validator's own complaint, a plugin's error, an id — is **demoted, never
deleted**: it goes in the `detail` field of `ContentIssue`/`EffectIssue`, or in a toast's
`description`, so the homebrew author still gets the fault while the CSV owner gets the sentence.

**Why.** The app is for people who own their data as plain CSV, not for developers (CLAUDE.md), and
the same panel serves both audiences. `duplicate source:id "spell:SRD 5.1:x"` is a complete
explanation to whoever wrote the loader and no explanation at all to anyone else. The demotion is
what lets one message serve both without either half being written twice. Established by the UX-1
pass (PLAN); the copy that pass produced is the reference for tone and length.

**How to apply.** Name things as the UI names them (a resource by its NAME, an edition via
`SYSTEM_LABELS`, a source via `sourceLabel`, a form field by its own label, a route by the path the
user actually clicks). Say the consequence in the same sentence: *skipped*, *changes nothing*, *not
offered*, *nothing was changed*. Where a closed vocabulary was mistyped, add `didYouMean`. Where a
dozen internal reasons share one meaning and one fix (every plugin failure), collapse them to one
sentence at the seam and keep the reason in `detail` rather than writing twelve half-sentences. Copy
for content issues lives in `content/issue-text.ts`, not inline at the `push()`.

**Testing.** Assert the DURABLE fact — the identifier in `detail`, the level, the file, that the
action was refused — never the sentence, which is copy and will be rewritten (CONVENTIONS §6.1).

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
  **ONE red run is not evidence.** It can fail on different states and then pass with no code change
  in between — round/turn-dependent chips drift on their own, and a dev server that lived through a
  file rename serves a stale HMR graph. Re-run, and restart `pnpm dev` after renaming modules, before
  believing a drift report.
- **CSS analysis:** `tools/visual/css-dups.mjs`, `css-name-collisions.mjs`, `css-classes.mjs`;
  refactor helpers `hoist-class.mjs`, `rename-class.mjs`.
- **`pnpm loc`** — lines of CODE per file, worst first (`--all` for everything, or pass a path
  fragment). It counts the way eslint's `max-lines` does (`skipBlankLines` + `skipComments`) **and is
  checked to agree with it digit-for-digit**, so there is one number for "how big is this file", not
  a tool with a second opinion. `wc -l` is not that number: this repo comments heavily, and the
  file eslint calls 524 is 757 by `wc`. For a `.svelte` it counts the `<script>` blocks only (§2.6).
  **Reach for it at three moments, and never quote `wc -l` at any of them:** before choosing what to
  split (so the target list is the real one — `derive.ts` sat fourth-biggest all along and never made
  a "top 3" picked by `wc`), when stating a size in a report or a commit message, and after a carve
  to say what it actually bought. `--verify` re-checks the agreement with eslint if either side
  changes.
- **`pnpm knip`** — part of `pnpm lint`, but its rules are set to `warn`, so it reports and exits 0:
  it is a REPORT, not the gate this line used to claim. Don't reintroduce unused exports; un-export
  rather than exporting "just in case", and triage what it lists (§8.4 — in active dev an unused
  export is sometimes scaffolding, so read before deleting).
- **The pre-commit hook runs `eslint .`** (added 2026-08-14, +21 s — the hook is ~38 s). It was
  prettier + jscpd only, and that gap was not theoretical: three splitting commits went in green over
  a red `pnpm lint`, 35 unused imports left behind by the carves, because nothing between the commit
  and `pre-push` ever looked. A gate you only meet at push time is a gate you meet with five commits
  already written on top of the break.
  **Editing the `simple-git-hooks` block in `package.json` changes nothing on its own** — the command
  is COPIED into `.git/hooks/pre-commit` at install time, and only `postinstall` re-copies it. That
  `eslint .` sat in package.json for a week while the installed hook still ran the pre-eslint version,
  invisibly. After touching the block, run `npx simple-git-hooks` and `tail -1 .git/hooks/pre-commit`
  to see what will actually run.
- **`pnpm jscpd`** — copy-paste detector, threshold 1.8% (part of `pnpm lint` + pre-commit). The
  CONFIG reporter is `silent`, i.e. the one-line verdict ("108 clones, 0.92% duplicated") and nothing
  else, because a pre-commit hook that prints two hundred lines of other people's CSS on every
  successful commit trains you to stop reading it. The threshold still fails the commit exactly as
  before — the reporter decides what is PRINTED, not what passes. `pnpm jscpd` overrides it with
  `consoleFull` for when you actually want the list.
- **eslint `no-restricted-imports`** gates two invariants: `@tauri-apps/*` only in
  `lib/storage/tauri.ts` + `lib/update/**`; `src/lib/rules/**` must not import effects.
- **`madge --circular src`** (part of `pnpm lint`) — no import cycles. A cycle is usually a module
  doing two jobs (a leaf's policy plus the orchestration on top of it): split the leaf out rather
  than reordering imports. The `$lib`/`$app` aliases live in `.madgerc` — without them madge
  silently SKIPS every aliased import and reports "no cycles" for a repo full of them, so check the
  skipped-file count if you ever touch that config. It is the ONE linter config still in the repo
  root (the rest moved to `config/` on 2026-08-21): madge has no `--config` flag, it only reads
  `.madgerc` from the cwd. Don't try to move it again.
- Also: `tools/srd/*` (SRD converters), `tools/build-static-content.mjs` (predev/prebuild).

### 10.1 How long things take — set a timeout, not a ceiling

Set a command's timeout to roughly **2× its expected duration**, never a comfortable ceiling:
completion detection is unreliable, so a finished command often keeps the turn blocked until the
timeout expires. A 15-minute ceiling on a 15-second test run is 15 minutes the maintainer sits
through — the generous ceiling is not free insurance, it IS the cost. Measured durations: `pnpm test`
~15 s · `pnpm check` ~10 s · `eslint .` ~26 s · `pnpm build` ~10 s · a single `vitest run <file>`
~2 s · `tools/visual/shot.mjs` ~30 s for the full set · `pnpm lint:typed` **~9m30** (§6.3). For
anything genuinely long or unknown, run it in the background instead of buying a big timeout.

### 10.2 Toolchain constraints that will bite

- **TypeScript stays on 6.x.** The TS 7.0 bump was closed and the major is on dependabot's ignore
  list: `typescript-eslint` hard-errors "does not support TS 7.0", which breaks the whole `eslint`
  step (and `pnpm lint` / CI) even though vitest passes. Revisit when typescript-eslint ships TS≥7
  support (upstream: typescript-eslint#10940).
- **Browser tests need a local chromium.** `*.browser.test.ts` run under the `browser` vitest project
  (Playwright, headless); a fresh machine needs `pnpm exec playwright install chromium` first, or it
  fails with "Executable doesn't exist". Run just them via `pnpm vitest run --project browser`.
  Under vitest-browser-svelte 3, `render()` is **async** — `await render(...)`, or you get
  `screen.getByRole is not a function`.
- **Two shells, two syntaxes.** This repo is worked primarily from **PowerShell**, and the
  here-string habit `@'…'@` leaks into commands sent to a Bash tool, where `@` is not a quote and
  mangles the message — most visibly in `git commit -m`. For any multi-line message the
  shell-agnostic path is **`git commit -F <file>`**; if you inline it, match the tool (Bash `<<'EOF'`,
  PowerShell `@'…'@` with the closing `'@` at column 0).

### 10.3 Filesystem and network work is verified on the REAL desktop app

A `MemoryStorage` test proves nothing about the disk: fakes overwrite happily, while **Windows
refuses to rename a directory onto an existing one** — and the whole `.new` → swap → `.prev` design
depends on exactly that. Write a **`/dev/<name>` probe page** that asserts on mount and writes a
report into the data dir, then read the report back — `/dev/packs-write` is the worked example.

- The desktop app has **no address bar**, so point `src-tauri/tauri.conf.json`'s `devUrl` at
  `http://localhost:5173/dev/<probe>`, run it, then **revert the file**.
- Stopping `pnpm tauri dev` kills the cargo wrapper but **leaves `app.exe` alive**
  (`Get-Process app | Stop-Process -Force`) — otherwise windows accumulate and several probe
  instances fight over the same scratch folder and produce nonsense.
- Probe writes go in a **dot-prefixed** folder (`content/.probe-pack`) so pack discovery ignores them.
  The data dir is `<Documents>/charnik`, pointed at from
  `%APPDATA%\io.github.ferndragonborn.charnik\config.json`.
- `Storage.watch` returns its unsubscribe synchronously but **attaches asynchronously** — measure
  after a delay or you get a reassuring zero.
- **A permission is not a feature.** Granting `fs:allow-watch` does not make `watch` exist:
  `tauri-plugin-fs` registers it behind the `watch` **Cargo feature**, and without it the call fails
  as an unhandled promise rejection nobody sees — correct, wired TS can sit there doing nothing on
  every build. When a Tauri API does nothing, check the Cargo feature BEFORE the permission and before
  the TS.

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

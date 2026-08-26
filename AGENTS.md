# Charnik

Charnik is a character tracker for D&D 5e (2014) and 5.5e (2024). It is FOSS, runs standalone as a
Tauri desktop app with a free web demo beside it, and keeps every rule the game needs as plain CSV
the user owns and can edit in any table processor.

It is a full tracking system, not a generator: build and level up a character, play them (HP, slots,
resources, conditions, concentration, rests), and browse a compendium over everything loaded.

## What Charnik must never stop being

Five things the product is. A change that erodes one of them is wrong even when it is convenient.

**The data belongs to the user.** Content is CSV in folders they can open, edit, and share. There is
no database, no account, no server — the desktop app talks to the filesystem and nothing else. A user
who deletes Charnik keeps their characters.

**Every number can explain itself.** The rules core returns a value plus the trace that produced it —
each `{source, op, amount}` contribution and every rule note or block. Never a bare number. The UI
can explain any stat on hover because the core hands it the reasoning.

**Mechanics are data, never code.** Auto-calculation flows through one stacking pipeline fed by a
bounded effect vocabulary. Effects are interpreted, never evaluated: there is no `eval`, no DSL that
executes, no code in a CSV cell. An unknown effect degrades to text plus a manual modifier and is
surfaced — never silently dropped.

**Two editions, one engine.** 5e and 5.5e share a core with per-system overrides, switchable live. A
character is bound to the edition it was built in and always renders in it; the global switch only
sets the browsing context. Converting a character between editions is out of scope.

**Everything is doable from the UI.** Adding content, enabling sources, resolving collisions,
switching language, system, or theme — all in-app, all live, no restart, no file editing required.
Editing the files directly still works and is picked up in real time.

## How we think about it

Prefer the smallest model that makes the correct behavior unsurprising. Do not preserve complexity
because it is already there, and do not add machinery because it looks architecturally serious.

The rules are RAW by default and RAI where RAW is ambiguous, self-contradictory, or an obvious
artifact of a huge ruleset — but say which one you followed, and where the two diverge as a real table
choice, offer both instead of picking. Charnik is a tool, not an enforcer.

A proven library beats hand-rolled code. Do not ration dependencies and never argue from dep count.

Treat what follows as good defaults rather than law. If a rule here fights the task in front of you,
say so out loud and get a human sign-off instead of quietly breaking it.

## A small glossary

- **you** — the agent reading this file and changing Charnik.
- **we, us, the maintainers** — whoever is building Charnik and directing your work. That is who you
  are talking to. Everything here is written for the role, not for a particular person.
- **the user** — a person playing D&D with Charnik. Not a maintainer.
- **article** — one content row as the compendium presents it (a spell, an item, a species).
- **source** — the book or pack a row claims (`SRD 5.1`), kept exact for attribution and shown to
  users as a friendly label (`D&D 5e`).
- **`source:id`** — a row's effective identity, so the same `id` from two sources coexists.
- **pack** — one folder under `content/`, discovered by scanning, describing itself in-band.
- **token** — a raw effect **string**. It becomes an **effect** (`ParsedEffect`) once `parseToken`
  turns it into an object. String-form names say token; object-form names say effect.
- **system** — `5e` or `5.5e`. Also called an edition when talking about content.
- **build vs play** — a character's definition versus its runtime state. The schema keeps them apart.
- **trace** — the provenance a computed value carries.

## The ways to hurt yourself

**Inventing game data.** Never author a spell, item, stat, cost, or mechanic from memory. Game data
comes from a real CC-BY SRD source through the converters in `tools/srd/`, which assert row counts
against it. Schema tests validate shape, not truth, so a hallucinated damage die passes every gate you
have and poisons the app. Need a dataset? Fetch it.

**Pushing.** Commit whenever you have a meaningful, verified checkpoint — straight to `main`, this
project does not use feature branches. Pushing is the one git action that needs explicit permission
in the current turn, and a single "push" authorizes that turn only.

**Skipping a re-stamp.** After hand-editing a content CSV, run `pnpm restamp <file>`. The
`#content-hash` is not decoration: a file whose body no longer matches its stamp is treated as the
user's own, so seeding and every pack update skip it forever. A missed stamp freezes that file on disk.

**Re-running a converter to re-stamp.** It regenerates rows and drops `conditions_srd.csv`'s
`max_level`. Converters are for real content changes; `pnpm restamp` is for hand-edits. If a converter
run touches a file you did not mean to change, `git checkout` it — in the content repo, which is where
all of this shows up as a diff.

**Hardcoding a colour or a size.** Charnik ships user-authored themes, so a literal hex or px is a
spot that stays wrong under someone's theme. Style only through the tokens in `styles/tokens.css`; a
genuinely new shade is a semantic token added to both theme blocks. Stylelint guards the colour half
only — sizes are on you.

## Hit every surface

The most common defect here is a change that works on the path you tested and is missing everywhere
else. Before calling something done, walk this list and say which entries applied.

- **Systems.** 5e and 5.5e. Rules tests are parameterized over both, and the known divergences (ASI
  source, weapon mastery, encumbrance, over-capacity) are asserted, not assumed.
- **Platforms.** Desktop (Tauri) and the web demo differ *only* at the `Storage` seam. Nothing above
  that interface may import Tauri; on web there is no file watching and no folder picker.
- **Locales.** UI strings come from runtime catalogs; content carries `name_<code>`/`text_<code>`
  columns with English fallback. Never hardcode the locale list — discover it. Support RTL via `dir`.
- **Themes.** Dark, light, and whatever a user wrote. See above.
- **The effects module.** It is optional and removable. Core computes base stats with no dependency on
  it, and the `{value, trace, notes}` contract is identical whether effects are on, off, or the module
  is deleted. Core tests must not import it.
- **Both editions of a row.** An article that exists in both gets an edition toggle in the view and in
  search; they are two rows grouped by base slug.
- **Reverse states.** If you added a way in, add the way out and the way to see it. A one-way door is
  a bug.

## The content lives in another repo

The shipped SRD content is its own repository, `charnik-content-srd`, so rules data can be corrected
and released without shipping an app build. Clone the two as siblings and everything resolves with no
configuration:

```
some-folder/
├─ charnik/               ← this repo (the app)
└─ charnik-content-srd/   ← the content (srd-2014/ + srd-2024/)
```

Another location goes in `charnik.dev.json` (gitignored) or `$CHARNIK_CONTENT`.
**`tools/content-repo.mjs` is the one seam that knows where the content is** — the vendoring step, the
converters, and the content tests all resolve through it. Never hardcode a content path; add it there.
Missing content fails loudly at `pnpm dev` and `pnpm build`, so no build ships with no rules in it.

Content edits are commits in the content repo. App code is commits here. A build vendors content into
`static/content/`, which is what makes a release carry it as a floor.

## Where code lives

- `src/lib/rules` — the pure core. Every piece of D&D math, framework-agnostic, node-testable, with a
  small shared base and per-system overrides. No Svelte, no effects import.
- `src/lib/effects` — the removable module: `token-parser.ts` and `apply.ts` (the bounded vocabulary),
  `expression-parser.ts` and `expression-evaluator.ts` (value expressions), `dependency-graph.ts` (the
  one resolve stage), `plugin-*.ts` (the sandbox). It joins the core at exactly one seam,
  `applyEffects`.
- `src/lib/content` — loading, merging, validating, hashing, and writing CSV.
- `src/lib/storage` — the `Storage` interface. Tauri fs at runtime, node/in-memory in tests, IndexedDB
  on web. All file IO goes through it.
- `src/lib/components`, `src/lib/styles` — shared components and the one global stylesheet.
- `src/routes/<view>` — a view is a thin shell: a typed view-model class named after itself
  (`CombatVM` → `combat-view-model.svelte.ts`), exported as a singleton, plus pure sibling helpers.
  Components read `const x = $derived(vm.x)` and write through `vm.*`.

## Working on it

`pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm build` · `pnpm check` · `pnpm tauri dev` (needs Rust)
· `pnpm restamp <file>` · `pnpm loc` · `node tools/surface.mjs`. Full tool notes: `docs/internals/tooling.md`.

**Reuse before you write.** Before writing any code in `src/`, regenerate `docs/surface.md`
(`node tools/surface.mjs`, well under a second) and grep for the concept — a class name, a formatter,
a helper. The things most often re-created here are CSS classes and functions of every kind, not only
obvious utilities. A shared class lives in exactly one place; a shared control is one component. If
something close exists, extend it rather than forking a scoped lookalike.

**Run the whole gate before committing.** `pnpm test && pnpm lint && pnpm build`. A subset is a false
green: `pnpm check` type-checks but does not catch build and prerender failures, and `pnpm test` runs
the browser project too. Before a release, add `pnpm lint:typed` — it is CI-only because it builds the
whole TS program and takes about ten minutes, so nothing local catches its errors and they surface on
push. Start it in the background early.

## Verifying

**Render it and look.** Visual work is verified by a screenshot, never by describing it. Never punt a
CSS task as unverifiable — the harness is here and chromium is installed.

`tools/visual/shot.mjs` captures and pixel-diffs the covered states: `--update` for the baseline
before your change, a bare run to compare. The dev server is often not on 5173, so read the port and
pass `BASE`. One red run is not evidence: round-dependent chips drift on their own and a dev server
that lived through a file rename serves a stale graph — re-run before believing it. For a state the
harness does not cover, write a one-off Playwright script *inside the repo* so `playwright` resolves,
drive to the state, screenshot, look at the PNG, delete the script.

**Filesystem and network work is verified on the real desktop app.** A `MemoryStorage` test proves
nothing: fakes overwrite happily, while Windows refuses to rename a directory onto an existing one,
and designs here depend on that. Write a `/dev/<name>` probe that asserts on mount and writes a report
into the data dir, point `devUrl` at it, run the app, read the report, revert `devUrl`.

**Screenshots go in `design-preview/`.** Never the repo root, never a temp folder. That folder also
holds the iterated `*.html` design mocks: when a view has one, **bake it faithfully** and wire live
data onto it, rather than building a simplified version from scratch. When a design choice is open,
offer two or three **rendered** variants — they are picked from seeing them, not from names.

## Taste

- Comments carry **why**, not what. If a name cannot capture a function's essence, it is doing too
  much — split it, don't comment around it. A comment is not a changelog; git holds that.
- Names are verbose and self-evident, in code and in CSS. `rollDie(sides, rng)`, not `one(...)`.
  A module that exports one class is named after that class. **Markdown files are kebab-case**
  (`work-artifacts.md`, `rules-core.md`) — the only exceptions are the root files an ecosystem
  already spells for us: `README`, `CHANGELOG`, `LICENSE`, `COPYING`, `AGENTS`, `CLAUDE`.
- One name per fact everywhere. Only the case convention may differ (`is_bloodied` ↔ `isBloodied`).
- Everything is typed, and the linter bans the escape hatches — `any`, `!`, `@ts-ignore`, unsafe casts.
  If a value can be absent, model that deliberately rather than reaching for `T | undefined`.
- Compare against named constants, not bare string literals, and replace one the moment you touch it.
- Related state is one typed object, not a spray of fields. Five positional parameters means a type.
- A data column expressing a policy or kind is an open enum, never a boolean. Rules grow a third case.
- Errors are handled or surfaced, never swallowed. A deliberate best-effort swallow says why.
- `$derived` is pure; anything that acts belongs in `$effect`.
- Small local duplicates are worth extracting. They accumulate into a fifth of a codebase.
- Discover by scanning a folder; let each artefact describe itself. No manifest sidecars.
- Identify anything shareable with a GUID, not a local counter.
- Shortcuts match the physical key (`e.code`), and every internal link carries `base`.
- Imperial first, metric in parentheses. Ukrainian UI copy uses the formal «ви».
- Accessible from the start: focus order, visible focus, ARIA, keyboard-navigable lists where Enter
  equals a left click.

## Working with us

- **A question asks for information.** "Propose", "explain", "tell me", "is there anything that…" —
  all of them want the answer, not the work. Give the answer and the exact change you would make, then
  stop. Act on an instruction, not on a question.
- **Find the root cause before writing a fix.** Do not ship a plausible patch and hope.
- **A play-tracker surfaces and suggests; it never auto-applies.** Highlight the option, pre-fill a
  smart default, and let the player click. Most rules are "you *may*", and the app does not hold
  enough game state to decide correctly anyway.
- **Fix the docs in the change that proves them wrong.** Finishing, renaming, or deleting something is
  not done until the docs describing it are updated in the same commit. A plan that lies is worse
  than no plan.
- **Every line of prose carries information.** No text written to look thorough, in docs, commits, or
  comments. One reason, in one place.
- **Do not keep dead code in active development** without checking whether it is scaffolding for
  planned work — but do not keep it unmarked either.
- Interaction-heavy fixes are ours to confirm in the running app. Do not call a drag, a hover, or a
  keyboard path done because it compiles.

## The docs

`docs/README.md` is the full map. What you will reach for most:

- **`docs/plan.md`** — the authoritative spec and the only place that says what is still **open**.
  When a decision there proves wrong, fix it in the same change.
- **`docs/internals/`** — how the software works, in the present tense, one file per subsystem:
  `overview` (the seams and the path a number takes) · `rules-core` · `content` · `packs` ·
  `characters` · `ui` (the UX pattern contract lives here) · `tooling` (the repo's own tools and
  their traps) · `work-artifacts` (where planned work lives, how the plan is pruned).
- **`docs/internals/effects.md`** — the normative effects spec, with `plugins.md` and `actions.md` as
  its companions. `testing.md` and `security.md` sit beside them.
- **`docs/internals/compatibility.md`** — the chokepoints where a 5e-only assumption would block
  another game system later. Read it before touching the fold pipeline, the effect grammar, or the
  schemas.
- **`docs/surface.md`** — generated catalog of everything reusable. Never hand-edit it.

# Tooling

> For maintainers. The repo ships its own tools. Check here before hand-rolling analysis, and read
> the traps — several of them have already cost a session.

## Reuse before you write

**`node tools/surface.mjs`** (well under a second; `pnpm surface` is the same thing, slower)
regenerates **`surface.md`**, the catalog of everything reusable under `src/lib`: design tokens,
global CSS classes, shared components, stores, library functions and types. A SessionStart hook
regenerates it each session and a pre-commit hook regenerates and stages it. Never hand-edit it.

Read it, then grep for the concept before writing a class or a function. The things most often
re-created here are **CSS classes** and **functions of every kind** — not only obvious helpers, but
derivations, parsers, click handlers, rules math, formatters, and store accessors. A shared class
lives in exactly one place (`styles/components.css`); a shared control is one component.

`surface.md` also carries a **"Duplicate suspects"** section from three detectors: same-name function
or `UPPER_SNAKE` definitions in two or more files, identical parameter-normalized one-liner arrow
bodies, and identical literal arrays. It scans all of `src`, including routes and `.svelte` scripts,
so it catches semantic duplicates that jscpd and knip cannot. It is a review list, not a gate.

### Look-alikes that are separate ON PURPOSE

The detectors flag these every session, and every session runs "reuse before you write", so each one
is a standing risk of a well-meaning wrong merge. **Do not collapse them:**

- **`EFFECT_KINDS`** (`content/schemas`) versus the effect vocabulary in `effects/token-parser` —
  separate so content validation does not depend on the removable effects module. A drift test in
  `effects.test.ts` keeps them aligned; a shared import would defeat the point.
- **`formatModifier`** (`rules/dice`, pure core) versus **`signed`** (`util/format`) — same body, but
  the hot roll path in the core must not pull in `util`. The duplication is the accepted cost.
- **The CSS census's top rows are STATES, not controls.** `css-dups.mjs` counts a hover pair
  (`border-strong` + `text`) across 10 selectors and an accent-selected triple across 6, and the
  obvious reading — "compose `.chip` / `.pill-btn` / `.eyebrow` instead" — is wrong for most of them:
  `.cls`, `.choice` and `.jumpbtn` are `radius-full` at three different sizes and paddings, and the
  `.eyebrow` family carries `text-transform: uppercase` + `letter-spacing` that a weight figure or a
  timestamp must not get. Two declarations shared by two different controls is a coincidence of the
  palette, not a shared class. Merge only where the base rules are the same too — `.syschip` was, and
  is now `.chip` plus its padding.
- **`displayNamesByLocale`** and the translate name reads versus **`localizedName`** — different
  semantics. Search indexes *all* locales with no fallback; translate uses `?? ''`, where empty means
  "not translated" and specifically **not** the English fallback. Merging breaks both.
- The **`cap` / `label` LABELS maps** in `content/detail`, `homebrew`, and `grouping` — they share
  only the `titleCase` fallback, which is already factored out. The maps themselves differ.

"One thing in one place" is about shared *logic*, not incidental similarity of body.

## Visual regression

**`tools/visual/shot.mjs`** takes Playwright screenshots of key routes and states and pixel-diffs
them against a saved baseline. Use it for **every** CSS or layout change.

- `--update` captures the baseline — run it *before* your change.
- A bare run compares and exits non-zero with a per-state drift summary.
- `--filter=<substr>` runs or updates a subset.
- `BASE=http://localhost:PORT` overrides the URL. **The dev server is often not on 5173** — stale
  servers take it and Vite lands on 5174 or 5175. Read `pnpm dev`'s output, or every route "did not
  load (skipped)".

Each state gets a fresh page load, and animations, transitions, and the caret are frozen, so captures
are deterministic. Coverage includes interaction states (open menus, the command palette, a selected
compendium entry) through per-state `prep` functions with a self-validating `ready` selector — add
more by following the pattern. Baselines are machine- and font-specific, so they are gitignored and
regenerated locally. To check a change already made: stash, capture the baseline, unstash, compare.

**One red run is not evidence.** It has failed on different states and then passed twice with no code
change: round- and turn-dependent chips drift on their own, and a dev server that lived through a file
rename serves a stale HMR graph. Re-run, and restart `pnpm dev` after renaming modules, before
believing a drift report.

For a state the harness does not cover, write a one-off Playwright script **inside the repo** (e.g.
`tools/visual/_verify.mjs`) so `import { chromium } from 'playwright'` resolves `node_modules` — a
script in a temp directory throws module-not-found. Drive to the state, screenshot, look at the PNG,
delete the script. Screenshots go in `design-preview/`, which is gitignored for images.

**`tools/visual/narrow.mjs`** is the other half, because `shot.mjs` renders at 1280 and nothing in it
can see a phone breaking. It drives every route at 393px and 320px and fails on two things: a
`document.scrollWidth` wider than the viewport (which scrolls the whole page sideways and drags every
`position: fixed` overlay off-side), and any box inside `main` wider than `main` that no ancestor
scrolls on purpose. It names the deepest offender rather than every ancestor that inherited the floor.
`--locale=uk` re-runs it in Ukrainian, whose labels run wider than English and are what usually breaks
a row that English clears; `--width=` / `--height=` take one size, e.g. a landscape phone. Same `BASE`
caveat as above. Unlike `shot.mjs` it needs no baseline, so it is the cheaper one to run first.

It prints one advisory beside the failures: a **tap-target census** of controls a 24×24 finger square
does not reliably hit. It HIT-TESTS rather than reading boxes, because most of the small controls here
already carry an invisible `::before` expander — a box-size census calls those broken and sends you to
fix what is already fixed.

Also here: `tools/visual/css-dups.mjs`, `css-name-collisions.mjs`, `css-classes.mjs`, and the
class-refactor helpers `hoist-class.mjs` and `rename-class.mjs`.

## Size

**`pnpm loc`** reports lines of **code** per file, worst first (`--all` for everything, or pass a path
fragment). It counts the way eslint's `max-lines` counts — skipping blank lines and comments — and
`--verify` asserts that agreement digit for digit, so there is one number for "how big is this file".

`wc -l` is not that number. This repo comments heavily, and the file eslint calls 524 lines is 757 by
`wc`; a planning pass once picked the wrong "top 3" because of it. Reach for `pnpm loc` before
choosing what to split, when quoting a size in a report or commit message, and after a carve to say
what it bought. For a `.svelte` it counts the `<script>` blocks only.

**The machine-enforced limits**, on `**/*.ts` (which includes `.svelte.ts` view-models) and never on
`.svelte`, all **warn-only** so CI stays green — the warning is the "split by concern" signal, not a
gate, and tests are exempt:

- `max-lines` **400**, `max-lines-per-function` **80** (both skipping blanks and comments)
- `complexity` **20** — size is not tangle; 20 rather than 12 so a clean `switch (kind)` dispatch is
  not false-flagged
- `max-depth` **4** — invert with early returns, or extract
- `max-params` **4** — five positional parameters means the arguments want to be a typed object

**400 is the trigger, not the target.** Splitting a file so each half lands just under 400 is not
enough: aim for **~200 logic lines**, treat 300 as the ceiling, and read 400 as "should have split
already". A `.svelte` has **no line rule** — the guideline for a component is single responsibility,
and a line count there measures markup and CSS, the wrong thing. What to measure in a `.svelte` is
the non-comment lines inside its `<script>`; judged that way a 575-line component that is 90% markup
is fine, while a 550-line one carrying 221 lines of script is not.

## The rest of `pnpm lint`

- **`pnpm knip`** — `exports`, `types`, `enumMembers` and `duplicates` are set to `warn`, so those
  report and exit 0. Triage what they list: in active development an unused export is sometimes
  scaffolding for planned work, so read before deleting. Truly orphaned with no plan behind it goes;
  planned stays, marked (`@public` JSDoc silences the warning) with the wiring gap noted.
  > **`files` is NOT a warning — an unused FILE fails `pnpm lint`.** And the failure rarely points at
  > the file that caused it: knip compiles a `.svelte` file to find its imports, and when one trips
  > that step the whole import graph below it disappears, so **every component it pulled in is
  > reported as unused while the file itself is not**. One `$derived` holding a template literal in
  > `PanelCard.svelte` reported eight untouched combat panels. Read the list as a POINTER — the
  > culprit is whatever imports them — and bisect the file you actually edited.
- **`pnpm jscpd`** — copy-paste detection, threshold 1.8%. The config reporter is `silent`, i.e. the
  one-line verdict and nothing else, because a hook that prints two hundred lines of CSS on every
  successful commit trains you to stop reading it. The threshold still fails the commit; the reporter
  only decides what is printed. `pnpm jscpd` overrides it to `consoleFull` when you want the list.
- **`madge --circular src`** — no RUNTIME import cycles. A cycle is usually one module doing two
  jobs, a leaf's policy plus the orchestration on top of it: split the leaf out rather than
  reordering imports. `skipTypeImports` is on, because `import type` is erased and a type-only cycle
  is not a defect — without it, a subsystem that names the class it belongs to (`Pick<BuildVM, …>`
  instead of a hand-written twin of it) reads as five cycles that do not exist. Prove any change to
  this config both ways: a real value cycle must still fail, a type-only one must not.

  The `$lib` and `$app` aliases live there too; without them madge silently **skips** every aliased
  import and reports "no cycles" for a repo full of them, so check the skipped-file count if you
  touch that config. It is the one linter config still in the repo root, because madge has no
  `--config` flag and only reads `.madgerc` from the cwd. Do not try to move it again.
- **`no-restricted-imports`** gates two invariants: `@tauri-apps/*` only in `lib/storage/tauri.ts`
  and `lib/update/**`; `src/lib/rules/**` must not import effects.
- **Nested ternaries are a review call, not a rule.** One nested arm still reads as one sentence
  (`n > 0 ? '+n' : n < 0 ? '−n' : '0'`), and banning it costs more than it buys. A ladder of three or
  more arms is the problem — the reader has to walk all of it to answer "what happens when X" — and a
  lookup table, `if`/`else if`, or early returns say that plainly. There is no linter for the
  distinction: core `no-nested-ternary` bans both, and `unicorn/no-nested-ternary`, which draws the
  line at depth, demands parentheses that prettier immediately strips. Do not re-add either.

### The typed pass is scoped, not skipped

`pnpm lint:typed` runs the five type-aware rules over the whole repo. It is a pre-release and CI gate
because it takes ~11m30 — and nearly all of that is per-file work: building the TypeScript program
costs ~11 s, everything after it is linting. One changed file and eight changed files both finish in
~11 s.

So scope it. **`pnpm lint:typed:changed`** (`tools/lint-typed-changed.mjs`) runs the same config over
what `git diff` reports against HEAD plus untracked files, in ~15 s. Pass a ref
(`pnpm lint:typed:changed HEAD~2`) to take in recent commits as well.

Scoping is the whole trick and also the whole limitation: a rule only fires on a file it was handed,
and widening a return type to `Promise<T>` puts the floating promise in callers you did not edit. The
scoped pass is for while you work; the full one still runs before a release.

It is deliberately **not** on the pre-commit hook. Fifteen seconds on every commit, in a repo where a
verified checkpoint is a commit, is the tax that teaches people `--no-verify`.

### A file that belongs somewhere else MOVES

When a module — or a symbol inside one — turns out to belong in a different folder, move it as part
of the change that discovered it. A thing in the wrong place is a small, real tax: readers look in the
wrong file, and the wrong module ends up importing the right one.

The signals, loudest first: **an import cycle** (almost always one module doing two jobs — move the
leaf out); **a symbol imported from outside its home more often than from inside it**, so its home is
now a detour; **a name that only makes sense once you already know which folder you are in**.

Use `git mv`, never delete-and-recreate — blame is the record of why a line exists, and a recreated
file starts that record over. Then rewrite the imports mechanically, and **if the basename is
ambiguous across folders, the rewrite must be directory-aware**: two modules both called
`state.svelte.ts` once meant a plain string swap pointed `build/`'s imports at the combat view-model,
which was the exact ambiguity the rename existed to remove. `svelte-check` catches it, so run it
before the commit rather than after.

## Hooks

The pre-commit hook runs `eslint .` alongside prettier and jscpd. Before that it was prettier and
jscpd only, and the gap was not theoretical — three splitting commits went in green over a red
`pnpm lint`, leaving 35 unused imports behind, because nothing between the commit and pre-push ever
looked. A gate you only meet at push time is one you meet with five commits already stacked on the
break.

**Editing the `simple-git-hooks` block in `package.json` changes nothing on its own.** The command is
copied into `.git/hooks/pre-commit` at install time, and only `postinstall` re-copies it. After
touching that block, run `npx simple-git-hooks` and `tail -1 .git/hooks/pre-commit` to see what will
actually run.

## How long things take

Set a command's timeout to roughly **2× its expected duration**, never a comfortable ceiling.
Completion detection is unreliable, so a finished command often keeps the turn blocked until the
timeout expires: a 15-minute ceiling on a 15-second test run is 15 minutes someone sits through. The
generous ceiling is not insurance, it is the cost.

`pnpm test` ~21 s (node ~18 s, browser ~11 s — run one project to pay one) · `pnpm check` ~15 s ·
`eslint .` ~17 s · `pnpm build` ~12 s · a single `vitest run <file>` ~4 s ·
`pnpm lint:typed:changed` ~15 s · `shot.mjs` ~30 s for the full set · **`pnpm lint:typed` ~11m30**.
For anything genuinely long or unknown, run it in the background instead of buying a big timeout.

Only the last one is worth working around. The whole ordinary gate — test, check, build — is under a
minute, so **never reach for a narrower gate to save time that is not there**; `pnpm build` in
particular type-checks *nothing*, because vite transpiles with esbuild.

## Toolchain constraints that will bite

- **TypeScript stays on 6.x.** The 7.0 bump is on dependabot's ignore list (PR #7, closed
  2026-07-26). The root cause is not typescript-eslint being slow: **TS 7.0 ships no programmatic
  API at all** — it lands in 7.1, targeted autumn 2026 — so every tool that reads the compiler
  breaks at once. `typescript-eslint` still peers `typescript >=4.8.4 <6.1.0` as of 8.68.0 and
  crashes on `Cjs` if forced; `svelte-check` crashes on `typescript@7` too (sveltejs/language-tools#3063).
  Microsoft's answer is the `@typescript/typescript6` alias package, which keeps the old API under the
  `typescript` name — i.e. the migration buys nothing here, because nothing in this repo runs `tsc`:
  vite and vitest transpile with esbuild, and the two type gates are the tools that are blocked.
  The tsconfig is already 7.0-clean (`target: esnext`, `moduleResolution: bundler`, no `baseUrl`).
  Revisit when TS 7.1 ships its API and typescript-eslint peers it. typescript-eslint#10940 is a
  *different* ask — tsgo as a speed backend — and is explicitly not on their roadmap.
- **Do not try to make `svelte-check` faster.** A full pass is 986 files in ~15 s; there is no room
  left to win, and both accelerators cost correctness. `--tsgo` needs `@typescript/native-preview`,
  which stopped publishing on 2026-07-07, one day before 7.0 GA — a frozen pre-GA compiler under the
  gate that must not lie. `--incremental` is worse than useless here: it checks **132 of the 986
  files** and reports **three errors that the plain run does not have** (`OptionList.svelte`,
  `PickPane.svelte`), so it is a slower way to be wrong in both directions at once.
- **`svelte-check` cannot check one file, and does not need to.** The CLI has `--workspace`,
  `--tsconfig` and `--no-tsconfig`, no file filter — a type gate that skips the callers is not a type
  gate. For a tight loop use `pnpm check:watch`: one full pass, then each save re-checks in about a
  second.
- **Browser tests need a local chromium.** `*.browser.test.ts` run under the `browser` vitest project;
  a fresh machine needs `pnpm exec playwright install chromium` first — and so does an OLD machine
  after a playwright bump, because each release pins its own chromium build number and the previous
  one no longer satisfies it. It surfaces as a test FAILURE (`Executable doesn't exist at
  …chromium_headless_shell-<n>`) with 16 files silently unreported, not as a missing-browser message,
  so re-run the install before reading it as a regression. Run just them with
  `pnpm vitest run --project browser`. Under vitest-browser-svelte 3, `render()` is **async** — miss
  the `await` and you get `screen.getByRole is not a function`.
- **A type-aware lint COUNT is not a defect count.** `@typescript-eslint/no-unsafe-*` cannot see
  through a generic `.svelte` component: a fully typed `Entry<LoadedRow>[]` passed into `EntryList`
  (`generics="T"`) makes the rule call the callback parameter `any`, and a prop typed
  `onChange: (value: string) => void` gets the same treatment — while `svelte-check`, the actual type
  gate, reports zero errors on both. Of 58 findings, 19 were in tests and nearly all the rest were
  this blind spot; exactly two were real, both in plain `.ts`. Before acting on such a tally, split it
  by file kind and check a sample against `svelte-check`.
- **Two shells, two syntaxes.** This repo is worked primarily from PowerShell, and the here-string
  habit `@'…'@` leaks into commands sent to a Bash tool, where `@` is not a quote: the delimiters
  survive as literal text and land in whatever the heredoc feeds — a commit message, a file body, a
  patch. Check for a stray `@` at the start or end of anything written this way. For any multi-line
  message use **`git commit -F <file>`**; write file bodies with the Write tool rather than a shell
  heredoc; if you must inline, match the tool (Bash `<<'EOF'`, PowerShell `@'…'@` with the closing
  `'@` at column zero).

## Verifying on the real desktop app

For anything touching the real filesystem or network, a `MemoryStorage` test proves nothing: fakes
overwrite happily, while **Windows refuses to rename a directory onto an existing one** — and the
`.new` → swap → `.prev` design depends on exactly that.

Write a **`/dev/<name>` probe page** that asserts on mount and writes a report into the data dir, then
read the report. `/dev/packs-write` is the worked example.

- The desktop app has **no address bar**, so point `src-tauri/tauri.conf.json`'s `devUrl` at
  `http://localhost:5173/dev/<probe>`, run it, then **revert the file**.
- Stopping `pnpm tauri dev` kills the cargo wrapper but **leaves `app.exe` alive**. Kill it
  explicitly, or windows accumulate and several probe instances fight over the same scratch folder
  and produce nonsense.
- Probe writes go in a **dot-prefixed** folder (`content/.probe-pack`) so pack discovery ignores them.
- `Storage.watch` returns its unsubscribe synchronously but **attaches asynchronously** — measure
  after a delay or you get a reassuring zero.
- **A permission is not a feature.** Granting `fs:allow-watch` does not make `watch` exist:
  `tauri-plugin-fs` registers it behind the `watch` **Cargo feature**, and without it the call fails
  as an unhandled promise rejection nobody sees. Correct, wired TypeScript can sit there doing nothing
  on every build. When a Tauri API does nothing, check the Cargo feature before the permission and
  before the TS.

## Other tools

`tools/srd/*` are the SRD converters, `tools/build-static-content.mjs` vendors content on predev and
prebuild, `tools/restamp.ts` is `pnpm restamp`, and `tools/content-repo.mjs` resolves where the
content repo is.

**The dev server serves the VENDORED copy, not the content repo.** `predev` copies the packs into
`static/content/` once, and vite serves that — so a CSV you just edited in `charnik-content-srd` is
invisible to the running app until `node tools/build-static-content.mjs` runs again. The failure is
nasty because it is silent and asymmetric: node tests read the content repo directly and go GREEN,
while the browser shows the old numbers, so the app looks like it has a bug the tests deny. Re-vendor
before believing a screenshot of freshly-authored content — the dev server does not need restarting,
only the copy refreshing.

**A converter run rewrites its WHOLE edition, and the packs have moved on since the last one.** Each
converter re-emits every file it owns, so a run to fix one file also reverts every column the packs
grew afterwards: `conditions_srd.csv`'s `max_level`, `spells_srd.csv`'s `upcast` — that one is not
theoretical, the 2014 converter still emits the pre-`upcast` column set. The `effects` column is the
exception, preserved by id (`existingEffectsById`), and so are the `expertise_slots` grants.
So: run the converter, then `git checkout` in the CONTENT repo every file you did not mean to
change, and read the diff of the one you did before committing it. `pnpm restamp` is for a hand-edit;
a converter run is for a real content change.

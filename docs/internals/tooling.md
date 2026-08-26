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

- **`pnpm knip`** — its rules are set to `warn`, so it reports and exits 0. It is a report, not a
  gate. Do not reintroduce unused exports, and triage what it lists: in active development an unused
  export is sometimes scaffolding for planned work, so read before deleting. Truly orphaned with no
  plan behind it goes; planned stays, marked (`@public` JSDoc silences the warning) with the wiring
  gap noted.
- **`pnpm jscpd`** — copy-paste detection, threshold 1.8%. The config reporter is `silent`, i.e. the
  one-line verdict and nothing else, because a hook that prints two hundred lines of CSS on every
  successful commit trains you to stop reading it. The threshold still fails the commit; the reporter
  only decides what is printed. `pnpm jscpd` overrides it to `consoleFull` when you want the list.
- **`madge --circular src`** — no import cycles. A cycle is usually one module doing two jobs, a
  leaf's policy plus the orchestration on top of it: split the leaf out rather than reordering
  imports. The `$lib` and `$app` aliases live in `.madgerc`; without them madge silently **skips**
  every aliased import and reports "no cycles" for a repo full of them, so check the skipped-file
  count if you touch that config. It is the one linter config still in the repo root, because madge
  has no `--config` flag and only reads `.madgerc` from the cwd. Do not try to move it again.
- **`no-restricted-imports`** gates two invariants: `@tauri-apps/*` only in `lib/storage/tauri.ts`
  and `lib/update/**`; `src/lib/rules/**` must not import effects.

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

`pnpm test` ~15 s · `pnpm check` ~10 s · `eslint .` ~26 s · `pnpm build` ~10 s · a single
`vitest run <file>` ~2 s · `shot.mjs` ~30 s for the full set · **`pnpm lint:typed` ~9m30**. For
anything genuinely long or unknown, run it in the background instead of buying a big timeout.

## Toolchain constraints that will bite

- **TypeScript stays on 6.x.** The 7.0 bump is on dependabot's ignore list because
  `typescript-eslint` hard-errors "does not support TS 7.0", which breaks the whole `eslint` step —
  and so `pnpm lint` and CI — even though vitest passes. Revisit when typescript-eslint ships TS ≥ 7
  support (upstream: typescript-eslint#10940).
- **Browser tests need a local chromium.** `*.browser.test.ts` run under the `browser` vitest project;
  a fresh machine needs `pnpm exec playwright install chromium` first. Run just them with
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
  habit `@'…'@` leaks into commands sent to a Bash tool, where `@` is not a quote and mangles the
  message — most visibly in `git commit -m`. For any multi-line message use **`git commit -F <file>`**;
  if you inline it, match the tool (Bash `<<'EOF'`, PowerShell `@'…'@` with the closing `'@` at column
  zero).

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

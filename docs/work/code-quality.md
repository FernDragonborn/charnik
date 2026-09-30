# Code quality — open work

> Tracker. Repo-wide typing, lint and refactoring debt. The ORDER is [`plan.md`](../plan.md) ▸
> Implementation order.

- [x] **Friendly source labels** — `sourceLabel()` shows "D&D 5e (2014)", never the raw SRD tag;
  the `source` value itself stays exact for attribution (AGENTS.md ▸ A small glossary (source)).
## Refactoring debt — patterns that drifted from "this is TypeScript, model it"
- [x] **R1–R5 · Typing/extraction refactors.** `EditContext` for edit/level-up state; typed
  `overlay.kind`; a named action-economy slot type; effect-token parsing centralised on the bounded
  vocab; the click-to-set pip helper extracted (`pipClick`).
- [x] **R6 · Source-tag constants — MOOT, decided.** App code already uses consts (`HOMEBREW_SOURCE`,
  `SOURCE_LABELS` keys, a local `S` in demo/sheet); the raw `'SRD 5.x'` strings that remain live in the
  edition-SCOPED converters (each `.mjs` emits one edition, declared once) + per-file test `S` consts,
  where a shared TS const can't reach cleanly. Low value; leave.
- **R7 · Strict/Free as a named mode — won't-do.** `strict: boolean` is self-documenting and works.
  The "open enum, never a boolean" rule is about DATA columns, where a third case arrives from
  content; this is a runtime switch with exactly two sides. Reopen only if a third mode turns up.
Done R1–R5 as a focused pass (typos, duplication, drift). R6 moot, R7 deferred. (The R1–R7 +
CH1–CH14 call-chain and per-file audit checklists were COMPLETE 2026-07-11/14 — the done log lived
here and was removed in the 2026-07-27 plan trim; git holds the detail.)

- [x] **LINT-1 · Ban type-escape hatches.** `no-non-null-assertion` + `consistent-type-assertions`
  on, five type-aware rules on in CI, `no-unsafe-*` and `require-await` off with the measurement
  behind it. `tooling.md` ▸ the lint gate has the timings and why a type-aware count is not a defect
  count.
- [x] **NULL-1 · Audit the returned `null`.** All 64 read; most are values and stayed. Two shapes
  were not: a `null` meaning the OPPOSITE of nothing became a named state (`UNCONSTRAINED`,
  `OPEN_VOCAB`), and a `null` swallowing a REFUSAL became a reported `ApplyResult`. Both patterns
  are the thing to look for next time.

- [x] **ROLLTRAY-NAME · `dice tray` means exactly one thing again.** The Combat view-model's roll
  subsystem is `RollJournal`, reached as `combat.journal`: it holds the RECORD — the log, entry
  revision, and the dice tray a roll is built in. `DiceTray` (the live tray state) and
  `menus/DiceTray.svelte` (its overlay) keep the name, and the `dice/tray.svelte.ts` open-the-tray
  seam was never part of it.

- [x] **AUDIT-COVERAGE · closed.** Every finding of the September audit was closed with it; what
  outlived it was the COVERAGE, and that has now been split: the one surface it never ran is
  DESKTOP-PROBE below, and the reading habit it proved — one reader per subsystem, three at a time,
  each told to read `AGENTS.md` and the subsystem doc first, to REPRODUCE every finding rather than
  infer it, and to report CONFIRMED · SUSPECTED · RULED OUT · **NOT YET CHECKED** — is in
  `../internals/testing.md`'s territory rather than a tracker item. The write-up itself is
  `docs/audit-sep-09.md` in git, at the commit that removed it.

- [ ] **DESKTOP-PROBE · the desktop half of storage is reasoned, not RUN.** `AGENTS.md` ▸ Verifying
  signs filesystem work off on the real app, and this is the list that never got there: the
  data-folder move end to end, `walkTree`'s symlink skip against a real junction, the photo write,
  the backup ring under a Windows rename refusal, `deleteCharacter` against an open handle, and
  plugin discovery over the Tauri `Storage` (case-folding against `NAMESPACE_RE`, a plugin folder
  inside a watched pack). A `MemoryStorage` test proves none of it: a fake overwrites happily where
  Windows refuses to rename a directory onto an existing one, and designs here depend on that.
  **The character half is WRITTEN and waiting to be run** — `/dev/characters-write`, in the dev index
  beside `/dev/packs-write`. Open it inside `pnpm tauri dev` and read the verdict, or the report it
  leaves in the data folder: it covers the portrait write, both backup rings and the restore,
  `readCharacterFiles`, and the draft filename encoding against a real Windows name, and it says out
  loud what it cannot reach.
  **What cannot be probed at all** is the data-folder move, because `set_data_dir` refuses a path the
  native picker did not choose — only its copy, verify and rollback halves can be driven. The picker
  itself is out of reach of any driver (`../internals/testing.md`).

- [x] **LOG-COVERAGE · the paths where the app talks to something it does not control now log.**
  Four `logger.*` calls became coverage of the five paths the item named, and the shape of the fix is
  worth keeping: **three of the five are ONE call each**, because each subsystem already had a single
  chokepoint.
  - **Every `Storage` mutation and every failure** — `withWriteLog` wraps whatever
    `getUserStorage()` hands out (`storage/logged.ts`), so a write logs once at the only file-IO seam
    the app has instead of at ~40 call sites. Reads stay silent by design: a missing file is how half
    this app asks whether one exists. Paths go through `redactPath` first — a `characters/` slug is
    the character's NAME, which is the redaction rule's first casualty.
  - **Every pack REFUSAL** — inside `fail()` (`remote/pack-update-state.svelte.ts`), the one channel
    a repo that would not answer, a pack over the size ceiling, a rename onto a taken folder and a
    delete the OS refused all already landed on. The milestones that are not failures are their own
    lines: check started, update found, applied (with the written/preserved/removed counts),
    rolled back, installed, renamed, uninstalled.
  - **Plugin discovery and consent** — the scan's count, a namespace forgotten because its folder
    went, consent granted (with the code hash) and revoked with its pack, the kill switch, and every
    `loadError` the sandbox reports.
  - **Character save and restore** — a save REFUSED for schema reasons, a backup ring that has
    silently stopped being written, a save that failed validation or migration on the way in, and a
    restore naming the snapshot it is putting back.
  - **The seed** — which versions it is moving between, and how many files it preserved as the
    user's own.
  **Play-state mutation is still not logged**, and that is the decision rather than an omission: a
  rest or a spend is the character's own record.
  **What made it possible to wrap one seam** was moving `Platform`/`detectPlatform` into
  `storage/platform.ts`: `diag/logger.ts` asks which platform it is on, so the provider could not
  import the logger back without a cycle. `provider.ts` re-exports both names, so no call site moved.

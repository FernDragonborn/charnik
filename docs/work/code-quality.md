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

- [ ] **AUDIT-COVERAGE · what the September audit did not read.** Every FINDING of that audit is
  closed, so its write-up is gone from the tree; the coverage never was, and that is this item. The
  record it held — what was checked and is correct, how each finding was reproduced, and the per-area
  remainder — is `docs/audit-sep-09.md` in git, at the commit that removed it. What is left, highest
  value first:
  - [ ] **The `/dev/` probe on the real desktop app.** `AGENTS.md` ▸ Verifying signs filesystem work
        off there, and the whole desktop half of storage is read and reasoned rather than RUN: the
        data-folder move end to end, `walkTree`'s symlink skip against a real junction, the photo
        write, the backup ring under a Windows rename refusal, `deleteCharacter` against an open
        handle, and plugin discovery over the Tauri `Storage` (case-folding against `NAMESPACE_RE`, a
        plugin folder inside a watched pack). The audit skipped it because the tree was shared, not
        because it was blocked. The native folder picker stays out of reach of any driver
        (`testing.md`).

        **The character half of it is written and waiting to be run**: `/dev/characters-write`,
        listed in the dev index beside `/dev/packs-write`. Open it inside `pnpm tauri dev` and read
        the verdict, or the report it leaves in the data folder. It covers the portrait write, both
        backup rings and the restore, `readCharacterFiles`, and the draft filename encoding against a
        real Windows name — and says out loud what it cannot reach (a handle another process holds,
        the picker, a junction). What is left to WRITE is the data-folder move, which cannot complete
        under a driver: `set_data_dir` refuses a path the picker did not choose, so only the copy,
        verify and rollback halves can be probed.
  - [x] **The play loop across both editions.** The both-editions sweep covered the BUILD path — 96
        class sheets and 811 build-path derives — and not a rest, a cast or an action option.
        `play-loop.both-editions.test.ts` now drives the Combat VM over both shipped packs with ONE
        script: damage and healing, temp HP soaking first, a slot spent on a leveled spell, a long
        rest returning slots and hit points, a Hit Die spent on a short rest, the monk's pool spent
        through a shipped spend-option, and concentration started by a cast and ended by the rest.
        Clean in both editions. The one divergence it asserts BY NAME is the monk pool — `focus` in
        5.5e, `ki` in 5e — because a difference that matters is an assertion and anything else that
        differed would be a bug.
  - [x] **`tools/restamp.ts`, read.** The stamping itself is the app's own `restampText`, so there
        was nothing to find there; what the read found was around it. A file it SKIPS — no
        `#content-*` header — used to leave the exit code at 0, so a run that stamped nothing
        reported success, which is the one failure this tool exists to prevent (an unstamped file is
        one the app never refreshes again). It exits 1 now. Its header comment also still warned that
        a converter re-run drops `conditions_srd.csv`'s `max_level`, which CONDEFF fixed.
        **What reading it actually turned up is in the converters beside it**, which the earlier
        audit put out of scope: a `convert-2014.mjs` re-run silently wiped every spell's `classes`
        and `upcast`, cleared the hand-filled healing `damage`, and RENAMED two rows whose ids
        somebody had fixed by hand (`see_invisibility`, `gladiator` — the 5.1 source splits a word
        mid-name). All four are fixed at the source, so the standing "never re-run a converter"
        warning is now about churn rather than loss.
  - [x] **Named tails.** `readCharacterFiles` is driven now, on the question it exists to answer: a
        save the SCHEMA REJECTS still reports its refs to the pack-update preview, a character folder
        with no `character.json` is skipped rather than failing the read, and an app nobody has saved
        in yields nothing. `seedDemoIfFirstRun` and `recreateDemoCharacter` turned out to be driven
        already — `store.test.ts` walks the whole seed-once lifecycle — so that half of this item was
        stale. Reading `Hero.svelte` and `PanelCard.svelte` found two small things, both fixed: the
        panel head's collapse toggle carried no `aria-expanded`, so a screen reader was told nothing
        about the state the chevron shows; and the hero grid's gap was a literal `22px`, the one kind
        of hardcoded size the tokens exist to prevent (`--space-5`).
        `spendHitDie`'s `Math.max(1, roll + CON)` floor is a maintainer's call, not a
        finding — no shipped CSV carries the rest chapter, so nothing here can check the claim. The two
        the audit judged too small to number are CLOSED: the plugin status badge now yields to a row's
        own `problem`, so the duplicate-namespace loser stops being labelled "load failed" over its
        own explanation; and the manifest `url` is display-only by decision rather than by omission —
        it is read at the moment the user is deciding whether to trust the code, which is the one
        place a clickable link is the attack (`plugins.md` §2).

  **The shape that worked** is written down at the end of the audit: one reader per subsystem, three
  at a time, each told to read `AGENTS.md` and the subsystem doc first, to REPRODUCE every finding
  rather than infer it, and to report CONFIRMED · SUSPECTED · RULED OUT · **NOT YET CHECKED**. The
  fourth part is what made this item cheap to write.

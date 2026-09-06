# Code quality — open work

> Tracker. Repo-wide typing, lint and refactoring debt. The ORDER is [`plan.md`](../plan.md) ▸
> Implementation order.

- [x] **Friendly source labels** — `sourceLabel()` shows "D&D 5e (2014)", never the raw SRD tag;
  the `source` value itself stays exact for attribution (AGENTS.md ▸ A small glossary (source)).
## Refactoring debt — patterns that drifted from "this is TypeScript, model it"
- [x] **R1–R5 · Typing/extraction refactors.** `EditContext` for edit/level-up state; typed
  `overlay.kind`; a named action-economy slot type; effect-token parsing centralised on the bounded
  vocab; the click-to-set pip helper extracted (`pipClick`).
- [~] **R6 · Source-tag constants** — mostly MOOT. App code already uses consts (`HOMEBREW_SOURCE`,
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

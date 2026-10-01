# Code quality — open work

> Tracker. Repo-wide typing, lint and refactoring debt. The ORDER is [`plan.md`](../plan.md) ▸
> Implementation order.

The lint gate and what it measures are `../internals/tooling.md`; how a subsystem is audited is
`../internals/testing.md` ▸ Auditing a subsystem by reading.

Nothing is open.

**Won't-do, recorded so they are not re-audited as debt:**

- **Source-tag constants.** App code already compares against consts (`HOMEBREW_SOURCE`,
  `SOURCE_LABELS` keys). The raw `'SRD 5.x'` strings that remain are per-file test constants, where a
  shared TS const cannot reach cleanly.
- **Strict/Free as a named mode.** `strict: boolean` is self-documenting and works. The "open enum,
  never a boolean" rule is about DATA columns, where a third case arrives from content; this is a
  runtime switch with exactly two sides. Reopen only if a third mode turns up.

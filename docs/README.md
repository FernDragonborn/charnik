# Charnik docs

Agent and contributor rules live in [AGENTS.md](../AGENTS.md) at the repo root. `CLAUDE.md` is a
pointer at it, not a second set of rules.

## What is still open

- [The plan](plan.md) — the authoritative spec and the only place that says what is open. There are
  no side ledgers: open work lives here, the reasoning behind it lives in the subsystem's own doc
  below.
- [Changelog](changelog.md)

## How it works — and which file rules on what

Open the one whose subject you are about to touch, before the recommendation and before the code
(`AGENTS.md` ▸ The docs).

- [Architecture overview](internals/overview.md) — the seams, the path a number takes, `Storage`
- [Rules core](internals/rules-core.md) — the pure engine, RAW vs RAI, per-system divergence
- [Content](internals/content.md) — a CSV column, a row's identity, hashes, where data may come from
- [Content packs](internals/packs.md) — fetching, diffing, applying, rolling back
- [Characters](internals/characters.md) — the save format, build/play/ui, drafts, what a rest touches
- [UI](internals/ui.md) — the thin shell, tokens and theming, the UX pattern contract, the builder
  and the picker contract, i18n keys, icons, error copy
- [Effects](internals/effects.md) — the token vocabulary, expressions, the derive pipeline; with
  [plugins](internals/plugins.md) and [actions](internals/actions.md) (play-state mutation)
- [The roller](internals/roller.md) — dice, the record a roll leaves, crits, the roller organ
- [Testing](internals/testing.md) · [Security](internals/security.md)
- [Multi-system compatibility](internals/compatibility.md) — the chokepoints a 5e-only assumption
  would block later; read before touching the fold, the effect grammar, or a schema
- [Tooling](internals/tooling.md) — the repo's own tools and their traps
- [Work artifacts](internals/work-artifacts.md) — where planned work lives and how the plan is pruned
- [Reuse surface](surface.md) — generated; never hand-edited

Design research sits in [research/](research/).

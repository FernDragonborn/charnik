# Charnik docs

Agent and contributor rules live in [AGENTS.md](../AGENTS.md) at the repo root. `CLAUDE.md` is a
pointer at it, not a second set of rules.

## What is still open

- [The plan](plan.md) — the authoritative spec and the only place that says what is open.
- Active ledgers: [N2](n2-plan.md) · [Recharge](recharge-plan.md) · [Roller](roller-plan.md)
- [Changelog](changelog.md)

## How it works

- [Architecture overview](internals/overview.md) — the shape, the seams, the path a number takes
- [Rules core](internals/rules-core.md) — the pure engine, RAW/RAI, the effects seam
- [Content](internals/content.md) — CSV model, identity, hashes, what ships
- [Content packs](internals/packs.md) — fetching, diffing, applying, rolling back
- [Characters](internals/characters.md) — the save format and its build/play/ui split
- [UI](internals/ui.md) — thin shell, theming, the UX pattern contract, icons, error copy
- [Effects](internals/effects.md) — normative spec, with [plugins](internals/plugins.md) and
  [actions](internals/actions.md)
- [Testing](internals/testing.md) · [Security](internals/security.md)
- [Multi-system compatibility](internals/compatibility.md) — where a 5e-only assumption would bite
- [Tooling](internals/tooling.md) — the repo's own tools and their traps
- [Work artifacts](internals/work-artifacts.md) — where planned work lives and how the plan is pruned
- [Reuse surface](surface.md) — generated; never hand-edited

Design research sits in [research/](research/).

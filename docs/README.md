# Charnik docs

Agent and contributor rules live in [AGENTS.md](../AGENTS.md) at the repo root. `CLAUDE.md` is a
pointer at it, not a second set of rules.

## What is still open

- [The plan](plan.md) — the product spec, and **the order the open work is done in**.
- [work/](work/) — the open items themselves, one file per subject: [roller](work/roller.md) ·
  [ui](work/ui.md) · [mechanics](work/mechanics.md) · [content](work/content.md) ·
  [authoring](work/authoring.md) · [code-quality](work/code-quality.md) ·
  [release](work/release.md). An item lives in exactly one of these; the reasoning behind it lives in
  the subsystem's own doc below. There is nowhere else open work may hide.
- [Changelog](changelog.md)

## For the people using Charnik

- [Effects — the author's guide](guide/effects.md) — how the `effects` column works, for whoever is
  writing content rather than changing the app. Plain language first, then the full vocabulary: every
  effect kind, every target, and the formula language. The normative version of the same thing is
  [internals/effects.md](internals/effects.md).

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
- [The roller](internals/roller.md) — dice, the record a roll leaves, crits, the dice tray
- [Testing](internals/testing.md) · [Security](internals/security.md)
- [Multi-system compatibility](internals/compatibility.md) — the chokepoints a 5e-only assumption
  would block later; read before touching the fold, the effect grammar, or a schema
- [Tooling](internals/tooling.md) — the repo's own tools and their traps
- [Work artifacts](internals/work-artifacts.md) — where planned work lives and how the plan is pruned
- [Reuse surface](surface.md) — generated; never hand-edited

Design research sits in [research/](research/) — including
[Wild Shape](research/wild-shape.md), the per-edition spec N2b is built from, every line quoted from
the shipped SRD text.

# Licensing overview

Charnik is licensed in **three layers** — the code, the bundled data, and user content
are governed separately.

| Layer | Covers | License | Where |
|-------|--------|---------|-------|
| **Code** | Everything except `content/` (TS, Svelte, Rust, config, docs) | **AGPL-3.0-or-later** | root `LICENSE` |
| **Bundled data** | Everything under `content/` (SRD CSVs, catalogs) | **CC-BY-4.0** | `content/LICENSE` + `content/ATTRIBUTION.md` |
| **User homebrew** | Content a user adds to their own homebrew CSVs | **owned by its author** — Charnik imposes none | per-`source` metadata |

## Third-party assets

| Asset | Source | License |
|-------|--------|---------|
| The damage-type glyphs in `src/lib/components/DamageIcon.svelte` | [Lucide](https://github.com/lucide-icons/lucide) | **ISC** |

The paths are carried inline (one component, not thirteen files); the ISC notice is
reproduced with Lucide upstream and permits redistribution with attribution.

## Code — AGPL-3.0-or-later

Free for everyone, modification allowed, but **modifications must be disclosed** —
including over a network (the Affero clause). Source files declare it machine-readably:

```
// SPDX-License-Identifier: AGPL-3.0-or-later
```

## Data — CC-BY-4.0

Bundled rules data derives from the WotC **SRD 5.1** and **SRD 5.2.1**, both CC-BY-4.0.
Reuse is free; **attribution must be kept** (`content/ATTRIBUTION.md`). Charnik ships
SRD-only — users add non-SRD material themselves.

## Homebrew — author-owned

Content a user creates stays theirs. Each `source` carries its own `license` +
`attribution` fields in the content model, so a sharer picks (CC-BY, CC0,
all-rights-reserved, …). The app never relicenses user content.

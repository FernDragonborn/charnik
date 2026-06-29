## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: none

---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: pre-code

This repo is **greenfield**. No application code, `package.json`, or tests exist yet —
only planning docs. **`docs/PLAN.md` is the authoritative spec** (index); companions:
**`docs/TESTING.md`**, **`docs/SECURITY.md`**, and `docs/FRONTEND.md` (written at
roadmap P7.5). `docs/research/existing-generators.md` records why design choices were
made (what to avoid from D&D Beyond / Aurora / Roll20, what to copy). The
`срншоти для 1го рандун правок/` folder holds reference screenshots (official UA 5.5e
sheet pages; carrying-capacity rules) — consult them for sheet field coverage and the
capacity formula.

Before implementing, read `docs/PLAN.md`. When a decision there proves wrong or
incomplete during implementation, update `docs/PLAN.md` in the same change.

## What this is

A FOSS, self-hostable / standalone (single-binary) app for **D&D 5e (2014) + 5.5e
(2024)**. Scope is a **full character TRACKING system** (not just a generator): three
roles in one UI — **build & level-up**, **play tracking** (HP, slots, resources,
conditions, concentration, rests, optional XP), and a **compendium browser** over all
loaded content. Built for non-technical users to own and edit their data as plain CSV.

## Stack (decided)

- **Tauri v2 desktop app** + **SvelteKit (`adapter-static` SPA, TS)** in the system
  webview. **No HTTP server** — standalone desktop (the 99% case); LAN/remote is not a
  goal. **Minimal Rust** (config + capabilities + official plugins).
- **Package manager = pnpm** (node 22 + pnpm installed; `bun` not). **Vitest** for the core.
- **File IO behind a `Storage` interface** (`read/write/list/watch` within dataDir):
  runtime impl = **Tauri fs** (`@tauri-apps/plugin-fs` + `-dialog` + `path`), sandboxed by
  Tauri **capabilities/fs-scope**; a **node/in-memory impl** backs tests. Nothing above
  the interface imports Tauri directly.
- **Toolchain for the Tauri build**: Rust (rustup) + **MSVC C++ Build Tools** (Win) +
  WebView2 (present); webkit2gtk (Linux). The **TS side runs without Rust**; Tauri wiring
  needs it.
- Planned libs (keep deps minimal): `papaparse` (CSV), `svelte-i18n` (UI i18n), `zod`
  (validation), **Tauri v2** + `plugin-fs`/`plugin-dialog`. File-watch via Tauri (no
  `chokidar`).

Expected commands once scaffolded (roadmap step 1): `pnpm dev` (Vite), `pnpm tauri dev`
(desktop; needs toolchain), `pnpm test` (single: `pnpm vitest run -t "<name>"`),
`pnpm lint`, `pnpm tauri build` (package).

## Architecture invariants (the cross-cutting rules)

These span many files and are easy to violate; preserve them.

- **Rules core is pure & framework-agnostic.** All D&D math (ability mods, proficiency,
  ASI source, passive senses, optional carrying capacity, attack/spell DCs, the
  effects/modifier stacking pipeline) lives in a pure-TS core with Vitest tests, **not**
  in Svelte components. It exposes a small shared base with **per-system (`5e` / `5.5e`)
  overrides** and is **reactive to the active system** (live switch, no reload).
  **3.5 is out of scope** — do not add a 3.5 engine; only the cheap `systems` data
  column and the thin system seam exist.

- **Effects/modifier engine = data, never code.** Auto-calc of derived stats flows
  through one **stacking pipeline** (`base → ability mod → proficiency → item → feature
  → condition → override`, clamped to caps) fed by a **bounded effect vocabulary** (flat
  bonus / set-override / advantage / grant-proficiency / resist-immune / apply-condition
  / grant-resource). Effects are **interpreted data, not `eval`/a DSL** (also a security
  property — see `docs/SECURITY.md`). Unknown effects fall back to **text + a manual
  modifier** (never silently dropped; surfaced in the effects panel). The whole
  effects-auto system has a **global toggle** (off → stats are manual/text only). Users
  can add **custom/temporary effects** at runtime via a "+" (catalog from an
  `effects.csv` content type + a Custom… option), each with an **optional duration in
  rounds** that a round counter auto-expires; these live in runtime/play-state. The
  engine is an **isolated, optional, removable module** (`src/lib/effects/`) composed
  onto the rules core via **one seam** (`applyEffects`); the core computes base stats
  with **no dependency** on it, and the `{value, trace, notes}` contract is identical
  whether effects are on, off, or deleted — so it can be ripped out without breaking core
  or UI. **Core tests must not import the effects module.**

- **Computed values are explainable.** Core returns **value + provenance trace**
  (each `{source, op, amount}` contribution + rule notes/blocks), never bare numbers, so
  the UI can explain any stat on **hover/tap** — including rule-based blocks (e.g. why
  spellcasting is blocked by non-proficient worn armor), not just flat bonuses.

- **Content = CSV, merged from many files/roots.** `charnik.config.json` lists content
  **root folders**; each root may hold **any number of CSVs per type**
  (`species_srd.csv`, `species_phb.csv`, …), all merged by type. Every row carries
  common columns `id`, `systems` (`5e,5.5e`), `source`, plus **L2 localization
  columns** `name_en/name_uk/text_en/text_uk/…` (all languages side-by-side in one
  file; missing → **English fallback**). Nested data uses **linked tables** (e.g.
  `class_features.csv` keyed by `class_id` + `level`), never JSON-in-a-cell except
  where unavoidable.

- **IDs are source-namespaced.** Effective identity is `source:id`, so the same `id`
  across different sources coexists. A **separate `collisions.json`** (NOT
  `charnik.config.json`) stores duplicate-group resolutions (keep-one / keep-all). An
  exact `source:id` clash within one source is a real error.

- **Source filtering is two-dimensional.** A row is active iff its **file** is enabled
  **and** its **`source` tag** is enabled; both toggles are independent and managed in
  the UI.

- **Characters = JSON, not CSV.** `characters/<slug>/character.json` (+ photo sibling by
  name, not base64; + optional append-only `log.jsonl` kept OUT of `character.json` so it
  can't bloat it). The schema **separates build/definition from runtime/play-state** and
  carries a **`schemaVersion`** (migrate old saves forward). Default save = **id
  references only**; a **bundle export** embeds referenced content rows for portability.
  Missing referenced content → render what's possible + flag it. Autosave (debounced) +
  rotating backups (no DB → atomic temp→rename).

- **Shell = Tauri; IO behind a `Storage` interface.** `dataDir` resolves via Tauri `path`
  (OS app-data by default; optional portable `data/` next to the exe). ALL file IO goes
  through the `Storage` interface — runtime: **Tauri fs**, scoped by capabilities to
  `dataDir`/roots (traversal rejected); tests: **node/in-memory**. No scattered raw `fs`,
  and **nothing above the interface imports Tauri**. No HTTP server (`docs/SECURITY.md`).

- **CSV write-back is careful.** The app writes **only files it created** (homebrew),
  never rewrites hand-edited user files; writes are **atomic** (temp→rename) and
  **UTF-8 BOM + CRLF** (Excel/Cyrillic safety). The file watcher **ignores the app's own
  writes** (no write→reload loop).

- **Everything is doable from the UI.** Users are never required to touch files: adding
  content writes rows into a homebrew CSV via forms (`papaparse.unparse`); enabling
  sources, resolving collisions, switching language/system/theme all happen in-app and
  **live (no restart)**. CSV edits made directly on disk are picked up in **real time**
  via the file watcher (reparse only the changed file; manual refresh is a fallback).

- **i18n is data-driven.** Never hardcode the locale list — discover it from available
  catalogs + content columns. Support **RTL** via `dir`. UI strings live in runtime
  JSON message catalogs (key→string, EN fallback); `svelte-i18n` chosen specifically so
  a user can drop in a new locale and switch without a rebuild.

- **Frontend is a thin shell.** Component logic stays in the pure core; components
  bind to it. Live system/locale/theme switching flows through a few reactive stores
  (`activeSystem`, `activeLocale`, `theme`); style via the **CSS design-token
  contract** (no hardcoded colors). Detailed component architecture is designed after
  the core types land (plan **P7.5**), not up front — but the store shape, token
  contract, i18n/RTL pattern, and route map are pinned at scaffold (P1).

- **Units.** Always render **metric in parentheses** next to imperial (ft→m ×0.3048,
  lb→kg ×0.4536). Carrying capacity is **optional (toggle)**; the encumbrance tiers
  (×5/×10 speed penalties) are a **5e-only** variant, off by default and not part of
  5.5e core (over-capacity in 5.5e just drops speed to 5 ft).

- **System is per character.** A built character is bound to the system it was created in
  (stored in JSON) and always renders in it; the active-system switch only sets the
  compendium/creation context. **Don't** reinterpret a 5e character as 5.5e — cross-system
  conversion is out of scope.

- **Accessibility from day 1.** Keyboard-navigable (correct Tab/Shift+Tab order, visible
  focus, ARIA roles/labels), a `Ctrl+K` command/search palette, responsive layout (used
  on phone over LAN). Don't ship inaccessible components to retrofit later.

## Testing

Tests are the verification gate; full strategy in **`docs/TESTING.md`**. Conventions:
- Logic lives in a **pure rules/content core** → fast Vitest unit tests co-located as
  `*.test.ts`; keep Svelte components thin so few component tests are needed.
- Integration tests (`tests/integration/`) use **temp content roots** (`os.tmpdir()`)
  — never touch the user's real `content/` or `characters/`.
- Parameterize rules tests per system: `describe.each(['5e','5.5e'])`; assert the known
  5e↔5.5e divergences (ASI source, weapon mastery, encumbrance, over-capacity).
- **fast-check** for invariants (mod formula over 1..30, capacity, save/load identity,
  merge row-count, locale fallback never throws).
- Golden values are **hand-derived from SRD**; **no snapshots for math** (they lock in
  bugs) — snapshots only for serialization shapes (character JSON, bundle).
- `tests/fixtures/` holds a canonical **SRD-subset** that doubles as test data and the
  shipped seed. Helpers: `makeTempContentRoot`, `buildCharacter`, `seedRng`.
- Seeded RNG for dice → deterministic. Component reactivity via Vitest browser mode.

## Content / licensing constraint

Ship **SRD-only data by default** (5e on SRD 5.1, 5.5e on SRD 5.2.1, both CC-BY-4.0).
**Do not commit non-SRD content** (e.g. PHB-only material, Beholder, Artificer,
Aasimar) — users add that themselves into homebrew CSVs. Keep CC-BY attribution with
the shipped data.

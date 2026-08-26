# Architecture

> For maintainers. What Charnik is made of and how a value travels from a CSV row to a number on the
> sheet.

## The shape

Charnik is a **Tauri v2 desktop app** wrapping a **SvelteKit SPA** (`adapter-static`, TypeScript) in
the system webview, with a free web build of the same SPA beside it. There is **no HTTP server** —
not in the desktop app, not anywhere. Standalone desktop is the case that matters; LAN and remote
access are not goals, and the absence of a server is a security property as much as a simplicity one
(`SECURITY.md`).

The Rust side stays minimal: configuration, capabilities, and the official plugins. The whole
TypeScript side runs without Rust; only the Tauri wiring needs it.

## The path a number takes

```
CSV on disk
  → Storage (Tauri fs · node/in-memory · IndexedDB + fetch)
  → content loader (parse, validate, merge by type, index by source:id)
  → rules core (pure, per-system)          → {value, trace, notes}
  → applyEffects (one seam, removable)     → {value, trace, notes}
  → view-model (typed class, one per view)
  → components (thin shell)
```

Each arrow is a seam that can be tested from the left side alone. The loader does not know about
Svelte, the core does not know about effects, and nothing above `Storage` knows about Tauri.

## Storage is the only way to touch a file

All file IO goes through the `Storage` interface — `read` / `write` / `list` / `watch`, confined to
the data directory. There is no scattered raw `fs`, and **nothing above the interface imports Tauri**
(eslint's `no-restricted-imports` pins that to `lib/storage/tauri.ts` and `lib/update/**`).

- **Desktop** — Tauri fs, scoped by capabilities to the data directory and content roots, with
  traversal rejected.
- **Tests** — a node and in-memory implementation.
- **Web** — IndexedDB or OPFS, never `localStorage` (a 5 MB cap is not a storage story). Content is
  fetched as static assets, `watch` is a no-op, and there is no folder picker. Browser storage is
  evictable, so **export is the backup story**.

`dataDir` resolves through Tauri's `path`: OS app-data by default, or a portable `data/` beside the
executable.

The web build is a **Storage-seam swap and nothing else** — the SPA deploys to GitHub Pages as-is,
`PUBLIC_PLATFORM` picks the factory, and export/import uses the identical `character.json` and bundle
formats, so a character moves between desktop and web with no conversion. Pages needs `base` on every
link and a `404.html` SPA fallback.

## Where the pieces live

- **`src/lib/rules`** — the pure core. See `rules-core.md`.
- **`src/lib/effects`** — the removable effects module, joined at `applyEffects`. See `rules-core.md`
  and the normative `EFFECTS.md`.
- **`src/lib/content`** — loading, merging, validating, hashing, and writing CSV. See `content.md`;
  external packs are in `packs.md`.
- **`src/lib/character`** — the save schema and the derive pipeline. See `characters.md`.
- **`src/lib/storage`** — the interface and its three implementations.
- **`src/lib/components`, `src/lib/styles`** — shared components and the one global stylesheet.
- **`src/routes/<view>`** — a view-model class plus thin components. See `ui.md`.
- **`src-tauri`** — the Rust shell, capabilities, and plugin registration.

## Live switching

Language, active system, theme, and per-character layout all switch **live, through reactive stores,
with no reload**. A CSV edited on disk is picked up in real time by the file watcher, which reparses
only the changed file; a manual refresh is the fallback.

## Toolchain

Building the desktop app needs Rust (rustup) plus the platform's native toolchain: MSVC C++ Build
Tools and WebView2 on Windows, webkit2gtk on Linux. `pnpm` is the package manager (node 22), and
Vitest runs the core.

`package.json` is the list of dependencies; do not keep a second copy of it in prose. What it cannot
say: file-watching goes through the Tauri fs plugin's `watch` **Cargo feature**, never `chokidar` —
and granting the capability is not enough on its own, because a permission does not compile the
command in (`tooling.md`).

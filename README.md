# Charnik

A free, self-hostable, standalone **D&D 5e (2014) + 5.5e (2024)** character **tracking**
system — not just a generator. Three roles in one app: **build & level-up**, **play
tracking** (HP, slots, resources, conditions, concentration, rests, optional XP), and a
**compendium browser** over all loaded content. Built so non-technical users own and edit
their data as plain CSV.

Desktop app: **Tauri v2 + SvelteKit** (static SPA, TypeScript). No HTTP server — runs
standalone in the system webview.

> See [`docs/plan.md`](docs/plan.md) for the authoritative spec and roadmap.

## Install

Grab the latest Windows installer from the [Releases](https://github.com/FernDragonborn/charnik/releases)
page and run it. Linux and macOS builds aren't packaged yet — build from source (see below) in the meantime.

> **Prefer the `.exe` (NSIS) installer.** If Releases also list an `.msi`, pick the `*-setup.exe`
> instead — it installs per-user without admin rights and gets auto-updates. The `.msi` is a
> system-wide package that needs admin and doesn't auto-update.

The installer isn't code-signed yet, so Windows SmartScreen shows an "unknown publisher" warning:
choose **More info → Run anyway**. Once installed, Charnik **checks for updates on launch** — when a new
version is out, an **Update** button appears in the top bar; click it to update and restart.

## Develop

> ### ⚠ You need TWO repositories
>
> The SRD content is a **separate repo** — that is what lets rules data be corrected and published
> without shipping a new app build. Clone them **side by side**; that layout needs no configuration:
>
> ```sh
> git clone https://github.com/FernDragonborn/charnik.git
> git clone https://github.com/FernDragonborn/charnik-content-srd.git
> ```
>
> A different location goes in `charnik.dev.json` (`{ "contentRepo": "…" }`, gitignored) or the
> `CHARNIK_CONTENT` environment variable — **not** `charnik.config.json`, which is the app's runtime
> config in your data folder and has nothing to do with the checkout. Without the content, `pnpm dev` / `pnpm build` stop with
> the clone command rather than starting an app with no rules in it. The build **vendors** the CSVs
> into the app, so a release still ships them. Content fixes are commits in the CONTENT repo.

Requires Node 22 + pnpm. The TS side runs without Rust; the Tauri desktop build also needs
Rust + platform toolchain (MSVC C++ Build Tools + WebView2 on Windows; webkit2gtk on Linux).

```sh
pnpm install
pnpm dev          # Vite dev server (web preview)
pnpm tauri dev    # desktop app (needs Rust toolchain)
pnpm test         # Vitest
pnpm lint
pnpm tauri build  # package the desktop app (unsigned — no signing key needed)
```

`pnpm tauri build` produces a working, **unsigned** installer — no signing key required, so anyone
can build from source. Only official releases are signed (the updater's `.sig` files + `latest.json`
are added by CI via `src-tauri/tauri.release.conf.json`, which needs the private key); local unsigned
builds simply don't auto-update.

## Licensing

Charnik separates **code**, **bundled data**, and **user content** — see
[`COPYING.md`](COPYING.md) for the full picture.

- **Code → [MIT](LICENSE).** Take it, change it, ship it — just keep the copyright notice.
  (AGPL-3.0-or-later up to 0.5.0: we don't want to oblige you to make your code public, though
  sharing it back is welcome. Those releases stay available under AGPL.)
- **Bundled data → CC-BY-4.0.** Rules data derives from the WotC **SRD 5.1** and **SRD 5.2.1** and
  lives in its own repo, [charnik-content-srd](https://github.com/FernDragonborn/charnik-content-srd),
  with the licence and attribution beside it. Charnik ships **SRD-only** — add non-SRD material
  yourself into homebrew CSVs.
- **Your homebrew → yours.** Content you add stays author-owned; each `source` carries its
  own license + attribution. The app relicenses nothing.

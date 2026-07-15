# Charnik

A free, self-hostable, standalone **D&D 5e (2014) + 5.5e (2024)** character **tracking**
system — not just a generator. Three roles in one app: **build & level-up**, **play
tracking** (HP, slots, resources, conditions, concentration, rests, optional XP), and a
**compendium browser** over all loaded content. Built so non-technical users own and edit
their data as plain CSV.

Desktop app: **Tauri v2 + SvelteKit** (static SPA, TypeScript). No HTTP server — runs
standalone in the system webview.

> **Status: pre-1.0, in active development.** See [`docs/PLAN.md`](docs/PLAN.md) for the
> authoritative spec and roadmap.

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

- **Code → [AGPL-3.0-or-later](LICENSE).** Free for everyone, modification allowed, but
  changes must be disclosed (including over a network).
- **Bundled data → [CC-BY-4.0](content/LICENSE).** Rules data derives from the WotC
  **SRD 5.1** and **SRD 5.2.1**; attribution is kept in
  [`content/ATTRIBUTION.md`](content/ATTRIBUTION.md). Charnik ships **SRD-only** — add
  non-SRD material yourself into homebrew CSVs.
- **Your homebrew → yours.** Content you add stays author-owned; each `source` carries its
  own license + attribution. The app relicenses nothing.

# Release and distribution — open work

> Tracker. Packaging, distribution channels, dependencies and their advisories. The ORDER is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [x] **REL-1 · Linux release build** — `release.yml` matrix (ubuntu + windows, `max-parallel: 1`
  so the legs merge into one release). AppImage is the auto-updatable target, `.deb` a plain
  installer; rpm omitted (no `rpmbuild` on the runners), macOS deferred on notarization.
- [ ] **DISTRIBUTION-EXPANSION · ship through the platform package managers**, beyond GitHub
  Releases, so users install and update the native way. Target set:
  - **AUR** (Arch) — a `charnik-bin` PKGBUILD pulling the Release AppImage; `git push` to
    `aur.archlinux.org`, no review, cheapest channel.
  - **Flathub** (Linux) — Flatpak manifest; widest cross-distro reach, one channel for all Linux.
    Note the **sandbox**: Charnik reads/writes arbitrary content dataDirs, so wire XDG **portals** /
    `--filesystem` perms or the data-move + custom roots break.
  - **AppImage** (Linux) — built + PUBLISHED by `release.yml` (REL-1 done); the portable, zero-install,
    self-updating target. `tauri.linux.conf.json` also emits a `.deb` alongside it.
  - **WinGet** (Windows) — YAML manifest PR to `winget-pkgs`; standard Win10/11 channel.
  - **Chocolatey** (Windows) — nuspec package; broader/older Win audience.
  - **Homebrew Cask** (macOS) — **out of scope for now**: no macOS build host to compile on, so no
    artifact to ship. Revisit if a mac runner/notarization appears (blocked on same as REL-1 macOS).
  Most of these consume the Release artifacts, so they hang off REL-1 (need Linux + eventual mac
  builds published first). **Order: WinGet → AUR → Choco → Flathub** — reach per hour of work, with
  Flathub last because its cost is not the manifest but the sandbox: arbitrary dataDirs need portals
  or a broad `--filesystem`, which is exactly what reviewers push back on.
  **This is its own session, and it is blocked on ACCOUNTS, not on code.** Every manifest can be
  written and validated ahead of time; what cannot be done for the maintainer is registering on AUR
  (account + SSH key), Chocolatey (API key) and Flathub, and opening the `winget-pkgs` PR from a
  personal GitHub account. So: **remind the maintainer to create those accounts**, then do all four
  in one sitting — each is a different registry's rules, and paying that context cost four times over
  four unrelated sessions is the waste.
- [ ] **ANY-HOST-PACKAGE-DISTRIBUTION · A content pack from ANY HTTPS host, not only GitHub — POST-1.0.** Not before the
  release: it adds a network surface that has to be got right, and nothing about 1.0 needs it.
  Carved out of REL-4's audit list so that item closes clean: this was never a defect
  in the pack updater, it is a separate feature with its own security surface, and it is not
  scheduled into a wave. **Deliberately deferred, not forgotten** — REL-4 was designed so this stays
  possible: `RemoteFetcher` takes an HTTPS URL and GitHub is a HOST ADAPTER over it, the semantics
  live in the `#content-*` headers rather than in any forge's API, and file `size` is already an
  optional field precisely so an adapter that cannot state one still works. Self-hosting is a stated
  project value; coupling the model to one forge would break it for nothing.
  - **What actually blocks it is the capability, and no amount of TS solves that.** A Tauri
    capability is compiled into the binary and cannot be widened at runtime by config, by a pasted
    URL, or by a bug in the webview — which is exactly why it is the boundary (security.md §5/§7).
    So today `src-tauri/capabilities/default.json` allows `api.github.com` +
    `raw.githubusercontent.com` and nothing else, and `checkRepo` answers `unsupported` for anything
    else. Widening it wholesale would hand any pasted URL the network, which is the one thing the
    seam exists to prevent.
  - **Next rung, when it comes: a per-host user GRANT.** Paste a URL → "allow Charnik to reach
    `packs.example.org`?" → the answer is stored and the allow-list is checked **in Rust**, not in
    the webview. The static capability then widens to "any https host, subject to the grant list"
    and the grant becomes the real gate. At that point `unsupported` grows a fallback instead of
    being a dead end. Store the grants OUTSIDE the dataDir, for the same reason plugin consent is
    (PLUGINS §6.3): a restored backup must not be able to arrive pre-authorised.
  - **And the manifest-free design leaves one genuine gap to answer first.** The `#content-*` headers
    carry everything except *which files exist*. GitHub's tree API supplies that in one request; a
    plain static host can only do it if it serves an autoindex. So the general case is "any static
    host with an autoindex", the answer is still NOT a `pack.json` (docs/internals/content.md ▸ No manifests), and
    deciding what to do about a host with neither is part of this item rather than a surprise inside
    it.
  - **PACK-AUTHENTICITY · no signing.**
    Downloaded bytes are verified against the git blob SHA the tree listing published. That is
    INTEGRITY against a truncated or swapped transfer; it says nothing about the publisher, so a
    typo-squatted URL or an account takeover passes every check. That remains the posture, stated in
    security.md §7 — not an omission waiting to be closed.

    **Why signing was dropped: a pack with more than one author has nobody to sign it.** The key ends
    up in CI, where "signed" means "somebody could push to main" — which is what the blob SHA already
    says, and an account takeover carries the signing secret off with the repo. One key shared
    between maintainers is not a secret; a key per contributor makes adding a contributor a rotation
    event no user can evaluate. Signing is strongest for a lone author holding an offline key, which
    is exactly the case where the pack is small and the damage is wrong numbers in someone's rules.
    Strongest where it is least needed, weakest where it would matter.

    Meanwhile the only thing that EXECUTES is held tighter than a signature would hold it: plugin
    consent pins a SHA-256 of the exact bytes outside the dataDir, so new code stops running until
    the user says yes again (PLUGINS §6.3). The pack URL is pinned in the registry, and a changed
    `#content-source` stops the apply (REL-4 third pass).

    **Revisit if Charnik ever becomes a central distributor** — a pack index, a "verified publisher"
    badge, anything where WE vouch for someone else's content. That is the point where a signature
    stops restating repo write access, and it is a product decision (we become the gatekeeper of
    other people's homebrew) before it is a crypto one.

    **The shape, if it comes back:** in-band and per file — a `#content-sig` directive beside
    `#content-hash`, over the same normalised bytes `hashInput` already produces
    (`src/lib/content/hash.ts`); no sidecar, no manifest (§1.6). Format = minisign, because the
    updater already carries a minisign public key (`tauri.conf.json` ▸ `plugins.updater.pubkey`) and
    verification is therefore already in the binary. Sign the bytes, never the `xxh64:` digest —
    xxHash is not collision-resistant.
## Security and dependencies
- **DEP-1 · `glib 0.18.5` moderate advisory** (GHSA-wrw7-89jp-8q8g, dependabot #3) — transitive via
  Tauri's Linux webkit2gtk/wry backend; fix is `glib 0.20` (a gtk-rs major, pinned by Tauri, not a
  plain `cargo update`). Only affects a LINUX desktop build; Windows (WebView2) + the web target have
  no glib. Defer to a Tauri upgrade; safe to dismiss with that rationale meanwhile.
- [x] **SEC-2 · Every `{@html}` goes through the sanitizer** — no hand-rolled escaping; see
  `docs/internals/security.md`.
- [x] Dependabot: DONE — esbuild + cookie pinned via pnpm-workspace overrides; **re-audited 2026-08-09**
  (it had drifted to 9 findings): dompurify + @sveltejs/kit bumped, five more transitive dev-only
  packages pinned the same way → `pnpm audit` clean again. Re-check it periodically; it drifts silently.
  **Re-audited 2026-09-07** before the 0.7.0 tag: four HIGH findings, all `fast-uri` reached through
  `stylelint > table > ajv`. The existing override still read `fast-uri@<3.1.5`, so the advisory's own
  4.x range walked straight past it — a pin narrower than the next advisory is a pin that expires
  silently. Widened to `<4.1.3` and clean again.
  **Re-audited 2026-09-15** at the 0.7.0 cut: three moderate + one HIGH, all dev-only. The vitest
  family went to 4.1.11 for the `@vitest/mocker` path traversal — a DIRECT dep, so package.json, not
  an override. The other two (`colord` via stylelint, `smol-toml` via knip) needed nothing: the
  dependabot group bump carried stylelint and knip far enough that both resolved patched on their
  own. **An override is only worth adding once the upstream bump is ruled out** — a pin that restates
  what the tree already resolves is the kind that outlives its advisory and misleads the next reader.
  Pages deploy recovery still open.

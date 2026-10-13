# Release and distribution — open work

> Tracker. Packaging, distribution channels, dependencies and their advisories. The ORDER is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **DISTRIBUTION-EXPANSION · ship through the platform package managers**, beyond GitHub
  Releases, so users install and update the native way. Target set:
  - **AUR** (Arch) — a `charnik-bin` PKGBUILD pulling the Release AppImage; `git push` to
    `aur.archlinux.org`, no review, cheapest channel.
  - **Flathub** (Linux) — Flatpak manifest; widest cross-distro reach, one channel for all Linux.
    Note the **sandbox**: Charnik reads/writes arbitrary content dataDirs, so wire XDG **portals** /
    `--filesystem` perms or the data-move + custom roots break.
  - **AppImage** (Linux) — built + PUBLISHED by `release.yml` (a ubuntu + windows matrix with
    `max-parallel: 1`, so the legs merge into one release); the portable, zero-install,
    self-updating target. `tauri.linux.conf.json` also emits a `.deb` alongside it. No rpm: the
    runners have no `rpmbuild`.
  - **WinGet** (Windows) — YAML manifest PR to `winget-pkgs`; standard Win10/11 channel.
  - **Chocolatey** (Windows) — nuspec package; broader/older Win audience.
  - **Homebrew Cask** (macOS) — **out of scope for now**: no macOS build host to compile on, so no
    artifact to ship. Revisit if a mac runner/notarization appears.
  **Order: WinGet → AUR → Choco → Flathub** — reach per hour of work, with
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
    The fetch commands' own allow-list is the same kind of thing one step in
    (`src-tauri/src/remote.rs` ▸ `is_pack_host`): `api.github.com/repos/` +
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
- [ ] **TABLE-LINK-SEAM · the interface the table link will implement, and the implementation that
  does nothing.** Outcome: a `TableLink` interface beside `Storage`, with a no-op implementation that
  the web build and every build without the Cargo feature use — the web demo never joins a table, so
  the interface may assume a participant owns a character file; a test that the app boots and plays
  on the no-op. With it, **a sixth exempt path in the Tauri import fence**, and the second place
  Rust pushes events into the webview after the updater's progress. Constraints: no socket is opened and no dependency on a
  transport is added; removing the feature removes the capability file, the commands and the JS
  seam together. The ground it stands on is built: app commands are under the ACL and the log sink
  takes only the app's own lines (`internals/security.md` §2), so a table-link command arrives
  with a permission of its own.
  **What is built, and in which builds it is.** Both sides, not the TypeScript alone: a Cargo
  feature that carries the commands and their capability file, the adapter in JS that calls them
  — the sixth exempt path — and the no-op beside it. The commands do nothing, since there is no
  transport to do it with. **The feature is OFF in the release build**: 0.8.0 ships the no-op and
  no command the page could call, which is also the build that proves the module comes out
  whole. A step in CI builds it ON (`cargo check` with the feature), so the other state is
  compiled on every push rather than once a release — CI builds no Rust outside the release
  workflow today, so without the step nothing would. The page finds out which build it is in by
  CALLING: a command that is not there is the no-op's cue, so there is no second switch to keep
  true to Cargo's.
  **The small calls, taken so the build does not stop to ask.** The events Rust pushes are six:
  a participant joined, a participant left, a view arrived (to a GM), a request arrived (to a
  player), an answer arrived (to a GM), the connection's state changed. A roll that can be asked
  for is an ability check, a saving throw or a skill, by the id the roller already names it with
  — not an attack. A state or effect is asked for by its catalog id alone, and its duration is
  set on the player's side as it is today. Damage is asked for as the raw amount and its type;
  the player's app applies its own defenses, since only it knows its sheet. The feature is named
  `table-link`. There is NO user interface for a table in 0.8.0 — no button, no settings row: the
  no-op says unavailable and no entrance is drawn.
  **What verifying it takes.** Two full Rust builds, with the feature and without, and a `/dev/`
  probe run on the real desktop app, which opens the app's window on the maintainer's machine.
  The CI step needs Tauri's system libraries installed on the Linux runner before `cargo check`;
  what that adds to a run is not measured.
  **Where it is likely to cost time.** The capability file names the feature's permissions, and a
  build without the feature fails on a permission it does not know — so the file has to come and
  go with the feature, most likely from `build.rs`, and that is proven only by building both ways.
  And the path by which Rust pushes an event to the page is declared with nothing to send down it:
  a `/dev/` probe can show the channel works, and only a transport will show whether an event's
  shape is right.
  **The calls.** One service, and the calls stand on a SEAT at a table rather than on the service:
  `host(name)` answers a GM's seat and `join(invite)` a player's, so a player's seat has no way to
  ask and a GM's none to publish — the role is the type, where one flat list of calls would refuse
  the wrong one only at the table. A seat carries its table, which is what "every call takes a
  table id" comes to. Both seats `leave()` and `subscribe(listener)`; a player's `publish`es and
  `respond`s, a GM's `request`s. Every call answers delivered or not delivered — there is no
  queue. Joining is approved outside this interface, in a dialog the webview cannot press. The
  service does not list the tables an install has sat at: where a table is remembered waits on
  where its keys are.
  **What a player publishes is the whole view, and the GM sees all of a player character**: the
  character as it is saved and the sheet derived from it, traces included, inventory, spells and
  notes with the rest. `publish(character, view)` says what is true now; what crosses the wire —
  the keys that changed over a cached base — is the transport's, so cutting the view differently
  later changes no call. Measured on the demo character: the derived sheet is 29.5 KB, of which
  skills, abilities and passives are 20 KB of traces that change on a level, an item or an effect;
  the saved character is 3.2 KB and its hit points 20 bytes.
  **What a GM asks is one of four typed requests, naming catalog ids and never tokens**: take this
  damage (an amount and a type), be healed, take this state or effect, make this roll. A request
  never applies itself — it arrives, the player sees it and answers. A roll's request names what
  to roll and MAY carry its DC: the GM chooses per request whether the DC is announced, by a
  switch on their side. The roll made travels back in the answer, since a roll is an event and
  not a state of the sheet; what damage or healing left is seen in the next publish.
  **What the interface carries, as far as it is decided:** the player's app derives its own sheet
  and publishes the RESULT — values with their traces — and the GM's app renders it and derives
  nothing from a peer's tokens. Sent as changes over a cached base, never whole each time: a
  portrait goes once, an inventory when it changes, hit points when they move. The byte counts are
  measured on real characters before the shape is fixed. Identity is PER TABLE — a participant
  holds a separate key for each table, so nothing links two tables and a key that is online says
  nothing about the person outside that table — which is why every call takes a table id.
- [ ] **TABLE-LINK-SPEC · the specification, before any transport code.** Its inputs are
  `research/table-link-threats.md` (what the layer can do to a user) and
  `research/table-link-design-review.md` (what the existing code does with a network input, and the
  thirteen decisions listed under "Decisions the spec must make"). Its "What to research next" is
  answered as far as reading can take it — mobile lifecycle and the iOS local-network prompt, n0's
  wire promise, the OS key stores, pairing ceremonies, who writes a sheet in other tools — and ends
  with the list only a device or a table can settle, which the spec schedules rather than waits on.
  The decisions that change the architecture: who computes a sheet the GM looks at; that a GM
  request names catalog ids and never
  carries tokens or free formulas; a star of direct connections rather than gossip; which relays an
  endpoint may dial; where keys and approvals live. It also rewrites `internals/security.md`'s
  threat model, which says "no network" in the present tense. And it rewrites
  `internals/roller.md` ▸ "The app never knows AC or DC, so no threshold is ever shown": a roll a GM
  asks for may carry a DC the GM chose to announce, and for that roll the app does know it.
- **DEP-1 · `glib 0.18.5` moderate advisory** (GHSA-wrw7-89jp-8q8g, dependabot #3) — transitive via
  Tauri's Linux webkit2gtk/wry backend; fix is `glib 0.20` (a gtk-rs major, pinned by Tauri, not a
  plain `cargo update`). Only affects a LINUX desktop build; Windows (WebView2) + the web target have
  no glib. Defer to a Tauri upgrade; safe to dismiss with that rationale meanwhile.
- **DEP-2 · `braces <=3.0.3` high advisory** (GHSA-vfj7-8cjw-p6xm, stack exhaustion on a crafted
  pattern) — transitive under `stylelint` only (`fast-glob` / `globby` → `micromatch`), so it runs
  at lint time over patterns this repo wrote and ships in no build. The advisory names `3.0.4` as
  patched and the registry's latest is `3.0.3`, so there is nothing to pin: when `3.0.4` is
  published `pnpm update braces` moves it, `micromatch`'s range already admits it.
- **AUDIT-DRIFT · `pnpm audit` reports DEP-2 and nothing else, and it drifts silently — re-run it before every tag.** Three
  rules the re-audits keep proving:
  - **A direct dependency is bumped in `package.json`**, never overridden (`dompurify`, the vitest
    family).
  - **A transitive one is pinned in `pnpm-workspace.yaml` ▸ `overrides`, and the pin's range must
    reach the advisory's own.** An override reading `fast-uri@<3.1.5` let a 4.x advisory walk
    straight past it, and `brace-expansion@<5.0.9` did the same for three later ones — a pin narrower
    than the next advisory expires without saying so. Widen the existing line; do not add a second.
  - **An override is only worth adding once the upstream bump is ruled out** — a pin that restates
    what the tree already resolves outlives its advisory and misleads the next reader.
  - **A transitive one whose parent's range already admits the patched version is a stale lockfile**,
    not a missing pin: `pnpm update <name>` moves it (`devalue`, under `svelte` and `@sveltejs/kit`),
    and nothing is written to `overrides`.

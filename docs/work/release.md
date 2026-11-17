# Release and distribution — open work

> Tracker. Packaging, distribution channels, dependencies and their advisories. The ORDER is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **WINDOWS-SIGNING · the installer is not Authenticode-signed, so SmartScreen warns — SignPath
  is the maintainer's choice.** Release builds carry the updater's minisign signature only; Windows
  shows "Windows protected your PC" and, unsigned, resets reputation with every release. For an app
  nobody knows that screen is a drop-off point (`../research/adoption-friction.md` ▸ Where we lose ▸ 1).
  **SignPath Foundation's conditions** (<https://signpath.org/terms.html>, read 2026-10-22): an
  OSI-approved licence for every component, no proprietary component, actively maintained and already
  released; the functionality described on the download page; a **"Code signing policy"** on the home
  and release pages naming the team's roles (authors, reviewers, approvers) and crediting "Free code
  signing provided by SignPath.io, certificate by SignPath Foundation"; a privacy statement (README ▸
  Privacy now carries one); **MFA for every team member** on SignPath and GitHub; binaries built from
  source in CI, **each release approved by hand**; product name and version fixed in the metadata;
  data sent elsewhere described, and — on the strictest reading — an installation option to disable
  it, which the pack check has (Settings ▸ Content updates) and the app's own launch update check
  does not yet. The certificate is issued to SignPath Foundation, which becomes the publisher shown.
  **The risk:** "for executables, we require a certain verifiable reputation … We cannot sign binaries
  based on source code that nobody knows", and a project was turned down in October 2026 for lacking
  public visibility, with reapplication welcome later. Charnik is in that position today, so apply —
  a refusal costs nothing — and expect to reapply once the project is talked about.
  **What is the maintainer's:** the application at signpath.org, MFA on the GitHub account, the
  SignPath organisation and its API token as `release`-environment secrets. **What can be prepared
  ahead:** the "Code signing policy" section (written only once accepted, since its credit line would
  otherwise be untrue), a toggle for the launch update check, and a `release.yml` step that submits the
  NSIS installer through `signpath/github-action-submit-signing-request` only when the secrets exist —
  checking first that Tauri's bundler is not asked to sign the same file.
  **Fallback** if SignPath declines: an OV certificate ($150–300 a year; since 2024 no faster
  reputation from EV, by Microsoft's own page). Azure Artifact Signing (about $10 a month) is ruled out: it takes an
  individual only in the US or Canada and an organisation only in a listed dozen countries (the US,
  Canada, the EU, the UK and a few more), and the maintainer meets neither condition (2026-10-22).
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
  **Not before the 1.0.0 pre-release** — the maintainer's call: no channel is opened, and no manifest
  written ahead, while the version is below 1.0.0.
  **Then it is its own session, and it is blocked on ACCOUNTS, not on code.** Every manifest can be
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
- [ ] **TABLE-LINK-MVP · the smallest table worth sitting at — 0.9.0.** The maintainer's goal for
  0.9.0 is people playing levels 1–4 together, each on their own app. The specification is
  `../internals/table-link.md`. Built: the transport (iroh, a star, a key per table, relays by the
  GM's setting), the invitation and the door, the three native questions, the wire with its
  ceilings, the bounded schemas the page holds a peer to, and the `TableLink` seam over them.
  Built too: `TableVM` and the Table screen over it (`routes/table/`) for both seats, the request
  prompt the layout raises over every screen, and Settings ▸ Table — all of it shown only where
  the build has a table link. Driven: the transport inside a test, every state of the screen over
  hand-made state (`/dev/table`), the commands on the real build (`/dev/table-link`), and a live
  table on the real desktop build with a person answering the two native questions
  (`../internals/table-link.md` ▸ Driving a live table) — a seat, a sheet, a page that loads again,
  a roll asked and answered, a hit declined, the door, the close. A requested roll is built in the
  dice tray too, driven over `/dev/table?…&tray`.
  **Left:** the live drive again with a roll built in the tray, which needs the person answering
  the native questions.
- [ ] **TABLE-LINK-FIELD · the table on two real networks, then on in a release.** Everything so
  far is driven on one machine with no relay. Before the `table-link` Cargo feature is turned on
  for a release build: a session through n0's relays between two networks and one with no relay
  on one LAN; how often a path stays on the relay and what a session's traffic comes to against
  n0's unpublished limits; a relay that drops mid-session and the redials after it; **ten real
  minutes without a network**, once at a player's end and once at the GM's, each ending with the
  table whole again and nobody asked anything — a power cut is an ordinary evening for part of
  the people this is for, and what a path does after ten minutes of silence (a NAT mapping gone,
  an address changed, a phone's hotspot in place of the router) is iroh's and the network's to
  show, not a timer's; two Charnik versions at one table; `cargo audit` over the crates the
  feature adds. The release workflow
  then builds with the feature, `../internals/overview.md` and `security.md` stop saying it is in
  no release, and the changelog of that release is where the table is first named: until then no
  release has it, so no changelog mentions it.
- [~] **TABLE-LINK-LOG · a roll log the table shares.** Every other tool's floor
  (`../research/table-features-elsewhere.md`) and not in the first table: players' rolls on the
  GM's screen as one stream, GM-only rolls, and moderation from day one. A star gives a player
  nobody but the GM to hear from, so another player's roll reaches them through the GM's app.
  **Designed in one pass with TABLE-LINK-REMEMBER**, on one model, the maintainer's rule being
  that no app is the master of the table's state — a GM's lags and restarts like anyone's:
  every record has ONE author (a player their sheet and rolls, the GM their asks), the author's
  app is the truth for it and says it again on reconnecting, every app that saw a record keeps a
  copy, and a record is signed with its author's table key so a copy handed back by anyone is
  either the author's words or refused. Nothing is agreed on, because no two apps write one
  record; the log is the union, shown in the order of its times. Specified in
  `../internals/table-link.md` ▸ The table's log, with the maintainer's leave to decide and build
  overnight; **these were decided without the maintainer and wait for their word**: a player's
  rolls go to the table and a GM's to nobody unless switched; the GM hides any record and a player
  their own, and nothing is deleted; the name a record is shown under is the GM's roster name,
  outside the signature; 500 records a table, ten an author in ten seconds, 2 KiB a record; asks
  and answers become records with TABLE-LINK-REMEMBER, not before.
  **Built:** signed records and the `have` exchange (`table_link/records.rs`, `session.rs`, held
  by its tests), the page's log and its panel on both seats (`routes/table/table-log.svelte.ts`,
  `TableLogPanel`), protocol 2. **Left:** the live drive on the real app, which now covers the log
  (`../internals/table-link.md` ▸ Driving a live table) and needs the person answering the native
  questions.
- [~] **TABLE-LINK-REMEMBER · a table that is there next week — and after the app went down.**
  Specified and built to `../internals/table-link.md` ▸ Remembering a table: the key in the OS
  store, the rest where only Rust writes, the list with Return and Forget, the native question
  before any socket, the door shut on a table opened again. Held by `session.rs`'s test of a GM
  that goes down and opens again, `remember.rs`'s tests (the Windows credential store among
  them), and the page's tests. **Decided without the maintainer, for their word:** leaving forgets
  the table; a table opened again keeps its door shut. **Left:** the GM's log of asks as records,
  rebuilt from the players' copies; a store on Linux (Secret Service) and macOS; a no-relay table
  at its old address (it comes back at a new one); and the drive on the real app — quit it while
  seated, start it, Return — which needs the person answering the question.
- **TABLE-LINK-HUB · the table's hub is somebody other than the GM, and can move.** Asked for a
  GM on a poor connection. Today it would move nothing that matters: every frame on the wire has
  the GM at one end — a sheet goes to the GM, an ask comes from the GM — so the GM's link is in
  the path whoever holds the connections, and what a poor link needs is the redial it has. It
  starts to pay with TABLE-LINK-LOG, the first traffic between players. It stands on that item's
  signed records: an ask that arrives through a hub is the GM's because the GM signed it, where
  today it is the GM's because it came down the GM's connection (threats ▸ the forwarded
  request). With that, a hub is a forwarder any app at the table can be, letting people in stays
  the GM's, and moving it is a signed notice of the new hub's key that every seat redials.
- **TABLE-LINK-MECHANICS · what a table turns from text into mechanics.** Found by re-reading
  every class feature the app keeps as text because it sees no ally, no target, no GM roll and no
  scene:
  - *Allies:* spells and effects cast on another character (Bless, healing, Lay on Hands, Preserve
    Life, Song of Rest), a Bardic Inspiration die given, the auras (Protection, Courage, Devotion,
    Aura Expansion, Countercharm) applied while "in the aura".
  - *The GM's rolls:* Cutting Words off a monster's roll; every `attacked` fact (Elusive, Cloak of
    Displacement) on the GM's attack.
  - *Incoming damage:* it arrives raw and the player's app applies its defenses, so Uncanny Dodge
    and Evasion are prompts at that moment.
  - *Targets:* conditions laid on a monster (Stunning Strike, Open Hand Technique, Turn Undead,
    Abjure Foes, the Vex/Sap/Slow/Push masteries), a target's type (Divine Smite against undead,
    Favored Enemy), a marked creature (Hunter's Mark, Precise Hunter, Studied Attacks, Quivering
    Palm).
  - *The scene:* a GM's "dim light" or "difficult terrain" as a table fact a guard can read (One
    with Shadows, Boon of the Night Spirit, Land's Stride, Natural Explorer).
  Still text with a table: languages as flavour, Timeless Body, the lore paragraphs.
  Beside them, what other tools give a table and this one does not yet: initiative entered by the
  player and broadcast (D&D Beyond since June 2026), and a GM's manual entry for a player without
  Charnik (`../research/adoption-friction.md`).
- **TABLE-LINK-PHONE · a player joins from a phone or a tablet.** After the engine carries the
  SRD through level 20 (`../plan.md` ▸ Levels 11–20). What reading could settle is in the design
  review ▸ 7 and 11: iroh on Android and iOS, the iOS local-network prompt, backgrounding, key
  storage. What only a device can: `keyring` inside a Tauri mobile build, a restore onto a second
  phone, App Review's answer to an endpoint that accepts connections.
  **Android ships through Google Play and F-Droid** — the maintainer's call. A bare APK is not a
  channel: Google's developer verification covers apps installed outside Play too (enforced in
  Brazil, Indonesia, Singapore and Thailand since 2026-09-30, everywhere from 2027), and an
  unverified app then installs only through the "advanced flow" — developer mode, a restart, a
  day's wait. To research before building: F-Droid's inclusion rules for a Tauri app (it builds
  from source, so Rust, Node and the NDK on its build server; IzzyOnDroid as the repository that
  takes a built APK meanwhile), Play's terms for a new personal account (the closed test before
  production, the verification, the fee), and what replaces the Tauri updater on Android, which
  is desktop-only. A Windows tablet already runs the desktop build. **iOS and iPadOS need a Mac to
  build on**, which the maintainer does not have — until one exists the iPad's way in is the web
  demo (TABLE-LINK-WEB).
- **TABLE-LINK-WEB · the web demo sits at a table.** The maintainer's call (design review ▸
  decision 10). Research first, autonomously, then a spec in `../internals/table-link.md`. What is
  already read:
  - **iroh in a browser is relay-only** (<https://docs.iroh.computer/deployment/wasm-browser-support>):
    no UDP from the sandbox, so no direct path and no hole punching; the relay carries everything,
    end-to-end encrypted, over a WebSocket. So a browser cannot join a table whose relay setting is
    *none*, and a browser at the table needs the internet for as long as it sits there. The
    invitation and the join screen must say both before anything dials.
  - **iroh builds for `wasm_browser` with wasm-bindgen**, is not published to npm, and n0 says to
    write an app-specific wrapper crate. `iroh-gossip` builds there from 0.33; the table uses no
    gossip. So the question is whether `table_link/wire.rs` and the player half of `session.rs`
    compile to wasm without Tauri and tokio's `rt` — and `mod.rs` and `question.rs`, which hold
    the Tauri commands and the question window, are the part that cannot come.
  - **On the web the questions are the page's own prompt** — the maintainer's call. What that
    gives up is said once, in the spec: script that reaches the page — prose that escapes
    sanitising and the CSP both — can press a prompt the page draws, where on the desktop it cannot
    reach the question window (`../internals/table-link.md` ▸ Going online is a question the page
    cannot answer). The threat catalog (`../research/table-link-threats.md`) is re-read for the
    web seat with that in mind.
  - **A web player first**; a web GM is read and specified beside it, since the page's prompt
    removes what kept the GM on the desktop.
  - **The web build's CSP has no `script-src`** — `kit.csp` in `vite.config.ts` sets images,
    forms, `base` and objects only — where the desktop's (`tauri.conf.json`) refuses inline
    script. On the web, prose that escapes DOMPurify runs, so a prompt in the page stands on one
    layer instead of two. A `script-src` there is the first step of this item, before any table
    code: it is a `<meta>` the desktop webview enforces too, on top of Tauri's, so it carries
    `'wasm-unsafe-eval'` for the plugin sandbox and SvelteKit's hashes for its own bootstrap, and
    is driven on the real desktop app before it lands.
  - **A backgrounded tab is a seat that drops.** Chrome freezes CPU-heavy background tabs under
    Energy Saver (from 133; <https://developer.chrome.com/blog/freezing-on-energy-saver>), throttles
    timers in long-hidden tabs, and discards tabs under memory pressure, which ends a WebSocket
    without a close; a WebSocket dropped after about five minutes hidden is reported and not settled
    (XWIKI-23928). Safari on iPadOS was not read. The seat already dials again for as long as it is
    held, so a drop costs a reconnect, not a seat — but a browser seat should expect it, say it,
    and answer a request that waited. To drive on a device.
  - **The key in a browser** has no OS store: it is the origin's, in IndexedDB, readable by any
    script that runs in the page, and evictable (DEMO-FULL ▸ storage). iroh needs the raw Ed25519
    bytes, so a non-extractable WebCrypto key does not fit. A web seat is therefore one session by
    default, and remembering it is the person's choice, said with what it costs.
  - **A web GM** depends on whether a browser endpoint can accept connections through its relay; n0's
    browser examples include an echo server, which suggests it can (to confirm in code). A web player
    comes first either way.
- **DEMO-FULL · the web demo saves, installs and fetches packs.** The maintainer's call
  (`../plan.md` ▸ The web demo carries everything a browser allows). Today the hosted demo is
  read-only by a build flag (`config/demo.ts` ▸ `isReadOnlyContent`), not by a limit of the
  browser: IndexedDB already holds the web build's writes. What it takes:
  - **Saving on.** The flag stops blocking the hosted build; what it still guards is re-read.
  - **Storage that stays.** Browser storage is evictable (`../internals/overview.md` ▸ Web), and
    nothing calls `navigator.storage.persist()`. Chrome grants it to an installed app among
    others, Firefox asks the person, and Safari wipes a site's script-written storage after seven
    days without a visit unless it is a Home Screen web app — to confirm against each browser's
    current docs. A pack can be fetched again; a character cannot, so the demo asks for
    persistence, shows whether it got it, and keeps export in sight while it did not.
  - **Installable.** A manifest and a service worker for an offline shell; the FAVICON mark is
    its icon.
  - **Packs.** Fetching goes through Rust on the desktop (`content/remote/` ▸ `tauriFetcher`); the
    web needs a fetcher over `fetch`, which stands on the host's CORS headers — to check for
    GitHub's raw and API hosts.
- **DEP-1 · `glib 0.18.5` moderate advisory** (GHSA-wrw7-89jp-8q8g, dependabot #3) — transitive via
  Tauri's Linux webkit2gtk/wry backend; fix is `glib 0.20` (a gtk-rs major, pinned by Tauri, not a
  plain `cargo update`). Only affects a LINUX desktop build; Windows (WebView2) + the web target have
  no glib. Defer to a Tauri upgrade; safe to dismiss with that rationale meanwhile.
- **DEP-3 · `zip 4.6.1`, four advisories** (RUSTSEC-2026-0367/0368/0369/0429) — transitive via
  `tauri-plugin-updater` 2.14; the fix is `zip 9`, outside that updater's dependency range. The first
  three concern Unix permission bits and symlink extraction; the fourth can abort extraction on an
  oversized symlink entry. The updater's ZIP extraction is Windows-only and follows minisign
  verification, so an untrusted archive cannot reach it. Moves with the updater's dependency bump.
- **DEP-4 · SvelteKit 2 has four advisories fixed only in 3.x.** Two low (GHSA-pfhg-q3qv-9q6r,
  GHSA-27mw-82g8-phjj, fixed in 3.0.0) concern enhanced form redirects and an untrusted
  cache-control header at prerender time; a high and a moderate (GHSA-3r8g-jcqq-3p5j,
  GHSA-6cf5-gc4q-fm3x, fixed in 3.1.1) concern remote functions' `form` and `query.batch`. Charnik
  uses no enhanced forms, no remote functions and no untrusted prerender response; the shipped app
  is static. Move with the SvelteKit 3 migration, not a hotfix. The advisories with a 2.x patch are
  taken as they land (`^2.70.4`, adapter-static `^3.0.11`).
- **DEP-6 · `minimatch 10.2.6` glob amplification** (GHSA-g3hv-75wg-m249, moderate) — build/lint
  tooling only. The patch is 11.0.1; ESLint and TypeScript ESLint still require 10.x, including their
  available updates. The patterns are repository-owned and no minimatch ships in the app. Move with
  the upstream toolchain rather than forcing a major across its dependency ranges.
- **AUDIT-DRIFT · re-run both audits before every release.** `pnpm audit` reports DEP-4 and DEP-6; `cargo audit` reports DEP-3 and the platform-specific warnings below. The standing rules:
  - **`cargo audit` is the other half**, run from `src-tauri/`: the Rust crates are not in
    `pnpm audit`, and the tool is a separate install (`cargo install cargo-audit`). Its warnings
    (unmaintained `zbus_names`/`zvariant`, `proc-macro-error`, unsound `glib`, and `tokio`'s unsound
    `AsyncFd`, a Unix-only API the table link does not call) are Linux-only crates
    Tauri pins, DEP-1's kind. A patch release that fixes an advisory is
    `cargo update -p <name>`.
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

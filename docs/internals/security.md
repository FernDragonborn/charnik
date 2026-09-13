# Charnik — Security plan

Companion to [plan.md](../plan.md). Charnik is a **standalone Tauri desktop app** (no HTTP
server). That removes the whole network attack surface; the real risks are **untrusted
content** (CSV/JSON, shared homebrew, bundle/content-pack imports) and **file-system
scope**. Security tasks are **woven across roadmap phases**, not one late step.

## Threat model & assumptions
- **No network server** → no LAN/remote/auth surface. Single local user, single app
  instance. (This is why the server-era controls — localhost bind, LAN token — are gone.)
  The **updater is an outbound HTTP *client*** (GET on the GitHub releases endpoint via
  `plugin-updater` in Rust) — not a server, and not webview `fetch`. It listens on no port
  and is governed by the **updater capability**, not the CSP.
- **Content is untrusted input** — it may come from strangers (shared packs, imports).
- **Assumption**: personal desktop use; not multi-tenant. Concurrency clobber is largely
  moot (one instance) but writes are still atomic + mtime-guarded.

## Decisions / controls
1. **No HTTP server.** Tauri loads the SPA from a bundled protocol in the webview; the
   frontend talks to the OS only through scoped Tauri commands/plugins. No open ports.
2. **Tauri capabilities / least privilege.** Grant only the plugins we need (`fs`,
   `dialog`, `path`) and **scope `fs` to `dataDir`/roots** — no broad filesystem access.
   Path traversal is blocked by the fs scope *and* validated in the `Storage` interface.
   > **Where the desktop sandbox is actually decided** (`src-tauri/src/lib.rs`). The fs scope is not
   > static: it is widened at runtime to whatever data folder the user chose, and the rule for who may
   > widen it lives in Rust, not in the capability file.
   >
   > - `pick_data_dir` opens the OS folder dialog and records the picked path in `GrantedDirs` — a
   >   session set the renderer cannot write to. Only a human click puts a path in it.
   > - `set_data_dir` persists a path to the pointer **only if it is, or is under, a path in that
   >   set**, so page JS cannot persist an arbitrary directory for a silent grant next launch. It
   >   also rejects any path containing `..`: `Path::starts_with` compares whole components and `..`
   >   is an ordinary one, so `<picked>/../../Windows` would otherwise read as a descent from the
   >   pick.
   > - `apply_saved_data_dir` re-grants the saved path at startup **with no check**, which is sound
   >   only because the pointer file is Rust-owned and `set_data_dir` is the one thing that writes it.
   >
   > The pointer lives beside the app config, not in the data folder — so a restored backup cannot
   > arrive pointing somewhere new, the same posture consent hashes take (§4).
3. **All IO via the `Storage` interface.** One audited seam; no scattered raw fs; nothing
   above it imports Tauri. The node/in-memory test impl exercises the same validation.
   > **Precisely** (checked 2026-08-12): the Tauri and memory impls call the shared
   > `sandboxRelative`; `NodeStorage` validates differently — it resolves the path and then requires
   > the result to be inside its root — so containment holds in all three, but the node one accepts
   > inputs the seam rejects (`a/../b` resolves back inside). "The same validation" means the same
   > guarantee, not the same function.
4. **Effects are data, never code.** The effects engine is a **fixed-vocabulary
   interpreter**, not `eval`/a DSL (incl. user-entered custom effects; free text is inert
   display). Malicious content can't execute — worst case it's flagged in content-health.
   Expressiveness comes in **three layers**, never by putting code in a CSV cell:
   - **L1 declarative bounded vocab** (data: `kind:target:value` tokens; the fixed `kind` set is
     `flat_bonus`/`set_override`/`advantage`/`disadvantage`/`grant_proficiency`/`damage_sensitivity`/
     `apply_condition`/`grant_resource`, per `effects/index.ts`) — ~95%. There is no `op`/`when`/
     `scope` token dimension: `op` (add/set/mult) is a pipeline-internal concept, and "when"
     (conditionality) is expressed by the L2 guard `<cond> ? <token>`, not an L1 field.
   - **L2 safe value-expressions** (`1d4`, `prof*2`, `ceil(level/2)`): OUR dice+arithmetic
     parser, non-Turing-complete, whitelisted variables, **no `eval`**, no host access.
   - **L3 plugins** (long tail): first-party/signed handlers registered on the engine seam
     are trusted/easy; **community plugins run in a QuickJS-in-WASM sandbox** —
     `quickjs-emscripten`, a narrow host API that only takes effect-context and returns
     `{value, trace, notes}` contributions, hard time/memory limits, **no DOM / no Tauri `invoke` /
     no fs / no network**. Never raw dynamic-`import`, never an unsandboxed Worker-with-bridge.
   Every layer keeps the `{value, trace, notes}` contract so contributions stay explainable.
5. **Webview hardening.** Strict Tauri **CSP** — `default-src 'self'` (webview may only load
   its own bundled resources) plus `script-src 'self' 'wasm-unsafe-eval'` and
   `style-src 'self' 'unsafe-inline'`. The `'wasm-unsafe-eval'` is **required** because the
   app instantiates WebAssembly (`xxhash-wasm` for content hashing today; the QuickJS effects
   sandbox later); it permits WASM compilation only, **not** general `eval`. Without it
   `default-src 'self'` blocks `WebAssembly.instantiate` and content fails to load. The
   style `'unsafe-inline'` is **insurance, not a confirmed need**: Svelte 5 applies dynamic
   `style="…"` via CSSOM (`style.cssText`), which CSP doesn't govern — verified working on
   WebView2 (Windows) without it — but the templates also carry static inline `style`
   attributes, and other engines (WebKitGTK on the Linux AppImage) may enforce `style-src`
   against those where Chromium doesn't. Allowing inline **styles** (not scripts) is
   low-risk — content is data, never HTML, so there's no injection path to abuse it. No remote content loading; no inline
   script; external links open in the OS browser, not the app webview. CSP governs the
   **webview's** network only; it does **not** cover the updater (see below).
   > **How, since content prose IS rendered HTML** (`ArticleProse` runs `{@html}` over
   > marked+DOMPurify, which strips anything executable and correctly keeps `<a href>`): ONE
   > capture-phase click listener in the root layout sends every cross-origin link to
   > `plugin-opener` and cancels the navigation — including one in a scheme the capability won't
   > take, which is cancelled without being opened. A per-renderer handler would be a rule with a
   > hole in it; the policy itself is a pure function (`$lib/util/links.ts`) with tests. Desktop
   > only — on the web the browser owns this. **Stated here from the start and only implemented
   > 2026-08-12**, which is why it is spelled out rather than assumed.
6. **Image upload hardening.** Allowlist types (png/jpg/webp); size cap; **re-encode**
   (strip EXIF / prevent polyglots); store only inside the character folder (in scope).
7. **Bundle / content-pack import = data only.** Parsed, **validated (zod) against the
   schema**, surfaced via collision/health UI before use; never executed, never silent
   overwrite.
   > **The gap validation cannot close is IDENTITY** (found and closed 2026-08-12; PLAN · REL-4
   > "the third pass"). A pack declares its own `#content-source`, that tag IS the namespace half of
   > `source:id`, and it is the only provenance the UI shows — so a pack stamping `SRD 5.2.1`
   > renders as "D&D 5.5e", shares the official pack's source toggle, and collides ids with it.
   > Schema validation says the row is well-formed, not that the publisher is who it says. **Closed
   > 2026-08-12** the way that implies, not with more zod: installing a pack whose tag another pack
   > already publishes under stops and asks for an explicit second click, and the PACK (a folder on
   > disk — a fact, unlike the tag) is now named in the article's attribution line and heads its
   > group in the source filter, with its own switch.

   > **BUILT (REL-4 slices 2–3): fetching content packs from a URL.** It goes through **Rust**
   > (`tauri-plugin-http`, behind the `RemoteFetcher` seam), the same shape as the updater in §1,
   > and **NOT** webview `fetch` — that would have meant relaxing §5's `connect-src`, i.e. trading
   > a shipped invariant for convenience. Fetched CSVs are data, validated before use, and
   > **applying an update is always a user action**: a pack may be downloaded automatically, never
   > applied automatically, and nothing on a timer writes to disk.
   >
   > **The host allowlist is in capabilities, and that has a consequence worth stating: a compiled
   > capability cannot be widened at runtime, so "paste any URL" and a static allowlist are
   > mutually exclusive.** v1 therefore allows exactly `api.github.com/repos/*` and
   > `raw.githubusercontent.com/*` (with `http://**` denied), which covers the shipped SRD pack and
   > any GitHub-published one. Supporting an arbitrary self-hosted URL means choosing between a
   > wildcard capability and a Rust-side dynamic check — decide it when someone actually needs it,
   > don't widen the manifest speculatively. **That decision is now its own backlog item, PLAN
   > ANY-HOST-PACKAGE-DISTRIBUTION**, scheduled for much later: the intended answer is a per-host user GRANT checked in Rust
   > (paste URL → "allow this host?" → stored outside the dataDir, so a restored backup cannot
   > arrive pre-authorised), never a wildcard on its own.
   >
   > **Authenticity is left unsolved on purpose — `work/release.md` ▸ PACK-AUTHENTICITY.** Pack signing
   > was designed and dropped: a multi-author pack has nobody to sign it, the key lands in CI where
   > "signed" restates who can push, and the one thing that executes is already pinned byte-for-byte
   > by plugin consent. Revisit only if Charnik ever becomes a central distributor.
   >
   > **Downloaded bytes are checked against the SHA they were diffed against** — the git blob SHA
   > the repo tree published, verified before a single file is written and again on anything read
   > back from the pre-download cache (`.pack-cache/<sha>`, content-addressed, so a tampered or
   > truncated entry simply fails to be its own name). This is integrity, not authenticity: it
   > proves the bytes are the ones the tree listing described, not that the publisher is honest —
   > that is what per-source licence display, the plugin consent hash, and "applying is your click"
   > are for.
   >
   > **Packs DO carry plugins**, reversing an earlier "no plugins in v1": code and the
   > data it serves ship as one unit, in `content/<pack>/plugins/<namespace>/`, because a plugin
   > with no distribution channel is a feature nobody can use. The v1 ban was guarding a hole the
   > consent model (§4, PLUGINS §6) already closes: consent is per-plugin, pinned to a SHA-256 of
   > the code AND manifest, and stored **outside** the data folder — so a plugin cannot arrive
   > pre-enabled no matter how it got onto disk, exactly as a restored "campaign backup" can't.
   > A pack update that changes plugin bytes changes the hash, which **disables** it until
   > re-consented; not even auto-download can swap code silently. The disclosure the installer owes
   > the user is BUILT: the discover step names a pack's plugins before it is installed, an update
   > distinguishes "contains plugins" from "changes their bytes", and the consent dialog names the
   > pack, since the user did not place that folder themselves.
8. **Parsing safety.** Vetted parsers (`papaparse`, `JSON.parse`); row/cell/file **size
   caps** to avoid memory blowups; malformed rows → health view, not a crash.
9. **Minimal Rust surface.** Prefer official audited plugins; keep custom Tauri commands
   few and narrow (each is native attack surface).
10. **No secrets, no telemetry.** FOSS; nothing phones home.
11. **Atomic writes** (temp→rename) + rotating backups (corruption robustness).
12. **Dependency hygiene.** Minimal deps; pin versions; periodic `npm audit` + `cargo
    audit` (Rust crates from Tauri).

## Phase hooks
- **P1**: Tauri **capabilities + fs-scope** config; the audited `Storage` interface
  (+ node/in-memory impl) with path validation; strict CSP.
- **P3/P4**: effects-as-data interpreter (no code execution); zod validation.
- **P7**: atomic writes/backups; image re-encode + scope on photo save; bundle-import
  validation.
- **P12**: content-pack export/import validation (treat imported packs as untrusted).
- **Pre-1.0**: security pass + `npm audit` / `cargo audit`; README notes.

## Non-goals (for now)
Multi-tenant accounts, permissions, encryption at rest, sandboxing beyond Tauri's model.
Revisit only if the project grows beyond personal desktop use.

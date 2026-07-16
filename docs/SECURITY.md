# Charnik — Security plan

Companion to [PLAN.md](./PLAN.md). Charnik is a **standalone Tauri desktop app** (no HTTP
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
3. **All IO via the `Storage` interface.** One audited seam; no scattered raw fs; nothing
   above it imports Tauri. The node/in-memory test impl exercises the same validation.
4. **Effects are data, never code.** The effects engine is a **fixed-vocabulary
   interpreter**, not `eval`/a DSL (incl. user-entered custom effects; free text is inert
   display). Malicious content can't execute — worst case it's flagged in content-health.
   Expressiveness comes in **three layers**, never by putting code in a CSV cell:
   - **L1 declarative bounded vocab** (data: `kind:target:value` tokens; the fixed `kind` set is
     `flat_bonus`/`set_override`/`advantage`/`disadvantage`/`grant_proficiency`/`resist_immune`/
     `apply_condition`/`grant_resource`, per `effects/index.ts`) — ~95%. There is no `op`/`when`/
     `scope` token dimension: `op` (add/set/mult) is a pipeline-internal concept, and "when"
     (conditionality) is expressed by the L2 guard `<cond> ? <token>`, not an L1 field.
   - **L2 safe value-expressions** (`1d4`, `prof*2`, `ceil(level/2)`): OUR dice+arithmetic
     parser, non-Turing-complete, whitelisted variables, **no `eval`**, no host access.
   - **L3 plugins** (long tail): first-party/signed handlers registered on the engine seam
     are trusted/easy; **community plugins run in a QuickJS-in-WASM sandbox** (DECIDED) —
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
6. **Image upload hardening.** Allowlist types (png/jpg/webp); size cap; **re-encode**
   (strip EXIF / prevent polyglots); store only inside the character folder (in scope).
7. **Bundle / content-pack import = data only.** Parsed, **validated (zod) against the
   schema**, surfaced via collision/health UI before use; never executed, never silent
   overwrite.
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

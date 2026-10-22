# Security audit — 0.8.1 (2026-10-22)

A read of the shipped 0.8.1 tree for vulnerabilities only; game-rule bugs are out of scope. The
threat model is `internals/security.md`: content and packs are untrusted, the page is the thing
being contained, and the Rust side decides what the page may reach.

Every finding below is closed, and each names the test or probe that holds the fix. This file is
kept for what it proved: how each defect was reproduced, what was checked and found correct, and
where the reading stopped.

## Findings

### S1 · `dialog:default` let page script widen the fs scope past `GrantedDirs` — medium · closed

The capability granted the dialog plugin's `open` and `save`. In `tauri-plugin-dialog` 2.8.2
(`src/commands.rs`), every folder or file picked through them goes straight into the fs plugin's
runtime scope (`allow_directory(path, options.recursive)` / `allow_file`). That bypasses
`pick_data_dir`, `GrantedDirs` and `is_grantable`. A picker that page script words itself, for
example "Choose your portrait" opening on the home folder with `recursive: true`, would hand the
page that whole folder for the session. No front-end code used the plugin; Rust draws every
dialog the app shows.

**Fix:** the permission is gone from `capabilities/default.json`. **Held by** `/dev/page-reach`,
which on the desktop app gets `dialog.open not allowed` for `open`, `save` and `message`.

### S2 · prose could request a remote image through `background` — low (CSP held) · closed

DOMPurify keeps the legacy `background` attribute by default, and Chromium still loads it as an
image on a `<table>` or `<td>`. The `PROSE_POLICY` hook covered `src`, `poster`, `href` and
`xlink:href`, so `<table background="https://evil.example/t.png">` survived sanitising. In a
Playwright drive the page requested both test URLs. `img-src` stopped the load in the app, but it
was the only thing doing so.

**Fix:** `background` is in `FORBID_ATTR`. **Held by** `markdown.browser.test.ts` ▸ loads only
what travels with the page, which fails without the fix.

### S3 · a plugin could swap `globalThis.JSON` and hide that it read `ctx.play` — low · closed

`Object.freeze(JSON)` freezes the object, but the global binding stays writable
(`{"writable":true,"configurable":true}` in quickjs-ng). The call wrapper resolves `JSON` on every
call, so a `main.js` replacing it could report `playRead: false` for a handler that read
`ctx.play`, and the memo would then serve its result across every play-state change. Nothing
escaped the sandbox. The effect was limited to the plugin's own numbers going stale.

**Fix:** `SETUP_SCRIPT` pins the `JSON` and `Math` bindings non-writable and non-configurable.
**Held by** `plugin-sandbox.test.ts` ▸ a plugin cannot swap the global JSON, which fails without
the fix.

### S4 · `dompurify` 3.4.16 sat behind three advisories — unreachable · closed

GHSA-cg2g-xh64-v4q7 (`SAFE_FOR_TEMPLATES` with DOM output), GHSA-mrv2-3pqr-j5jr (`IN_PLACE`) and
GHSA-c6gr-qvv4-5v3f (xhtml parser). `markdown.ts` uses none of those modes.

**Fix:** `dompurify` is `^3.4.17`.

### S5 · dev-only advisories — closed where a patch exists

`@vitest/mocker` < 4.1.12 (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp) let anything reaching the
browser-test server register a mock while `pnpm test` runs. Fixed by moving the vitest family to
`^4.1.12`. `braces` ≤ 3.0.3 (GHSA-vfj7-8cjw-p6xm) has no patched release: the advisory's
`first_patched_version` is null and the registry's latest is 3.0.3. It is already
`work/release.md` ▸ DEP-2, and `pnpm audit` now reports it and nothing else.

### S6 · a middle click on a prose link opened the remote page in a new window — medium · closed

The layout's link handler listened for `click` only, and a middle click fires `auxclick`. Behind
it, Tauri 2.12 installs no new-window handler unless one is given. wry 0.57 then leaves WebView2's
`NewWindowRequested` unhandled (`webview2/mod.rs`), and WebView2's default is to open the request
in a popup window of its own. The failure was established from that source and not observed
before the fix.

**Fix:** the handler takes `auxclick` from the middle button. The main window is built in Rust
(`lib.rs` ▸ `open_main_window`, with `create: false` in the config) with an `on_new_window` that
refuses every request and sends an http(s) one to the OS browser. **Held by** `/dev/page-reach` on
the desktop app: `window.open` gets no window, left and middle presses on an outside link are
cancelled, and a right press is not.

### S7 · a pack name from config reached a recursive delete unchecked — low · closed

`parsePackConfig` took any key, and `uninstallPack` checked only `isReservedPackName`, which
passes `''`. An entry keyed `''` in a pack config that arrived with someone else's data folder
would offer an Uninstall that runs `storage.remove('content/')`.

**Fix:** `parsePackConfig` drops `packs` and `pending` keys that fail `isUsablePackFolderName`, and
`uninstallPack` refuses such a name. **Held by** `packs.test.ts` and `updates.test.ts`, both of
which fail without the fix.

## Ruled out

- **Rust commands.** All fifteen are declared in `build.rs` and listed in the capability.
  `set_data_dir` rejects `..` and anything not under a pick or the Rust-computed proposal.
  `apply_saved_data_dir` checks `is_grantable`. `open_app_dir` takes a name, not a path. The pointer
  and `plugins.json` sit in denied directories.
- **Remote fetch.** HTTPS only, to `api.github.com/repos/*` and `raw.githubusercontent.com`, with
  every redirect re-checked. The body cap counts bytes as they arrive, and both a connect and a
  total timeout are set. No credentials are sent.
- **Self-update.** Both commands take no arguments. Endpoint and key are compiled in, and no updater
  or process permission is granted to the page.
- **Plugin consent.** Native dialog with compiled-in words. `namespace` and `hash` are re-validated
  in Rust, enabling requires a standing consent, and the evaluated buffer is the hashed buffer.
- **Storage seam.** `sandboxRelative` rejects `..` after normalising `\`. A drive letter or UNC
  prefix mid-path stays a plain component under Tauri's string-concatenating `join`. `walkTree`
  does not follow symlinks.
- **Pack install.** Remote folder names go through `freeLocalPackName`, which refuses reserved
  names, dot-names, staging suffixes and Windows device names. A tree path with `..`, in either
  slash direction, throws at the seam. Code is installed only in the
  `plugins/<ns>/{main.js,plugin.json}` layout. File-count, byte and per-response caps apply.
- **Themes.** `sanitizeThemeTokens` allows only an allowlisted token name and a value of
  `[a-zA-Z0-9#%.,()/\s-]` without `url(`, `@`, `/*` or `expression`. The id is a slug. The sheet is
  written via `textContent`.
- **`{@html}` sites.** All six go through `renderContentMarkdown*` or `sanitizeHtml`. `provenance.ts`
  and `dragMotion.ts` `innerHTML` take sanitised or constant markup.
- **`/dev/*` in a release.** The layout renders no child outside `dev`, and no dev route has a load
  function or a module script, so a same-origin link to one runs nothing.
- **Portraits.** Decoded and re-encoded through a canvas at ≤ 512 px. The extension follows the
  produced blob.
- **Character and config JSON.** Characters go through migrate → zod. Config readers drop non-objects.
  No merge assigns untrusted keys onto a live object.
- **The web CSP's `base-uri`.** It read `'self'` where desktop and `security.md` §5 say `'none'`. It
  now says `'none'` too. DOMPurify strips `<base>` either way.

## Not yet checked

- `cargo audit`: the tool is not installed here. It is now a step of `work/release.md` ▸ AUDIT-DRIFT.
- The table link (`table_link.rs`, `lib/table-link`): not in a release build. Its own design review
  is `research/table-link-*.md`.
- The web demo's IndexedDB storage.
- A user-dropped locale catalog rendered outside the six `{@html}` sites. Svelte escapes text
  interpolation, so this should be safe, but it was not swept site by site.
- The Linux and macOS webviews for S6. Only WebView2 was driven, and there is no macOS build.

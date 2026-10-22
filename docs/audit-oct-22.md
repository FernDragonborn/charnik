# Security audit — 0.8.1 (2026-10-22)

A read of the shipped 0.8.1 tree for vulnerabilities only; game-rule bugs are out of scope. The
threat model is `internals/security.md`: content and packs are untrusted, the page is the thing
being contained, and the Rust side decides what the page may reach. Every CONFIRMED finding was
reproduced: in Chromium with Playwright, in the real QuickJS build, or by reading the exact plugin
source in the locked crate version. Nothing has been fixed yet. Each finding gives the change that
closes it.

## Confirmed

### S1 · `dialog:default` lets page script widen the fs scope, bypassing `GrantedDirs` — medium

`src-tauri/capabilities/default.json` grants `dialog:default`, and with it the dialog plugin's
`open` and `save` commands. In `tauri-plugin-dialog` 2.8.2 (`src/commands.rs`, `open` and `save`),
each picked folder or file goes straight into the fs plugin's runtime scope
(`allow_directory(path, options.recursive)` / `allow_file`). That path does not go through
`pick_data_dir`, `GrantedDirs` or `is_grantable`. So the rule in `security.md` §2 is false: it says
the fs scope is only `$DOCUMENT/charnik` plus folders Rust granted. Script in the page can open a
native picker with any title and `defaultPath`, for example "Choose a folder for your portrait"
opening on the home folder with `recursive: true`. One click then gives the page recursive
read/write over that folder for the rest of the session. The static denies on
`$APPCONFIG`/`$APPDATA`/`$APPLOCALDATA` still apply, and nothing is persisted across launches.

No front-end code imports `@tauri-apps/plugin-dialog`. Rust shows the data-folder picker and the
consent dialog itself, and those need no capability. The permission does nothing the app uses.

**Fix:** remove `"dialog:default"` from the capability. Extend `/dev/self-update`, or a sibling
probe, to call `plugin:dialog|open` from the webview and expect a refusal.

### S2 · prose can make a remote request through the `background` attribute — low (CSP holds)

`content/markdown.ts` lets an element fetch only its own origin or `data:`. It enforces this through
`FETCHING_ATTRIBUTES = ['src', 'poster', 'href', 'xlink:href']`. DOMPurify keeps the legacy
`background` attribute by default, and Chromium still loads it as an image. Running the exact
`PROSE_POLICY` and hook over
`<table background="https://evil.example/t.png">` and `<td background="https://evil.example/d.png">`
keeps both attributes, and the page requests both URLs. On desktop and on the web build `img-src
'self' data: blob:` blocks the load, so nothing leaves the machine today. The sanitiser's first
line has a hole and CSP is the only thing covering it, which is the state `security.md` §5 says
must not be relied on.

The same probe confirmed the hook strips remote `<img src>`, `<feImage href>`, `<svg><use>`, `<a
ping>` and `srcset`.

**Fix:** add `'background'` to `FETCHING_ATTRIBUTES`, or `FORBID_ATTR` it outright, since prose
needs no table backgrounds. Add a case to the markdown test.

### S3 · a plugin can replace `globalThis.JSON` and hide that it read `ctx.play` — low

`effects/plugin-sandbox.ts` ▸ `SETUP_SCRIPT` runs `Object.freeze(JSON)` so that a handler cannot
swap `JSON.stringify` and misreport `playRead`. Freezing the object leaves the global binding
writable (`{"writable":true,"configurable":true}` in quickjs-ng). The call wrapper looks `JSON` up
on `globalThis` on every call. A `main.js` that sets `globalThis.JSON = { parse, stringify: o =>
… playRead: false … }` makes the wrapper return `{"result":{"hp":7},"playRead":false}` for a handler
that read `ctx.play.hp`. Reproduced in `@jitl/quickjs-ng-wasmfile-release-sync`. The memo then
serves that result across every play-state change. Nothing escapes the sandbox; the cost is that a
consented plugin can make its own numbers stale. The `Math` freeze has the same shape and no
consequence, since `Math.random` cannot be restored.

**Fix:** pin the bindings in `SETUP_SCRIPT`:
`Object.defineProperty(globalThis, "JSON", { writable: false, configurable: false })`, and the
same for `Math`. Add a sandbox test with a plugin that tries the swap.

### S4 · `dompurify` 3.4.16 is behind three advisories — not exploitable here, bump anyway

`pnpm audit` lists GHSA-cg2g-xh64-v4q7 (critical, `SAFE_FOR_TEMPLATES` with DOM output),
GHSA-mrv2-3pqr-j5jr (high, `IN_PLACE` with a hook that removes a parent) and GHSA-c6gr-qvv4-5v3f
(low, `PARSER_MEDIA_TYPE: application/xhtml+xml`). `markdown.ts` uses string output with none of
those options, so none of them is reachable. The package is the one sanitising seam and a direct
dependency, so the patched version is a one-line bump (`work/release.md` ▸ AUDIT-DRIFT).

**Fix:** `"dompurify": "^3.4.17"`.

### S5 · dev-only advisories: `@vitest/mocker` and `braces` — low

GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp (moderate, `@vitest/mocker` < 4.1.12). The first lets
anything that reaches the browser-test server register a mock, which is code injection on a
maintainer's machine while `pnpm test` runs. GHSA-vfj7-8cjw-p6xm (high, `braces` ≤ 3.0.3, via
stylelint) is a stack-exhaustion DoS on a glob pattern the repo writes itself. Neither ships.

**Fix:** bump `vitest` and `@vitest/browser` to `^4.1.12`. Widen the existing `braces` override in
`pnpm-workspace.yaml` to reach `<3.0.4`.

## Suspected

### S6 · middle-click on a prose link is not intercepted — needs the real app

The layout's capture listener (`routes/+layout.svelte`) handles `click` only. A middle-click fires
`auxclick`, so it never reaches `externalLinkToOpen`. On WebView2 a middle-click on a link raises
NewWindowRequested. Whether Tauri 2.12 denies that or opens a second, unrestricted window on the
remote page was not checked: it needs the desktop build.

**Check:** a `/dev/` probe with an external link. Middle-click it on Windows and Linux and see
whether a window appears. **Fix if it does:** listen for `auxclick` with the same handler, and set
`on_new_window` to deny in `lib.rs`.

### S7 · a pack name read from config is not validated before `uninstallPack` deletes it — low

`parsePackConfig` takes `packs` as any record. `uninstallPack` checks only `isReservedPackName`,
which passes `''` and `a/b`. A pack config arriving with a restored or shared data folder that
holds an entry keyed `''` shows a row whose Uninstall runs `storage.remove('content/')`, which is
every pack and every authored file under it. This needs that file plus the user confirming the
uninstall, so it is a footgun more than an attack. Not driven end to end.

**Fix:** drop keys that fail `isUsablePackFolderName` in `parsePackConfig`, and refuse them in
`uninstallPack` the same way `renamePack` already does.

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

## Not yet checked

- `cargo audit`: `cargo-audit` is not installed on this machine.
- S6, on Windows and Linux.
- The table link (`table_link.rs`, `lib/table-link`): not in a release build. Its own design review
  is `research/table-link-*.md`.
- The web demo's IndexedDB storage and its CSP `<meta>`. The meta carries `base-uri 'self'`, while
  desktop and `security.md` §5 say `'none'`. That is harmless while DOMPurify strips `<base>`, but
  the doc and the config disagree.
- A user-dropped locale catalog rendered outside the six `{@html}` sites. Svelte escapes text
  interpolation, so this should be safe, but it was not swept site by site.
- macOS: no build exists.

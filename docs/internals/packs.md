# Content packs

> For maintainers. How content arrives from outside the app: fetched, diffed, applied, and rolled
> back. Everything here also answers "why is it this careful" — the answer is that a half-applied
> pack is silent data loss on someone's rules.

## The model

A **pack is a folder** under `content/`. It carries its own identity in-band (`#content-id`, a GUID,
in each CSV) and its own provenance (`#content-source`). There is no manifest — see `content.md`.

A pack may be local (the user's own homebrew) or **remote**, tracked against a GitHub repository.
Remote packs are registered in the `contentPacks` section of `charnik.config.json`, each entry
remembering the repo, the branch (falling back to `master` and remembered afterwards, because
downloads and post-restart applies need it too, not just the check), the last ETag, and any pin.

The shipped SRD is itself a pack, which is what lets rules data be corrected and released without an
app build. **Plugins ride in packs** as `plugins/<ns>/{main.js,plugin.json}` — `isPackFile` accepts
exactly those two paths, and its twin in `tools/build-static-content.mjs` must agree.

## Checking for updates without downloading

An update check reads a **GitHub tree listing** and compares each file by its **git blob SHA**. No
file content moves until the user asks for it.

That comparison only holds while the blob bytes are the disk bytes, which is why a pack repo must
carry `.gitattributes` with `* -text` (`content.md`). It is also why `packsFromTree` must honour the
API's **`truncated`** flag: a partial tree otherwise manufactures phantom "removed" entries for
everything past the cut.

**Record the ETag after the packs, never before.** Persisting it first means a crash or throw
mid-check leaves an update permanently invisible — the check believes it has already seen this state.
An oversized pack must clear the recorded ETag rather than being buried by it.

There are caps, and they are refusals rather than truncations: a per-repo pack count, a streaming size
cap per download, an aggregate pre-download budget, and a request timeout.

## Applying is all-or-nothing

`applyPackUpdate` stages into `<pack>.new`, then swaps: the live folder becomes `<pack>.prev`, the
staged folder becomes live. **Windows refuses to rename a directory onto an existing one**, and the
whole design leans on that — which is why this path is verified with a real desktop probe and not with
a fake (`tooling.md`).

- **A file the user has changed is never overwritten.** The `#content-hash` overwrite guard decides
  that, and it applies here exactly as it applies to seeding.
- **The disk is settled before a throw escapes**, or the registry entry dies while the folders are
  half-swapped.
- **A failed registry write reaches the user.** It used to be the one report nobody saw.
- **`recoverInterruptedApply`** finishes or reverses an apply that died mid-swap, on startup.
- **A lone `<pack>.prev` is unreachable** from either writer, so startup must not resurrect it. It
  once did, which meant an uninstall quietly undid itself at the next launch.
- **Folder names are compared case-insensitively.** NTFS and APFS fold case, so `SRD-2024` installs
  over `srd-2024` unless the comparison does too.
- **Every pack WRITE raises the in-flight flag** — apply, rename, rollback, uninstall — through
  `duringPackWrite` / `isPackWriteInFlight`. Anything that reasons about the folder set while a swap
  is in progress will read a lie, so `forgetUninstalledPacks` guards itself and the watcher does not
  reload mid-swap.
- **`listFilesRecursive` throws on unreadable-but-present** rather than silently dropping a file,
  which used to lose carry-over files during the swap.
- **A rename moves the browse config's per-file toggles** with the pack.

`rollbackPack` restores from `<pack>.prev`; `hasRollback` says whether that is still possible.

## Provenance is declared, so it is only a claim

A pack declares its own `#content-source`, and that self-declared tag is the only provenance the UI
has. When another pack already publishes under the same tag, the app **warns and requires a second
click** — a warning rather than a refusal, because a legitimate fork of the SRD repo carries the tag
on purpose. The **pack** is named in the article and heads its group in the source filter, so the
source tag is never the whole story a user sees.

Two repos may legitimately both publish `srd-2024`, so a local folder name is not the same thing as
its `remotePack`. Packs can be renamed; bundled packs cannot.

## Deliberately not built

- **Pack signing.** A multi-author pack has nobody to sign it, and the key would land in CI, where
  "signed" only restates who can push. Revisit only if Charnik ever becomes a central distributor.
- **A generic HTTPS host.** Only GitHub is supported. A Tauri capability is compiled in and cannot be
  widened at runtime, so the next rung is a per-host user grant checked in Rust — which is a real
  piece of work, not a config change.

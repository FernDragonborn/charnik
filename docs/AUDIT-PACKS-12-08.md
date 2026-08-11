# AUDIT — external-content module (REL-4 packs), 2026-08-12 — WHAT'S LEFT

Temp doc, `git rm` when empty. Five of seven findings are fixed in `001a9dc` (that commit message is
the record — don't re-derive them here). These two are open by decision.

### [ ] 1. `forgetUninstalledPacks` runs unguarded while a pack folder is mid-move

`provider.ts:108`. Its neighbour `recoverInterruptedApplies` (`:104`) bails on `isApplyInFlight()`;
this one doesn't — and it deletes registry entries (`repo`, `pinned`, `remotePack`), not scratch
folders. The folder is briefly absent in three places: `buildAndSwap` (between the two renames),
`renamePack` (before `renamePackEntry` — which then silently no-ops while `renamePack` still returns
`true`), `rollbackPack`. The watcher reloads throughout. Bundled packs self-heal via
`adoptShippedPacks`; third-party ones don't — pin and repo URL gone, silently.

Fix: the in-flight flag has to be raised by apply **and** rename/rollback/uninstall, then
`forgetUninstalledPacks` respects it. Not a one-liner, which is why it's still here.

### [ ] 2. `provider ↔ remote/*` import cycle

`provider.ts → remote/install.ts → remote/diff.ts → provider.ts`. Benign at runtime, but the module
can't be lifted out or tested alone. Cause: `provider.ts` is both low-level file policy
(`isProtectedFromOverwrite`, `discoverContentRoots`) and orchestration (`buildGraph`). Fix = move the
two low-level functions to a leaf module. No `import/no-cycle` rule exists to catch the next one.

### [ ] Tail

- No cap on the NUMBER of packs in a repo (`MAX_PACK_FILES` is per pack).
- An oversized pack is reported once, then `forgetPending` + a recorded ETag bury it.
- `isPackFile` installs any `main.js`; only `<pack>/plugins/<ns>/` is disclosed and loaded.
- `diffPack` re-hashes the whole pack every check and every launch (50 MB at the advertised ceiling).

### Checked, fine — don't re-audit

Path traversal (`sandboxRelative` + `isReservedPackName`), the content-addressed `.pack-cache`,
`writeConfigSection` coalescing, SHA-1 as CDN-drift (not trust) protection, and "applying is always
a click" across `checkOneRepo` / `stagePackUpdate` / `runApply`.

# AUDIT — the external-content module (REL-4 packs), 2026-08-12

**Temporary doc.** Same lifecycle as the retired `AUDIT-29-07.md`: it exists to survive between
sessions, and it gets `git rm`-ed once every item below is either fixed or folded into a permanent
home (PLAN / AI-CONVENTIONS / EFFECTS). Before retiring it, grep it for `[ ]` **and** `[~]` **and**
prose markers (AI-CONVENTIONS §8.7).

**Status convention:** `[ ]` = found, not fixed. `[~]` = partially addressed. `[x]` = fixed in code
**and** verified (audit-status-only-when-implemented).

**Fixed 2026-08-12** (1250 tests green, lint 0 errors, svelte-check 0): findings **1, 2, 4, 6, 7**
and the duplicated `http:default`. **Open: 3 and 5** — 3 by maintainer decision this round (the flag
has to be raised by four operations, not one, which is more than a quick fix), 5 because it is a
module split, not a patch. The P4 tail is open too.

**Scope read:** `src/lib/content/remote/{types,github,diff,install,tauri-fetch,updates.svelte}.ts`,
`src/lib/content/packs.svelte.ts`, plus the seams it meets — `content/provider.ts`,
`content/store.svelte.ts`, `content/watcher.ts`, `storage/json-config.ts`, `storage/walk.ts`,
`routes/+layout.svelte`, `components/settings/PackUpdatesSettings.svelte`,
`src-tauri/capabilities/default.json`.

**Verdict:** the MODEL is sound — repo = unit of checking / pack = unit of installing, local folder =
identity, all-or-nothing swap, compare-and-set before the write. Every finding below is either an
ORDERING problem or an invariant enforced on the wrong layer. Nothing here asks for a redesign.

---

## P1 — the expensive three

### [x] 1. The ETag is recorded BEFORE the packs it certifies are remembered

`src/lib/content/remote/updates.svelte.ts:206` (`recordCheck`) vs `:236` (`rememberPending`).

```
recordCheck(repo, now, etag)      ← persists "I have seen this remote state"
  for (remote of res.packs)       ← diffPack (hashes the whole pack) + stagePackUpdate (DOWNLOADS)
     rememberPending(pack, …)     ← the conclusion the ETag is supposed to certify
```

Everything slow sits between them: disk hashing, and in `download` mode the actual byte transfer.
`describeUpdate` is not wrapped in try/catch, and a storage throw escapes through `runCheck` into
`void restorePendingUpdates().then(…)` in `+layout.svelte` as an unhandled rejection.

**Consequence:** quit / crash / throw in that window ⇒ ETag on disk, no pending. Next launch the repo
answers `304`, `checkRepo` returns `unchanged` before it looks at any pack, and the update is
**invisible forever** — until some later upstream commit changes the tree again. The manual button
replays the same ETag, so it does not recover it either. This is exactly the failure `PendingRemote`
was invented to fix, reintroduced one layer down as an ordering bug.

**Fix:** move `recordCheck` to after the pack loop. Both writes land in the same config section, so
this is one `persist`, not two. Test: a check whose `describeUpdate` throws must leave `repos[repo]`
without an `etag`.

### [x] 2. `truncated` is never checked — and the comment says it is

`src/lib/content/remote/github.ts:100-110`. The comment claims *"Unparseable JSON, a truncated tree,
or a tree with no packs all yield `[]`"*; `packsFromTree` only reads `.tree`.

GitHub truncates at ~7 MB / 100k entries and answers **200 with `truncated: true`** — a valid but
INCOMPLETE listing. `MAX_REMOTE_BYTES` is 8 MB, i.e. above the truncation point, so such a response
passes every guard we have.

**Consequence:** `diffPack` reports "local file the remote doesn't list" as `removed`. A truncated
tree therefore manufactures phantom `removed` entries for files that are alive upstream — and with
`removeDeleted` that is real content deletion. The impact preview does warn, which is the only reason
this is P1 and not P0.

**Fix:** read `truncated` in `packsFromTree`; a truncated tree must reach the user as an `error`, not
as a partial list. ~3 lines + one test over a fixture with `"truncated": true`.

### [ ] 3. `forgetUninstalledPacks` is an unguarded destructive reconciler, next to a guarded one

`src/lib/content/provider.ts:104` calls `recoverInterruptedApplies`, which correctly bails on
`isApplyInFlight()`. Four lines later `:108` calls `forgetUninstalledPacks(installed)` with no guard
at all — and it is the worse of the two: it deletes **config** (`repo`, `pinned`, `remotePack`), not
scratch folders.

Windows where `content/<pack>` does not exist:

| where | window |
|---|---|
| `install.ts` `buildAndSwap` | between `rename(live, prev)` and `rename(next, live)` |
| `updates.svelte.ts` `renamePack` | between `storage.rename` and `renamePackEntry` |
| `install.ts` `rollbackPack` | between `live → .new` and `prev → live` |

The watcher fires throughout (28 events measured for a three-file pack, `0cf0c4c`), debounce 300 ms,
`reloadContent` → `buildGraph`. `renamePack` is the nastiest variant: `renamePackEntry` silently
returns (`if (!entry) return`) once the entry is gone, yet `renamePack` still returns `true` — the
folder is renamed and the registry entry is gone entirely.

**Consequence:** a bundled pack self-heals via `adoptShippedPacks`; a **third-party pack never does** —
pin and repo URL are gone, no update will ever be offered again, and nothing says so.

Note the same risk class was already handled one level up: `discoverContentRoots` deliberately
distinguishes "`content/` missing" from "`content/` unreadable" precisely so a transient listing
failure cannot wipe the registry. The per-PACK case was left open.

**Fix:** the in-flight flag must be raised by every folder-moving operation (apply / rename /
rollback / uninstall), not by apply alone, and `forgetUninstalledPacks` must respect it. Probability
is low; the fix is one guard in one place.

---

## P2 — layering

### [x] 4. The one rebuilder of `updates.pending` sits outside the mutex that exists for it

`serialised` (`updates.svelte.ts:120-139`) documents why anything that rebuilds pending or sweeps the
cache must run one at a time — `pruneCache` against a half-built `updates.pending` deletes bytes
another run just downloaded. `restorePendingUpdates` is the main rebuilder and is **not** in the
queue. Only the hand-written `.then()` chain in `+layout.svelte:150` keeps it away from the startup
check today; any other `checkNow` caller (Settings, `/dev/packs`, a future trigger) reopens it.

Same class: `installPack`, `uninstallPack`, `renamePack` write `content/` entirely outside the queue,
while `applyUpdate` is inside it. `uninstallPack` racing an apply of the same pack resurrects the
folder from `.new` with no registry entry behind it.

**Fix:** put `restorePendingUpdates` on the same queue; decide explicitly whether the folder-mutating
trio belongs there too (it probably does — see finding 3, same guard).

### [ ] 5. Cycle: the external-content module is not a leaf

`provider.ts → remote/install.ts → remote/diff.ts → provider.ts`, plus `remote/updates.svelte.ts →
provider.ts`. Harmless at runtime today (top level is declarations only), but it means the module
cannot be lifted out or tested in isolation — a boundary the rest of the codebase does keep
(`Storage`, `effects/`). Root cause: `provider.ts` is both low-level file policy
(`isProtectedFromOverwrite`, `discoverContentRoots`) and high-level orchestration (`buildGraph`,
which calls into `remote/install`).

**Fix:** extract the two low-level functions into a leaf module; `remote/` becomes a one-way
consumer. `eslint` has no cycle rule at all right now (`eslint.config.js` has `max-lines`,
`complexity`, but no `import/no-cycle`) — worth adding while here.

### [x] 6. "Uninstalling a pack takes its permissions with it" is enforced in a `.svelte` file

`PackUpdatesSettings.svelte:457` calls `revokePackPlugins(pack)` immediately before
`uninstallPack(pack)`. `uninstallPack` itself knows nothing about plugins, and
`updates.test.ts:160` calls it directly — the test drives right past the invariant. This contradicts
"Frontend is a thin shell": a security-relevant rule currently depends on one button calling two
things in the right order.

**Fix:** move the revoke inside `uninstallPack`. (Check the import direction first — `plugin-store`
must not close finding 5's cycle from the other side.)

---

## P3 — the ergonomics one worth more than its size

### [x] 7. The branch is hardcoded to `main` while the comment promises the default branch

`src/lib/content/remote/github.ts:30-34`:

```ts
/** Defaults to the repo's default branch when the URL doesn't say. */
const DEFAULT_BRANCH = 'main';
```

Nobody asks the repo what its default branch is. Any third-party pack on `master` / `trunk` / `dev`
answers `404` on the tree, surfacing as `{kind:'raw', message:'Not Found'}` on every single check,
with no hint that pasting `/tree/<branch>` would fix it. For a feature whose entire point is
"somebody else publishes content", this is the primary failure path.

**Fix (cheapest first):** on `404`, retry `master` before reporting; or one `/repos/:owner/:repo`
request for `default_branch` (same 60/hr budget, and ETag-cacheable). Either way the error copy must
name the branch it tried.

---

## P4 — one line each

- [ ] **No cap on the NUMBER of packs in a repo.** `MAX_PACK_FILES` is per pack; a repo with 5000
  one-file folders passes every guard and renders 5000 rows into `updates.discovered`.
- [ ] **An oversized pack is reported exactly once.** `describeUpdate` → `packSizeRefusal` → `null` →
  `forgetPending`, with the ETag already recorded (finding 1) ⇒ the refusal never comes back.
- [ ] **`isPackFile` installs any `main.js`,** while `namespacesOf` / `discoverPlugins` only see
  `<pack>/plugins/<ns>/`. Code outside that path is written to disk and never named in the
  "this pack ships plugins" disclosure. Inert today (the host only scans `plugins/`), still written.
- [x] **`capabilities/default.json` lists `http:default` twice** — once as a bare string, once as a
  scoped object. Scopes union, so it is not a widening; it is noise that reads like a mistake.
- [ ] **`diffPack` re-hashes the whole pack on every check and every launch**
  (`restorePendingUpdates`). Cheap for the 15-file SRD; at the ceilings this module advertises
  (200 files / 50 MB) it is 50 MB of SHA-1 per start.

---

## Explicitly NOT findings (checked, and fine)

- **Path traversal into `content/`.** `storage/path.ts` `sandboxRelative` normalises backslashes
  before splitting and rejects `..`; `isReservedPackName` blocks a leading `.`, so `..` and `..\x`
  never reach a write. Both `installPack` and `renamePack` validate through it.
- **The `.pack-cache` design.** Content-addressed, re-hashed on read, lives outside `content/`.
- **`writeConfigSection` coalescing.** Stringify-at-execution + per-file chain is correct; the pack
  registry is a tenant, not the owner.
- **SHA-1 as the download check.** The SHA arrives from `api.github.com` over TLS, so it is drift
  protection against the raw CDN, not a trust decision — and the code says so.
- **Applying is never automatic.** `download` mode stages bytes only; nothing under `content/` moves
  without a click (SECURITY.md §7). Verified across `checkOneRepo`, `stagePackUpdate`, `runApply`.

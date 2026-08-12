# AUDIT — external-content module (REL-4 packs), 2026-08-12 — WHAT'S LEFT

Temp doc, `git rm` when empty (AI-CONVENTIONS §8.7). This is the **third pass** on the same module,
same day: the ledger for passes one and two was retired in `1ddb102` once its items closed, and this
file reclaims the name because its identity is the MODULE, not the pass. Nothing here is fixed yet.

The first two passes read the module for correctness. This one followed the whole chain —
capability → Rust fetcher → GitHub adapter → diff → swap-in → loader → prose render → plugins —
asking a different question: **what can a hostile pack do to a user who is not reading the code?**

The shape of the answer: the transport and the plugin model hold up. The gaps are **identity** (who
a pack claims to be) and the **folder-name / staging model** on a real filesystem. Ordered by what
it costs the user, not by effort.

---

### [ ] 1. A pack declares its OWN `#content-source`, so it can wear another pack's identity

Identity is `source:id`; the tag comes out of a file the pack ships; and `sourceLabel`
(`content/detail.ts:200`) renders `SRD 5.2.1` as the friendly **"D&D 5.5e"**. So a third-party pack
that stamps that tag:

- reads as official in every article card — `entryMeta` shows the friendly label and nothing else;
- merges into the SAME group in `SourceManager`, so it cannot be switched off separately from the
  real SRD (the filter is file × source, and both dimensions say "SRD 5.2.1");
- collides `type:id` with the official rows as if one publisher were disagreeing with itself.

`sourceClash` (`remote/install.ts:468`) is the only thing standing there, and it compares the
incoming tag against the tag **already in that folder** — which is `null` on a first install, i.e.
exactly when a spoof happens. It was written to catch an upstream RE-TAG, and it does that well; it
was never a claim check.

**Fix:** build a `source → pack` map over every installed pack and compare against that, not against
the one folder being written. A tag already claimed by another pack is a refusal, or at the very
least a stated confirmation ("this pack publishes rows as *D&D 5.5e*, which is what *srd-2024*
already provides"). Needs finding 9 to be worth much.

### [ ] 2. A `.prev` outlives the pack it belonged to, and startup recovery puts the pack back

`uninstallPack` (`remote/updates.svelte.ts:691`) removes `content/<pack>` and leaves
`content/<pack>.prev` sitting beside it. The next content rebuild runs
`recoverInterruptedApplies` (`content/provider.ts:110`), which scans `content/` for `*.prev`,
reads "live folder missing, `.prev` present" as *died between the two renames*, and **renames it
back into place**.

So a pack the user uninstalled returns at the next launch — plugin code included. Consent was
revoked on uninstall so nothing executes, but the files are back and the rows load. Same path for a
folder deleted in a file manager, which is a supported way to do anything here.

`renamePack` (`:665`) already moves `<from>.prev` for precisely this reason — the trap was known and
uninstall was missed. No test covers it (`install.test.ts` has `.prev` cases, none after a delete).

**Fix:** drop `.prev` and `.new` inside the same `duringPackWrite` as the folder delete.

### [ ] 3. Pack folder names collide case-insensitively on both platforms we ship to

`freeLocalPackName` (`content/packs.svelte.ts:326`) and the owner check in `installPack`
(`remote/updates.svelte.ts:586`) compare **exact** strings. `isReservedPackName` right above them
deliberately lowercases — so the code already knows case-folding filesystems exist and only
half-applies it.

On NTFS/APFS, a repo publishing `SRD-2024` beside an installed `srd-2024` is judged free. Then
`storage.exists` answers about the OTHER pack's files, `diffPack` computes against them, and
`buildAndSwap` renames that pack to `SRD-2024.prev` and swaps its own tree in. The user's pack is
gone, with no message, and the registry now holds two entries for one folder.

**Fix:** case-fold the `taken` set, the owner check, and `renamePack`'s destination test.

### [ ] 4. A link in content prose navigates the whole window

`ArticleProse.svelte:37` renders `{@html renderContentMarkdown(...)}`. DOMPurify with no config
correctly strips `<script>`/`on*`/`javascript:` and correctly **keeps `<a href>`** — and nothing
intercepts the click. A hostile pack's spell description is therefore one click from replacing the
app with a remote page, in a webview with **no address bar, no back button** and nothing to say it
happened. (No IPC follows it there, so this is phishing + lockout, not code execution.)

It is also the one claim in **SECURITY.md §5 that is not true**: "external links open in the OS
browser, not the app webview" is the intent, and no code implements it — `plugin-opener` is wired
only for the log folder and the data dir.

**Fix:** one delegated click handler on the rendered body → `preventDefault` + `openUrl` (the
`opener` capability is already granted). Same handler serves `PanelCard`, the other consumer of
`renderContentMarkdown`.

### [ ] 5. The apply path has no error boundary, and a throw mid-swap costs the registry entry

Neither `runApply` (`remote/updates.svelte.ts:390`) nor `installPack` wraps `applyPackUpdate`, and
`buildAndSwap` (`remote/install.ts:240`) throws on a full disk, on `EBUSY` (a content CSV open in
Excel — the ordinary Windows case), and on a folder name the OS refuses (finding 8).

Two consequences. The visible one: an unhandled rejection instead of `updates.error`, so the panel
says nothing. The expensive one: a throw **between the two renames** leaves the pack folder absent
while `duringPackWrite`'s `finally` lowers the in-flight flag — after which the next content rebuild
is free to read "uninstalled", and `forgetUninstalledPacks` drops the repo URL and the pin.
`recoverInterruptedApply` restores the FILES at the next launch; nothing restores those two.

This is the failure `9f28d52` closed for the success path, reachable again through the failure path.

**Fix:** catch → `UpdateError`; and hold the in-flight flag across the recovery, not just the write.

### [ ] 6. The response size cap is enforced after the body is already in memory

`remote/tauri-fetch.ts:23` checks `Content-Length`, then `await res.text()` / `arrayBuffer()`, then
re-checks against the actual length. So a response with no declared length — or a lying one — is
**fully buffered before anything refuses it**, which is precisely the case the comment says must not
get a free pass. `MAX_REMOTE_BYTES` currently bounds what we will *use*, not what we will *hold*.

**Fix:** read through `res.body.getReader()` with a running byte count, abort at the ceiling. (Also:
`body.length` counts UTF-16 units, not bytes — a cosmetic under/over-count next to the real issue.)

### [ ] 7. No total request timeout, and everything queues behind one

Only `connectTimeout: 15_000` is set. A host that accepts the connection and then says nothing hangs
the request forever — and because `checkNow` / `applyUpdate` / `restorePendingUpdates` share one
`serialised()` queue (`remote/updates.svelte.ts:140`), that single hung request wedges **every**
check, install, apply and restore until the app restarts.

**Fix:** `signal: AbortSignal.timeout(…)` on both fetcher methods.

### [ ] 8. Tail — three one-liners

- `assertHttps` (`remote/tauri-fetch.ts:17`) tests `protocol.startsWith('https')`, so `httpsx:`
  passes the layer whose whole job is to be the second line of defence. `=== 'https:'`.
- `NodeStorage` (`storage/node.ts:18`) resolves straight off its root, **without** `sandboxRelative`
  — while **SECURITY.md §3** states the node impl exercises the same validation. True of
  `memory.ts`, not of this one. Test/tooling-only today; the invariant is the point.
- The local folder name is validated only against `''`, `/` and the reserved set
  (`remote/updates.svelte.ts:580`). `\`, `:`, `*`, `?`, `<`, `>`, `|`, control characters, a trailing
  dot or space, and the Windows device names (`CON`, `NUL`, `AUX`, `COM1`) all reach `mkdir` and
  throw there — see finding 5 for what that then costs.

### [ ] 9. Provenance never reaches the user, and there is no per-PACK filter

`LoadedRow` carries `root` (the pack) all the way through the loader, and the UI drops it:
`entryMeta` shows the `source` label only, and the two-dimensional filter is file × source with **no
pack dimension**. So a pack cannot be switched off without deleting it, and cannot be told apart
from a pack claiming its tag.

Not a defect standing alone — it is the mechanism finding 1 exploits, and one change fixes both:
show the pack in the article meta, group `SourceManager` by `(pack, source)`.

---

### Not a defect — decided, don't re-raise

Downloaded bytes are verified against the git blob SHA from the same tree listing. That is
**integrity, not authenticity**: a typo-squatted URL or a compromised repo yields whatever it likes,
and only the plugin consent hash stands between that and executing code. Already stated plainly in
SECURITY.md §7, and the honest posture for v1. If it is ever raised: an optional **minisign
signature per pack** reuses the format the updater already carries, and belongs with **REL-5** (a
pack from any HTTPS host is when publisher trust stops being "GitHub told us"), not here.

### Checked, fine — don't re-audit

Carried forward from the retired second-pass ledger, plus what this pass cleared:

- **Path traversal**, again and from the remote side: `sandboxRelative` is called by the Tauri and
  memory impls, `isReservedPackName` blocks `.`-prefixed and staging names, git trees cannot carry
  `..` components, and `withinPack`/`localPathIn` rebuild every path from the LOCAL folder name.
  (`NodeStorage` is the exception — finding 8.)
- The content-addressed `.pack-cache`: re-hashed on read, so a tampered or truncated entry is a miss
  rather than a trusted file; pruned against the pending set; lives outside `content/`.
- **The plugin model end to end** — consent = `sha256(len‖main.js‖len‖plugin.json)` stored OUTSIDE
  the dataDir, so no pack can arrive pre-enabled; namespace grammar makes traversal unrepresentable;
  duplicate namespaces are reported, never silently shadowed; one QuickJS runtime per plugin with
  `Date`/`Math.random`/`eval`/`performance` removed and time+memory+result caps; kill switch; new
  bytes void consent. The installer discloses plugins BEFORE installing and names the ones an update
  would rewrite.
- **Bounded parsers:** L2 expressions capped at 512 chars / depth 32, effect amounts clamped, CSV
  files capped at 20 MB before `Papa.parse`, packs capped at 200 files / 50 MB read off the tree
  BEFORE the first byte, repos capped at 50 packs, tree `truncated` refused.
- **CSP** `default-src 'self'` — no remote images, fonts or XHR from content prose; DOMPurify covers
  the injection half (the navigation half is finding 4).
- **"Applying is always a click"** across `checkOneRepo` / `stagePackUpdate` / `runApply`: the
  strongest automatic mode still only pre-downloads, and the default is `off` for privacy.
- Git-tree **symlink** blobs install as ordinary files containing their target text — no symlink is
  ever created.
- The Rust surface: four narrow commands, the fs-scope widened only from a real OS folder pick or
  Rust's own pointer file, the HTTP host allowlist compiled into the binary.

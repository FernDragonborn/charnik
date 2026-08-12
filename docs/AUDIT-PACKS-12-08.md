# AUDIT — external-content module (REL-4 packs), 2026-08-12 — WHAT'S LEFT

Temp doc, `git rm` when empty (AI-CONVENTIONS §8.7). This is the **third pass** on the same module,
same day: the ledger for passes one and two was retired in `1ddb102` once its items closed, and this
file reclaims the name because its identity is the MODULE, not the pass.

**Progress:** 2, 3, 7 and two thirds of 8 are done (`[x]`/`[~]`); 1, 4, 5, 6, 9 and the new 10–12
are open. Decisions taken with the maintainer 2026-08-12: a duplicate `#content-source` WARNS and
asks for an explicit confirmation rather than refusing (a fork of the SRD repo legitimately carries
the same tag); the UI provenance half (9) is IN this pass, because 1 is half a fix without it; and a
config write that fails must reach the user, not just a log.

The first two passes read the module for correctness. This one followed the whole chain —
capability → Rust fetcher → GitHub adapter → diff → swap-in → loader → prose render → plugins —
asking a different question: **what can a hostile pack do to a user who is not reading the code?**

The shape of the answer: the transport and the plugin model hold up. The gaps are **identity** (who
a pack claims to be) and the **folder-name / staging model** on a real filesystem. Ordered by what
it costs the user, not by effort.

---

### [x] 1. A pack declares its OWN `#content-source`, so it can wear another pack's identity

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

**Fixed as a WARN + explicit second click** (maintainer's call — a fork of the SRD repo legitimately
carries the SRD's tag, so a refusal would block a real workflow). `sourceClaimedElsewhere` reads a
`source → pack` map off the loaded graph and compares the incoming tag against every OTHER pack, at
the same moment `sourceClash` runs — bytes in hand, nothing written. It returns through the same
shape the row-removal question already used (`sourceClaim` on the result, `acceptSourceClaim` to
approve), so the panel grew one button rather than a new mechanism.

**Note for whoever touches `installPack` next:** it was not passing `graph` at all, so the check
could not have fired on a FIRST install — which is precisely the case it exists for. It does now.

### [x] 2. A `.prev` outlives the pack it belonged to, and startup recovery puts the pack back

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

**Fixed, and deeper than the report.** Uninstall now drops both staging folders (`removeStaging`),
but the patch alone would have left the file-manager route open — so the recovery rule itself was
wrong. Both writers keep the replacement tree on disk until the very last rename (`buildAndSwap`:
live→`.prev`, then `.new`→live; `rollbackPack`: live→`.new`, then `.prev`→live), so at the only
moment the pack is missing **both** staging folders exist. A lone `.prev` is unreachable from either
— it can only mean the live folder left by another route — and is now dropped instead of promoted.
Tests: the orphan case in `install.test.ts`; the genuine `prev + new` mid-swap case already existed
and still passes.

### [x] 3. Pack folder names collide case-insensitively on both platforms we ship to

`freeLocalPackName` (`content/packs.svelte.ts:326`) and the owner check in `installPack`
(`remote/updates.svelte.ts:586`) compare **exact** strings. `isReservedPackName` right above them
deliberately lowercases — so the code already knows case-folding filesystems exist and only
half-applies it.

On NTFS/APFS, a repo publishing `SRD-2024` beside an installed `srd-2024` is judged free. Then
`storage.exists` answers about the OTHER pack's files, `diffPack` computes against them, and
`buildAndSwap` renames that pack to `SRD-2024.prev` and swaps its own tree in. The user's pack is
gone, with no message, and the registry now holds two entries for one folder.

**Fixed:** `claimedPackName` (case-folded registry lookup) behind the `taken` set, the install owner
check and `renamePack`'s destination test; an install into an existing pack's name under a different
spelling now writes to the entry that already exists instead of minting a second one for the same
directory. A case-ONLY rename is exempted, or both checks would refuse it while naming the pack being
renamed. **Also caught while fixing it:** `freeLocalPackName` suffixes `-2`, `-3`… until a name is
free, and a name unusable for its CHARACTERS never becomes usable that way — the loop would have spun
forever on `foo:bar` or `.git` once finding 8 tightened the test. `sanitisePackFolderName` runs first
and guarantees termination.

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

### [x] 5. The apply path has no error boundary, and a throw mid-swap costs the registry entry

Neither `runApply` (`remote/updates.svelte.ts:390`) nor `installPack` wraps `applyPackUpdate`, and
`buildAndSwap` (`remote/install.ts:240`) throws on a full disk, on `EBUSY` (a content CSV open in
Excel — the ordinary Windows case), and on a folder name the OS refuses (finding 8).

Two consequences. The visible one: an unhandled rejection instead of `updates.error`, so the panel
says nothing. The expensive one: a throw **between the two renames** leaves the pack folder absent
while `duringPackWrite`'s `finally` lowers the in-flight flag — after which the next content rebuild
is free to read "uninstalled", and `forgetUninstalledPacks` drops the repo URL and the pin.
`recoverInterruptedApply` restores the FILES at the next launch; nothing restores those two.

This is the failure `9f28d52` closed for the success path, reachable again through the failure path.

**Fixed, in that order of importance.** `swapInNewTree` now settles a half-done swap
(`recoverInterruptedApply`) BEFORE the throw escapes, while the in-flight flag is still up — so no
reload can ever see the gap, which is the half that cost the registry entry. The callers then wrap
the whole apply in `guarded()`, so a disk failure reads as an ordinary `UpdateError` in the panel
instead of an unhandled rejection and a silent no-op. Test: the last rename fails, the pack is still
there afterwards holding the version it started with.

### [x] 6. The response size cap is enforced after the body is already in memory

`remote/tauri-fetch.ts:23` checks `Content-Length`, then `await res.text()` / `arrayBuffer()`, then
re-checks against the actual length. So a response with no declared length — or a lying one — is
**fully buffered before anything refuses it**, which is precisely the case the comment says must not
get a free pass. `MAX_REMOTE_BYTES` currently bounds what we will *use*, not what we will *hold*.

**Fixed:** `readCapped` counts as the body arrives and cancels the stream at the ceiling — which is
worth doing rather than cosmetic, because `plugin-http` pulls the body over IPC chunk by chunk and
releases the Rust-side resources on cancel, so the transfer really stops. The `Content-Length` check
stays in front of it as the cheap refusal. The UTF-16 `body.length` miscount is gone with it (bytes
are counted as bytes, then decoded once). Tests: `tauri-fetch.test.ts`.

### [x] 7. No total request timeout, and everything queues behind one

Only `connectTimeout: 15_000` is set. A host that accepts the connection and then says nothing hangs
the request forever — and because `checkNow` / `applyUpdate` / `restorePendingUpdates` share one
`serialised()` queue (`remote/updates.svelte.ts:140`), that single hung request wedges **every**
check, install, apply and restore until the app restarts.

**Fixed:** `AbortSignal.timeout(60_000)` on both fetcher methods, next to the existing
`connectTimeout`.

### [~] 8. Tail

- `[x]` `assertHttps` tested `protocol.startsWith('https')`, so `httpsx:` passed the layer whose
  whole job is to be the second line of defence. Now an exact `=== 'https:'`.
- `[x]` The local folder name was validated against `''`, `/` and the reserved set only. One gate
  now — `isUsablePackFolderName`, asked by install AND rename — covering separators (incl. `\`,
  which the Storage seam would silently turn into a subfolder), the characters Windows reserves,
  control characters, a trailing dot or space, and the DOS device names. Unusable names from a repo
  are corrected rather than hidden (`sanitisePackFolderName`).
- `[ ]` **WITHDRAWN — not a defect.** I reported `NodeStorage` as having no sandbox guard and that
  is wrong: it resolves and then checks the result is inside its root (`node.ts:17-23`), which
  contains just as well. It does not share `sandboxRelative`, so it accepts paths the seam rejects
  (`a/../b` resolves back inside), but nothing escapes. SECURITY.md §3's note was corrected to say
  this rather than claim a hole.
- The local folder name is validated only against `''`, `/` and the reserved set
  (`remote/updates.svelte.ts:580`). `\`, `:`, `*`, `?`, `<`, `>`, `|`, control characters, a trailing
  dot or space, and the Windows device names (`CON`, `NUL`, `AUX`, `COM1`) all reach `mkdir` and
  throw there — see finding 5 for what that then costs.

### [x] 9. Provenance never reaches the user, and there is no per-PACK filter

`LoadedRow` carries `root` (the pack) all the way through the loader, and the UI drops it:
`entryMeta` shows the `source` label only, and the two-dimensional filter is file × source with **no
pack dimension**. So a pack cannot be switched off without deleting it, and cannot be told apart
from a pack claiming its tag.

Not a defect standing alone — it is the mechanism finding 1 exploits.

**Fixed, both halves.** The article's attribution line names the pack beside the friendly label
(`Source: D&D 5.5e · srd-2024`), and `SourceManager` groups by `(pack, source)`: the PACK heads the
group and carries the switch, while the source tag sits beside it as a secondary pill that still
toggles that tag everywhere it appears. Two packs claiming one tag are therefore two rows with two
switches, which is the whole point. The pack switch is built on the existing FILE dimension
(`setFilesEnabled` over `content/<pack>/…`) rather than a third stored dimension — a pack IS its
folder, `renameFileRoot` already moves those paths, and nothing new has to be persisted or migrated.
Verified in the running app (`design-preview/sources-pack-groups.png`).

---

### [x] 10. `download` mode has no AGGREGATE budget

The caps are per pack (200 files / 50 MB) and per repo (50 packs). Nothing bounds ONE CHECK: fifty
packs of fifty megabytes across several repos is an automatic multi-gigabyte download in `download`
mode, which is the mode whose whole promise is "we fetch ahead of time so applying is instant". The
per-pack ceiling reads like a total and is not one.

**Fixed:** `MAX_PREFETCH_BYTES` (100 MB), one `PrefetchBudget` per check run, threaded through
`checkOneRepo` into `stagePackUpdate` and spent per file as it lands. Deliberately spent rather than
estimated up front: a tree listing may state no sizes, and an estimate that reads zero is not a
budget. Running out stops the FETCH, not the offer.

### [ ] 11. A registry write that fails is swallowed, so a PIN can silently not exist

`writeConfigSection` (`storage/json-config.ts`) ends `.catch(() => {})`, deliberately — "a config
failure must not crash the session". But the pack registry is a tenant of that file, and its
contents are promises to the user: a pin says *don't change these rules mid-campaign*. If that write
fails (disk full, permission, the data dir moved out from under it) the in-memory `$state` still
shows it pinned, the UI agrees, and the next launch quietly does not.

**Decided 2026-08-12 (maintainer):** the user has to be told what happened and what to do about it,
so this is not a log line — it surfaces in the pack panel.

### [x] 12. `restoreBundledPacks` writes outside both rules the other writers obey

`provider.ts:150` copies every bundled file over whatever is there: no `duringPackWrite` flag (so a
watcher reload can build a graph from a half-restored pack, and `forgetUninstalledPacks` can run mid-
write), and no `isProtectedFromOverwrite` check — which its sibling `seedShippedContent` applies
carefully, and which the memory rule "an unstamped or drifted file is never overwritten" states
without exception.

Harmless TODAY only because restore is offered for a pack that is entirely absent, so there is
nothing to clobber. That constraint is written down nowhere, and the function does not enforce it.

**Fixed:** the copy runs inside `duringPackWrite`, and skips any file that is protected from
overwrite — the same rule the seed obeys, so "a hand-edited file is the user's" now has no writer
that ignores it.

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

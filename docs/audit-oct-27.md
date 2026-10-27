# Audit — 0.8.2 (2026-10-27), with the 0.8.1 security audit (2026-10-22)

Two reads of the tree. The 0.8.1 audit (`S1`–`S7`) looked for vulnerabilities only. The 0.8.2 audit,
on `dc5f4a06`, also looked for bugs: rules, play state, data loss, content packs, and UI state. What
the first one closed is not repeated in the second unless the fix proved incomplete.

The threat model is `internals/security.md`: content and packs are untrusted, the page is the thing
being contained, and the Rust side decides what the page may reach.

How 0.8.2 was read: seven zones in parallel. Every finding was confirmed by a throwaway test, a
Playwright drive, or an unambiguous code trace, and the most important ones were re-read by hand.

- **CONFIRMED** — reproduced by a probe, or traced with no gap.
- **LIKELY** — the code does exactly this, but the rule cannot be checked (the shipped SRD carries
  no "Combat" or "Resting" chapter, only data CSVs), or the behaviour needs the real desktop app.

Each finding says **closed** with the test or probe that holds it, or **open** with the tracker item
it now lives in (`work/*.md`).

---

## Priorities at 0.8.2

1. A player loses their own rule edits after "Yes, keep my changes", or after saving a translation (D1).
2. On first run the chosen folder is ignored for the whole session, so characters "vanish" after a
   restart (D2).
3. Editing or forking an article with two or more effects breaks its mechanics (D3).
4. A deleted character comes back (D4). Deleting a hand-copied character folder deletes the original (D5).
5. A character stops saving once a fractional number reaches play state: temp HP 2.5, dice-based
   resource recovery (D6).
6. Rules: Wizard, Sorcerer and Monk are trained in every armour (R1). A Dwarf in heavy armour loses
   speed (R2). Paladin 1 / Ranger 1 gets spell slots (R3).
7. Combat: entering combat resets the round, so timed effects live longer (R4). The second damage
   type of a blow that drops a character to 0 HP records a death-save failure (R5).

---

## D · Player data: loss and corruption

### D1 · Edits to an SRD file are silently overwritten by the next update — high · CONFIRMED

A player opens an SRD CSV in Excel and writes a house rule (`8d6` → `10d6`). On launch the app says
"This is allowed, nothing is lost… Yes, keep my changes", and the player agrees. The next app seed or
pack update silently replaces the file. A pack keeps one `.prev` generation; only translation cells
carry over, the house rule does not.

A second path needs no dialog: saving a translation of any row in such a file restamps the whole file
(`translate.ts` ▸ `patchRowColumns`). The drift disappears, and the protection with it.

Why: "the user's file" and "the file drifted from its stamp" were one fact. Restamping (`restamp.ts`,
`review.svelte.ts` ▸ `autoAdoptDrift`) made the file "pristine" again for `isProtectedText`
(`disk.ts`), so the seed (`provider.ts`) and the pack diff (`remote/diff.ts`) both treated it as
replaceable. Probe: edit → `restampText` → seed v2 gave `preserved: []`, edit gone.

Fix direction: adoption is its own fact in the stamp (`#content-adopted`), and `isProtectedText`
honours it. Saving a translation does not clear it.

### D2 · First run: the chosen folder is ignored for the whole first session — high · fixed, desktop check owed

The player picks their own folder on first run and creates characters. After a restart the folder is
empty, and everything from the first session sits in `Documents/charnik`.

Why: the roster mounts behind the first-run modal and calls `loadRoster()` at once
(`routes/+page.svelte`). `TauriStorage` computes its root once and caches it (`#root ??=`). No pointer
exists yet, so `<Documents>/charnik` is cached. `confirmDataDir` (`+layout.svelte`) saves the pointer
but never calls `resetUserStorage()`, and `loadContentStore()` without `remount` does not reopen
storage. Nobody sees an error, because `Documents/charnik` is in the static scope.

**Fix:** `confirmDataDir` calls `resetUserStorage()` right after `setDataDirOverride`, then reloads
the roster from the chosen folder. **Not yet run on the desktop app:** first run, pick another folder,
create a character, restart. The demo the roster seeded into `Documents/charnik` behind the modal stays
there.

### D3 · Editing or forking an article with several effects breaks its mechanics — high · closed

`rowToDraft` (`homebrew.ts`) joined arrays with `,`, while `effectsField` (`schema-cells.ts`) splits
effects on `;`. So `["adv:attack", "speed:+10"]` became one unknown token `adv:attack,speed:+10`, and
the bonuses turned into a text note.

**Fix:** `effects` is joined with `EFFECT_TOKEN_SEPARATOR`, the one `effectsField` splits on. **Held
by** `homebrew.test.ts` ▸ a row with several effects keeps every one through rowToDraft → upsert →
parse.

### D4 · A deleted character comes back — high · closed

Delete the last character and open Combat: about a second later the character is back in the roster
(1 → 0 → 1).

Why: the `combat` singleton's "no active character" branch did not clear `this.character`
(`combat-view-model.svelte.ts`). The autosave `$effect` (`combat/+page.svelte`) scheduled
`saveCharacterGuarded` of the old object on mount. The `checked` mode compares only against a file
that exists (`repository.ts`), so a missing file is simply written again. Besides, `deleteCharacter`
was not on the character's queue: a save queued after a delete recreated the file, and a late
`appendLog` left a folder with a lone `log.jsonl`.

**Fix:** `load()` drops the previous character when none is active. `deleteCharacter` runs on the
character's queue and remembers the slug, so a play save of a copy that was on disk (rev ≥ 1) and a
late log line write nothing; a new character reusing the slug still saves. A play save into a held
file that vanished outside the app is a conflict, not a silent rewrite. **Held by**
`character.test.ts` ▸ a deleted character stays deleted, and ▸ a play save into a file removed
outside the app asks; a Playwright drive (open → delete → Combat → roster) stayed at 0.

### D5 · A hand-copied character folder: deleting the copy deletes the original — medium · CONFIRMED

`characters.md` calls copying a folder by hand a normal case. But copying `bob-a1b2/` to `bob-copy/`
showed two `bob-a1b2` in the roster; edits to the "copy" went into the original; deleting the copy's
row deleted the **original** with its backups. A folder renamed by hand did not open at all
(`not found`).

Why: the save path came from the `id` inside the file (`repository.ts`), and the roster used `c.id`
rather than the folder name. Fix direction: bind `id` to the folder name on every read, as backup
restore already does.

### D6 · A fractional or infinite number in play state blocks every later save — medium · closed

- **Temp HP field** (`setTempHp`, `play/hit-points.ts`) did not round: `2.5` or `1e999` (`Infinity`)
  were stored as is.
- **Dice-based resource recovery** (`effects/recharge-amount.ts`) did not round its flat part:
  `dawn(1d4+level/2)` gave 5.5 uses, `per_slot(1d6+inf)` gave `NaN`.

The schema requires `int`, and `saveCharacter` refuses an invalid character, so every save after that
was refused with a toast.

**Fix:** temp HP is rounded and an infinite one refused; a recharge count is floored and an infinite
one restores nothing. **Held by** `hit-points.test.ts` ▸ temp HP stays a whole number the save can
hold, and `recharge-amount.test.ts` ▸ gives back whole uses.

### D7 · Unknown character fields vanish on the next save — medium · CONFIRMED

`characterSchema` was a plain `z.object`, and zod 4 strips unknown keys. A hand-written `notes` or
`build.backstory` vanished on the first autosave. The dangerous case: a newer build adds a field
without raising `schemaVersion` (additive changes do not raise it), and an older build on a second
machine, over a synced folder, opens the file and erases the field with no conflict.

### D8 · "Undo update" on a pack discards everything changed since — medium-high · CONFIRMED by trace

`rollbackPack` (`install.ts`) moved live → `.new`, then `.prev` → live, then deleted `.new`. `.prev`
lives until the next apply, possibly months. One click with no confirmation
(`PackUpdatesSettings.svelte`) discarded every translation, edit and note made since.

### D9 · An unclosed quote in a CSV silently swallows every following row — medium · CONFIRMED

One stray `"` in an Excel cell and every row below it disappeared from the compendium, with nothing in
Content Health. `parsed.errors` from Papa was read nowhere (`loader.ts`, `homebrew.ts`,
`translate.ts`, `locale-merge.ts`, `remote/diff.ts`). Worse, saving a translation or homebrew in such
a file wrote the broken parse back to disk. Extra cells in a row and a second column with the same
header were lost the same way.

### D10 · One locked file stops all content from loading — medium · CONFIRMED for reads, LIKELY for Excel

After an app update with an SRD CSV open in Excel, launch showed the content error screen until Excel
was closed.

- `loader.ts` read files through `Promise.all`, so one `EBUSY` cancelled everything (confirmed).
- The seed (`provider.ts`) threw out of `buildGraph` when a rename hit an open file.
- `storage/tauri.ts` ran `stat` on a file that vanished during the listing.

### D11 · A demo folder without `demo-seeded.json` breaks roster and combat on every launch — medium · closed

It happens when only `characters/` is moved to a new folder. `seedDemoIfFirstRun`
(`store.svelte.ts`) saved a fresh demo at rev 0 in `checked` mode over a `karroth` at rev ≥ 1 and got
a `CharacterConflictError`. The data was intact, but the app was blocked.

**Fix:** a demo folder that exists only gets the marker. **Held by** `store.test.ts` ▸ a played demo
in a folder that lost its marker is kept.

### D12 · Editing a homebrew row in the UI erased its own extra columns — medium · closed

`upsertHomebrewRow` (`homebrew.ts`) built the row from `row.data`, from which the strict schema had
already dropped extra columns: `my_notes = KEEP ME` came back empty after an edit.

**Fix:** the edited row is laid over the file's row. **Held by** `homebrew.test.ts` ▸ an edit keeps
the file's own columns that the form never saw.

### D13 · Smaller — low

- **No flush on window close.** `onBeforeReload` covers reload only; closing the app inside the 800 ms
  combat debounce (600 ms for a draft) lost the last edit. LIKELY.
- **Orphan draft after Create** (`build-view-model.svelte.ts`). An autosave landing after
  `discard()` / `renew()` wrote the finished build under a new guid. Mechanism CONFIRMED, timing
  LIKELY.
- **Moving the data folder did not wait for the character queues** (`StorageSettings` ▸
  `settleBeforeSwap`). A late save went to the old folder, which is then deleted. LIKELY.
- **Atomic write without fsync** (`tauri.ts`). A power loss can leave a zero-length
  `character.json`, and `*.tmp-*` files were never cleaned up. LIKELY, desktop only.
- **The old portrait was deleted before the new one was safe** (`repository.ts`). If the write
  failed or the save lost a conflict, `character.json` pointed at a file that no longer existed.
- **The folder pointer and `plugins.json` were written non-atomically** (`std::fs::write` in
  `lib.rs`, `plugin_consent.rs`). A crash mid-write opens the app on first run, or drops every plugin
  consent. Both fail closed, but the data looks lost.
- **Startup recovery** (`provider.ts`, `install.ts`) removed or renamed ANY `content/*.prev` or
  `*.new` folder, even one the user made. It should touch registered packs only.
- **`reload.ts`** · closed. If a flusher rejected, the error was logged but `location.reload()` still
  ran, with no toast. A failed flush now holds the reload back and says so (`reload.test.ts`).
- **`buildAndSwap`** (`install.ts`) deleted `.prev` before the swap; a failed swap lost the undo copy
  too.
- **`renamePack`** (`pack-lifecycle.ts`). An exception after the folder rename left the registry on
  the old name, and `forgetUninstalledPacks` then lost the URL and pin.
- **The seed matched files by path, not by `#content-id`.** A renamed SRD file was seeded beside
  itself, giving duplicate ids; a file deleted from the pack came back with the next seed.
- **Case and nesting.** Upper-case `.CSV` files were ignored with no health entry. CSVs in subfolders
  of a remote pack were installed but never loaded.
- **The web demo did not ask for `navigator.storage.persist()`**, so the browser could evict the
  IndexedDB with the characters in it.
- **Two demo tabs.** Config sections (pack pin, source toggles) are last-writer-wins
  (`json-config.ts`). Characters are covered by the conflict check; only a millisecond race remains.

---

## R · Rules and combat: the number the player sees

Where the rule is in the shipped SRD, the quote is from `charnik-content-srd`.

### R1 · Wizard, Sorcerer and Monk are trained in every armour — high · CONFIRMED · both editions

A Wizard 1 in plate had AC 18, and the "cannot cast in armour you are not trained in" block did not
fire for the class it matters to most. A Wizard multiclass made the whole character "unconstrained".

Why: `armor_profs` is empty on the `wizard`, `sorcerer` and `monk` rows of both `classes_srd.csv`.
`parseProfGrants` read an empty cell as `UNCONSTRAINED` (`rules/proficiency.ts`), and
`gatherProfGrants` absorbed the union into it.

### R2 · A Dwarf (2014) in heavy armour loses 10 feet of speed — high · CONFIRMED · 5e

SRD (`srd-2014/species_srd.csv`, dwarf): "Your speed is not reduced by wearing heavy armor."
A Dwarf Cleric with STR 10 in chain mail had speed 15 instead of 25. The −10 was a hard-coded
contribution (`character/derive-stats.ts`) no effect could cancel.

### R3 · Paladin 1 / Ranger 1 (2014) gets slots and a prepare limit — high · CONFIRMED · 5e

SRD: `paladin_spellcasting` and `ranger_spellcasting` are level-2 features, and `half_1` is all
zeros. Multiclassing: "Once you have the Spellcasting feature from more than one class". Caster level
0 was clamped to 1 in `slotCountsFor` (`rules/spellcasting.ts`), so the character got two 1st-level
slots. A lone Paladin 1 (2014) also had a prepare limit of 1 and a DC/attack profile with no slot.

### R4 · Entering combat resets the round to 1, so timed effects grow younger — high · CONFIRMED · both

Bless cast in round 7 for 10 rounds showed 16 rounds left after leaving and re-entering combat.
`toggleCombat` wrote `round: 1` (`play/turn.ts`), and `remainingRounds` counts from `startedRound`
(`combat/effects-view.ts`).

### R5 · The second damage type of a blow that drops to 0 HP records a death-save failure — high · CONFIRMED in code, LIKELY by rule

"15 slashing plus 7 fire" against a fighter on 10 HP is two Damage presses (`characters.md`: one
press, one type). The second saw `before === 0` and recorded a failure (`play/hit-points.ts`). Massive
damage was not summed across the parts of one blow either: with max 44, remainders of 22 + 22 did not
kill. SRD 5.1 has 63 monster attacks of the form "… plus N (XdY) <type>".

Decision: the existing "this was one blow" merge (`mergeOwedConcentrationSaves`) also takes back the
failure and checks massive damage against the sum. One press stays one type.

### R6 · A long rest ends concentration but leaves the spell's effect — medium · closed · both

SRD 5.1 (hunters_mark): "…you can maintain your concentration on the spell for up to 24 hours."
`longRest` wrote `concentration: null` directly (`play/rests.ts`) instead of calling
`endConcentration`, so the `hunters_mark` effect stayed on the character.

**Fix:** `longRest` calls `endConcentration`. **Held by** `resources.test.ts` ▸ a long rest fills hit
points, ends concentration…, whose 24-hour spell effect goes with it.

### R7 · A rest does not advance the clock — medium · CONFIRMED

`rests.ts` dropped effects with ≤ 1 h or ≤ 8 h left but did not add `restRounds` to `play.round`. A
24-hour effect still had 14400 rounds after three long rests.

### R8 · An ASI or half-feat raises a score above 20 — medium · CONFIRMED · both

SRD 2014 ASI: "you can't increase an ability score above 20 using this feature". 2024: "This feat
can't increase an ability score above 20" and "to a maximum of 20". STR 19 plus two ASIs gave 23, and
the builder offered +2 on a 19 (`routes/build/ability-allocation.svelte.ts`, `FeatPane.svelte`).
Epic Boons keep their cap of 30.

### R9 · A Warlock multiclass cannot spend a Pact Magic slot — medium · CONFIRMED by trace · 5e (5.5e LIKELY)

SRD 5.1: "you can use the spell slots you gain from the Pact Magic feature to cast spells you know or
have prepared from classes with the Spellcasting class feature…". `pactSpend` fired only when no
ordinary pool existed (`rules/spellcasting.ts`).

### R10 · Jack of All Trades (2014) does not apply to plain ability checks — medium · CONFIRMED (initiative LIKELY) · 5e

SRD: "…to any ability check you make that doesn't already include your proficiency bonus." A Bard 2
had a STR check of +0 instead of +1; the content row carried only
`grant_proficiency:partial:skills`. Initiative (`rules/core.ts`, `derive-assemble.ts`) got no half
bonus from JoAT or Remarkable Athlete either.

### R11 · Nested conditions are not expanded, and the shipped SRD needs them — medium · CONFIRMED

Unconscious imposes Incapacitated and Prone; Stunned, Paralyzed and Petrified impose Incapacitated.
The ids reached `state.conditions`, but the child conditions' tokens were not applied and no issue was
raised (`effects/resolver.ts`). So in 2024 Stunned did not show "Your Concentration is broken" or
disadvantage on initiative. `effects.md` documented ONE level.

### R12 · Resistance and vulnerability to one type double the damage — medium · closed

`combat/defense.ts` checked vulnerability first and ignored resistance: 7 fire became 14. RAW halves
first, then doubles: 3 → 6.

**Fix:** RAW order. **Held by** `helpers.test.ts` ▸ halves before doubling a type it both resists
and is vulnerable to.

### R13 · Rests, healing and Hit Dice work on a dead character — low-medium · CONFIRMED

A dead character after a long rest had full HP with `death` still set; `takeBackLastSave` then
refused, so a mistaken third failure could only be undone by revive. Where: `rests.ts`,
`spendHitDie`, `heal`, `halfShortRest`.

### R14 · Smaller — low

- **Size and carrying capacity.** Capacity is always STR×15 (`rules/core.ts`): the 2024 Goliath's
  "count as one size larger" is ignored. The SRD folder carries no multiplier table, so the multiplier
  is LIKELY.
- **Multiclassing.** 2024 half-casters in a multiclass probably round up (`rules/spellcasting.ts`, no
  `caster_share` on 2024 rows). Proficiencies on entering a multiclass are granted in full (Wizard →
  Fighter gets heavy armour). Multiclass prerequisites are checked nowhere (`primary_ability` is
  unused). The 1-HP minimum is checked in total, not per level. All LIKELY: the SRD folder has no
  multiclass tables.
- **Dice.** `1d0` rolled 1 (`rules/dice.ts`) instead of being flagged. The tray had no dice cap per
  line (`dice/roller.ts`): millions of dice froze the tab.
- **Resources and rituals.** `regainResource`, partial recovery in `rest()` and `passBoundary` read the
  raw `spent` counter, not the clamped one (`resources.ts`, `rests.ts`). A ritual cast in combat still
  took an Action (`cast.ts`).
- **A one-press attack with a natural 20** wrote ordinary damage, and there is no "×2 crit" fix-up on
  already-written damage (`routes/combat/sheet-rolls.svelte.ts`). `roller.md` settles that a crit is
  not inferred from a 20, so this is a suggestion only.
- **Division of negatives rounds towards −∞.** `speed-level/2` at level 3 gave −2 instead of −1
  (`token-parser.ts`). No SRD token does this; the RAI belongs in `effects.md`.

---

## U · UI state

### U1 · Combat stays on "no character" after a character is created — high · closed

`noCharacter` was set to true and never reset (`combat-view-model.svelte.ts`). After Create through an
SPA `goto`, or opening from the roster, the empty state stayed until a reload.

**Fix:** `load()` resets it first. **Held by** a Playwright drive: empty Combat → a character restored
client-side → opened from the roster → the sheet, not the empty state.

### U2 · The edition switch in level-up shows but does not save, and the dropped picks are lost — high · CONFIRMED

In level-up the player pressed 5.5e and accepted "you will lose these picks". After Create the
character was still 5e, and the species, background or spells the switch removed were gone
(`BuildHead.svelte`, `repository.ts` ▸ `mergeBuildOver` takes `system` from disk). Converting between
editions is out of scope (`AGENTS.md`), so in edit mode the switch is disabled and shows the bound
edition.

### U3 · The combat singleton carried the previous character's transient state — medium · closed

Carried across characters: `hp.owedConcentrationSaves` (the new character got a concentration save
prompt), `rolls.savagePending` and `savageUsedRound`, `rests.hdPick`, `casting.upcastSpell`,
`executor.asking`, `forms.asking`, `menus.overlay`, `inventory.shotPending`, `resources.windowWas`.

**Fix:** `load()` forgets all of them (and `casting.enchanting`) whenever the character changes. Held
by code reading only: the view-model has no unit harness.

### U4 · Save errors are silent — medium · CONFIRMED

- try/finally with no catch (a disk error became an unhandled rejection and the button just reset):
  `EditContentForm.svelte`, `compendium/[...entry]/+page.svelte`, `NoCharacter.svelte`,
  `MissingContentModal.svelte`, `FirstRunModal.svelte`, `ContentHealth.svelte`,
  `PackUpdatesSettings.svelte`, `+layout.svelte`.
- Themes swallowed errors (`ThemesSettings.svelte`, `.catch(() => {})`), and one shared `saveTimer`
  cancelled saving one theme when another was edited.
- Floating calls with no handling: `+page.svelte` (delete a draft or a character),
  `combat-view-model.svelte.ts` (`appendLog`, `reviseLog`), `PackUpdatesSettings.svelte`,
  `translate/+page.svelte`, `EditContentForm.svelte`.

### U5 · "Cast" and "Pin" in the Spellbook do not do what they promise — medium · CONFIRMED

Cast only showed a toast: no slot spent, no dice rolled. Pin was a local `Set` that vanished on
navigation and was not tied to `ui.spellsPinned`. The hard-coded `['fire-bolt','shield']` did not even
match the ids (`fire_bolt`). The toast showed `name_en`.

### U6 · Clicking a broken character in the roster opens a different one — medium · CONFIRMED

When `openCharacter` returned null, `ensureActiveCharacter` silently took the demo or the first one
(`+page.svelte`, `store.svelte.ts`). Likewise `?levelup=<broken>` turned into a new blank draft.

### U7 · One-way doors — medium · design

- **Removing an inventory row** (`InventoryPanel.svelte`) had no confirmation, and adding it back lost
  the quantity, attunement and answers.
- **Short and long rest**, dawn and dusk had no undo.
- **Deleting a custom theme** (`ThemesSettings.svelte`) had no confirmation.

### U8 · Smaller — low

- **Autosave debounce.** Switching character within 800 ms lost the previous one's save
  (`combat/+page.svelte`) — closed: the pending character is saved at once when another replaces it.
  Translation behaves the same, per row (`translate/+page.svelte`) — open.
- **`readLog`** · closed. It took `JSON.parse(line) as LogEntry` unchecked: a `null` line broke
  `combat.load`. Non-object lines are skipped (`character.test.ts` ▸ appends and reads newest-first).
- **`Turnbar.svelte`:** `role=button` inside a `<button>`, a nested interactive element.
- **Raw `name_en` in the reader's language:** `compendium/[...entry]/+page.svelte`, `spellbook`,
  `mastery-picks.svelte.ts`, `EditContentForm.svelte`, `OrphanDialog.svelte`.
- **Hard-coded English:** `'level ' + c.level` (`+page.svelte`), `` `${name} copy` ``
  (`ThemesSettings.svelte`), `'uk'` as default (`translate/+page.svelte`), slot refusals
  (`rules/spellcasting.ts`).
- **About 500 px literals in `<style>`**, most in `EditContentForm`, `HpPanel/DownSide`,
  `SpellsPanel` and `CombatMenus`.
- **A homebrew sense named `constructor` or `toString` vanished**, since `??=` ran on `{}`
  (`derive-stats.ts`).
- **Search snippet highlighting drifted** on text like `İ`, because `toLowerCase` changes length
  (`search-fold.ts`).

---

## S · Security

### From 0.8.1

#### S1 · `dialog:default` let page script widen the fs scope past `GrantedDirs` — medium · closed

The capability granted the dialog plugin's `open` and `save`. In `tauri-plugin-dialog` 2.8.2
(`src/commands.rs`), every folder or file picked through them goes straight into the fs plugin's
runtime scope (`allow_directory(path, options.recursive)` / `allow_file`), bypassing `pick_data_dir`,
`GrantedDirs` and `is_grantable`. A picker that page script words itself ("Choose your portrait",
opening on the home folder with `recursive: true`) would hand the page that whole folder for the
session. No front-end code used the plugin; Rust draws every dialog the app shows.

**Fix:** the permission is gone from `capabilities/default.json`. **Held by** `/dev/page-reach`, which
on the desktop app gets `dialog.open not allowed` for `open`, `save` and `message`.

#### S2 · Prose could request a remote image through `background` — low (CSP held) · closed

DOMPurify keeps the legacy `background` attribute by default, and Chromium still loads it as an image
on a `<table>` or `<td>`. The `PROSE_POLICY` hook covered `src`, `poster`, `href` and `xlink:href`,
so `<table background="https://evil.example/t.png">` survived sanitising, and `img-src` was the only
thing stopping the load.

**Fix:** `background` is in `FORBID_ATTR`. **Held by** `markdown.browser.test.ts` ▸ loads only what
travels with the page.

#### S3 · A plugin could swap `globalThis.JSON` and hide that it read `ctx.play` — low · closed, see S11

`Object.freeze(JSON)` freezes the object, but the global binding stays writable in quickjs-ng. The call
wrapper resolved `JSON` on every call, so a `main.js` replacing it could report `playRead: false` for
a handler that read `ctx.play`, and the memo then served its result across every play-state change.
Nothing escaped the sandbox; the plugin's own numbers went stale.

**Fix:** `SETUP_SCRIPT` pins the `JSON` and `Math` bindings non-writable and non-configurable.
**Held by** `plugin-sandbox.test.ts` ▸ a plugin cannot swap the global JSON.

#### S4 · `dompurify` 3.4.16 sat behind three advisories — unreachable · closed

GHSA-cg2g-xh64-v4q7 (`SAFE_FOR_TEMPLATES` with DOM output), GHSA-mrv2-3pqr-j5jr (`IN_PLACE`),
GHSA-c6gr-qvv4-5v3f (xhtml parser). `markdown.ts` uses none of those modes. **Fix:** `^3.4.17`.

#### S5 · Dev-only advisories — closed where a patch exists

`@vitest/mocker` < 4.1.12 (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp) let anything reaching the
browser-test server register a mock while `pnpm test` runs; the vitest family is `^4.1.12`. `braces`
≤ 3.0.3 (GHSA-vfj7-8cjw-p6xm) has no patched release — `work/release.md` ▸ DEP-2.

#### S6 · A middle click on a prose link opened the remote page in a new window — medium · closed

The layout's link handler listened for `click` only, and a middle click fires `auxclick`. Tauri 2.12
installs no new-window handler unless given one, wry 0.57 leaves WebView2's `NewWindowRequested`
unhandled, and WebView2's default opens the request in a popup of its own.

**Fix:** the handler takes `auxclick` from the middle button. The main window is built in Rust
(`lib.rs` ▸ `open_main_window`, `create: false` in the config) with an `on_new_window` that refuses
every request and sends an http(s) one to the OS browser. **Held by** `/dev/page-reach` on the desktop
app. See S15 for the same-window path.

#### S7 · A pack name from config reached a recursive delete unchecked — low · closed

`parsePackConfig` took any key, and `uninstallPack` checked only `isReservedPackName`, which passes
`''`. An entry keyed `''` would offer an Uninstall that runs `storage.remove('content/')`.

**Fix:** `parsePackConfig` drops `packs` and `pending` keys that fail `isUsablePackFolderName`, and
`uninstallPack` refuses such a name. **Held by** `packs.test.ts` and `updates.test.ts`. The 0.8.2 read
found the fix complete.

### From 0.8.2

No sandbox escape and no write outside scope. Everything below is a hang from foreign content, a
bypassed check, or an incomplete fix.

#### S8 · Importing a long-named theme twice: an infinite loop — medium · closed

`slugifyThemeName` cut to 40 characters, `isSafeThemeId` allowed up to 41, and the candidates
`<40>-2`, `<40>-3`, … are 42+, so the `while` in `uniqueThemeId` (`styles/themeFiles.ts`) never ended.
On desktop the same path runs through `loadThemeFiles` → `themeFromJson`, so two such files in
`themes/` would hang every launch (traced, not run on desktop).

**Fix:** the stem is cut to make room for the suffix. **Held by** `themeFiles.test.ts` ▸
uniqueThemeId ends for a name that fills the whole id.

#### S9 · ReDoS in the token parser's whitespace normalisation — medium · closed

`tightenDelimiters` (`effects/token-parser.ts`) ran `/\s*([:,])\s*/g`, quadratic in the run length:
40 k spaces took 1.3 s, a ~1 MB cell took minutes. CSV trims only the token's ends.

**Fix:** split on the delimiters and trim each part, which is linear. **Held by**
`whitespace-tolerance.test.ts` ▸ a long run of spaces parses in linear time (33 s before the fix).

#### S10 · Starting-equipment counts are unbounded — low-medium · CONFIRMED

A pack row `300000000*any.martial` froze the builder as soon as a class was picked: `picksOwed` alone
ran 273 s and the pane tried to render 3×10⁸ `<li>`. A saved draft froze it again. A 400-digit count
gave `Infinity` and a ZodError on click (`content/starting-equipment.ts`, `starting-kit.ts`,
`StartingEquipmentPane.svelte`). Also: `kitItemsById` took the first in load order, so a homebrew fork
of `longsword` lost to the SRD in kits.

#### S11 · The S3 fix is incomplete: a plugin can still hide a `ctx.play` read — low · closed

`playRead` was captured while the result object was built, and `JSON.stringify` then ran the result's
getters and `toJSON` (`effects/plugin-sandbox.ts`). Both variants (`get notes(){…ctx.play.hp…}` and
`toJSON`) returned a value for HP 41 and then for HP 5. Same consequence as S3.

**Fix:** the result is stringified before the flag is read. **Held by** `plugin-sandbox.test.ts` ▸ a
play read hidden in the result's getter / toJSON still counts.

#### S12 · DOM clobbering: an `id` in prose makes the web build think it is desktop — low · CONFIRMED switch, LIKELY effects

`'__TAURI_INTERNALS__' in window` was checked on every call (`storage/platform.ts`). DOMPurify keeps
`id` and `name`, so a browser probe showed `web → desktop` while such prose was on the page. While the
flag is wrong, `isReadOnlyContent()` is false, `reloadContent()` takes the desktop `buildGraph` branch
and seeds the pack into IndexedDB, and Settings shows desktop controls. On the hosted demo only the
player's own prose can do it; a self-hosted web build also takes pasted homebrew.

#### S13 · A deep dependency chain overflows the stack — low · CONFIRMED in node

A chain of about 8000 resource tokens threw `RangeError` in the recursive Tarjan
(`effects/dependency-graph.ts`). `deriveSheet` has no try/catch and `src` has no `svelte:boundary`, so
the `$derived` in the builder, combat and Spellbook fell over.

#### S14 · Smaller — low / info

- **Dice finiteness.** The flat part of dice in an expression skipped the finiteness check
  (`expression-evaluator.ts`): `1d6+inf` showed "+Infinity", `(1d6+inf)*0` silently became 0.
- **Plugin tokens.** Ability tokens a plugin returns were silently ignored
  (`character/derive-plugins.ts`, no issue).
- **Plugin error length** · closed. The error text was cut with the sandbox's own
  `String.prototype.slice` (`plugin-sandbox.ts`), so a plugin returned 40 k characters. It is cut on
  the host.
- **Plugin restart.** A restart after a limit hit is not counted against the derive budget, and the
  three-failure counter resets on a run of successes (`plugin-sandbox.ts` ▸ `callPlugin`). Not
  measured.
- **Prototype names.** The expression parser accepted `Object.prototype` names (`constructor(1)`,
  `__proto__`) as valid (`expression-parser.ts`). They failed at evaluation, so nothing leaked.
- **`remote.rs`** accepted userinfo (`user:tok@api.github.com`) and non-default ports. Harmless for a
  GET to a pinned host, but cheap to refuse.
- **Demo isolation.** The web demo lives at `<owner>.github.io/<repo>` and shares IndexedDB and
  localStorage with the owner's other Pages sites.

#### S15 · Main-window navigation is held back by JS alone — low · LIKELY (Linux)

`lib.rs` has `on_new_window` but no `on_navigation`. The only guard against a left click on an outside
link replacing the app is a capture listener (`+layout.svelte`). `util/links.ts` used `URL.parse`,
which WebKitGTK lacks before 2.46: on older Linux the listener throws before `preventDefault`, and the
outside page opens in the app window — S6 back. Not run on Linux.

#### S16 · Dependencies

| Package | Advisory | Reach | Action |
|---|---|---|---|
| `zod` 4.6.5 (direct) | GHSA-mrhx-c7xc-m3w5, high: memory exhaustion on large bounded collections | Validates characters, content rows, plugin results; input size bounded by file caps and QuickJS 8 MB | `^4.6.6` |
| `@sveltejs/kit` < 3 | GHSA-pfhg-q3qv-9q6r, GHSA-27mw-82g8-phjj, low | Static adapter, no form actions, no server headers | tracker, move with 3.x |
| `fast-uri` < 4.2.3 | four advisories | dev only, under `stylelint` | override |
| `zip` 4.6.1 (Rust) | RUSTSEC-2026-0367/0368/0369 | DEP-3 | none |
| `tokio` 1.53.2 | RUSTSEC-2026-0386, unsound `AsyncFd` | Unix-only API our code does not call | warning only |

---

## Docs this audit proved wrong

- **Locale catalogs.** `internals/security.md`, the comment in `content/markdown.ts` and
  `+layout.svelte` said a user can drop in their own catalog. No loader exists: only catalogs built in
  at build time. The 0.8.1 "not yet checked" item about such catalogs is therefore unreachable.
- **Nested conditions.** `internals/effects.md` settled one level; the shipped SRD needs two (R11).
- **Hand-copied folders.** `internals/characters.md` called a hand-copied character folder normal;
  the code was not ready (D5).
- **AUDIT-DRIFT** in `work/release.md` said `pnpm audit` shows DEP-2 and nothing else; it now shows
  `zod`, `kit` and `fast-uri`, and no longer `braces` (S16).

---

## Ruled out

- **Rust commands.** All fifteen are declared in `build.rs` and listed in the capability.
  `set_data_dir` rejects `..` and anything not under a pick or the Rust-computed proposal.
  `apply_saved_data_dir` checks `is_grantable`. `open_app_dir` takes a name, not a path. The pointer
  and `plugins.json` sit in denied directories. `plugin_consent.rs`: validation, fixed path, mutex.
- **Remote fetch.** HTTPS only, to `api.github.com/repos/*` and `raw.githubusercontent.com`, every
  redirect re-checked. `..` and `%2e` normalise into the allowlist; punycode and trailing-dot hosts
  are refused. The body cap counts decompressed bytes as they arrive; connect and total timeouts are
  set. No credentials are sent.
- **Self-update.** Both commands take no arguments. Endpoint and key are compiled in; no updater or
  process permission is granted to the page.
- **Plugin consent and sandbox.** Native dialog with compiled-in words. `namespace` and `hash` are
  re-validated in Rust, enabling needs a standing consent, and the evaluated buffer is the hashed
  buffer. Expression depth and length caps, dice caps, division by zero, lazy `if()`, `inf` guards.
  Dependency cycles are reported. Plugin results are size-capped and zod-validated, values enter the
  wrapper through `JSON.stringify`, QuickJS handles are freed.
- **Storage seam.** `sandboxRelative` rejects `..` after normalising `\`. A drive letter or UNC prefix
  mid-path stays a plain component under Tauri's string-concatenating `join`. `walkTree` does not
  follow symlinks.
- **Pack install.** Remote folder names go through `freeLocalPackName`, which refuses reserved names,
  dot-names, staging suffixes and Windows device names. A tree path with `..` in either slash
  direction throws at the seam. Code installs only as `plugins/<ns>/{main.js,plugin.json}`. File-count,
  byte and per-response caps apply. Hashes normalise CRLF/LF, BOM and a trailing newline. Apply is
  compare-and-set with a SHA check; the three swap states recover; pending updates survive rename and
  uninstall; ids carry no `:`.
- **Themes.** `sanitizeThemeTokens` allows only an allowlisted token name and a value of
  `[a-zA-Z0-9#%.,()/\s-]` without `url(`, `@`, `/*` or `expression`. The id is a slug. The sheet is
  written via `textContent`.
- **HTML injection.** Every `{@html}`, `innerHTML` and `setAttribute` in `src/` goes through the
  sanitiser or a constant. `eval` and `new Function` appear only inside the QuickJS setup; `import(`
  takes fixed specifiers.
- **Links.** `javascript:`, `data:`, `file:`, mixed case, whitespace, `//host`, SVG `<a>`, `<area>`
  and MathML are cancelled. Only http(s) reaches the OS.
- **Prototype pollution.** zod 4 drops `__proto__`. No nested dynamic write takes both keys from a
  file. CSV values are strings.
- **`/dev/*` in a release.** The layout renders no child outside `dev`, and no dev route has a load
  function or a module script.
- **Portraits.** Decoded and re-encoded through a canvas at ≤ 512 px; the extension follows the blob.
- **Character save.** A queue per character. The conflict check compares bytes, so mtime granularity
  and same-size edits do not matter. A save does not echo back through the watcher. Migration and
  failed validation never write. Backups rotate and a restore is validated. Delete stays inside the
  folder. Rename on Windows replaces (`std::fs::rename`).
- **Moving the data folder.** Same folder and folder-inside-itself are refused. Order: copy → verify
  → repoint → delete.
- **The web CSP's `base-uri`** is `'none'`, as on desktop.
- **The Rust crates (`cargo audit`).** Fifteen patch releases were taken at 0.8.1; `zip` is DEP-3.
- **Rules.** Modifiers, proficiency bonus at levels 1/4/5/17/20, saves, skills, expertise, passives,
  spell DC and attack, cantrip tiers, AC (heavy and medium armour, Unarmored Defense with a shield),
  HP with retroactive CON, Hit Dice per edition, multiclass slots, Pact Magic, first-class saves, the
  encumbrance divergence. A value always equals the fold of its trace.
- **Combat.** Damage order (defences → temp HP → form → HP), healing, death saves on 20 and 1,
  stabilising, single-blow massive damage, concentration DC and the 2024 cap of 30, upcasting,
  exhaustion, recharge, crit dice doubling, advantage and disadvantage cancelling, no modulo bias in
  the RNG.
- **UI.** No Tauri above the seam. `base` on every link. Listeners are removed. `$derived` is pure.
  `$effect`s do not loop.

## Not checked

- **Real desktop only.** D2, the Excel lock in D10, fsync and the pointer in D13, S8 at startup, a
  junction in the data folder during a move.
- **S6 and S15** on Linux WebKitGTK and macOS; only WebView2 was driven, and there is no macOS build.
- **Table link** (`table_link.rs`, `lib/table-link`) — not in a release build. Its own design review
  is `research/table-link-*.md`.
- **Modules not reached:** `form-shift.ts`, `spell-cast-rolls.ts`, `inventory.ts`, `options.ts` beyond
  heal/temp_hp, `RollerLine` logic, the DraftsPane / OrphanDialog / PackUpdatesSettings flows,
  `translation-backups.ts`, `migrations.ts`, `import-translations`, homebrew in IndexedDB, weapon
  mastery counters.
- **Long sessions.** Plugin memory growth over thousands of derives (code reading only).
- **Keyboard paths** were not driven in Playwright.

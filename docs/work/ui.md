# UI and builder — open work

> Tracker. Screens, the builder, accessibility and UI copy. The contracts are
> [`../internals/ui.md`](../internals/ui.md); the ORDER is [`plan.md`](../plan.md) ▸ Implementation order.

- [~] **N3 · Builder/level-up redesign — descriptions everywhere.** Requirement: NOTHING is picked
  blind (spells, feats, subclasses, maneuvers, features). The live-sheet-plus-inspector shape is
  built and its contract is `docs/internals/ui.md` ▸ "The builder is a live sheet, not a form" +
  "the picker contract". Choice groups (N2 shape 3) render here when N2 lands. Open tails:
  - [ ] **The guided ("walk me through it") second mode.** Not this release — it needs
        its own design session, and the todo bar already carries the guidance a first-time build
        needs. Cheap when it comes: the inspector's targets are a data descriptor, so a wizard is a
        second entry point onto the same view-model, not a rewrite.
- [ ] **N5 · Adjacent gaps (assistant's additions).** (1) **DONE** — the Features panel. A character
  can read their own class features, species traits, background and feats on the play sheet, as
  separate sections and never one blob. It reads `character/features.ts`, NOT the sheet's effect
  list: the gather keeps only rows carrying effect TOKENS, so a feature made purely of prose — most
  of them — never reaches it. Each row is a native `<details>`, which is already everything a
  read-only list needs. `activeClassFeatures` moved there too, so the builder and the play sheet
  share one gate instead of two that drift. (2) **DONE** — concentration check prompt on damage (CON save DC
  max(10, ⌊dmg/2⌋)) now toasts a reminder in `damage()` (see the CONCENTRATION entry). (3) Death saves + exhaustion UI (→ B2).
  (4) Ammunition as consumable — tracking OFF by default (a toggle that exists but is never enforced;
  ~99% of tables don't track ammo). **CONTENT-blocked, not app-blocked**, and the two editions are
  blocked differently: 2024 weapons carry the ammo KIND as a tag (`ammo:arrow`, `ammo:bolt`) but the
  pack has no ammunition ITEM to spend — the Arrows/Bolts/Bullets rows live inside an HTML table in
  the `ammunition` gear row's prose, which is not somewhere `src/` may read a value from; 2014 ships
  an `arrows` item but its weapons say only `ammunition:80/320`, because `convert-2014.mjs` drops the
  parenthetical ammo type the SRD table gives. So a decrement built today matches nothing on either
  edition. The content fix is both halves — the 2024 ammunition table extracted into item rows, and
  the 2014 converter keeping the type — and it belongs with the other converter work. (5) Short-rest
  hit-dice UI (→ UBUG-1/B2). (6) **DONE** — the builder pickers carry search, and the two big ones
  carry the level/category sections and the school/concentration/ritual facets that keep a long list
  navigable (the picker contract, `docs/internals/ui.md`). (7) **DONE** — the combat prepared cap is per CLASS
  (A18-tail): a prepared spell is attributed to the class that grants it and counted against that
  class's cap; `classes[0]` survives only as the documented fallback for a spell no class claims,
  which is the fallback `casterForSpell` already makes. (8) **DONE (manual half)** — a granted roll carries a
  "used this turn" mark the PLAYER sets, cleared by Next turn (`play.turn.usedRolls`). It is not set
  by rolling: only some granted rolls are once-per-turn, the content does not say which, and a marker
  that appeared on its own would invent a limit. Automating it needs the content to say so.
- [x] **ARCH-1 / B8 · the UI reads in the player's language, everywhere.** Every user-facing string
  is a catalog key, in the components and in everything upstream of them. The rulings the sweep
  settled live in [`../internals/ui.md`](../internals/ui.md) ▸ Strings live in the catalogs, and what
  a ROLL keeps in [`../internals/roller.md`](../internals/roller.md) ▸ Conventions — that is where
  the next person needs them, not behind a ticked box. The last of it was the roll NAME: an attack's
  label used to be resolved to text at the producer, so the one attack that is a catalog key rather
  than a content row's own word froze in whatever language rolled it.
  **The lesson worth keeping:** a scan for literal English is a hint, not the check. Three of the
  regions it missed were found by driving the app in Ukrainian and reading the screen, and the last
  three strings hid behind a scan rule that excluded a text run followed by `{`.

- [ ] **ONBOARD · First-run onboarding — needs its own design session, and it comes LATE.** Not because
  it is unimportant: the UI is moving under it right now (the a11y picker rework), and onboarding
  written against a surface that is still changing has to be written twice. Schedule the session once the current UI wave settles; until then this item collects
  the trigger and the constraints, nothing more. The trigger: the
  app keeps accumulating things a first-time user cannot deduce (Shift-click a stat to open the roll
  tray instead of rolling it, `Ctrl+K`, the fact that all content is CSV on disk they may edit live,
  and — once UBUG-20 lands — that an eligible damage pill is clickable). **Maintainer constraints:**
  minimum text, maximum interactivity, because (a) less to translate, (b) long tutorials actively repel
  people from a new app.
  **Design position to start from (not yet agreed, argue it when it's picked up):**
  1. A tutorial that teaches individual CONTROLS is usually a patch over a discoverability bug — the
     first fix is the affordance (docs/internals/ui.md ▸ Every interactive element says so), not a screen explaining it.
     Otherwise onboarding becomes the dumping ground for every place we skimped on signalling.
  2. What legitimately needs teaching is what *cannot* be made self-evident: a modifier-click, a global
     shortcut, and the data model (your character is a folder of files you own). That is a handful of
     facts, not a walkthrough.
  3. **Prefer just-in-time over up-front.** One line surfaced ONCE at the moment it first becomes
     relevant (first roll, first attack, first level-up) beats any front-loaded flow: nothing to click
     through before reaching the app, near-zero text per moment, and no separate screen to keep in sync
     with a UI that moves. What repels people is the wall between them and the app, not its length — so
     a *shorter* wall is the wrong answer to the maintainer's own objection.
  4. **The demo character already does much of this job** and is a shipped asset: it seeds first-run on
     web and desktop and "IS the first impression of the system's scope" (DEMO-1 above). A pre-built
     sheet you can immediately poke beats a walkthrough describing one. Build on it rather than beside it.
  **Text volume is not the binding reason to prefer interactive** — onboarding would add on the order
  of ten strings, which is nothing beside what the app already carries. Constraint (b) — tutorials
  repel — stands on its own and is the real reason.
- [x] **UX-1 · Error copy pass.** Every failure message rewritten for the person whose data it is,
  with the technical particular demoted to a `detail` line rather than deleted. The standard, the
  `detail` contract and where the copy lives are `docs/internals/ui.md` ▸ Error copy; tests assert
  the identifier, never the sentence.
- [x] **PORTRAIT · a character has a face.** The picker sits in the builder's masthead (the portrait IS
  the button; an × beside it is the way out), and the sheet shows it beside the name — only when the
  character has one, because an empty placeholder on every sheet is a permanent nag. The ordering
  problem the item was really about is solved where it was proposed: the bytes wait in the view-model
  as one downscaled blob, and land in the character's folder in a single `Storage` write when it is
  first saved. `characters.md` ▸ JSON, not CSV has the rules that outlive this entry.
  **What the tests hold:** the decode/downscale/re-encode is a webview API, so it is a browser test
  against real chromium (`photo.browser.test.ts`); where the bytes go, and that clearing takes the
  FILE and not just the reference, are node tests.
- [x] **UBUG-7 · Effect (i) rules text renders as Markdown**, not raw.
- [x] **UBUG-17 · Action/Bonus/Reaction pips look interactive, and all of them are** — every pill
  in that bar signals it the same way (hover + pointer + the global focus ring).
- [x] **UBUG-18 · Abilities block used a different background** than the panels around it.
- [x] **UBUG-19 · Icons are DRAWN, never typed.** `Icon.svelte` over Lucide; the rule, its three
  failure modes and what stays text are `docs/internals/ui.md` ▸ Icons are drawn, never typed. One
  consequence to keep: a locale catalog no longer carries UI iconography, so a translator cannot
  break an icon.
- [x] **UBUG-10 · Spellbook "show on sheet" (eye) did nothing.** Fixed end-to-end via a persisted
  `ui.spellsHidden`; pins likewise persist in `ui.spellsPinned` (D3), no demo hardcode.
- [x] **A11Y-1 · Dialog focus management.** `trapFocus` on every dialog. **Deliberately NOT
  trapped:** `CommandPalette` (it restores focus itself — a second restorer fights it) and the
  combat popovers, which are anchored menus rather than modals.
- [x] **CSS class-naming rename pass.** Verbose, self-evident, kebab-case names with a feature
  prefix, gated by `shot.mjs` at 0px. **What stays short on purpose:** a word already self-evident
  inside its component (`.pip`, `.move`, `.dice`, `.filled`), the `class:strip` shorthands, and any
  name produced in the script (`tone()` → `max`/`min`) — renaming those is a JS change, not a class
  change. The census and rename tools are in `tooling.md`.
- [~] **MOBILE-ALPHA · the narrow layout is usable, not finished.** Nothing overflows any more: at
  393px and 320px, in English and Ukrainian, no route scrolls the document sideways and no box inside
  `main` escapes it. The one threshold and the rules behind it are
  [`../internals/ui.md`](../internals/ui.md) ▸ A narrow window; the check is `tools/visual/narrow.mjs`.
  The banner stays and says alpha rather than absent. Left:
  - [ ] **Four tap targets, all of them in combat.** Hit-tested at 393px rather than measured as
        boxes, which is the difference between a list worth working and a list of false alarms: the
        controls that LOOK broken (`.prep` at 8×8, `.pin-star` at 18×18) already carry a `::before`
        expander and fill a finger square, and every route but combat comes back clean. What is left
        is `.slot-pip` (12×12, misses 4 of 8 probe points), `.resource-pip` (12×12, misses 1),
        exhaustion's `.pip` (22×10, misses 2 — and a shortcut beside a full-size ∓ stepper that does
        the same job), and the inventory row's quantity stepper (22×22, misses 1). Each sits ~4px
        from a neighbour, so the `::before` trick cannot grow it without stealing the neighbour's
        taps — the fix is to space or restack the row, which is a **phone-in-a-hand** call and not a
        driver's. `tools/visual/narrow.mjs` prints the list on every run.
  - [ ] **No narrow baseline.** `shot.mjs` renders at 1280 only, so a regression here shows up as
        overflow or not at all, never as a pixel diff.
- [ ] **PLAYTEST-UI · what the first outside playtest found on the screens.** One session, one
  player, 23 notes. The ones that are copy or a missing affordance, smallest first; the rules half is
  `mechanics.md` ▸ PLAYTEST-SHIELD, the tray half is `roller.md` ▸ PLAYTEST-TRAY, and the override
  layer is `authoring.md` ▸ OWN-WORDS.
  - [x] **A refused ability bump says why.** Point buy's step from 13 to 14 costs 2 where every step
        before it cost 1, and the "+" that could not afford it did nothing and explained nothing.
  - [x] **Strict/Free say what they change**, and say it through `provenance` rather than `title`.
  - [x] **КО, not КБ**, for Armor Class in Ukrainian.
  - [x] **A passive score says what a passive score is** (`whyPassive`), in the builder and in combat.
  - [x] **A save says it saved.** The failure path always toasted; success only navigated.
  - [x] **Panel drag: the grip was a `<button>`, and that alone discarded every press.**
        `svelte-dnd-action` refuses to start a gesture whose target "is a nested input element", and
        its test is `e.target.value !== undefined` — which every `<button>` passes, because
        `HTMLButtonElement.value` is `""`. So the grip had never worked by pointer since it became a
        real button; the dependency bump this was first blamed on is innocent, and a pre-bump install
        (svelte 5.56.8 + dnd-action 0.9.74) was driven to confirm that.
        Two more bugs sat behind it, both from Charnik hand-rolling what the library already has: our
        `dragDisabled` flag updated on a microtask, so it landed AFTER the press it was meant to
        allow; and a window `pointerup` re-locked it in a race with the drop, which is why a drag
        could work once and then stop. `dragHandleZone` + `dragHandle` replace the lot — the library
        arms the zone through its own synchronous store, releases on `finalize`, and
        `preventDefault()`s the press, which is also what stopped a finished drag from leaving a click
        that collapsed the panel it had just moved. `morphDisabled` keeps the floating card the size
        of the panel you picked up instead of resizing it into every slot it passes over.
        **Deleted, not added:** `layout.dragDisabled`, `layout.releaseDrag`, the `svelte:window`
        pointerup, and the `flushSync` that was treating the symptom.
  - [ ] **The (i) a manual buff does not have.** The reporter was on a MOUSE, which closes the
        investigation below: a click opens both the provenance popover and `EffectsPanel`'s ⓘ, so what
        was read as "the (i) does nothing" is the ⓘ being ABSENT — it renders only for a condition
        carrying text, and a buff from a spell carries none. So every effect row needs something to
        open: what it does and where it came from, composed from the effect itself when no content row
        backs it.
        Kept for the record, since it is what the driving found:
    - [ ] **Every (i) opens on a click — and on a desktop both already do.** Driven in chromium: a click
        on a traced value opens the provenance popover (the action adds a tab stop, so the click
        focuses it and `focusin` fires), and `EffectsPanel`'s ⓘ opens its rules text. So the report is
        NOT "click does nothing" on a mouse. Two candidates left, and they want the reporter's device
        to tell them apart: a TOUCH tap, where `pointerenter` opens and the next tap anywhere fires
        `pointerleave` and closes it again; and the ⓘ simply being ABSENT on an effect that is not a
        condition, because a manual buff carries no content row and so has no prose to show — which
        reads as "this one has no (i)" rather than "the (i) does nothing".
  - [x] **Combat's Inventory panel has no way to add an item.** A `+` in a rounded square opens the
        SAME picker the builder mounts, in a dialog — sections by category, take on the left, read on
        the right — and writes through to `build.inventory`, because what a character owns is build
        data wherever you noticed it. Reusing the picker found two bugs in it that only a picker
        inside a DIALOG can have: a `position: fixed` card resolves against the dialog's own
        `translate(-50%, -50%)` rather than the viewport (so it landed off-screen — `floatInBody`
        moves both floating cards to the body, the same reasoning that already puts the provenance
        popover there), and its `z-index: 40` sat under the dialog shell's 61.
  - [x] **An item does not show its price, and a magic item has none to show.** Done: the picker row,
        the inventory row and the article all say it through one parser (`costSaid`), so the coin is
        the reader's word — "15 gp" / «15 зм» — and an unparseable homebrew price passes through as its
        author wrote it. A magic row simply has no price cell.
        The counts behind it, taken from the shipped packs rather than remembered: 149/383 (2014) and
        128/390 (2024) rows carry a `cost`, and **0 of 234 (2014) and 0 of 251 (2024) MAGIC rows do** —
        the SRD prices no magic item and gives no formula for one either, and the rarity→value table is
        DMG, which we cannot author (`AGENTS.md` ▸ Inventing game data). What every magic row does carry
        is `rarity`, complete in both editions, which is why rarity is the axis the weapon filter uses.
  - [x] **The builder's pickers have no language switcher.** `PickerCard` — the popup where a player
        READS an article while choosing — now carries the shared `LangSwitcher` beside its close
        button. The topbar has the same control, but it is a screen away from the thing that made you
        want it. `PickerPeek` deliberately has none: it is a hover teaser, gone before a press lands.
  - [ ] **The weapon picker mixes magic items with the basics**, and the basics are what a starting
        character takes. **Settled with the maintainer:** one toggle for magic items, plus a
        double-ended slider over RARITY — the two handles pick the band that shows. Rarity is the only
        axis the content can support (see the price item above).
  - [ ] **No quick way to add a custom language or tool** without authoring a content row.
        **Settled with the maintainer: it is a free-text string on the CHARACTER, not a content row.**
        Languages and tools interact with nothing in the engine today — they are flavour a sheet
        prints — so a row in a pack would be machinery for a string. If either ever gains a mechanic,
        that is when it earns a row.
  - [ ] **Two things exist and are not found: Level up, and a species ASI.** The level-up button is in
        the masthead and the +1 is folded into the score with only the popover to say so. Both are
        discoverability, not absence — 5e species DO carry the bonus (the shipped human gives +1 to all
        six via `flat_bonus`), and in 5.5e they correctly carry none, which is its own unexplained
        blank.
  - [ ] **Rows inside a panel cannot be reordered.** `dndzone` is on the panel COLUMNS only.

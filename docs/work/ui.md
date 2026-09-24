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
  ~99% of tables don't track ammo). **The CONTENT half is done**: 2024 ships the five ammunition rows
  its own table states (arrows, bolts, both bullets, needles), each carrying the `ammo:<kind>` tag its
  weapons already name and the `quantity:` a purchase gives; 2014 ships its four as `ammunition` rows
  rather than plain gear. What is left is the app's decrement, and one asymmetry it has to live with:
  **SRD 5.1 never says which ammunition a weapon fires** — its weapons table prints "Ammunition (range
  80/320)" and the property's own text names no type. The earlier claim that `convert-2014.mjs` was
  dropping a type the table gives was wrong; there is nothing there to drop. So a 2014 decrement has
  to ask which stack to spend, where a 2024 one matches on the tag. (5) Short-rest
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

- [x] **FEATURES-VIEW · the Features panel hides, pins and reorders — driven by FILTERS.**
  **The filters WRITE the per-feature answer, they do not layer over it.** So there is one answer to
  "is this shown", a preset's effect reads back in the same eyes a player toggles by hand, and undoing
  it is the same click either way. The preset vocabulary is an open enum over the three axes the data
  already carries (`FEATURE_PRESET`, `character/features.ts`): `all`, `newest` — only what the highest
  class level granted, so there is room to learn what you just gained — and `class`, which narrows the
  CLASS features to one of the build's classes and leaves species, background and feats alone, because
  those are not a class's to filter. A fourth preset is a member here, not a new mechanism.
  **A PINNED feature survives every preset.** Pinning is the player saying "I always want this one",
  and a filter that overruled it would make two controls argue; the eye still hides it by hand, so
  nothing becomes unreachable.
  **Pinned rows lift into a group of their own** above the sections and do not repeat below — a row in
  two places is two answers to where it is. Everything else keeps its section. One saved `ui.rowOrder`
  array serves every group: each sorts its own members by it, so a group nobody has dragged keeps the
  order it was gathered in.
  **`hiddenActions` was the defect this turned up and fixed**: plain `$state` on `CombatVM` with
  nothing in the schema behind it, so hiding an action was forgotten on reload while hiding a spell
  survived — one question with two answers. It is `ui.actionsHidden` now.
  Driven in chromium: pin lifts and survives a preset, "newest level" leaves one row, the grip's arrow
  keys reorder inside a section and back, and all three survive a reload.

- [ ] **TITLE-POPOVER · an explanation appears where the pointer is, not where Windows decides.**
      Every control that explains itself still does it with `title`: the browser waits about a second,
      then draws an OS tooltip somewhere near the cursor, in the OS font, that a keyboard never sees.
      The replacement already exists and is already the contract — `use:provenance`
      (`lib/actions/provenance.ts`, [`../internals/ui.md`](../internals/ui.md) ▸ rule 3) opens ONE
      shared anchored popover on hover AND focus, with no delay, positioned under its trigger and
      kept inside the viewport. It is in use at 28 sites across 14 files, so this is extension, not
      design.
      What is left is **144 `title=` attributes**, and they are not one thing: some carry a real
      explanation (the effects panel's ⓘ, a blocked row's reason, a feature's granting class), some
      are the accessible NAME of an icon-only button and must stay `title`/`aria-label` rather than
      become a popover. So the item is a pass, not a sweep: sort the 144 into "explains" and "names",
      move the first group to `use:provenance`, and leave the second alone.
      The ⓘ is the one that changes SHAPE, not just mechanism: today it is a click-toggle that
      expands prose inside the row, with `title` on the button as a second, slower explanation of the
      button itself. Hover should open the prose where the pointer already is; whether the click
      toggle survives beside it is the one open question here, and it is answered with rendered
      variants, not in this paragraph.

- [ ] **ADD-ITEM-SURFACE · adding an item from play is the right picker in the wrong chrome.**
  `AddItemDialog` mounts the builder's `SectionedPicker` — which is deliberate and stays, so the same
  act has one contract — inside `DialogShell`, which is documented as "the shared ATTENTION-dialog
  shell", the skeleton the content-review modals repeat. A working surface is not an alert, and the
  mismatch shows as concrete defects rather than as taste: a red flag badge over "Add an item", a
  language switcher inside it, a subtitle explaining that inventory is build data to someone who is
  mid-fight, no visible close, and the list running past the panel's bottom edge. The category chips
  also read "Weapon2" and "Armor1" — a taken-count glued to the label with no separator.
  **The picker is not the work; the presentation is.** Which means rendered variants before code
  (`AGENTS.md` ▸ Screenshots go in design-preview): a wide working dialog with no badge and no
  subtitle, a side drawer, or the compendium's own master-detail surface reached and returned from.
  Screenshot of the current state: `design-preview/add-item-now.png`.

- [ ] **PICK-CONTROL-STUDY · which rendering of a two-state choice players actually read — asked of
  users, not of us.** FINESSE-ABILITY shipped the first one: both abilities standing with the live
  one lit (`STR DEX`), on the attack row of a finesse weapon. Three renderings went up first and the
  maintainer picked from seeing them — visible, and good enough to ship — but "good enough from one
  pair of eyes that already knew what the control was" is not the same claim as "a player who has
  never been told finds it".
  **The question is NOT which rendering is most visible.** The same playtest said "too much of
  everything", and a screen that is 43% furniture (COMBAT-RAIL ▸ 4) cannot answer a visibility
  question honestly — every control is most visible alone. So ask first whether a standing control is
  the right shape at all, and only then which one: players who have not seen it before, on their own
  character, with no prompt naming it, and watch whether they look for the choice rather than whether
  they find the chip. The two other renderings are recorded in the commit that shipped this
  (`design-preview/fin-A-chip.png`, `fin-C-inline.png`): the quiet single-value chip, and the chip
  with a swap glyph.
  **It generalises, which is why it is its own item rather than a tail on FINESSE-ABILITY.** Every
  two-state pick the sheet grows later — a versatile weapon's grip, a damage type chosen per
  instance — asks the same question, and answering it once settles the house pattern rather than one
  control. Until then the shipped rendering stands.

- [ ] **COMBAT-RAIL · the play screen is a scrolling body beside a rail that does not scroll — a
  maintainer-stated rework, its own design session.** Three parts, and the third is the reason the
  other two are not a CSS tweak:
  1. **The roll log, and some blocks, move to a PINNED right rail.** The two scroll independently:
     the combat body scrolls under a log that stays put, and the log scrolls without moving the body.
     Today everything is one page scroll, so the log — the thing you look at right after acting —
     leaves the screen exactly when you acted.
  2. **The play screen moves to the LEFT edge.** It is centred now, which spends the widest part of
     a desktop window on gutters while the rail has to come from somewhere.
  3. **Which blocks live where is re-decided.** `combat.layout` already holds two drag-reorderable
     columns persisted on `ui.panelColumns`, so a THIRD region is a change to that model and to what
     a saved layout means for a character who has one — not a wrapper div. That is the design
     session: which panels are rail-shaped (log, and what else), whether the rail is reorderable and
     collapsible like the columns are, what a narrow window does with it, and how an existing
     `ui.panelColumns` migrates rather than being thrown away.
  4. **How much stands on the resting screen — "too much of everything" from the playtest, counted.**
     At 1536×864 the Combat screen carries **225 controls inside `main`**, 50 visible at once, over
     3.2 screens of scroll. **96 of the 225 are FURNITURE** — drag grips, pins, eyes, own-words
     pencils, show/hide — against 129 that do something to the character. **45 are drag grips alone.**
     So 43% of the controls on the play screen exist to rearrange the play screen.
     The reason that reads as clutter rather than as richness: furniture is BIMODAL. A sheet is
     arranged once and played for months, so those 96 stand permanently for an act performed rarely,
     while the 129 are wanted every turn. Most of the 96 arrived recently and separately — row
     reorder, the Features panel's hide/pin, the own-words pencil — each defensible alone, and the
     sum is what a player met.
     Three directions, and the middle one is recorded to be rejected: **an arrange MODE** (one
     control reveals every grip, eye and pin at once — sheds nearly all 96 for the cost of one, works
     on touch, and has a reverse state); **furniture revealed on row hover** (cheap, matches the
     auto-calc switch and the concentration ✕, but dead on touch and twitchy across twenty rows);
     **or cutting** — asking whether a per-row grip earns its place when the keyboard already
     reorders. Rendered variants decide it, not this paragraph.
     **It belongs in THIS session and not beside it.** "What stands on the resting screen" and "how
     the screen is divided" are one question; answered apart they get two answers that do not fit.

  Nothing here is blocked on code. What it needs first is RENDERED variants, not names
  (`AGENTS.md` ▸ Screenshots go in design-preview).

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
  The banner stays and says alpha rather than absent.
  Two things had escaped that at 320px and are fixed: a class feature's spell TABLE (the Warlock's
  Pact Magic list) ran 39px past the screen and every ancestor inherited it, so a content table now
  gets its own `overflow-x` scroller in the renderer; and the panel HEAD did not wrap, leaving its
  drag grip hanging 13px off the edge. Left:
  - [ ] **The row drag handle cannot pass the finger probe, and should not try.** `span.row-grip`
        is 6px wide and misses 2 of 8 probe points — the two horizontal ones, 11px either side of the
        mark: the left lands on the card's own border, the right INSIDE the row's hover pill. Passing
        needs a 24px target and the whole gutter between card edge and row is 10px, so the only way
        through is to overlap the row — and a handle that swallows taps meant for the row it sits
        beside is worse than one that is hard to hit. Not a regression from the handle's redesign: at
        its previous 12px the same two points missed for the same reason. An invisible `::after`
        expander reaching back across the card's padding was TRIED and removed — measured, it changed
        the count not at all. What would actually fix it is a different gesture on touch (press-and-
        hold the row itself to reorder), which is a design question, not a size one.
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
  - [x] **A narrow baseline exists.** `shot.mjs` captures every state at 393 as well as 1280 (the
        file carries an `@393` tag), so a narrow regression is a pixel diff rather than something only
        `narrow.mjs`'s overflow rule could catch. Eight interaction states do not reach their `ready`
        selector at 393 and are announced as skipped, which is the harness's own contract: a state it
        cannot reach is never captured as the wrong screen.
- [ ] **PLAYTEST-UI · what the first outside playtest found on the screens.** One session, one
  player, 23 notes. The ones that are copy or a missing affordance, smallest first; the rules half is
  `mechanics.md` ▸ PLAYTEST-SHIELD, the tray half is `roller.md` ▸ PLAYTEST-TRAY, and the override
  layer is `authoring.md` ▸ OWN-WORDS.
  **One of the 23 never landed anywhere, and it was the structural one**: "too much of everything".
  It is not a copy fix or a missing affordance, so it had no home among these — it is the shape of the
  screen, and it sits in COMBAT-RAIL ▸ 4 with the count behind it.
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
  - [x] **The (i) a manual buff does not have.** The reporter was on a MOUSE, which closed the
        investigation: a click opens both the provenance popover and `EffectsPanel`'s ⓘ, so what read
        as "the (i) does nothing" was the ⓘ being ABSENT — it rendered only for a condition, and a
        buff from a spell is the commonest row on that panel. The control now asks the EFFECT what it
        can open, in three steps: the condition's rules text, then the row that granted it (a spell's
        own description), then whatever the player typed for a custom one. An effect with none of the
        three still has no ⓘ — a hand-made buff already shows its tokens as tags, and a control that
        opens the words beside it is a control that does nothing.
        A bug found on the way: `conditionText` read `text_en`, so a condition shipping a `text_uk`
        opened in English beside a panel that had already switched.

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
  - [x] **The weapon picker mixes magic items with the basics**, and the basics are what a starting
        character takes. A double-ended slider over the rarity ladder now picks the band that shows,
        with **mundane as its lowest rung** — that is what a row with no `rarity` IS in the data, so
        "basics only" is one handle rather than a separate toggle beside the slider. Two native range
        inputs sharing a track, so the keyboard and the screen reader come for free; the ring is on the
        handle that has the key, not around the whole control. Both pickers mount it — the builder's
        equipment pane and combat's add-item dialog — from one component.
        Driven in chromium: 71 weapons whole-band, 38 at mundane-only, and the all-magic categories
        (ring, wand, staff, rod) leave the section rail entirely.
  - [x] **No quick way to add a custom language or tool** without authoring a content row. Done as
        free text on the CHARACTER (`build.customLanguages`, `build.customTools`), per the maintainer:
        neither interacts with anything the engine computes — they are flavour a sheet prints — so a
        row in a pack would be machinery for a string. If either gains a mechanic, that is when it
        earns a row. Both lists live in the languages pane (a second pane for one text field would be a
        trip for a word), each entry carries its own remove, and the sheet prints them in the same
        line as what the content granted: the question is "what do I speak", not "where did the word
        come from". Old saves parse with empty lists — asserted, along with the round-trip.
  - [x] **Two things exist and are not found: Level up, and a species ASI.** Both were discoverability,
        not absence. **Levelling up rides the LEVEL itself** — "Level 8" in the hero line is the
        control, with "Level up to 9" as its tooltip — per the maintainer, who took the standalone
        button back out: the number is what a player looks at when they think about levelling, and a
        button beside it competed with the same line of facts for the same attention. (Where the
        button sits is deliberately unfinished; the action works from the number meanwhile.)
        **A boosted score says its bump as a number** (`+1` beside the score, in the same crimson the
        tint already used). The tint alone said something happened without saying what, and the only
        answer lived in a popover — which is a thing you open once you already suspect there is
        something to open. 5e species DO carry the bonus (the shipped human gives +1 to all six via
        `flat_bonus`); in 5.5e they correctly carry none.
  - [x] **Rows inside a panel cannot be reordered.** Done for the three panels whose order is the
        PLAYER's — inventory, attacks and the standard actions. Two storage shapes, because the lists
        are two different things: the inventory's rows ARE `build.inventory`, so its drag stores
        nothing new, while attacks and actions are DERIVED from what you wield and what you can do, so
        their order lives in `ui.rowOrder` keyed by panel and is reconciled against the live rows on
        every read (`combat/row-order.ts`, the same rule the panel columns use: an unnamed row is new
        and goes last, a name with no row is dropped). Every grip answers the arrow keys and keeps its
        focus through the library's rebuild. The grip sits BESIDE a row that is one big button and
        INSIDE one that is not — a `<summary>` hosts it, so a row that expands anchors the handle to
        its header rather than to everything the header opens.
        **The actions panel orders all three of its lists together**, because a player sees one list
        of things they can do: a spend-option has as much claim to the top as Dash. A standard action
        keeps its bare id in `rowOrder` and the two newer kinds carry theirs, so an order saved before
        they joined still applies.
        **The rest are deliberately left alone: their order IS their grouping** — skills by ability,
        spells by level, effects by polarity. Verified across a reload.
        **FEATURES came off that list** (FEATURES-VIEW): the grouping stayed and a player may now
        order INSIDE a section, which is a different thing from ordering across one.

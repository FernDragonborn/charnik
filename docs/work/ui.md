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
        focus through the library's rebuild; a row stays ONE button with the grip beside it, never
        inside it.
        **The rest are deliberately left alone: their order IS their grouping** — skills by ability,
        spells by level, features by source, effects by polarity — and so are the actions panel's two
        lower lists, which follow the feature that granted them. Verified across a reload.

# UI and builder — open work

> Tracker. Screens, the builder, accessibility and UI copy. The contracts are
> [`../internals/ui.md`](../internals/ui.md); the ORDER is [`plan.md`](../plan.md) ▸ Implementation order.

- [~] **N3 · Builder/level-up redesign — descriptions everywhere.** Requirement: NOTHING is picked
  blind (spells, feats, subclasses, maneuvers, features). The live-sheet-plus-inspector shape is
  built and its contract is `docs/internals/ui.md` ▸ "The builder is a live sheet, not a form" +
  "the picker contract". Choice groups (N2's choice kind) render here when N2 lands. Open tails:
  - [ ] **The guided ("walk me through it") second mode.** Not this release — it needs
        its own design session, and the todo bar already carries the guidance a first-time build
        needs. Cheap when it comes: the inspector's targets are a data descriptor, so a wizard is a
        second entry point onto the same view-model, not a rewrite.
- [~] **DEFENCE-STRIP · the `Saves` group has not found its form.** The strip itself is one
  component now (`DefenseStrip`, the contract is [`../internals/ui.md`](../internals/ui.md) ▸ Shared
  controls and dialogs), so the builder and the play sheet say the same things and a Cloak of
  Displacement is on the screen during the fight it is for. What ships for `Saves` is the shape that
  was close enough for the idea to read:

  ```
  Saves         advantage · against spells
                advantage · against magical effects
  ```

  It is still wrong — two rows under one label, each a swing plus a case. Next: RENDER the three
  directions below, at both widths and in both locales, and put them to the maintainer; nothing is
  chosen before they are seen.

  **What the render says the fault IS**, which is a starting hypothesis and not a decision: both chips
  open with the same word. `advantage · against spells` and `advantage · against magical effects`
  share their first half, and the half that differs is at the end, where the eye arrives last. `AC`
  reads cleanly beside them precisely because it leads with the number. So the group puts what is
  COMMON in front and what is DISTINCT behind — which is the wrong way round for a list of two.
  Three directions worth rendering, cheapest first:
  - **Lead with the case** — `against spells · advantage`. One reordering, nothing else moves.
  - **Hoist the swing into the label** — `Saves · advantage` then `spells`, `magical effects`. Reads
    tightest, and breaks the moment one row is a disadvantage.
  - **Say the swing as a MARK rather than a word** — `CombatStrip` already does this for passive
    senses (`advantage-mark`, a `chevron-up`/`chevron-down` beside the number), so the vocabulary is
    shipped and a player has already learnt it on the row above.

  The variants that settled the rest are `design-preview/defence-chips-variants.html`; `/dev/defences`
  is the live state — the builder's card and the strip at play-sheet width — in `shot.mjs` at both
  widths.

- [ ] **A11Y-TIMING · the timings a gesture depends on belong to the player, not to us.** The touch
      hold is 150ms of silence plus a 400ms fill (`internals/ui.md` ▸ rule 16), chosen to match the
      500ms native long-press — and the web gives no way to read the machine's own setting for it,
      though Android has one (Accessibility ▸ Touch & hold delay, 300/500/1500ms). A player whose
      hands do not hold still for half a second, or who needs longer before a gesture commits, has
      no way to say so.
      So: a settings pane for interaction timing, alongside the themes and language that already
      live there — `AGENTS.md` ▸ everything is doable from the UI, and a duration hardcoded in a
      constant is the opposite of that. `TOUCH_HOLD_MS` is one export and already the single source
      of both halves, so what this needs is the surface and the persisted value, not a rework.
      Worth scoping WITH the rest of the interaction settings rather than alone: the same pane is
      where reduced-motion overrides and a longer double-tap window would go, and one pane asked for
      once beats three settings arriving separately. LATE — after the UI stops moving.

- [~] **TITLE-POPOVER · an explanation appears where the pointer is, not where Windows decides.**
      The pass is done: every `title` that EXPLAINED a control or a value is the provenance popover
      now, and what a `title` may still be is [`../internals/ui.md`](../internals/ui.md) ▸ rule 3.
      One group was left on purpose, waiting on something that is not this mechanism:
      **the roller's own surfaces** — 13 in `RollRow`, 6 in `RollerLine`: which die a face came
      from, what a modifier is made of, why a pill is held. Each would become a tab stop, inside a
      toast that is gone in seconds and inside a line whose keyboard model is a caret walking
      tokens. That is a decision about the roller, taken with it.
      The ⓘ is the one that changes SHAPE, not just mechanism: today it is a click-toggle that
      expands prose inside the row, with `title` on the button as a second, slower explanation of the
      button itself. Hover should open the prose where the pointer already is; whether the click
      toggle survives beside it was the open question, and it is answered: **variant A**
      (`_info-A-hover-on-the-mark.png`). The ⓘ opens the prose on hover and on focus. A CLICK on
      the ⓘ pins it: the popover then stays through pointer-leave and blur, so its text can be
      selected and copied, and closes on the next click anywhere OUTSIDE its own box — a click
      inside is a selection, never a dismissal — or on Escape. Pinned is a state only that click
      enters. The variants it was picked from, on the live sheet with a real row's prose: `design-preview/_info-now-click-expands.png` (today),
      `_info-A-hover-on-the-mark.png` (the ⓘ opens the prose on hover and focus; a click either pins
      it inline as now, or does nothing — the picture is the same, the choice is what a click means)
      and `_info-C-hover-on-the-name.png` (the effect's NAME is the trigger, as rule 3 has a value
      explain itself, and the ⓘ leaves the row). The popover renders the prose these need:
      `use:provenance={{ markdown }}`.

- [ ] **ADD-ITEM-SURFACE · adding an item from play is the right picker in the wrong chrome.**
  `AddItemDialog` mounts the builder's `SectionedPicker` — which is deliberate and stays, so the same
  act has one contract — inside `DialogShell`, which is documented as "the shared ATTENTION-dialog
  shell", the skeleton the content-review modals repeat. A working surface is not an alert, and the
  mismatch shows as concrete defects rather than as taste: a red flag badge over "Add an item", a
  language switcher inside it, a subtitle explaining that inventory is build data to someone who is
  mid-fight, no visible close, and the list running past the panel's bottom edge.
  **The direction is a POPOVER anchored to the control that opened it**, not a dialog: adding an
  item is a step inside the inventory panel, and the modal shell is what brought the badge, the
  subtitle and the language switcher with it.
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
     web and desktop and "IS the first impression of the system's scope" (`internals/characters.md` ▸ The demo character). A pre-built
     sheet you can immediately poke beats a walkthrough describing one. Build on it rather than beside it.
  **Text volume is not the binding reason to prefer interactive** — onboarding would add on the order
  of ten strings, which is nothing beside what the app already carries. Constraint (b) — tutorials
  repel — stands on its own and is the real reason.
- [~] **MOBILE-ALPHA · the narrow layout is usable, not finished.** Nothing overflows any more: at
  393px and 320px, in English and Ukrainian, no route scrolls the document sideways and no box inside
  `main` escapes it. The one threshold and the rules behind it are
  [`../internals/ui.md`](../internals/ui.md) ▸ A narrow window; the check is `tools/visual/narrow.mjs`.
  The banner stays and says alpha rather than absent. Left:
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

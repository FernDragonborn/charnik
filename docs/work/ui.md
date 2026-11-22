# UI and builder — open work

> Tracker. Screens, the builder, accessibility and UI copy. The contracts are
> [`../internals/ui.md`](../internals/ui.md); the ORDER is [`plan.md`](../plan.md) ▸ Implementation order.

- [~] **N3 · Builder/level-up redesign — descriptions everywhere.** Requirement: NOTHING is picked
  blind (spells, feats, subclasses, maneuvers, features). The live-sheet-plus-inspector shape is
  built and its contract is `docs/internals/ui.md` ▸ "The builder is a live sheet, not a form" +
  "the picker contract". A feature's choices render here as the Feature options pane (`OptionsPane`). Open tails:
  - [ ] **The guided ("walk me through it") second mode.** Not this release — it needs
        its own design session, and the todo bar already carries the guidance a first-time build
        needs. Cheap when it comes: the inspector's targets are a data descriptor, so a wizard is a
        second entry point onto the same view-model, not a rewrite.
- [ ] **PX-SCALE · the sizes components still write as px get a scale of their own.** 815 px
  literals sit in `<style>` blocks, most in
  `HpPanel/DownSide`, `EditContentForm`, `CombatMenus` and the compendium entry. Every one that
  equals a spacing, radius or font-size token is already that token, so what is left needs a
  decision first: 287 `1px` and 80 `2px` are border widths (a `--border-*` pair), the rest are
  widths and heights of controls and icons and in-between spacings (2, 3, 5, 7 px) with no token
  of their own. Widths inside `@container`/`@media` conditions stay literal — CSS does not read a
  custom property there. Verified the way the first pass was: `tools/visual/shot.mjs` before and
  after, zero pixels of drift.
- [ ] **LOG-REWIND · any line of the log can be taken back, and a character rewound through it.**
  Every play act already writes its delta on its line (`characters.md` ▸ log.jsonl), and Undo
  applies one in reverse; today only the toast of a rest, dawn, dusk or a dropped row offers it.
  Left: an Undo on the line itself, and rewinding through several lines newest-first, each refused
  once something it changed has moved. A level-up is a build change and stays out.
- [ ] **LOCALE-DROP-IN · a language a user adds is a file they drop in — and nothing loads one yet.**
  `i18n/index.ts` discovers locales from a registry so a new one needs no component change, but the
  registry holds only the catalogs built in (`LOCALES`): no reader picks a `<id>.json` up from the
  data folder, and Settings has no way to add one. Doable from the UI, live, like every other
  content: a catalog under `locales/` in the data folder joins the switcher, falls back to English
  key by key, and its strings stay untrusted — every `{@html}` of one already goes through
  `sanitizeHtml`. Desktop reads the folder; on web the file is picked in Settings. Until then the
  "a user can drop in a catalog" sentences in `security.md` and the code describe this item, not
  the app (`../audit-oct-27.md` ▸ Docs this audit proved wrong).
- [~] **DEFENCE-STRIP · the `Saves` group has not found its form.** The strip itself is one
  component now (`DefenseStrip`, the contract is [`../internals/ui.md`](../internals/ui.md) ▸ Shared
  controls and dialogs), so the builder and the play sheet say the same things and a Cloak of
  Displacement is on the screen during the fight it is for. What ships for `Saves` is the shape that
  was close enough for the idea to read:

  ```
  Saves         advantage · against spells
                advantage · against magical effects
  ```

  It is still wrong — two rows under one label, each a swing plus a case. **The maintainer redraws
  the mock, and nothing about its form is decided until that mock exists.** Four redraws were rendered and each failed on the same thing from
  a different side: the swing word in front makes two chips open alike; the swing hoisted into
  the label breaks on a mixed group and on Ukrainian cases; a triangle for the swing disagrees
  with a good/bad colour wherever the die is somebody else's (`Against you`); and a triangle on
  your own rolls only leaves two neighbouring groups saying one fact in two forms. What they
  established, and the brief carries: gold-for-conditional and red-for-bad are two scales on one
  row; fill means two things; the case is content and cannot become an icon. The brief is
  `design-preview/_defence-strip-brief.html` — what the strip must say, what was tried, the
  requirements, and what may change (everything but the content, chips included).

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
      Worth scoping WITH the rest of the interaction settings rather than alone: Reduce motion
      already stands on Settings ▸ General, a longer double-tap window would go beside it, and one
      pane asked for once beats three settings arriving separately. LATE — after the UI stops moving.

- [~] **TITLE-POPOVER · an explanation appears where the pointer is, not where Windows decides.**
      The pass is done: every `title` that EXPLAINED a control or a value is the provenance popover
      now, and what a `title` may still be is [`../internals/ui.md`](../internals/ui.md) ▸ rule 3.
      One group was left on purpose, waiting on something that is not this mechanism:
      **the roller's own surfaces** — 13 in `RollRow`, 6 in `RollerLine`: which die a face came
      from, what a modifier is made of, why a pill is held. Each would become a tab stop, inside a
      toast that is gone in seconds and inside a line whose keyboard model is a caret walking
      tokens. That is a decision about the roller, taken with it.

- [ ] **HINT-WARMUP · once one hint is being read, the next opens at once — 0.9.0.** What every
      toolbar does: the first hint waits for the pointer to rest, and while one is up, or just
      gone, moving to the neighbouring control shows its hint with no wait. Charnik has two hint
      mechanisms and neither does this. The provenance popover opens the instant the pointer
      arrives, with no dwell at all; a native `title` waits the system's delay EVERY time, and that
      is what a row of icon controls still uses — the top bar's language, theme and refresh chips
      are where it is felt, each asking for its own half second. About 110 `title` attributes are
      left in `src/` after TITLE-POPOVER.
      So: the names of icon controls move onto the popover like every other hint
      (`internals/ui.md` ▸ rule 3 already says a hint on a button is that popover), and the timing
      is decided in the one place that then owns it, `actions/provenance.ts` — whether a hint on a
      CONTROL gets a short dwell so it does not flash under a pointer crossing the screen, with the
      warm window (open at once while a hint is up or within a moment of one closing) beside it. A
      value's popover stays instant: it is the answer to pointing at a number. The refresh chip's
      own note stands where its hint opens, so the two are placed together.

- [ ] **SYSTEM-QUESTION-STYLE · the system's questions get a style of their own — 0.9.0.** The
  maintainer's call: before 0.9.0 the flags and the accent line on the left of a dialog go, and the
  questions the system asks (the table's window, `static/table-question.html`, first) get another
  look, to be found by rendered variants. In the same window: it is too short for its words, a
  fixed 480 × 300 (`table_link/question.rs`), so the Ukrainian question does not fit; the window is
  sized to what it says, in both locales.
- [ ] **FAVICON · the web demo's tab has no icon of its own — 0.9.0.** `static/` holds no favicon
      and `app.html` names none, so a browser tab shows its blank default. The desktop app's icon
      set (`src-tauri/icons/`) is still Tauri's stock mark, so this is the app's mark and not only
      the tab's: one SVG that reads at 16px in a light and a dark browser chrome.
      **The maintainer's brief:** not the name — no letter, no pun on it; tied to the PROCESS OF
      PLAY or to the character sheet as a concept, or plainly abstract; and no d20, nor a die of
      any kind. Shown at tab size and turned down, each for what it reads as rather than for what
      it meant: a page with a portrait and lines (a document editor's icon), a circle, a triangle
      and a diamond on a tile (a face), parts converging on a node (a neural network), a 2×2 of
      resource pips with one spent (unconvincing), an ability box with its modifier bubble (says
      nothing). So what is drawn next is checked first for what a stranger takes it for.
      **What is drawn next, in the maintainer's order:** a PENCIL STUB — the most interesting as a
      concept: a sheet is kept in pencil because its numbers keep changing; then a MINIATURE on
      its base — it is your character on the table. A GM screen's three panels got no yes. Tally
      marks and an hourglass for rounds are undrawn and unjudged.

- [ ] **DAMAGE-GLYPHS · three of the thirteen damage glyphs are redrawn.** A damage type is its
      `DamageIcon` and never a word wherever room is scarce (`../internals/ui.md` ▸ the hit line),
      so a glyph a player cannot name is a type they cannot pick. The maintainer's reading of the
      set in `components/damage-glyphs.ts`:
      - **Piercing** — an arrow in three strokes — does not read clearly as piercing. What replaces
        it is open.
      - **Bludgeoning** — a hammer — is tried as a SLEDGEHAMMER, the two shown side by side.
      - **Acid** — two droplets — is redrawn for certain. The ideas on the table: a broken or
        overturned flask beside a puddle that fumes, or the fuming puddle alone.

      What the new ones answer to is what the set already does: line art in `currentColor` and no
      colour coding, flat path strings on Lucide's 24-unit grid, and legible at 14px, the size every
      caller draws them at. The key list does not change, so nothing that offers or matches a type
      moves. Picked from rendered variants at 14px beside the ten that stay, never from a
      description.

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
     The log holds the whole turn now — what an action spent, began, ended and said
     (`../internals/roller.md` ▸ Conventions) — which is what makes it worth a place that stays.
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

- [ ] **TABLE-ENTRY · where a player looks for the table.** The maintainer, the first time, looked
  for tables beside the roster and did not see the Table item in the menu. A table is sat at AS a
  character, so the roster is where the thought starts; the Table screen is where it lives now. Open:
  whether a character's card (or the play screen) carries a way to the table — join as this
  character, return to the table they sat at — and whether the menu item stays beside it. Decided
  with rendered variants, not names.

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
  The banner stays and says alpha rather than absent. The hit-point block's narrow form — one row
  under the bar, and at 0 hit points the roll and healing as icons between the saves — is the one
  built for now; a second, with the field on its own row and two worded halves under it, is drawn
  in `design-preview/damage-type-under-temp.html` and was passed over, not rejected. Left:
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

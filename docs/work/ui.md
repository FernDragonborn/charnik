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
      **Drawn, waiting on the pick:** `design-preview/favicon-variants.html` — three pencil tips
      (P1–P3, only the sharpened end, the body leaving the frame) and three miniatures (M1–M3), each in a real 16px tab on a dark and a light chrome, each
      with the risk of what it reads as. The miniatures run into a chess pawn at tab size. Once one
      is picked, the SVG goes into `static/` and `app.html`, and `pnpm tauri icon` renders the desktop
      set from it.

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
  everything", and a screen that is 43% furniture (`play-layout.md` ▸ COMBAT-RAIL ▸ 4) cannot answer a visibility
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

- [ ] **KEYBOARD-NAV · the keyboard works by one standard, and the play screen by it first.** The
  maintainer's call: settled before new UI is built, so new UI is right by construction. The
  standard, from the WAI-ARIA APG (<https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/>,
  the Toolbar, Grid, Dialog and Menu patterns), WCAG 2.2 (2.1.4, 2.4.3, 2.4.7, 2.4.11) and
  Microsoft's desktop guidance (F6 between panes): **Tab moves between widgets, never between
  items** — a list, a strip of pills or a row of pips is one Tab stop with the arrows inside
  (roving tabindex or `aria-activedescendant`), remembering its last item; ↑/↓ in a list, ←/→ in a
  strip (mirrored right to left), Home/End to the ends, Enter as a click; a popup takes the focus
  when it opens and gives it back to its trigger when it closes; Escape closes one layer; after an
  action the focus lands on something real (the next row, then the previous, then the list), never
  on `<body>`; a shortcut of printable keys works only inside its widget (2.1.4), a global one takes
  Ctrl and matches `e.code`. Already built and reused: `trapFocus` + `dismissOnEscape`,
  `walkOptions`, `SectionedPicker`'s roving stop, `focusHalo`, `RowGrip`'s arrow move, `takeFocus`,
  `provenance`'s one-layer Escape.
  **What the play screen still breaks** (walked by Tab on the demo character in a browser): 281 Tab
  stops in `main`. Every row's grip is a stop of its own, invisible at rest (`RowGrip`, 41 of
  them); a feature row costs five stops; the combat menus are marked modal but neither take the
  focus nor trap it, and sit after every panel in the page order, so Tab from their button walks
  the whole sheet first (`CombatMenus.svelte`, `+page.svelte`); there is no way between regions but
  the skip link. Each of these waits on an answer below. Not checked: ten controls a script flagged
  as ringless, and whether the sticky top bar ever covers the focus (2.4.11). What is fixed and
  holds: the drag library adds no stops of its own (`NO_LIBRARY_TAB_STOPS`), each panel is a
  landmark named by its title, and removing an item or an effect puts the focus on the same control
  in the row that takes its place (`removeKeepingFocus`).
  **Decided, the maintainer's calls, to build:**
  - **F6 / Shift+F6** walks the top bar, the hero and each panel, a desktop convention rather than a
    W3C one; more region shortcuts may join it later.
  - **A row is ONE Tab stop**; its controls (prepare · cast · pin · …) are cells reached by ←/→, ↑/↓
    walks the rows, and the list remembers its last row (roving tabindex).
  - **A combat menu is a popup that takes the focus and closes when the focus leaves it** — not a
    modal that holds it; Escape closes it and hands the focus back to its trigger. Tried first;
    a modal is the fallback if it reads wrong.
  Open: reordering by Alt+↑/↓ on the row itself (as in VS Code) would take the grip out of the Tab
  order.

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

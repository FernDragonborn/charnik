# The play screen's layout — open work

> Tracker. How the play screen is laid out at each width, where a pin and a request land, and the new
> controls the layout mocks carry. The UI contracts are [`../internals/ui.md`](../internals/ui.md);
> the ORDER is [`plan.md`](../plan.md) ▸ Implementation order.

The play screen has THREE layouts, each drawn as a mock in `design-preview/`:

| layout | who uses it | mock |
| --- | --- | --- |
| **wide desktop** | a desktop window at full size | today's two panel columns; COMBAT-RAIL redraws it |
| **narrow desktop** | a desktop window dragged small — mouse and keyboard | `narrow-desktop-variants.html` |
| **phone** | a finger at 360px, phone-sized text | `narrow-combat-variants.html` |

A frame is cited by its mock and its number: **D4** is frame 4 of the narrow desktop mock, **P11**
frame 11 of the phone mock. A frame the phone mock labels *new idea* is behaviour the app does not
have; *layout*, *flow* and *hard case* place behaviour the app has.

**This splits what `internals/ui.md` ▸ A narrow window treats as one.** That section says a phone and
a small desktop window are the same thing under one 800px threshold; these mocks give them different
layouts, so the section is rewritten in the change that builds LAYOUT-WIDTHS.

Every surface here follows KEYBOARD-NAV's standard (`ui.md`) from its first line, and that item's
open questions (F6 between regions, per-row controls as grid cells) are answered before the columns
of NARROW-DESKTOP are built, because a column card with tabs is exactly a region F6 would walk.

## The layouts

- [ ] **LAYOUT-WIDTHS · what tells the three layouts apart.** The phone and the narrow desktop are
  told apart by the POINTER, not the width — the maintainer's call: a finger gets the phone layout
  (`pointer: coarse`), a mouse gets the column layout however narrow the window, since the narrow
  desktop mock is "driven by a mouse and a keyboard" and a desktop window dragged to 360px is not a
  phone. The column layout begins below 1024px (`COLUMNS_WINDOW_QUERY`), three columns from 760px.
  Open: what a character's saved
  layout (`ui.panelColumns`, the row orders, the pins) means in each — one arrangement read three
  ways, or one per layout. `tools/visual/narrow.mjs` and `shot.mjs` gain the narrow desktop widths
  (512 and 768 are the mock's) beside 393 and 1280.

- [ ] **COMBAT-RAIL · the wide desktop: a scrolling body beside a rail that does not scroll.**
  Three parts, and the third is the reason the other two are not a CSS tweak:
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
     collapsible like the columns are, and how an existing `ui.panelColumns` migrates rather than
     being thrown away. The narrow desktop's fixed top block and bottom log line (D1–D6) are the
     same idea at a smaller width, and the two are drawn to agree.
  4. **How much stands on the resting screen — "too much of everything" from the playtest, counted.**
     At 1536×864 the Combat screen carries **225 controls inside `main`**, 50 visible at once, over
     3.2 screens of scroll. **96 of the 225 are FURNITURE** — drag grips, pins, eyes, own-words
     pencils, show/hide — against 129 that do something to the character. **45 are drag grips alone.**
     So 43% of the controls on the play screen exist to rearrange the play screen.
     The reason that reads as clutter rather than as richness: furniture is BIMODAL. A sheet is
     arranged once and played for months, so those 96 stand permanently for an act performed rarely,
     while the 129 are wanted every turn. The phone mock answers it with ARRANGE-MODE; furniture
     revealed on row hover is rejected (dead on touch, twitchy across twenty rows). Whether the wide
     desktop takes the same answer is this session's call, made on a rendered variant.

  Nothing here is blocked on code. What it needs first is RENDERED variants of the wide desktop.

- [~] **NARROW-DESKTOP · the column layout for a small desktop window** (`narrow-desktop-variants.html`).
  A fixed top — the character in one block, one strip that becomes the turn — the last roll at the
  bottom, and between them columns about 250px wide, each a card whose title is its tabs; the window
  decides how many stand side by side.
  **Built** (`../internals/ui.md` ▸ A narrow window): the layout below 1024px for a mouse, two
  columns dealt as the mock deals them and three from 760px; the top block with the name, the hit
  points and AC opening their popovers (D5, D10, D11); the Skills tab carrying the abilities, the
  passives, the defenses and the resources; a spell row in two lines in a column. **Left:** the
  effects as chips in the top block (the mock's `◎ Hex ✕ Shield of Faith …`); the strip as the mock's
  one line — today the controls and the time slide sideways; the hit-point popover as the mock's
  field and two buttons rather than the wide screen's whole block; a column's chosen tab kept across
  a reload; D12–D15's slot cells and the ritual and blocked readings; the widths in
  `tools/visual/shot.mjs`.
  - **D1–D3 · a third of the screen, 512px: two columns, six panels.** Actions beside Skills (what
    the character does on the left, what is looked up on the right; neither scrolls), Spells beside
    Effects (concentration, bonus action and reaction marked; an action carries no mark), Items
    beside Features (a count opens under its ×N; twenty features fit while closed).
  - **D4 · the mouse in combat.** The strip is the turn; a number explains itself at the pointer
    (the provenance popover, `internals/ui.md` ▸ rule 3); a feature opens in place.
  - **D5 · clicking the hit points** opens damage, healing and temporary hit points in one popover;
    exhaustion lives there too and becomes a chip in the top block once above 0.
  - **D6 · half the screen, 768px: three columns**, the six tabs dealt into three groups; the
    hit-point field has room to stand open in the top block.
  - **D10 · clicking the AC** shows what it is made of, then the defenses and the senses — the same
    content as DEFENCE-STRIP (`ui.md`), so the two are decided together.
  - **D11 · clicking the name** shows level, proficiency bonus, species, background, rules edition
    and advancement mode — what the title line carries today. In the narrow window only, so the top
    block keeps the name and the numbers; the maintainer's call.
  - **D12–D15 · spells with slots in one column.** A level-20 wizard: one cell per level on top says
    what is left, and the pips on a level's own line spend and restore (D12). The arrow at a row's
    end picks which slot pays, with the dice each level buys; R casts as a ritual (D13). Two casting
    classes: each tag carries its own DC and attack, so nobody asks which applies (D14). When
    nothing can be cast, the reason stands on top and everything under it greys out (D15).
  - The 0-hit-point states (D7–D9) are AT-ZERO-HP's.

- [ ] **PHONE-PLAY · the play screen on a phone** (`narrow-combat-variants.html`, 360px, phone-sized
  text). It replaces MOBILE-ALPHA's narrow layout. A top block — name, ⋯, hit points, AC,
  Initiative, Speed, the effects row — then the tab's content, then the log's strip, then a tab bar:
  **Mine · Actions · Spells · Skills · Items · Bio**.
  - **The tabs.** *Mine* is the character's pinned set — RESOURCE-PIN's answer (P1). Out of combat,
    combat, rests and time sit under the vitals on every tab (P1); in combat that strip becomes the
    turn — round, movement, Next, ✕ ends combat (P2). *Actions* lists what this character does by
    action, bonus action and reaction; the standard actions wait behind one row that opens a list of
    words, not icons, and closes after the tap (P3, P3b). *Skills* is the six abilities with their
    skills grouped under them, tools last, passives at the foot (P4). The bar is the character's tabs
    spread evenly; a tab with nothing in it is not drawn, a tab the player hid is not drawn, and a
    character who wants only Mine has no bar at all (P8).
  - **Rows.** Holding a row — right-click on a desktop — opens why its number is what it is, the
    roll's swing (disadvantage · roll · advantage), Pin to Mine and Open in the compendium (P10).
    Tapping a feature opens its text, the player's own wording and the pin (P17); closing the own-words
    box keeps the text, an arrow restores the original, and a toast offers Undo (P45, P45b).
  - **Items and Bio.** Items is one line each under foldable categories — Equipped & attuned,
    Consumables, Armor & weapons not in use, Gear — with load, attunement and coins on top (P13);
    tapping an item shows everything it can do: damage, weight and value, quantity, equip, pin,
    compendium, remove (P14). Adding an item makes the whole row the target and shows a taken item's
    count with the way back (P41); using a consumable spends one and says so, and the last one leaves
    the list (P47). Bio has three inner tabs: About (portrait, backstory), Features (everything the
    character has, with the app's own filters), Notes (P16–P16c).
  - **Spells.** Filled dot prepared, ring always prepared, a mark for concentration (P21). Tapping a
    spell casts it: the slot is spent, the dice rolled, the save named (P22). Holding one shows what
    pays for it, whether it is prepared, and the pin (P23). The reason a spell cannot be cast stands on
    top and the rows grey out (P24). Which slot pays lists every level that can, with the dice it buys
    (P33), a number when a higher slot buys something else (P33b, Hold Person), and the spell's own
    sentence once on top when it says it only in words (P33c). A ritual offers both ways with what
    each costs (P34). A level-20 wizard's slots: the whole level header is the target and opens a
    stepper with Restore (P5) — which is what MOBILE-ALPHA's too-small slot pips lacked.
  - **Rolling.** One tap on an attack rolls to hit and damage, and the log's strip grows into the
    result (P18); a natural 20 is gold with doubled dice (P19); the dice button, or "Roll…" in a
    row's menu, opens the tray, where a tap on a token changes it (P20) and "± mod" opens NUMBER-PAD,
    never the phone keyboard (P20b). Tapping an ability opens a box with its check and its save as two
    big buttons (the unnumbered frame after P31). Two attacks in one action are MULTI-ATTACK-RESULT.
  - **States and resources.** AC shows its parts, the shield where its number is, the defenses and
    senses (P6). The hit-point block is the app's own, photographed at 360 (P25, P25b, P40 — its
    redraw is AT-ZERO-HP). Short rest spends hit dice here; a long rest needs no sheet, it restores
    and says so (P26). "+N ›" opens every effect behind the row's chips (P27); adding a condition is a
    list to tap, typing only narrows it (P28); the effects row never disappears, its last chip is the
    way in (P31); how long an effect lasts sits behind its duration (P42); a custom modifier is a stat,
    a sign and an amount (P43). Resources sit in one card, and an active Rage shows where it bites
    (P29). Wild Shape shows the beast's numbers, says the character's own hit points wait, and offers
    the table choice of what the form keeps (P32). Passing time sits behind the clock, each step
    expiring what runs out; dawn and dusk appear only when something on the sheet returns then (P36).
    A notice takes the log's strip for a moment, then is a line in the log (P37); a second
    concentration spell moves concentration without asking and the notice says what ended (P38). A
    question before something is paid shows what each choice costs, and closing it spends nothing
    (P48). Movement: a tap spends a step, the chip counts down, holding it sets the step or resets,
    and the next turn refills it (P49); tapping Speed in the top block only explains the number (P49b).
  - **The table** on a phone is TABLE-REQUEST-PLAYBAR's phone answer and TABLE-ENTRY's seat mark.

- [~] **MOBILE-ALPHA · the narrow layout is usable, not finished.** Nothing overflows any more: at
  393px and 320px, in English and Ukrainian, no route scrolls the document sideways and no box inside
  `main` escapes it. The one threshold and the rules behind it are
  [`../internals/ui.md`](../internals/ui.md) ▸ A narrow window; the check is `tools/visual/narrow.mjs`.
  The banner stays and says alpha rather than absent. The hit-point block's narrow form — one row
  under the bar, and at 0 hit points the roll and healing as icons between the saves — is the one
  built for now; a second, with the field on its own row and two worded halves under it, is drawn
  in `design-preview/damage-type-under-temp.html` and was passed over, not rejected. It closes when
  PHONE-PLAY replaces it; until then two tails stand, and PHONE-PLAY answers both:
  - [ ] **The row drag handle cannot pass the finger probe, and should not try.** `span.row-grip`
        is 6px wide and misses 2 of 8 probe points — the two horizontal ones, 11px either side of the
        mark: the left lands on the card's own border, the right INSIDE the row's hover pill. Passing
        needs a 24px target and the whole gutter between card edge and row is 10px, so the only way
        through is to overlap the row — and a handle that swallows taps meant for the row it sits
        beside is worse than one that is hard to hit. An invisible `::after` expander reaching back
        across the card's padding was TRIED and removed — measured, it changed the count not at all.
        The answer is ARRANGE-MODE: grips appear only while arranging (P9).
  - [ ] **Four tap targets, all of them in combat.** Hit-tested at 393px rather than measured as
        boxes: the controls that LOOK broken (`.prep` at 8×8, `.pin-star` at 18×18) already carry a
        `::before` expander and fill a finger square, and every route but combat comes back clean.
        What is left is `.slot-pip` (12×12, misses 4 of 8 probe points), `.resource-pip` (12×12,
        misses 1), exhaustion's `.pip` (22×10, misses 2), and the inventory row's quantity stepper
        (22×22, misses 1). Each sits ~4px from a neighbour, so the `::before` trick cannot grow it
        without stealing the neighbour's taps. PHONE-PLAY replaces each with a larger target: the slot
        level header opens a stepper (P5), the quantity lives in the item's own box (P14), exhaustion
        sits behind the hit points (D5). `tools/visual/narrow.mjs` prints the list on every run.

## Controls the layouts share

- [ ] **ARRANGE-MODE · one switch for all the furniture** (P9; COMBAT-RAIL ▸ 4). A sliders icon in
  the title bar turns arranging on: grips, pins, eyes and the tab switches appear together, and Done
  hides them. While it is off, a row carries no furniture. Its reverse state is the same switch, and
  a hidden tab or panel is shown again from inside arranging ("Show the Actions tab").
  **A wave of its own** — the maintainer's call: neither the wide desktop nor the new layouts take it
  before that wave, so until then the furniture stands where it stands today.

- [~] **ROW-MENU · hold a row, or right-click it** (P10, P14, P17, P23): the one place a row's
  secondary acts live — why the number is what it is, the roll's swing, Pin to Mine, Open in the
  compendium, and the row's own acts (Remove, own words). It is reached from the keyboard too, by the
  context-menu key and Shift+F10, per KEYBOARD-NAV. On a row it takes the browser's own context
  menu's place — the maintainer's call.
  **Built** (`../internals/ui.md` ▸ Accessibility): the right click, the context-menu key and
  Shift+F10 open it on a skill (its parts and the check with a swing), a spell and a feature (the
  pin, the article) and an item (the article, Remove). **Left:** the HOLD on a finger, which today is
  how a row is dragged — it arrives with PHONE-PLAY, once dragging is ARRANGE-MODE's; the attack and
  action rows; a spell's parts; the own-words editor in the menu.

- [ ] **RESOURCE-PIN · pin ANY trackable thing to the play surface, not only spells.** Asked for in
  feedback. Today `ui.spellsPinned` pins spells to the top of the combat spell list and nothing else
  can be pinned — so a Barbarian hunting Rage, or a player who wants the two potions they are actually
  carrying within reach, scrolls a panel for them mid-turn.
  **The shape already exists and is the cheap half**: a pin is a per-character array of refs on `ui`,
  and `spellsPinned` is exactly that, keyed by the same `type:source:id` identity everything else uses.
  So a resource and an inventory row pin by their own refs through the same mechanism.
  **Where a pin lands is the phone mock's Mine tab** (P1): one surface that spans attacks, spells,
  actions, resources, skills and items, reached by ROW-MENU's Pin to Mine. Open: where Mine stands on
  the narrow and wide desktop, which have no tab bar — a panel of its own, or the top of the rail.
  **One rule it must not break:** a pin is a VIEW preference. It never changes what a character has,
  and un-pinning is always one click from where the pin shows (`AGENTS.md` ▸ Reverse states).

- [ ] **NUMBER-PAD · one pad for every amount** (P7, P15, P20b). A keypad with the amount on top,
  never the phone's keyboard. For damage it shows every damage type as its glyph with the
  character's defenses marked on them, and says what the hit becomes after them ("Fire · ½ resist →
  takes 6"), then Damage, Heal, Temp HP (P7 — *new idea*). For coins it spends or gains an amount
  instead of five fields (P15 — *new idea*). In the roll tray "± mod" adds to the lit line (P20b).
  On the desktops it is an option, not a replacement: a keyboard types the number.

- [ ] **AT-ZERO-HP · the top block at 0 hit points is redrawn** — both desktop mocks mark it *to be
  redone*. Dying: the number's line becomes the saves, the roll and healing, and the block keeps its
  height (D7). Stabilized: the verdict in a word and the way back (D8). Dead: the reason on hover, the
  one button the way back (D9). The phone mock photographs today's block (P25b, P40); the hit-point
  block's options behind its pencil choose which motion plays at 0 (P44).

- [ ] **MULTI-ATTACK-RESULT · two attacks in one action, shown at once** — Eldritch Blast's beams.
  Two variants, picked from the render: **46A** a sentence per attack (hit, an arrow, its damage)
  packed together with the dice filling the rest, **46B** the single attack's card once per attack.

## New behaviour the phone mock proposes

- [ ] **INITIATIVE-OFFER · starting combat offers the initiative roll** (P30 — *new idea*). The app
  starts round 1 and asks nothing; the strip offers "Combat started · initiative · Roll +4". It only
  suggests — ignoring it changes nothing (`AGENTS.md` ▸ a play-tracker never auto-applies).

- [ ] **MINE-STARTER-SET · a new character's Mine is never empty** (P39 — *new idea*). Its attacks,
  prepared spells and resources are offered as a set, with the line "Rearrange or unpin anything
  later" and how to pin by hand. Offered, not imposed: declining leaves Mine empty with that hint.

## The table on each layout

- [~] **TABLE-REQUEST-PLAYBAR · a GM's request waits beside the sheet, not over it.** The wide
  desktop's form is built (`../internals/table-link.md` ▸ A request waits beside the sheet): the
  playbar holds it, the log puts it first with every answer, and the dialog asks on every other screen and below the narrow
  threshold. The guarantees stay on every layout: no answer by Escape or a click elsewhere, the hit
  after defenses, the count waiting behind it, a blocked answer with its reason, and nothing applies
  itself. Left:
  - **Phone — drawn** (P2, P11, P12, P35): the request sits in the log's own strip on every tab,
    under the thumb ("GM asks · DEX save · Roll +2"); its count opens the queue — what is owed, then
    the log — and incoming damage shows what it becomes after your defenses with Take it.
  - **Narrow desktop — not drawn.** H2 adapted to the bottom log line of D1–D6; drawn with
    NARROW-DESKTOP.

- [ ] **TABLE-ENTRY · where a player looks for the table.** The maintainer, the first time, looked
  for tables beside the roster and did not see the Table item in the menu. A table is sat at AS a
  character, so the roster is where the thought starts; the Table screen is where it lives now. The
  phone mock puts a seat mark in the title bar once seated, which says so and leads to leaving (P35b:
  "Seated. The GM sees this character's sheet and can ask you for rolls."). Open: whether a
  character's card carries a way to the table — join as this character, return to the table they sat
  at — and whether the menu item stays beside it. Decided with rendered variants, not names.

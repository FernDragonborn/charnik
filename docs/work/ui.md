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

- [x] **DEFENCE-CHIPS-UNSEEN · they have been looked at now, and two of them were wrong.** The
  qualified defences and the incoming-attack statements had never been rendered, because the eleven
  items that grant one are on no character any covered state loads.
  **They have a state of their own now** — `/dev/defences`, a draft wearing one item per chip KIND
  (Arrow-Catching Shield, Mantle of Spell Resistance, Cloak of Displacement, Spellguard Shield), in
  `shot.mjs` at both widths, so this cannot go unseen again. The draft is written directly rather than
  through the inventory API because each item REQUIRES ATTUNEMENT to confer anything and attuning is a
  play-sheet control — the builder has none, which is the other half of why the card never showed one.
  **What looking found:**
  - **English read "spells attacks against you have disadvantage."** One qualifier vocabulary served
    two grammatical positions: `vs {kind}` wants a noun ("vs spells"), `{kind} attacks` wants an
    adjective ("spell attacks"). `qualifierAttributive` is the second one. Ukrainian never had the bug
    because its template parenthesises the qualifier instead — so its entries are the nominative gloss
    the parenthesis wants, where the noun list is genitive.
  - **Ukrainian read «перевага на рятівних кидків»** — «на» does not take that case. The template is
    «перевага для {stat}», which the genitive the target word already carries is correct with.
  - **The strip WRAPS at 393px** and overflows nothing, at either width. ✓
  **The tail — that the six read as one undifferentiated list — is its own item below** (DEFENCE-STRIP),
  because looking at variants turned it from a styling question into a question about what the strip
  is a list OF.

- [ ] **DEFENCE-STRIP · what is true of your body is ONE row, and its groups name what moves.**
  Two things are wrong at once, and the second is why the first is not a five-minute fix.

  **There are two implementations.** The play sheet has `sensitivities-strip` (`CombatStrip.svelte`),
  which groups: a `def-label` then its chips — `Resist · fire`, `Immune · poison`. The builder has a
  flat `.tags` row (`SheetDefenses.svelte`) with no grouping at all. They know different SETS, too:
  only the builder reads `qualifiedDefenses` and `incomingAttacks`, so the eleven shipped items that
  grant one say nothing on the screen a player actually has open at the table. A Cloak of Displacement
  explains itself to whoever is building the character and stays silent during the fight it is for.
  **The better row is the COMBAT one** — it already answers "are these different kinds of statement"
  with a label, which is the thing the builder's flat list cannot do. So the builder adopts it, not
  the other way round.

  **The axis the groups sort on is WHOSE DIE IT IS**, and the types already say so. A
  `QualifiedDefense` carries `target: 'ac' | 'saves'` — it moves YOUR number or YOUR roll.
  An `IncomingAttack` carries no target at all, and that absence is the whole point of the type: the
  die is the attacker's, which is why `attacked` is a channel of its own rather than a scope on
  `attack` (it would otherwise land on the swing you throw).

  **A qualifier is NOT that axis, and a first pass at the labels got this wrong.** "Only vs" was tried
  as the group name for a qualified defence, and it reads well until you notice `IncomingAttack.scope`
  exists too — Spellguard Shield is `disadvantage:attacked.spell`, which is equally "only vs spells".
  The scope belongs in the CHIP, as the case, and never in the group label, which is for the subject.

  **So each group names what moves**, and the one whose subject is somebody else says so:

  ```
  Resist        fire
  Immune        poison · charmed
  AC            +2 · against ranged attacks
  Saves         advantage · against spells
                advantage · against magical effects
  Against you   attacks: disadvantage
                spell attacks: disadvantage
  Senses        darkvision 60 ft
  ```

  **OPEN, and the reason this is a session rather than a commit: the `Saves` group is not formatted
  right yet.** The shape above is close enough that the idea reads, and it is still wrong — two rows
  under one label, each a swing plus a case, is the part that has not found its form. Everything else
  here is settled. Next variants start from `Saves`.

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

  **Two defects found while rendering it, both cheap and both real:**
  - `.def-chip` sets `text-transform: capitalize`, so the play sheet already reads "Darkvision 60 Ft",
    and the moment a chip can be a whole sentence it would capitalise every word of one. The capital
    belongs to the label that builds the string, not to a blunt CSS rule.
  - A group is `[label + chips]` on one line, which stops working at 393px once a chip is a sentence:
    the label splits across two words and the chip wraps mid-phrase. One group per line (a full-width
    group with a fixed label column) fixes both, and it is one rule.

  The variants are `design-preview/defence-chips-variants.html` with `_defence-variants.png` and
  `_defence-variants-narrow.png` beside them; `/dev/defences` is the live state, already in `shot.mjs`
  at both widths.

- [x] **PANEL-COLLAPSE-PERSIST · a collapsed panel stays collapsed.** `ui.panelsCollapsed` holds the
  ids that are folded away, the way `actionsHidden` holds the ids that are hidden — additive, absent
  means expanded, so every save written before this opens exactly as it did. `PanelLayout` takes the
  same shape of `persist` callback the columns already had rather than a second mechanism, so the
  stated invariant (`../internals/ui.md`: every panel collapses, reorders and hides, and that
  arrangement is per character and lives in `ui`) is now true of all three thirds.
  **The one thing it must NOT do is reconcile against the panel list.** The same record holds the two
  sheet SECTIONS — `abilities` and `combat` — which have no card and sit in no column, so a
  `known`-panel filter of the kind `restore` applies to the columns would silently re-open both on
  every load.
  Driven in chromium on the demo character: the Skills panel's `aria-expanded` and the Abilities
  section's grid both survive a reload collapsed, and both come back when re-opened.

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
  mid-fight, no visible close, and the list running past the panel's bottom edge.
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

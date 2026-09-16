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
  - [ ] **Touch targets inside the views.** The chrome is done — nav rows and the icon-only chips are
        32-36px — but the combat view still draws thirteen kinds of control under 24px, measured at
        393px: `.prep` at 8×8 is the worst, then `.slot-pip` and `.resource-pip` at 12×12 (the second
        grows to 18 through its `::before` inset), `.cast-icon` 12×17, `.pin-star` 18×18,
        `.name-cast` 51×20, `.ability-save` 98×21. The `::before` inset is the pattern to extend,
        because it grows the target without moving what is drawn — but the pips sit 4px apart, so a
        blind −6px would overlap its neighbour and turn a small target into a wrong one. **This one
        wants a phone in a hand**, not a driver: which of them to grow and by how much is a mis-tap
        question. The exhaustion gauge is already covered — its 22×10 pips are a shortcut beside a
        full-size ∓ stepper that does the same job.
  - [ ] **No narrow baseline.** `shot.mjs` renders at 1280 only, so a regression here shows up as
        overflow or not at all, never as a pixel diff.

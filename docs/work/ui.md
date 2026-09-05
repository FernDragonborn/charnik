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
  - [ ] **The sectioned picker's ARIA shape — a ONE-COLUMN `grid`, and `combobox` comes off.**
        The section-header `<button>` is the least of it. `role="presentation"` on `.srow` does not
        hide its descendants (ARIA 1.2 §presentation exposes non-presentational children), so the
        listbox's illegal children are not 8–14 headers but **658/773 `.addbtn` take toggles** — and
        the escape hatch is shut, because `option` is Children-Presentational, so moving the toggle
        inside the option flattens it to text an AT user cannot reach. ⇒ **`listbox` structurally
        cannot express two independent controls per row**, which `ui.md` ▸ picker contract rule 6
        ("reading and taking are separate controls") makes non-negotiable. That, not the header, is
        why the role has to change.
        `role="combobox"` is wrong for a second, independent reason: APG defines a combobox as
        **single-select with selection following focus**, and this picker is multi-select whose
        arrows deliberately never commit (`option-walk.ts`). `aria-activedescendant` is what was
        actually needed, and MDN names `searchbox` alongside `combobox` as a valid holder of it — so
        the role goes and nothing is lost.
        **Shape: one cell per row.** `role="grid"` + `aria-multiselectable`; a header is a `row`
        carrying `aria-expanded` (which `row` supports natively) around one `gridcell` holding the
        real button; an option is a `row[aria-selected]` around one `gridcell` holding both buttons.
        One column means no `aria-colspan`, no Left/Right walk to define, nothing to mirror in RTL,
        and no "column 1 of 2" for any screen reader to say — the two-column shape imports exactly
        the verbosity this was worried about, for a split carrying no information. **No `subgrid`**:
        `.rows` is a flex column, not a shared grid, so a plain wrapper is already zero pixels.
        Keep `aria-activedescendant` naming the **gridcell** and never a header — NVDA #16414 drops
        out of forms mode when it names a non-gridcell, and `walkable` already excludes headers, so
        this is an invariant to assert in a test rather than a change.
        Rejected: one listbox per section (does not fix `.addbtn` at all, and `aria-activedescendant`
        is defined against ONE controlled element); a non-interactive header (same, plus its stated
        fallback does not exist — `jumpTo` only ever ADDS to `openKeys`, so the rail cannot collapse
        one section, which would make this a one-way door); `role="tree"` (`treeitem`'s superclass is
        `option`, so `.addbtn` is unsafe there too).
        **Hand-test when it lands** (interaction, so it is confirmed in the running app): the sticky
        header is the likeliest silent regression — `position: sticky` must move onto the new row
        wrapper or the header can no longer travel; a collapsed section must still not hide a search
        match; Home/End stays as it is (already APG-correct); no first-letter type-ahead (printable
        keys belong to the search box); Enter-Enter still takes; RTL; and `Inspector.svelte`'s
        `OPERABLE` list mentions `[role="option"]`, which disappears.
        **`ui.md` ▸ picker contract says the search box is a `combobox`** — true of the code today,
        and it must be rewritten in the same commit that changes it.
  - [ ] **Keyboard navigation past the double-Enter take.** The walk moves the highlight and takes,
        but does not reach the take toggle, the jump rail or the card's own controls without `Tab`.
        Roving tabindex inside the row; **the jump rail stays its own tab stop** rather than joining
        the arrow cycle, so the arrows keep meaning one thing.
- [ ] **N5 · Adjacent gaps (assistant's additions).** (1) **DONE** — the Features panel. A character
  can read their own class features, species traits, background and feats on the play sheet, as
  separate sections and never one blob. It reads `character/features.ts`, NOT the sheet's effect
  list: the gather keeps only rows carrying effect TOKENS, so a feature made purely of prose — most
  of them — never reaches it. Each row is a native `<details>`, which is already everything a
  read-only list needs. `activeClassFeatures` moved there too, so the builder and the play sheet
  share one gate instead of two that drift. (2) **DONE** — concentration check prompt on damage (CON save DC
  max(10, ⌊dmg/2⌋)) now toasts a reminder in `damage()` (see the CONCENTRATION entry). (3) Death saves + exhaustion UI (→ B2).
  (4) Ammunition as consumable — tracking OFF by default (a toggle
  that exists but is never enforced; ~99% of tables don't track ammo). (5) Short-rest
  hit-dice UI (→ UBUG-1/B2). (6) **DONE** — the builder pickers carry search, and the two big ones
  carry the level/category sections and the school/concentration/ritual facets that keep a long list
  navigable (the picker contract, `docs/internals/ui.md`). (7) Multiclass: combat preparedCap reads
  classes[0] only. (8) Sneak Attack "once per turn" — first per-turn-limit case; manual
  toggle first, automation later.
- [~] **ARCH-1 / B8 · i18n sweep of combat + build.** `build.*` is done (270 keys). `combat.*` covers
  the page chrome, the section headers, the ability grid, the skills list, the defenses strip and
  every damage type.
  **A roll's NAME travels as a catalog key, not as a translated sentence.** `RollLogEntry.labelKey`
  carries it and `RollRow` is the one place it becomes a word — the same ruling amendments got, and
  for the same reason: `logLineFor` writes the entry verbatim into `log.jsonl`, so a localized label
  would freeze that roll in whatever language it was made in and switching the UI afterwards could
  never reach it. Translating display and label together — the plan this item used to carry — would
  have reintroduced exactly the defect it was ordered to avoid. `label` stays beside the key as the
  English fallback, which is also all a custom roll or a homebrew spell name ever has: a content
  row's own word is DATA and passes through untranslated.
  **A content issue's sentence is a catalog key, chosen in `issue-text.ts`.** The loader has no
  locale and the panel is re-read after a language switch, so the copy cannot be composed where the
  fault is found. Two values are not literals and `issueMessage` resolves them: a content TYPE reads
  through its own catalog, and the "did you mean" candidates need the reader's own word for "or".
  Where the wording branched on a suggestion being close enough, it is two whole keys, not a sentence
  glued from halves.
  **A label the PLAYER can rename is written in their language, not kept as a key.** The custom
  modifier's default name ("+1 to AC") is their own effect's title and editable the moment it exists,
  so `modTargetLabel` composes it through `translator()` — the live catalog handed to a pure
  formatter from outside a component, which reads the store per call and so survives a switch. That
  is the opposite call from a roll's name, which the log re-reads long afterwards and therefore keeps
  as a key; the difference is who owns the string after it is written.
  **An ability's short name is `abilityShortLabel`, and nowhere else.** The builder printed the id
  (`{ab}` under `text-transform: uppercase`, `ab.toUpperCase()`) in a dozen places, so a Ukrainian
  sheet said STR where the play sheet said СИЛ. One helper in `util/format.ts` owns the catalog name
  and the upper-cased id as its fallback; the sheet diff's labels travel as `abilityShort.<ab>` and
  `combat.roll.save.<ab>` keys rather than as English text.
  **A trace's engine-written labels are keys; a content row's name is not.** `Contribution` carries
  `key`/`noteKey`/`params` beside its English, and `sourceText` words them where the translator is —
  the same split `formatNote` makes. "Cloak of Protection" carries none and passes through, because no
  catalog knows a user's own row. The ruling is in `docs/internals/rules-core.md`.
  **A forced outcome is a fact on the entry, not a word in its label.** `RollLogEntry.outcome` carries
  it and `RollRow` says "{label} — auto-fail" around the name the label key already produces — a
  marker holds ONE key, so the sentence could not have been one. It also has no total: a marker threw
  nothing, and the number column now stays empty instead of printing the record's `NaN`.
  **An item tag's word lives in the catalog, not in a table in code.** `itemTagLabel` is a lookup with
  the raw tag name as its default, so the app-known vocabulary (`two_handed` → "two-handed", "дворучна")
  is 22 catalog entries and a homebrew tag still reads exactly as its author wrote it. An attack row
  carries its `AttackMeta` tags and `attackMeta` words them; a tag's VALUE (`versatile 1d10`,
  `thrown 20/60`) is data and passes through.
  **An attack row's notes are FACTS, not a sentence.** Each is a `Note` — the same `{text, key, params}`
  the engine's own rule notes carry — and `attackNotes` words them at the panel, where `$_` is. The one
  thing that could not be a key is an effect token the build cannot fold: it travels whole
  (`{token}`) and becomes a tag through `effectTag` in the same place. Threading a translator into
  `computeAttacks` instead would have frozen the language: the view-model derives the attack list off
  `app.activeLocale`, which the layout pushes into `svelte-i18n` in an EFFECT — so a translator read
  there is one locale behind, and never re-read.
  **A roll label is one whole phrase per key, never `{ability} check`.** Interpolating a noun into a
  phrase is what breaks in an inflected language — Ukrainian needs "Перевірка СИЛ", which no
  substitution into an English frame produces. Twelve flat keys cost nothing and let a translator see
  the sentence.
  **What is left:** the DERIVE-TIME issues — every `issues[].reason` in `derive.ts`, `apply.ts` and the
  plugin host is still an English sentence built where the fault is found. The content half is done
  and is the pattern to copy: an issue travels as `{key, values, detail}`. VM toasts read the store one-shot inside a function (`get(_)`): a toast is
  fire-and-forget, so that is correct — never at module top level, where it would freeze at the
  load-time locale. UA copy uses formal «ви» (docs/internals/ui.md ▸ Accessibility).
  **A locale is not free of layout consequences:** the turn bar's container-query thresholds are the
  MAX over shipped locales (Ukrainian labels run ~15px wider than English), and `container-type`
  zeroes the min-content floor, so a too-narrow threshold clips rather than pushes. Re-measure per
  the recipe in `Turnbar.svelte` when a locale is added.
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
  **Factual correction to the translation argument:** text volume is not the binding reason to prefer
  interactive. The whole combat/play surface is currently **un-localized** — `$_(` appears in exactly
  zero files under `src/routes/combat/`, and en.json has no `combat.*` namespace at all (see ARCH-1
  above). Onboarding would add on the order of ten strings; localizing combat is hundreds. Constraint
  (b) — tutorials repel — stands on its own and is the real reason.
- [x] **UX-1 · Error copy pass.** Every failure message rewritten for the person whose data it is,
  with the technical particular demoted to a `detail` line rather than deleted. The standard, the
  `detail` contract and where the copy lives are `docs/internals/ui.md` ▸ Error copy; tests assert
  the identifier, never the sentence.
- [ ] **PORTRAIT · a character has `build.photo` in the schema and no way to set one.** Nothing under
  `src/routes/build/` writes it. Its own piece because of an ordering problem, not a UI one: the file
  write goes through `Storage` and a character has no folder until it is saved, so a portrait chosen
  during the build has nowhere to land yet. `characters.md` already says a photo is a SIBLING file
  referenced by name, never base64 in the JSON — so the answer is where the bytes wait, not how they
  are stored.
  **The bytes wait in memory**, as one downscaled blob on the draft, previewed through an object URL,
  and land in the character's folder in a single `Storage` write when it is first saved. **Downscale
  at PICK time** (longest side ~512px): the picker hands over whatever a phone camera produced, and a
  12 MB JPEG in a folder the user is told they own is a worse gift than a resized one. Losing the
  photo when an unsaved build is abandoned is how every other draft field already behaves.
- [ ] **A11Y-LISTBOX · three more listboxes claiming something they are not.** Found by the same rule
  that condemned the sectioned picker, so they belong in that change rather than in three visits.
  `SectionedPicker` and `OptionGrid` set `aria-selected` per row independently while declaring a
  listbox with **no `aria-multiselectable`** — a single-select list reporting twenty selected options.
  `LanguagesPane` already gets this right, so the house has one name for the fact and two of three
  call sites ignore it. Worse, **`LanguagePicker` is a `role="listbox"` containing an `<input>`,
  section headers and bare `<button>`s with no `role="option"` anywhere** — a listbox with zero
  options. `CommandPalette` is the one place the combobox/listbox pair IS correct (single-select,
  selection follows the highlight, transient popup); `ui.md` should say why it differs.
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

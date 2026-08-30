# Builder plan — sheet + inspector

Working artifact for **docs/plan.md N3** (Builder/level-up redesign). Delete this file when the last
box is ticked and what remains of N3 is folded back into `docs/plan.md`.

Source of the design: the `Builder Sheet Inspector.dc.html` mock in the Claude Design project
`f55359dd-bd97-44d6-9480-5f98dda48384`. It fixes the **vibe and the structure**, not the pixel
layout — baked in spirit, geometry refined against real data.

## The shape

Two panes, full-bleed, each scrolling on its own.

**Left — the whole character sheet, always live.** Not a form. Every block renders what the draft
currently derives, and every changeable thing on it is a click that opens the inspector on that
choice. An unfilled thing renders as an empty slot that says what it will give, in crimson.

**Right — the inspector (`clamp(480px, 32vw, 680px)`).** One choice at a time: what it is, the options with their
compendium prose (the reused `WikiDetail` — one article renderer, never a builder-only summary), and
**what taking it would do to the sheet** — computed by really applying the candidate to a trial draft
and diffing the two derived sheets (`BuildVM.previewSheet` → `diffSheets`). Nothing is picked blind;
that is the whole point of N3.

**Every pick of a content row reads the whole article before committing, including the multi-select
ones.** Spells and equipment are chosen the same way a species is: search, read, commit. The two
shapes and everything that governs them are the **picker contract** in `docs/internals/ui.md` —
`OptionGrid` for the six small pickers, `SectionedPicker` for spells and equipment, both opening the
reused `WikiDetail` in a card beside the picker. A wall of name-only chips is not a picker: fifty SRD
spells with nothing but their names is picking blind, which is the one thing this page exists to
prevent. An entry earns its space by carrying what decides the pick — for a spell, school, an unusual
casting time, range, damage, save, concentration (`pickerMeta` → `entryMeta`), never the name alone.

**Taking has NO confirm step, and it is not the same click as reading.** The toggle on a row takes it
and takes it back; the row body opens the article, which repeats the take where the eyes already are.
A one-of pick replaces rather than toggles, and `Clear` in the pane footer is its way out. Arrow keys
only ever preview; Enter is the click.

## Decisions taken

- **No mode switch.** The mock's "Веди мене / Повний лист" toggle is not built: only the full sheet
  exists. A guided flow is a second entry point onto the same view-model later — the reason the
  inspector's targets are a data descriptor and not a wizard step list.
- **Level-up reuses this page** (`?levelup=<slug>`), as it does today.
- **Any starting level.** A character is not necessarily built at level 1: every subclass and every
  ASI/feat slot the chosen levels opened is its own todo line, and the class-features list shows every
  level up to this one plus a three-level look-ahead. Jumping straight to level 8 cannot silently skip
  three choices.
- **The player is held here until the required fields are filled.** `blocking` gates Create. Leaving
  is not intercepted: the draft autosaves to `character-drafts/<guid>.json` and waits in the roster,
  so there is nothing to warn about (`docs/internals/characters.md`).
- **Per-target inspector layouts.** One shared shell (title, blurb, footer); the body is a component
  per target, because a feat slot and an ability allocator are not the same question.
  `/dev/inspector` renders every target at once so a regression in one is visible at a glance.
- **All copy is in the i18n catalogs** under `build.*`, English and Ukrainian. Nothing user-facing is
  a literal in a component, a view-model, or a pure module: `buildTodos` and the inspector's target
  descriptors carry catalog KEYS plus ICU values, and the component that renders them translates.
  `src/lib/i18n/catalogs.test.ts` asserts key parity and placeholder parity between locales.
- **The social read-out is derived, not invented.** Three bars — Sway, Read the room, Lore — each the
  best passive among its skills, scaled 5…30 (`lib/build/social.ts`). It re-presents numbers the sheet
  already computed and changes no mechanic; the hover carries the winning skill's provenance.
- **Story is free prose** in `build.notes`, one bullet per line. Goes to the GM.
- **Prose on the sheet is markdown-stripped** (`rowText`): a two-line clamp is not an article, and
  `_Origin Feat_` reading as literal underscores is worse than losing the emphasis. The full article,
  markdown intact, is one click away in the inspector.

## Known sharp edges

- **`previewSheet` writes to `draft` from inside a `$derived`** (`Inspector.changes`), which
  `docs/internals/ui.md` otherwise forbids. Safe because the write is undone in the same synchronous
  frame, so nothing observes the trial value. Upgrade path if Svelte hardens this: move `changes` into
  an `$effect` writing a `$state` — one tick of lag, same output. Documented at the call site.
- **Autosave is debounced, so the last 600 ms of typing dies with a crashed tab.** Everything before
  it is on disk. A `beforeunload` flush would fight the desktop app's own quit for one name's worth
  of characters.
- **Skill names are still `titleCase(id)`**, not catalog strings — the same gap the combat sheet has.
  They are rules ids, not content rows, so they need their own key namespace.

## Not built, and why

Confirmed against the real SRD data (all 428 class-feature rows across both editions; only 21 carry
any effect token at all, and none encode a numeric stat bonus):

- **Fighting Style · Metamagic · Eldritch Invocations · Weapon Mastery · Pact Boon · Divine Order ·
  Primal Order · Epic Boon** — the "pick N from a list" features. Their `effects` cells are empty and
  there is no content column that could drive a picker, so a panel for them would be a lie. This is
  docs/plan.md **N2 shape 3** (choice groups); the inspector gains a target per group when it lands.
- **Lay on Hands · Channel Divinity · Font of Magic · Wild Shape · Indomitable · Arcane Recovery ·
  Mystic Arcanum · Stunning Strike** — resource pools the prose describes and no `grant_resource`
  token creates. The Resources block discovers pools from the effects engine, so they will appear the
  moment the content encodes them. Distinct ids that DO exist today: `rage`, `bardic_inspiration`,
  `second_wind`, `action_surge`, `ki`, `focus`, `persistent_rage`, `uncanny_metabolism`.
- **Extra Attack** — the attacks-per-action count is nowhere in the data; the Attacks block reads
  `flat_bonus:attacks+N` facts and will show ×2 as soon as a feature emits one.
- **Companion / familiar / steed block** — no data model exists for a bound creature.
- **Portrait** — `build.photo` exists in the schema, but the file write goes through `Storage` and the
  character has no folder until it is saved. Its own piece.
- **Money** — docs/plan.md N6 owns currency; the sheet shows weight and capacity only.

## Progress

- [x] `lib/build/social.ts` — the three social bars, node-tested.
- [x] `lib/build/sheet-diff.ts` — `diffSheets(before, after)`, node-tested against a real derive.
- [x] `lib/build/derive.ts` — `buildIssues` → `buildTodos` (kind-tagged, catalog keys, links to a
      target), `classFeatureLines`, `openSubclassChoices`.
- [x] `build/inspector.svelte.ts` — targets, structural `InspectorHost`, option list + search,
      preview, diff, commit.
- [x] `BuildVM` — `previewSheet`, `todos`, `blocking`, `inspector`, `draft.notes`.
- [x] Page shell: full-bleed split, sticky header, debounced draft autosave, todo bar.
- [x] Sheet blocks (left) — origin, abilities, vitals, class + features, defenses, attacks, spells,
      resources, skills, feats, equipment, out-of-combat.
- [x] Inspector panes (right), one per target.
- [x] `/dev/inspector` — every target rendered side by side.
- [x] The old `blocks/*Card.svelte` deleted; gate green; screenshots in `design-preview/builder-*.png`.
- [ ] The guided second mode (see above) — still open, and the reason N3 is `[~]` not `[x]`.
- [ ] Skill-name i18n (shared with the combat sheet).

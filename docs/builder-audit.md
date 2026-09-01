# Builder audit

> Findings from a read-only review of the character builder. Triaged items belong in `docs/plan.md`;
> this file is the raw sweep and is deleted once its contents have moved there or into code.

## Decisions

Locked with the maintainers before the fixing pass. A finding below is fixed under the decision that
names it; anything not named here has one obvious root and needs no ruling.

**Scope.** Repo-wide, not builder-only: S14, N11, N9, A15, S8. Regular commits straight to `main`,
not one per finding. `lint:typed` runs at the end of the pass. New i18n keys are authored in both
catalogs. Order is bugs first, then refactors — a refactor over unfixed code hides its regressions.
Tests cover every bug plus the units N15 names, since their absence is what hid B11, B14 and S5.

**Rules and behaviour.**

- **B11** — a spell is taken through the class whose list holds it and is charged to that class. The
  guard follows `casterForSpell`. A wizard cannot take *Cure Wounds*; a cleric multiclass can, out of
  the cleric budget.
- **B8** — lowering a class level never prunes `slotFeats`. A feat whose slot is not currently granted
  renders dimmed with the reason, and returns when the level does.
- **B12** — switching edition mid-draft opens a confirmation naming every pick that will be dropped.
- **B10** — the diff matches casters by class row. Gained spellcasting reads `— → 13`; the `?? 0`
  sentinel is gone.
- **B5** — a failed autosave raises a toast and retries on the next change.
- **B6** — `DraftState` gets a zod schema; on-disk drafts are validated, never cast.
- **B13** — the origin feat gets its sub-choice picker. The feat itself is granted, not chosen, so it
  renders as its own component rather than as a feat slot that merely refuses to open.
- **B14** — a class with no subclass rows at all is a **content** defect, not a builder state: the
  review bar drops the todo and content health reports the class. Charnik never fabricates a default
  subclass; inventing game data is the one thing it must not do.

**Interaction.**

- **A5** — take from the keyboard is a second Enter on the row already being read, mirroring the
  double-click. Space cannot serve: the WAI-ARIA editable-combobox pattern gives every printable key
  to the textbox. Wider keyboard navigation is deferred.
- **A8** — `PickerCard` drops `role="dialog"`; it is a named region the combobox points at, because
  the caret stays in the search box.
- **A11** — `openKeys` is independent of query expansion, so clearing the query restores what the user
  had open.
- **A13** — both floating cards re-place on scroll and resize.
- **A15** — `title` moves onto elements that already take focus. The shared provenance popover stays
  open work: outside the builder there is nowhere with focus to hang it on, and on a spell or a class
  action a click already means *roll*, which collides with *open the article*.

**Structure.**

- **S14** — the token scale is derived from the values in use (`6px`, `9px`, `10px`, `11px` gain
  semantic tokens in both theme blocks) rather than 125 literals being dragged onto 4/8/12/16. Nothing
  moves by a pixel, every value becomes themeable, and the pass can actually finish.
- **S1** — no trial sheet is built while nothing is previewed, which is the common case the profile
  punishes. With a preview open, re-deriving on a draft change is correct. `classPicks` is deep-copied.
- **S4** — `rowId` (GUID) replaces the class-row index; the D14 schema is where the old slot-key format
  is lifted.
- **S2** — all four carves out of `BuildVM`.

**Strict / Free.** The mode is a value on the character, not a UI preference: Strict follows the
rules, Free edits anything, and Strict is what nearly every character will carry. The level-up path
must honour it — under Strict, already-made decisions are frozen and a level cannot go down.

## Progress

Every finding below carries a status box: `[ ]` open, `[~]` decided or in flight, `[x]` in code and
verified. Count with `grep -c '^\*\*\[ \]'`. **55 of 65 done.**

Work this file does not itself hold:

- [x] **Strict on the level-up path.** Under Strict, a level cannot go down and a decision already
  made cannot be re-picked; Free lifts both. Related to B15, which reaches the same flag from the
  expertise side.
- [x] **X1. Origin feat needs its own component.** Granted, not chosen — it must not render as a feat
  slot that merely refuses to open (falls out of B13).
- [x] **X2. A class with no subclass rows is reported by content health.** The builder side is B14;
  this is the other half, and it lives wherever content health already reports a broken class.

Deferred by decision, not open work: the shared provenance popover (A15's second half), and keyboard
navigation past the double-Enter take (A5).

**A9 is partial.** The row wrappers are `presentation` and the options are the listbox's own children
now, but the section headers are still interactive `<button>`s inside it, which `aria-required-children`
does not allow. Every way out changes the picker's shape: one listbox per section breaks the single
`aria-controls`/`aria-activedescendant` the combobox needs, and making the header non-interactive moves
collapsing to the jump rail. That is a UX decision, not a cleanup.

Reviewed: `src/routes/build/**` and `src/lib/build/**` (~8 000 lines), plus the 25 commits from
`b2e25fa` to `bbef3d6` that built them. `pnpm test` (1810 passed) and `pnpm lint` are green — every
defect below passes the gate.

## Scope: not only the builder

Most findings sit inside the build module. These do not, and are listed here because the builder is
where they surface:

| Finding | File outside the module | Also affects |
| --- | --- | --- |
| B6 | `src/lib/character/draft-repository.ts:60-66` | any draft reader |
| S10 | `src/lib/combat/attacks.ts:222,239` | combat sheet |
| S8 | `src/lib/content/detail.ts:375` (`entryMeta`) | compendium, spellbook |
| S12 | `src/lib/character/derive-stats.ts:33` (`PROF_ORDER` unexported) | — |
| N9 | `src/lib/components/WikiDetail.svelte:43` | compendium |
| N9 | `<title>` hardcoded in `combat`, `compendium`, `settings`, `spellbook`, `translate` | whole app |
| S14 | off-scale px spacing — build has 125 literals / 4185 lines; `combat` 202 / 4425, `lib/components` 235 / 9522 | whole app |

`src/lib/combat/constants.ts:91,94` (`metres` / `kilograms`) is not a defect — it is the correct
helper the builder ignores (S9).

## Bugs — data loss and wrong numbers

**[x] B1. Level-up double-counts every carried ASI boost on a cold load.**
`build-view-model.svelte.ts:142-147` subtracts `abilities.slotBoosts` from `char.build.abilityBoosts`.
`slotBoosts` walks `feats.featSlots`, which needs `graph` for the class's `asi_levels`. But
`+page.svelte:41` (`onMount(build.load)`) and `+page.svelte:56` (`afterNavigate(… build.hydrate)`)
run concurrently with nothing awaited between them, so on a cold `/build?levelup=<slug>` the graph is
still `null` and `asiFeatLevels` falls back to `[4,8,12,16,19]` (`rules.ts:106`). A Fighter's level-6
slot does not exist at that moment, nothing is subtracted, and the slot re-derives its own +2 on top
of the flat boost once the graph arrives. Fighter 6 with ASI→CON saves as `con: 2`, reopens as
`con: 4`. `build.test.ts:126` misses it because it assigns `build.graph` *before* `hydrate`.

**[x] B2. Saving a level-up deletes an unrelated unfinished draft.**
`build-view-model.svelte.ts:552` calls `this.drafts.discard()` unconditionally, and `hydrate`
(`:137-161`) never calls `drafts.renew()` — so an edit session keeps the guid the *new* build minted
at construction. Open `/build`, type a name (autosave writes draft `G1`), then click "Level up" on
another character in the same tab (`afterNavigate` → `hydrate`), then Create: `discard()` deletes
`G1`. The unfinished build is gone with no user action naming it.

**[x] B3. `hydrate()` never clears `classPicks`, so a previous build's stash lands on the character.**
`:137-161` sets `draft`, `edit`, `history.reset()`. Compare `reset` (`:106` `classPicks.clear()`) and
`hydrateDraft` (`:129`, replaces the map). Set row 0 = Wizard level 7 with skills on a fresh build,
switch to Fighter (stashing the Wizard's `{level:7, skills, selectedSpells}`), then open
`?levelup=<other>` and set that character's class to Wizard: `restoreClassPicks` gives them level 7
and another character's skills.

**[x] B4. A class picker left open on a removed row wipes every skill, expertise and spell pick.**
`inspector.svelte.ts:180` — `apply: (host, id) => host.setClass(index, id)` — captures `index` at open
and never revalidates it; `SheetClasses.svelte:117` calls `b.removeClass(i)` without touching
`b.inspector`. Multiclass → open row 1's class slot → remove row 1 → double-click any class in the
still-open grid. `switchClass` sees `draft.classes[1] === undefined`, so `leaving = null ≠ id`, and
falls into `clearClassPicks(draft, 1)` (`class-picks-cache.ts:78-82`):

```ts
if (draft.classes.length === 1) { draft.skills = []; draft.expertise = []; draft.selectedSpells = []; }
```

No class is added (the `.map` matches no row), so nothing appears to happen while three lists empty.
Two roots, either fixes it: `Inspector` never checks an indexed target still exists, and
`clearClassPicks` treats "row out of range" as "clear the shared pools".

**[x] B5. `persist()` records the write as done before it happens, and the caller drops the rejection.**
`draft-session.svelte.ts:56-58` sets `this.written = body` *before* `await saveDraft(...)`. On a
rejection (disk full, permissions, a folder renamed under Tauri) `written` already claims that body is
on disk, so every later identical `persist()` short-circuits and the draft is never retried.
`+page.svelte:79` calls it as `void build.drafts.persist();`, so the rejection becomes an unhandled
promise rejection and the user is told nothing — the exact failure the autosave exists to prevent.

**[x] B6. `hydrateDraft` casts unvalidated on-disk JSON straight into `DraftState`.**
`build-view-model.svelte.ts:128-129`, two `as`. `draft-repository.ts:60-66` only checks that
`guid/savedAt/summary/draft` are truthy. A draft written before `slotFeatSkills` existed, or
hand-edited, is assigned wholesale; the first `draft.classes.reduce` (`:242`) or
`draft.slotFeatSkills[key]` (`feat-slots.svelte.ts:121`) throws and takes the page down. A trust
boundary and an explicit unsafe cast. A `blankDraft()` spread underneath is the one-line floor —
`draftFromCharacter` already does it.

## Bugs — logic

**[x] B7. Character level 21+.** `canRaiseLevel` (`:245`) is checked in `addClass` and `bumpClassLevel`,
not in `setClass` (`:254`). `totalLevel` (`:241`) counts only rows that already hold a class, so an
empty row is invisible to the cap: `addClass()` at level 1 → `setClass(0, wizard)` → raise to 20 →
`setClass(1, fighter)` fills the pre-existing empty row → 21. Nothing downstream clamps it.

**[x] B8. Lowering a class level orphans its feat picks, which then invisibly delete feats from every
other slot's menu.** `feat-slots.svelte.ts:70-73` — `usedFeatRefs` reads the raw `draft.slotFeats`,
while `featSlots` (`:35-46`) only yields keys for levels `asiFeatLevels` still grants, and
`bumpClassLevel` never prunes the maps. Fighter 8 → take Alert in the level-8 slot → step back to 4.
Slot `0:8` leaves the sheet, `slotFeats['0:8']` survives, and `pickSpecFor`
(`inspector.svelte.ts:250-252`) filters Alert out of the level-4 grid. Searching "Alert" reports no
match, with no explanation and no way back short of re-raising the level. The stale key is persisted
(`:440`) and re-hydrated.

**[x] B9. The diff falls back to the previous commit's rows whenever the option being read changes
nothing.** `InspectorGrid.svelte:50-53`:

```svelte
{#if ins.changes.length}<ChangeList changes={ins.changes} />
{:else}<ChangeList changes={ins.applied} taken />
```

`changes` returns `[]` both for "nothing previewed" and for "this option moves no number" — the
comment at `inspector.svelte.ts:337-339` asserts both are correctly silent, but the consumer is not.
Open a feat slot → double-click Alert (`applied` = the initiative rows) → arrow onto Skilled (a pure
grant, empty diff) → the pane reads "What changed: Initiative +2 → +7" beside the Skilled article.
`changes` needs a third state (`null`), not an empty array doing two jobs.

**[x] B10. `sheet-diff` compares spellcasting positionally.** `sheet-diff.ts:53-61`:
`of: (s) => s.spellcasting.classes[0]?.saveDC.value ?? 0`. `spellcasting.classes` is `build.classes`
filtered to casters, in row order, so `classes[0]` is a different class between the two sheets.
Cleric 5 (row 0) / Wizard 3 (row 1), highlight Fighter for row 0: the diff prints "Spell save DC
15 → 13" as though the Wizard got worse, and the Cleric losing spellcasting entirely is never
reported. The `?? 0` is the same defect further on: a character gaining spellcasting reads "Spell save
DC 0 → 13", presenting a sentinel as a number the player used to have.

**[x] B11. The strict spell cap blocks by one rule and counts by another.** `derive.ts:152-159` (RV1)
attributes each chosen spell to **one** caster class via `casterForSpell`. The guard at
`build-view-model.svelte.ts:288-295` rejects on `pc.profile.accessSpellIds.includes(ref)` — i.e. for
*every* class whose list holds the spell. A Cleric 5 / Wizard 5 who is full on cleric picks cannot
take *Cure Wounds* as a Wizard, though the tally would have charged it to whichever class
`casterForSpell` names.

**[x] B12. Switching edition mid-draft leaves an invisible, unremovable species ASI.**
`BuildHead.svelte:53` writes `b.draft.system = sys` and nothing else. `speciesRow` (`:174-176`)
resolves through `graph.get(id)`, not the system-filtered `list()`, so a 5e Half-Elf still resolves
after a flip to 5.5e and `speciesBoostChoice` stays non-null. `ability-allocation.svelte.ts:170-173`
keeps applying the +1/+1 while `AbilitiesPane.svelte:90` hides the chips
(`boostCarrier === 'species'` is now false). Applied, with no control to see or clear it. Note the
asymmetry: `backgroundBoosts` (`ability-allocation.svelte.ts:141`) *is* system-gated.

**[x] B13. A 5.5e origin feat's sub-choices have no UI, and the doc claims otherwise.**
`feat-slots.svelte.ts:145` reads picks under the `'origin'` key and `draft.ts:71` asserts "the
origin-feat picker uses the `'origin'` key". The only writer is `toggleSlotFeatSkill`, called only
from `FeatPane.svelte:101` with a `slotKey`. `SheetFeats.svelte:35-43` renders the origin feat as a
static `<div class="featrow is-taken">` with no click target, and no `InspectorTarget` exists for it.
A background granting Skilled or a half-feat loses both the skill grant and the +1. Wire it or delete
the `'origin'` branch and fix the comment.

**[x] B14. A subclass todo with no subclass rows is a dead link.** `derive.ts:183-186` emits the todo from
the class's `subclass_level` alone; `SheetClasses.svelte:90` renders the button only
`{#if subs.length}`, and `inspector.svelte.ts:235` builds `options: b.subclassesFor(…)`. With the
subclass source disabled the review bar says "choose a subclass" and the click opens an empty pane.
Gate the todo on `subclassesFor(...).length` too.

**[x] B15. Expertise is unreachable whenever the class grants none — including in Free mode.**
`SkillRows.svelte:52` gates the only ×2 control on `b.expertiseCap > 0` rather than on the mode.
`toggleExpertise` (`:376-378`) explicitly allows adding in Free and removing always, but no button
ever renders. A character edited into "has expertise, cap 0" can never drop it.

**[x] B16. Expertise at the cap dead-ends, against the ui.md §10 contract its sibling follows.**
`SkillRows.svelte:53-59` uses `disabled={capped}`. ui.md §10: at the cap a click on an unpicked chip
replaces the oldest pick; dimmed-and-disabled is for a chip blocked for a *different* reason.
`toggleSkill` (`:346-357`) does the replace correctly for the class-skill cap; expertise, ten lines
below, does not.

**[x] B17. `reset()` and `hydrate()` do not close the inspector.** `:103-109` clears `edit`, `draft`,
`classPicks`, `drafts`, `history` — not `inspector`. Going from a level-up to "New character" with the
pane open on `{id:'feat', slotKey:'1:4'}` leaves it open on a slot the blank draft does not have.

**[x] B18. Undo does not cover `classPicks`.** `draft-history.svelte.ts:94` writes only the draft, while
`DraftSession.persist` (`:55`) serialises draft **and** `classPicks` together, so after an undo across
a class switch the autosaved record pairs a pre-switch draft with a post-switch cache. Not cosmetic:
undo a Wizard pick, switch to Wizard, and `restoreClassPicks` resurrects the undone pick.

## Accessibility and UI anti-patterns

**[x] A1. Clicking inside the open article card closes it.** `Inspector.svelte:49-54`'s
`clearOnBackground` clears `ins.previewId` on any click not matching `OPERABLE`, and `PickerCard` is a
DOM descendant of `.pane` (`position: fixed` does not change bubbling ancestry). Species → click
"Dwarf" → click any paragraph of the article: the click bubbles `.cbody → .body → .pane`, and
`OptionGrid.svelte:113` unmounts the card mid-read while the diff below blanks. `PickerCard.svelte:52`
deliberately exempts inside-clicks from its *own* dismiss handler; this is a second, unguarded
dismisser reaching past it. `SpellsPane`/`InventoryPane` hold `previewId` locally and are unaffected,
so the identical gesture behaves differently in the two pickers.

**[x] A2. The walked highlight is never scrolled into view.** `grep -rn "scrollIntoView" src/` is empty;
`option-walk.ts:50-51` only calls `onpreview(id)`. With the caret in the search box, holding ↓ moves
`previewId` and `aria-activedescendant` past the bottom of `.rows` without scrolling — a combobox
pointing `aria-activedescendant` at an off-screen option. With the card open,
`card-placement.ts:29-30` anchors it to the off-screen row's rect and clamps it to the viewport.

**[x] A3. Home/End are stolen from the search input.** `option-walk.ts:46-49`, wired straight onto a text
`<input>` at `PickerSearch.svelte:39`. Type "great weapon m", press Home to fix the start of the
query: the caret does not move and the highlight jumps to the first option. The WAI-ARIA editable
combobox pattern reserves Home/End for the textbox.

**[x] A4. A double-click's end state depends on the state before it.** `SectionedPicker.svelte:216-217`
and `OptionGrid.svelte:99-100` pair `onclick={read}` with `ondblclick={ontake}`, and `read()` toggles
(`picker-reading.svelte.ts:61-70`) while a dblclick fires both clicks first. On a row not being read:
open, close, take → the card flashes and vanishes. On the row being read: close, open, take → the card
stays. One gesture, two screens, plus two `placeCard` layout passes per take.

**[x] A5. The double-click take has no keyboard counterpart.** ui.md §6 makes double-click the take
shortcut in both pickers, but from the walk Enter maps to `read` (`picker-reading.svelte.ts:77`) and
nothing else takes. The only keyboard route is tabbing to the row's `.addbtn`, which `OptionGrid` does
not have at all — there the sole take is Enter → card → tab past every cell → Take.

**[x] A6. Segment toggles in the masthead have no focus ring and no state for AT.** `build.css:327-338`
`.build-page .segment-group button { all: unset; … }` at specificity (0,2,1) beats the global
`:focus-visible { outline: var(--focus-ring) }` (`app.css:36`, (0,1,0)) and never re-adds it. Every
other `all: unset` control in the module (`.slot`, `.pick-chip`, `.jumpbtn`, `.sect`, `.sbody`,
`.addbtn`, `.cell`, `.todo`) re-declares `:focus-visible`. `BuildHead.svelte:52-71` also conveys the
on-state by class alone — no `aria-pressed`, no `role="radio"` — so ruleset, Strict/Free and
short-rest are colour-only.

**[x] A7. The picker search input has no accessible name.** `PickerSearch.svelte:35-45` relies on
`placeholder` while carrying `role="combobox"`, which requires one. The house pattern
(`<span class="visually-hidden">`) is two files over at `BuildHead.svelte:18-20`. `aria-expanded` is
hardcoded `"true"` although the list can be empty.

**[x] A8. `PickerCard` is a `role="dialog"` with no focus management.** `PickerCard.svelte:68` — no
`aria-modal`, no focus moved in, no trap, no restore on close. Opened by Enter from the search box
(`picker-reading.svelte.ts:75-78`), a screen-reader user hears nothing and the Take button is
unreachable without tabbing through every rendered option first (100+ stops with a spell section
open).

**[~] A9. `role="listbox"` whose children are not options.** `SectionedPicker.svelte:164-190` — the
listbox directly owns section-header `<button>`s and `<div class="srow">` wrappers, and each `option`
is nested a level down beside a *second* interactive button. Fails `aria-required-children`.

**[x] A10. One Escape collapses two levels.** `PickerCard.svelte:56-57` (document) and
`Inspector.svelte:61` (pane) both listen, so with the card open and the caret in the search box one
Escape closes the card *and* clears the highlight, emptying the diff and losing your place.

**[x] A11. Expand/Collapse-all is a dead control while a query is typed.**
`SectionedPicker.svelte:61-62` — `isOpen = (key) => !!trimmed || openKeys.includes(key)`, so any query
makes `allOpen` true, the button reads "Collapse all", and clicking sets `openKeys = []` with nothing
changing on screen. It also discards the sections the user had opened, so clearing the query collapses
everything.

**[x] A12. `OptionGrid` conveys "already chosen" by colour only.** `OptionGrid.svelte:96-98` —
`aria-selected` tracks the *highlight*, so the option that actually is the character's
species/background/class carries no ARIA, only `--color-resource` gold. `SectionedPicker` is fine
(`addbtn` carries `aria-pressed`, `:198-202`); the grid has no equivalent.

**[x] A13. Neither floating card re-places on scroll or resize.** `PickerCard.svelte:40-44` and
`PickerPeek.svelte:29-32` run `placeCard` only when `entryId`/`detail` change. Wheel-scroll `.rows`
with the card open and it stays pinned to the old viewport position while its row moves away — the
whole rationale in `card-placement.ts:1-12` is "vertically level with the entry".

**[x] A14. The ASI card commits on a single click while everything beside it only reads.**
`FeatPane.svelte:23-31` `onclick={() => ins.take(ASI)}`, against `read`/`ondblclick=take` on every
feat cell. ui.md §6: reading and taking are separate controls. The ASI card is also outside
`picker.ids`, so arrows and Home/End can never reach it.

**[~] A15. Provenance is mouse-only, and buttons wrap flow content.** ui.md §3 requires provenance on
hover **or focus**, but `SheetVitals.svelte:16-18`, `SheetDefenses.svelte:65` and `SkillRows.svelte:67`
put `title={why(...)}` on plain `<div>`/`<span>` that never take focus. Separately
`SheetStory.svelte:43-59` nests `<ul><li>` inside `<button>`, and `SheetClasses.svelte:126-138`,
`SheetFeats.svelte:49-70`, `SheetOrigin.svelte:67-96` nest `<div>` inside `<button>` — invalid content
model. `SheetAttacks.svelte:33-43` renders a four-column table as bare `<span>`s in a CSS grid with no
table roles.

## Smells

**[x] S1. `Inspector.changes` builds a whole `BuildVM` and runs a full `deriveSheet` on every keystroke
anywhere in the draft.** `inspector.svelte.ts:340-346` → `previewSheet`
(`build-view-model.svelte.ts:491-503`) → `structuredClone($state.snapshot(this.draft))`.
`$state.snapshot` walks the whole proxy, so the `$derived` subscribes to **every** field of the draft.
Open the class picker, arrow onto a class, then type in the name field: each character constructs a
`BuildVM` (≈40 derived fields, a `crypto.randomUUID()`, a `DraftHistory`, a storage-capable
`DraftSession`) and re-derives a whole sheet. The comment at `:488` says to call it for the one option
a player is reading — a `$derived` cannot honour that, because it does not control when it re-runs.
Key the trial on `(previewId, targetIdentity)` and read the draft through a narrower seam.
`trial.classPicks = new Map(this.classPicks)` (`:500`) is also a shallow copy:
`restoreClassPicks` (`class-picks-cache.ts:88`) assigns the same nested `{shape, picks}` objects into
the trial draft.

**[~] S2. `BuildVM` is a god object, and three clean carves touch no `bind:`-ed field.** The class doc
(`:66-70`) argues a further split is expensive because draft fields are bound across `blocks/*`. True
of `draft`, false of the derivations over it:

- Skills + expertise `:321-389` (~70 lines) → `skill-picks.svelte.ts`
- Spells `:267-318` (~50 lines; the only place in the class that raises toasts) → `spell-picks.svelte.ts`
- Class rows `:237-265` (~30 lines) — the mutation half already lives in `class-picks-cache.ts`; this
  is its reactive face, and where B7's missing cap check goes
- Species free-boost `:216-234` — ability allocation living outside `AbilityAllocation`, which already
  consumes `speciesBoostChoice` back through the host

**[x] S3. `inspector.svelte.ts` is three modules.** (1) `EDIT_PANES` + `editSpecFor`, lines 63-141;
(2) the pick-descriptor table `classesOfferedTo` + `classPickSpec` + `pickSpecFor`, lines 143-260 —
118 lines of pure `(target, host) → Spec` with no runes; (3) the `Inspector` class, 262-376, the only
part needing `.svelte.ts`. Moving (1) and (2) to a plain `inspector-specs.ts` leaves a 114-line class
and makes the table node-testable — `pickSpecFor`, `targetForTodo` and `classesOfferedTo` currently
have no unit coverage.

**[x] S4. Class rows are identified by array index, and ~55 lines of `class-picks-cache` exist to paper
over it.** `SheetClasses.svelte:60` `{#each b.draft.classes as cls, i (i)}`, slot keys `${i}:${level}`
(`feat-slots.svelte.ts:41`), and `class-picks-cache.ts:113-116` documents the consequence in its own
words. AGENTS.md: identify anything shareable with a GUID, not a local counter. A `rowId` on
`DraftClassEntry` removes the stash-clear-rewrite dance in `removeClassRow` and all of
`levelOfSlotKey`, and fixes the `{#each}` key for free.

**[x] S5. `derive.ts` walks the class-feature gate twice.** `expertiseBudget` (`:54-63`) and
`classFeatureLines` (`:236-244`) are the same loop with the same
`key = \`${id}:${level}:${sub}\``, and both docstrings say they mirror the derive-gather feature
gates. A third copy of a gate is what drifts. One `activeClassFeatures(entry, graph, system,
{ maxLevel })` iterator feeds both; the level bound is the only difference.

**[x] S6. Target identity is `JSON.stringify` over a discriminated union.** `inspector.svelte.ts:295-296`.
It works only because every call site spells the keys in the same order today. The correctness of
`class:active` on eight sheet cards and of the `{#key JSON.stringify(target)}` remount
(`Inspector.svelte:112`) rests on property-declaration order in unrelated `.svelte` files. A small
`sameTarget(a, b)` switch on `id` cannot silently disagree.

**[x] S7. `social.ts` holds user-facing English in a pure module.** `:36-38` `label: 'Sway'` — dead, since
`SheetStory.svelte:36` reads `$_('build.social.' + bar.id)` — and `:55` `via: titleCase(best)`,
rendered directly at `SheetStory.svelte:38`. `skillLabel(id, t)` already exists (`rows.ts:85-86`).
ui.md:245 forbids a sentence in a pure module outright.

**[x] S8. `pickerMeta` threads a translator in and uses it for one branch of six.** What stays English
is the free-text `range` and `damage` columns — content, not an enum, and not something to mine.
 `rows.ts:100-114` —
`class`, `background`, `feat` and `item` go through `titleCase()` on an English snake_case id, and
everything else falls to `entryMeta(row)` (`detail.ts:375-404`), which emits raw `'conc.'`,
`'ritual'`, `'DEX save'` and untranslated schools. That fallback renders every row of the 658-row
spell picker and the 773-row item picker. `e33cd11` fixed the stringify hazard here and left the
locale hole.

**[ ] S9. Metric conversion is hand-rolled in four places, past the existing helpers.**
`SheetVitals.svelte:21` uses `* 0.3` (not 0.3048), so 30 ft renders "9 m" while `CombatStrip.svelte:62`
renders "9.1 m" from the shared `metres()` (`combat/constants.ts:91`). It also breaks ui.md §6
(imperial first, metric in parentheses) — there is no `ft` unit at all. Same `* 0.3` at
`SheetOrigin.svelte:40` and `rows.ts:107`; `SheetInventory.svelte:78` uses `* 0.45` instead of
`kilograms()` (0.4536). Both helpers are in `docs/surface.md:636-637`.

**[x] S10. Attack names bypass i18n.** `SheetAttacks.svelte:39` renders `{a.name}`, where
`combat/attacks.ts:222` sets `name: row.data.name_en` and `:239` hardcodes `name: 'Unarmed Strike'`
(with `dmg: \`${1 + strMod} bludgeoning\`` beside it). Every other row on the sheet goes through
`rowName()`. Keying that list on the name (`:38 (a.name)`) is also fragile — two rows with the same
`name_en` from different sources is a duplicate-key crash.

**[ ] S11. `String(clsRow.data.saves).toUpperCase()`** — `SheetClasses.svelte:83`. The schema is
`csvList(z.array(Ability)…)`, so this is `Array.prototype.toString` → "STR,CON", while `rows.ts:101`
formats the same column properly → "STR, CON". One fact, two spellings, and exactly the hazard
`pickerMeta`'s own comment (`rows.ts:96-99`) warns about.

**[x] S12. `PROF_RANK` duplicates `PROF_ORDER`.** `sheet-diff.ts:68` against `derive-stats.ts:33` — same
four keys, same order; the second is simply not exported.

**[x] S13. Duplicated CSS classes that should live in one place.**

- `.gold` — `build.css:221-223` and an identical copy at `SectionedPicker.svelte:362-364`.
- `.count` — `build.css:216-220` (`--font-size-xs`) against `PickerSearch.svelte:81-85`
  (`--font-size-micro`). Svelte compiles the scoped one to `.count.svelte-hash`, so (0,2,0) vs
  (0,2,0): **load order decides which font size wins**. This is the foot-gun `build.css:64-77`
  documents for `.is-taken` and solves by doubling the class; `.count` is unprotected.
- `.lvl` / `.ftext` — `SheetClasses.svelte:285-309` and `SheetFeats.svelte:98-124`, near byte-identical.
- `.tags` — `SheetOrigin.svelte:125-130` and `SheetDefenses.svelte:151-157` re-implement the global
  `.build-page .chips` (`build.css:283-287`), differing by 1px of gap.
- `.build-page .tag.gold` is declared twice (`build.css:79` and `:139`), and `:139` re-states the
  colour `.build-page .gold` (`:221`) already gives.

**[~] S14. Spacing does not follow the token scale.** 125 px literals across 4185 lines; the value
distribution is `6px`×23, `9px`×20, `4px`×18, `8px`×17, `11px`×13, `7px`×8, `10px`×8, `5px`×4,
`3px`×2. `--space-*` is 4/8/12/16/24/32, so most of the commonest values sit off-scale and outside a
user's theme. `border-radius: 9px` repeats four times (`SectionedPicker.svelte:374`, `:422`,
`BuildHead.svelte:106`, `ReviewBar.svelte:104`) between `--radius: 8px` and `--radius-md: 11px`.
Stylelint guards colours only (zero violations there); sizes are ungated. Repo-wide, not
builder-specific — see the scope table.

**[x] S15. The boost-folding helper is written twice verbatim, twenty lines apart.**
`ability-allocation.svelte.ts:154-156` and `:168-170` — identical `add()` bodies in `slotBoosts` and
`abilityBoosts`.

**[x] S16. The test claiming to enumerate every emittable key skips a form.** `sheet-diff.test.ts:92`
covers `skillName.*`, `build.diff.*` and `build.vitals.*` at `:99-114`, but never the `{ keys: [...] }`
form from `defenseChanges` (`sheet-diff.ts:147`). A homebrew pack declaring `resist:sonic` renders the
literal `damageType.sonic`, and the guard that exists for this does not look at it.

**[x] S17. Damage types print raw ids on the sheet while the diff of the same data localizes them.**
`SheetDefenses.svelte:91-99` passes `d` as `bludgeoning`; `sheet-diff.ts:147` does it right, and
`en.json` carries a full `damageType` catalog.

## Nits

**[x] N1.** Dead `if` with an empty body — `ability-allocation.svelte.ts:98-100`. It survives `no-empty`
only because ESLint ignores blocks containing a comment; the next branch already does what the comment
claims.

**[ ] N2.** `previewIsCurrent` (`inspector.svelte.ts:330-332`) is dead — grep of `src/` returns only the
definition.

**[~] N3.** Two comments describe deleted behaviour. `draft-session.svelte.ts:30-33` still says the option
preview "derives the sheet on a TRIAL draft and puts the draft back" — `ee92794` removed the put-back
entirely. `feat-slots.svelte.ts:6` says the slot key is `"class-4"` while `:43` produces
`${i}:${level}`, the format the whole of `class-picks-cache.ts` parses.

**[ ] N4.** Two names for one fact: `primaryClassId` / `classId` (`:237-238`), and `backgroundSkills` /
`autoSkills` (`:327-329`, where the first has exactly one reader — the second). `csv` is spelled two
ways for the same import: `const csv = splitList` (`:58`) against
`import { splitList as csv }` (`ability-allocation.svelte.ts:27`).

**[ ] N5.** Two `as` casts standing in for the banned `!`: `:418` `c.classId as string` (a `flatMap`
narrows it honestly) and `:423` `abilityBoosts as Record<string, number>` (asserts a `Partial` is
total, which it is not).

**[x] N6.** `boostCarrier` is asked twice, two ways: `ability-allocation.svelte.ts:141` gates on the raw
`draft.system === '5.5e'` three lines after `:130-132` exposes the named predicate that
`AbilitiesPane.svelte:73` already uses.

**[~] N7.** Bare literals where a named constant belongs: `20` as the level cap twice (`:245`, `:263`);
`19` for epic boon (`feat-slots.svelte.ts:60`); `3`/`1`/`20`/`30` for manual score bounds and
`value ?? 8` where `POINT_BUY_MIN` is already imported (`ability-allocation.svelte.ts:106-107, 121`).

**[ ] N8.** Hardcoded English reaching the screen: `String(… ?? 'Lineage')` (`:205`, rendered as the
inspector title), `name: … || 'Unnamed'` (`:408`), `slugify(...) || 'hero'` twice (`:456`, `:547`).
`SheetOrigin.svelte:91` promises `{ count: 2 }` skills for an unchosen background — a number from
nowhere. `SheetInventory.svelte:47` prints a literal `AC {ac}` though `build.vitals.ac` exists.

**[ ] N9.** `<title>Build — Charnik</title>` is hardcoded (`+page.svelte:110`), as in 6 of 7 routes; only
the roster (`routes/+page.svelte:49`) uses the catalog. `WikiDetail.svelte:43` prints an untranslated
"Select an entry to see its detail." inside the picker card.

**[x] N10.** `walkOptions` matches Enter by `event.code` (`option-walk.ts:38`), so `NumpadEnter` does
nothing. The `e.code` house rule is about physical shortcuts; a confirm key needs both spellings.

**[ ] N11.** RTL: the module uses physical properties throughout — `SectionedPicker.svelte:392, 359,
297-300, 442`, `PickerCard.svelte:106, 132`, `+page.svelte:174, 194-198`, `SkillRows.svelte:182-183` —
and `card-placement.ts:35-41` picks a side from `rail.left` alone. The repo uses a logical property in
exactly one file.

**[ ] N12.** Two dead i18n keys in both catalogs: `build.resources.needClass`, `build.inspector.taken`.

**[ ] N13.** `optionDomId` (`option-walk.ts:61`) does `replace(/[^\w-]/g, '_')`, so `srd:fire bolt` and
`srd_fire:bolt` produce one DOM id. Theoretical, but it feeds `aria-activedescendant`.

**[ ] N14.** `class:free={true}` is a constant dressed as a directive — `BuildHead.svelte:58`.

**[~] N15.** Test coverage stops at the small pure helpers. No unit tests for `classFeatureLines`,
`openSubclassChoices`, `buildSpellPicker` — the three that touch the graph, the edition gate and
multiclass attribution, which is why B11, B14 and S5 are invisible to the gate — nor for
`ability-allocation.svelte.ts`, `card-placement.ts`, `picker-reading.svelte.ts`.

## Checked and dismissed

The scroll-spy rAF in `SectionedPicker.svelte:108-121` schedules a frame with no
`cancelAnimationFrame` in teardown, but `list` is `$state` under `bind:this` and Svelte 5 nulls it on
unmount, so `if (!list) return` catches the late frame. A leaked frame, not a defect.

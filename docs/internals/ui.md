# UI

> For maintainers. How the frontend is put together, and the conventions of intent that keep a new
> panel consistent with the shipped sheet.

## The frontend is a thin shell

No D&D math lives in a `.svelte` file. Components bind to the pure core's `{value, trace, notes}` and
render it.

A view's reactive state and actions live in **one typed view-model class named after itself**
(`CombatVM` → `combat-view-model.svelte.ts`), exported as a singleton. Its actions are **arrow-method
fields**, so `this` survives being passed into markup. Components read through reactive aliases —
`const x = $derived(vm.x)`, which keeps bare names in the markup — and write through `vm.*`, so only
the write sites change when a view is sliced up.

Pure stateless helpers, constants, and types sit in sibling `*.ts` files with no runes, where they
are reusable and node-testable.

Live switches (`activeSystem`, `activeLocale`, `theme`, and the per-character `layout`) flow through
reactive stores. Nothing reloads.

**`$derived` is pure.** It reads reactive state and returns a value: no mutation of other state, no
IO, no toast, no store write. Svelte re-runs deriveds whenever their dependencies change, sometimes
more than once, so a side effect inside one fires unpredictably and creates reactive loops. Anything
that *acts* on a change belongs in `$effect`.

## Panels, and the views made of them

The sheet is built from discrete **panels** — HP, combat stats, abilities, skills, attacks, spells,
actions, effects and conditions, inventory, notes. A **view is a preset arrangement of panels**
(Profile · Combat · Inventory · Build), with a fixed stats header above and a two-column panel area
below; the panel area is the only customizable zone. Every panel collapses, reorders and hides, and
that arrangement is per character and lives in `ui`, not in `play` (`characters.md`).

**Conditions are not their own panel.** A condition is an effect of kind `apply_condition`, so ONE
"Effects & conditions" list is the single source of truth for what is currently modifying the
character — each row with its provenance, duration, kind tag and remove control, concentration shown
inline, and both quick-pickers writing into that same list. A second panel would be a second answer
to "what is affecting me".

**The inventory view is a card grid, not a list.** Items are cards in sections (equipped and attuned,
weapons, consumables, gear, treasure), each with a category icon, the key stat, quantity, and its
equipped or attuned badge — because an item is recognised by kind at a glance, where a spell is found
by reading down a list.

## Splitting a large view

1. The view-model goes to `<view>-view-model.svelte.ts`.
2. Pure helpers, constants, and types go to a sibling `helpers.ts`.
3. Components import the singleton and alias its fields.
4. Shared CSS goes to the one curated global `styles/components.css`; view-specific CSS stays scoped.

Never split a view into "area chunks" that each re-scope the same shared classes — that duplicates
CSS instead of removing it.

Move the code with a script rather than retyping it through a model, gate every stage on
`svelte-check` (know the baseline error count and do not add to it) plus `pnpm build`, `pnpm test`,
and a pixel-identical screenshot, and run `pnpm format` before committing — script-spliced files are
not prettier-clean and CI lint checks formatting.

## Theming

Style only through the design tokens in `styles/tokens.css`: `var(--color-*)`, `var(--font-size-*)`,
`var(--radius*)`, `var(--space-*)`, `var(--tracking-label)`. Never a hardcoded hex, rgb, px
font-size, or radius — a literal does not respond to `[data-theme=…]`, so it silently breaks every
custom theme, and Charnik ships user-authored themes (Settings ▸ Themes → runtime injector →
`[data-theme=id]`; the themeable list is `THEMEABLE_TOKENS` in `customThemes.ts`).

A genuinely new shade is a **semantic** token added to *both* theme blocks (`:root` dark and
`[data-theme='light']`). Alpha tints are `color-mix(in srgb, var(--token) N%, transparent)`, which
themes for free. Stylelint holds three of the lines itself — `color-no-hex`, and a px ban on
`font-size` and on `border-radius` — so a literal size is caught where it is typed rather than in a
census later. A `%` radius is geometry, not a size: `50%` is how a circle is spelled and stays.
Everything else is on you.

**A box side is logical, never physical:** `margin-inline-start`, `padding-inline-end`,
`border-inline-start`, `text-align: start`. A physical side stays put when the UI is mirrored, and
Charnik discovers its locales — an RTL catalog is a file a user can drop in, not a release we plan.
Stylelint's `property-disallowed-list` holds the line. Bare `left`/`right` offsets are still allowed:
they anchor a `fixed`/`absolute` box to the viewport, and some are written from JS — where the side
is a real choice, ask `getComputedStyle(el).direction`, as `card-placement.ts` does.

**Semantic colours are fixed:** crimson is important or dangerous (a pinned row, a negative effect, a
destructive or primary action), teal is good or confirming (an available resource or slot pip, temp
HP, a toggle that is on), gold is a neutral marker (proficiency and prepared dots, resource
counters). An on/off dot is **filled when active and hollow when inactive** — never a dimmed fill,
which reads as disabled rather than off. Visibility is an open/closed **eye** (teal means shown); state is a **toggle
switch**. Avoid the templated look of cream and terracotta; the shipped theme is slate with heraldic
crimson and gold, set in Space Grotesk, Inter, and JetBrains Mono.

**Before hoisting a class into the global `styles/components.css`, grep for its name** — both
`class="…name…"` and `\.name[ ,{]` across `src`. A global rule applies to every element with that
class app-wide, so a common name collides with scoped classes that reuse it for something else.
Hoisting a `.field` input base once bled onto `.field` form-row wrappers across three views. Pick
specific names for global utilities (`.text-field`, `.dialog-card`, never `.field` / `.row` /
`.item`), and keep exact values when migrating so the pixel diff stays at zero.

## A narrow window

A phone, or a desktop window dragged small — the same thing, and `MobileWarning` says out loud that
it is alpha. The app has ONE narrow threshold, **800px**, shared by the root layout's rules and that
banner, so the warning and the rules that make it survivable agree on where narrow starts. A view
whose own floor is higher names its own width instead (the combat stat grid and the settings tab
strip both at 640px): that number is a fact about the box's min-content, never about a device.

- **`main` is the only scroll region, so everything above it must FIT.** Horizontal overflow at the
  document level scrolls the page sideways and drags every `position: fixed` overlay off-side with
  it. The topbar therefore wraps below the threshold — nav on a row of its own, a labelled control
  collapsed to its icon. Collapsing keeps the `aria-label` and never removes the control: the bug
  chip is the only entrance to the diagnostics bundle.
- **Chrome wraps; a status strip scrolls.** A `.combat-bar` never becomes two rows (see its own note
  in `components.css`), so when it runs out of room it scrolls sideways. Same for the settings tab
  strip, whose active underline belongs on the strip's own border and not floating mid-panel.
- **A grid track is `minmax(0, 1fr)`, never a bare `1fr`.** A bare one floors at the track's
  min-content, so the widest card in it sets a width the viewport may not have — which is how the
  whole build sheet ran sideways at 320px.
- **A locale is where a row stops fitting.** Ukrainian labels run wider than English, so a header
  that pairs a translated title with a `nowrap` button wraps rather than waiting for a threshold.

**Verified by `tools/visual/narrow.mjs`**, not by `shot.mjs` — that one renders at 1280 only. See
`tooling.md` ▸ Visual regression.

## The UX pattern contract

These are conventions of *intent* — which control means "state" versus "visibility", how provenance
surfaces, how pips fill. They cannot be read out of the code and there is no test for "teal means
good", so they are pinned here and every component follows them.

1. **State on or off is a toggle `Switch`** (teal when on), never a checkbox.
2. **Visibility on the sheet is an eye icon** (`EyeToggle`, teal means shown) — a different control
   from a state switch, on purpose.
3. **Every auto-calculated value carries a provenance popover** on hover or focus, listing each
   `{source, op, amount}` contribution and the rule notes: AC, DCs, attack bonus, modifiers,
   passives, max HP, carrying capacity. A manually overridden value shows a `manual` marker instead
   of a breakdown. `use:provenance={why(value)}` (`lib/actions/provenance.ts`) is the one
   implementation, and **`title` is not it** — no browser shows a native tooltip on keyboard focus,
   so half the rule was unreachable. **The VALUE is the trigger**: the action makes it focusable and
   describes it, rather than adding an affordance to two dozen unrelated layouts to say one thing.
   The same action carries any other hover-and-focus explanation, so there is one popover on the
   sheet rather than two lookalikes — the upcast ⇡ hands it the whole slot ladder, which is why the
   popover renders one line per newline (`white-space: pre-line`).
4. **Any value is click-to-edit** — a manual override is available at any time, independent of
   whether auto-calculation is on.
5. **Lists are keyboard-navigable**: ↑/↓ move a highlight, **Enter is identical to a left click**,
   Home and End jump, type-ahead where it helps. This holds for the command palette, spell and attack
   lists, the roll log, the compendium, and every dropdown.
6. **Units are imperial first with metric in parentheses** — `30 ft (9 m)`.
7. **Resource, slot, and economy pips are click-to-set**: clicking a filled pip empties it and every
   pip after it; clicking an empty one fills it and every pip before it. Available on the left, spent
   on the right.
8. **A panel header is** a collapse chevron, the title, right-aligned actions, and a move handle.
   Panels collapse, hide, and reorder **within the two-column area only** — never a free canvas. The
   handle is a real `<button>` in the tab order: dragging it reorders, and so do the arrow keys —
   up/down inside the column, left/right across to the other one (`PanelLayout.movePanel`), with the
   caret put back on the handle afterwards because svelte-dnd-action rebuilds the column's nodes. A
   reorder that only a pointer can perform is a layout a keyboard user cannot get back out of.
9. **An icon slot takes an emoji or an image.** The SRD ships no art, so the fallback is a glyph;
   homebrew and user-created entities may set an image.

10. **A capped multi-select never dead-ends.** At the cap, a click on an unpicked chip replaces the
    oldest pick instead of doing nothing: nothing on screen says "un-pick one first", so a chip that
    looks live and is not is a dead end the user has to solve by guessing. `toggleCapped`
    (`src/routes/build/draft.ts`) is the one implementation, and `SkillPicks.toggleSkill` follows it for
    the Strict class-skill cap. A chip blocked for a *different* reason — another slot already grants
    that skill, a skill carried in from a level-up — is dimmed and blocked, which is a statement
    rather than a silence. It is blocked with `aria-disabled` and a `title`, never `disabled`: a
    disabled control takes neither hover nor focus, so the reason it carries can never be read. The
    refusal itself belongs in the view-model, where every caller meets it (`.is-blocked` in
    `components.css` is what dimmed looks like, shared by the builder and the play sheet). The same
    rule covers a play-sheet ability whose window is shut: it stays clickable and says why, and when
    the window OPENS the sheet says that too — a greyed row nobody is told about is a feature a
    player never notices.

11. **A row's own state sits on the LEFT; a modifier on that state sits on the right.** The
    spellbook puts `EyeToggle`/`Pin` before the name and the "prepared" `Switch` after it;
    `SkillRows` puts the proficiency dot before the name and `×2` expertise after it. "Taken" in a
    builder picker is the row's own state, so it goes left. Gold means taken/proficient/prepared
    everywhere, so a new control reuses it rather than inventing a colour.

12. **A row that carries controls is a `<div>`, never a `<button>`.** The row's own action goes on an
    element INSIDE it — the name is the usual one — and every accessory beside it is a real
    `<button>`. Interactive content nested in a `<button>` is invalid HTML, and the browser gives the
    outer element the tab stop and swallows every inner one: that is how a spell row's prepare, pin,
    ritual-cast and cast-time controls ended up mouse-only, and how a resource-borne effect could be
    added and not removed without a mouse. A `role="button"` span with `tabindex="-1"` and a keydown
    handler is the same bug wearing a hat — the handler cannot fire on an element the keyboard cannot
    reach. Real buttons also delete the `svelte-ignore` above them and the `stopPropagation` inside
    them, since there is no outer click to stop. A searched LIST is the other shape, and it is the
    command palette's: the caret stays in the search box, `walkOptions` (`lib/util/option-walk.ts`)
    moves a highlight the box names through `aria-activedescendant`, and Enter does what a click on
    the highlighted row does — `EntryList` and both builder pickers share that one implementation.

The Combat view is the reference implementation. Reuse the existing primitives (`Switch`,
`EyeToggle`, `RollButton`, `DialogShell`) — grep `surface.md` before building another one.

## The builder is a live sheet, not a form

Two panes, full-bleed, each scrolling on its own. **Left: the whole character sheet, always live** —
every block renders what the draft currently derives, every changeable thing on it opens the inspector
on that choice, and an unfilled thing renders as an empty slot in crimson saying what it will give.
**Right: the inspector** (`clamp(520px, 40vw, 880px)`), one choice at a time.

**Nothing is picked blind, and that is the whole point of the page.** An option shows the reused
`WikiDetail` — one article renderer, never a builder-only summary — plus **what taking it would do to
the sheet**, computed by applying the candidate to a trial draft and diffing the two derived sheets
(`BuildVM.previewSheet` → `diffSheets`). That runs the real pipeline, so it builds a whole second
`BuildVM` per preview: call it for the ONE option a player is reading, never per row. The cost buys a
`$derived` that stays pure, which this doc requires above.

**Taking has no confirm step, and it is not the same click as reading.** The toggle on a row takes and
untakes; the row body opens the article, which repeats the take where the eyes already are. A one-of
pick replaces rather than toggles, and `Clear` in the pane footer is its way out.

**The whole draft has undo** — Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y plus a pair of header buttons, because a
shortcut is not a way in for someone who never learns it. A step is a snapshot of `DraftState`
(`draft-history.svelte.ts`) taken on the autosave's debounce, so a name being typed is one thing to
take back rather than one per keystroke. Nothing there knows what a class is, which is why a new field
on the draft is undoable the moment it exists — and it is what makes the fast gestures safe to offer.

**Level-up reuses this page** (`?levelup=<slug>`), and a character may be built at ANY starting level:
every subclass and every ASI/feat slot the chosen levels opened is its own todo line, and the
class-features list shows every level up to this one plus a three-level look-ahead. Jumping straight
to level 8 cannot silently skip three choices. `blocking` gates Create; leaving is not intercepted,
because the draft autosaves and waits in the roster (`characters.md`).

**One shared inspector shell** (title, blurb, footer) with a body component per target — a feat slot
and an ability allocator are not the same question. `/dev/inspector` renders every target at once, so
a regression in one is visible at a glance.

Two derived read-outs earn their place by re-presenting numbers the sheet already computed, changing
no mechanic: the **social bars** (Sway, Read the room, Lore — each the best passive among its skills,
scaled 5…30, `lib/build/social.ts`), whose hover carries the winning skill's provenance; and
**story**, free prose in `build.notes`, one bullet per line, for the GM.

**Prose on the sheet is markdown-stripped** (`rowText`): a two-line clamp is not an article, and
`_Origin Feat_` reading as literal underscores is worse than losing the emphasis. The full article,
markdown intact, is one click away in the inspector.

## Choosing one row out of many — the picker contract

Every "pick a content row" surface in the builder follows this. The research behind each rule, with
screenshots of how other TTRPG tools and non-game apps solve it, is in
`design-preview/inspector-picker-research.md`; `design-preview/inspector-scroll-variants.html`
renders the variants it weighs, of which V6 and V9 are the two this contract describes.

It lives in `src/routes/build/`. `OptionGrid` is the small pickers, `SectionedPicker` the big two;
both open a `PickerCard` on click, and `SectionedPicker` a `PickerPeek` on hover. `PickerSearch` is
the search row they share, `option-walk.ts` the keyboard walk, `picker-reading.svelte.ts` the state
behind both — which option the card is up for, and where the arrow keys go — and `card-placement.ts`
where a card lands. `InspectorGrid` is every `pick` target's body, so the diff's own rule (what it
WOULD do while you read, what it DID once you clicked) is stated once; a feat slot passes its
sub-choices in as `extra` rather than rebuilding the grid. `LanguagesPane` is the same search row and
the same walk over a multi-select chip list. The pane itself is not a scroll container; which element
is depends on the target, and `Inspector.bodyScrolls` decides.

**The caret stays in the search box** — and gets there on its own. `PickerSearch` focuses itself when
a picker opens, and `Inspector` hands focus back to whatever opened it when the pane closes: the pane
is the last column in the DOM, so without those two the walk this whole contract describes was 89 Tab
stops away from the card that started it. An option is a real button, so it can be tabbed to — and a
walk started from there hands focus back to the search box rather than leaving a ring on one option
while Enter takes another. That is why the search box is a `searchbox` naming the highlight through
`aria-activedescendant`: with focus that never moves, it is the only thing a screen reader has to go
on. Enter is the search box's to interpret; on a focused option the browser's own Enter is right —
which is why `fromOptions` drops `onenter` before delegating, rather than merely not supplying one.

**Not a `combobox`, and the big list is not a `listbox`.** APG's combobox is single-select with
selection following focus; these walks are multi-select and deliberately commit nothing, so the role
promised a behaviour the pickers refuse to have. `CommandPalette` is the one place the
combobox/listbox pair is right — single-select, selection follows the highlight, a transient popup —
which is why it keeps both while the builder's pickers do not.

`SectionedPicker` is a one-column **`grid`**: a row there carries two independent controls (take, and
read), `option` is Children-Presentational, so a take toggle inside one flattens to text an AT user
cannot reach — `listbox` structurally cannot express rule 6. A section header is a `row` carrying
`aria-expanded` around one `gridcell`; an option is a `row[aria-selected]` around one `gridcell`
holding both buttons, and that **gridcell is what `aria-activedescendant` names** (NVDA leaves forms
mode when it names anything else in a grid, nvaccess/nvda#16414). One column, so there is no
Left/Right walk to define and nothing to mirror in RTL. Its tab stops **rove**: the highlighted row
holds them, the first row when nothing is highlighted, so an open spell list is two stops rather than
1316. Section headers keep their own — the jump rail only ever expands, so a header that cannot be
reached is a section that cannot be collapsed.

`OptionGrid` stays a single-select `listbox` (its one taken row is its `aria-selected` one) and
`LanguagesPane` a multi-select one that says `aria-multiselectable`.

`PickerCard` is also what the **sheet's** clamped prose opens — a class feature is two lines and an
ellipsis on `SheetClasses`, and two lines with no way past them is the same defect as picking blind.
Anything that clamps a content row's text owes a click that shows the rest.

1. **The pane is never a scroll container around another scroll container.** A wheel goes to the
   innermost scrollable ancestor under the pointer, so two nested scroll surfaces in one column make
   "scroll the pane" unreachable wherever the list happens to be. The pane is a fixed-height grid;
   exactly one region inside it scrolls. (Baymard names this failure mode *scroll hijacking*; the
   compendium already avoids it with `overflow:hidden` + `min-height:0` panes.)
2. **No magic list heights.** Height comes from the layout: the grid shrinks before it scrolls, the
   sectioned list takes what is left. A `max-height` in px is rule 1 in another disguise.
3. **Six of the eight pickers have no big-list problem** — background 5, subclass ~4, species 18,
   feat 18, class 24, language 35 rows across both editions. They render as a **grid**, not a list,
   and have no scroll at all. Only spells (658) and items (773) need more.
4. **For the big two, the level (or category) is STRUCTURE, not a filter.** Collapsible sticky
   sections, all headers always visible with their counts, everything collapsed by default. A filter
   that hides the rest reads as being cut off from the list; a section does not. School /
   concentration / ritual stay real filter chips — those genuinely narrow.
5. **A collapsed section must never hide a search match** — typing expands everything with a hit.
6. **Reading and taking are separate controls.** The row body opens the article; the left-hand
   toggle takes it. A click that both reads and commits means you cannot read before you commit.
   A **double-click** takes the entry outright, in the grid and in the list alike — the same gesture
   everywhere, under the hand that is already on the row. In the list it is a shortcut to the toggle
   beside it; in the grid it skips the diff, which is the one thing that pane exists to show, and
   that is a deliberate trade: it is for someone who already knows what they want, and Ctrl+Z is the
   way back. The teaser announces it, because a shortcut nobody is told about is not one.
7. **Two tiers of reading**: hover/focus shows a compact teaser card (meta line + a clamped few
   lines, `pointer-events: none` so it needs no hover-bridge and can never be the thing you try to
   scroll); click opens the full popover. Baldur's Gate 3 is the reference for both.
8. **Cards escape the column**, so they spill over the sheet and cost the pane no height. They are
   `position: fixed`, which is what gets them out of the pane's `overflow: hidden` with no portal.
   Anchor them **horizontally to the picker container**, never to the clicked entry — in a grid the
   clicked cell's left edge is not the picker's, so anchoring to it covers the entries to its left
   and the take toggles with them. Below ~1100px there is no sheet to spill over, so a card that
   would land off-screen flips to the other side of the picker.
9. **Any click outside a card closes it**, in the capture phase, plus Escape. A click inside the
   PICKER is explicitly not "outside": the picker's own handler then reads it as "open that one
   instead", or on the entry already open as "close", so swapping and toggling need no special case.

Two traps that only a driven browser catches:

- **`hidden` loses to an author `display`.** `.popover { display: flex }` beats the UA's
  `[hidden] { display: none }`, so the element never hides and nothing about it looks wrong in a
  screenshot. Hide with `{#if}`, as the cards do, or say `[hidden] { display: none }` yourself.
- **Never scroll a section into view with `offsetTop` arithmetic.** `offsetTop` is measured from
  each element's own `offsetParent`; `h.offsetTop - list.offsetTop` only cancels while both resolve
  to the same ancestor, and one `position: relative` wrapper between them breaks it silently. Use
  live `getBoundingClientRect()` deltas, and snap the first section to a true `0` — the list's
  padding plus the header's margin otherwise leave a few px you can still scroll up past.

Caps are per class, not per level: `cantripCap` + `preparedCap` (`src/lib/build/derive.ts`). A
per-level "2/3" counter is invented game data and must never be rendered.

## Every interactive element says so

Give every clickable thing a visible affordance: `cursor: pointer`, a hover state, and a visible
`:focus-visible` ring. Users cannot discover or confidently hit a target that gives no feedback,
especially a tiny one.

Make the hover halo contrast with the row-hover background — a same-coloured halo blends away
invisibly. Enlarge small hit areas with a transparent `::before` inset.

## Shared controls and dialogs

A control that appears in more than one place is **one shared component**, not re-inlined per site.
Copies drift. The language switch is `LangSwitcher.svelte`, used by the topbar and by dialogs alike.

**Every full-screen dialog, modal, or banner carries `LangSwitcher` in its top-right corner. No
exceptions.** It can appear before the user has reached the topbar switch, or while covering it, so
it may be the only text on screen — someone who cannot read the current locale must still be able to
change it. A backdrop is also a DISMISS target, so while a dialog is open reaching for the topbar's
switcher cancels the question. `DialogShell` bakes it in (`.dialog-lang-corner`); a bespoke
full-screen component adds it by hand, and `components/dialog-lang-switcher.test.ts` holds the line —
five dialogs built from the house template missed this clause equally, which is what a rule enforced
only by memory costs.

The **house dialog shape**, which every attention dialog bakes from: a centered modal on a dim
backdrop; a round badge header with the title, an optional count pill ("1 of 2"), and one muted
subtitle sentence; a **two-pane body** whenever the decision needs a comparison, with the user's work
on the left and the thing being chosen on the right, plus a searchable picker and live preview; a
footer running destructive action far-left, then a spacer, then Skip → secondary → primary. Share the
shell through the global `.dialog` classes rather than restyling per dialog.

## Icons are drawn, never typed

A character that is **text** stays text: `−`, `≥`, `∞`, `×`, an arrow inside a sentence. A character
standing in for an **icon** is drawn — `<Icon name="…" size={13} />`
(`src/lib/components/Icon.svelte`, Lucide paths bundled locally, keys spelled the way Lucide spells
them), or plain CSS geometry when the shape is trivial. No emoji as an icon, no icon font. One
exception worth naming: a −/+ pair goes together, because half-drawn and half-typed reads worse than
either choice made consistently.

A font glyph doing an icon's job fails three ways, all worse as the display shrinks: **rasterisation**
(a small filled glyph with no vertical stem has nothing to hint against, so `◆` renders as a blob),
**font fallback** (a glyph the app's fonts lack is substituted at another font's metrics, which is why
`⇈` drew its two arrows at different heights), and **presentation drift** (`⚠`, `☀`, `✦` render as
colour emoji on one platform and monochrome on another, so the same build is not the same UI).

Two icons stay hand-drawn because no set has them: `DamageIcon` (the thirteen damage types) and
`EyeIcon` (the open/closed pair).

**An icon-only control names itself** — its glyph used to be its accessible name, and an SVG has
none, so pass `label` (which becomes `aria-label` plus `role="img"`). Beside a text label, leave
`label` unset or a screen reader reads it twice.

**An icon never lives in a string** — not in an i18n catalog, where a translator would carry or drop
the app's iconography, and not in a status or kind map. Map to an `IconName` and render it.

## Strings live in the catalogs, and so do the things that produce them

A user-facing sentence is a key in `src/lib/i18n/locales/*.json`, rendered with `$_('ns.key', {
values })`. That much is the AGENTS.md rule. The part that is easy to get wrong is everything
*upstream* of the component.

**A view-model or a pure module returns a KEY plus its values, never a sentence.** `buildTodos`
yields `{ key: 'skills', values: { count: 2 } }`; the inspector's target descriptors carry
`titleKey`/`blurbKey`. Those modules have no locale and must not acquire one — importing a store into
a pure function to format a string is how a "pure, node-testable" helper stops being either. Where a
helper genuinely has to compose text (`why()`, `abilityProvenanceText()`), it takes the translator as
a parameter.

**A closed vocabulary maps to keys, it is not a table of words.** A recharge kind, a stat-generation
method, and a writing prompt are each a fixed id list in code and a set of catalog entries beside it.

**Data is not copy.** A content row's own word for something — a species option labelled "Subrace" vs
"Lineage" — passes through as an ICU *value*, because no UI catalog can know what a user's pack calls
its columns.

**A phrase is ONE key, never a noun substituted into a frame.** "Перевірка СИЛ" is not what
`{ability} check` produces in any inflected language, so the twelve flat roll labels are twelve keys
and a translator sees the whole sentence. Where the wording branches — a count, a mode, a
suggestion being close enough — it is a whole key or a whole ICU branch per case, never a sentence
glued from halves. The same rule is why a *grammatical gender* gets its own catalog: `heavy` describes
an armour and a weapon with one English word and two Ukrainian ones, so `armorCategory` exists rather
than sharing `itemTag`'s.

**A label the PLAYER can rename is written in their language, not kept as a key.** A custom
modifier's default name ("+1 to AC") is their own effect's title and editable the moment it exists, so
`modTargetLabel` composes it through `translator()`. That is the opposite call from a roll's name,
which the log re-reads long afterwards and therefore keeps as a key — the difference is who owns the
string after it is written.

**One name per fact, one home per catalog.** An ability's short name is `abilityShortLabel` and
nowhere else; an item tag's word is `itemTagLabel`, a lookup whose default is the raw tag, so the
app-known vocabulary reads as a catalog entry and a homebrew tag reads exactly as its author wrote it.
A tag's VALUE (`versatile 1d10`) is data and passes through.

**A pure producer upstream of a component hands over FACTS, not a rendered line.** An attack row's
notes are `Note`s, a detail view's cells are `SaidText`, a compendium heading is a key plus the
value in it. Threading a translator into the producer instead freezes the language: the view-models
here derive off `app.activeLocale`, which the layout pushes into `svelte-i18n` in an EFFECT, so a
translator read at derive time is one locale behind and never re-read. Where a helper genuinely
composes text it takes the translator as a PARAMETER and is called from the view.

**Deliberately untranslated, so it is not re-proposed:** the `/dev/*` previews, whose copy describes
the harness and not the app; a theme's TOKEN names, because the token is the key the user types into
their own theme JSON and a translated label would name something they cannot find in the file. A VM
toast reads the store one-shot inside a function (`get(_)`) — a toast is fire-and-forget, so that is
correct; at module top level it would freeze at the load-time locale.

**A locale is not free of layout consequences.** The turn bar's container-query thresholds are the MAX
over shipped locales (Ukrainian labels run ~15px wider than English), and `container-type` zeroes the
min-content floor, so a too-narrow threshold clips rather than pushes. Re-measure per the recipe in
`Turnbar.svelte` when a locale is added.

**The catalogs are loaded at RUNTIME, and the locale list is discovered.** A user drops a JSON file
in and switches to it live — a locale is never a release we plan or a list we hardcode. A missing key
falls back to English rather than showing the key; sorting goes through `Intl.Collator` for the
active locale, because an alphabet is not ASCII order; and an RTL locale is served by setting `dir`,
not by a second stylesheet.

`src/lib/i18n/catalogs.test.ts` is the guard: every bundled locale must carry the same keys as
English, no value may be blank, and a placeholder used in one locale must exist in every other. A key
added to English and forgotten elsewhere otherwise renders an English sentence inside an otherwise
translated screen, and nothing complains.

## Error copy

Any string a user can see when something goes wrong is a sentence in their words answering three
things: **what happened**, **what it means for their sheet**, **what to change**. The exact technical
particular — the effect token, the column name, the validator's own complaint, an id — is **demoted,
never deleted**: it goes in the `detail` field of `ContentIssue` / `EffectIssue`, or a toast's
`description`, so the homebrew author still gets the fault while the CSV owner gets the sentence.

The app is for people who own their data as plain CSV, and the same panel serves both audiences.
`duplicate source:id "spell:SRD 5.1:x"` is a complete explanation to whoever wrote the loader and no
explanation at all to anyone else.

Name things as the UI names them: a resource by its name, an edition via `SYSTEM_LABELS`, a source
via `sourceLabel`, a form field by its own label, a route by the path the user clicks. Say the
consequence in the same sentence — *skipped*, *changes nothing*, *not offered*, *nothing was changed*.
Where a closed vocabulary was mistyped, offer the nearest candidates — as the candidates, in a key of
its own, so the guess and the plain wording are two whole sentences rather than one composed of
halves. Where a dozen internal reasons share one
meaning and one fix (every plugin failure), collapse them to one sentence at the seam and keep the
reason in `detail`. Copy for content issues lives in the catalogs under `contentIssue.*` and for derive-time ones under
`effectIssue.*`; `content/issue-text.ts` and `ISSUE_KEY` hold the CHOICE of sentence and its values,
and nothing is written inline at the `push()`. Neither producer has a locale, so an issue travels as
`{key, values, detail}` (`SaidText`) and `sayText` says it where the translator is — a panel re-read
after a language switch has to change with it. Tests assert the durable fact — the identifier in `detail`, the level, the file — never the
sentence, which is copy and will be rewritten.

## Accessibility

Keyboard navigation is there from the start: correct Tab and Shift+Tab order, visible focus, ARIA
roles and labels.

The command palette has two scopes. **`Ctrl+K` is global** — all content and every character.
**`Ctrl+Shift+K` is local** — a search of the active character's own spells, items, features,
actions, conditions, and notes, not a page-text search. Only the global one sits in the header; the
local one focuses the list's own search box inside the view. Views switch by tab bar, by `Ctrl+1..4`,
or from the palette.

**Shortcuts match the physical key** (`e.code`: `'KeyK'`, `'Digit1'`), never `e.key`, which is
layout-dependent — on a Cyrillic layout the K key yields `"к"`. **Every internal link and navigation
carries `base`** from `$app/paths`, including the palette's `goto`, or it 404s under the GitHub Pages
subpath.

Ukrainian UI copy uses the formal **«ви»**, never «ти», and prefers impersonal phrasing where that
reads naturally.

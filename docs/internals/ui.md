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
themes for free. The stylelint `color-no-hex` guard enforces the colour half; sizes are on you.

**Semantic colours are fixed:** crimson is important or dangerous, teal is good or confirming, gold
is a neutral marker. Visibility is an open/closed **eye** (teal means shown); state is a **toggle
switch**. Avoid the templated look of cream and terracotta; the shipped theme is slate with heraldic
crimson and gold, set in Space Grotesk, Inter, and JetBrains Mono.

**Before hoisting a class into the global `styles/components.css`, grep for its name** — both
`class="…name…"` and `\.name[ ,{]` across `src`. A global rule applies to every element with that
class app-wide, so a common name collides with scoped classes that reuse it for something else.
Hoisting a `.field` input base once bled onto `.field` form-row wrappers across three views. Pick
specific names for global utilities (`.text-field`, `.dialog-card`, never `.field` / `.row` /
`.item`), and keep exact values when migrating so the pixel diff stays at zero.

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
   of a breakdown.
4. **Any value is click-to-edit** — a manual override is available at any time, independent of
   whether auto-calculation is on.
5. **Lists are keyboard-navigable**: ↑/↓ move a highlight, **Enter is identical to a left click**,
   Home and End jump, type-ahead where it helps. This holds for the command palette, spell and attack
   lists, the roll log, the compendium, and every dropdown.
6. **Units are imperial first with metric in parentheses** — `30 ft (9 m)`.
7. **Resource, slot, and economy pips are click-to-set**: clicking a filled pip empties it and every
   pip after it; clicking an empty one fills it and every pip before it. Available on the left, spent
   on the right.
8. **A panel header is** a collapse chevron, the title, right-aligned actions, and a drag handle.
   Panels collapse, hide, and drag-reorder **within the two-column area only** — never a free canvas.
9. **An icon slot takes an emoji or an image.** The SRD ships no art, so the fallback is a glyph;
   homebrew and user-created entities may set an image.

The Combat view is the reference implementation. Reuse the existing primitives (`Switch`,
`EyeToggle`, `RollButton`, `DialogShell`) — grep `surface.md` before building another one.

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
change it. `DialogShell` bakes it in (`.dialog-lang-corner`); a bespoke full-screen component adds it
by hand.

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
Where a closed vocabulary was mistyped, add `didYouMean`. Where a dozen internal reasons share one
meaning and one fix (every plugin failure), collapse them to one sentence at the seam and keep the
reason in `detail`. Copy for content issues lives in `content/issue-text.ts`, not inline at the
`push()`. Tests assert the durable fact — the identifier in `detail`, the level, the file — never the
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

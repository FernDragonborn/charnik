# FRONTEND.md — component inventory + token/pattern contract

Roadmap **P7.5**. The bridge from the throwaway HTML mocks in `design-preview/` to real
**Svelte** components. The mocks (`d-charnik` = Combat, `d-inventory`, `d-spellmgr`,
`d-build`, `d-menus` = overlay catalog, plus `d-abilities`/`d-restag`/`d-spellrows`
comparisons) are the **visual source of truth**; this doc is the structural one. Authoritative
behaviour/rules live in [PLAN.md](./PLAN.md).

> The mocks use **global CSS** and have repeatedly collided on short class names
> (`.eff`, `.atk`). The Svelte build splits styling in two: the **shared UI vocabulary** lives
> in ONE curated, tokens-based global sheet `src/lib/styles/components.css` (`.card`, panel
> header `.phead/.htoggle/.chev/.grpby/.dh`, `.sectlab/.slabtoggle`, `.trace`, `.durpill`, …),
> imported once from `app.css`; everything **view-specific** stays **scoped** in its component
> (`.eff`, `.atk`, `.sprow`, `.tile`, …). This kills both bugs: no duplicated scoped copies of
> shared classes (the `.durpill` trap) and no short-name soup for the specifics. Don't split a
> view into "area chunks" that each re-scope shared classes — put the shared class in
> `components.css` (or, later, a real primitive component) so it lives in exactly one place.

---

## 1. Principles

- **Thin shell.** Components hold no D&D math — they bind to the pure rules/effects core
  (`{value, trace, notes}`) and render. Logic lives in the core, not components.
- **Per-view view-model.** A view's reactive state + actions live in one typed
  `state.svelte.ts` class exported as a singleton (e.g. `combat` for Combat): `$state`/
  `$derived` fields + arrow-method actions. Its components import the singleton and read via
  reactive aliases (`const x = $derived(vm.x)`) keeping bare names in markup; writes/binds go
  through `vm.*`. Pure, stateless helpers/constants/types sit in a sibling `helpers.ts`
  (unit-testable). Combat is the reference (`src/routes/combat/state.svelte.ts`,
  `src/lib/combat/helpers.ts`).
- **Scoped styles.** Each `.svelte` component styles only itself; no global class soup.
  Cross-cutting visuals come from **tokens** (CSS custom properties), never copied literals.
- **Reactive to stores.** `activeSystem` · `activeLocale` · `theme` (+ `buildMode`,
  per-character `layout`) drive live switches with no reload.
- **A character is bound to its system** (5e / 5.5e). The UI never reinterprets across systems.

---

## 2. Token contract

Defined in `src/lib/styles/tokens.css` (already scaffolded). Components reference ONLY these.

- **Spacing** `--space-0..8` · **radius** `--radius-sm/md/lg/full` · **shadow** `--shadow-1/2`.
- **Type** `--font-display` (Space Grotesk) · `--font-body` (Inter) · `--font-mono`
  (JetBrains Mono) + `--font-size-*`, `--tracking-label`.
- **Semantic colors** (light + `[data-theme]` variants): `--color-bg`, `--color-surface`,
  `--color-surface-2`, `--color-border`, `--color-border-strong`, `--color-text`,
  `--color-text-muted`, `--color-accent` (+ `--color-accent-text`), `--color-resource` (gold)
  `+ -soft`, `--color-success`, `--color-warning`, `--color-danger`, `--color-overlay`.
  *(Mocks also use a brighter crimson for crimson-AS-TEXT on dark and a teal — fold these into
  the token set when baking: `--color-accent-bright` for text, `--color-good`/teal,
  `--color-good-soft`.)*
- **Focus** `--focus-ring`, `--focus-offset` (a11y: always visible).

### Semantic color ROLES (consistent everywhere)
- **Crimson = important / danger** — pinned/favourite, negative effects, destructive,
  primary actions (Roll, Next turn, Level up, Add).
- **Teal/cyan = good / confirmation / positive** — available resources & slot pips, positive
  effects, temp HP, toggle-ON, "shown" eye, Strict mode.
- **Gold = everything else / neutral marker** — proficiency & prepared dots, resource
  counters, point-buy, the spell sigil-pip glow.

---

## 3. Pattern contract (cross-cutting rules — apply in every component)

1. **State on/off → toggle switch** (`Switch`, teal when on). **Never** checkboxes.
2. **Visibility (show/hide on the sheet) → open/closed EYE icon** (`EyeToggle`, teal = shown).
   Distinct from state switches.
3. **Computed value → hover/focus provenance popover** (`ProvenanceTooltip`) listing each
   `{source, op, amount}` + rule notes. A **manually-overridden** value shows a `manual`
   marker instead (no breakdown). Every auto-calc value (AC, DCs, attack bonus, mods,
   passives, max HP, capacity…) gets this.
4. **Any value is click-to-edit** (manual override, anytime, independent of auto-calc).
5. **Lists are keyboard-navigable** — ↑/↓ highlight, **Enter = click**, Home/End, type-ahead.
6. **Units** — imperial primary, **metric in parentheses** (`30 ft (9 m)`).
7. **Resource/slot pips are click-to-set** — click a filled pip → empties it + all after;
   click an empty pip → fills it + all before.
8. **Panels** — header has `CollapseChevron` (▾) + title + right-aligned actions +
   `DragHandle` (⠿). Panels collapse, show/hide, and **drag-reorder within the two-column
   panel area only** (never a free canvas).
9. **Icon slots take emoji OR image** — see `IconSlot`.

---

## 4. Component inventory

### 4.1 Primitives
- **IconSlot** — square icon container. **Default = a category EMOJI; if the entity has an
  image set, render the image instead** (object-fit cover). Used for **class, item, spell,
  effect, monster, character portrait** — anywhere an icon shows. Homebrew/user entities may
  set an image (like character photos); SRD ships none → emoji fallback. (We bundle no art.)
  *(Replace decorative emoji with a bundled category SVG set where crisp icons matter; emoji
  rendered as boxes in headless tests — not a real-browser issue, but SVG is the production
  choice.)*
- **Pill / Tag** — one shape, **color-only** variants (never restyle per variant). E.g.
  `ResolutionTag` (`attack roll` gold · `<ABILITY> save` crimson · `auto-hit` teal · none =
  empty). Type-rarity chips, duration chips, condition tags reuse the base.
- **Switch** (state) · **EyeToggle** (visibility) · **Stepper** (− value +) ·
  **DotIndicator** (small dot: gold = proficient/prepared, hollow = not — never a dimmed fill)
  · **DragHandle** · **CollapseChevron** · **kbd** · **Badge** (qty, equipped/attuned) ·
  **Button** variants (primary crimson · ghost · dashed-add) · **SearchBox** (in-view local
  search; global search is the palette).
- **PipBar** — a row of pips. **Gold "sigil" glow** for spell slots; **teal** for other
  resources; click-to-set (rule 7). **Action-economy** pips show a COUNT (Action ×2 via Haste,
  etc.), filled = available / dim = used.

### 4.2 Layout
- **ViewShell** — top bar (wordmark · **global search `Ctrl K`** · lang/system/theme chips) +
  **view tabs** (Profile · Combat · Inventory · Build, switch via tab / `Ctrl+1..4` / palette)
  + `⋮ Customize`. **Local search lives inside the view**, never the header.
- **Panel** (Card) — see pattern 8. Two header forms: simple (`▾ Title …… ⠿`) and rich
  (title + inline controls + `⠿`).
- **MasonryArea** — the two-column panel zone below the fixed stats header; drag-reorder,
  per-character persisted, collapses to one column on phone.
- **SectionLabel** / group headers (mono, uppercase).

### 4.3 Composites (the meat — see `d-charnik`)
- **HPCard** — label + `+ Temp HP` action; bar = crimson current + **teal temp segment**.
- **TurnBar** — action-economy pips (Action/Bonus/Reaction with counts + source) · Move
  ft (+m) · Round stepper · prominent **Next turn** (resets economy, advances round).
- **StatTile** (combat: AC/init/speed) + **AbilityTile** (Variant A: name·score, big modifier,
  **save chip** below, gold = proficient save) + **PassiveSensesStrip** (configurable, pin
  which skills) — the **fixed stats header**.
- **SkillList** — grouped by ability, 2-col column-major, prof dots, tap-to-roll.
- **RowList** — generic interactive row (rounded inset hover, consistent — no per-list hover).
  - **AttackRow** (weapon: to-hit + damage; crit toggle w/ method classic|loyal).
  - **SpellRow** — **effect-first** column + **ResolutionTag** + timing. The caster-wide
    **save DC + attack bonus show ONCE in the panel header**, never per row.
  - **EffectRow** (merged Effects+Conditions: pos teal / neg crimson dot, type tag, duration,
    provenance, remove; `+ Add`).
  - **ActionRow** (full standard actions + show/hide via eye menu).
- **FeatureActionGroup** — generic resource-powered class list (Battle Master maneuvers, ki,
  metamagic, Channel Divinity, invocations, rage). Data-driven; homebrew rows merge in.
- **CommandPalette** (global, two scopes: `Ctrl K` all / `Ctrl Shift K` = this character's
  own content) · **RollBuilder/DiceTray** (dice pool w/ counts, adv/dis, mod, attack mode
  with to-hit→damage→crit) · **RollLog** (full history from `log.jsonl`, scroll, per-row
  delete) · **Picker** menus (condition / add-effect / pin-skills / show-hide-actions).
- **InventoryCard** (sectioned grid, `IconSlot`, qty, equipped/attuned badges, weight/value).
- **SpellManager** — two-pane: list (per-row `EyeToggle` show / Switch prepare / pin) +
  **content wiki detail rendered from CSV**. `Allow over-cap` switch.
- **WikiDetail decomposition** (planned refactor — today one ~740-line file with 3 inline
  type branches). Split so the two edit modes (translate = prose, editor = structural) get
  clean, independent seams; keep `WikiDetail`'s public API so compendium/spellbook/translate
  callers don't change. Pieces:
  - **WikiDetail** (dispatcher) — picks the head by type, renders **source-line + `actions`
    slot + empty state**; `actions` moves HERE (rendered once under the head, type-independent
    — fixes today's quirk where it only renders in the generic branch, so Spellbook's Cast
    never shows on a spell).
  - **SpellHead / MonsterHead / GenericHead** — per-type *shapka*: eyebrow + title(+chips) +
    the structural stat block (spell strip/cells · monster vitals/abilities/band · generic
    abilities/meta). **Mode-aware** — `type DetailMode = 'read' | 'translate' | 'editor'`:
    `read` static · `translate` title=input, stats read-only · `editor` title + stat widgets
    (range dropdown+number, components V/S/M checkboxes) editable. Title lives in the head (it
    IS the top of the shapka; spell couples title+chips).
  - **ArticleProse** (shared) — body text + higher_level + material (html ↔ textarea). Plain
    `editable` bool (prose edits in both translate + editor). This is the translate surface.
  - Callers map: compendium=`read`, translate view=`translate`, future editor=`editor`.
  - Tests assert at the WikiDetail boundary (behavioral) so the split stays invisible.
- **RollButton** (shared roll affordance — extract; reused across compendium + sheet). Props
  `formula, label, variant ('d20'|'dmg'|'heal'|'hp'|'cast')`. **plain click** → `rollFormula`
  + toast; **ctrl/alt-click** → `openTray(pool)` (stub until DiceTray lands). One place owns
  the modifier-click contract + the roller + the tray hook. Replaces every inline 🎲 (spell
  effect Dmg/Heal/d20, monster HP) + Spellbook Cast. See deferred concepts:
  [[charnik-dicetray-attack-damage-concept]] (attack+damage as chained sub-rolls),
  [[charnik-3d-dice-deferred]] (variant A: 3D engine owns the number, `rollFormula` stays as
  fallback + test target).
  - **Build order:** (1) split WikiDetail → heads + prose + dispatcher (behavior identical),
    (2) extract RollButton + replace inline 🎲 + Cast, (3) mod-click → `openTray` stub;
    then later tasks: build DiceTray, wire `openTray`, optional 3D overlay.
- **StatGen** (point-buy/array/manual + steppers + points + boost breakdown) ·
  **LevelUpStepper** (HP → slots → ASI/feat → learn spells → review) · **ClassRow** +
  multiclass (per-class prereqs) — the **Build view**, with a **Strict | Free** mode toggle
  (Strict = system-aware rule enforcement; Free = anything).

### 4.4 Views (arrangements, not new components)
- **Combat** = designed sheet (`d-charnik`). **Inventory** = `d-inventory`. **Build** =
  `d-build`. **Profile** = identity + abilities/skills + features/traits/feats + proficiencies
  + background + appearance (`IconSlot` portrait) + notes — *to lay out directly in Svelte
  (recombines existing primitives; no mock needed)*.
- **App screens** (outside a character): **Roster** · **Compendium + content-health** ·
  **Settings** (rule-option toggles, sources, collisions, theme/system/locale) ·
  **Content editor** — also recombinations of `SearchBox`/`RowList`/`Switch`/tables/forms.

---

## 5. Build order (when baking)
1. Tokens (done) → primitives (Switch, EyeToggle, IconSlot, Pill/Tag, Stepper, PipBar,
   DotIndicator, DragHandle, CollapseChevron, SearchBox, Button, ProvenanceTooltip).
2. Layout (ViewShell, Panel, MasonryArea).
3. Composites for **Combat** (highest-value, exercises everything), then overlays.
4. Inventory · Build · Profile views; then app screens.

Each component: scoped styles, props from core types, a Vitest/browser test where it carries
logic. Keep the `{value, trace}` contract intact so provenance tooltips work everywhere.

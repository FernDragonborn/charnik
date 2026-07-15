# Charnik — D&D Character Tracking System (Plan)

> Index doc. Companions: [TESTING.md](./TESTING.md) · [SECURITY.md](./SECURITY.md) ·
> `FRONTEND.md` (written at roadmap P7.5) · [research/existing-generators.md](./research/existing-generators.md)

## Context

Greenfield project (`D:\data\code\charnik`). FOSS, **standalone desktop (Tauri)** app for
D&D **5e (2014) + 5.5e (2024)**. **Scope is a full character TRACKING system**, not just a
sheet generator. Three roles in one UI:
1. **Build & level-up** — create a character and advance it level by level.
2. **Play tracking** — live state during play (HP, slots, resources, conditions,
   concentration, rests, XP…).
3. **Compendium / database browser** — view, search, sort everything loaded from CSV.

Core intent:
- **Standalone desktop app (Tauri)** — the 99% use case; data is **local files on disk**.
  **Windows + Linux** (macOS ~free). **No HTTP server** → LAN/remote access is **not** a
  goal. **Responsive** kept as a light nicety (window resize), not a phone-over-LAN driver.
- **Max simple, minimal over-engineering.** FOSS.
- Content stored in **CSV** (not a DB) — obvious, editable by non-technical users in
  Excel/LibreOffice. Ships **SRD-only by default**; adding more is **very easy**.
- User can do **everything from the visual UI** — never forced to touch files.
- **Localization** (UI + content), **EN + UK**, extensible to ANY locale incl. RTL.
  Locales are data-driven, never hardcoded.
- **3.5 OUT OF SCOPE.** 5e + 5.5e only.
- Stat-generator UX reference: <https://5e.tools/statgen.html#pointbuy>

### Licensing basis
- 5e on **SRD 5.1**, 5.5e on **SRD 5.2.1**, both **CC-BY-4.0** (permanent, app-ok,
  commercial-ok; attribute). Default data = SRD only; excluded stuff (Beholder,
  Artificer, Aasimar…) not shipped — users add their own. WotC Fan Content Policy bans
  apps but is irrelevant (we use the CC route). Show attribution in the UI (About).
- **Three-layer repo licensing** (DECIDED): **code = AGPL-3.0-or-later** (root `LICENSE`;
  SPDX `// SPDX-License-Identifier: AGPL-3.0-or-later` header per source file — disclose
  modifications, incl. over a network) · **bundled data = CC-BY-4.0** (`content/LICENSE`
  + `content/ATTRIBUTION.md`, WotC SRD credit) · **user homebrew = author-owned** (app
  relicenses nothing). Summary lives in root `COPYING.md` + README "Licensing".
- **Per-source license metadata**: every `source` carries its own `license` +
  `attribution` columns in the content model, so shipped SRD (CC-BY) and community/homebrew
  sources (any license) coexist and the About/Compendium UI can credit each correctly.

---

## Effects & modifier engine (the core auto-calc) — DECIDED

The pivotal design. Goal: **derived stats update automatically from effects** (species
traits, class features, feats, equipped items, conditions), and the user can see and
trust what happened.

- **Bounded effect vocabulary + text fallback.** Effects are structured data from a
  **fixed vocabulary**, NOT an executed mini-language (also a security win — content is
  never code; see SECURITY.md):
  - `bonus:<target>:<±N>` where target ∈ {AC, save.<abil>, skill.<name>, attack,
    damage, speed, hpMax, init, abilityScore.<abil>, passive.<skill>, …}
  - `set`/`override:<target>:<value>`
  - `advantage`/`disadvantage:<target>` flag
  - `grant:proficiency|expertise:<target>`
  - `resist`/`immune`/`vulnerable:<damageType>`
  - `apply:condition:<id>`
  - `grant:resource:<id>`
  Anything outside the vocab = **free text + an optional manual modifier** the user
  toggles. No Turing-complete DSL (avoids Aurora's swamp; stays testable).
- **Expressiveness = three layers, never code-in-CSV** (DECIDED; see SECURITY.md #4):
  **L1** the bounded vocab above (data; ~95%); **L2** safe value-expressions (`1d4`,
  `prof*2`, `ceil(level/2)`) via OUR dice+arithmetic parser — non-Turing-complete,
  whitelisted vars, no `eval`; **L3** plugins for the long tail. Plugins compose on the
  engine seam: first-party/signed handlers = trusted; **community plugins run in a
  QuickJS-in-WASM sandbox** (`quickjs-emscripten`) with a narrow host API returning
  `{value, trace}`, hard time/memory limits, no DOM/Tauri/fs/network. **Design the plugin
  registry seam early** (cheap) even though the sandbox itself is deferred until demand.
  Seam prep (decided 2026-07-15, doc-only — no dead code, knip is a hard gate): the token
  namespace **`plugin:<ns>:<rest>` is RESERVED** (today such tokens parse as `unknown` → inert
  text note, which is exactly the safe default); the handler contract is pinned as a pure
  `(parsedToken, context) → Contribution[] | notes` returning the same `{value, trace}` shapes,
  time-budgeted, no side effects — first-party handlers implement it as trusted TS, community
  plugins later implement the SAME interface inside the sandbox. CSP already permits WASM
  (`wasm-unsafe-eval`, shipped for xxhash-wasm).
  `effects.csv` is a real user-extendable content type; ship its curated catalog WITH the
  engine/vocab (P4), not before — there is no SRD "effects table" to convert from.
- **Modifier stacking pipeline** (single, well-defined order; one abstraction, no ad-hoc
  bonuses): `base → ability mod → proficiency → item → feature → condition → override`,
  then clamp to score caps (20 normal, 30 epic; half-feat +1 handled in source step).
- **Explainable values (provenance).** Every derived value is computed as **value +
  trace**, not a bare number: the trace lists each contribution `{source, op, amount}`
  plus any **rule notes / blocks**. The UI exposes it on **hover (desktop) / tap
  (touch)** for any stat or modifier — e.g. an AC breakdown, or *"can't cast: wearing
  medium armor without medium-armor proficiency → spellcasting blocked + disadvantage on
  STR/DEX rolls."* **Rule-based penalties/blocks** (not only flat bonuses) surface here,
  so the user always sees **why**.
- **Effects panel** (UI): lists **all effects currently active** on the character (with
  their source); shows **which the engine auto-applied** (recognized vocab) **vs which
  are text-only/manual** (couldn't parse) so nothing is silently lost.
- **Custom & temporary effects (runtime).** Beyond content-defined effects, the user can
  **add ad-hoc effects on a character** via a **"+" in the effects panel**: a dropdown
  offers a **predefined catalog** (Bless, Bane, Haste, cover, Guidance… — sourced from an
  **`effects.csv`** content type, so it's localizable/extensible like all content) **plus
  a "Custom…" entry**. A custom effect = a name + one or more **bounded-vocab modifiers**
  (same vocab) and/or **free text + a manual modifier**. These live in **runtime/
  play-state**, not the build.
- **Optional duration.** Any active effect may carry an optional **duration in
  rounds/turns** (blank = until removed). A lightweight **round counter** (advance-round /
  end-encounter control) decrements durations; at 0 the effect **auto-expires** (with a
  notice). Rests expire temporary effects as appropriate; manual remove anytime.
- **Optional & removable BY DESIGN** (runtime *and* code-level — de-risk: if the engine
  proves flaky, it can be cut without breaking the app). Three levels:
  1. **Runtime toggle** — user turns effects-auto off → stats become manual/text-only.
  2. **Config default** — ship it on or off.
  3. **Build-time removable** — the effects engine is a **single isolated module**
     (`src/lib/effects/`) composed **on top of** the rules core via **one seam**
     (`applyEffects(derived, active)`). The rules core computes correct **base** derived
     stats with **no dependency** on the effects module, and the derived-value contract
     `{value, trace, notes}` the UI consumes is **identical** whether effects are on
     (trace includes effect contributions), off, or **deleted** (trace = base only).
  So removing the module + the one seam call leaves a fully working app — every stat is
  manually overridable, effects just show as text. **Core tests never import effects.**

### Rules core + effects engine (P4, IMPLEMENTED — `src/lib/rules/` + `src/lib/effects/`)
- `rules/pipeline.ts`: the **`{value, trace, notes}` contract** — `Contribution {source,
  layer, op, amount, note}` + `fold()` (stacking order base→ability→proficiency→item→
  feature→condition→override; `set` overrides, `mult` scales, `add` accumulates; clamp).
- `rules/core.ts`: pure per-value functions returning `Computed` — `abilityModifier`,
  `proficiencyBonus`, `savingThrow`, `skillCheck` (expertise/half-prof), `passiveScore`,
  `initiative`, `spellSaveDC`, `spellAttackBonus`, `unarmoredAC`/`armoredAC` (dex caps),
  `maxHpForClass` (SRD fixed), `carryingCapacity`. 5e/5.5e share the formulas; only the
  encumbrance variant branches on `system`. **No import of effects.**
- `effects/index.ts`: the **isolated engine** — `parseEffect` (bounded vocab, unknown →
  inert text), `applyEffects(targetKey, base, active)` (the single seam: folds matching
  numeric tokens onto a core `Computed`, non-numeric → notes; empty effects = identical
  value/trace = the on/off invariant), `collectFlags` (advantage/condition/resource/
  resist/proficiency facts). Imports core *types* only, never the reverse.
- Tests: golden SRD values, `describe.each(['5e','5.5e'])`, fast-check (mod formula,
  proficiency bounds, save = mod+prof), the seam on/off invariant, unknown-token survival.
  **TODO**: wire a character → all-derived-stats aggregator; L2 value-expressions (`1d4`,
  `prof*2`); ability-score-bonus cascade; advantage/disadvantage resolution in rolls.

---

## Feature requirements

### Calculators / automation
- Point-buy stat generator (5e.tools-style) + standard array + manual/rolled.
- Ability modifiers auto; **proficiency + expertise** toggles on skills/saves.
- ASI from correct source per system (5e: species; 5.5e: background) + level-up
  ASIs/feats. **Feat/ASI slots are per-class at class-specific levels** (Fighter
  4/6/8/12/14/16/19; most 4/8/12/16/19; Rogue +10); prerequisites respected.
- **Free-feat mode**: default RAW; user may add extra feats at ANY level (house rule);
  RAW slots vs free additions tracked distinctly.
- **BACKLOG (do with the effects system):** feats that grant **+1 (or other) to a skill /
  ability / save** don't apply yet. The builder gathers feats into the effects pipeline, but
  the SRD feat rows lack encoded effect tokens for these bonuses (and half-feat "+1 ability of
  choice" needs a user pick). Encode feat effect tokens + choice UI when the effects system is
  fleshed out; until then feat stat/skill bonuses are inert.
- Initiative, spell save DC, spell attack, weapon attack+damage — auto (via engine).
- **All passive senses** (Perception, Investigation, Insight, extensible) = 10 + mod
  (+prof/expertise, ±5 adv/disadv).
- **Carrying capacity + carried weight** — **optional (toggle)**: carry = STR×15×size
  (Tiny ×0.5, S/M ×1, Large ×2, Huge ×4, Garg ×8); push/drag/lift = ×2; over carry →
  speed 5 ft (5.5e core). **Variant encumbrance tiers** — separate toggle, **5e-only /
  optional in 5.5e**: STR×5 → Encumbered (−10), STR×10 → Heavily (−20 + disadv on
  STR/DEX/CON checks/attacks/saves). Size-scaled.
- **Metric in parentheses** next to imperial (ft→m ×0.3048, lb→kg ×0.4536).

### Character lifecycle (build → level-up → play)
- **Creation**: choose system, species, background, class, ability scores, etc.
- **Level-up flow** (first-class feature): advance a level → apply HP (roll/avg/fixed),
  new class features, ASI-or-feat at slot levels, new spells/slots, proficiency growth.
  Works for single- and multiclass.
- **Multiclass** (in scope, incl. spellcasting): ability prereqs, partial proficiencies
  on entry, HP per class, ASI count by total level, **multiclass spell-slot table**,
  per-class spell save DC / prepared lists, Pact Magic kept separate.
- **XP tracking** — **fully optional**: a `xp` field + a `levelingMode`
  (`milestone` | `xp`) toggle. In `xp` mode, level derives from XP thresholds and
  accumulated XP is tracked. Milestone mode ignores XP.

### Spellcasting model (slots · known/prepared · resources) — DESIGN, not yet built

The single most rules-heavy subsystem. Designed up front (rebuilding it piecemeal is worse
than designing it once). Split cleanly into **data (CSV)**, **rules (pure TS)**, and
**play-state**; the fiddly logic honestly stays in code — CSV holds the tables, not the rules
that consume them.

**Resolved forks (decided with the user):**
1. **Unify slot = resource.** ONE "castable pools" engine: a slot *is* a recharge-typed
   resource tagged with a spell level {id, spellLevel?, max, recharge, castsSpell?}. Class slots
   = resources keyed by level (recharge long); pact = recharge short; item/arcanum = own
   recharge. UI still renders level-tagged pools as pips, non-level ones as trackers. Collapses
   L2/L5/item-slots/arcanum into one mechanism.
2. **Per-class picker ONLY when multiclass.** Single caster class → one flat list (the common
   path). 2+ caster classes → per-class blocks, each with its own known/prepared cap and source
   list; a spell on two lists (Cure Wounds on cleric+bard) is attributed to the class the player
   picks it under. No new complexity for the 99% single-class case.
3. **Generalized `known-set`.** Every prepared/known caster has a `known-set`; the difference is
   only how it's **populated** — wizard = spellbook (owned subset, grows, editable); sorcerer/
   bard/ranger = self-known list; cleric/druid = a curated **Prepared Spells set** (see below).
   Prepared = pick from known-set, sized by data.

**Data (CSV):**
- **`spell_slots.csv`** — 4 SRD `kind`s (`full`/`half`/`third`/`pact`), matrix form: row =
  character level, columns = `slot_1..slot_9` (count of slots of each spell level). The `full`
  table doubles as the **multiclass** table (indexed by effective caster level). Per-root
  (edition slot/access differences). **Rules tables, not per-source content** — a class
  **references** its table by id (`slot_table: full` / `slot_table: mysrc:custom`); the app never
  guesses which file is which (see Content type identification).
- **Caster profile** columns on `classes.csv` / `subclasses.csv` (EK/AT are third-casters
  granted by a **subclass** at class level 3 — caster-ness can come from the subclass, gated by
  its grant level): `caster_kind`, `prepare_style (prepared|known)`, `spell_ability`, `ritual`,
  `slot_table`.
- **`class_casting.csv`** (linked `class_id`+`level`, per-edition) — per-class-level
  `cantrips_known` and the **known/prepared-set size**. In **2024** this is a **table count**
  (verified from SRD 5.2.1: cleric "Prepared Spells" column — start 4 @L1, grows, chosen from the
  class list, only levels you have slots for, swap on Long Rest). Whether **2014** uses a formula
  (`mod + level`) instead is **NOT asserted from memory** — pull from real SRD 5.1 when building
  (see data-defect note). Either way the size is **descriptor data, per-edition**, not hardcoded.
- **Spell↔class access = a bidirectional UNION map (a derived index).** Either side may declare
  the relationship, so neither edits the other's files:
  - **spell-side:** `spells.classes` (shipped SRD — each spell tags its classes).
  - **class-side:** additive `spell_lists_<pack>.csv` (`class_id,spell_id`) — a homebrew class
    (e.g. Artificer) lists existing spell ids in its OWN file.
  The loader builds the **union** into an index `class_id → available spells` (and its reverse
  `spell → classes`). NB "available", not "known" — the character's known/prepared set is a layer
  above. **Two levels:** (1) this **content-level** index is a pure function of content →
  in-memory derived (like `content.graph`, rebuilt on `content.guid`); an **on-disk cache** keyed
  by content hash is an *optional* later optimization (rebuild-if-stale), not needed at ~600
  spells. (2) **character-level access** adds subclass / feat (Magic Initiate) / item / race
  grants on top — character-specific, computed in derive, NOT in the shared index (ties to L12).
  - **Access carries provenance** (not a boolean): `{spell, via: class-list|subclass|feat|item|
    race, flavor: selectable|always-prepared|resource}` → powers "you can cast X because you're a
    Wizard" vs "because Magic Initiate" (the explainable invariant).
  - **Edition-scoped:** resolve class-side bare ids to `spell:source:id` per source — a 2014 class
    links 2014 spells; don't mix editions in one map.
  - **Compendium consequence:** a spell article's "Available to" list must read the **reverse
    union index**, NOT the raw `spells.classes` column — else a class that gained the spell via
    `spell_lists.csv` won't show. Class-list access → the Classes field (with provenance); feat/
    item grants → a separate "Also granted by" line (not classes). Per active edition.
  - Additive-only for now; a `deny` flag to subtract is far-backlog.
- **Resources = data + effect tokens.** Anything "N/day" (Mystic Arcanum, item "cast X 3/day",
  innate 1/day) is a resource: `grant-resource:<id>:<max>:<recharge>`; a spell carries
  `cast_via: slot | resource:<id> | at-will`. `grant-slot:<level>` for the rare artifact granting
  a real slot (a resource with a spell level, per fork 1).

**Builder — Strict/Free spell picker** (mirrors the existing Strict/Free rules toggle, same as
skills): **Strict** shows only spells the character may legally pick — via the access map, ≤ max
castable level for that class, within the cantrips/known/prepared caps. **Free** lifts all gates
— every spell, any level/list — for homebrew and house rules. Default follows the page's
Strict/Free toggle (Free by default, per the lenient stance).

**Rules (pure TS core):** `effectiveCasterLevel` — multiclass slots are the **SUM** of caster
contributions (Σ full-levels + Σ⌊half/2⌋ + Σ⌊third/3⌋; Artificer rounds ½ **up**; **warlock
levels don't count** — Pact Magic fully separate), indexing the ONE multiclass (full) table —
**not** the highest/senior class. Single-class uses its own `kind` table by its level.
`slotPool` (table + `grant-slot`; levels stack); known/prepared caps; resource resolver; the
highest spell level you can **learn/prepare** is capped by your level **in that class** (slots
may exceed it → upcast); upcast + cantrip scaling (later).

**Play-state (schema already fits):** `spellSlotsSpent` keyed `"1".."9"` + `"pact"`;
`resourcesSpent` keyed by id. Only resource **definitions** are derived (not stored in play).

**Logic hazards still to mind while building:**
- **L4** wizard top tier = the **class spell LIST** (bounded set via access map, level-gated) —
  **not** "every spell in the game"; then spellbook (known) ⊂ list, prepared ⊂ spellbook.
- **L6** subclass casters activate at the subclass grant level (gate in builder).
- **L7** always-prepared (domain/oath/Magic Initiate) is **outside** the prepared-set count, but
  still counts as a class spell.
- **L8** rituals cast without preparation/slot — "castable" ≠ "prepared".
- **L9** cantrips are independent of slots (pure warlock has 0 shared slots but has cantrips).
- **L10** a slot casts any spell of level **≤** its own level (upcast, with scaling) — the
  unified slot-resource must allow spending a higher slot on a lower spell. **Warlock forces
  upcast**: every Pact spell is cast at the current Pact-slot level (a level-9 warlock casts a
  known 1st-level spell as 5th).
- **L11** multiclass = **multiple spell DC / attack** (each class its own ability: wizard INT,
  cleric WIS). `deriveSheet.spellcasting` currently returns only the FIRST caster — an existing
  bug, not just future: it must become per-class.
- **L12** subclass/feat spell grants come in **flavors** that must be distinguished:
  *always-prepared* (outside the count) vs *added to your list* (selectable) vs *1/day free*
  (resource). **Feats grant spells too** (Magic Initiate, Fey Touched) — a spell source outside
  the class list.
- **L13** ritual **source** varies: wizard rituals cast from the **spellbook even unprepared**;
  prepared casters ritual only what's prepared → needs class "can ritual" + spell `ritual` tag.
- **L14** (minor, defer) costly/consumed **material components** (Revivify's 300gp diamond) —
  tracking consumed materials.

**Data defect to fix first (found while verifying SRD):** the shipped **2014** class-feature
prose is **truncated** — cleric Spellcasting text in `srd-2014` is just "you can cast cleric
spells", missing the mechanics. So 2014 casting rules can't be read from our data yet. Backfill
2014 class features from the full SRD 5.1 before encoding `class_casting` for 2014.

### Play-state tracking
- HP current/temp/max, hit dice used, **death saves**, exhaustion.
- **Spell slots used**, prepared/known management, **re-prepare on long rest**.
- **Resources** used (Ki, Rage, Sorcery/Channel/Bardic, item charges…) AND **custom
  resources** declared by homebrew (name, max formula, recharge: short/long/dawn/custom).
- **Conditions** (poisoned/frightened/prone/exhaustion…) that feed the effects engine.
- **Concentration**: track which spell; prompt on damage. (Aurora failed here.)
- **Active effects**: list of content/condition/custom effects currently applied, each
  with optional remaining **duration (rounds)**; a **round counter** advances and
  auto-expires them (see Effects engine).
- **Equipped vs carried / attuned (3 slots)** — equip/attune state drives AC, attacks,
  and effect bonuses.
- **Rests**: short/long rest actions restore HP / hit dice / slots / per-rest resources;
  5.5e long rest −1 exhaustion.

### Character sheet fields (verified vs official UA 5.5e sheet)
Identity: name, player, species, class(es)+levels, subclass, background, alignment,
XP/level, **size**, **photo**. Abilities + mods + saving throws; skills w/
prof/expertise; AC, **shield**, initiative, speed (ft+m); HP/temp/max, hit dice,
death saves; **proficiency bonus**; **Heroic Inspiration**; passive senses; conditions.
Attacks: name, atk/save bonus, damage & type, **mastery (Прийоми)**. Spellcasting:
ability mod, save DC, attack; slots (lvl 1-9, total/used); spells table (level, name,
casting time, **concentration/ritual/material К/Р/М**, notes, prepared/known). Inventory
w/ per-item weight → totals + (optional) capacity; **attunement (3 slots)**; currency
cp/sp/ep/gp/pp. **Optional appearance** (age, height, weight, eyes, skin, hair, marks).
**Notes** (free-form). UA official terms (CON = Статура) seed the `uk` locale.

**Separate sections — NOT one blob**: Class features · Species traits · Feats ·
Armor/weapon proficiencies · Tool proficiencies · Languages — each its own section.

### Compendium / browser
- Browse every content type. **Search respects active system, or across both** when the
  user picks "all". Sort/filter: spells by level/school/(class, casting time…); generic
  sort/filter elsewhere. **DONE** (groupings: level/school/source/A–Z + school/source facets +
  edition; the parenthetical class/casting-time spell facets remain an optional nice-to-have).
- **Content-health view**: diagnostics over loaded content — broken references, missing
  translations, ID collisions, malformed rows. Valuable since content is user-edited.
  **DONE (commit `bfe3df0`)** — Settings ▸ Content health, over `graph.issues`/`metaIssues`/`driftItems`.
- **Two-dimensional source filtering + collision resolution — DONE (commit `bfe3df0`).** Settings ▸
  Sources (per-source + per-file enable toggles; a row shows iff file AND source enabled) and ▸
  Collisions (same `type:id` overlapping an edition → keep-all / keep-one = the collisions.json
  resolution). Browse-layer only via `sources.svelte`'s persisted `sourceConfig` + pure `isRowActive`/
  `detectCollisions` — the loader/core graph is untouched, so it's live + never drops data. The
  homebrew fork-override (Editor mode) is the same mechanism (keep-all, homebrew sorts on top).

### Custom content types (add + persist via UI forms)
Species (+subraces), Backgrounds, Classes, Subclasses, Class features (per level),
Feats, Spells, Weapons (+mastery), Armor & shields, Gear (weight), Tools & tool profs,
Fighting styles & maneuvers, Languages, Conditions, Damage types/schools, Skills,
**Effect packages** (`effects.csv` — predefined buffs/debuffs feeding the effects-panel
catalog; carry bounded-vocab `effects` + optional default duration), optional Magic
items. Each may carry **effects** (bounded vocab).

### Roster, dice, logging, runtime switches
- **Roster**: manage many characters — list/create/duplicate/delete/search.
- **Dice roller** (in scope): roll with computed modifiers (attacks/saves/skills/damage),
  adv/disadv.
- **Change-log** (in scope): optional per-character event history (leveled up, took
  damage, spent slot…), stored as **append-only `log.jsonl`** (NOT in `character.json`,
  so it doesn't bloat it; capped/rotated).
- **Runtime switches, no restart**: language · **active system (5e↔5.5e) for browsing/
  creation** · theme (light/dark + custom). **Live CSV reload** via file watcher
  (debounced; reparse changed file only; manual refresh fallback).
- **System is a property of the CHARACTER, not a free toggle.** A built character is
  **bound to the system it was created in** (stored in its JSON) and always renders in
  it — you don't reinterpret a 5e character as 5.5e. The active-system switch only sets
  the **compendium/creation** context. **Converting a character between systems is OUT
  of scope** (mechanics differ too much); a character stays in its system.
- **PWA deferred** (not dropped): responsive covers phone-over-LAN; PWA only adds
  install/offline-shell, low value while data lives on the server.
- **Accessibility baseline (in scope)**: proper **keyboard navigation** from the start —
  correct **Tab / Shift+Tab** focus order, visible focus, ARIA roles/labels; **command/search
  palette in two scopes — `Ctrl+K` = GLOBAL** (all content + every character) and
  **`Ctrl+Shift+K` = LOCAL** = search the **active character's OWN content** (their spells,
  items, features, actions, conditions, notes) — a "find on this character", NOT page-text
  search; it's only list-heavy on **Spellbook / Inventory / Compendium**, which additionally
  get an **inline list filter**. **Only the GLOBAL search sits in the header**; the
  **local/view search lives INSIDE the view** (the list's own search/filter box, e.g.
  Inventory's item filter, the Spellbook search) — `Ctrl+Shift+K` just focuses it; it is NOT
  a header button. **Views switch** via a **tab bar** (Profile · Combat · Inventory · Build),
  `Ctrl+1..4`, or the palette. **All shortcuts match the PHYSICAL key (`e.code`, e.g.
  `KeyK`/`Digit1`), never `e.key`** — so they work on any keyboard layout (Cyrillic etc.),
  not only English. (Also: every internal link/navigation, incl. the palette's `goto`, must
  prefix `base` from `$app/paths` or it 404s under the GitHub Pages subpath.)
  **Every scrollable/selectable list is
  arrow-key navigable**: ↑/↓ move a highlighted item, **Enter activates it (identical to a
  left-click)**, Home/End jump, type-ahead where useful — applies uniformly to the command
  palette, spell/attack lists, roll log, compendium, and every dropdown. Cheaper now than
  retrofitting; details in `FRONTEND.md` (P7.5).
- **Content-pack sharing (in scope)**: export a whole **`source`** as a portable set
  (its CSVs, optionally zipped) so users can share homebrew packs; import re-uses the
  collision/health flow. (Distinct from per-character bundle export.)

---

## Content sources & loading

- `charnik.config.json` lists **content root folders** (e.g. `<dataDir>/content/core/`,
  `<dataDir>/content/homebrew/`); app scans + merges. Any number of CSVs per type
  (`species_srd.csv`, `species_phb.csv`…), merged by type.
- **Enable/disable BOTH per-file AND per-`source`-tag** (independent toggles in UI):
  `enabled(row) = fileEnabled AND sourceEnabled`. Add/remove roots in UI.
- **Add content via app**: per-type forms write rows into a homebrew CSV
  (`papaparse.unparse`). App **only writes files it owns**; never rewrites hand-edited
  user files. Writes are **atomic** (temp→rename), **UTF-8 BOM + CRLF** for Excel.
- **In-memory indexed content graph**: on load, build indices (by id, type, system) and
  resolve references; no repeated linear scans.

### IDs & duplicates
- Identity = **`type:source:id`** (type-scoped, source-namespaced). *Refinement found in
  P4 impl*: slugs are unique **per type**, not globally — e.g. `shield` is both a spell and
  an item, so `source:id` alone collides; the **type** must scope identity. Same id across
  sources still coexists (`spell:SRD 5.1:fireball` vs `spell:SRD 5.2.1:fireball`). Links
  (class→features, character→content) and the loader index use this key.
- **Duplicate-group detector** surfaces "same `type:id` base across sources"; resolution
  stored in a **separate `collisions.json`**: *keep one* (pick winner) or *keep all*
  (distinct, default). Exact `type:source:id` clash within one source = error (auto-suffix).

### Content loader (P4, IMPLEMENTED — `src/lib/content/loader.ts`)
`loadContent(storage, roots)` → a `ContentGraph`. **Storage-agnostic** (Tauri fs / node-fs /
in-memory / read-only fetch — serves desktop AND web). Per root: reads `_pack.json` defaults,
lists `*.csv`, infers type from `<filebase>_*.csv`, parses (papaparse) + validates
(`parseRow`/zod). Builds `byType`, `byEffectiveId` (`type:source:id`), and **`articles`**
(`type:id` → all editions/sources, powering the 5e↔5.5e toggle). Discovers **locales** from
`name_/text_` columns (BCP-47 guardrail). **Robustness is output, not exceptions**: invalid
rows / unknown files / malformed locale columns / duplicate ids become `issues`
(content-health), never throws; `get()` returns `undefined` and **`resolveRefs()`** reports
missing referenced ids so the render layer can "render what's possible + flag it".
`featuresForClass()` resolves the class→features linked table. Tested in-memory + against the
real shipped content (658 spells, 531 monsters load with zero errors). `NodeStorage`
(`src/lib/storage/node.ts`) added for those integration tests. **Note**: spell→class access =
inline `spells.classes` **plus** an additive `spell_lists.csv` join (so homebrew classes add
access without editing shipped spells — see Spellcasting model). **TODO**: `spell_slots.csv` +
`class_casting.csv` + `spell_lists.csv` join (see Spellcasting model), explicit type
declaration + UI type-assign (see Content type identification), backfill truncated 2014
class-feature prose from SRD 5.1, `collisions.json` read/write, wire `charnik.config.json` for
roots.

### Content type identification (which CSV is what) — DESIGN

Users add their own CSVs and **organize them into folders freely**, so the app can't rely on
one rigid convention to know a file's **type** (schema). Two separate concerns, don't conflate:
- **(a) What TYPE is this CSV?** (schema) — precedence, first match wins:
  1. **Explicit declaration** (survives any name/folder): a first-line directive
     `#charnik-type: spell_slots`, or a `_pack.json` map (`{ "files": { "x.csv": "spell_slots" },
     "globs": { "slots_*": "spell_slots" } }`).
  2. **Filename convention** (current behaviour): `<filebase>_*.csv` → type. Zero-config for the
     shipped SRD and anyone who follows it.
  3. **Ask in the UI**: an unrecognized file is **never silently dropped** — it's surfaced in
     content-health and the user assigns its type once (persisted to the manifest).
- **(b) What ROLE does a row play / who uses it?** — already solved by **references**, not
  guessing. A class points at its slot table (`slot_table: full`), a character points at content
  by `type:source:id`. The app never infers "this file is warlock's slots" from a filename.
- **Column-fingerprint auto-detection** (infer type from the column set) — **rejected as a
  primary mechanism** (localization/custom columns make it unreliable, schemas overlap). Parked
  on the **very-far backlog** ("someday, maybe" — only as a last-resort hint, never authoritative).
- This is a **general** content problem (any user content), not spellcasting-specific.

### Per-system fidelity (5e vs 5.5e)
A row tagged `systems=5e,5.5e` means mechanics are **identical** in both. When they
differ: **split into two rows** (one per system, shared base id) for big differences, or
use **per-system override columns** (e.g. `mastery@5.5e`) for small ones. Don't force
one row to lie about both.

---

## Data model (CSV)
- Common columns: `id`, `systems`, `source`, `name_en/uk`, `text_en/uk`, **`effects`**
  (bounded-vocab, `;`-separated), + type-specific mechanics columns.
- **Localization = L2 suffixed columns** (all languages side-by-side; missing → EN
  fallback; add language = add `name_xx`/`text_xx`).
  - **Loader discovers content locales from these columns** (union with UI-catalog
    locales; EN always present as fallback). The active locale's search/sort reads
    `name_<code>`/`text_<code>` and falls back to `_en` per missing cell, so a row that
    has e.g. `name_es` is findable under Spanish.
  - **Guardrail (avoid the foot-gun):** the suffix MUST be a validated **BCP-47 code**
    (`es`, `uk`, `pt-BR`) via a strict `^(name|text)_[a-z]{2,3}(-[A-Za-z0-9]+)*$` grammar —
    NOT a free-form name (`name_spanish`). Columns that don't match the grammar are
    **flagged in content-health, never silently treated as a locale** (prevents phantom/
    duplicate locales from typos like `spanish` vs `es` vs `es-ES`). Enumerate once at load.
- **Nested via linked tables**: `class_features.csv` keyed by `class_id` + `level` (incl.
  ASI/feat slot levels). **Resource defs** as columns/linked rows.
- Multi-value cells: `;` delimiter; small JSON blob only where unavoidable.
- **`schemaVersion`** present in content + character files from day 1 (migrations).
- **Per-type schema + validation** (e.g. `zod`): one schema per content type, **shared**
  by the loader, the content-editor forms, and the content-health view (required columns,
  types, valid `systems`, valid effect vocab). Bad rows are flagged, not crashed on.
- **Spell modeling** needs structured columns for components/range/area/duration and
  **upcasting + cantrip scaling** (semi-structured) — design carefully in P3.

### Finalized column model (P3, IMPLEMENTED — `src/lib/content/schemas.ts`)
zod schemas per type, validated by `parseRow(type, row)`; co-located test
`schemas.test.ts` also asserts **every shipped SRD row validates** (data↔schema gate).
Common columns on every type: `id` (lowercase slug; identity = `source:id`), `systems`
(comma list over `5e,5.5e`), `source`, `name_en/uk`, `text_en/uk`, `effects`
(`;`-sep bounded-vocab tokens, validated by kind prefix). Type-specific:
- **species** `size, speed, creature_type` (5e ASI rides in `effects`; 5.5e splits it to background → ASI rows are usually system-split).
- **class** (`classes_*.csv`) `hit_die, primary_ability, saves(2), caster(full/half/third/pact/none), spell_ability, skills_choose, skills_from, subclass_level`.
- **class_feature** (`class_features_*.csv`, linked by `class_id`+`level`) `class_id, level, resource`.
- **background** (`backgrounds_*.csv`) `skills, tools, languages, ability_choices, origin_feat` (last two = 5.5e).
- **feat** (`feats_*.csv`) `category(origin/general/fighting-style/epic-boon/general-2014), prereq, repeatable`.
- **spell** (`spells_*.csv`) `level, school, casting_time, range, components, material, duration, concentration, ritual, classes, resolution(attack/save/auto/none), save_ability, damage, higher_level`. Caster-wide DC/attack are **computed, never stored**.
- **item** (`items_*.csv`) `category, item_type, cost, weight_lb, properties, damage, damage_type, range, ac, armor_dex_cap("" full / "2" medium / "0" heavy), str_min, stealth_disadvantage, attunement, rarity`.
- **condition** (`conditions_*.csv`) `negative` (crimson vs teal); mechanics in `effects`.
- **effect** (`effects_*.csv`, runtime "+" catalog) `kind(bounded vocab), target, op, value, duration_rounds`.
- **Pack manifest** `content/<root>/_pack.json` carries `schemaVersion, source, license,
  attribution, systems` for the whole pack → rows don't repeat license/version; per-row
  `source` still allowed so packs merge. (Supersedes a per-row `schema_version` column.)
- **TODO (later)**: 2024 subclass-level overrides (all level 3) via per-system override
  column rather than the seeded 2014 `subclass_level`; bulk SRD fill beyond the seed.

### "Articles" + edition toggle (UI/model)
A single content row is an **"article"**. When an article exists in BOTH editions (same
base slug across `SRD 5.1`/5e and `SRD 5.2.1`/5.5e — e.g. `fireball`, `longsword`,
`barbarian`), the **article view and search results carry a 5e↔5.5e toggle**. The two
versions are distinct rows (`source:id` differs, `systems` differs); the loader/UI groups
them by base slug. This is a **per-article local** switch (compendium/search), distinct
from the global `activeSystem` context.

### Data-model refinements surfaced by the full SRD extraction (TODO, non-blocking)
The schema accepted everything (all rows validate) — `effects` + verbatim `text_en` absorb
the rest — but a few things sit in text that would be better structured. Add via
`schemaVersion` migration, in priority order:
1. **`spell_lists.csv` linked table** (spell_id × class_id). SRD 5.1 lists class spell
   lists separately, so 2014 spells have an empty `classes` column; a linked table fixes
   both editions uniformly (supersedes the inline `spell.classes` string).
2. **`mastery` column on item** (5.5e weapon mastery) — currently folded into `properties`.
3. **Species ability bonuses → `effects`** (`flat-bonus:con+2`) instead of only prose
   (5e: on species; 5.5e: on background); model **subraces/lineages** (e.g. Elf lineages).
4. **Monster**: optionally structure `saving_throws`, `damage_resist/immune`,
   `condition_immune`, `legendary_actions`, `proficiency_bonus` (now all in `text_en`).
5. **`resource`** on class features (rage/ki counts) — currently unparsed.
None block the loader; they raise fidelity where the UI later wants structured filters.

### Shipped SRD content (P3 — `content/srd/*.csv`, GENERATED not hand-written)
**Hard rule: content is never authored from memory.** Every row is parsed from the
official **CC-BY-4.0 SRD 5.2.1** markdown by converters in `tools/srd/` (source mirror:
downfallx/dnd-5e-srd-markdown; see `tools/srd/README.md`). Each converter **asserts its
row count against the source**, so a dropped entry fails loudly. Tagged `5.5e` (2024 SRD;
not claimed as `5e` — 2024 diverges). Current (all 5.5e):
**339 spells, 390 items** (38 weapons · 13 armor · 81 gear · 258 magic), **174 class
features, 17 feats, 15 conditions, 12 classes, 9 species, 4 backgrounds**. Structured
columns are parsed from the text, blank where ambiguous, never guessed; verbatim text in
`text_en`; within-file id clashes auto-suffixed (`-2`).
- **Rejected source**: BTMorton/dnd-5e-srd (OGL 1.0a, not CC-BY; SRD 5.0).
- **Not seeded** (deliberate): the runtime `effects` quick-pick catalog (an app concern,
  not a raw SRD type); subclasses; monsters. **5e/SRD-5.1 pass** (Tabyltop/CC-SRD) pending.

---

## Localization (UI)
Per-locale **runtime JSON message catalogs** (`en.json`, `uk.json`): `t("key")` →
string; `{var}` interpolation + plurals; missing key → **EN fallback**. Runtime
catalogs (e.g. `svelte-i18n`) chosen so users drop in a new locale and switch live
without rebuild; locale list **discovered at runtime**; **RTL** via `dir`. Sorting uses
locale-aware `Intl.Collator`.

---

## Saved-character storage — JSON per character
`characters/<slug>/` holds: `character.json` (+ photo sibling, by name not base64) +
optional `log.jsonl`. **Schema separates build/definition from runtime/play-state**
(different lifecycles):
- **definition**: system id (the character is bound to it), `schemaVersion`,
  species/background/class+subclass, level, **chosen options** (picked skills/tools/
  fighting-style, ASI allocation, known/prepared spells — a **dedicated schema design,
  P7**: must survive content edits and be re-editable on level-up), ASI sources, separate
  proficiency/language/feat arrays, appearance.
- **runtime**: current/temp HP, hit dice used, death saves, slots used, resources used,
  active conditions, concentration, equipped/attuned, xp.
Default save = **id references only** (small, portable); **bundle export**
(`character.bundle.json`) embeds referenced content rows to open anywhere. Missing
referenced content → render what's possible + flag it. **Autosave** (debounced) +
rotating **backups** (no DB → corruption guard; atomic temp→rename).

### Character model (P7, IMPLEMENTED — `src/lib/character/`)
- `schema.ts`: zod `characterSchema` = `{ schemaVersion, id, system, build, play }` with the
  hard **build ↔ play** split. **build** = name/species/background/classes(+subclass,
  multiclass)/abilities/skills/saves/feats/inventory/spells/photo/notes/xp. **play** =
  hp(current/temp/override), hitDiceSpent, spellSlotsSpent, resourcesSpent, effects
  (runtime instances w/ optional round duration), concentration, inspiration, deathSaves,
  exhaustion, round. Content is stored as **`type:source:id` refs** (loader effectiveId),
  not copies. `newCharacter()` factory + `parseCharacter()`.
- `repository.ts`: `save/load/list/deleteCharacter` over the **`Storage`** interface
  (desktop + web), path `characters/<slug>/character.json`. Load = **parse → migrate
  (schemaVersion registry) → validate**; a corrupt/invalid/too-new save is *reported*
  (`LoadResult.error`), never thrown — the roster still lists it flagged. Roll log =
  append-only `log.jsonl` (`appendLog/readLog`), kept out of character.json.
- Tested in-memory (round-trip identity, build/play isolation, invalid-save refusal,
  corrupt-save reporting, newer-schema rejection, roster, roll log). `MemoryStorage.remove`
  made recursive to match node/Tauri. **TODO**: autosave debounce + rotating backups,
  bundle export/import, `newCharacter` slug from name in the UI layer.

---

## Data directory & config
The `dataDir` holds everything the user owns: `content/`, `characters/`, `charnik.config.json`,
`collisions.json`. Because "own your data as plain CSV" is a core goal, the folder MUST be
**discoverable** — a hidden per-app dir (`%APPDATA%\io.github.ferndragonborn.charnik`, the initial implementation)
fails that: users can't find it. So:

- **Default location = `<documentDir>/charnik`** (e.g. `C:\Users\<u>\Documents\charnik`) — a
  **visible** folder literally named `charnik`, not the hidden OS app-data dir.
- **First-run dialog**: on first launch (no config pointer yet) a modal proposes the default
  location and lets the user **pick a different folder** (Tauri `plugin-dialog`). The choice is
  saved to a tiny **pointer config** at `appConfigDir()/config.json` (`{ dataDir }`) — the one
  small app-managed file the user never edits; the data itself lives at the chosen path.
- **Settings → Data** (when the Settings page lands): shows the current path + **[Change folder…]**
  (re-pick) + **[Open content folder]** (reveal in the OS file manager via `plugin-opener`
  `revealItemInDir`).
- **Resolution order** (`storage/tauri.ts`): pointer config → else the `<documentDir>/charnik`
  default.
- **fs-scope** (`capabilities/`): statically allow `$DOCUMENT/charnik/**` + `$APPCONFIG/**`; an
  **arbitrary user-picked folder** is granted at runtime via a Rust command
  (`app.fs_scope().allow_directory(path, true)`), re-applied on startup for a saved custom path.
- **No auto-migration** from the old `%APPDATA%\io.github.ferndragonborn.charnik` for now — we deploy fresh to test
  seeding (a migrate/import path can come later).
- All file IO stays confined to `dataDir`/roots via the **`Storage` interface + Tauri fs capability
  scope** (see SECURITY.md).

---

## Live refresh & file-watching
Goal: show new on-disk data (edited CSVs, a changed data folder) **without restarting the app**.
Three levels, phased (`src/lib/content/reload.ts`):

- **Phase A — controlled reload (DONE).** `reloadApp()` flushes pending writes (views register a
  flusher via `onBeforeReload`, e.g. combat's debounced autosave) then `location.reload()`. This is a
  **webview reload, not a process restart** — the Rust side stays up, the SPA re-mounts and re-reads
  content + characters from disk. Triggered by **F5** or the topbar **⟳** button. Reliable + simple;
  a data-folder change also uses a reload.
- **Phase B — no-flash live reload (DONE).** Views derive from the shared reactive content store
  (`content.graph`) rather than caching `getContentGraph()` in `onMount` — combat/build VMs, the
  compendium and the spellbook. `reloadContent()` (store) rotates the graph → every derived list
  re-renders with no page reload; the character's play-state/draft is untouched. The topbar **⟳**
  does this soft refresh (`reloadContent()` + `loadRoster()`); `resetUserStorage()` re-resolves a
  changed data folder.
- **Phase C — file watcher (DONE).** `src/lib/content/watcher.ts` watches `<dataDir>/content` on
  desktop → debounced (300 ms) `reloadContent()`, so editing a CSV on disk updates the UI live.
  `reloadContent()` only reads, so the app's own homebrew write can't loop; debounce coalesces
  bursts / tolerates torn reads.

**Known problems (and how B/C avoid them):** views cache the graph in `onMount` → won't live-update
(fix = the version signal, #B); the watcher must **ignore the app's own writes** (no write→reload
loop) and **debounce bursts / tolerate torn reads** (keep last-good graph on a parse fail); a live
reload must **not clobber in-progress edits** (scope it to content + roster listing, never the open
character's play-state/draft — missing refs just get flagged); one `reloadContent()` coordinator must
reset **every** cache (storage root, graph, roster, spell-access, search) or a view goes stale.

---

## Architecture — Tauri desktop app + SvelteKit (TypeScript)
**Standalone desktop app, no HTTP server.** Shell = **Tauri v2** (Rust core + system
webview); frontend = **SvelteKit with `adapter-static` (SPA, `ssr=false`)** loaded in the
webview. **All logic is framework-agnostic TS in the core**; the only Tauri-specific part
is the IO layer.
- **File IO behind a `Storage` interface.** One narrow interface (read/write/list/watch
  within dataDir). Runtime impl = **Tauri fs** (`@tauri-apps/plugin-fs` + `-dialog` for
  folder pick + `path` API), sandboxed by Tauri **capabilities / fs-scope**. A **node/
  in-memory impl** backs tests (no Tauri needed) → core/content/character logic is fully
  testable without the shell.
- **File watching** = Tauri fs watch (NOT `chokidar` — no node runtime in the webview).
- **Minimal Rust**: mostly `tauri.conf.json` + capability files + official plugins; custom
  Rust commands only if a plugin can't cover something. (User doesn't know Rust → keep the
  Rust surface tiny.)
- **No server → no LAN/IP/auth surface** (simpler security; see SECURITY.md). LAN/phone
  access is therefore unavailable (accepted: standalone 99%).

### Second target: free web demo on GitHub Pages (desktop stays priority)
The **same `adapter-static` SPA** deploys to **GitHub Pages** — a full client-side web
version (create/track/save a character in the browser) at **zero cost** (no server exists
by design → nothing to host/pay for; public repo, CC-BY data). ~95% shared code; the whole
difference is at the **`Storage` seam** + content source:
- **Platform seam**: build flag `PUBLIC_PLATFORM=web|desktop` selects the Storage factory
  and disables desktop-only bits (file-watch, folder pick). Nothing above `Storage` changes.
- **Web Storage impl** = **IndexedDB or OPFS** (NOT localStorage — 5 MB cap too small);
  `watch` is a no-op. Characters + homebrew live here. **Persistence is browser-evictable
  → push export/download as backup.**
- **Content on web** = the bundled SRD CSVs served as **static assets via `fetch()`**
  (read-only source); the loader stays **Storage-agnostic** (a read-only fetch source +
  a browser source), so no loader changes. Homebrew still addable via forms → browser store.
- **Export/Import = same format, different transport.** Character JSON / **bundle export**
  (embeds referenced content rows) is identical across platforms → a character made on web
  opens on desktop and back, **zero conversion**. Desktop uses file dialogs; web uses
  **download / file-upload (+ drag-drop)**. For cross-device transfer prefer the **bundle**
  (web ships only SRD; desktop may have homebrew — the bundle carries the needed rows so it
  always renders fully). This is the existing bundle-export design, just wired to a download.
- **GH Pages specifics**: set `base` path (repo subpath), add SPA `404.html` fallback, CI
  workflow to build + publish. GH Pages free tier (~1 GB / 100 GB-mo) dwarfs our few-MB SPA.
- Reinforces the invariants that already make this nearly free: static SPA, all IO behind
  `Storage`, nothing above the interface imports Tauri.
- **Dev**: `pnpm tauri dev`. **Package**: `pnpm tauri build` → per-OS installers/binaries
  (Win `.exe`/`.msi`, Linux AppImage (appimage-only, `tauri.linux.conf.json`)). **Toolchain**: Rust (rustup) + **MSVC C++
  Build Tools** on Windows; WebView2 runtime (already present); webkit2gtk on Linux. The
  TS side (SvelteKit + core + tests) scaffolds and runs **without** Rust; Tauri wiring
  needs the toolchain.

Layers (framework-agnostic core, thin Tauri/SvelteKit shell):
- **Rules core** (pure TS, tested): mods, prof, ASI per system, passive senses, optional
  capacity, attack/spell math, the **modifier stacking pipeline**; produces base derived
  values as `{value, trace, notes}` **with no dependency on effects**. Shared base +
  `5e`/`5.5e` overrides; reactive to active system.
- **Effects module** (separate, isolated, **optional/removable**): the bounded-vocab
  interpreter, composed onto the rules core via **one seam** (`applyEffects`). Disabled
  at runtime/config or excluded at build without touching core or UI (stable contract).
- **Storage interface** (the one IO seam): `read/write/list/watch` within dataDir.
  Runtime impl = **Tauri fs**; **node/in-memory impl** for tests. Everything above
  depends on the interface, not on Tauri.
- **Content store**: scan roots, parse CSV (`papaparse`), merge, build indices, detect
  collisions, filter by `systems`, resolve locale (EN fallback). **File watch via the
  Storage interface (Tauri fs watch)** → debounced live reload; **ignores self-writes**
  (no write→reload loop).
- **Character store**: load/save JSON + photo + `log.jsonl`; autosave/backups; bundle.
- **Content-source manager** · **Compendium + content-health** · **Roster** ·
  **Dice roller** · **Theme system** (CSS tokens + `data-theme`; custom themes).
- **UI**: sheet · stat generator · level-up · compendium · content editor · settings.

Libs (minimal): `papaparse`, `svelte-i18n`, `zod`; **Tauri v2** + plugins
(`@tauri-apps/api`, `plugin-fs`, `plugin-dialog`). File-watch via Tauri (no `chokidar`).

---

## Resolved decisions
1. **Stack** — **Tauri v2** desktop + **SvelteKit (`adapter-static` SPA, TS)** + **pnpm**.
   File IO behind a `Storage` interface (Tauri fs at runtime; node/in-memory for tests).
   Packaging: see #14.
2. **Systems** — 5e + 5.5e only; 3.5 out.
3. **Scope** — full character **tracking** system (build + level-up + play + compendium).
4. **Effects** — bounded vocab + text fallback; stacking pipeline; effects panel
   (auto vs manual); **global optional toggle**.
5. **Saved character** — JSON per char; **build vs runtime split**; `schemaVersion`;
   `log.jsonl` separate; bundle export; autosave + backups.
6. **Localization** — content L2 columns + EN fallback; UI runtime JSON catalogs; RTL.
7. **Content sources** — multi-root; per-file AND per-source toggles; UI forms write
   atomic UTF-8-BOM/CRLF homebrew files only.
8. **IDs** — `source:id`; duplicate resolver in separate `collisions.json`.
9. **Multiclass** — in scope, incl. spellcasting.
10. **XP** — optional `xp` field + `milestone|xp` toggle.
11. **Data dir** — portable `dataDir` next to binary, auto-filled, overridable.
12. **Dice roller, content-health view, change-log** — in scope. **PWA deferred.**
13. **Testing** → [TESTING.md]; **Security** → [SECURITY.md] (separate plans).
14. **Packaging** — **`pnpm tauri build`** → per-OS installers (Win `.exe`/`.msi`, Linux
    AppImage). Toolchain: **Rust (rustup) + MSVC C++ Build Tools** (Win) + WebView2
    (present); webkit2gtk (Linux). **No server / no LAN.**
15. **System per character** — bound at creation & stored in JSON; active-system switch =
    browse/creation context only. **Cross-system character conversion = out of scope.**
16. **A11y + keyboard** (Tab/Shift+Tab, visible focus, ARIA, `Ctrl+K`) and **content-pack
    sharing** (export a `source`) — in scope.
17. **SRD data** — converter from a **CC-BY** source (P3; candidates in Risks); **UK
    content = ship EN, community-fill** (no CC UA translation exists).
18. **Default theme (shipped look)** — slate base + **heraldic-crimson** accent + **gold**
    for resources; **Space Grotesk** (display) / **Inter** (body) / **JetBrains Mono**
    (data·labels). Layout = grimoire sheet: HP hero, combat tiles (AC/initiative/speed/
    passive), 6 ability tiles, **spell slots as gold "sigil" pips** (filled=available,
    dashed=spent), effects+provenance panel. Just the default token *values*; the token
    contract + light/dark/custom themes are unchanged. Detailed spec → `FRONTEND.md` (P7.5).
    **Semantic color roles (consistent everywhere):** **crimson = important / danger**
    (pinned/favourite, negative effects, destructive, primary actions like Roll/Next-turn),
    **teal/cyan = good / confirmation / positive** (available resources & slot pips, positive
    effects, temp HP, toggles-on), **gold = everything else / neutral marker** (proficiency &
    prepared dots, resource counters). On/off **dots are filled when active, hollow when
    inactive** — never a dimmed fill.

Config files: `charnik.config.json` (dataDir, roots, toggles, rule-options, settings) +
`collisions.json` (collision resolutions) — separate.

---

## Risks & open engineering notes (carry into implementation)
- **CSV write-back footguns**: UTF-8 BOM + CRLF (Excel/Cyrillic), atomic writes, app
  writes only its own files, watcher ignores self-writes. (Addressed above; verify.)
- **Multiclass spellcasting** + **concentration** + **prepared/known** = highest-bug
  modules → dedicated tests (see TESTING.md), call out in P8.
- **Tauri toolchain**: needs **Rust (rustup) + MSVC C++ Build Tools** (Win); WebView2 is
  present. Not yet installed → install before Tauri wiring (TS side scaffolds without it).
  Per-OS builds. Keep the Rust surface minimal (official plugins, little/no custom Rust).
- **Concurrency**: single desktop-app instance → multi-writer clobber largely moot; still
  use atomic writes + an mtime guard on save.
- **Undo**: change-log gives an audit trail; full undo is later if needed.
- **SRD sourcing**: hidden content-entry labor → **converter script** (P3). CC-BY
  candidate inputs: `downfallx/dnd-5e-srd-markdown` (5.2.1 md), `BTMorton/dnd-5e-srd`
  (5.1 md/json), `nick-aschenbach/dnd-data` (json); **verify each repo's license** + keep
  WotC CC-BY attribution. Avoid `open5e` (mixes non-SRD OGL → breaks SRD-only default).
- **UK content data**: no CC UA translation of SRD exists → ship **EN** SRD; UK columns
  community-filled (set expectation in README).
- **Choices model** (build decisions) — dedicated schema design (P7); easy to get wrong.
- **Spell upcast / cantrip scaling** — semi-structured; schema-design risk (P3).
- **Shared validation** (zod schemas) used by loader/editor/health — build in P2/P3.

---

## Planned feature systems (N1–N6, planning drafts 2026-07-14/15)

Feature designs from the audit-session planning discussions (moved here from docs/AUDIT.md —
these are roadmap work, not defects). Cross-refs: `EFX-*` / `B*` / `D*` / `A*` = items in
[`docs/AUDIT.md`](AUDIT.md); `UBUG-*` = the backlog below. Stable IDs — don't renumber.

Core insight: PHB class features reduce to THREE data shapes, and the engine for two of them
already exists — (1) passive modifier tokens (blocked only on EFX-2 gathering), (2) activatable
actions = COMPOSITION of existing systems (`economy.trySpend` + `resourcesSpent` + `addEffect`
with duration + `rollPool` — no new engine, new `class_features` columns: activation slot,
resource cost, applied tokens, duration, roll), (3) choice groups (`choice_group` + `choose_n`
columns; generalizes the builder's slotFeats pattern; chosen rows then behave as 1/2).
Level scaling stays formula-free: per-level `class_features` rows re-grant (monk die d6→d12,
superiority d8→d12) — the table is already keyed by level; L2 expressions not needed for ~90%
of PHB. **Acceptance (decided 2026-07-15): FULL PHB integration — every feature of every PHB
class must be expressible via one of the three shapes (or explicitly marked manual-text
fallback) — PLUS the tier-1 homebrew set** (researched 2026-07-15): Blood Hunter (Mercer;
D&D-Beyond-hosted, the most-played homebrew), Gunslinger (Mercer), Pugilist (Ben Hoffman),
KibblesTasty Psion/Warlord/Inventor/Spellblade, laserllama alternate classes (Exploit Dice),
Scholar (A. M. Black). That set adds a mechanics superset the engine must cover:
**HP-as-cost** (Crimson Rite, Blood Curse amplify), **variable point cost per use** (Psion
psi powers — spending is not always 1 pip), **event-based recharge** (Gunslinger grit on
crit/kill — v1: manual restore button + note, automate later), **attack dice riders**
(hemocraft/exploit/sneak dice — existing bonusDice path, per-level scaling via data rows),
**weapon properties misfire/reload** (item columns; v1 display-only, no enforcement).
Choice groups already cover maneuvers = curses = exploits = invocations = metamagic (one
shape). PHB examples remain the smoke set: Rage, Second Wind + Action Surge, ki + martial
die + Flurry, Sneak Attack, Wild Shape, Divine Smite; Metamagic point↔slot conversion may
stay semi-manual.

- [ ] **N1 · Inventory view.** New combat panel `pid: 'inventory'` (panel infra + the
  layout-model plan already reserve it): rows = name + description, qty stepper, equip/attune
  toggles (attunement cap 3 — Strict blocks, note explains), "use" on consumables (qty−1).
  B7 lands here: weight sum → carrying-capacity bar (+ kg). Money is its OWN item (→ N6),
  not an inventory row. Equipped/attuned effects already flow (gatherEffects) and AC/attacks
  re-derive reactively. MIGRATIONS: decided 2026-07-15 — 0 users yet, so NO migration work
  now; schema may change freely (breaking) until release; the schemaVersion machinery stays
  for post-release.
- [ ] **N2 · Class-feature engine ("features as data").** The three shapes above + the hard
  case: **Wild Shape = stat-block replacement**. Model: `play.form = {monsterRef, formHp} |
  null`; deriveSheet branches — physical scores/AC/attacks/speed from the (already-typed!)
  monster row, mental stays own; isolated removable seam like effects; 2014/2024 diverge
  (2024 = temp HP, known-forms list). **Gate (decided 2026-07-15): implement ONLY against a
  written per-edition spec sheet taken verbatim from PHB'14 + PHB'24 — 100% RAW fidelity in
  both editions is a hard requirement here** (HP pool vs temp HP, CR/movement limits per
  level, what's kept vs replaced, revert-at-0 carryover, equipment handling, casting rules).
  Superiority dice: extend the grammar —
  `grant-resource:superiority-dice:4:d8:short` (decided 2026-07-14: die BEFORE recharge —
  "what the resource is, then when it refills"; ResourceDef + `die`). The die segment is
  optional and shape-distinguishable (`d\d+` vs `short|long|other`), so existing 3-segment
  tokens (`grant-resource:rage:2:long`) keep parsing unchanged. Spending rolls the die into
  attacks via the existing `bonusDice` path. Extra Attack: `flat-bonus:attacks+N` →
  Attacks panel shows ×N. Prereq: EFX-2; content-schema columns bump + converter updates.
  Order: shapes 1→3→2, Wild Shape last as its own item.
- [ ] **N3 · Builder/level-up redesign — descriptions everywhere.** Requirement: NOTHING is
  picked blind (spells, feats, subclasses, maneuvers, features). UI thesis: master–detail
  with REUSED WikiDetail as the detail pane (one-shared-component rule; no new renderer);
  hover/focus previews, click pins; narrow screens = expandable rows. Level-up gets a
  "gained at level N" screen from `featuresForClass`. Process (decided 2026-07-15): go
  STRAIGHT to an HTML mock in design-preview/ (no ASCII drafts — too big a piece), approve,
  bake — and split the 1032-line build page (D1) while baking. Choice groups (N2 shape 3)
  render here.
- [ ] **N4 · Skills system fixes.** (a) BUG: `toggleExpertise` is uncapped — cap from data
  (`expertise_slots` per-level class_features rows: Rogue 2@1+2@6, Bard 2@3+2@10), Strict
  enforces, Free doesn't; (b) effects integration: `grant:expertise` missing (EFX-1),
  effect-granted skills not shown as locked-on in the builder; (c) 'half' (Jack of All
  Trades) is a dead branch — type + `skillCheck(halfProficient)` exist, nothing calls them;
  wire via a bard feature token; (d) combat view renders only a binary prof dot though
  `sheet.skills[k].prof` already carries none/half/proficient/expertise — tiered indicator
  + `why()` source.
- [ ] **N5 · Adjacent gaps (assistant's additions).** (1) **Features panel on the combat
  sheet** — a character can't READ their own features/traits anywhere; read-only prose list,
  cheapest big win, zero prereqs. (2) Concentration check prompt on damage (CON save DC
  max(10, dmg/2)) — `damage()` doesn't even hint. (3) Death saves + exhaustion UI (→ B2).
  (4) Ammunition as consumable — decided 2026-07-15: tracking OFF by default (a toggle
  that exists but is never enforced; ~99% of tables don't track ammo). (5) Short-rest
  hit-dice UI (→ UBUG-1/B2). (6) Search/filter in builder pickers — SRD lists are already
  long, PHB homebrew makes them impassable. (7) Multiclass: combat preparedCap reads
  classes[0] only. (8) Sneak Attack "once per turn" — first per-turn-limit case; manual
  toggle first, automation later.
- [ ] **N6 · Currency (decided 2026-07-15: separate design, not an inventory row).** Support
  ONLY the base PHB coins (cp / sp / ep / gp / pp — 5 in the PHB; settings invent their own,
  those stay out of scope), with per-character HIDING of denominations the player doesn't
  use (electrum first candidate). An exchange-rate reference sits right next to the tracker
  (1 gp = 10 sp = 100 cp; 1 ep = 5 sp; 1 pp = 10 gp). Coin WEIGHT (50 coins = 1 lb) is
  optional and OFF by default — many tables don't track it; when on, folds into N1's
  capacity bar. Lives in play-state; no migration concerns pre-release (see N1 note).

### PLG · Plugin sandbox (L3 expressiveness) — implementation plan (2026-07-15)

The QuickJS-in-WASM decision stands (SECURITY.md #4); this pins HOW. Vocabulary L1 is built
(EFX-1..4), the `plugin:` namespace is reserved, CSP already allows WASM — the runway exists.

**SPEC-FIRST (decided 2026-07-15): [`docs/PLUGINS.md`](PLUGINS.md) is the normative `api: 1`
specification, written BEFORE any code** — token grammar, manifest, handler registration, the
full ctx and result schemas with caps, execution model, lifecycle/consent, compatibility
contract, worked examples, troubleshooting. PLG-1/PLG-2 implement AGAINST it; divergence means
amending the spec first. Two design changes born while writing it: (a) the `apply` result may
return **L1 `tokens`** alongside `contributions` — the plugin computes WHICH vocabulary token
applies (level-scaled dice, computed resource counts) and the tokens ride the existing
parse/validate/fold machinery (no new validation surface; nested `plugin:` tokens ignored —
no recursion); (b) `ctx` includes **`classLevels`** (bare class id → level) — without it the
single most common homebrew pattern (class-level scaling) is inexpressible.

**Design decisions (proposed):**

- **Proven solution, zero DIY (decided 2026-07-15).** quickjs-emscripten is the
  industry-validated container for exactly this job — Figma's plugin system runs this same
  architecture after two failed iterations (iframe, then a Realms shim that got broken).
  Alternatives considered and rejected: SES/LavaMoat (MetaMask) — same-engine realm
  isolation, faster but a weaker container with no built-in CPU/memory budgets; ShadowRealm
  (TC39) — not stabilized; Extism (polyglot WASM plugins) — proven but demands a build
  toolchain from authors instead of "write a main.js". NO DIY at any layer: limits are the
  library's own APIs (`interruptHandler`/`setMemoryLimit`/`setMaxStackSize`), output
  validation is zod (existing dep), and DIY fallbacks ("regex-sanitize the JS and eval it")
  are forbidden permanently.
- **Sync execution.** `deriveSheet` is synchronous and stays so → use quickjs-emscripten's
  SYNC variant (RELEASE_SYNC). The async variant would force async through the whole rules
  chain — rejected.
- **One call per token per derive, not per stat.** `applyEffects` runs ~30×/derive; a
  per-stat handler call at a ms-scale budget would melt the sheet. Handler API:
  `apply(parsedToken, ctx) → { [targetKey]: Contribution[] } | { notes }` — a PRE-PASS in
  deriveSheet resolves every `plugin:` token once, materializes plain contributions, and the
  existing fold consumes them. Budget applies per call.
- **Sandbox output = untrusted input.** Everything crossing the boundary is JSON, validated
  with zod on the host side: layer whitelist, `|amount|` clamped, string lengths capped,
  contribution/note counts capped. A handler that throws / times out / returns junk degrades
  to the existing inert-text-note fallback — a plugin can NEVER break derive.
- **Budgets & determinism.** Per-call CPU deadline via `interruptHandler` (default ~5 ms,
  tunable const), `setMemoryLimit` (~8 MB), `setMaxStackSize`; `Math.random` and `Date`
  neutered inside the context (same input ⇒ same output ⇒ reproducible traces).
- **Packaging (no code-in-CSV invariant).** CSV tokens only REFERENCE handlers:
  `plugin:<ns>:<fn>[:<args>]`. Code lives in `dataDir/plugins/<ns>/` — `plugin.json`
  manifest (name, version, author, url, `api: 1`) + `main.js` — discovered through the
  Storage seam ("own your data": a plugin is a folder you can read). Per-plugin enable
  toggle, **default OFF**; first enable shows a consent dialog (manifest info + "runs
  sandboxed: no files, no network, no app access").
- **Registry inside the effects module** (`src/lib/effects/registry.ts`) so it dies with the
  module (removability invariant). Two handler kinds behind ONE interface: native TS
  (first-party, trusted) and sandboxed (community). The sandbox runtime itself is
  DYNAMICALLY imported only when ≥1 plugin is enabled — the web bundle and the
  effects-module seam stay lean.
- **Host API v1 = nothing.** The context receives the serialized `(token, ctx)` and exports
  functions; no host callbacks (no dice, no content queries). `ctx` is a read-only
  serializable snapshot: system, level, proficiencyBonus, ability scores/mods. Callbacks
  (roll, content lookup) are a later API bump (`api: 2`).
- **Character ACTIONS and the sandbox (decided 2026-07-15).** Two layers. (a) The 90% case
  needs NO action-time sandbox run: an activatable action (N2 shape 2) is DATA — clicking it
  spends slots/resources natively and applies effect tokens; any plugin-token among them is
  computed by the NEXT derive through the normal pre-pass (one cache-miss call, ~5 ms).
  (b) True action-time logic (variable-cost powers etc.) = a second handler export,
  **`activate(token, ctx) → declarative intent**: `{ rolls?: [{label, formula}], apply?:
  [tokens], spend?: {resource, n}, notes? }` — the plugin DOES nothing, it RETURNS what
  should happen; the host zod-validates (caps on roll/token counts, spend ≤ max) and executes
  through the existing systems (rollPool / addEffect / resourcesSpent). Plugins return dice
  FORMULAS, never rolled numbers — all randomness stays in dice.ts (one-roll-path invariant,
  honest roll-log provenance; in-sandbox RNG is removed anyway). Runs on a user click, not in
  the derive loop → per-call budget suffices, no memoization needed. `activate` is DEFERRED
  to `api: 2` — handlers are addressed by export name, so adding it later is non-breaking;
  the shape is pinned now so `api: 1` can't paint us into a corner.

**Phases:**

- [ ] **PLG-1 · Registry + native handlers (no new dep).** `plugin:` kind in `parseEffect`
  (+ schemas EFFECT_KINDS sync + effectsField accepts the prefix), the registry interface,
  the derive pre-pass, `effectTag` → "plugin · <ns>", behavioral tests with an injected fake
  evaluator. Proves the seam with zero sandbox risk.
- [ ] **PLG-2 · The sandbox itself.** quickjs-emscripten (sync build) behind a dynamic
  import; budgets + intrinsic-neutering; JSON marshalling + zod output validation; plugin
  discovery from `dataDir/plugins/` via Storage; Settings → Plugins list (enable toggle,
  manifest, status, open-folder) + consent dialog; plugin errors surface in content health.
  Integration tests in vitest/node: infinite loop → interrupted, memory bomb → limited,
  escape attempts (fetch/require/globalThis) → undefined, malformed output → rejected,
  happy path → contributions, determinism.
- [ ] **PLG-3 · Documentation — a RELEASE GATE, not a DX pass** (decided 2026-07-15: we own
  the docs responsibility; the sandbox does not ship without the full set). `docs/PLUGINS.md`
  (+ published with the web demo): API reference (token grammar, handler signature, every ctx
  field, the result schema, budgets/limits, determinism rules), manifest format, packaging &
  install, the **compatibility contract** (`api: 1` is stable; breaking host-API changes bump
  to `api: 2` with a support window — this is the long-term responsibility we're signing up
  for), the security model FOR authors (what a plugin cannot do), a testing guide (run your
  plugin against a character fixture), 2–3 annotated example plugins, and troubleshooting for
  the common rejections (over budget, invalid output, disabled after repeated failures).
  `why()` trace attribution ("via plugin <ns>") lands here too. EN first; UA translation
  follows the app's own docs-i18n track.

**PLG-SEC · Exfiltration hardening checklist (2026-07-15, user-raised — every item is a
shipping requirement for PLG-2):** the sandbox's job is capability containment; the realistic
leak paths are around it, not through it:

1. **Zero-capability context**: nothing injected; integration tests ASSERT
   fetch/XMLHttpRequest/WebSocket/import/require are undefined inside.
2. **JSON-only boundary**: no live handles/functions cross; output through strict zod
   (unknown keys stripped), numeric clamps, string/count caps; never deep-merge raw output.
3. **Plugin output renders as PLAIN TEXT only** — no markdown/HTML/autolinked URLs from
   notes/labels, ever. Closes the social-exfil channel (encoding data into a "click me" URL).
4. **Least-data ctx**: game numbers only; NEVER free-text fields (character name, notes) —
   nothing worth stealing crosses the boundary.
5. **CSP backstop**: webview `default-src 'self'` blocks network exfil even if data leaked
   into app-side code.
6. **No write path by construction**: the registry API has no disk/character/config access;
   a plugin cannot enable itself (enable state lives in user config, written only by Settings).
7. **No remote code, no plugin auto-update** (supply-chain stance); `manifest.url` is
   display-only and opens in the OS browser.
8. **Fail-closed**: N consecutive failures/limit trips auto-disable the plugin (with a
   notice); global "disable all plugins" kill switch; context recycled after any limit trip.
9. **Resource caps**: CPU deadline, memory limit, stack size, `main.js` file-size cap,
   output-size caps.
10. **Dependency hygiene — the survival rationale (2026-07-15):** the app may outlive its
    active maintenance, so security-critical surfaces must be LIBRARIES a version bump can
    fix, never DIY nobody will patch. Consequences: use quickjs-emscripten's vanilla API
    only (no fork, no patch-package, no monkey-patching — a bump stays a clean one-liner);
    enable **GitHub Dependabot security updates** on the repo (auto-PRs for vulnerable deps
    keep arriving even without an active maintainer — cheap, do it before PLG-2, it guards
    the whole dep tree, not just the sandbox); document the WASM build's provenance.
11. **Accepted residual risk (documented)**: hardware side channels (Spectre-class) are out
    of the threat model for a local single-user app — the plugin already runs on the user's
    machine WITH their consent; containment targets capability escalation and data egress.

Second hardening pass (2026-07-15, self-audit — items 12–18 are also shipping requirements):

12. **Consent is PER-MACHINE, hash-pinned, and lives OUTSIDE the dataDir.** The B6 decision
    moves config INTO the dataDir, and the data-folder move/merge feature imports dataDirs
    wholesale — so an enable-flag inside the dataDir would let a malicious "campaign backup"
    arrive with `plugins/` + its own pre-enabled config, bypassing consent entirely. Fix:
    consent record = `(ns, xxh64(main.js))` in app-side storage (NOT the dataDir); any hash
    mismatch (edited/replaced main.js — also closes TOCTOU) → plugin disabled + notice +
    re-consent. A dataDir can carry code, never consent.
13. **Aggregate per-derive budget + memoization.** The per-CALL budget alone allows 50 tokens
    × 5 ms = 250 ms of synchronous main-thread work on EVERY derive (each HP click). Add a
    global budget per derive (~20 ms; once exhausted the remaining plugin tokens degrade to
    notes) and memoize the pre-pass on (token, ctx-hash) — ctx is nearly static between
    derives, so most derives cost zero plugin time.
14. **Isolation granularity: one QuickJS RUNTIME per plugin.** A shared runtime would let
    plugin A read/poison globals left by plugin B. Never share contexts.
15. **The manifest is untrusted input too**: zod-validate plugin.json (strict, length caps),
    render its fields as plain text in the consent dialog, and `url` must be https:// only
    (no file:, no custom schemes — local protocol handlers are their own attack surface).
16. **Host stamps provenance.** Plugin contributions get `source = "<ns>: …"` assigned by the
    HOST — a plugin must not be able to masquerade as core math ("Proficiency") in `why()`.
17. **`.finite()` everywhere**: zod's `z.number()` rejects NaN but ADMITS Infinity — every
    numeric output field is `.finite()` + clamped.
18. **Plugin token args are hostile.** `plugin:<ns>:<fn>:<args>` tokens arrive via CONTENT
    (shared packs from strangers) — args are the untrusted path INTO an installed plugin.
    Length-cap args in `parseEffect`; the authoring docs state "treat args as hostile" as a
    contract requirement.

Smaller pinned decisions: deterministic fold order across plugins (sort by ns, not folder
scan order); the fail-closed counter is SESSION-scoped (persistent would strand a plugin
disabled after a transient bug) + a notice each time; ctx carries no source-row data by
design — "encode what you need in args" is the documented v1 pattern. Open: whether plugins
may emit `override`-layer (`set`) contributions in v1.

**Formula storage (pinned 2026-07-15): there is no separate formula store.** L1 dice terms
live INSIDE tokens in the `effects` CSV cells / `play.effects`; L2 expressions (when built)
widen the token grammar in the SAME cells, parsed by our own non-Turing parser; L3
computation lives as code in `dataDir/plugins/<ns>/main.js` with CSV holding only the
`plugin:ns:fn:args` reference (no-code-in-CSV). `activate`-returned formulas are transient
intent (rolled, logged, discarded); computed RESULTS are never persisted — derive recomputes
from scratch (same principle as refs-not-copies), and the pre-pass cache is session-memory
only.

- Deferred: plugin signing/first-party verification, web-target plugin upload UX, host
  callbacks (`api: 2`), any marketplace/sharing story.

**Open questions:** v1 desktop-only (web upload UX unclear — recommend yes)? Budget defaults
(5 ms/call, 8 MB) fine? Consent copy tone?

---

## Backlog (post-spellcasting, prioritized) — carve down gradually

Flagged during the persistence/build/spellcasting work. Grouped; ~rough priority within each.

- [ ] **AUDIT-1 · Full-project audit backlog (2026-07-14) → [`docs/AUDIT.md`](AUDIT.md).**
  Whole-`src/` correctness pass: rules-math bugs (A1 heavy-armor AC, A2 multiclass HP —
  verified vs both editions), unfinished invariants (B1 effect expiry, B2 dead play fields,
  B5 source filtering only in compendium, B6 config → dataDir file, DECIDED), token/CSS
  violations, structure/size, data gaps (no 2024 languages CSV), semantic duplicates jscpd
  can't see (F1–F9: titleCase ×6, signed ×4, ability-list ×5…), plus the **effects-engine
  buildout plan (EFX-1..4)** — the vocab/gathering/catalog/lifecycle gaps behind "effects
  account for too little". Stable letter+number IDs; tick items THERE, graduate designs here.

**User-reported bugs (2026-07-05, desktop test — verify + fix):**
- **UBUG-1 · Short rest doesn't heal.** `combat.rest('short')` restores resources/pact slots but not
  HP. Also the heal mechanic DIFFERS by edition — check both: 5e short rest = spend Hit Dice (roll
  HD + CON to regain HP); 5.5e similar but confirm the exact rule. Wire short-rest HP (Hit Dice pool)
  per the character's system.
- **UBUG-2 · No to-hit roll shown when casting an attack/weapon.** Casting a spell/attack only shows
  the DAMAGE roll in the UI — the attack (to-hit d20) roll isn't surfaced. Trace `cast`/`attackRoll`
  (combat/state): attack spells (`res === 'hit'`) and weapon attacks should roll + display the to-hit,
  then damage. Make the to-hit visible (toast/log/tray), not just damage.
- **UBUG-3 · Adv/disadv doesn't show the cancelled (dropped) roll everywhere.** The dropped d20 should
  show: BRIEF on the card, FULL in the log + dice tray. `advantageRoll.{kept,dropped}` exists and the
  CombatMenus log/tray render it — but the card/attack/spell roll paths may not pass advantage, or the
  card doesn't render the dropped die. Audit every roll site passes advantage + renders kept+dropped.
- **UBUG-5 · Spending a resource gives no feedback.** Clicking a resource pip (`resourceClick`) spends
  it silently — using a resource should raise a toast (e.g. "Rage — 2 left" / "Ki used"), like rolls
  do. Add a toast on spend (and probably on restore too), naming the resource + remaining count.
- [ ] **REL-1 · Linux release build.** `release.yml` is Windows-only (`runs-on: windows-latest`). Add
  a Linux job (matrix `ubuntu-22.04` + apt webkit2gtk deps) so `tauri-action` publishes Linux artifacts
  alongside the Windows NSIS. Ship **more than the updater bundle**: AppImage is the only auto-updatable
  target (its `.sig` feeds `latest.json`), but also emit installable `.deb`/`.rpm` for users who just
  want to install (those don't self-update — that's fine). NB: `src-tauri/tauri.linux.conf.json`
  currently pins Linux to **appimage-only** (decided 2026-07-14, "поки що тільки апімадж") and Tauri
  auto-merges it in CI too — when this item lands, widen its `targets` (or delete the file) to get the
  `.deb`/`.rpm` back. macOS deferred (needs Apple notarization/signing, $99/yr, else Gatekeeper warns).
- [ ] **A11Y-1 · Dialog focus management pass.** No dialog moves keyboard focus into itself on open or
  traps Tab inside (focus stays on the trigger behind the backdrop; Tab walks the background). The two
  data-move dialogs now set initial focus (DataMigrationDialog/DataConflictDialog) — do the same +
  a shared focus-trap for the rest (ConfirmDialog, OrphanDialog, ContentMetaModal, HashDriftModal,
  SchemaDiscardDialog, FirstRunModal), ideally as one action/helper on the shared `.dialog` shell,
  and return focus to the trigger on close. (CLAUDE.md "accessibility from day 1" invariant.)
- [ ] **REL-2 · Package-repo distribution channels.** Beyond GitHub Releases, ship Charnik through
  the platform package managers so users install/update the native way. Target set (decided):
  - **AUR** (Arch) — a `charnik-bin` PKGBUILD pulling the Release AppImage; `git push` to
    `aur.archlinux.org`, no review, cheapest channel.
  - **Flathub** (Linux) — Flatpak manifest; widest cross-distro reach, one channel for all Linux.
    Note the **sandbox**: Charnik reads/writes arbitrary content dataDirs, so wire XDG **portals** /
    `--filesystem` perms or the data-move + custom roots break.
  - **AppImage** (Linux) — already built (appimage-only via `tauri.linux.conf.json`); the portable,
    zero-install, self-updating target.
  - **WinGet** (Windows) — YAML manifest PR to `winget-pkgs`; standard Win10/11 channel.
  - **Chocolatey** (Windows) — nuspec package; broader/older Win audience.
  - **Homebrew Cask** (macOS) — **out of scope for now**: no macOS build host to compile on, so no
    artifact to ship. Revisit if a mac runner/notarization appears (blocked on same as REL-1 macOS).
  Most of these consume the Release artifacts, so they hang off REL-1 (need Linux + eventual mac
  builds published first). Sequence by effort/reach: AppImage (done) → Flathub + WinGet → AUR → Choco.
- [~] **UBUG-4 · Tauri .msi install has no content folders.** CODE DONE (needs a real `.msi` verify).
  The content was bundled inside the app (loaded over fetch) but never written to disk, so there was
  no editable folder. Now `content/provider.ts`: on desktop (`isTauri`), `getContentGraph` SEEDS the
  shipped CSVs into `<dataDir>/content/…` on first run (`copyMissingRoots`, skips a root that already
  exists so user edits aren't clobbered) and then loads the graph FROM that writable folder via
  TauriStorage; web still reads the bundle over fetch. No capability change needed (`$APPDATA/**` is
  already scoped; `writeBytes` mkdirs recursively). Seed logic unit-tested over MemoryStorage. STILL
  TODO: build a `.msi` and confirm the folder appears + is read; a file-watcher for live disk edits
  and a `charnik.config.json` for custom roots are the follow-ups (per the loader TODO).
  Original report:
- **UBUG-4b · Tauri .msi install has no content folders.** After installing the built `.msi`, there's
  no `content/` (CSV) directory created, so the app has no data. First-run on desktop must create the
  dataDir + seed the shipped SRD content (the `static/content` bundle) into it (Tauri fs). Wire the
  first-run seed / resource-copy in the Tauri layer. (Relates to `dataDir` resolution + the Storage
  seam — the web target seeds via fetch; desktop needs the equivalent copy-on-first-run.)

**Security / deps:**
- **DEP-1 · `glib 0.18.5` moderate advisory** (GHSA-wrw7-89jp-8q8g, dependabot #3) — transitive via
  Tauri's Linux webkit2gtk/wry backend; fix is `glib 0.20` (a gtk-rs major, pinned by Tauri, not a
  plain `cargo update`). Only affects a LINUX desktop build; Windows (WebView2) + the web target have
  no glib. Defer to a Tauri upgrade; safe to dismiss with that rationale meanwhile.
- **SEC-2 · route every `{@html}` through a sanitizer — no manual eslint-disable bypass.** GitHub
  raised security warnings (XSS) after `{@html}` was hand-waved past the lint. `dompurify` is ALREADY
  a dep and WikiDetail uses it correctly (`DOMPurify.sanitize`), but `src/routes/+page.svelte:55`
  (`demo.body`) renders `{@html $_('demo.body')}` with a bare `eslint-disable svelte/no-at-html-tags`
  and NO sanitize — "trusted own catalog" is wrong: **locale catalogs are user-droppable** (CLAUDE.md
  lets a user add a locale with no rebuild), so any i18n HTML string is untrusted input. Fix: (1) one
  shared `sanitizeHtml()` helper wrapping DOMPurify; (2) pipe demo.body + any i18n `{@html}` through
  it; (3) forbid raw `{@html}` without going through the helper (the only allowed disables cite a
  sanitize call on the same value, like WikiDetail's). Also check the actual Dependabot/code-scanning
  alert — bump `dompurify` if the advisory is on the lib itself. Ties to the "add a proven lib beats
  DIY" rule — do not hand-roll HTML escaping. See docs/SECURITY.md.

**Data versioning (DECIDED 2026-07-06 — design below; surfaced in the refactor, 2026-07-05):**
- **DATA-VER-1 · content versioning — the problem.** CHARACTER versioning works end to end (schema
  default `schemaVersion` → `assembleCharacter` stamps it → `repository.loadCharacter` runs
  `migrate(data, CHARACTER_MIGRATIONS, …)`; registry empty at v1, fine). But `CONTENT_SCHEMA_VERSION`
  is **exported and never used** — CSV rows carry no version, `PackManifest.schemaVersion` is read by
  no migrate, no content-migration path. If the content column model changes, old user CSVs have no
  forward-migration story.

- **DATA-VER-1 · DECISION — a `#content-*:` directive header (metadata as leading comment lines).**
  Generalise the existing single first-line directive into a small header block of leading
  `#content-<key>: <value>` lines (any order, before the CSV column header). One extractor eats them
  all, strips them off, hands a clean body to Papa. Keys:
  - `#content-type: <type>` — RENAME of today's `#charnik-type:` (the `charnik-` prefix read like the
    *app* version; `content-` describes the object). Only 3 files reference the old name (loader.ts,
    loader.test.ts, PLAN.md). Type still defaults from the filename when the directive is absent.
  - `#content-source: <tag>` — file-level source, **the per-row `source` COLUMN is DROPPED** (not a
    default+override — the file IS the unit of source; the whole `*_srd.csv` / `*_phb.csv` naming
    already encodes that). The loader stamps this tag onto every parsed row (into `source:id` identity)
    — literally "the source slug is prepended to all rows automatically." Need mixed sources? Split into
    two files (the natural unit). Keeps `source:id` identity + 2-D source filtering (source still lives
    on each row, just sourced from the header). Missing + not homebrew = flag (see fallbacks below).
  - `#content-url: <http(s)>` — OPTIONAL provenance/attribution link (CC-BY needs it); shown in the UI
    as the row's clickable source, and a future "check for updates" endpoint. Light URL validation →
    warn (not error) on malformed.
  - `#content-schema: <int>` — the column-shape version, **per-type** (spell-schema and class-schema
    evolve independently; the migration is per-type anyway). Absent → 1 (old files = baseline, never
    break). Loader runs each row through `migrate(row, CONTENT_MIGRATIONS[type], from→CURRENT)` after
    parse / before index — **the same generic `migrate()` engine the character path uses**; registry
    empty at v1 = fine. A future/unknown-higher schema → load the row as-is + warn (forward-compat,
    never drop the user's data). This finally consumes `CONTENT_SCHEMA_VERSION` (or a per-type map
    replaces it).
  - `#content-updated-at: <YYYY-MM-DD>` — the DATA revision date (errata / "edited 3 spells"), distinct
    from `schema` (shape). Named `updated` not `version`/`revision` to avoid reading as an app version.
  - `#content-license: <spdx>` — REQUIRED-ish attribution field (e.g. `CC-BY-4.0`). FOSS + SRD app,
    CLAUDE.md licensing constraint: attribution is license + `source` + `url`, and shipped SRD must
    carry CC-BY. Warn if a non-homebrew file omits it.
  - `#content-id: <uuidv7>` — stable GUID identity of the FILE/pack as a distributable artifact
    (**UUIDv7**, time-sortable so revisions/packs order chronologically). NOTE the two distinct
    identities that must not be conflated: (a) **row identity** = the text slug `source:id` (human,
    namespaced, referenced by characters and by `requires`); (b) **pack identity** = this
    `content-id` GUID (the file as an artifact). There's no central distribution, so its value today is
    limited but cheap: peer-shared file → re-import matches "same pack, newer revision" by id (not by
    filename), plus dedup + the update-detect match key (better than matching on path). Generated once
    when the app first authors/saves a homebrew file.
  - `#content-author: <name>` and `#content-author-url: <http(s)>` — OPTIONAL. Who MADE the homebrew
    (the person), distinct from `#content-source:` (the in-game source tag) — for the share/import
    story. Name + an optional link to their profile/contact, parallel to `source` + `url`.
  - `#content-systems: 5e,5.5e` — file-level editions, **the per-row `systems` COLUMN is DROPPED** (same
    as `source`: file = one edition unit). VERIFIED 2026-07-06: no shipped CSV mixes editions — content
    is ALREADY split by root (`content/srd-2014/*` = `5e`, `content/srd-2024/*` = `5.5e`), the `systems`
    column is uniform-per-file and fully redundant with the root. So there is **nothing to split**; the
    work is: drop the column, add `#content-systems:` to each file (converters emit it), loader stamps
    every row. **Fallback when absent AND the root gives no edition (a custom homebrew root):
    `[5e, 5.5e]` — both** (deterministic, doesn't depend on the active-system toggle; permissive =
    visible in both editions, not hidden; the author narrows it later). So `systems` never needs
    prompting — default to both + flag. Doesn't break `joinResolves` (feature↔class systems-overlap) or
    `editionsOf` (a spell in both roots = two rows same `id`, stitched by id → the article edition
    toggle survives).
  - DEFERRED keys (not now): `content-min-app` (needs app ≥ X — coarser than `schema`, which already
    covers column shape); `content-requires` (a homebrew depending on other content, e.g. a subclass
    needing its class) — if ever added it references **row slugs `source:id`, NOT the pack GUID**, and a
    long dependency list belongs in `_pack.json` as an array, not a one-line `#`-directive.
  - `#content-hash: xxh64:<hex>` — hash of the **normalised body only** (column header + data rows),
    EXCLUDING the `#content-*:` directive block AND the hash line itself (can't hash a line containing
    its own hash). Lib = **`xxhash-wasm`** (XXH3/xxh64; a proven fast lib beats a hand-rolled FNV — see
    the deps-beats-DIY rule; do NOT DIY the hash). Normalise before hashing so an Excel re-save doesn't
    false-trigger: newlines→LF, strip BOM, trim EOF whitespace/blank lines; row ORDER preserved
    (reorder = a real change). Algo prefix (`xxh64:`) so it can be swapped later.

- **DATA-VER-1 · DECISION — missing required meta never hard-blocks; two fill classes, two owners.**
  A missing directive degrades (load rows with a fallback + flag), never fails the file. Split by WHO
  can supply the value:
  - **Machine-fillable (no human) — auto-fill via the consented write-back:** `id` (generate a
    UUIDv7 on first sight), `hash` (always computable from the body), `updated-at` (file mtime, else
    today), `schema` (absent = 1), `type` (from filename). At most a one-time notice, never a question.
  - **Human-semantic (must ask the OWNER of this app instance):** `source` (a tag the app can't guess)
    and `license` (homebrew → default `unspecified`; shipped SRD must be `CC-BY-*`, emitted by the
    converter so never missing). `systems` is NOT prompted — it defaults to `[5e,5.5e]` (both) + flag.
    `author`/`author-url` optional, never block.
  - **Who prompts, three scenarios:**
    1. **Authored through the app** (EditContentForm) — the form COLLECTS source/systems/license/author
       at creation (inputs + pickers, author from Settings). Complete by construction; nothing missing.
    2. **Hand-dropped CSV on disk** missing required — the loader records a `ContentIssue` and surfaces
       a non-blocking "content issues" panel with a fill-in prompt to the instance owner: "{file} is
       missing: source, license → [Fill in]" → mini-form → app writes the directives back (same atomic
       BOM+CRLF consented write). Rows still load meanwhile via fallbacks (source = filebase,
       systems = both, license = unspecified).
    3. **Imported pack from someone else** — the meta should already be present (the author filled it).
       Enforce at the SHARE/EXPORT side: the export flow VALIDATES required meta before producing the
       artifact, so emptiness is caught on the sharer's side, not dumped on the importer.

- **DATA-VER-1 · DECISION — edits MADE THROUGH THE APP stamp the metadata automatically (no prompt).**
  When the user edits content via our own UI (EditContentForm / homebrew authoring — `buildRow` →
  `unparse` → `Storage.write`), the writer **always refreshes the directive header on save**:
  `content-updated-at` = today and `content-hash` = recomputed on the new body, with NO pop-up. The
  pop-up flow below is ONLY for content that changed OUTSIDE the app (hand-edited CSV on disk), where
  we can't have stamped it ourselves. So: in-app edit ⇒ metadata is always correct by construction;
  out-of-app edit ⇒ detected by hash mismatch and offered/auto-synced per the settings toggle. Same
  atomic BOM+CRLF write + watcher-ignore either way.

- **DATA-VER-1 · SLICE BUILT (2026-07-06, standalone, not yet wired into the loader):**
  `src/lib/content/meta.ts` (pure `parseContentDirectives` multi-line `#content-*:` parser + BOM/blank
  tolerant; `checkFileMeta` → `MetaIssue`), `meta.test.ts`, an underfilled fixture
  (`tests/fixtures/content/homebrew-underfilled/spells_homebrew.csv`), the full-screen dark-backdrop
  `ContentMetaModal.svelte` (+ browser test), i18n `contentMeta.*`, and a DEV-ONLY preview at
  **`/dev/meta`** (`src/routes/dev/meta/+page.svelte`) to see it live. Key modal behaviours settled with
  the user: (a) it opens ONLY when a REQUIRED human key (source/license) is missing — a missing/stale
  machine key alone (id/hash/updated-at/schema) does NOT open it (hash-drift is the separate pop-up
  below); (b) it renders ALL editable fields (source, license, systems, url, author, author-url),
  **pre-filled** from whatever the file already declares (`MetaIssue.values`), missing required flagged;
  (c) license is a card list WITH one-line descriptions + a "Custom…" free-text option (order
  CC-BY-4.0, CC-BY-SA-4.0, CC0-1.0, MIT); (d) machine keys shown as a reassuring "we'll add these" FYI;
  (e) actions = [Don't ask again (content-editing mode)] · [Skip for now] · [Fill in & save] (no
  confusing "autofill all"). **Both this modal AND the future drift pop-up must show the shared
  `LangSwitcher` component in the top-right** (a user may need to switch language to read it) — the
  switcher was extracted to `src/lib/components/LangSwitcher.svelte` and now used by the topbar too
  (single canonical control).

- **DATA-VER-1 · IMPLEMENTED (2026-07-06, tasks 1–5 of 6, all green — 240 tests, build OK):**
  1. Loader uses `parseContentDirectives` (meta.ts) — `#charnik-type`→`#content-type` rename done;
     `source`/`systems` stamped from the file header (per-row columns are now a legacy fallback).
  2. `xxhash-wasm` + pure `hashBody()`/`normalizeBody()` (src/lib/content/hash.ts) — LF/BOM/trailing
     normalisation so an Excel re-save is not drift; `xxh64:` prefix.
  3. `FileEntry.mtime?` added across the Storage seam (node stat, Tauri stat, MemoryStorage write-time;
     fetch/web leaves it undefined).
  4. **Shipped CSVs migrated**: `source`/`systems` COLUMNS dropped, hoisted into a `#content-*:` header
     (source/systems/url/license/id-uuidv7/updated-at/hash). Done centrally in `tools/srd/lib.mjs`
     `writeCsv` (top-level xxhash init) so every converter emits headers on regen — no converter edits.
     `schemas.ts` made `source`/`systems` optional. 2815 rows load, 0 errors, **0 metaIssues / 0 drift**
     on the clean shipped set.
  5. Loader surfaces `graph.metaIssues` (checkFileMeta) + `graph.driftItems` (isHashDrift vs a
     recomputed `hashBody`); `+layout.svelte` mounts `HashDriftModal` (first) + `ContentMetaModal` off a
     `content/review.svelte` store (per-session dismiss); content loads once at startup.
  **STILL TODO (task 6 — the delicate part, writes to USER files):** the confirm actions
  (`onFillAndSave` / `onUpdate`) currently just DISMISS — they do NOT yet persist. Remaining: the
  directive write-back (atomic BOM+CRLF, watcher-ignore, only app-writable files), the Settings
  "content-editing mode" toggle (auto-stamp, no prompt), the in-app authoring stamp, and per-type
  `CONTENT_MIGRATIONS` via `migrate()`.

- **DATA-VER-1 · DECISION — the hash is the change DETECTOR (semi-automatic date bump).**
  **We detect a content update specifically by the hash not matching the body** — not by dates, not by
  the file mtime. On load, for each content CSV recompute the normalised-body hash and compare to
  `#content-hash:`. Mismatch ⇒ the data was hand-edited after the header was last stamped. Collect all
  mismatches and, right after startup, show ONE reassuring pop-up (batched, not per-file spam):
  > "Дані в {file} були змінені (востаннє редаговано {OS file mtime}), а в шапці стоїть, що оновлено
  > {#content-updated}. Це нормальний процес, ми просто хочемо звіритись, що ви так і планували —
  > поставити сьогоднішню дату в `content-updated-at` та перерахувати хеш автоматично?"  [Оновити все]
  > [Обрати] [Пропустити] [Не питати]

  Tone = reassuring ("це нормальний процес, ми просто хочемо звіритись"): editing a CSV is expected, we just offer to sync the
  metadata. Copy must state the detection reason — *we noticed because the recorded hash no longer
  matches the file's contents.* On confirm: rewrite `#content-updated:` = today and `#content-hash:` =
  recomputed, in place.
  - **mtime for the pop-up copy** needs a seam change: `FileEntry` has no `mtime`. Add
    `mtime?: number` (Tauri `stat` provides it; Memory/Fetch leave it undefined — copy degrades to
    "were changed" without the date). Small, optional field.
  - **Write-back invariant exception:** CLAUDE.md says the app writes only files it *created* and never
    rewrites hand-edited user files. This auto-bump rewrites a hand-edited CSV, so it is a **deliberate,
    explicitly-consented exception** — gated on the pop-up Yes, atomic (temp→rename), preserving
    UTF-8-BOM + CRLF, and the **file watcher must ignore the app's own write** (no write→reload loop,
    also an invariant). "Не питати" persists a per-file (or global) suppression like the collisions
    store.
  - **Settings toggle · "Режим редагування контенту" (content-authoring mode).** Add a Settings item:
    a switch for the user who edits CSVs by hand and does not want the pop-up nagging them every
    launch. When ON, a hash/body mismatch **auto-updates `content-updated-at`=today + recomputes the hash
    with NO prompt** (same write-back as the confirmed path — atomic, BOM+CRLF, watcher-ignored). When
    OFF (default), the pop-up flow above applies. This is the "always yes" companion to the pop-up's
    "Не питати" (which suppresses per-file; this mode suppresses globally + keeps metadata live while
    authoring).
  - **Web target** is read-only (fetched content, can't write back) → detection can still surface as an
    FYI, but the auto-bump offer only appears on the writable desktop storage.
  - Also feeds the **UBUG-4 seed path**: when re-seeding shipped content, compare shipped vs on-disk
    `#content-updated:`/hash — shipped newer ⇒ offer an update instead of the current blind skip.

**Builder / character:**
- [~] **Lineages & subraces** — Phase 1 DONE: `species_option` content type (linked `species_id`,
  `kind: subrace|lineage|legacy|ancestry`, `option_label`, effects) + 2014 converter emitting the 4
  SRD subraces (Hill Dwarf/High Elf/Lightfoot/Rock Gnome, each with its own ASI) + loader
  longest-filebase fix so `species_options_*` isn't mis-read as `species`. P2 DONE: builder 2nd
  picker (shown when the chosen species has options, per-edition label from `option_label`) +
  `build.speciesOption` gathered in derive (effects cascade like the species'). P3 DONE (partial):
  2024 Elf **Elven Lineages** (Drow/High Elf/Wood Elf) + Tiefling **Fiendish Legacies** (Abyssal/
  Chthonic/Infernal) parsed from character-origins.md tables. Remaining: 2024 **Dragonborn draconic
  ancestry** (paired damage-type table) + **Gnome/Goliath** (prose-list choices), and encoding the
  lineage benefits as effects (currently text-only — fine, since 2024 species carry no ASI).
- [x] **Half-Elf +1/+1 choice** (5e) — DONE. Data-driven `boost_choice` column (`NxM`, converter
  parses "M ability scores of your choice increase by N" → Half-Elf `1x2`); builder shows a chip
  picker excluding the fixed-boosted ability (CHA), folded into `abilityBoosts`. Generalizes to any
  species/sub-option with a free-choice ASI.
- [x] **Expertise** — DONE. `build.expertise[]`, derive exposes a `prof` **enum**
  (`none|half|proficient|expertise`, not two booleans), builder ×2 toggle on proficient skills,
  combat shows a ringed dot. (Strict cap by class-feature count still TODO.)
- [x] **Languages** — DONE. New `language` content type (16 SRD Standard+Exotic, converted from the
  appendix tables) + `build.languages` ref array; builder shows a language chip picker (lenient —
  pick any), stored on the character. (Auto-granting fixed languages from species/background text is
  a later refinement.)
- [~] **Level-up flow** — minimal DONE: a "▲ Level up" control on the combat sheet advances a chosen
  class by +1 on the open character and saves; the reactive sheet recomputes HP / proficiency / spell
  slots / features live. Remaining: **guided choices at the new level** (ASI/feat pick, new spells,
  subclass at its level) — needs the builder to hydrate from an existing character (edit mode), also
  the prereq for full editing. Add-a-class-while-levelling also via the builder.
- [x] **Inventory/equipment at build** — DONE. An Inventory card: add items from the compendium,
  set quantity, toggle equipped (armor/shield/weapon); stored in `build.inventory` (derive already
  uses equipped armor/shield for AC). The play-view card-grid inventory management is separate.

**Effects engine (finish the vocab, add authoring):**
- [x] **Custom-modifier UI** — DONE. Combat "Custom modifier" builder (grouped target · +/− ·
  amount) → `flat-bonus` token, applied live via the reactive sheet.
- [x] **Mechanically apply the rest of the vocab** — DONE. `advantage` presets adv on the roll;
  dice bonus (`+1d4` Bless / `−1d4` Bane) is rolled into the total; `grant-proficiency` grants
  skill/save proficiency; `resist-immune` collects damage defenses (shown on the sheet);
  `apply-condition` expands to the referenced condition's own tokens. All gated on the effects-auto
  toggle. (flat-bonus / set-override were already applied.)
- [ ] **Feat stat/skill bonuses** — the engine applies feat effect tokens already, but the shipped
  feat rows carry no `effects` yet (must be encoded from SRD text, no hand-authoring) + half-feat
  ability-choice UI is still needed.
- [ ] **Plugin sandbox** (QuickJS-WASM) for exotic homebrew logic — far future (decided, not built).

**Spellcasting follow-ups:**
- [~] **Resource subsystem** — engine + tracker DONE. `grant-resource:<id>:<max>:<recharge>` parsed
  into resource pools (`collectResources`, data-driven / class-agnostic — rage, ki, sorcery points,
  item N/day are one shape); `sheet.resources`; combat "Resources" strip with click-to-spend pips +
  Short/Long **rest** buttons (recharge by type; long resets slots+HP, short returns pact slots).
  Remaining: **encode class resources from SRD tables** (converter — rage/ki/superiority counts),
  **`grant-slot:<level>`** (Mystic Arcanum extra slot into the pools), and **Action-Surge/Haste
  extra action pips** (feed the action-economy `slotMax` from effects).
- [~] **2014 casting data** — 2014 **spell_slots** now emitted (the full/half/pact matrices are
  edition-identical — spell_slots.test asserts `full`==core — so re-tagged 5e). 2014 casters
  (caster=full/half/pact → the derive's `slot_table ?? caster` lookup) now get their slots.
  Remaining: 2014 **class_casting** counts (cantrips/prepared differ by edition — 2024 uses table
  columns, 2014 uses per-class formulas → the rules layer needs the 2014 formula), and backfilling
  the truncated 2014 class-feature prose.
- [ ] **Combat UI**: multiclass shows only the first class's DC (data has per-class); pact pool as a
  distinct short-rest pip section; spell picker preview (EntryList+WikiDetail on pick).

**Platform / content:**
- [x] **Tauri fs Storage** impl + platform factory (task #6) — DONE. `TauriStorage` over plugin-fs
  behind the seam (atomic temp→rename, lazy appDataDir root, `..`-rejection); `provider.ts` factory
  picks it inside a Tauri webview, IndexedDB elsewhere; capabilities scope `$APPDATA` recursive.
- [~] **Content-type identification** — loader `#charnik-type: <type>` first-line directive DONE
  (freely-named files declare their type; explicit wins over filename; unknown type → error).
  Remaining: **UI type-assign** (a form that writes the directive) — folds into homebrew authoring.
- [~] **Homebrew content from the UI** — DONE for all browsable types via an editable-article form
  (mirrors the compendium article; schema-driven fields → validated row → atomic BOM/CRLF write into
  `content/homebrew/<type>_hb.csv` in user storage; merged into the graph as an extra content root;
  new row opens in the compendium). Remaining: **spell/monster get the generic grid** (their fancy
  read layouts aren't editable yet), **edit/delete existing homebrew**, and linked-table authoring
  (a subclass's `class_features` rows) — so homebrew subclasses are only half-covered.
- [x] Dependabot: DONE — esbuild + cookie pinned via pnpm-workspace overrides (`pnpm audit` clean).
  Pages deploy recovery still open.

**Code quality:**
- [x] **Friendly source labels** — DONE. `sourceLabel()` maps "SRD 5.1"→"D&D 5e",
  "SRD 5.2.1"→"D&D 5.5e" (homebrew/third-party pass through), applied to the compendium article
  source line, the source filter chips, and the "By source" grouping. The raw `source` tag stays
  exact (CC-BY attribution + `type:source:id` identity) — display map only. (Any other future
  source-display site should route through the same helper.)
- [ ] **CSS class-naming rename pass** — the combat sheet has cryptic classes (`.ae`, `.aedot`,
  `.mcell`, `.sk`, `.atk`, `.an/.ah/.ad/.am`, `.hpadj/.hpbtn`, `.combatsw`, …) that read poorly and
  invite collisions (already hit `.combat`, `.modrow`). Rename to verbose, self-evident, kebab-case
  names with a feature prefix; do it opportunistically per file when touched, not big-bang. New code
  already follows this (`modifier-row`, `modifier-amount`).

**Refactoring debt (self-flagged — patterns that drifted from "this is TypeScript, model it"):**
- [x] **R1 · Group edit/level-up state into `EditContext`** — BuildVM scattered the level-up state
  across 7 fields (`editId`, `editPlay`, `editUi`, `hydratedBoosts`, `hydratedFeats`,
  `hydratedSpells`, `hydratedSkills`). Collapse to one `edit: EditContext | null` (a typed object);
  `edit === null` means "creating". Every `this.editId ? …` becomes `this.edit`.
- [x] **R2 (CVM-4) · Type `overlay.kind`** — CombatVM's overlay uses `kind: string`, compared against ~15
  bare string literals (`'dice'`, `'levelup'`, `'customeffect'`, …) spread over state + CombatMenus.
  Make a `MenuKind` union and type the overlay; kills typos + enables exhaustiveness.
- [x] **R3 (CVM-3) · Name the action-economy slot type** — `'action' | 'bonus' | 'reaction'` appears ~13×
  as bare strings (slotMax, usePip, trySpend, the page's SLOTS). One `type ActionSlot` + a single
  source of the slot list. (Relates to the enums-not-string-literals rule.)
- [x] **R4 (CH2) · Centralise effect-token parsing** — the bounded-vocab regexes (`flat-bonus:…`,
  `grant-resource:…`, `grant-proficiency:…`, advantage/dice) are re-implemented in `effects/index.ts`
  (parseEffect/collectResources), `derive.ts` (abilityBonus + grant-proficiency scan), `combat/
  state.svelte.ts` (action-pip scan) and `combat/helpers.ts` (rollEffectsFor). Parse ONCE in the
  effects module and have every consumer read the structured result — the token grammar must live
  in one place (it's also the security surface, docs/SECURITY.md).
- [x] **R5 (CH3) · Extract the click-to-set pip helper** — `slotClick`, `resourceClick` and `usePip` each
  re-derive the same "click a filled pip → spend to it; click a spent pip → restore to it" math.
  One pure `pipClick(count, spent, index) → newSpent`, unit-tested, used by all three.
- [~] **R6 · Source-tag constants** — mostly MOOT. App code already uses consts (`HOMEBREW_SOURCE`,
  `SOURCE_LABELS` keys, a local `S` in demo/sheet); the raw `'SRD 5.x'` strings that remain live in the
  edition-SCOPED converters (each `.mjs` emits one edition, declared once) + per-file test `S` consts,
  where a shared TS const can't reach cleanly. Low value; leave.
- [ ] **R7 · Strict/Free as a named mode** — NOT DONE (optional, low priority). `strict: boolean` is
  self-documenting and works; deferring.
Done R1–R5 as a focused pass (typos, duplication, drift). R6 moot, R7 deferred.

**Refactor-session review (2026-07-05):** R1 ✓ (EditContext), R2–R5 ✓ (CVM-4/CVM-3/CH2/CH3), R6 moot,
R7 deferred. CH1–CH5 ✓. CH6–CH14 are trace-and-verify chains (not code changes): the ones whose code
was refactored/tested this pass are effectively covered — CH6 content-load (loader.test), CH7
ability-score (rules.test + build.test), CH8 homebrew round-trip (homebrew.test), CH9 menu (R2 typed),
CH13 article render (detail.test + grouping.test). CH10 (roster), CH11 (app-switch), CH12 (palette),
CH14 ($effect flows: autosave/deep-link/theme) are UNTRACED — code works but no explicit end-to-end
audit or test yet; a good next verification pass.

**Update (2026-07-11):** CH6–CH14 now ALL traced (see each ticked item above). The pass surfaced +
fixed real cross-file duplication (slugify → util/slug; inEdition → app store; compendium deep-link +
list-entry projection → detail.ts; ability capped-toggles; homebrew column helpers; search helpers)
and one latent bug (saveHomebrewRow dropped non-schema columns — fixed + tested). All behavior-
preserving: 291 tests green, `shot.mjs` 0 visual drift. Remaining open items are the flagged FEATURE
gaps (edition toggle unwired), NOT refactor debt. Next refactor phase = the S1/S2 page splits.

### Call-chain audit — checklist (trace each flow end-to-end for cross-file duplication + seams)

The file pass gives coverage + local smells; these chains surface the cross-file duplication and
architecture the single-file view hides. `⚠️` = also a security/correctness surface. Tick when traced;
each names the R-items / bugs it should confirm or expand.

**Completeness method:** derived from an **entry-point census**, and the census itself has to cover
ALL SIX entry-point classes (the first `on*`-only pass was still first-order and missed three):
  1. DOM `on*` handlers (`onclick`/`onwheel`/`onkeydown`/…),
  2. **component callback props** (`onselect`/`onsave`/`oncancel` — child → parent),
  3. **`bind:`** two-way (input → VM state → derived cascade),
  4. **`$effect`** reactive flow-starts (autosave, deep-link, theme-apply, search-on-query),
  5. lifecycle `onMount`/`afterNavigate` + route `load`,
  6. build-time runners.
Every entry point must map to a chain below — that's the proof. (Two rounds of this caught seven flows
the brainstorm missed: CH10–CH13 from the `on*` pass, then CH14 + the reactive notes from classes 2–4.)

Duplication-heavy (do first — this is where the big refactors live):
- [x] **CH1 · Roll pipeline** — DONE. Extracted a pure `src/lib/rules/dice.ts`
  (`rollPool`/`rollFormula`/`parseDicePool`, seeded-RNG-injectable, returns `{total, expr, adv}`) with
  `dice.test.ts` (10 golden cases). All THREE impls now call it: `doRoll` collapsed into `rollDiceNow`
  (one roll site in the VM), `rollDiceNow` = `rollPool` + a new `pushRoll` helper (folds CVM-6: the
  `RollLogEntry` type is shared, magic `200` → `ROLL_LOG_MAX`), and `WikiDetail.rollDice` calls
  `rollFormula`. **Bugfix:** the old compendium roller rolled only the FIRST `NdM` group; `rollFormula`
  rolls every group. `parseDice` (helpers) → moved to dice as `parseDicePool` (it was NOT dead —
  `spellRow` uses it; ORPHANS 🔴 note corrected). Also fixed vitest to mirror the app's `$lib` alias
  (value imports of `$lib` were unresolved in tests). Covers CVM-1, part of R4 (dice parsing unified).
- [x] **CH2 · Effect grammar (bounded vocab)** ⚠️ — DONE. `parseEffect` (effects/index.ts) is now the
  SINGLE interpreter: extended to fully structure `resist-immune` (→ `{defense, target}`) and
  `grant-resource` (→ `{resource:{id,max,recharge}}`), and `matchesTarget` is exported. Every ad-hoc
  regex now reads the structured result instead: `derive.ts` (abilityBonus, grant-prof,
  resist-immune, apply-condition), `combat/state` (slotMax), `build/state` (speciesFixedAbilities),
  `combat/helpers` (rollEffectsFor via `parseEffect`+`matchesTarget`+new `parseDiceTerm`, and
  effectTag). `collectResources` dropped its own regex. Effect KINDS are now a named-const map
  `EFFECT_KIND` (no bare-string comparisons anywhere). The content-schema `EFFECT_KINDS` stays a
  separate list (removable-module invariant) with a drift-guard test. slotMax now uses `Object.hasOwn`
  (no proto-pollution). +7 tests. Security: one validation point for the vocab (docs/SECURITY.md). R4.
- [x] **CH3 · Pip spend/restore** — DONE. One pure `pipClick(currentSpent, index, total)` helper
  (combat/helpers) is the single click-to-set model: **available pips left, spent right** (the user's
  chosen convention — the spell-slot one). All three handlers call it (`usePip`, `slotClick`,
  `resourceClick`), dropping their now-redundant clamps. **Bug fixed (CVM-2):** resource pips RENDERED
  used-from-left but used the slot (spent-right) formula, so clicking the first pip spent the whole
  pool; the action render was also used-from-left. Flipped both renders to available-left/spent-right
  so render + formula agree everywhere. +3 tests incl. a regression guard vs the old slot formula
  (MECH6 differential). R5.
- [~] **CH4 · Character assembly ↔ round-trip** — PART 1 DONE (BVM-4): pure tested
  `assembleCharacter(build, wrapper)` (src/lib/character/assemble.ts) owns the character envelope +
  the once-duplicated fallback; the `draft` derived just resolves + calls it. Fallback now reuses the
  edit id (no stray second character on a broken edit). +3 tests. **PART 2 PENDING (BVM-1):** regroup
  the ~20 draft `$state` fields into one typed `draft` object (single field source; kills the
  decl/reset/hydrate triplication). Deferred by decision — it's ~224 refs in the central build flow
  with NO reactivity test net; do a BuildVM integration test (drive real VM+graph → assert
  `.assembled`) FIRST, then the regroup guarded by it. Note the `draft` derived must be renamed
  (collides with the new draft object).
  **PART 2 DONE (BVM-1):** built the net first (see the test-infra commit — rune-aware vitest +
  `$app` stubs + a hydrate→assemble round-trip driving the real VM through stable boundaries only, so
  it survives shape changes). Then regrouped the 20 draft `$state` fields into one
  `draft = $state<DraftState>(blankDraft())` with `blankDraft()` / `draftFromCharacter()` factories
  (single field source); renamed the assembled derived `draft`→`assembled`; rewrote every `this.X` /
  template `b.X` → `.draft.X`. **Latent bug fixed:** hydrate used to set only a subset of fields, so
  editing a character after a prior build could leak stale slotFeats/boost picks — `draftFromCharacter`
  replaces the draft wholesale. Gate: svelte-check 0, 183 tests (net green), lint clean. CH4 COMPLETE.
- [x] **CH5 · deriveSheet aggregation** — `gatherEffects → (abilityBonus · grant-prof · resist ·
  collectResources · applyEffects · deriveSpellcasting)`. The central math; check the repeated
  token-scans (feeds R4) + ref-resolution/missing handling.

Architecture / correctness (do after the above):
- [x] **CH6 · Content load → graph** — TRACED (2026-07-11), no code change. Chain is coherent: sources
  (roots + extra) → per-file `parseContentDirectives` → type resolution (`#content-type:` explicit,
  else longest-filebase match) → meta/hash checks → `Papa.parse` → locale scan → `parseRow` (zod) →
  prose re-attach → row w/ `effectiveId`; then index (`byType`/`byEffectiveId` dup-detect/`articles`),
  link (`spell_lists` joins via a shared `systemsById`), API (`list`/`get`/`editionsOf`/`resolveRefs`).
  No cross-file duplication (join-map builder deduped; type casts are documented single seams).
  `spellAccess` is a separate blind projection. Comprehensively tested (loader.test: merge, source:id
  identity, cross-edition articles, #content-type, hash drift, resolveRefs, translation gaps, real 2-root).
- [x] **CH7 · Ability-score pipeline** — TRACED + deduped (2026-07-11). VM (`build/state`) cleanly
  delegates math to `build/rules`; found + fixed small VM-side duplication: (a) `toggleCapped<T>` helper
  now backs the 3 capped multi-selects (species-boost / background-boost / ASI-target picks) that each
  re-implemented includes/filter/cap; (b) magic pick-caps → `boostPickCount(BoostShape)` (rules, +test) and
  local `asiPickCount(AsiShape)`; (c) `abilityBoosts` reuses the `backgroundBoosts` derived instead of
  re-calling `allocateBackgroundBoost`; (d) `boostComplete` had a redundant `? total===3 : total===3`
  ternary → simplified. Behavior-preserving (289 tests green).
- [x] **CH8 · Homebrew authoring round-trip** — TRACED + deduped (2026-07-11). Chain intact
  (EditContentForm → save/upsertHomebrewRow → buildRow(zod parseRow) → writeStampedHomebrew(stamps
  `#content-*` header + BOM+CRLF via stampDirectives) → storage.write → resetContentGraph → loader).
  Cleanups: (a) `slugify` was implemented TWICE (homebrew + build/state) → moved to a dependency-free
  `src/lib/util/slug.ts`, imported by both + EditContentForm (no more route→authoring coupling);
  (b) `toCsv` + its module `BOM` const were dead (knip-confirmed) → deleted; (c) `buildRow`/`columnsFor`
  were unused *exports* → de-exported (internal only); (d) the "schema columns + preserved extra
  columns" block (upsert + remove) → one `columnsWithExtras(type, rows)`. Behavior-preserving, 289
  tests, 0 visual drift. **FIXED (was a latent contract gap):** `saveHomebrewRow` (fresh append) wrote
  only schema columns and dropped draft extras, unlike `upsertHomebrewRow`. Not UI-triggerable today
  (the add form filters locale-variant columns), but the two write paths disagreed. Both now go through
  one `buildRowWithExtras` helper (buildRow + re-attach non-schema columns) + `columnsWithExtras`, so a
  new row keeps localized-prose columns exactly like an edited one. +2 tests (fresh-save id + extras).
- [x] **CH9 · Menu/overlay lifecycle** — TRACED (2026-07-11). Verified: the `$effect` clamp
  (CombatMenus) keeps the popup in-viewport (viewport-coord math, bottom-overflow pull-up + top-edge
  guard, idempotent from `overlay.top`); backdrop click + outside-wheel both close; `overlay.kind` is
  the typed `MenuKind` union with exhaustive branches (R2 confirmed). Deduped the one within-file CSS
  clone: `.field input` + `.modifier-target` (identical menu text-input) merged to one selector.
- [x] **CH10 · Roster CRUD** (census-found) — TRACED + deduped (2026-07-11). Chain clean (roster
  `+page` → character store → repository over `getUserStorage()`). Store dedup: `openCharacter` now
  delegates to `loadCharacterBySlug` (both did the same load + `res.ok && res.character ? … : null`
  unwrap), and the twice-written `characters.guid = crypto.randomUUID()` → a named `bumpGuid()` that
  states the why (rotate the recompute key; GUID not counter).
- [x] **CH11 · App switching** (census-found) — TRACED + deduped (2026-07-11). Reactive-store contract
  holds: theme/system/locale toggles write `app.*` and every consumer reads it reactively (`$derived`
  / template). The ONLY `activeSystem` snapshot is `build/state` `draft.system = app.activeSystem`,
  which is BY DESIGN (a character binds to its creation system — the invariant), not a caching bug.
  Deduped: the byte-identical `inEdition` row-filter (compendium + translate) → one
  `inActiveEdition(systems)` exported from the app store (row-type-agnostic; each page keeps a trivial
  `r => inActiveEdition(r.systems)` wrapper). **FLAGGED:** `app.activeEditions` has NO writer anywhere —
  the 5e/5.5e edition toggle (see the article-edition-toggle design) isn't wired; editions are fixed at
  both. Feature gap, not a refactor item.
- [x] **CH12 · Command palette (Ctrl+K)** (census-found) — TRACED + deduped (2026-07-11). Search core
  (`makeNameIndex`/`makeTextIndex`/`searchContent`) is correctly shared with the palette (+ its own
  tests); Ctrl+K uses `e.code` (physical key, any layout). Deduped the compendium deep-link URL, built
  identically in the palette + `openEntry` → one `compendiumEntryPath(base, type, source, id)` on
  detail.ts (source encoded in the path since a slug is unique only per type).
- [x] **CH13 · Content article render + select** — TRACED + deduped (2026-07-11). Both the compendium
  and spellbook lists projected grouped rows into the EntryList model with the SAME per-row shape
  (`{id: effectiveId, name, meta: entryMeta, edition: editionLabel, row}`), differing only in grouping
  fn (`groupRows` vs `groupEntries`) and name source (localized vs `name_en`). Extracted
  `toEntryGroups(groups, nameOf)` on detail.ts; both call it. `buildDetail`/`WikiDetail` seam + the
  `onselect → openEntry` callback are otherwise single-site. 0 visual drift on the compendium list.
- [x] **CH14 · Reactive `$effect` flows** — TRACED (2026-07-11), all idempotent + loop-free, no code
  change. **combat autosave**: debounced 800ms; `combat.character` is an independent `$state` set once
  at load, NOT derived from `characters.active`, so `saveCharacterToStore` (which reassigns `.active` +
  reloads the roster) never re-triggers the effect → no write-loop; flushes on before-reload.
  **EditContentForm draft**: debounced 600ms, guarded by `readOnly` (demo) + `current === baseline`
  (untouched form spawns nothing), writes the draft cache (not `draft`). **compendium deep-link**: reads
  only `graph` + `entryParam`, every write inside `untrack`, no self-`goto` → `openEntry`→url→select
  terminates. **theme/locale apply + localStorage persist**: write DOM / external store, no reactive
  back-edge. The two debounced-autosave effects are structurally similar but differ in guards/payload;
  a shared helper (must run inside `$effect`) isn't worth the indirection.

### Per-file audit — checklist (tick a file once scanned; findings recorded below it)

Scan one file at a time, top to bottom, record findings, then tick. `★` = created/heavily changed in
the feature sprint (most debt), do first. `·` = older/lightly touched.

Routes / VMs (high debt):
- [x] `src/routes/combat/state.svelte.ts` ★ — DONE (2 bugs + 10 issues, see below)
- [x] `src/routes/build/state.svelte.ts` ★ — DONE (R1 + 7 issues, see below)
- [ ] `src/routes/combat/+page.svelte` ★  (~1400 lines, S1)
- [ ] `src/routes/build/+page.svelte` ★
- [ ] `src/routes/combat/CombatMenus.svelte` ★
- [ ] `src/routes/spellbook/+page.svelte` ★
- [ ] `src/routes/compendium/[...entry]/+page.svelte` ·  + `+page.ts`
- [ ] `src/routes/settings/+page.svelte` ·  · `+page.svelte` (root) · `+layout.svelte`/`.ts`

lib — content:
- [ ] `src/lib/content/homebrew.ts` ★ · `detail.ts` ★ · `grouping.ts` ★ · `loader.ts` ★
- [ ] `src/lib/content/schemas.ts` ★ · `spellAccess.ts` · `search.ts` · `provider.ts` ★ · `store.svelte.ts`

lib — character / rules / effects:
- [ ] `src/lib/character/derive.ts` ★ · `spellcasting.ts` ★ · `schema.ts` ★ · `repository.ts` · `store.svelte.ts` ★
- [ ] `src/lib/effects/index.ts` ★  (R4 token grammar) · `src/lib/combat/helpers.ts` ★
- [ ] `src/lib/rules/core.ts` · `pipeline.ts` · `spellcasting.ts` ★ · `src/lib/build/rules.ts`
- [ ] `src/lib/demo/sheet.ts` ★

lib — storage / infra / components:
- [ ] `src/lib/storage/tauri.ts` ★ · `provider.ts` ★ · `browser.ts` · `fetch.ts` · `node.ts` · `memory.ts` · `types.ts`
- [ ] `src/lib/stores/app.svelte.ts` · `i18n/index.ts` · `schema/version.ts`
- [ ] components: `EditContentForm.svelte` ★ · `WikiDetail.svelte` · `EntryList.svelte` · `Chip/Switch/Pin/EyeToggle/CommandPalette/Wip`

tools (converters — check count-asserts + parsing):
- [ ] `tools/srd/convert.mjs` ★ · `convert-2014.mjs` ★ · `convert-slots.mjs` ★ · `convert-classes.mjs` · `convert-spells.mjs` · `convert-items.mjs` · `convert-monsters.mjs` · `lib.mjs` · `tools/build-static-content.mjs`

Mechanical / independent checks (don't rely on my judgment — run these to catch what the file+chain
passes miss):
- [x] **MECH1 · duplication detector** (`jscpd src`) — DONE (2026-07-14). `jscpd` devDep + `.jscpd.json`
  (src `{ts,svelte,css}`, tests excluded, minTokens 35) + `pnpm jscpd`, wired into `pnpm lint` AND the
  pre-commit hook (simple-git-hooks). Baseline: 100 clones / 1.67% lines (CSS worst at 3.69%, TS 0.58%);
  **threshold 1.8%** = new duplication fails the gate. Follow-up: burn down the CSS clones, then ratchet
  the threshold toward ~1%.
- [ ] **MECH2 · import graph** (`madge`) — cycles, god-modules (fan-in/out), orphan files.
- [x] **MECH3 · strict types + lint** — DONE. Baseline plain `tsc` was clean (0). Enabled BOTH
  `exactOptionalPropertyTypes` (8 sites) and `noUncheckedIndexedAccess` (81 across code+tests) in
  `tsconfig.json` and fixed every one — regex `match[n]` guarded (`m?.[1] ?? ''`), array/record
  indexing guarded or `!`-asserted where provably populated (skills record, `sc.classes[0]` in
  tests), optional fields constructed conditionally. Both flags now enforced by CI (svelte-check).
  Also ran MECH1 (jscpd: 0.49% dup, only CSS clones + BVM-2 csv-splitter left) and MECH2 (madge:
  no circular deps). Remaining lint idea (no-explicit-any grep) folded into per-file passes.
- [~] **MECH4 · test coverage** — DONE (baseline). Added `@vitest/coverage-v8` + `pnpm test:coverage`.
  Overall ~66% lines. Blind spots: `.svelte` components (0% — need browser-mode tests, P9) and the
  Tauri/fetch storage impls + i18n init (0% — need integration/mocks). Real PURE gaps were
  `content/grouping.ts` and `content/detail.ts` at 0%; added `grouping.test.ts` (7 cases). `detail.ts`
  (the compendium render model, ~354 lines pure) is still 0% — a good next coverage target.
- [x] **MECH5 · invariant greps** — DONE this pass; found a real violation → **RULES-1**, below.
- [x] **MECH7 · orphan/dead-code (`knip`)** — DONE. Added `knip` devDep + `knip.json` (tool scripts as
  entries, tauri CLI/dialog ignored, exports/types at `warn` so it's non-blocking) + `pnpm knip`
  script. Full orphan triage catalogued in **`docs/ORPHANS.md`** (🟢 false-positive/internal ·
  🟡 unfinished · 🔴 likely dead) — NOT deleted (half-finished features). Real dead-dep found:
  `@tauri-apps/plugin-dialog` (JS file-picker not wired yet).
  **Update (2026-07-14): knip is now GREEN and a hard gate** (wired into `pnpm lint`). Cleared the
  whole backlog: 35 unused exports + 28 unused types un-exported or deleted, `Wip.svelte` +
  `changeDataDir` + `diffTrees`/`TreeDiff` + `boostComplete` removed. The triage also surfaced real
  cross-file dups fixed on the spot: `ordinal` ×3 → `util/format.ts`; combat's `EffectInstance`
  redefinition → re-export of the character-schema type; `SystemId` now derives from the schema
  `SYSTEMS` const (one source of truth for editions).
- [ ] **MECH6 · differential test before merging a dup** — run both "duplicate" impls on the same
  input, assert equal. NB the pip formulas (CVM-2) are NOT equal → merging blind would change behaviour.

**TYPE-1 · skill/ability maps are `Record<string, T>` (should be keyed unions)** — FIXED for skills.
`SKILL_ABILITY` is now `as const satisfies Record<string, Ability>` (keys form a `SkillId` union), the
sheet's `skills` is `Record<SkillId, …>`, and accessors are `SkillId`-typed — so a known-key lookup is
sound and the two production `!` (derive `passiveOf`, combat `passives`) are gone. Dynamic-string call
sites (`Object.keys(...) as SkillId[]`, `togglePassive`, the skill grid) carry an honest key cast
instead. (Abilities already use the `Ability` union; no change needed there.) Original note follows —
surfaced by the
`noUncheckedIndexedAccess` pass (MECH3). `deriveSheet` builds `skills = {} as Record<string, Computed
& {prof}>` and callers index it by a skill id; the string index signature forces every access to be
`T | undefined`, so the two production sites (`derive.ts` passiveOf, `combat/state` passives) need a
`!`. These maps are TOTAL over the fixed 18-skill / 6-ability sets (the `SKILL_IDS` union already
exists in `combat/helpers`). Fix: a `SkillId`/`Ability`-keyed `Record<SkillId, T>` + typed accessor
keys → the access is sound and the `!` disappears. (Test-only `!` are fine — they assert setup.)

**RULES-1 · `src/lib/build/rules.ts` hardcoded ASI/feat levels by class name** — FIXED. Added an
`asi_levels` content column to `classSchema`, derived from the SRD by BOTH converters (2024: parse the
Level-4 ASI block's "…again at <Class> levels 8, 12, and 16" prose + [4,19]; 2014: the progression
table's ASI rows — note the source truncates Rogue L10's cell to "Ability Score", so match on
`ability score`). Regenerated both editions (Fighter 4,6,8,12,14,16,19; Rogue 4,8,10,12,16,19; rest
4,8,12,16,19). `asiFeatLevels(level, asiLevels?)` now filters the class's own data (common-progression
fallback for homebrew), no class-name switch. Wired `featSlots` to read `row.data.asi_levels`. Tests:
rules.test (filter + fallback) + a build.test wiring case (Fighter L14 → [4,6,8,12,14]).

Not scanned (by design): `*.csv` content (data, not code), `src/lib/index.ts` (empty `$lib` stub),
config (`vite.config.ts` · `eslint.config.js` · `svelte.config.js` — build config, not app logic;
scan only if a config bug surfaces). Everything else functional is on the list above.

---

**`src/routes/combat/state.svelte.ts` (CombatVM, ~687 lines):**
- [x] **CVM-bug1 · `conc` hardcodes "bless"** — FIXED. `conc` now reads the schema's
  `play.concentration` ref and resolves it to the spell name; the feature is wired end to end (was a
  dead placeholder): `SpRow` carries `ref` + `conc`, `cast()` sets `play.concentration` for a
  concentration spell (replacing any prior, 5e rule), and the indicator button clears it. Behavioral
  CombatVM tests (concentration set/replace/clear).
- [x] **CVM-bug2 · `conditionList` hardcodes system `'5.5e'`** — FIXED. Uses `this.character.system`.
  Behavioral test: a 5.5e character sees 5.5e conditions, not 5e-only ones.
- [x] **CVM-1 · `doRoll` vs `rollDiceNow` duplication** — DONE. Pure `rollPool(dice, mod, adv, bonusDice)`
  lives in `$lib/rules/dice`; both the tray's `doRoll` and the instant `rollDiceNow`/`pushRoll` paths in
  `roll.svelte.ts` call it. Seeded-RNG unit-testable.
- [x] **CVM-2 · click-to-set pip impls unified** — DONE. One pure `pipClick(currentSpent, index, total)`
  in `combat/helpers` is the single source for action-economy pips (`economy.usePip`), spell slots, and
  resource pips (`resources.svelte.ts`) — the disagreeing formulas are gone (R5).
- [x] **CVM-3 · action-slot type `'action'|'bonus'|'reaction'`** repeated in slotMax/usePip/ctSlot/
  trySpend (this is R3, local instances).
- [x] **CVM-4 · `overlay.kind: string`** + `openMenu(kind: string)` → `MenuKind` union (R2, local).
- [x] **CVM-5 · token regex inline in `slotMax`** — DONE. `TurnEconomy.slotMax` now folds action/bonus/
  reaction extras via the shared bounded-vocab `parseEffect` (`EFFECT_KIND.flatBonus` + `Object.hasOwn`),
  no local regex (R4).
- [x] **CVM-6 · `RollLogEntry` type + log cap** — DONE. Named `RollLogEntry` type in `combat/helpers`
  (`Rolled & {label, damage?}`), the `log` field + all push sites use it, and the cap is a single
  `ROLL_LOG_MAX = 200` constant in `roll.svelte.ts`.
- [x] **CVM-7 · shadowing / naming** — the action-economy field `slotMax` is shadowed by a local
  `const slotMax` in `spellGroups`; the `cast` method is shadowed by a local `const cast` inside it.
  Rename.
- [x] **CVM-8 · `actions` inline array with cryptic keys** (`{id,n,h,d,m,roll?}` = name/hint/desc/marker)
  → a typed `StandardAction` interface with readable field names, and it's static data → move to
  helpers/data (the derived only needs to inject the live skill mods).
- [x] **CVM-9 · VM `round` vs schema `play.round`** — the VM keeps its own `round = $state(1)` while
  the character schema already has `play.round`; they can diverge. Use the persisted one.
- [x] **CVM-10 · `iid: label + Date.now()`** → `crypto.randomUUID()`. DONE (GUID-not-counter).

**`src/routes/build/state.svelte.ts` (BuildVM, ~735 lines):**
- [ ] **BVM-1 · draft fields are triple-maintained** — every draft `$state` must be listed in the
  class decl, in `reset()`, and in `hydrate()`. Adding one = 3 edits (already bitten). Extract a
  `defaultDraft()` factory (single source of the field set) that reset/hydrate build on. (This is R1's
  bigger sibling — the whole draft is worth one typed shape, not ~25 loose fields.)
- [x] **BVM-2 · `csv` comma-splitter duplicated** — DONE. One `splitList(v)` in `content/schemas.ts`
  (the CSV-cell coercion home); `build/state` + `spellAccess` alias to it, `EditContentForm` uses it
  for the systems field. (The byte-identical copies were in build/state + spellAccess.)
- [x] **BVM-3 · feat-category string literals** (`cat === 'origin'`, `=== 'epic-boon'`) — use the
  exported `FEAT_CATEGORIES` const from schemas, not bare strings (enums-not-literals).
- [ ] **BVM-4 · the `draft` derived is ~60 lines** assembling the whole Character inline (twice, incl.
  a duplicated last-resort fallback) → extract a pure `assembleCharacter(state)` fn, unit-testable
  (round-trips with hydrate for the level-up tests we skipped).
- [x] **BVM-5 · `pointsSpent` field shadows the imported `pointsSpent` fn** — DONE. Field renamed to
  `pointsUsed` (only used internally by `pointsLeft`).
- [ ] **BVM-6 · token/format regexes inline** — `flat-bonus:([a-z]{3})…` in `speciesFixedAbilities`
  (R4) and `^(\d+)x(\d+)$` for `boost_choice`; centralise/parse-once.
- [x] **BVM-7 (partial) · magic sentinels / id strings** — `ASI = '__asi__'` mixed into `slotFeats` values (a
  discriminated union would be cleaner), the hardcoded feat id `'ability-score-improvement'`, ASI
  shapes `'2'`/`'1-1'`, `'any'` skill list, `'species'`/`'other'` in abilityNote, `slotFeats` composite
  string key `${i}:${level}`.

**Structural / file-splitting debt** (split by responsibility — VM · pure helpers · area components ·
curated global CSS · scoped specifics — so logic doesn't pile into one file and breed duplicates):
- [x] **S1 · `combat/+page.svelte` split into area components** — DONE (2026-07-11). `combat/+page.svelte`
  went **1405 → 124 lines** (a thin shell that composes the blocks and owns only the dnd panel grid).
  Eight components under `combat/blocks/`: `Hero` (wraps the existing `HpPanel`), `Controls`, `Turnbar`,
  `ResourceBar`, `Playbar`, `CombatStrip` (AC/init/speed tiles + senses + defenses), `Abilities`, and
  `PanelCard` (the skills/attacks/actions/effects/spells card, ~553 lines — its own sub-split into
  per-panel components is a possible follow-up but not required). Each reads the `combat` view-model
  singleton and takes `c`/`s` props; no global-CSS changes were needed. **CSS subtlety preserved**: the
  resource-bar's `.bar-label` is *unstyled* (only `.turnbar .bar-label` + `.senses-strip .bar-label`
  ever existed), so promoting a global `.bar-label` would have changed pixels — instead each component
  keeps its own scoped copy (a few trivial rules like `.spacer`/the bar container duplicated across 2–3
  blocks, acceptable vs. a pixel regression). Dropped dead rules along the way: `.round-counter`,
  orphaned `.toggle.rest`, stray `.nextturn:hover`. **Verified 0px** across all 8 shot.mjs states after
  every component, `svelte-check` 0 errors (4 pre-existing a11y warnings, just relocated), 291 tests
  green. Component-by-component + screenshot each, per [[charnik-split-large-svelte]] / [[charnik-repo-tooling]].
- [~] **P9 · component testing (browser mode)** — SET UP. vitest now has two projects (`node` for
  logic/VM + pure, `browser` for `*.browser.test.ts` mounting real components in headless Chromium via
  `@vitest/browser-playwright` + `vitest-browser-svelte`). CI installs Chromium before `pnpm test`.
  First test: `EyeToggle.browser.test.ts` (aria-pressed state + click). NB browser mode asserts DOM +
  interactions, NOT visual/CSS layout — S1's CSS still needs screenshots. More component tests welcome.

- [x] **S2 · `CombatVM` decomposed into cohesive subsystems** — DONE (verified 2026-07-11). The old
  687-line god-class is now **393 lines of wiring + derived**, with the heavy concerns split into their
  own `$state` classes that `CombatVM` composes: `RollTray` (`roll.svelte.ts`, dice tray + log + roll
  execution), `PanelLayout` (`panel.svelte.ts`, columns/collapse/drag), `TurnEconomy`
  (`economy.svelte.ts`, pips/movement/turn/round/spend checks), `ResourceTracker`
  (`resources.svelte.ts`, slots/resources/rests). The pure bits are all shared helpers now:
  **CVM-1** roll pool → `rollPool` in `$lib/rules/dice` (both tray + instant paths call it),
  **CVM-2/R5** pip math → one `pipClick` in `combat/helpers` (used by economy + resources + slots),
  **CVM-5/R4** slotMax token parse → the bounded-vocab `parseEffect` (no inline regex),
  **CVM-6** the log-entry shape → the named `RollLogEntry` type + `ROLL_LOG_MAX` constant. What's left
  in `state.svelte.ts` is genuine coordination (load, menus, HP, level-up, spell cast/prepare routing,
  the derived stat aggregates) — cohesive, not a dumping ground.
- [ ] **S3 · `build/state.svelte.ts` (BuildVM)** similarly large — after R1 (EditContext) audit it the
  same file-by-file way; likely candidates: statgen, spells picker, feats/ASI slots as their own units.
- [ ] Audit the remaining big `.svelte`/`.svelte.ts` files one at a time (compendium, spellbook,
  EditContentForm, CombatMenus) and append their findings here before touching code.

### Compendium-editor refactor set (planned 2026-07-09)

A coordinated set: split the wiki detail into components, type the loader properly, and harden
the lint gate. Detailed component shapes live in `docs/FRONTEND.md` §4.3 (WikiDetail
decomposition + RollButton). Ordering + open decisions below.

- [x] **WD-1 · Split `WikiDetail` (~740 lines)** — DONE (dispatcher + SpellHead/MonsterHead/GenericHead
  + ArticleProse + wikiEdit types; actions moved to dispatcher; read + translate verified via
  screenshots — spell/monster/generic + editable path pixel-faithful). Original notes: split into: dispatcher (`WikiDetail`) + per-type
  `SpellHead`/`MonsterHead`/`GenericHead` (mode-aware: `read | translate | editor`) + shared
  `ArticleProse` (body/higher_level/material). `actions` slot moves to the dispatcher (fixes:
  today it only renders in the generic branch, so Spellbook's Cast never shows on a spell).
  Scope THIS pass = **read + translate parity only**; `editor` mode stays the WIP stub.
  Safety net: `WikiDetail.browser.test.ts` (P9 infra) asserting each type/mode renders the right
  fields + inputs, plus per-type screenshots for CSS (moving ~470 scoped lines into 4 files is
  the regression risk).
- [x] **WD-2 · Extract `RollButton`** — DONE. shared roll affordance (plain click = `rollFormula` +
  toast; ctrl/alt-click = `openDiceTray(request)` CONTRACT — `$lib/dice/tray.svelte`, a registry with an
  instant-roll fallback until a real tray registers, so callers aren't nailed to a concrete tray).
  Pill/icon variants own the styling; replaced the inline spell-effect (d20/Dmg/Heal) + monster HP 🎲.
  Spellbook Cast left alone (it's a play-state action, not a dice roll). Verified by screenshot + a
  contract test.
- [ ] **TYPE-2 · Typed `LoadedRow` (the loader keeps the type it already knew)** — the loader
  reads `#content-type:` (or filename) and runs the typed `parseRow(type, raw)`, then **discards
  the type** into `data: Record<string, unknown>`. Make `LoadedRow` a discriminated union on
  `type` (`LoadedRowOf<T>` with `data: z.infer<schema[T]> & LocaleCols`), and thread the generic
  through `graph.list<T>(type)` / `get`. Frictions: (1) locale-prose columns zod strips + the
  loader re-attaches need a template-literal index (`` `${string}_${string}` `` → `string`,
  which under `noUncheckedIndexedAccess` reads as `string | undefined`); (2) dynamic-key reads
  (`buildDetail`'s `d[ability]`, grouping, spellAccess) lean on that index. ~236 `.data`/`.list`
  sites, but the shared `base` (name_en/text_en/systems/source/effects) means common-column reads
  compile un-narrowed; only type-specific reads need `row.type === 'x'` narrowing (mostly at sites
  that already know the type). `svelte-check` drives the pass.
- [~] **DRAFT-CACHE · Persist in-progress edits (translate / add / editor) so a closed form restores.**
  DONE (parts 1–2, commits `6178ce3`/`48cb105`): `$lib/drafts/store` (self-contained files, no manifest,
  content-versioned, discard-on-mismatch, +6 tests) + translate wired (prefill/debounced-save/clear,
  e2e-verified) + add wired (per-GUID, resume newest-of-type on mount, clear on save).
  DONE (part 3, commit `1bfa62e`): the pending-drafts **surface** — `DraftsPane` (full-width list, 4th
  "Drafts" picker entry, unlimited pickable add-drafts) + `OrphanDialog` (N-of-M step-through, 2-pane
  reassign picker + preview + conflict view) + compendium/translate wiring + store `findOrphanDrafts`/
  `repointDraft`/`draftEffectiveId` (+10 tests). Verified live.
  DONE (part 4, commit `2868f5c`): **editor** draft wiring — landed with Editor mode (below).
  DONE (part 5, commit `83996d7`): **warn-on-schema-discard** — `SchemaDiscardDialog` (house template,
  single-pane notice) fires on compendium load when the cache holds drafts from another
  `CONTENT_SCHEMA_VERSION`; store `findStaleDrafts`/`discardDrafts`. Verified live.
  **DRAFT-CACHE is COMPLETE — no open tails.**
  **SURFACE DECIDED 2026-07-10** (mocks: `design-preview/drafts-surface.html`, `orphan-popup.html`):
  - **Drafts list = full-width pane that replaces the editing block** (compendium right column, where
    WikiDetail/EditContentForm render) — opened via a **4th "Drafts" entry** in the "✎ Edit compendium"
    picker, with a live count badge. Lists **every** draft (all types+kinds), grouped ⚑Needs-attention /
    Translations / New entries; each row = kind icon + title + target (locale for translate) + age +
    Resume/Delete. This makes add-drafts **unlimited + individually pickable** (supersedes resume-newest
    -of-type). A draft must be **openable no matter what** (incl. orphans) so modified fields are never
    lost.
  - **Orphan dialog** = the house attention-dialog template ([[charnik-dialog-design-template]]): centered
    modal, ⚑ badge header + **"N of M" step-through** (one orphan at a time), 2-pane body (left = your
    draft prose read-only; right = **searchable reassign picker across ALL sources** + live preview of the
    highlighted target), footer = Delete · Skip · Keep-as-new · Reassign. Orphans are discovered **when the
    cache is read** and a `target` id resolves to no content row.
  - **Reassign = re-point, then resume** (NOT write-through): the draft is re-targeted to the chosen entry
    and opens in Translate/Editor prefilled; nothing is written to content until the user hits Save.
  - **Reassign CONFLICT:** if the chosen target **already has a draft** for the same key, the user must
    choose **which of the two survives** — and must be able to **open either draft to inspect its modified
    fields first** (no silent overwrite, no lost work). The loser can be kept-as-new rather than hard-
    deleted where possible.
  - Editor wiring lands with Editor mode. Warn-on-schema-discard notice = same dialog template.
  Original spec:
  A form's last unsaved state is cached to disk and silently re-fills the form when reopened (for any
  reason — nav away, reload, crash). Over the `Storage` seam; reuses the character autosave debounce.
  - **All drafts live in a `drafts/` folder on disk, one self-contained JSON per draft — NO manifest /
    index file** (a lost manifest must never break the set; discover by scanning `drafts/` + reading
    each, same principle as removing `_pack.json` and content's self-describing `#content-` headers).
    Each file carries its own identity so nothing external is needed:
    ```jsonc
    { "schemaVersion": CONTENT_SCHEMA_VERSION, "kind": "translate|add|editor",
      "target": { "type","source","id","locale?" } | { "addGuid","type" },
      "sourceHash": "xxh64:…", "savedAt": "…", "data": { …the row/prose model… } }
    ```
    Identity lives IN the file (`target`), so the **filename is just a safe unique name** — a hash of
    `kind+target` for translate/editor (re-editing the same row+locale overwrites its one file, no
    dupes) or the add GUID (`crypto.randomUUID`, per [[charnik-guid-not-counter]]). This sidesteps the
    Windows filename hazard (raw `effectiveId` = `type:source:id` has illegal `:` + spaces).
  - **Versioning follows the general schema — NO separate draft schema.** `data` is a content row (or a
    prose subset), so it carries `CONTENT_SCHEMA_VERSION` via the existing `Versioned`/`migrate`
    convention (`src/lib/schema/version.ts`). But drafts are ephemeral WIP, so on a version mismatch →
    **discard, don't migrate** (`<` current or `>` current → drop). **BACKLOG: warn the user on a schema
    change that unsaved draft data will be / was dropped** (a notice, not silent) — losing WIP silently
    is surprising.
  - Lifecycle: prefill on open → debounced save on change (`untrack` so the write doesn't re-fire) →
    **clear (delete the file) on successful save** (write content first, then delete the draft).
  - **Orphan draft** (a draft file whose `target` resolves to no content row — row deleted, or an
    add-GUID): a pop-up dialog offers **reassign to an existing entry** (picker) / **keep as a new
    entry** / **delete the draft**. Add a small **"pending drafts" surface** (in the Edit-compendium
    picker) so orphan add-GUID drafts are reachable — auto-restore-on-open never reaches them otherwise.
  - Staleness: `sourceHash` differs from the row's current `#content-hash` → keep but flag "source
    changed since your draft."
  - Demo/read-only: caching is harmless but saving is blocked, so skip caching there.
- [x] **LOC-CHECK · Flag partial/mis-filled translations (loader content-health)** — DONE. the loader
  discovers locales but doesn't verify a locale's rows are actually complete. Add a check that emits a
  WARN `issue` (never throws — same channel as bad rows) when a row is **partially** translated for a
  locale: it has SOME `<base>_<loc>` filled but is MISSING a `<base>_<loc>` whose `<base>_en` is
  non-empty. That's the "someone mis-filled the table" signal (started a translation, missed a field);
  a fully-untranslated row is NOT flagged (normal — EN fallback). Keyed off `PROSE_BASES`; surfaced in
  content-health + (later) the translate list's ~ marker. Low-noise by construction.
- [ ] **LINT-1 · Ban type-escape hatches** — tsconfig is already max-strict (`strict` +
  `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`); the hole is lint. Add:
  `@typescript-eslint/no-non-null-assertion`, keep `no-explicit-any` + `ban-ts-comment` (errors),
  `consistent-type-assertions` (no unsafe object-literal `as`). Then enable
  `recommendedTypeChecked` (the unsafe-`any` family — real teeth) **after TYPE-2**, so it doesn't
  drown in the current bag. Policy: new code fully typed; avoid the `undefined` TYPE (model
  absence deliberately) — introducing it needs a deliberate decision. Null-checks are their own
  follow-on track (`noUncheckedIndexedAccess` already forces many).

**Sequencing (DECIDED 2026-07-09):** **TYPE-2 → LINT-1 → WD-1 → WD-2.** Type the foundation
first so every new component (the heads) is born typed and LINT-1's type-checked rules land on
clean code; the view split follows.

**Editor mode — DONE (commit `2868f5c`; two-panel `5550e9c`).** The "Editor" mode-picker entry (active
once an entry is selected) opens a **two-panel BEFORE | AFTER** view (commit `5550e9c`, as agreed):
the current rendered article (read-only `WikiDetail`, "Current") beside the editable form ("Your edit"),
mirroring Translate's source|target. The "after" pane REUSES `EditContentForm` (an `editRow` prop)
rather than bespoke editable heads — so every `fieldsFor` widget + zod validation is shared with Add. Save = `upsertHomebrewRow` (replace
same-id row, preserve columns beyond the schema so localized prose survives). A **read-only shipped
SRD row FORKS to homebrew** (same id, `source=Homebrew`); a homebrew row edits its own file. The SRD
file stays untouched (survives a future SRD update, keeps CC-BY attribution).
**Override = SORT, not hide (DECIDED 2026-07-10 by the user):** a homebrew row floats ABOVE the SRD
original in every compendium group (`grouping.compareRows`/`homebrewFirst`, stable so shipped order is
otherwise untouched — 0px on the SRD-only set). Both coexist (honours the source-namespaced-identity
invariant); the full keep-one/keep-all UI stays a later `collisions.json` feature.
Also landed with it: homebrew writes now **stamp a `#content-*` header** (source/license/id/schema/
updated-at/hash — the DATA-VER "in-app authoring stamp") so app files never trip the metadata-check /
hash-drift dialogs (default homebrew license = `Custom`); and the **license** is threaded onto rows +
the detail source-line (was a hardcoded `CC-BY-4.0`).

---

## Implementation roadmap (phased)
1. **Scaffold** — SvelteKit (**`adapter-static` SPA**) + **pnpm** + lint; test tooling
   (see TESTING.md); **`Storage` interface + node/in-memory impl**; `schemaVersion`
   convention; **frontend conventions pinned** (store shape `activeSystem/activeLocale/
   theme`, CSS token contract, `t()`+`dir`/RTL, route map, thin-component rule, **a11y +
   keyboard nav incl. Tab order & `Ctrl+K`**); `package.json` scripts (pnpm); write
   `docs/*`. **Then (after Rust+MSVC installed)**: `tauri init`, fs/dialog plugins +
   capabilities, Tauri `Storage` impl, data-dir resolution + first-run, `tauri dev`/
   `build` smoke. *(TS side is doable now; Tauri wiring waits on the toolchain.)*
2. **Content sources + config** — multi-root scan, merge, in-memory index, collision
   detection (`collisions.json`), per-file/source toggles, **atomic UTF-8-BOM/CRLF
   writes**, file-watch live reload **ignoring self-writes**.
3. **CSV schema** per type (common + mechanics + L2 + `effects` + linked
   `class_features` + resource defs + per-system overrides; **zod validators**; design
   spell upcast/cantrip-scaling) + **SRD converter script** (CC-BY source → our CSV;
   candidates in Risks; verify licenses + keep attribution) + seed SRD subset.
4. **Rules + effects core** (+ tests) — mods, prof, capacity, passive senses, attack/
   spell DCs, **stacking pipeline + bounded effect interpreter**, optional toggle;
   `5e`/`5.5e` seam; reactive system.
5. **i18n** — runtime catalogs, live switch, EN fallback, RTL, collation, discovery.
6. **Compendium** + **content-health view** — browse/search/sort (system-aware) +
   diagnostics (broken refs, missing translations, collisions, bad rows).
7. **Character schema** (build/runtime split, `schemaVersion`) + store (load/save, photo,
   `log.jsonl`, autosave/backups, bundle, missing-content) + tests.
7.5 **Frontend architecture** (`docs/FRONTEND.md`) — component tree, sheet layout, props
   from core types, store/`$derived` wiring for live switches.
   **Layout model = modular panels + preset views (HYBRID, decided P1).** The UI is built
   from discrete **panels** (HP, combat stats, abilities, skills, attacks, spells,
   actions/maneuvers, conditions/effects, inventory, notes, …). It ships **named views** —
   **Profile · Combat · Inventory · Build** — each a **preset arrangement** of panels.
   The **Inventory view is NOT a list like the spellbook** — it's a **card grid (≈4 across)**:
   each item a card with a **category icon** (weapon/armor/potion/scroll/wondrous glyph — we
   ship **no art**; SRD is text-only), name, key stat (dmg/AC/weight), quantity, and
   equipped/attuned badges, **grouped into sections** (Equipped/attuned · Weapons ·
   Consumables · Gear · Treasure). The icon slot shows a **category emoji by default, replaced
   by the item's image when one is set** (homebrew/user-supplied, like character photos).
   Header shows weight/capacity (imperial+metric) + currency + filter + add. Other views are
   panel arrangements as above
   (Combat = the play sheet already designed). A view has a **fixed stats header** (identity/
   HP, combat tiles, passive senses, abilities) and, below it, a **two-column PANEL AREA** —
   the only customizable zone. **Light per-user customization**: **every panel collapses/
   expands** (chevron) and can be shown/hidden; **panels are drag-reorderable WITHIN the
   two-column area** — drag a block to any slot or the other column; blocks always stay
   **vertically stacked / sequential** in the two columns (masonry order), never free-floating.
   A **free-form absolute canvas stays out of scope** — this constrained drag gives the
   flexibility without the cost. Pick/save a preset. Layouts persist per character; the two
   columns collapse to one per breakpoint (phone over LAN); keyboard-a11y preserved (reorder
   via keyboard too).
   **UI control conventions:** (1) binary **state** on/off (prepared, conditions, auto-calc,
   shield) = **toggle switch** (slider, teal when on) — never checkboxes; (2) **visibility**
   "show/hide on the sheet" (which spells/skills/actions/panels appear) = an **open/closed
   EYE icon** — **open eye tinted teal = shown**, closed eye muted = hidden — used everywhere
   visibility is chosen, distinct from the state switch.
8. **Build/level-up + statgen** — point-buy/array/manual; **level-up flow**;
   **multiclass (+spellcasting)**; XP toggle; free-feat mode.
   **Two edit modes — STRICT vs FREE** (per character, stored, switchable anytime; Strict
   default). **Strict** enforces the rules of the **character's OWN system** (point-buy caps,
   skill-choice counts, class/subclass/feat prereqs, ASI rules, prepared caps, **multiclass
   prereqs which are PER-CLASS** (Wizard INT 13, Fighter STR *or* DEX 13, Cleric WIS 13,
   Sorcerer CHA 13, …; you must meet your current class(es)' AND the new class's — read from
   content data, not hardcoded)) — invalid choices are blocked/flagged. **Free** lets the user set ANY value
   (scores, features, HP, spells, anything) with no validation — for homebrew, imports,
   cross-tool conversions, or fixing; shows a clear "unvalidated" indicator.
   **Strict is system-aware — the 5e and 5.5e build forms DIFFER**: ASI on **species (5e)**
   vs **background (5.5e)**; 5.5e adds **weapon mastery** + **background-granted origin feat**
   + species without ASI; different skill/tool/background mechanics. Validate against the
   bound system, never reinterpret across systems.
9. **Character sheet UI** (responsive, **keyboard-navigable** — Tab order, `Ctrl+K`) —
   all fields (separate sections), **effects panel**, **explain-on-hover/tap stat
   breakdowns (provenance + rule blocks)** — **EVERY auto-calculated value** (AC, save DC,
   attack/spell-attack bonus, ability/skill/save mods, passive senses, max HP, initiative,
   carrying capacity, …) shows a **small hover/focus popover listing what produced it** (each
   `{source, op, amount}` contribution + rule notes); a manually-overridden value instead
   shows a "manual" marker (not a breakdown). **configurable passive senses** (player pins
   which passive skills appear; default Perception/Investigation/Insight), play-state trackers
   (HP/slots/resources/conditions/concentration/equipped/attune) + **round counter**,
   **rests**, dice roller, weight/(opt)capacity imperial+metric, photo, notes, appearance.
   **Action-economy tracker** on a turn bar: **Action · Bonus action · Reaction · Movement**
   (remaining/max ft) — each marks used/available and **resets on a prominent `Next turn`
   button** (which also advances the round). No-roll actions (Dash/Disengage/Dodge/Help/
   Search/Use Object) are picked here, under the relevant slot. **Each slot shows a COUNT as
   pips, not a single on/off** — features grant extras (Fighter **Action Surge** = 2 actions;
   **Haste** = +1 limited action; effects can add a bonus action or reaction), rendered as
   multiple pips (filled = available, dim = used), with the granting source labelled.
   **Slot/resource pips are click-to-set** (same model for spell slots, ki, rage, etc.):
   clicking a **filled** pip empties it and every pip after it (available count = that index);
   clicking an **empty** pip fills it and every pip before it. So clicking the last filled pip
   spends one, clicking the first empty pip restores one — and clicking deep into the row
   sets the count in a single tap.
   **Conditions are MERGED into the Effects panel** (a condition is just an effect of type
   `apply-condition`) — ONE "Effects & conditions" list is the single source of truth for
   active modifiers, each with provenance, duration, a type tag (spell/item/feature/condition)
   and remove; concentration shows inline. The +Condition / +Effect quick-pickers write into
   this same list. **No separate Conditions panel.**
   **Shield = one dedicated toggle button** on the sheet (don/doff the equipped shield in
   one tap → its +2 AC effect turns on/off live, reflected in the AC provenance trace);
   it is a fast play-state control, not buried in inventory.
   **Stat interaction model**: (a) **click any value → set a manual override** (any stat,
   any time, independent of the auto-calc engine); (b) abilities are **tap-to-roll** (check
   or save, each with its own hit target) — the per-ability skills live in the dedicated
   **Skills panel**, not a hover dropdown (which duplicated it); (c) **tap a
   check / save / attack → opens the dice tray PRE-FILLED** (d20 + that modifier, labelled
   with the source) — **never an instant silent roll**; the player can adjust advantage/
   disadvantage, add dice, and tweak the modifier, then **Roll**. The dice tray is a **roll
   builder**: a dice **pool with selectable COUNT per die** (`N × dY`, e.g. 8d6), a flat
   modifier, adv/dis, and a **roll log** — opened from the "last roll" readout on the sheet —
   listing every roll with its source, formula breakdown, total, round, and adv/crit flags
   (rerollable). The log is backed by the character's append-only **`log.jsonl`** → **full
   persistent history across sessions**, grouped by session/date and searchable — NOT capped
   to recent rolls; the panel **scrolls back through the entire history** (virtualized for
   large logs). Each row has a **hover delete (trash)** to drop a roll. Keyboard- and
   touch-equivalent (focus opens the same dropdown; long-press
   to edit a value on touch).
   **Attacks**, **spells**, and **actions/maneuvers** are THREE SEPARATE panels. The
   **attacks panel** lists weapon attacks (melee/ranged, incl. unarmed/thrown). The
   **Actions panel** lists the **full set of standard actions** (system-aware 2014/2024 —
   Attack, Dash, Disengage, Dodge, Help, Hide, Ready, Search, Study, Influence, Utilize/Use
   an Object, Grapple, Shove, Magic/Cast; canonical list ref: crobi 5e quickref
   `https://crobi.github.io/dnd5e-quickref/preview/quickref.html`), with a **show/hide config
   menu** so the user picks which appear. **Roll/contest** actions (Hide, Search, Grapple,
   Shove, Influence, Study) open the roll builder; **no-roll** actions just mark the
   action-economy slots. Class-specific & homebrew actions merge in via the feature-action
   groups (above).
   **Class-specific action lists are NOT hardcoded** — Battle Master **maneuvers**, Monk **ki
   actions**, Rogue **cunning action**, Barbarian **rage**, Sorcerer **metamagic**, Warlock
   **invocations**, Paladin/Cleric **Channel Divinity**, Druid **Wild Shape**, Artificer
   **infusions** are all instances of ONE generic **"feature-action group" panel**: a named
   list of options bound to a class **resource** (superiority dice / ki / sorcery points /
   channel uses / rage / …), shown only for the granting class. Entries come from content CSV;
   **homebrew merges identically** (rows added to the group's type, source-namespaced + per-
   source toggle) — users add custom maneuvers/metamagic/invocations exactly like spells.
   **Grapple/Shove have NO fixed DC** — render
   system-correct: **2014 = a contest** (your Athletics roll vs the target's Athletics/
   Acrobatics, so the "difficulty" is the opponent's roll, shown as `contest`, not a static
   number), **2024 = the target saves vs a derived DC `8 + STR mod + prof`**. Jump →
   Athletics only if contested. The rest are quick references / action-economy markers.
   The **spells panel** lists
   all spells and is **independently configurable**: the user **groups spells however they
   want** (by level / school / prepared / concentration / custom user-defined groups),
   can **pin frequently-used spells** to a Favourites group at the top, and can **hide the
   panel entirely** (non-casters). **Spell preparation is modeled**: *prepared* casters
   (cleric/druid/wizard/paladin/artificer) keep a known/spellbook pool and **prepare a
   subset** — per-spell **prepare toggle**, a **prepared-count tracker** (cap = class +
   ability mod); a **rule-option allows OVER-CAP preparation** (off by default — when on, you
   may prepare past the limit and the counter shows e.g. 12/11), always-prepared/domain spells
   flagged, rituals castable unprepared where
   the class allows; *known* casters (sorcerer/bard/warlock/ranger) skip prepping (all known
   are castable). The panel can filter/group **prepared vs full list**. On the **play view**
   it shows only the **castable set** (cantrips + prepared + pinned) — bounded by the prepare
   cap (~11) + cantrips, NOT the full spellbook (which is routinely 30+); a filter switches to
   *All* or opens the **spell-management view** — a clearly separate control (not the cast
   tap): a **two-pane** screen, left = a **list of every spell with per-row buttons** (👁
   show/hide on the play sheet · ▢ prepare · ☆ pin), right = the selected spell's **wiki
   detail rendered from our content CSVs**. (Casting happens only by tapping a spell row on
   the play sheet — distinct from managing.) Tapping either an attack or a damaging/
   attack spell opens the roll builder in **attack mode**: ① **to-hit** (d20 + attack bonus,
   adv/dis) vs AC, then ② **damage** (weapon/spell dice + mod) with a **Crit toggle**.
   **Save-based attacks/spells skip to-hit** and show the target save (ability + DC) with
   **half-on-save**. Weapon properties carry through (versatile 1H/2H, thrown, two-weapon,
   damage type); cantrip/slot scaling sets spell dice; casting spends the slot.
   **Spell-row layout: effect-first + resolution tag.** The **spell save DC and spell attack
   bonus are caster-wide constants** (`8 + prof + ability mod`) shown ONCE in the panel header,
   never per row. Each row shows the **effect** (damage/effect) in a fixed column + a small
   **resolution tag**: `attack roll` (YOU roll vs AC — gold) · `<ABILITY> save` (the TARGET
   rolls vs your DC — crimson, ability varies per spell) · `auto-hit` (teal) · `—` (no
   attack/save). Same in 5e/5.5e.
   **Crit damage method = a rule-option**: *classic* (roll DOUBLE the dice) or *loyal* (one
   set of dice **maxed** + one set **rolled**); default classic, switchable in settings and
   per-roll.
10. **Content editor UI** — add/save custom content (incl. effects) into homebrew CSVs.
11. **Theming + settings** — light/dark + custom themes; settings screen with unified
    **rule-options toggles** (capacity, encumbrance, free-feat, xp-mode, multiclass,
    effects-engine on/off, language, system, theme) — all live.
12. **Export/print + roster + content-pack sharing** — good PDF/print; manage many
    characters; **export a `source` as a shareable pack** (+ import via collision/health).
13. **Package** via **`pnpm tauri build`** (Win `.exe`/`.msi`, Linux AppImage (appimage-only, `tauri.linux.conf.json`)) +
    README (install, add-content-via-CSV, portable vs app-data mode).

Security tasks are woven across phases per [SECURITY.md].

## Verification
Automated coverage and conventions live in [TESTING.md] (suites map to phases; run
`pnpm test`). Manual acceptance per feature: live switches (no reload); sources
(2nd CSV, homebrew folder, toggle off, collision resolve); live reload (edit CSV on
disk); portability (move JSON to fresh install → renders + flags missing; bundle opens
anywhere); play loop (damage → rest → restore; concentration; level-up; multiclass
slots); sheet (effects panel auto-vs-manual, photo, weight+metric, capacity toggle,
print/export).

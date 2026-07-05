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
  sort/filter elsewhere.
- **Content-health view**: diagnostics over loaded content — broken references, missing
  translations, ID collisions, malformed rows. Valuable since content is user-edited.

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
- **`dataDir` via Tauri `path`**: default = OS **app-data dir** (`appDataDir`), with an
  optional **portable mode** (`data/` next to the exe). Holds `content/`, `characters/`,
  `charnik.config.json`, `collisions.json`.
- First run: pick/confirm `dataDir` (Tauri **dialog** folder picker) + language + system →
  written to config; overridable later in settings.
- All file IO is confined to `dataDir`/roots via the **`Storage` interface + Tauri fs
  capability scope** (see SECURITY.md).

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
  (Win `.exe`/`.msi`, Linux AppImage/`.deb`). **Toolchain**: Rust (rustup) + **MSVC C++
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
    AppImage/`.deb`). Toolchain: **Rust (rustup) + MSVC C++ Build Tools** (Win) + WebView2
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

## Backlog (post-spellcasting, prioritized) — carve down gradually

Flagged during the persistence/build/spellcasting work. Grouped; ~rough priority within each.

**Security / deps:**
- **DEP-1 · `glib 0.18.5` moderate advisory** (GHSA-wrw7-89jp-8q8g, dependabot #3) — transitive via
  Tauri's Linux webkit2gtk/wry backend; fix is `glib 0.20` (a gtk-rs major, pinned by Tauri, not a
  plain `cargo update`). Only affects a LINUX desktop build; Windows (WebView2) + the web target have
  no glib. Defer to a Tauri upgrade; safe to dismiss with that rationale meanwhile.

**Data versioning (needs a proper think — surfaced in the refactor, 2026-07-05):**
- **DATA-VER-1 · content versioning is defined but not wired.** CHARACTER versioning works end to
  end (schema default `schemaVersion` → `assembleCharacter` stamps it → `repository.loadCharacter`
  runs `migrate(data, CHARACTER_MIGRATIONS, …)`; registry empty at v1, which is fine). But
  `CONTENT_SCHEMA_VERSION` is **exported and never used anywhere** — CSV rows don't carry a version,
  `PackManifest.schemaVersion` is optional and read by no migrate, and there is no content-migration
  path. So if the content column model changes, old user CSVs have no forward-migration story. Decide:
  do content rows/packs carry a version (and where — a `# schemaVersion:` directive like the type
  directive? a manifest?), and what runs the migration in the loader. Until then either wire it or
  drop the unused const so it doesn't imply a guarantee we don't provide.

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
- [ ] **R1 · Group edit/level-up state into `EditContext`** — BuildVM scattered the level-up state
  across 7 fields (`editId`, `editPlay`, `editUi`, `hydratedBoosts`, `hydratedFeats`,
  `hydratedSpells`, `hydratedSkills`). Collapse to one `edit: EditContext | null` (a typed object);
  `edit === null` means "creating". Every `this.editId ? …` becomes `this.edit`.
- [ ] **R2 · Type `overlay.kind`** — CombatVM's overlay uses `kind: string`, compared against ~15
  bare string literals (`'dice'`, `'levelup'`, `'customeffect'`, …) spread over state + CombatMenus.
  Make a `MenuKind` union and type the overlay; kills typos + enables exhaustiveness.
- [ ] **R3 · Name the action-economy slot type** — `'action' | 'bonus' | 'reaction'` appears ~13×
  as bare strings (slotMax, usePip, trySpend, the page's SLOTS). One `type ActionSlot` + a single
  source of the slot list. (Relates to the enums-not-string-literals rule.)
- [ ] **R4 · Centralise effect-token parsing** — the bounded-vocab regexes (`flat-bonus:…`,
  `grant-resource:…`, `grant-proficiency:…`, advantage/dice) are re-implemented in `effects/index.ts`
  (parseEffect/collectResources), `derive.ts` (abilityBonus + grant-proficiency scan), `combat/
  state.svelte.ts` (action-pip scan) and `combat/helpers.ts` (rollEffectsFor). Parse ONCE in the
  effects module and have every consumer read the structured result — the token grammar must live
  in one place (it's also the security surface, docs/SECURITY.md).
- [ ] **R5 · Extract the click-to-set pip helper** — `slotClick`, `resourceClick` and `usePip` each
  re-derive the same "click a filled pip → spend to it; click a spent pip → restore to it" math.
  One pure `pipClick(count, spent, index) → newSpent`, unit-tested, used by all three.
- [ ] **R6 · Source-tag constants** — `'SRD 5.1'` / `'SRD 5.2.1'` / `'Homebrew'` are string-littered
  across converters, tests and app code. Central consts (pairs with the friendly-labels map).
- [ ] **R7 · Strict/Free as a named mode**, not a bare `boolean`, per enums-not-literals — optional,
  low priority.
Do R1–R5 as a focused pass (they're the ones that bite: typos, duplication, drift). R6–R7 are
opportunistic. Add tests where extracting a helper (R4/R5) makes logic unit-testable.

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
- [ ] **CH5 · deriveSheet aggregation** — `gatherEffects → (abilityBonus · grant-prof · resist ·
  collectResources · applyEffects · deriveSpellcasting)`. The central math; check the repeated
  token-scans (feeds R4) + ref-resolution/missing handling.

Architecture / correctness (do after the above):
- [ ] **CH6 · Content load → graph** — `Storage sources → loadContent (parse/merge/index/link) →
  get/list/editionsOf` + `spellAccess` union. Multi-source merge, longest-filebase match, edition scope.
- [ ] **CH7 · Ability-score pipeline** — point-buy / standard-array / manual / background-boost /
  species-choice / ASI-slot → `abilityBoosts` → scores. Logic spread across `build/state` + `build/rules`.
- [ ] **CH8 · Homebrew authoring round-trip** — `EditContentForm → buildRow/parseRow → unparse →
  Storage.write → resetContentGraph → loader → shows in compendium`.
- [ ] **CH9 · Menu/overlay lifecycle** — `openMenu → position → $effect clamp → wheel/click close`
  (CombatMenus). Smaller; verify the clamp/scroll fix + overlay.kind typing (R2).
- [ ] **CH10 · Roster CRUD** (census-found) — root `+page.svelte`: list characters, `open(id)` →
  `openCharacter` → combat, `removeCharacter(id)`, new. Store `characters` (guid recompute) + storage.
- [ ] **CH11 · App switching** (census-found) — `+layout.svelte`/`settings`: theme / locale /
  activeSystem / activeEditions toggles → `app` store → live re-render everywhere (system→build,
  editions→compendium, locale→i18n+rowName). The reactive-store contract; check nothing caches system.
- [ ] **CH12 · Command palette (Ctrl+K)** (census-found) — `onWindowKeydown → search (Fuse name/text
  indexes) → goto page or deep-link the compendium entry`. `$lib/content/search` + the palette.
- [ ] **CH13 · Content article render + select** — `graph row → buildDetail/entryMeta/groupEntries →
  WikiDetail/EntryList`, and the `onselect` callback → `openEntry` (compendium/spellbook). The
  render/model seam + WikiDetail's roll (folded into CH1).
- [ ] **CH14 · Reactive `$effect` flows** (census classes 2–4) — the auto-run starts, each verify it's
  idempotent + doesn't loop: **autosave** (combat `+page`: `JSON.stringify(c.play)` → debounced
  `saveCharacterToStore` — persistence correctness), **compendium deep-link** (`entryParam` →
  `select`), **theme/locale apply** (`+layout`), **palette search-on-query** (CommandPalette), **menu
  clamp** (CH9). Plus `bind:` inputs feed the VM chains (CH1/CH4/CH7/CH8) — the state entry, no new logic.

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
- [ ] **MECH1 · duplication detector** (`jscpd src`) — objective dup %; should flag the 3 roll impls,
  pip×3, csv×4, token regexes.
- [ ] **MECH2 · import graph** (`madge`) — cycles, god-modules (fan-in/out), orphan files.
- [x] **MECH3 · strict types + lint** — DONE. Baseline plain `tsc` was clean (0). Enabled BOTH
  `exactOptionalPropertyTypes` (8 sites) and `noUncheckedIndexedAccess` (81 across code+tests) in
  `tsconfig.json` and fixed every one — regex `match[n]` guarded (`m?.[1] ?? ''`), array/record
  indexing guarded or `!`-asserted where provably populated (skills record, `sc.classes[0]` in
  tests), optional fields constructed conditionally. Both flags now enforced by CI (svelte-check).
  Also ran MECH1 (jscpd: 0.49% dup, only CSS clones + BVM-2 csv-splitter left) and MECH2 (madge:
  no circular deps). Remaining lint idea (no-explicit-any grep) folded into per-file passes.
- [ ] **MECH4 · test coverage** (`vitest --coverage`) — uncovered branches = blind spots.
- [x] **MECH5 · invariant greps** — DONE this pass; found a real violation → **RULES-1**, below.
- [x] **MECH7 · orphan/dead-code (`knip`)** — DONE. Added `knip` devDep + `knip.json` (tool scripts as
  entries, tauri CLI/dialog ignored, exports/types at `warn` so it's non-blocking) + `pnpm knip`
  script. Full orphan triage catalogued in **`docs/ORPHANS.md`** (🟢 false-positive/internal ·
  🟡 unfinished · 🔴 likely dead) — NOT deleted (half-finished features). Real dead-dep found:
  `@tauri-apps/plugin-dialog` (JS file-picker not wired yet).
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
- [ ] **CVM-1 · `doRoll` vs `rollDiceNow` duplicate ~30 lines** of dice-rolling (pool loop, adv-d20
  keep-winner, bonus dice, expr/log/toast). Extract a pure `rollPool(dice, mod, adv, bonusDice) →
  {total, expr, advPair}`; both call it. (Deepest duplication in the file; unit-testable with seeded RNG.)
- [ ] **CVM-2 · three inconsistent click-to-set pip impls** — `usePip` uses `t[slot] > i ? i : i+1`
  (spent-count) while `slotClick`/`resourceClick` use `i < remaining ? full-i : full-i-1`. SAME intent,
  two formulas → one pure `pipClick()` (this is R5, and the formulas disagreeing is a latent bug risk).
- [x] **CVM-3 · action-slot type `'action'|'bonus'|'reaction'`** repeated in slotMax/usePip/ctSlot/
  trySpend (this is R3, local instances).
- [x] **CVM-4 · `overlay.kind: string`** + `openMenu(kind: string)` → `MenuKind` union (R2, local).
- [ ] **CVM-5 · token regex inline** in `slotMax` (`/^flat-bonus:(action|bonus|reaction)\+(\d+)$/`)
  (R4, local).
- [ ] **CVM-6 · `RollLogEntry` interface** — the `{label, expr, total, adv?}` log-entry shape is inline
  on the `log` field and re-typed at 4 push sites; the `.slice(0, 200)` cap is a repeated magic number.
- [ ] **CVM-7 · shadowing / naming** — the action-economy field `slotMax` is shadowed by a local
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
- [ ] **BVM-7 · magic sentinels / id strings** — `ASI = '__asi__'` mixed into `slotFeats` values (a
  discriminated union would be cleaner), the hardcoded feat id `'ability-score-improvement'`, ASI
  shapes `'2'`/`'1-1'`, `'any'` skill list, `'species'`/`'other'` in abilityNote, `slotFeats` composite
  string key `${i}:${level}`.

**Structural / file-splitting debt** (split by responsibility — VM · pure helpers · area components ·
curated global CSS · scoped specifics — so logic doesn't pile into one file and breed duplicates):
- [ ] **S1 · `combat/+page.svelte` is still ~1400 lines** — the play sheet's markup + all its scoped
  CSS in one file. Finish extracting area components (StatBars / HP / Turnbar / Resources / SpellBlock
  / Panels / Menus already partly done) so each panel owns its markup + styles. (This is the old
  in-progress task "Extract area components".)
- [ ] **S2 · `CombatVM` (687 lines) does too much** — rolling (dice pool + tray + log), action
  economy, spells/prepare, resources/rests, HP, level-up, drag layout, effects. Once the pure bits are
  extracted (roll pool → CVM-1, pip math → CVM-2/R5, token parsing → R4), the VM shrinks to wiring;
  consider grouping the rest (e.g. a roll module) rather than one flat class.
- [ ] **S3 · `build/state.svelte.ts` (BuildVM)** similarly large — after R1 (EditContext) audit it the
  same file-by-file way; likely candidates: statgen, spells picker, feats/ASI slots as their own units.
- [ ] Audit the remaining big `.svelte`/`.svelte.ts` files one at a time (compendium, spellbook,
  EditContentForm, CombatMenus) and append their findings here before touching code.

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
13. **Package** via **`pnpm tauri build`** (Win `.exe`/`.msi`, Linux AppImage/`.deb`) +
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

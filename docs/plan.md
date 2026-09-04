# Charnik — D&D Character Tracking System (Plan)

> Index doc. Companions: [testing.md](internals/testing.md) · [security.md](internals/security.md) ·
> [research/existing-generators.md](./research/existing-generators.md). Frontend UX pattern
> contract → [internals/ui.md](internals/ui.md) ▸ The UX pattern contract; live component inventory → generated
> [surface.md](./surface.md).

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
- **Three-layer repo licensing**: **code = MIT** (root `LICENSE`; keep the
  copyright notice, nothing else — AGPL-3.0-or-later up to 0.5.0, dropped because we don't
  oblige reusers to publish their code; no SPDX header per file, the root licence is the
  declaration) · **bundled data = CC-BY-4.0** (`content/LICENSE`
  + `content/ATTRIBUTION.md`, WotC SRD credit) · **user homebrew = author-owned** (app
  relicenses nothing). Summary lives in root `COPYING.md` + README "Licensing".
- **Per-source license metadata**: every `source` carries its own `license` +
  `attribution` columns in the content model, so shipped SRD (CC-BY) and community/homebrew
  sources (any license) coexist and the About/Compendium UI can credit each correctly.

---

## Effects & modifier engine (the core auto-calc)

The pivotal design. Goal: **derived stats update automatically from effects** (species
traits, class features, feats, equipped items, conditions), and the user can see and
trust what happened.

> **The current NORMATIVE spec (code-accurate token vocabulary, L2 grammar/semantics, the
> derive pipeline, state model) is [`docs/internals/effects.md`](internals/effects.md).** This section is the
> DECISION RECORD (why the engine has this shape); effects.md wins on any syntax detail.

- **Bounded effect vocabulary + text fallback.** Effects are structured data from a
  **fixed vocabulary**, NOT an executed mini-language (also a security win — content is
  never code; see security.md). The kinds/targets/values are enumerated in
  [`effects.md`](internals/effects.md) §2 (`flat_bonus`/`set_override`/`advantage`/`grant_proficiency`/
  `resist_immune`/`apply_condition`/`grant_resource`/…). Anything outside the vocab =
  **free text + an optional manual modifier** the user toggles. No Turing-complete DSL
  (avoids Aurora's swamp; stays testable).
- **Expressiveness = three layers, never code-in-CSV** (see security.md #4):
  **L1** the bounded vocab above (data; ~95%); **L2** safe value-expressions (`1d4`,
  `prof*2`, `ceil(level/2)`) via OUR dice+arithmetic parser — non-Turing-complete,
  whitelisted vars, no `eval`; **L3** plugins for the long tail. **Ordering: L2
  ships BEFORE L3.** L2 over a rich (conditional) ctx covers the great
  majority of the tail with ZERO sandbox/attack surface, so it must land first; L3's sandbox
  is only justified once L2 is exhausted and `onUse`/`onEvent` (core-owned, deferred) demand
  it. Concretely: an L2 phase precedes PLG-2 (the sandbox) — a `passive`-only `api: 1` sandbox
  must NOT ship ahead of L2. **DSL naming convention: the effect
  token DSL is `snake_case`, with `.` for namespacing** — kinds `flat_bonus`/`set_override`/
  `grant_resource`/`apply_condition`/`grant_proficiency`/`resist_immune`, target `hp_max`,
  vars `wis_mod`/`base_speed`/`class_level.monk`/`is_bloodied`. Renamed from the old kebab
  kinds because L2 makes `-` the subtraction operator, so any identifier that can appear inside an
  expression (kind, target, variable, resource/condition id) MUST avoid `-`; snake also matches
  the CSV-column convention (`hit_die`, `name_en`). **Extended: content IDs
  migrate to snake_case EVERYWHERE** — shipped SRD ids are still kebab (`acid-splash`,
  `animal-handling`), which collides with `-`-as-minus the moment an id appears in an L2
  expression (`class_level.blood-hunter`). Scope: `idField` grammar, SRD regeneration via the
  converters (never hand-edit), resource/condition ids, saved-character ref migration (the
  currently-EMPTY migration registry — AUDIT B16), character slugs. See AUDIT E3. TS CODE stays camelCase/PascalCase/SCREAMING —
  a separate layer nobody types in a CSV. Plugins compose on the
  engine seam: first-party/signed handlers = trusted; **community plugins run in a
  QuickJS-in-WASM sandbox** (`quickjs-emscripten`) with a narrow host API returning
  `{value, trace}`, hard time/memory limits, no DOM/Tauri/fs/network. **Design the plugin
  registry seam early** (cheap). **UPDATE: the sandbox is now BUILT** (PLG-1..3, 2026-07-19 —
  see the "PLG · Plugin sandbox" section below); this "deferred until demand" note is historical.
  Seam prep (doc-only — no dead code, knip is a hard gate): the token
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
- `effects/token-parser.ts` + `effects/apply.ts`: the **isolated engine** — `parseToken`
  (bounded vocab, unknown → inert text), `applyEffects(targetKey, base, active)` (the single seam: folds matching
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

**Resolved forks:**
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
  innate 1/day) is a resource: `grant_resource:<id>:<max>:<recharge>`; a spell carries
  `cast_via: slot | resource:<id> | at-will`. `grant_slot:<level>` for the rare artifact granting
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
`slotPool` (table + `grant_slot`; levels stack); known/prepared caps; resource resolver; the
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
  cleric WIS). **DONE (SPEC14):** `deriveSheet.spellcasting` is now per-class — `deriveSpellcasting`
  returns per-class profiles + shared/pact slot pools (`derive.ts:442`, `character/spellcasting.ts`),
  so multiclass DCs are correct in the core. Any remaining single-caster collapse is a UI display
  choice (see A18), not a core bug.
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

**Attacks — proficiency model (AUDIT A7/B9 — ✅ RESOLVED 2026-07-21):** `classes` now carry
`weapon_profs`/`armor_profs` (normalized categories + specific weapon ids), populated RAW from the
SRD by the converters. Pure `rules/proficiency.ts` gates `computeAttacks` (a non-proficient weapon
drops the proficiency bonus + a note) and drives B9 (worn armor you lack proficiency with →
`spellcasting.armorBlock` + a deriveIssue + a red rule-block banner on the spells panel). LENIENT
fallback preserved: a class (or set of classes) that declares no prof column stays proficient with
everything — old homebrew is never wrong-downward.

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
- **Settings ▸ Themes (custom themes) — CORE DONE, extras PLANNED.** Users author their own
  color themes without a rebuild. **Architecture:** the design-token contract (`tokens.css`) is
  semantic (`--color-surface`/`-text`/`-accent`/`-resource`…), switched by `data-theme` on `<html>`;
  `ThemeId` is open-typed; the **runtime injector** (`customThemes.ts`, commit `2336546`) turns a
  `{id, name, tokens}` into a `[data-theme=id]` `<style>`, wired into the layout effect over the
  persisted `app.customThemes`, so a registered theme activates live like dark/light. A **strict
  sanitizer** (unit-tested) allows only known themeable token names + a color/length value grammar —
  user-file values can't inject CSS.
  - [x] **Themes tab UI** (commit `4423e9d`) — `ThemesSettings.svelte`: lists built-in + custom
    themes as swatched cards; clone a built-in → editable custom theme; pick / duplicate / delete.
  - [x] **Editor** — token→value form over `THEMEABLE_TOKENS`, seeded self-contained from the base
    via `snapshotBaseTokens` (a custom `[data-theme]` cannot inherit another theme by cascade).
  - [ ] **Persistence + portability** — themes live in `localStorage` (app-store) today; move to a
    user-owned `themes.json` in the data dir via the `Storage` seam so a theme is
    shareable/importable like content packs; export/import one theme. A theme is user-owned data and
    belongs on their disk like everything else they own, not in browser storage the app happens to
    have.
  - [ ] **Theme scope is COLOURS ONLY.** Density, roundness and type stay app-owned even though
    font-size/radius/tracking are tokenized and could be exposed. A theme that can move spacing turns
    every layout into N layouts nobody screenshots, and nobody has asked. This is also why the px
    spacing guard is not worth building: with colours-only themes an off-scale `14px` breaks nothing.
  - [x] **Guard** — stylelint `color-no-hex` (tokens.css exempt) keeps new hardcoded colours from
    leaking past the token layer and silently breaking themes.

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
  - **3D physics dice — DEFERRED, not dropped.** An off-the-shelf overlay
    (`@3d-dice/dice-box` — WebGL/BabylonJS + wasm physics, themeable, returns per-die results) on the
    roller's seam, **off by default** and especially gated on the web demo, because the bundle is
    heavy (WebGL + wasm + textures). **Variant A: the physics engine owns the rolled
    number** (maintainer: *"нам не треба детермінізм"*), which drops the hard part of forcing a 3D
    roll to land on a pre-computed RNG value. **What that must not break:** `rules/dice.rollFormula`
    is not deleted — a roll resolves through a result *provider* (`dice3d` when the toggle is on,
    else `rollFormula`), so the fallback path (web, toggle off, headless), the dice tests, and every
    downstream consumer (`log.jsonl`, damage totals, HP) keep working off the same integer.
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
  retrofitting; UX pattern contract in `internals/ui.md`.
- **Content-pack sharing (in scope)**: export a whole **`source`** as a portable set
  (its CSVs, optionally zipped) so users can share homebrew packs; import re-uses the
  collision/health flow. (Distinct from per-character bundle export.)

---

## Content sources & loading

- **Content root folders are the subfolders of `<dataDir>/content/`** (e.g.
  `content/srd-2024/`, `content/homebrew/`), **discovered by scanning** — one folder is one pack
  and no config lists them (superseded REL-4; the registry records where a pack CAME FROM, not
  that it exists). Any number of CSVs per type
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
in-memory / read-only fetch — serves desktop AND web). Per root: reads each file's own
`#content-*` header (there is no pack manifest — docs/internals/content.md ▸ No manifests),
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
access without editing shipped spells — see Spellcasting model). **TODO** (the rest of this list has
since shipped — `spell_slots.csv`, the `spell_lists.csv` join + its unknown-id warn, the explicit
`#content-type:` directive, `collisions.json` read/write; and roots are DISCOVERED by scanning, so
there is no config list of them to wire — REL-4 superseded that): the **2014** `class_casting.csv`
counts (see Spellcasting model), **UI type-assign** for an unrecognised file, and backfilling the
truncated 2014 class-feature prose from SRD 5.1.

### Content type identification (which CSV is what) — DESIGN

Users add their own CSVs and **organize them into folders freely**, so the app can't rely on
one rigid convention to know a file's **type** (schema). Two separate concerns, don't conflate:
- **(a) What TYPE is this CSV?** (schema) — precedence, first match wins:
  1. **Explicit declaration** (survives any name/folder): the header directive
     **`#content-type: spell_slots`** — one of the `#content-*` keys, not a format of its own, and
     not the `#charnik-type:` this section used to name (the app has never parsed that). A
     `_pack.json` map was the alternative and is REJECTED with every other manifest (§1.6).
  2. **Filename convention** (current behaviour): `<filebase>_*.csv` → type. Zero-config for the
     shipped SRD and anyone who follows it.
  3. **Ask in the UI**: an unrecognized file is **never silently dropped** — it's surfaced in
     content-health, and the user assigns its type once (written into the file's own header, since
     there is nowhere else for it to live). Still open: the loader + the health entry exist, the
     assign FORM does not.
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
- **feat** (`feats_*.csv`) `category(origin/general/fighting_style/epic_boon/general_2014), prereq, repeatable`.
- **spell** (`spells_*.csv`) `level, school, casting_time, range, components, material, duration, concentration, ritual, classes, resolution(attack/save/auto/none), save_ability, damage, higher_level`. Caster-wide DC/attack are **computed, never stored**.
- **item** (`items_*.csv`) `category, tags, damage, base_item_id, rarity, cost, weight_lb`. Everything that applies to only SOME items rides in `tags` (ITEM-TAGS below).
- **condition** (`conditions_*.csv`) `negative` (crimson vs teal); mechanics in `effects`.
- **effect** (`effects_*.csv`, runtime "+" catalog) `kind(bounded vocab), target, op, value, duration_rounds`.
- **File-level metadata, NOT a pack manifest.** `schemaVersion, source, license, attribution,
  systems` are declared per FILE in its `#content-*` header (DATA-VER-1), so rows don't repeat
  license/version and files from different sources still merge. **This replaced a proposed
  `_pack.json` sidecar** — docs/internals/content.md ▸ No manifests has the reasoning, and this is the
  case that produced it. A stray `_pack.json` left over from that layout
  is inert: it isn't read, and the pack differ knows not to propose deleting it.
- **TODO (later)**: 2024 subclass-level overrides (all level 3) via per-system override
  column rather than the seeded 2014 `subclass_level`; bulk SRD fill beyond the seed.

### Column or tag — where a fact lives
The rule for every future schema change, and the one that shapes ITEM-TAGS below.

> **A column when its emptiness is a hole. A tag when its absence means "does not apply."**

`weight_lb` is blank in 287 of 390 items — a hole, because the converter never extracted it, and
somebody should. `str_min` is blank on a dagger because daggers have no Strength requirement. The
first is a column with a bug; the second was never column-shaped.

- **Fold alternatives, never companions.** A tag cell stays short only because the folded facts are
  mutually exclusive by kind: a weapon never carries armour tags. Measured over shipped 2024 items,
  the folded cell is **median 17 characters, worst ≈76** (a crossbow), against today's `properties`
  maximum of 75. Folding facts that co-occur — `cost`, `weight_lb`, `rarity` all apply to the same
  row — would grow every cell without bound. That is what "everything in tags" fails at.
- **A compound field stays a column even where it would fit.** `damage` is `1d6 slashing; 1d4
  radiant`: its own internal structure, carrying the separators a tag list uses. Same class as
  `effects`. A fact that has grown a grammar is not a tag however sparse it is.
- **What a tag costs**, in order of how much it hurts: (1) zod stops validating it — `ac: optInt`
  rejects `"eleven"` by column name, `ac:eleven` inside a tag list is just a string, so **a bad
  tag value must surface in content health**, the channel unknown effect tokens already take, never
  a silent zero; (2) the header stops advertising that the fact exists — an empty `str_min` column
  says "armour can require Strength", a missing tag says nothing; (3) no fill-down, sort or filter in
  a table processor. Hence the quick test: **if you would ever drag it down the whole sheet, it is a
  column.**
- **Grammar**: a tag is `name` or `name:value`, lowercase snake, comma/semicolon separated and read
  by the existing `splitList`. Nothing more — no nesting, no ordering, no third separator. `-` is
  banned because it is the L2 minus operator (see `slugify`), and `name:value` is the shape every
  effect token already uses, so a tag and an effect scope are the same string (`two_handed`).

### ITEM-TAGS · eight item columns folded into `tags` (DONE 2026-08-27, content schema v2)
Applied the rule above. `items_*.csv` carried 19 columns of which most were blank for any given row,
because it describes weapons, armour, gear and magic items in one table — which is right: splitting
by kind would break `inventoryEntry.item` (one ref to any item) and the 24 places that narrow on
`row.type === 'item'`. **19 → 13**, of which two are new:

```
id, category, tags, damage, base_item_id, effects, rarity, cost, weight_lb,
name_en, name_uk, text_en, text_uk
```

| folded into `tags` | | stayed a column |
|---|---|---|
| `item_type` — three different facts under one name (`simple melee` / `light armor` / `weapon (dagger)`), which 3 functions substring-matched | | `damage`, `effects` — compound fields (see rule) |
| `properties`, `range` | | `rarity`, `cost`, `weight_lb` — companions, one row carries all three |
| `ac`, `armor_dex_cap`, `str_min`, `stealth_disadvantage`, `attunement` | | |

What it bought, beyond the sparsity:

- **`weaponScopeSet` is gone**, and with it the last prose-sniffing in the combat path. A tag NAME
  *is* an effect scope, so there is one vocabulary: `mastery:nick` scopes as `mastery` instead of the
  empty `mastery:` all 38 mastery rows used to degrade to. (**Superseded refinement 2 below** — a
  `mastery` column is the wrong shape under this rule.)
- **`category` carries the kind.** `potion`/`ring`/`wand`/`staff`/`rod`/`scroll`/`wondrous` joined
  `ITEM_CATEGORIES`: `item_type` was holding them for 380 rows while `category` said only "gear", and
  the compendium's Type grouping had 54 buckets because magic rows kept prose in it.
- **`base_item_id`** — a magic item points at the mundane row it is built from; the base's tags go
  underneath, the item's own win by name, in one resolver (`content/item-tags.ts ▸ resolveItem`).
  `vorpal_sword` no longer declares itself a glaive, which is what `inner.split(',')[0]` made of
  `Weapon (Glaive, Greatsword, Longsword, or Scimitar)` in 8 shipped rows.
- **`weight_lb` for 2024 gear** — 0 of 81 rows had one. The `####` entries carry the price, the
  weight lives only in the Adventuring Gear table; the converter now reads both. 62 of 81 have a
  weight, the other 19 say `—` in the SRD and stay blank.
- **The checks a column had, back where they belong.** zod validated `ac: optInt` by column name and
  a tag list is just a string, so a non-numeric `ac:`/`dex_cap:`/`str_min:` and a dangling
  `base_item_id` are content-health issues (`loader.ts ▸ validateItemTags`).

Small wart left standing: the article's **Base item** cell shows the raw id (`scale_mail`), because
`buildDetail` is pure and has no graph to look the name up in. Resolving it means an options object
through all seven call sites (a 5th positional param trips the "five params means a type" rule) —
worth doing when that cell becomes a link to the base item's article, not before.

**Still open.** The "any melee weapon" templates (Flame Tongue) are NOT `base_item_id` — the base is
the player's choice at equip time, needing `inventoryEntry.base` in the character schema and a UI.
Deliberately deferred; the attack row says "Base weapon not set" rather than rolling a bare modifier
and looking complete.

**Weapon mastery is now half-modelled** (5.5e only — 2014 has no such rule, so only the 2024
converter writes the tag). The weapon half is data: every 2024 weapon has exactly one mastery
property in its own SRD column, and `mastery:<name>` records it. The CHARACTER half is missing —
RAW the property does nothing unless a feature unlocks it, and the five SRD classes that grant
Weapon Mastery at level 1 (Barbarian, Fighter, Paladin, Ranger, Rogue) each unlock it for **N kinds
of weapon of the player's choice**, N growing per the class table and one choice swappable on a Long
Rest. That is build state (`build.masteries`, re-editable at level-up like every other chosen
option) plus the eight effects themselves, none of which exist. `versatile:1d10` is the same shape:
data with no mechanic reading it.

Migration was the first real use of `content/migrations.ts`: `CONTENT_SCHEMA_VERSION` 1 → 2, the
`item` step registered, both packs regenerated. Two things it forced:

- **A missing step now advances a type untouched.** One counter covers every content type, so a bump
  that reshapes items says nothing about spells; demanding a step per type made every v1 file of
  every other type an error. (The CHARACTER chain keeps the strict rule — one shape, so a gap is real.)
- **Converters stamp `#content-schema`.** They never had, and every re-run silently stripped it — the
  directive only survived because a `pnpm restamp` had put it back. Absent reads as "current", which
  is true until the next bump and then quietly wrong for every regenerated file.

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
2. ~~**`mastery` column on item**~~ — superseded by ITEM-TAGS above: mastery is a tag
   (`mastery:nick`), not a column. Today `properties` carries it as `mastery: Nick` and
   `weaponScopeSet` reduces all 38 rows to the scope `mastery:`, losing the name.
3. **Species ability bonuses → `effects`** (`flat_bonus:con+2`) instead of only prose
   (5e: on species; 5.5e: on background); model **subraces/lineages** (e.g. Elf lineages).
4. **Monster**: optionally structure `saving_throws`, `damage_resist/immune`,
   `condition_immune`, `legendary_actions`, `proficiency_bonus` (now all in `text_en`).
5. **`resource`** on class features (rage/ki counts) — currently unparsed.
None block the loader; they raise fidelity where the UI later wants structured filters.

### Shipped SRD content (P3 — the `charnik-content-srd` repo's CSVs, GENERATED not hand-written)
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
  scope** (see security.md).

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
- **No server → no LAN/IP/auth surface** (simpler security; see security.md). LAN/phone
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
13. **Testing** → [testing.md]; **Security** → [security.md] (separate plans).
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
    contract + light/dark/custom themes are unchanged. UX pattern contract → `internals/ui.md`.
    **Semantic color roles (consistent everywhere):** **crimson = important / danger**
    (pinned/favourite, negative effects, destructive, primary actions like Roll/Next-turn),
    **teal/cyan = good / confirmation / positive** (available resources & slot pips, positive
    effects, temp HP, toggles-on), **gold = everything else / neutral marker** (proficiency &
    prepared dots, resource counters). On/off **dots are filled when active, hollow when
    inactive** — never a dimmed fill.

Config files: `charnik.config.json` (dataDir, toggles, rule-options, settings) +
`collisions.json` (collision resolutions) — separate. `charnik.config.json` has SEVERAL owners, so
each writes ONE top-level section through `storage/json-config.ts` (read-merge-write, queued per
file): a whole-blob write would make the first writer the owner and erase every other section.
Today's sections: `contentPacks` (the REL-4 registry). The dev-only content-repo pointer is a
different file, `charnik.dev.json` in the APP repo — same name for both was a standing trap.

---

## Risks & open engineering notes (carry into implementation)
- **CSV write-back footguns**: UTF-8 BOM + CRLF (Excel/Cyrillic), atomic writes, app
  writes only its own files, watcher ignores self-writes. (Addressed above; verify.)
- **Multiclass spellcasting** + **concentration** + **prepared/known** = highest-bug
  modules → dedicated tests (see testing.md), call out in P8.
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

Feature designs from the audit-session planning discussions (they are roadmap work, not defects).
Cross-refs: `B*` / `D*` / `UBUG-*` = items in the backlog below. Stable IDs — don't renumber.
(The old `docs/AUDIT.md` was retired 2026-07-29 — its surviving items live in the backlog; any
`EFX-*` / `A*` code left in this file has been rewritten in plain terms, don't reintroduce them.)

Core insight: PHB class features reduce to THREE data shapes, and the engine for two of them
already exists — (1) passive modifier tokens (blocked only on the fold gathering them), (2) activatable
actions = COMPOSITION of existing systems (`economy.trySpend` + `resourcesSpent` + `addEffect`
with duration + `rollPool` — no new engine, new `class_features` columns: activation slot,
resource cost, applied tokens, duration, roll), (3) choice groups (`choice_group` + `choose_n`
columns; generalizes the builder's slotFeats pattern; chosen rows then behave as 1/2).
Level scaling stays formula-free: per-level `class_features` rows re-grant (monk die d6→d12,
superiority d8→d12) — the table is already keyed by level; L2 expressions not needed for ~90%
of PHB. **Acceptance: FULL PHB integration — every feature of every PHB
class must be EXPRESSIBLE via one of the three shapes (or explicitly marked manual-text
fallback) — PLUS the tier-1 homebrew set:** this sizes the vocabulary, it does not authorize
authoring PHB rows; what SHIPS stays SRD. The homebrew set is Blood Hunter (Mercer;
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

- [x] **N1 · Inventory view.** The combat panel (`pid: 'inventory'`): qty stepper, equip / attune
  (cap 3 — Strict blocks, Free allows and says so), "use" on a consumable, and the weight →
  carrying-capacity bar. **What must survive:** money is its OWN thing (N6), never an inventory row;
  ADDING an item stays in the builder, because that is a search through hundreds of rows while the
  panel is the four verbs play needs; item charges live in RECHARGE-3, not here.
- [~] **MAGIC-ITEM-EFX · Tokenize the shipped SRD magic-item effects (GLOBAL content task,
  surfaced by DEMO-1 gap 2, 2026-08-04).** **FIRST TRANCHE DONE 2026-08-09 — 14 items × both editions,
  each read off that edition's own SRD text.** The plumbing was already there (an `effects` column,
  equipped/attuned rows flowing through `gatherEffects`); every magic-item row simply shipped EMPTY.
  Authored: Cloak/Ring of Protection (`flat_bonus:ac+1;flat_bonus:saves+1`), Stone of Good Luck
  (`ability_checks`+`saves`), Amulet of Health / Headband of Intellect / Gauntlets of Ogre Power
  (**`set_override:<abil>:19:floor`** — the FLOOR mode matters: RAW "no effect if already 19 or higher",
  and a plain set would drag a 20 down), Ring of Swimming (`set_override:speed.swim:40`), Boots of the
  Winterlands (`resist_immune:resist:cold`), Boots/Cloak of Elvenkind + Eyes of the Eagle (Stealth /
  Perception advantage), Bracers of Defense (the guard `not is_wearing_armor and not is_wearing_shield ?
  flat_bonus:ac+2`), Mantle of Spell Resistance + Ring of Spell Turning (`note:` — the vocabulary has no
  "against spells" save qualifier, so they stay text rather than fold too broadly). **Edition
  divergences kept:** 2014 Boots of Elvenkind are qualified ("checks that rely on moving silently" —
  folded, qualifier noted) and the 2014 Cloak needs its hood UP (an action), so it stays text while the
  2024 one folds. **Converter preservation FIXED** — `convert-items.mjs` and the 2014 converter emitted
  `effects: ''`, so a re-run wiped the authoring (verified by doing exactly that, then re-running to
  prove the fix: byte-identical output, same hash). The `existingColById` helper the other two
  converters had each copied is now one export in `tools/srd/lib.mjs`. Hashes re-stamped;
  `items_content.test.ts` pins the values + drift.
  **SECOND TRANCHE DONE 2026-08-21 — 23 items in 2024, 12 in 2014**, again read off each edition's own
  shipped text. Named damage types fold (`resist_immune:resist:<type>` — Staff of Fire/Frost, Brooch of
  Shielding, Cloak of Arachnida, Periapt of Proof against Poison, Armor of Invulnerability's b/p/s);
  UNQUALIFIED advantage on a named roll folds (Sentinel Shield + Rod of Alertness →
  `advantage:initiative;advantage:skill.perception`, Cloak of the Bat → stealth, Quarterstaff of the
  Acrobat → acrobatics); the `+N` weapons fold through the D9 weapon path (Holy Avenger +3, Vorpal +3,
  Staff of the Magi +2 with `flat_bonus:spell_attack+2`, Berserker Axe +1 with `flat_bonus:hp_max+level`);
  Frost Brand's rider is the typed-damage form `flat_bonus:damage:cold+1d6`; Boots of Striding and
  Springing is `set_override:speed:30:floor`; the Robe of the Archmagi is a GUARDED expression set,
  `not is_wearing_armor ? set_override:ac:15+dex_mod` (a set_override is not limited to a literal — the
  test pins AC 15).
  **Edition divergences found in the shipped text, kept rather than smoothed:** 2014's Armor of
  Invulnerability resists "nonmagical damage", which is not a type the vocabulary can NAME, so it stays
  a note while 2024's b/p/s folds; 2014's Scarab of Protection has no +1 AC (that is a 2024 addition),
  so only 2024 folds one. **Content gap noticed, not fixed:** several 2014 rows ship with an EMPTY
  `text_en` (`vorpal_sword`, `rod_of_alertness`, `dragon_scale_mail`, `boots_of_striding_and_springing`,
  `talisman_of_pure_good`) and `frost_brand`/`brooch_of_shielding` are truncated mid-sentence — those
  editions were skipped rather than authored from memory (the no-invented-data rule).
  **New gate:** `items_content.test.ts` now runs EVERY shipped item token through a real `deriveSheet`
  and demands no `unknown target` issue — a known kind with a dead target parses fine and then folds
  onto nothing, which the "known kind" check alone never caught.
  **App-verified (first tranche):** demo Karroth's attuned Cloak now
  reads AC 14 → **15** with "Cloak of Protection +1" in the trace, and every save +1
  (`design-preview/magic-item-efx.png`). **REMAINING (the `[~]`):** the other ~240 magic items — mostly
  charges/activated procedures (RECHARGE-3), GM-chosen variants (Ring/Armor of Resistance),
  weapon-scoped bonuses (the open §A `damage:<qualifier>` gap) and the generic +1/+2/+3 rows that need
  one row per tier.
- [x] **DEMO-1 · Showcase demo character.** **Karroth the Red**, id `karroth` —
  Tiefling · Soldier · **Warlock 5 (Fiend) × Barbarian 3 (Berserker)**, SRD-only, derives clean
  against the real shipped SRD 5.2.1 graph. It seeds first-run on web AND desktop, so it IS the first
  impression of the system's scope — keep it deriving clean. `recreateDemoCharacter()` restores it;
  Settings ▸ Data has the button.
  **What this pairing does NOT exercise** (so nobody assumes the demo covers it): `casterLevel` is 0
  for the barbarian half, so pact-pool-alongside-shared-slot math is never hit; Unarmored Defense and
  the Eldritch Invocations are untokenized, both waiting on N2; and a base Warlock has **no Ritual
  Casting**, so the `R` badge cannot appear here without Book of Ancient Secrets — demo rituals on a
  Wizard/Cleric aspect instead, and with a REAL shipped SRD ritual, never a hand-authored one.
- [ ] **N2 · Class-feature engine ("features as data").** The three shapes above, in the order
  1→3→2. Wild Shape carved out as N2b: it is a stat-block REPLACEMENT, not one of the shapes.
  Superiority dice: extend the grammar —
  `grant_resource:superiority-dice:4:d8:short` (die BEFORE recharge —
  "what the resource is, then when it refills"; ResourceDef + `die`). The die segment is
  optional and shape-distinguishable (`d\d+` vs `short|long|other`), so existing 3-segment
  tokens (`grant_resource:rage:2:long`) keep parsing unchanged. Spending rolls the die into
  attacks via the existing `bonusDice` path. Extra Attack: `flat_bonus:attacks+N` →
  Attacks panel shows ×N. Prereq: the fold must gather these feature tokens; content-schema
  columns bump + converter updates.
  **The measurement that sizes shape 3, so it is not re-taken:** across all 428 shipped
  class-feature rows in both editions, only 21 carry any effect token and none encodes a numeric stat
  bonus. So Fighting Style · Metamagic · Eldritch Invocations · Weapon Mastery · Pact Boon · Divine
  Order · Primal Order · Epic Boon have no column a picker could read, and a panel for them today
  would be a lie — they are blocked on the `choice_group` / `choose_n` columns, not on UI.
  Same for the pools the prose describes and no `grant_resource` creates: Lay on Hands, Channel
  Divinity, Font of Magic, Wild Shape, Indomitable, Arcane Recovery, Mystic Arcanum, Stunning Strike.
  The Resources block discovers pools from the engine, so each appears the moment content encodes it;
  the ids that DO exist are `rage`, `bardic_inspiration`, `second_wind`, `action_surge`, `ki`,
  `focus`, `persistent_rage`, `uncanny_metabolism`. **These rows come through the converters**
  (`docs/internals/content.md` ▸ "Where the shipped data comes from") — a mechanic stated in SRD prose
  is still game data, and hand-authoring it from memory is the failure that passes every gate.
- [ ] **N2b · Wild Shape = stat-block replacement.** A druid has no working Wild Shape at all.
  Model: `play.form = {monsterRef, formHp} | null`; deriveSheet branches — physical
  scores/AC/attacks/speed from the (already-typed) monster row, mental stays own; an isolated
  removable seam like effects; the editions diverge (2024 = temp HP + a known-forms list).
  **The gate is a written per-edition spec sheet — from that edition's own SHIPPED SRD text**, never
  from memory and not from the PHB, which we have no licence to read into the app. Wild Shape is in
  both SRDs, so the text exists: HP pool vs temp HP, the CR/movement limits per level, what is kept
  vs replaced, revert-at-0 carryover, equipment, casting.
  **What actually blocks it is a converter bug, not a missing source.** The 2024 `druid_wild_shape`
  row ships COMPLETE (~2600 chars, Beast Shapes table and the Rules While Shape-Shifted section);
  the 2014 row stops at 502 chars, cut exactly where its table begins — and 2014's
  `class_features_srd.csv` carries **zero** `<table>` rows against 8 in 2024 — `convert-2014.mjs`
  drops embedded tables and truncates the prose at them. Fix that first; the 2014 spec sheet is
  unwritable until it lands, and other 2014 features are losing tables the same silent way.
  - [ ] **Wild Shape must be TRACKED before its event siblings work.** Evergreen Wild Shape (the
        `regain_on_initiative` auto sibling of Perfect Focus and Superior Inspiration) has no pool to
        restore, so it waits on the model above rather than on the mechanism, which is shipped.
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
  - [ ] **A shared provenance popover — repo-wide, not builder-only.** `ui.md` ▸ UX pattern contract
        rule 3 requires every auto-calculated value to explain itself on hover **or focus**; today
        provenance rides `title`, which is mouse-only, and making the tiles focusable does not help
        because no browser shows a `title` on keyboard focus. **The shape: a small affordance that
        appears on hover AND focus and is itself a button**, so the keyboard path exists without a
        new gesture. A modifier key is not available — a click on a spell or action row already
        means *roll*, `Ctrl` is the builder's undo chord, and `Alt`+click is the tray-damage path.
  - [ ] **Keyboard navigation past the double-Enter take.** The walk moves the highlight and takes,
        but does not reach the take toggle, the jump rail or the card's own controls without `Tab`.
        Roving tabindex inside the row; **the jump rail stays its own tab stop** rather than joining
        the arrow cycle, so the arrows keep meaning one thing.
- [~] **N4 · Skills system fixes.** (a) **DONE (2026-08-02):** `toggleExpertise` capped from data
  — a curated `expertise_slots` `level:count` column on class_features (ONE row carries the
  progressive grant: Rogue `1:2,6:2`, Bard `3:2,10:2` 2014 / `2:2,9:2` 2024, 2024 Ranger `9:2`;
  converter-preserved like `effects`). Build sums the active-feature grants → `expertiseCap`;
  Strict enforces (Free doesn't), UI shows `expertise N/M` + disables ×2 at cap. Wizard "Scholar"
  (1 restricted-list expertise) deliberately NOT encoded — the count model can't express the skill
  restriction, so encoding it would over-permit. Unit + real-content tests both editions. **UI not
  screenshot-verified in a Rogue state** (needs a build-flow drive). (b)+(c) are ONE grammar step: the L1
  vocab grows a proficiency LEVEL in the third segment — `grant_proficiency:skill.<id>:half` and
  `:expertise`, defaulting to `proficient` when absent, so every existing token keeps parsing. That
  makes Jack of All Trades a content row (the `half` type and `skillCheck(halfProficient)` already
  exist and nothing calls them) and lets the builder show an effect-granted skill as locked-on
  instead of silently proficient. The same third segment is what `TOOLS` reuses;
  (d) **DONE (2026-08-02):** the combat SkillsPanel already showed the proficient/expertise
  tiers (filled / ringed dot) with `why()` provenance on the row hover; added the 4th tier —
  a faded `half` dot (color-mix on `--color-resource`, scaffolding until a half-prof producer
  lands per (c)) — and a friendly per-tier tooltip on the dot. Combat baseline 0px (reachable
  tiers render identically; the `on` split is behaviour-identical for none/proficient/expertise).
- [ ] **N5 · Adjacent gaps (assistant's additions).** (1) **Features panel on the combat
  sheet** — a character can't READ their own features/traits anywhere; read-only prose list,
  cheapest big win, zero prereqs. (2) **DONE** — concentration check prompt on damage (CON save DC
  max(10, ⌊dmg/2⌋)) now toasts a reminder in `damage()` (see the CONCENTRATION entry). (3) Death saves + exhaustion UI (→ B2).
  (4) Ammunition as consumable — tracking OFF by default (a toggle
  that exists but is never enforced; ~99% of tables don't track ammo). (5) Short-rest
  hit-dice UI (→ UBUG-1/B2). (6) **DONE** — the builder pickers carry search, and the two big ones
  carry the level/category sections and the school/concentration/ritual facets that keep a long list
  navigable (the picker contract, `docs/internals/ui.md`). (7) Multiclass: combat preparedCap reads
  classes[0] only. (8) Sneak Attack "once per turn" — first per-turn-limit case; manual
  toggle first, automation later.
- [ ] **N6 · Currency — separate design, not an inventory row.** Support
  ONLY the base PHB coins (cp / sp / ep / gp / pp — 5 in the PHB; settings invent their own,
  those stay out of scope), with per-character HIDING of denominations the player doesn't
  use (electrum first candidate). An exchange-rate reference sits right next to the tracker
  (1 gp = 10 sp = 100 cp; 1 ep = 5 sp; 1 pp = 10 gp). Coin WEIGHT (50 coins = 1 lb) is
  optional and OFF by default — many tables don't track it; when on, folds into N1's
  capacity bar. Lives in play-state; no migration concerns pre-release (see N1 note).

### EXPR · L2 value-expression layer — BUILT (design → docs/internals/effects.md §3)

The bounded L2 formula layer (value expressions + condition guards, the type/resolution rules, the
worked examples, conditions/exhaustion-as-data) is **shipped** and its normative design lives in
[`effects.md`](internals/effects.md) §3–§4. Delivered across EXPR-1..5 + CONDITIONS-1 (2026-07-17/19):
parser+evaluator (`expression-parser.ts` / `expression-evaluator.ts`), value expressions in tokens,
condition guards + the ONE resolve stage (`resolveActiveEffects`, `dependency-graph.ts`), the
dependency-order DAG (ability scores fold through the pipeline — A10), the typed-facts output
(`collectFacts`), cantrip scaling, the roll-manip L1 tail (`reroll`/`min_die`, `d20_tests`,
`speed.fly/swim`, `spell_dc`/`spell_attack`, `save.death`), and all 15 standard conditions carrying
mechanical `effects` tokens in both editions. AUDIT SPEC2–SPEC7 (grammar / type / resolution
decisions) are recorded in effects.md §3; git holds the per-phase log.

### PLG · Plugin sandbox (L3 expressiveness) — BUILT (design → docs/internals/plugins.md)

The QuickJS-in-WASM plugin layer is **shipped** (PLG-1..3, 2026-07-19): the registry + native
handlers, the quickjs-emscripten (quickjs-NG sync) sandbox with the full PLG-SEC containment
(zero-capability context, 5 ms / 8 MB budgets, JSON-string boundary, length-prefixed SHA-256
consent hash stored OUTSIDE the dataDir, fail-closed counter, desktop-only), and the normative
[`plugins.md`](internals/plugins.md) (`api: 1`) — all in `src/lib/effects/plugin-*`. Plugin-token failures
surface via `deriveIssues` → content health. The design decisions, the PLG-SEC containment
checklist, the state model (three channels) and the authoritative derive stage-list are the
design-of-record in [`plugins.md`](internals/plugins.md) and [`effects.md`](internals/effects.md) §4/§6 (AUDIT
SPEC1 / SPEC8 / SPEC9 map there); git holds the per-phase log. Open tails: the dedicated
plugin-dependency notification view + portability / version awareness (fresh-eyes review #2).

---

## Backlog (post-spellcasting, prioritized) — carve down gradually

Flagged during the persistence/build/spellcasting work. Grouped; ~rough priority within each.

### Implementation order (current focus — WAVES)

The order the maintainer and Claude are actually working to. Wave = a coherent chunk, not a sprint;
the SEQUENCING REASONS matter more than the numbering and are given per wave, because most of them
were learned the hard way. Numbers are stable: a wave that closes leaves the list and the ones after
it do not renumber.

- **W0 / W1 — DONE.** REL-4 content packs, then the roll card. One consequence stays live: SRD
  content ships from `charnik-content-srd`, so the content passes (MAGIC-ITEM-EFX, E4, D6/D10) are
  not app-roadmap work at all.
- **W2 · the roller's remaining tails.** ROLLER-N and UBUG-21 are closed and
  `docs/internals/roller.md` is the design; what this wave owes is the open list under ROLLER-N — a
  token typed WITHOUT spaces (`2d6+3`) blocking the roll, `parseFormula → {terms, issues}`,
  provenance surviving `foldValues`, a volley's group identity, `RollSpec` as the request, and
  **amendments as STRUCTURE**.
  **That last one is why this wave precedes W3, not the other way round:** the roller writes an
  English sentence into `log.jsonl`, and prose already on disk cannot be localised afterwards.
  `UBUG-11` rides here and is no longer app work — the `attack:<weapon_id>[:<count>]` verb is built,
  and what remains is the `resource_options` rows still saying `note:`, a commit in the content repo.
- **W3 · ARCH-1 i18n sweep.** UX-1 cleared the copy prerequisite, W2 clears the other one. Damage
  types take catalog names in the same pass: the 13 SRD types are a closed rules vocabulary, while an
  invented homebrew type stays data and passes through.
- **W4 · the cheap surface wins, none of which depend on anything.** N5(1) the Features panel — a
  character cannot read their own traits anywhere — plus the shared provenance popover, the pact
  pool's own short-rest pips, the spell-picker preview, UPCAST-PREVIEW-TOOLTIP and SAVAGE-TAIL.
- **W5 · the a11y set, as ONE change.** A11Y-LISTBOX + N3's sectioned picker (`listbox` → a
  one-column `grid`) + keyboard navigation past the double-Enter take. It is the same ruling applied
  in four places; split up, it gets re-derived four times, and the picker's shape is already decided
  down to why `aria-activedescendant` names the gridcell.
- **W6 · "everything is doable from the UI", where it is not.** Edit and delete existing homebrew,
  the generic grid for spell and monster, the UI type-assign form, and authoring a `resource` /
  `resource_option` row at all. A shipped invariant currently unmet, not a feature.
- **W7 · N6 currency → RECHARGE-3 (item charges) → D16 choice-UI (→ `magic_initiate`) →
  SCOPED-BONUS.** Item charges want an inventory, which N1 built. SCOPED-BONUS is an L1 grammar
  change and a `docs/internals/compatibility.md` chokepoint, so it stays its own piece rather than
  riding another wave.
- **W8 · the content-shaped work**, once the app stops moving under it: TOOLS, CONDEFF's merge, N2's
  three shapes, then N2b — blocked on `convert-2014.mjs` dropping embedded tables — and the 2014
  casting counts. Each lands as a commit in `charnik-content-srd` with an assert in this repo.
- **Deliberately in no wave:** DISTRIBUTION-EXPANSION (its own session, blocked on accounts, not on code), ANY-HOST-PACKAGE-DISTRIBUTION
  (post-1.0), ONBOARD (its own design session, once the UI stops moving) and COMPANION (research
  first).

**Out of band — do these when next in the area, don't schedule them into a wave:** _(empty —
`UBUG-22` was the last one and is closed.)_

**From AUDIT-29-07 (retired 2026-08-04 — its Bugs/Smells/Naming were all closed + verified; git
holds the done-work log; these are the OPEN tails it carried):**
- [~] **ARCH-1 / B8 · i18n sweep of combat + build.** `build.*` is done (270 keys). `combat.*` now
  exists and covers the **page chrome**: the Controls toolbar, the Hero subline, Exhaustion, the turn
  bar, Pass time, every panel head, and the Inventory panel. The dead `sheet.*` group — eight keys
  nothing referenced, the same orphaning drift `settings.data.*` had — was folded into it.
  **What is deliberately NOT translated, and why it must stay that way until W2:** anything that
  becomes a **roll label**. `repository.ts ▸ logLineFor` writes `roll.label` verbatim into
  `log.jsonl`, and prose already on disk cannot be localised afterwards. Skill and ability NAMES are
  therefore still `titleCase(id)` everywhere, because the same string is both the row's display text
  and the label of the roll it fires — translating the display half alone would show a Ukrainian
  skill whose own roll toast says it in English. That is one change, after W2, across the combat
  sheet AND the builder, as one change.
  **The boundary is sharper than "chrome vs body", and it is what the rest of the sweep must
  respect:** a string is safe when nothing it names is ALSO a roll label. The Controls toolbar, the
  panel heads and the turn bar pass that test, which is why they are done. The stat tiles do NOT —
  `ARMOR CLASS` and `INITIATIVE` sit on buttons that roll `'AC (touch)'` and `'Initiative'`, so
  translating the tile alone puts a Ukrainian tile above an English toast. Same for the ability
  grid, the skills list and every panel body that rolls. All of that rides with W2, as one change.
  **Genuinely free of W2, and therefore next:** VM toasts (`get(_)` inside a function — a
  toast is fire-and-forget, so the one-shot store read is correct and needs no plumbing; never at
  module top level, where it would freeze at the load-time locale), and the section headers that
  name no roll (`Passive senses`, `Defenses`, `Resources`, `Pin skills`).
  UA copy uses formal «ви» (docs/internals/ui.md ▸ Accessibility).
  **A locale is not free of layout consequences:** the turn bar's container-query thresholds are the
  MAX over shipped locales (Ukrainian labels run ~15px wider than English), and `container-type`
  zeroes the min-content floor, so a too-narrow threshold clips rather than pushes. Re-measure per
  the recipe in `Turnbar.svelte` when a locale is added.
- [x] **UX-3 · retroactive advantage instead of a pre-roll gesture.** Roll, and if it turns out to
  have been advantaged, tap the d20 — RAW-exact and identical on mouse and finger, where
  `Alt/Ctrl-click` does not exist. Survey: `docs/research/roll-surfaces.md`.
- [ ] **ONBOARD · First-run onboarding — needs its own design session, and it comes LATE.** Not because
  it is unimportant: the UI is moving under it right now (the a11y picker rework, the features panel,
  the provenance popover), and onboarding written against a surface that is still changing has to be
  written twice. Schedule the session once the current UI wave settles; until then this item collects
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
- [ ] **CONDEFF · one content type for conditions and effects.** From the roller: "I can't add
  Poisoned to an attack roll". Poisoned IS disadvantage on the attack the same
  way Bless is +1d4 on it; that they are two content TYPES is an authoring accident the player is
  made to know about. **Already merged, and staying that way:** play-state has ONE list
  (`play.effects`, an "effect/condition instance"), everything runtime folds at the **`condition`
  LAYER** — which is stacking algebra and survives the merge untouched — and both schemas are
  `baseRow` + the same `effects` token column.
  **What actually differs:** three columns (`max_level` on conditions, `duration_rounds` on effects,
  and `negative`), plus two UIs (a binary multi-select vs the "+" catalog with a duration), plus the
  `apply_condition:<id>` indirection between an applied instance and what it does.
  **`negative` is DELETED, not merged.** Its default is inverted between the two types, so merging it
  means picking whose default wins for every row of the other — a question with no right answer.
  Replace it with `valence`, an open enum (`harmful` | `helpful` | `neutral`) with no default:
  blank reads `neutral`, the converters state it per row, and the inversion stops existing. It also
  says more than the boolean did — Bless and a cover bonus were both "not negative", which is not the
  same fact as Poisoned being harmful.
  **Size, measured not guessed:** the merged schema is the union of those columns behind a `kind`
  open enum (AGENTS.md ▸ Taste (open enums, never booleans)); `~10` call sites of `graph.list('condition', …)`
  (derive-gather, derive, resolver, effects-editor ×4, roller-sources); character JSON is untouched
  (refs are `source:id`, and `apply_condition` keeps resolving — an id lookup inside one type instead
  of the other); the content repo needs a `#content-type` change on `conditions_*.csv` + a re-stamp,
  no row rewriting, since the loader already merges any number of CSVs into one type. So: a day, and
  the risk sits in the content-repo diff, not in the engine.
  **Unblocked meanwhile:** the roller's vocabulary lists BOTH types, so Poisoned is typeable into a
  roll today; the merge is what stops the next surface from having to remember to.
  **On disk this stays a header change.** The loader folds any number of CSVs into one type, so the
  files keep their names and their rows — `conditions_*.csv` declares the merged `#content-type`,
  gets its `valence`, and is re-stamped. No row is rewritten and no id moves.
- [x] **B25 / RV4 · Subclass-caster spell list.** The seam is DATA, not a class-name branch: a
  `spell_list` column on the `subclass` row naming the class lists it draws from (RAW an EK/AT casts
  off the WIZARD list, which cannot be inferred from `class_id`). A blank column keeps a subclass out
  of the index — never silently given a list. EK/AT are PHB, not SRD, so coverage lives in fixtures.
- [ ] **D16 · generalized player-choice model.** Half-feat ability-choice and Skilled's skill grants
  are DONE, at a level's slot AND under the background's granted origin feat — both ask through the
  same `FeatSubChoices` block, keyed by a slot key or by `ORIGIN_SLOT_KEY`. Still open: Magic Initiate
  spell picks (the `magic_initiate` feat's spell-learning half). One "player choice at a slot"
  abstraction covers all. Skilled's TOOL half moved out to `TOOLS`, which is a model, not a choice.
- [ ] **TOOLS · a tool proficiency, and that is the whole mechanic.** Tools already exist as things:
  `tool` is an `ITEM_CATEGORIES` member, so they sit in the inventory today. What is missing is being
  PROFICIENT with one — a build field, a grant reusing N4's third segment
  (`grant_proficiency:tool.<id>`), and a check that adds the proficiency bonus. Nothing else: no
  crafting, no downtime, no tool-specific rules.
  **The one edition divergence:** 2014 leaves the ability for a tool check to the GM, 2024 pairs an
  ability with each tool. So the ability comes from a column where that edition's SRD states one, and
  from the player at roll time where it does not — never guessed.
  Unblocks Skilled's tool half in D16.
- [ ] **D6 / D10 / E4 · mechanics from prose → columns.** `effectHint`/`healDice`/`durationToRounds`/
  `castingIcon` hardcode spell names EN-only; most SRD spells still ship EMPTY `effects` columns (E4)
  so there are no tokens to summarize. Tracked live under UBUG-9 (the caption idea) — E4 is its blocker.
- [x] **UBUG-23 · a stacked toast was resized to the front toast's height.** `svelte-sonner` forces
  `height: var(--front-toast-height)` on collapsed background toasts and makes it harmless by fading
  their content — but only for `data-styled='true'`, which a custom-component toast is not. The
  fix extends the library's own content-fade to the unstyled toasts it skips.
- [x] **UBUG-22 · `rollFormula` dropped a flat modifier that was not at the end of the formula.**
  `1d6+3+1d4` totalled 10, not 13 — reachable from content and from the plugin API. One shared
  `DICE_TERM` regex plus `parseFlatModifier`; `roller.md` ▸ Conventions carries the rule about what
  an unsigned number means.
- [x] **UBUG-21 · the dice tray edited the to-hit while claiming to be the attack.** Damage is the
  second LINE now, made of the same editable pills, so a `+1d6` typed for a rider lands on the
  damage. Closed with ROLLER-N — same seam, pointless to build twice.
- [x] **ROLLER-N · one roller that fires N independent sub-rolls.** One action fires N instances of
  two-level lines, each logged on its own line and toasted as one card; crits landed with it. The
  roller answers with structured dice instead of a formatted string, advantage is a mode over
  recorded dice, and the persisted record is the in-session record. **The design, the rejected
  alternatives and the conventions are `docs/internals/roller.md`**; only what is still open lives
  here:
  - [ ] **`{roll, issues}` — a formula the parser could not fully account for must SURFACE.** Today
        an unrecognised fragment is ignored and the understood part rolls, which is the same failure
        class as UBUG-22 and worse in one place: `plugins.md` makes the formula string the plugin
        API, so a sandboxed plugin miscomputes and cannot tell. **Shape: a `parseFormula(str) →
        {terms, issues}`, with `rollFormula` staying sugar over it** — a smaller diff than changing
        every call site's return type, and the sites that do not want issues do not change. Inside
        the roller the existing "an arithmetic-looking fragment blocks the roll" behaviour is the
        surfacing; for a formula that came from CONTENT or a plugin it is a `deriveIssue`, because
        that is a data defect and must be visible outside the moment of the roll.
  - [ ] **Amendments are STRUCTURE, not a sentence.** `amendedNote` composes English prose that a
        reader then has to match back out; one regex for it has already eaten an upcast's provenance
        and grown the note a lap. Want `amendments: [{kind, from, to}]`. **This gates W3**: prose
        already written into `log.jsonl` cannot be localised afterwards, so the facts have to land
        before the i18n sweep has anything to work with.
  - [ ] **`foldValues` is where provenance dies — one seam, four losses.** The organ KNOWS where every
        contribution came from and throws it away one step before the roll, so this is not a missing
        feature but a lossy narrowing to the four shapes `rollPool` happens to accept
        (`dice`, `mod`, `bonusDice`, `mods`). Fix it at the seam, not at the call sites:
    - **A die's source.** `DicePill.source` is read at `roller.ts` only to CLASSIFY the die as a
      bonus die, then dropped: `bonusDice.push({sides, count, sign})`. `RolledDie.source` is declared,
      `StoredRoll` already persists it, and no path ever fills it — the record has the slot and the
      fold empties it. So a Bless d4 and a weapon d4 are one thing on the sheet, in the toast and on
      disk.
    - **A flat modifier's source.** `FlatPill.source` is never read at all — `mod += p.amount`. "+2
      from Bless" and "+2 someone typed" are indistinguishable the instant Roll is pressed, and unlike
      a die there is not even a role to tell them apart afterwards.
    - **The player's own label.** A `note` pill ("1d4 dm's luck") is walked past by the fold and never
      reaches the roll. Its own comment claimed the log keeps it; corrected in the same change as this
      entry.
    - **Per-die bounds**, deliberately: `min`/`max`/`reroll` fold to the LINE's `DieMods`, so two dice
      in one line with different floors share the most generous. Marked `ponytail:` in place, no 5e
      mechanic writes it, and `rollPool` would need per-die mods to fix it. Left alone knowingly.
    **Shape:** the fold keeps a contribution's identity instead of flattening it, and `rollPool` takes
    dice that carry their own `source`. That is the house provenance contract — `{source, op, amount}`
    — applied to the one computation still answering without it. A side map keyed by die would be a
    second source of truth for the same fact; do not.
  - [ ] **A volley stops being a volley the moment it is rolled.** `RollerOrgan.roll()` returns N
        entries that differ only by `at + i`, and `RollLogEntry` has no field saying they were one
        action. So "one action fires N instances" — the thing ROLLER-N exists to model — is the one
        fact the record does not keep: after a reload, three Eldritch Blast beams are three unrelated
        lines, and nothing can total them or show them as one card again. Wants a group identity on
        the entry, **a GUID rather than a counter** (AGENTS.md ▸ Taste), since it is shared between
        lines that are written independently.
  - [ ] **The roller takes `RollSpec` itself** — one request carrying the label, the type and the
        damage parts, not just the dice. Half of this shipped (`rollPool(dice, RollPoolOptions)`
        killed the positional `−1 | 0 | +1`); the rest waited for the result to be facts, which it
        now is.
  - [ ] **A token typed WITHOUT spaces parses as one raw fragment and blocks the roll** (`2d6+3`).
        The parser splits on whitespace only, and no-spaces is what a person types.
  - [ ] **Damage types have no localized names anywhere in the data**, so they match and display in
        English. Rides the same boundary as ARCH-1: the 13 SRD types are a closed rules vocabulary
        and take catalog keys, an invented homebrew type is data and passes through.
  - [ ] **Deliberately unbuilt, with the reason:** Elven Accuracy (now merely a third element in
        `d20s`, not a modelling question), a per-instance target, and a per-instance advantage — a
        volley rolls the same set N times, which is what the two-level model decided a volley IS.
- [x] **RES-NAME · a resource pool has a NAME of its own.** `ResourceDef.name` was `titleCase(id)`,
  which is wrong for exactly the pools that matter (2024 `focus` is "Focus Points", 2014 `ki` is "Ki
  Points") and could never be translated. A `resource` content type carries it; `resource-names.ts`
  resolves id→name once per derive so pools and their spend-options cannot disagree; the engine
  keeps `titleCase` as the fallback, so a name is something content ADDS. **The name never belonged
  to the grant** — `bardic_inspiration` is granted by two features — so it is not a token segment
  and not a column on the granting feature. Translation reaches it because the Translate view asks
  `hasProse(type)`, not `isBrowsable`.
- [ ] **RECHARGE-3 · item charges, and the `{trigger, amount}` recharge they earn.** The two axes the
  `recharge` enum cannot express and that a rest policy should not be bent into. Nothing tracks item
  charges as a resource today — no column, no consumer — which is exactly why the generic model waits
  for this rather than being pre-built; the reasoning is `docs/internals/effects.md` ▸ Recharge-model
  roadmap, axis 2. N1's inventory, which it needs, is built (W7).
  - [ ] **Item-charge data:** a `charges` (max) + `recharge` spec on the item schema; an owned or
        attuned charged item GRANTS an ordinary resource pool, reusing `grant_resource` and the whole
        resource subsystem rather than inventing a parallel counter.
  - [ ] **Generalize recharge → `{trigger, amount}`:** trigger ∈ `short|long|dawn|dusk`, amount ∈
        `all|<N>|<formula>`, with the existing `short`/`long`/`short_one`/`consumable` members
        becoming sugar over it so nothing on disk breaks. A formula amount resolves through the L2
        evaluator at rest/dawn time.
  - [ ] **Wire `dawn`/`dusk`** to the out-of-combat "pass time" control (`advanceTime`) — a day
        boundary fires the dawn recharge.
  - [ ] **A shipped SRD charged item or two as the first consumer**, converter-sourced.
- [ ] **RECHARGE-TAIL · the damage-path and rest mechanics left over from the recharge work.** Each is
  small, each fires on an existing path, and none blocks the others.
  - [ ] **Champion Heroic Rally — a turn-start heal.** It is the SECOND declarative event-action after
        `regain_on_initiative`, which is the condition `effects.md` ▸ Recharge-model roadmap set for
        generalizing the trigger dimension. **So generalize it now** (`on_event:<event>:<action>` over
        a bounded event set × the bounded action verbs) rather than adding a third narrow token and
        waiting again. Arbitrary event LOGIC stays L3 plugin `onEvent` — widening L1 past a bounded
        vocabulary is a security property, not a style choice.
  - [ ] **Concentration: several saves for one lump of EQUAL projectiles** (Magic Missile, Scorching
        Ray) — a segmented `1 · 2 · 3` control choosing HOW MANY saves, all at the same flat DC 10,
        never dividing the entered damage. Different SOURCES already work with no new UI: they are
        separate Damage presses, each raising its own save. Prototype:
        `design-preview/concentration-split-button.html`. **Weigh killing this instead of building
        it**: 2024 dropped the per-source sentence, and even under 2014 the player can press Damage
        three times.
  - [ ] **Massive Damage / System Shock** — ≥ half max HP in one instance → DC 15 CON → the System
        Shock table. **DMG-optional, NOT SRD**, so it can only ever ship as a toggle beside
        encumbrance, never as core rows or shipped data. Opening it means opening the category
        "optional DMG rules", which is the actual decision. (SRD overkill instant death is separate
        and already built.)
  - [ ] **2014 long rest recovers HALF your Hit Dice and the app picks them largest-first**; RAW lets
        the player choose which. Visible on a multiclass d12+d6 pool. A picker if anyone asks — 2024
        recovers all and is unaffected.
  - [ ] **Highlight a conditional ability the moment its window opens.** `ActionsPanel` greys an
        unavailable option and gives it a `title`, which is the "never hidden" half; the "highlighted
        with a notice when it opens" half is the reason a player notices Persistent Rage at all, and
        it does not exist. `characters.md` ▸ "A tracker surfaces, it never decides" is the contract.
        While in there: that `title` is a hardcoded English `'Not available right now'`, which
        `ui.md` ▸ "Strings live in the catalogs" forbids.
- [ ] **SCOPED-BONUS · a bonus that applies to ONE thing, not everything.** L1 can say `flat_bonus:damage+n` but not "…only for this weapon / only for
  this spell / only on this instance", so: **Magic Weapon** buffs ALL the caster's weapons (and leaks
  into spell rolls), and **Agonizing Blast** (+CHA per beam) / **Eldritch Spear** can't be expressed at
  all. Both need the same thing — a scope key on the bonus. `attacks.ts` §A/§B already scopes by weapon
  CATEGORY; the extension is a general scope (`weapon_id` / `spell_id` / per-instance), NOT a feat
  enumeration — every invocation is then just "a scoped effect on a spell". **This is an L1 grammar
  change and a `docs/internals/compatibility.md` chokepoint** (effect-token grammar), and it is
  SETTLED: the scope goes in the TARGET namespace — `flat_bonus:damage.melee+2`,
  `damage.<weapon_id>`, `damage.<spell_id>`. `compatibility.md` §4 says so too, in the same change
  that builds this. Independent of ROLLER-N (each ships without the other), but the per-beam case
  only becomes visible once N beams actually roll. Also the mechanical half of DEMO-1 gap 4 / N2
  invocations.
  **Two constraints the grammar decision must respect, and one shape that satisfies both.**
  (1) The qualifier slot is ALREADY spoken for and routes by TARGET: `parseQualifier`
  (`effects/token-parser.ts`) reads `flat_bonus:attack:<q>` as a weapon scope and any other target's
  `:<q>` as a damage TYPE — so Dueling written the obvious way, `flat_bonus:damage:melee+2`, parses
  `melee` as a damage type and folds silently wrong. (`min_die` gets away with a scope there only
  because its trailing integer anchors the end; a signed value cannot.) (2)
  `docs/internals/compatibility.md` §4 **reserves the 4th token segment for a bonus TYPE** (family B
  stacks by type, not by layer), so spending it on a 5e-only scope is exactly the foot-gun that doc
  exists to prevent. ⇒ **Put the scope in the TARGET namespace, where dotted sub-targets already
  live** (`speed.fly`, `save.str`, `skill.<id>`, `passive.<skill>`): `flat_bonus:damage.melee+2`.
  It consumes no new segment, keeps the weapon-category vocabulary out of L1 (the target is validated
  downstream as it already is), and scales to what this item actually wants —
  `damage.<weapon_id>` / `damage.<spell_id>` — because a namespace is not an enum.
  Rage's broad damage fold plus a note is the live consequence: RAW-faithful STR-melee scoping waits
  on this.
- [ ] **B11 · size-cap on `Storage.read()` — LOCAL reads only, which is why it stays YAGNI.** The
  path that mattered is already capped, by REL-4: `MAX_REMOTE_BYTES` (8 MB, one response),
  `MAX_PACK_FILES` (200) + `MAX_PACK_BYTES` (50 MB) read off the tree listing before a byte is
  fetched, and a whole-run `MAX_PREFETCH_BYTES` budget (`content/remote/types.ts`). What B11 would
  add on top is `size` on `FileEntry` (still absent, `storage/types.ts`) plus a cap in every storage
  impl — guarding a file the USER put in their own dataDir, which is not a trust boundary and is
  precisely where a cap rejects legitimately-large homebrew. Recorded, not queued.
- [x] **B24 · granular per-file watcher reparse — measured, then answered the cheap way.** A full
  reload of both shipped packs is ~90 ms for 2866 rows, so incremental parsing is a **won't-do**:
  it would rebuild `articles`, `byEffectiveId`, locale discovery and `resolveRefs` incrementally,
  every one of which spans files. What was genuinely wrong is fixed — the watcher filters on
  `isPackFile`, the same predicate that decides what a pack ships, so an editor's temp files no
  longer cost a full rebuild and the watcher cannot disagree with the pack differ.
- **A17 ritual/pact residual** — pact-slot pips + upcast picker SHIPPED (see UBUG-6). Residual is only
  the pure-warlock slot-gating nuance + ritual-source (`L13` in the hazards above). Minor.
- **Won't-do (recorded so they aren't re-audited as bugs):** **CONCENTRATION-SPLIT** — a segmented
  `1 · 2 · 3` beside Damage, to raise several DC 10 saves for one lump of equal projectiles (Magic
  Missile). 2024 dropped the per-source sentence, under 2014 the player presses Damage once per dart
  and gets the same saves, and how a table reads "one source" is a table's call, not the app's;
  **MASSIVE-DAMAGE / System Shock** — the ≥ half-max-HP → DC 15 CON → System Shock table rule is
  **DMG, not SRD, so no CC-BY text for it exists**. Authoring it from memory is exactly the failure
  that passes every gate. If it ever ships it is content someone else authors into a pack, and what
  we might add is the general ability to install such optional-rule content — never the rule itself;
  **ARCH-4** the `padding`/`margin`/`gap` px → `--space-*` sweep — measured at 186 declarations, of
  which 2px (61) and 1px (24) are hairline nudges no spacing scale should own, and the rest cluster
  where the scale simply has no step (13–15, 17–22). The reason to hold the line was themeability, and
  themes are colours-only, so an off-scale `14px` breaks nothing for anyone; **D19** exhaustion
  `max 6` stays a RAW
  constant (identical both editions — not a data-driven win, YAGNI); **SMELL-2** `deriveHealth` is
  single-open + `characterName` is a display-only label — keying it by `c.id` is dead flexibility;
  loose `z.record` play-state keys stay un-branded (see `docs/internals/characters.md` ▸ Play-state modelling);
  **`two_weapon_fighting`** stays text — `computeAttacks` adds the ability mod to every weapon's
  damage, so the off-hand penalty the style REMOVES was never modelled and there is nothing to
  encode; **2014 `grappler`** stays text — it is relational ("advantage against a creature grappled
  by you") and the app has no target model.
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
- [ ] **COMPANION · no data model exists for a bound creature** — a familiar, a steed, a beast
  companion, a summon. Not a missing panel: there is nothing in the character schema for a creature
  that belongs to a character, so a Ranger's companion and a Wizard's familiar are today entirely
  outside the app. Adjacent to N2b's Wild Shape (`play.form`), which replaces the character's own
  statblock rather than adding a second creature beside it — related shapes, different problems.
  **This one starts as RESEARCH, and the research owes four answers:** (1) where a companion lives on
  screen — its own sheet, or a panel on the owner's; (2) whose turn it acts on, which the editions
  disagree about (a 2024 Beast Master's companion spends the OWNER's action, a familiar spends
  nothing); (3) whether the owner's effects fold onto it at all; (4) where it sits in the character
  file. **One constraint is already fixed:** a companion's stats start from a `monster` row but are
  the player's to EDIT — every score, HP and attack stays writable, because a bound creature drifts
  from its statblock the moment a table plays it. So the model is an editable overlay over a monster
  ref, never a read-only pointer at one.
- [ ] **A11Y-LISTBOX · three more listboxes claiming something they are not.** Found by the same rule
  that condemned the sectioned picker, so they belong in that change rather than in three visits.
  `SectionedPicker` and `OptionGrid` set `aria-selected` per row independently while declaring a
  listbox with **no `aria-multiselectable`** — a single-select list reporting twenty selected options.
  `LanguagesPane` already gets this right, so the house has one name for the fact and two of three
  call sites ignore it. Worse, **`LanguagePicker` is a `role="listbox"` containing an `<input>`,
  section headers and bare `<button>`s with no `role="option"` anywhere** — a listbox with zero
  options. `CommandPalette` is the one place the combobox/listbox pair IS correct (single-select,
  selection follows the highlight, transient popup); `ui.md` should say why it differs.
- [ ] **SAVAGE-TAIL · two known limits of the `damage_reroll` offer.** It rerolls the WHOLE primary
  damage part, so a Bless die riding that part is rerolled with the weapon dice — arguably "use
  either roll", but not what the feat says. And the offer rides the INSTANT attack tap only: the
  `Alt`+click tray path rolls damage later and gets no offer there. Both are small and neither is a
  wrong number.

**User-reported bugs (2026-07-05, desktop test — verify + fix):**
- [x] **UBUG-1 · Short rest heals via Hit Dice** — `1d<die> + CON`, min 1 HP, player picks how
  many. Long-rest HD recovery is edition-divergent (2014 half, 2024 all).
- [x] **UBUG-2 · An attack/spell shows its to-hit roll**, combined with its damage in one entry.
- [x] **UBUG-3 · The dropped adv/disadv die shows on every roll surface.**
- [x] **UBUG-5 · Every resource change is announced** — spend and restore both toast.
- [x] **UBUG-6 · Casting spends a slot.** Lowest available leveled slot, blocked with a toast when
  none remain, in and out of combat; cantrips spend nothing and a RITUAL cast spends none (gated on
  the class's ritual-casting eligibility). Warlock pact slots are their own pool + pip strip.
- [x] **UPCAST · Structured spell-upcasting engine — DONE (was `docs/UPCAST-PLAN.md`).** One
  `upcast` column on `spells.csv`, `kind:formula` tokens parsed by the existing effect grammar.
  **Locked decisions, kept because later work could undo them by accident:** (1) combining is a
  DELTA for structured kinds (`base+delta`, base is the single source) and ABSOLUTE for
  count/duration; `inf` only ever appears in `duration`, so `base+inf` cannot happen by construction.
  (2) `cantripDieMultiplier` (the 5/11/17 tier) is NOT folded into `upcast` — the cantrip tier is a
  uniform system rule keyed on character level, `upcast` is per-spell data keyed on slot; merging
  them would be a regression dressed as a dedup. (3) Upcast is NOT gated on the auto-calc toggle:
  that toggle gates effect-MODIFIER layers, not a spell's own mechanic. (4) Conjure* tables and
  meta-rules (Dispel Magic, Globe) stay prose `higher_level` — a permanent exclusion, not a gap.
  **Open tails that had no other home:**
  - [ ] **UPCAST-AUTHORING (was N8) · guided upcast-token builder** in `EditContentForm` (form → token),
    so a non-technical author never hand-writes `per_slot(1d6)` (CLAUDE.md "everything from the UI"). v1
    ships a raw `upcast` text field (like the effect-token field); prose `higher_level` stays the fallback.
    **The form WRITES the token; it does not rename anything.** What lands in the CSV is the same
    `upcast` string an author could type by hand, so the file and the UI never hold two names for one
    fact — the fields are input widgets over the grammar, labelled from the catalogs like every other
    label. Build them off the same `kindOf`/`optionsOf` the homebrew form already derives from the
    schema, so the widget cannot offer what the grammar rejects. v1 covers `per_slot`, `count` and
    `duration`; anything else stays the raw field.
  - [ ] **UPCAST-DURATION-TAIL · Geas/Dominate multi-day durations.** Expressible via `duration:step`, but
    low value in the rounds canon (30 days = 432000 rounds) — a curated follow-up, not a blocker.
  - [ ] **UPCAST-PREVIEW-TOOLTIP · pre-cast per-slot preview** ("5th: 10d6, 6th: 12d6") before choosing a
    slot. v1 ships the picker + an on-select `castPreview` only; a hover tooltip over the whole ladder is
    the nicety left.
- [x] **CONCENTRATION · timer + end-points.** The model — a ref plus a carrier effect — is
  `docs/internals/characters.md` ▸ Concentration is a REF, not a clock. The CON save on damage is a
  toast REMINDER, never an auto-drop. Duration canon is rounds.
- [x] **UBUG-7 · Effect (i) rules text renders as Markdown**, not raw.
- [x] **UBUG-8 · Resources are used like spells** — the name is a "use one" button, the pips stay
  for manual restore. Action economy is deliberately not wired here (resources carry no action-cost
  data); see UBUG-16 for where that landed.
- **UBUG-9 · Spell-block summary caption is weak for non-damage spells (think about).** The bold
  caption per spell row (`SpRow.spe` = `dmg || effectHint(row.data)`) is great for damage (`1d10 fire`)
  but for the rest it's mostly a flat "utility" — except a few HAND-CURATED cases (`effectHint`
  hardcodes `mage hand`→"utility", a self-range teleport→"teleport" so Misty Step reads well, etc.).
  Goal: that descriptive style EVERYWHERE (Misty Step "teleport", Mage Armor "set AC 13", Bless
  "+1d4 attacks & saves"…), not a generic "utility". This is AUDIT **D6** (`effectHint` hardcodes
  spell names, EN-only, against the data-driven grain). **Idea to explore:** derive the caption from
  the spell's EFFECT TOKENS via the existing engine (parse `flat_bonus`/`set_override`/`apply_condition`/
  `speed`… into a short human phrase) instead of a hardcoded name list — the engine already parses these
  into typed facts, so a `factsToSummary(facts)` could render "set AC 13" / "+1d4 saves" / "teleport"
  data-drivenly + localized. Blocked partly by **E4** (most SRD spells still ship EMPTY `effects`
  columns — no tokens to summarize yet); until encoded, a per-spell content `summary_*` column is the
  fallback. Cross-ref D6 + E4.
- [ ] **UBUG-11 · Class-granted actions must DO their mechanical effect, not just toast a note
  (reported 2026-08-05, tested on a Monk).** A Monk's Flurry of Blows only toasts "Make two Unarmed
  Strikes" — its `resource_options.action` is a `note:`, so nothing rolls. That's meaningless when the
  app can roll attacks. The N2 executor (`runActionToken`) resolves heal/roll/apply_effect/apply_condition/
  gain_action/rest, but a "make N attacks" action degrades to text. **Rework how class actions resolve:**
  let an action fire ATTACK sub-rolls (to-hit + damage) through the existing `attackRoll` path — Flurry =
  2× Unarmed Strike, and the general case for any "make an attack" ability. Ties into actions.md (the
  `rolls` intent field) + the roller. The whole "action from a class
  feature" model is the target, not just Flurry.
  **Split 2026-08-09:** the "fire N sub-rolls" half is `ROLLER-N` (a general roller, also what a
  `count`-scaling cantrip needs — re-reported the same day on a Warlock: Eldritch Blast at level 5 just
  toasts "2×: make 2 separate rolls at this level"). **What stays UBUG-11** is the action half: the
  `rolls` intent in actions.md that lets a class feature CALL that roller with the right weapon, instead
  of degrading to `note:` text. Don't build a Flurry-shaped roller here.
  **The APP half is built:** `attack:<weapon id>[:<count>]` is an executor verb (docs/internals/actions.md
  §2), firing the ordinary attack path so a strike inside an action carries exactly what a tap on the
  Attacks panel does, and charging no turn slot of its own. The weapon is named by bare content id, so
  `Attack` grew an `id` (its display name never was an identity). **What is left is CONTENT, in
  `charnik-content-srd`:** the `resource_options` rows that still say `note:` — Flurry of Blows becomes
  `attack:unarmed_strike:2` — hand-edited in both editions and `pnpm restamp`ed, never re-converted.
- [x] **UBUG-12 · roll feedback is hard to read.** The toast became a component, then UBUG-20 made
  that component the one renderer for all four roll surfaces. Both rules it left live in `roller.md`.
- [x] **UBUG-13 · Level-up re-offered an ASI and double-applied it.** Root cause worth remembering:
  only the FLATTENED `abilityBoosts`/`feats` were persisted, never the per-slot mapping, so a
  restored slot could re-derive its boost a second time.
- [x] **UBUG-14 · A long rest clears one level of Exhaustion.** SRD-verified; the 2024 text's "has
  also ingested some food and drink" applies unconditionally because rations are not modelled.
- [x] **UBUG-15 · Death is modelled, and there is a dead screen.** One typed `play.death: {cause}`
  (an OPEN cause enum, not a `dead` boolean) and ONE `die(cause)` seam every lethal rule lands on.
  The two SRD interpretations behind it live at that seam in code (`combat-view-model.svelte.ts`): instant death
  runs the 5.1 text in BOTH editions because 5.2.1 omits the chapter carrying it, and revive drops
  one exhaustion level in 2014 too, where RAW is silent, since reviving onto a lethal 6 would kill
  you again on the spot. The dead screen is deliberately **not dismissible by backdrop or Escape** —
  a roster link is the other way out, so a dead character cannot lock the player out.
  - [ ] **RAW tail: damage taken at 0 HP adds a death-save FAILURE** (two if the hit was a crit).
    Everything else about dying is modelled — `deathSave()` runs nat 20 → 1 HP, nat 1 → two failures,
    three successes → stable, three failures → `die()`, and `damage()` already resolves instant
    death — but `damage()` never touches `play.deathSaves.failures`, so a downed character can be hit
    all day for free. **Crit-ness comes from a `critical` checkbox** that appears beside the damage
    input only at 0 HP, default off: the Damage button has no attack behind it to read crit-ness
    from, and asking in one checkbox beats inferring wrong. Surfacing, not deciding — the failure is
    applied because RAW is unconditional here, and the count stays hand-editable as it is today.
- [x] **UBUG-16 · abilities cost their action or bonus action.** What a resource chip does with
  one spend option versus several is `docs/internals/actions.md` ▸ §2. `gain_action` raises the
  per-turn MAX (`play.turn.grantedActions`) rather than refunding a spent action — play-state on
  purpose, because `slotMax` only folds effect facts when auto-calc is on and a feature the player
  activated by hand must not silently do nothing.
- [x] **UBUG-17 · Action/Bonus/Reaction pips look interactive, and all of them are** — every pill
  in that bar signals it the same way (hover + pointer + the global focus ring).
- [x] **UBUG-18 · Abilities block used a different background** than the panels around it.
- [x] **UBUG-19 · Icons are DRAWN, never typed.** `Icon.svelte` over Lucide; the rule, its three
  failure modes and what stays text are `docs/internals/ui.md` ▸ Icons are drawn, never typed. One
  consequence to keep: a locale catalog no longer carries UI iconography, so a translator cannot
  break an icon.
- [x] **UBUG-20 · one roll card everywhere, and its live controls.** One `RollRow` mounted by the
  toast, the Playbar, the roll log and the dice tray; the d20 pill cycles advantage after the fact
  and the damage pill rerolls. The constraints later work must not undo are stated at their own
  seams in code (controls never in the toast; the reroll affordance is the PILL; `onAdvantage` takes
  no attack index).
  **Open tails:** an inert ↻ marker on the toast pill, and the toast has no labelled close control —
  an a11y nit, since the card itself IS the dismiss button today.
- [x] **UBUG-10 · Spellbook "show on sheet" (eye) did nothing.** Fixed end-to-end via a persisted
  `ui.spellsHidden`; pins likewise persist in `ui.spellsPinned` (D3), no demo hardcode.
- [x] **REL-3 · Desktop content re-seed on update.** A `CONTENT_SEED_VERSION` marker re-seeds
  shipped files on update, preserving any the user hand-edited (hash drift). The "bump it whenever
  shipped SRD data changes" rule lives on the constant itself (`schema/version.ts`).
- [x] **REL-4 · Content packs from a URL.** Paste a repo URL, install its packs, update them without
  an app build — and the shipped SRD is one of those packs, which is what took rules data out of the
  release cycle. Design of record: `docs/internals/packs.md`, with `plugins.md` for the plugins that
  ride along and `security.md` §5/§7 for the network and consent boundaries. Code comments name
  slices; git holds what each one did.
- [x] **REL-1 · Linux release build** — `release.yml` matrix (ubuntu + windows, `max-parallel: 1`
  so the legs merge into one release). AppImage is the auto-updatable target, `.deb` a plain
  installer; rpm omitted (no `rpmbuild` on the runners), macOS deferred on notarization.
- [x] **A11Y-1 · Dialog focus management.** `trapFocus` on every dialog. **Deliberately NOT
  trapped:** `CommandPalette` (it restores focus itself — a second restorer fights it) and the
  combat popovers, which are anchored menus rather than modals.
- [ ] **DISTRIBUTION-EXPANSION · ship through the platform package managers**, beyond GitHub
  Releases, so users install and update the native way. Target set:
  - **AUR** (Arch) — a `charnik-bin` PKGBUILD pulling the Release AppImage; `git push` to
    `aur.archlinux.org`, no review, cheapest channel.
  - **Flathub** (Linux) — Flatpak manifest; widest cross-distro reach, one channel for all Linux.
    Note the **sandbox**: Charnik reads/writes arbitrary content dataDirs, so wire XDG **portals** /
    `--filesystem` perms or the data-move + custom roots break.
  - **AppImage** (Linux) — built + PUBLISHED by `release.yml` (REL-1 done); the portable, zero-install,
    self-updating target. `tauri.linux.conf.json` also emits a `.deb` alongside it.
  - **WinGet** (Windows) — YAML manifest PR to `winget-pkgs`; standard Win10/11 channel.
  - **Chocolatey** (Windows) — nuspec package; broader/older Win audience.
  - **Homebrew Cask** (macOS) — **out of scope for now**: no macOS build host to compile on, so no
    artifact to ship. Revisit if a mac runner/notarization appears (blocked on same as REL-1 macOS).
  Most of these consume the Release artifacts, so they hang off REL-1 (need Linux + eventual mac
  builds published first). **Order: WinGet → AUR → Choco → Flathub** — reach per hour of work, with
  Flathub last because its cost is not the manifest but the sandbox: arbitrary dataDirs need portals
  or a broad `--filesystem`, which is exactly what reviewers push back on.
  **This is its own session, and it is blocked on ACCOUNTS, not on code.** Every manifest can be
  written and validated ahead of time; what cannot be done for the maintainer is registering on AUR
  (account + SSH key), Chocolatey (API key) and Flathub, and opening the `winget-pkgs` PR from a
  personal GitHub account. So: **remind the maintainer to create those accounts**, then do all four
  in one sitting — each is a different registry's rules, and paying that context cost four times over
  four unrelated sessions is the waste.
- [ ] **ANY-HOST-PACKAGE-DISTRIBUTION · A content pack from ANY HTTPS host, not only GitHub — POST-1.0.** Not before the
  release: it adds a network surface that has to be got right, and nothing about 1.0 needs it.
  Carved out of REL-4's audit list so that item closes clean: this was never a defect
  in the pack updater, it is a separate feature with its own security surface, and it is not
  scheduled into a wave. **Deliberately deferred, not forgotten** — REL-4 was designed so this stays
  possible: `RemoteFetcher` takes an HTTPS URL and GitHub is a HOST ADAPTER over it, the semantics
  live in the `#content-*` headers rather than in any forge's API, and file `size` is already an
  optional field precisely so an adapter that cannot state one still works. Self-hosting is a stated
  project value; coupling the model to one forge would break it for nothing.
  - **What actually blocks it is the capability, and no amount of TS solves that.** A Tauri
    capability is compiled into the binary and cannot be widened at runtime by config, by a pasted
    URL, or by a bug in the webview — which is exactly why it is the boundary (security.md §5/§7).
    So today `src-tauri/capabilities/default.json` allows `api.github.com` +
    `raw.githubusercontent.com` and nothing else, and `checkRepo` answers `unsupported` for anything
    else. Widening it wholesale would hand any pasted URL the network, which is the one thing the
    seam exists to prevent.
  - **Next rung, when it comes: a per-host user GRANT.** Paste a URL → "allow Charnik to reach
    `packs.example.org`?" → the answer is stored and the allow-list is checked **in Rust**, not in
    the webview. The static capability then widens to "any https host, subject to the grant list"
    and the grant becomes the real gate. At that point `unsupported` grows a fallback instead of
    being a dead end. Store the grants OUTSIDE the dataDir, for the same reason plugin consent is
    (PLUGINS §6.3): a restored backup must not be able to arrive pre-authorised.
  - **And the manifest-free design leaves one genuine gap to answer first.** The `#content-*` headers
    carry everything except *which files exist*. GitHub's tree API supplies that in one request; a
    plain static host can only do it if it serves an autoindex. So the general case is "any static
    host with an autoindex", the answer is still NOT a `pack.json` (docs/internals/content.md ▸ No manifests), and
    deciding what to do about a host with neither is part of this item rather than a surprise inside
    it.
  - **PACK-AUTHENTICITY · no signing.**
    Downloaded bytes are verified against the git blob SHA the tree listing published. That is
    INTEGRITY against a truncated or swapped transfer; it says nothing about the publisher, so a
    typo-squatted URL or an account takeover passes every check. That remains the posture, stated in
    security.md §7 — not an omission waiting to be closed.

    **Why signing was dropped: a pack with more than one author has nobody to sign it.** The key ends
    up in CI, where "signed" means "somebody could push to main" — which is what the blob SHA already
    says, and an account takeover carries the signing secret off with the repo. One key shared
    between maintainers is not a secret; a key per contributor makes adding a contributor a rotation
    event no user can evaluate. Signing is strongest for a lone author holding an offline key, which
    is exactly the case where the pack is small and the damage is wrong numbers in someone's rules.
    Strongest where it is least needed, weakest where it would matter.

    Meanwhile the only thing that EXECUTES is held tighter than a signature would hold it: plugin
    consent pins a SHA-256 of the exact bytes outside the dataDir, so new code stops running until
    the user says yes again (PLUGINS §6.3). The pack URL is pinned in the registry, and a changed
    `#content-source` stops the apply (REL-4 third pass).

    **Revisit if Charnik ever becomes a central distributor** — a pack index, a "verified publisher"
    badge, anything where WE vouch for someone else's content. That is the point where a signature
    stops restating repo write access, and it is a product decision (we become the gatekeeper of
    other people's homebrew) before it is a crypto one.

    **The shape, if it comes back:** in-band and per file — a `#content-sig` directive beside
    `#content-hash`, over the same normalised bytes `hashInput` already produces
    (`src/lib/content/hash.ts`); no sidecar, no manifest (§1.6). Format = minisign, because the
    updater already carries a minisign public key (`tauri.conf.json` ▸ `plugins.updater.pubkey`) and
    verification is therefore already in the binary. Sign the bytes, never the `xxh64:` digest —
    xxHash is not collision-resistant.
- [x] **UBUG-4 · a desktop install had no content folders.** Desktop now seeds the shipped CSVs
  into `<dataDir>/content/` on first run and loads from there; web still reads the bundle over
  fetch. Hand-edited files survive seeding by hash drift. Verified on a real install.
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
- [x] **SEC-2 · Every `{@html}` goes through the sanitizer** — no hand-rolled escaping; see
  `docs/internals/security.md`.
**Data versioning (design below):**
- **DATA-VER-1 · content versioning — BUILT (2026-07-06, tasks 1–5; task 6 closed 2026-08-14).**
  Design-of-record: a
  `#content-<key>:` directive header block (leading comment lines before the CSV column row) carries
  per-FILE `type`/`source`/`systems`/`url`/`license`/`id`(uuidv7)/`updated-at`/`schema`/`hash` — the
  per-row `source`/`systems` COLUMNS are dropped (the file is the unit of source+edition; split files
  for mixed). Shipped: `content/meta.ts` (`parseContentDirectives` / `checkFileMeta`→`MetaIssue`),
  `content/hash.ts` (`xxhash-wasm`, normalized-body `xxh64:` hash = the change DETECTOR, Excel-resave
  safe), `FileEntry.mtime`, all SRD CSVs migrated (2815 rows, 0 metaIssues / 0 drift), and the loader
  surfaces `graph.metaIssues` / `driftItems` → `ContentMetaModal` (missing required source/license)
  + `HashDriftModal` (body edited after the last stamp), per-session dismiss. Missing meta never
  hard-blocks — machine keys (id/hash/updated-at/schema/type) auto-fill; human keys (source/license)
  prompt; a missing `systems` defaults to both editions.

  **Task 6 — the write-back — DONE 2026-08-14.** Both dialogs' confirm buttons now write
  (`content/restamp.ts`); the in-app authoring stamp had already landed with Editor mode
  (`homebrew.ts`). Four things about it are decisions, not implementation details:
  - **It re-stamps a file the app did not create, deliberately.** The neighbouring invariant is "the
    app writes only files it owns", and it exists so a hand-edit is never silently clobbered. Here
    the user has ASKED and only the two stamp lines move. Without it a drifted file is unfixable
    from inside the app — `isProtectedFromOverwrite` refuses to refresh anything failing its own
    hash, so the file freezes at whatever it drifted to and the only cure is a terminal command, in
    a project built for people who do not have one.
  - **ONE stamping function, shared with `pnpm restamp`**, so a file stamped from the terminal and
    one stamped from the UI are byte-identical and the load-time check agrees with both.
  - **The original BOM + EOL survive byte-for-byte.** A pack diff compares git blob SHAs, so
    rewriting 2000 line endings to fix one header line would report the whole file as changed
    against a repo where nothing moved — the same trap `core.autocrlf` sets (content.md ▸ The content
    repo), re-created from inside the app.
  - **"Don't ask again" is content-editing mode**, a persisted setting (`app.contentEditingMode`)
    that adopts a hand-edit instead of asking AND mutes both prompts — and is reachable again in
    Settings ▸ Content health, because an answer must not be a door that locks behind you (the same
    rule as REL-4's `dismissedMissing`). Auto-adoption skips a pack mid-swap: an apply re-checks disk
    state before its rename, so an unattended stamp landing mid-swap would cancel a user's update.
  - **`CONTENT_MIGRATIONS` is wired with an EMPTY registry** (`content/migrations.ts`), and the
    reason is not "somewhere to put future steps": a pack declaring a schema this build never heard
    of used to load in silence and render whatever its columns happened to mean here. It is now a
    content-health warning, and the rows still load — flagged beats silently reinterpreted. The unit
    is a FILE (the version is declared once in its header); absent ⇒ current, so a hand-authored CSV
    is not asked to migrate.

  Web is read-only and now says so by NOT prompting: it still detects both conditions and lists them
  in content health, but a dialog whose only button cannot work is worse than no dialog. Git holds
  the full design log (per-key rules, fill-classes, drift copy).

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
- [x] **Half-Elf +1/+1 choice** (5e) — data-driven, no class-name branching.
- [x] **Expertise** — DONE. `build.expertise[]`, derive exposes a `prof` **enum**
  (`none|half|proficient|expertise`, not two booleans), builder ×2 toggle on proficient skills,
  combat shows a ringed dot. (Strict cap by class-feature count still TODO.)
- [x] **Languages** — a `language` content type (16 SRD rows), granted by species/background.
- [~] **Level-up flow** — minimal DONE: a "▲ Level up" control on the combat sheet advances a chosen
  class by +1 on the open character and saves; the reactive sheet recomputes HP / proficiency / spell
  slots / features live. Remaining: **guided choices at the new level** (ASI/feat pick, new spells,
  subclass at its level) — needs the builder to hydrate from an existing character (edit mode), also
  the prereq for full editing. Add-a-class-while-levelling also via the builder.
- [x] **Inventory/equipment at build** — an Inventory card on the build page.
**Effects engine (finish the vocab, add authoring):**
- [x] **Custom-modifier UI** — DONE. Combat "Custom modifier" builder (grouped target · +/− ·
  amount) → `flat_bonus` token, applied live via the reactive sheet.
- [x] **The rest of the L1 vocab is mechanically applied** — see `docs/internals/effects.md`.
- [~] **Feat stat/skill bonuses** — engine folds feat `effects` already (derive-gather pushes feat
  rows). **Started (2026-08-02):** convert.mjs now PRESERVES authored feat `effects` (was wiped on
  re-run, like class_features); **Alert (2024)** encoded faithfully =
  `flat_bonus:initiative+proficiency_bonus` (real-content test). **The honest remainder is BLOCKED,
  not just unauthored** — most shipped SRD feats don't map onto the bounded vocab:
  - **Half-feat ability-CHOICE UI — DONE (2026-08-02):** `ability_choice` feat column (`str,dex`
    Grappler / `any` Epic Boons, converter-preserved), `slotFeatAbility[slotKey]` draft field, an
    ability picker under a slot that holds a half-feat (defaults to the first option), +1 folded into
    `abilityBoosts`. Epic Boons reach 30 for free — the derive already clamps ability scores at 30
    (A10), so no bespoke cap-override was needed (regular ASI is equally un-20-capped in this lenient
    model). Live-verified (Grappler L4 → STR/DEX picker). Grappler's grapple mechanics stay text.
  - **Needs vocab the L1 grammar lacks** → left as text (engine already surfaces it): weapon-type-
    conditional bonuses (Archery +2 ranged attack), armor-gated bonuses (Defense +1 AC while armored),
    once-per-turn damage rerolls (Savage Attacker / Great Weapon Fighting), spell grants (Magic
    Initiate), the tool half of a CHOICE grant (Skilled — its skill half has its picker, under a slot
    and under the origin feat alike; tools are not modelled).
- [x] **Plugin sandbox** (QuickJS-WASM) — see `docs/internals/plugins.md`.
**Spellcasting follow-ups:**
- [~] **Resource subsystem** — engine + tracker DONE. `grant_resource:<id>:<max>:<recharge>` parsed
  into resource pools (`collectResources`, data-driven / class-agnostic — rage, ki, sorcery points,
  item N/day are one shape); `sheet.resources`; combat "Resources" strip with click-to-spend pips +
  Short/Long **rest** buttons (recharge by type; long resets slots+HP, short returns pact slots).
  Remaining: **encode class resources from SRD tables** (converter — rage/ki/superiority counts),
  **`grant_slot:<level>`** (Mystic Arcanum extra slot into the pools), and **Action-Surge/Haste
  extra action pips** (feed the action-economy `slotMax` from effects).
- [~] **2014 casting data** — 2014 **spell_slots** now emitted (the full/half/pact matrices are
  edition-identical — spell_slots.test asserts `full`==core — so re-tagged 5e). 2014 casters
  (caster=full/half/pact → the derive's `slot_table ?? caster` lookup) now get their slots.
  Remaining: 2014 **class_casting** counts — **scoped 2026-08-09, and it's smaller than written.** The
  PREPARED half already works: `preparedCap` falls back to the 2014 formula (`abilityMod + effective
  level`, min 1) whenever a table value is absent, so a 2014 cleric/druid/wizard is already right. What's
  missing is purely DATA: `content/srd-2014/class_casting_srd.csv` **doesn't exist**, so every 2014 caster
  reports **cantripCap 0**, and known-casters (bard/sorcerer/warlock/ranger) get the prepared FORMULA
  instead of their table's "Spells Known" (a 2014 bard 1 should read 2 cantrips / 4 known, not 0 / CHA+1).
  Fix = the rows, in the same shape 2024 already ships. **A converter is no longer assumed to be the
  route** — the 2014 tables are space-aligned text where a parser slips a column and the numbers go
  wrong SILENTLY, and the remaining 2014 gaps (these counts, the tables `convert-2014.mjs` drops, the
  truncated feature prose) are small enough to author by hand against the source and cheaper to
  verify than to parse. Whichever route: the numbers land with a per-class assert against the SRD
  text, because this is the failure class that passes every other gate.
  Also still open: backfilling the truncated 2014 class-feature prose, and the tables lost with it
  (N2b names the same bug).

- [~] **Combat UI**: multiclass DC + header **DONE** — `SpellsPanel` renders every caster class's
  save DC / attack (A18-tail), and the sheet header (`combat.className`) now joins all classes
  ("Wizard 2 / Fighter 3") instead of `classes[0]`. **Still open [ ]:** pact pool as a distinct
  short-rest pip section; spell picker preview (EntryList+WikiDetail on pick).

**Platform / content:**
- [x] **Tauri fs Storage** impl + platform factory.
- [~] **Content-type identification** — loader `#content-type: <type>` header directive DONE
  (freely-named files declare their type; explicit wins over filename; unknown type → error).
  Remaining: **UI type-assign** (a form that writes the directive) — folds into homebrew authoring.
- [~] **Homebrew content from the UI** — DONE for all browsable types via an editable-article form
  (mirrors the compendium article; schema-driven fields → validated row → atomic BOM/CRLF write into
  `content/homebrew/<type>_hb.csv` in user storage; merged into the graph as an extra content root;
  new row opens in the compendium). Remaining: **spell/monster get the generic grid** (their fancy
  read layouts aren't editable yet), **edit/delete existing homebrew**, and linked-table authoring
  (a subclass's `class_features` rows) — so homebrew subclasses are only half-covered.
- [x] Dependabot: DONE — esbuild + cookie pinned via pnpm-workspace overrides; **re-audited 2026-08-09**
  (it had drifted to 9 findings): dompurify + @sveltejs/kit bumped, five more transitive dev-only
  packages pinned the same way → `pnpm audit` clean again. Re-check it periodically; it drifts silently.
  Pages deploy recovery still open.

**Code quality:**
- [x] **Friendly source labels** — `sourceLabel()` shows "D&D 5e (2014)", never the raw SRD tag;
  the `source` value itself stays exact for attribution (AGENTS.md ▸ A small glossary (source)).
- [x] **CSS class-naming rename pass.** Verbose, self-evident, kebab-case names with a feature
  prefix, gated by `shot.mjs` at 0px. **What stays short on purpose:** a word already self-evident
  inside its component (`.pip`, `.move`, `.dice`, `.filled`), the `class:strip` shorthands, and any
  name produced in the script (`tone()` → `max`/`min`) — renaming those is a JS change, not a class
  change. The census and rename tools are in `tooling.md`.
**Refactoring debt (self-flagged — patterns that drifted from "this is TypeScript, model it"):**
- [x] **R1–R5 · Typing/extraction refactors.** `EditContext` for edit/level-up state; typed
  `overlay.kind`; a named action-economy slot type; effect-token parsing centralised on the bounded
  vocab; the click-to-set pip helper extracted (`pipClick`).
- [~] **R6 · Source-tag constants** — mostly MOOT. App code already uses consts (`HOMEBREW_SOURCE`,
  `SOURCE_LABELS` keys, a local `S` in demo/sheet); the raw `'SRD 5.x'` strings that remain live in the
  edition-SCOPED converters (each `.mjs` emits one edition, declared once) + per-file test `S` consts,
  where a shared TS const can't reach cleanly. Low value; leave.
- **R7 · Strict/Free as a named mode — won't-do.** `strict: boolean` is self-documenting and works.
  The "open enum, never a boolean" rule is about DATA columns, where a third case arrives from
  content; this is a runtime switch with exactly two sides. Reopen only if a third mode turns up.
Done R1–R5 as a focused pass (typos, duplication, drift). R6 moot, R7 deferred. (The R1–R7 +
CH1–CH14 call-chain and per-file audit checklists were COMPLETE 2026-07-11/14 — the done log lived
here and was removed in the 2026-07-27 plan trim; git holds the detail.)

### Compendium-editor refactor set (planned 2026-07-09)

A coordinated set: split the wiki detail into components, type the loader properly, and harden
the lint gate. The WikiDetail decomposition + RollButton shipped (see WD-1 below; live shapes in
`docs/surface.md`). Ordering + open decisions below.

- [x] **WD-1 · Split `WikiDetail`.** Read + translate parity only; `editor` mode stayed a stub.
  **The note this carried is CHECKED and closed (2026-08-22):** the Cast action does show on spells.
  `WikiDetail` renders the `actions` snippet once under the head, outside the per-type branch, so it
  is type-independent — the generic-branch-only version it warned about is already gone.
- [x] **WD-2 · Extract `RollButton`** — the shared roll affordance.
- [x] **TYPE-2 · Typed `LoadedRow`.** A discriminated union on `type`, threaded through
  `graph.list<T>` and `featuresForClass`. Reading a display name goes through `rowName(row)` —
  `content.md` says why. `data` stays `Record<string, unknown>` for the generic column walks
  (homebrew, translation coverage) that have no static type to want.
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
  **The surface** (mocks: `design-preview/drafts-surface.html`, `orphan-popup.html`):
  - **Drafts list = full-width pane that replaces the editing block** (compendium right column, where
    WikiDetail/EditContentForm render) — opened via a **4th "Drafts" entry** in the "✎ Edit compendium"
    picker, with a live count badge. Lists **every** draft (all types+kinds), grouped ⚑Needs-attention /
    Translations / New entries; each row = kind icon + title + target (locale for translate) + age +
    Resume/Delete. This makes add-drafts **unlimited + individually pickable** (supersedes resume-newest
    -of-type). A draft must be **openable no matter what** (incl. orphans) so modified fields are never
    lost.
  - **Orphan dialog** = the house attention-dialog template (docs/internals/ui.md ▸ Shared controls and dialogs): centered
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
    dupes) or the add GUID (`crypto.randomUUID`, per AGENTS.md ▸ Taste). This sidesteps the
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
- [x] **LOC-CHECK · Flag partial/mis-filled translations.** A loader WARN issue, never a throw —
  the same channel as a bad row. A fully-untranslated row stays silent: EN fallback is the contract.
- [x] **LOC-STATUS · Tracked per-locale localization status.** `loc_status_<loc>` column, an open
  enum (`not_started|machine|started|reviewed`) whose members drive the marker + control
  automatically — add a member and it appears (`content/schemas.ts`).
- [x] **LINT-1 · Ban type-escape hatches.** `no-non-null-assertion` + `consistent-type-assertions`
  on, five type-aware rules on in CI, `no-unsafe-*` and `require-await` off with the measurement
  behind it. `tooling.md` ▸ the lint gate has the timings and why a type-aware count is not a defect
  count.
- [x] **NULL-1 · Audit the returned `null`.** All 64 read; most are values and stayed. Two shapes
  were not: a `null` meaning the OPPOSITE of nothing became a named state (`UNCONSTRAINED`,
  `OPEN_VOCAB`), and a `null` swallowing a REFUSAL became a reported `ApplyResult`. Both patterns
  are the thing to look for next time.
**Sequencing:** **TYPE-2 → LINT-1 → WD-1 → WD-2.** Type the foundation
first so every new component (the heads) is born typed and LINT-1's type-checked rules land on
clean code; the view split follows. **TYPE-2 and LINT-1 are both closed (2026-08-21); WD-1 → WD-2 are
what remains of the sequence.**

**Editor mode — DONE (commit `2868f5c`; two-panel `5550e9c`).** The "Editor" mode-picker entry (active
once an entry is selected) opens a **two-panel BEFORE | AFTER** view (commit `5550e9c`, as agreed):
the current rendered article (read-only `WikiDetail`, "Current") beside the editable form ("Your edit"),
mirroring Translate's source|target. The "after" pane REUSES `EditContentForm` (an `editRow` prop)
rather than bespoke editable heads — so every `fieldsFor` widget + zod validation is shared with Add. Save = `upsertHomebrewRow` (replace
same-id row, preserve columns beyond the schema so localized prose survives). A **read-only shipped
SRD row FORKS to homebrew** (same id, `source=Homebrew`); a homebrew row edits its own file. The SRD
file stays untouched (survives a future SRD update, keeps CC-BY attribution).
**Override = SORT, not hide:** a homebrew row floats ABOVE the SRD
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
   (see testing.md); **`Storage` interface + node/in-memory impl**; `schemaVersion`
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
7.5 **Frontend architecture** — component tree, sheet layout, props from core types,
   store/`$derived` wiring for live switches. (UX pattern contract → `internals/ui.md`;
   live component inventory → generated `docs/surface.md`. `FRONTEND.md` retired 2026-08-04, its
   living contract folded into internals/ui.md, its inventory superseded by surface.md.)
   **Layout model = modular panels + preset views (HYBRID).** The UI is built
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
   **Two edit modes — STRICT vs FREE** (**per-block granularity, state stored per character**
   — DECIDE-0: each character carries its own `{block → strict/free}` map in the JSON, default
   strict, and there is **no top-level "set-all" toggle**; rejected both a single per-character flag
   and a per-app global. The current single build-side `ui.strict` migrates onto that per-block map).
   Switchable anytime; Strict default. **Strict** enforces the rules of the **character's OWN system**
   (point-buy caps,
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
   `apply_condition`) — ONE "Effects & conditions" list is the single source of truth for
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
   (rerollable). The log is backed by the character's append-only **`log.jsonl`**, and it is a
   **rolling recent history, not an archive**: the last **100 rolls**, which survive a restart so
   reopening the app shows the session before. Measured: a structured attack line (d20 + the
   advantage pair + a damage line + a note) is 678 B and a plain save 296 B, so 100 lines is
   **~30–66 KB**. The cap is also the per-roll IO cost — `writeLogLine` reads and rewrites the whole
   file on every append — which is the second reason not to keep more. Grouping by session/date,
   search, virtualized scrollback and a per-row delete are **not built**; nothing has asked for them,
   and an unbounded log makes every roll pay for the whole campaign. Keyboard- and touch-equivalent
   (focus opens the same dropdown; long-press to edit a value on touch).
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
   per-roll. **BUILT 2026-08-24** (`CRIT_METHOD`, Settings ▸ General, and an override in the
   roller). The crit TOGGLE is on the roller's damage line and is manual: a natural 20 is not
   always a crit, and a crit happens without one. The two-part roll builder above it is the
   roller organ — its lines ARE ① to-hit and ② damage (ROLLER-N · UBUG-21).
10. **Content editor UI** — add/save custom content (incl. effects) into homebrew CSVs.
11. **Theming + settings** — light/dark + custom themes; settings screen with unified
    **rule-options toggles** (capacity, encumbrance, free-feat, xp-mode, multiclass,
    effects-engine on/off, language, system, theme) — all live.
12. **Export/print + roster + content-pack sharing** — good PDF/print; manage many
    characters; **export a `source` as a shareable pack** (+ import via collision/health).
13. **Package** via **`pnpm tauri build`** (Win `.exe`/`.msi`, Linux AppImage (appimage-only, `tauri.linux.conf.json`)) +
    README (install, add-content-via-CSV, portable vs app-data mode).

Security tasks are woven across phases per [security.md].

## Verification
Automated coverage and conventions live in [testing.md] (suites map to phases; run
`pnpm test`). Manual acceptance per feature: live switches (no reload); sources
(2nd CSV, homebrew folder, toggle off, collision resolve); live reload (edit CSV on
disk); portability (move JSON to fresh install → renders + flags missing; bundle opens
anywhere); play loop (damage → rest → restore; concentration; level-up; multiclass
slots); sheet (effects panel auto-vs-manual, photo, weight+metric, capacity toggle,
print/export).

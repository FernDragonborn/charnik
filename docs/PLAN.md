# Charnik — D&D Character Tracking System (Plan)

> Index doc. Companions: [TESTING.md](./TESTING.md) · [SECURITY.md](./SECURITY.md) ·
> [research/existing-generators.md](./research/existing-generators.md). Frontend UX pattern
> contract → [AI-CONVENTIONS.md](./AI-CONVENTIONS.md) §4.6; live component inventory → generated
> [SURFACE.md](./SURFACE.md).

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

> **The current NORMATIVE spec (code-accurate token vocabulary, L2 grammar/semantics, the
> derive pipeline, state model) is [`docs/EFFECTS.md`](EFFECTS.md).** This section is the
> DECISION RECORD (why the engine has this shape); EFFECTS.md wins on any syntax detail.

- **Bounded effect vocabulary + text fallback.** Effects are structured data from a
  **fixed vocabulary**, NOT an executed mini-language (also a security win — content is
  never code; see SECURITY.md). The kinds/targets/values are enumerated in
  [`EFFECTS.md`](EFFECTS.md) §2 (`flat_bonus`/`set_override`/`advantage`/`grant_proficiency`/
  `resist_immune`/`apply_condition`/`grant_resource`/…). Anything outside the vocab =
  **free text + an optional manual modifier** the user toggles. No Turing-complete DSL
  (avoids Aurora's swamp; stays testable).
- **Expressiveness = three layers, never code-in-CSV** (DECIDED; see SECURITY.md #4):
  **L1** the bounded vocab above (data; ~95%); **L2** safe value-expressions (`1d4`,
  `prof*2`, `ceil(level/2)`) via OUR dice+arithmetic parser — non-Turing-complete,
  whitelisted vars, no `eval`; **L3** plugins for the long tail. **Ordering DECIDED
  (2026-07-15): L2 ships BEFORE L3.** L2 over a rich (conditional) ctx covers the great
  majority of the tail with ZERO sandbox/attack surface, so it must land first; L3's sandbox
  is only justified once L2 is exhausted and `onUse`/`onEvent` (core-owned, deferred) demand
  it. Concretely: an L2 phase precedes PLG-2 (the sandbox) — a `passive`-only `api: 1` sandbox
  must NOT ship ahead of L2. **DSL naming convention (DECIDED + applied 2026-07-15): the effect
  token DSL is `snake_case`, with `.` for namespacing** — kinds `flat_bonus`/`set_override`/
  `grant_resource`/`apply_condition`/`grant_proficiency`/`resist_immune`, target `hp_max`,
  vars `wis_mod`/`base_speed`/`class_level.monk`/`is_bloodied`. Renamed from the old kebab
  kinds because L2 makes `-` the subtraction operator, so any identifier that can appear inside an
  expression (kind, target, variable, resource/condition id) MUST avoid `-`; snake also matches
  the CSV-column convention (`hit_die`, `name_en`). **Extended (DECIDED 2026-07-16): content IDs
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
    shareable/importable like content packs; export/import one theme.
  - [ ] **Theme scope decision** — colours only (today), or also expose density/roundness/type
    tokens (now possible since font-size/radius/tracking were tokenized) under `[data-theme]`.
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
  retrofitting; UX pattern contract in `AI-CONVENTIONS.md` §4.6.
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
- **feat** (`feats_*.csv`) `category(origin/general/fighting_style/epic_boon/general_2014), prereq, repeatable`.
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
3. **Species ability bonuses → `effects`** (`flat_bonus:con+2`) instead of only prose
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
    contract + light/dark/custom themes are unchanged. UX pattern contract → `AI-CONVENTIONS.md` §4.6.
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

- [ ] **N1 · Inventory view.** USER-CONFIRMED WANTED (2026-07-19): there is still NO inventory
  view anywhere in the app (only `build.inventory` rows in the builder) — bake it from the
  `design-preview/d-inventory.html` mock per the bake-from-mocks rule, don't design from
  scratch. New combat panel `pid: 'inventory'` (panel infra + the
  layout-model plan already reserve it): rows = name + description, qty stepper, equip/attune
  toggles (attunement cap 3 — Strict blocks, note explains), "use" on consumables (qty−1).
  B7 lands here: weight sum → carrying-capacity bar (+ kg). Money is its OWN item (→ N6),
  not an inventory row. Equipped/attuned effects already flow (gatherEffects) and AC/attacks
  re-derive reactively. MIGRATIONS: decided 2026-07-15 — 0 users yet, so NO migration work
  now; schema may change freely (breaking) until release; the schemaVersion machinery stays
  for post-release.
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
  `items_content.test.ts` pins the values + drift. **App-verified:** demo Karroth's attuned Cloak now
  reads AC 14 → **15** with "Cloak of Protection +1" in the trace, and every save +1
  (`design-preview/magic-item-efx.png`). **REMAINING (the `[~]`):** the other ~240 magic items — mostly
  charges/activated procedures (RECHARGE slice 3), GM-chosen variants (Ring/Armor of Resistance),
  weapon-scoped bonuses (the open §A `damage:<qualifier>` gap) and the generic +1/+2/+3 rows that need
  one row per tier.
- [x] **DEMO-1 · Showcase demo character — DONE 2026-08-04.** **Karroth the Red**, id `karroth` —
  Tiefling · Soldier · **Warlock 5 (Fiend) × Barbarian 3 (Berserker)**, SRD-only, derives clean
  against the real shipped SRD 5.2.1 graph. It seeds first-run on web AND desktop, so it IS the first
  impression of the system's scope — keep it deriving clean. `recreateDemoCharacter()` restores it;
  Settings ▸ Data has the button.
  **What this pairing does NOT exercise** (so nobody assumes the demo covers it): `casterLevel` is 0
  for the barbarian half, so pact-pool-alongside-shared-slot math is never hit; Unarmored Defense and
  the Eldritch Invocations are untokenized, both waiting on N2; and a base Warlock has **no Ritual
  Casting**, so the `R` badge cannot appear here without Book of Ancient Secrets — demo rituals on a
  Wizard/Cleric aspect instead, and with a REAL shipped SRD ritual, never a hand-authored one.
- [ ] **N2 · Class-feature engine ("features as data").** The three shapes above + the hard
  case: **Wild Shape = stat-block replacement** (USER-RECONFIRMED 2026-07-19: still fully
  unimplemented — a druid has no working Wild Shape at all; the complexity + the 5e↔5.5e
  divergence is exactly why the spec-sheet gate below exists). Model: `play.form =
  {monsterRef, formHp} | null`; deriveSheet branches — physical scores/AC/attacks/speed from
  the (already-typed!) monster row, mental stays own; isolated removable seam like effects;
  2014/2024 diverge (2024 = temp HP, known-forms list). **Gate (decided 2026-07-15):
  implement ONLY against a written per-edition spec sheet taken verbatim from PHB'14 +
  PHB'24 — 100% RAW fidelity in both editions is a hard requirement here** (HP pool vs temp
  HP, CR/movement limits per level, what's kept vs replaced, revert-at-0 carryover,
  equipment handling, casting rules).
  Superiority dice: extend the grammar —
  `grant_resource:superiority-dice:4:d8:short` (decided 2026-07-14: die BEFORE recharge —
  "what the resource is, then when it refills"; ResourceDef + `die`). The die segment is
  optional and shape-distinguishable (`d\d+` vs `short|long|other`), so existing 3-segment
  tokens (`grant_resource:rage:2:long`) keep parsing unchanged. Spending rolls the die into
  attacks via the existing `bonusDice` path. Extra Attack: `flat_bonus:attacks+N` →
  Attacks panel shows ×N. Prereq: the fold must gather these feature tokens; content-schema
  columns bump + converter updates.
  Order: shapes 1→3→2, Wild Shape last as its own item.
- [ ] **N3 · Builder/level-up redesign — descriptions everywhere.** Requirement: NOTHING is
  picked blind (spells, feats, subclasses, maneuvers, features). UI thesis: master–detail
  with REUSED WikiDetail as the detail pane (one-shared-component rule; no new renderer);
  hover/focus previews, click pins; narrow screens = expandable rows. Level-up gets a
  "gained at level N" screen from `featuresForClass`. Process (decided 2026-07-15): go
  STRAIGHT to an HTML mock in design-preview/ (no ASCII drafts — too big a piece), approve,
  bake — and split the 1032-line build page (D1) while baking. Choice groups (N2 shape 3)
  render here.
- [~] **N4 · Skills system fixes.** (a) **DONE (2026-08-02):** `toggleExpertise` capped from data
  — a curated `expertise_slots` `level:count` column on class_features (ONE row carries the
  progressive grant: Rogue `1:2,6:2`, Bard `3:2,10:2` 2014 / `2:2,9:2` 2024, 2024 Ranger `9:2`;
  converter-preserved like `effects`). Build sums the active-feature grants → `expertiseCap`;
  Strict enforces (Free doesn't), UI shows `expertise N/M` + disables ×2 at cap. Wizard "Scholar"
  (1 restricted-list expertise) deliberately NOT encoded — the count model can't express the skill
  restriction, so encoding it would over-permit. Unit + real-content tests both editions. **UI not
  screenshot-verified in a Rogue state** (needs a build-flow drive). (b) effects integration:
  `grant:expertise` missing from the L1 vocab,
  effect-granted skills not shown as locked-on in the builder; (c) 'half' (Jack of All
  Trades) is a dead branch — type + `skillCheck(halfProficient)` exist, nothing calls them;
  wire via a bard feature token (needs a `half` grant the L1 vocab lacks — vocab extension);
  (d) **DONE (2026-08-02):** the combat SkillsPanel already showed the proficient/expertise
  tiers (filled / ringed dot) with `why()` provenance on the row hover; added the 4th tier —
  a faded `half` dot (color-mix on `--color-resource`, scaffolding until a half-prof producer
  lands per (c)) — and a friendly per-tier tooltip on the dot. Combat baseline 0px (reachable
  tiers render identically; the `on` split is behaviour-identical for none/proficient/expertise).
- [ ] **N5 · Adjacent gaps (assistant's additions).** (1) **Features panel on the combat
  sheet** — a character can't READ their own features/traits anywhere; read-only prose list,
  cheapest big win, zero prereqs. (2) **DONE** — concentration check prompt on damage (CON save DC
  max(10, ⌊dmg/2⌋)) now toasts a reminder in `damage()` (see the CONCENTRATION entry). (3) Death saves + exhaustion UI (→ B2).
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

### EXPR · L2 value-expression layer — BUILT (design → docs/EFFECTS.md §3)

The bounded L2 formula layer (value expressions + condition guards, the type/resolution rules, the
worked examples, conditions/exhaustion-as-data) is **shipped** and its normative design lives in
[`EFFECTS.md`](EFFECTS.md) §3–§4. Delivered across EXPR-1..5 + CONDITIONS-1 (2026-07-17/19):
parser+evaluator (`expression-parser.ts` / `expression-evaluator.ts`), value expressions in tokens,
condition guards + the ONE resolve stage (`resolveActiveEffects`, `dependency-graph.ts`), the
dependency-order DAG (ability scores fold through the pipeline — A10), the typed-facts output
(`collectFacts`), cantrip scaling, the roll-manip L1 tail (`reroll`/`min_die`, `d20_tests`,
`speed.fly/swim`, `spell_dc`/`spell_attack`, `save.death`), and all 15 standard conditions carrying
mechanical `effects` tokens in both editions. AUDIT SPEC2–SPEC7 (grammar / type / resolution
decisions) are recorded in EFFECTS.md §3; git holds the per-phase log.

### PLG · Plugin sandbox (L3 expressiveness) — BUILT (design → docs/PLUGINS.md)

The QuickJS-in-WASM plugin layer is **shipped** (PLG-1..3, 2026-07-19): the registry + native
handlers, the quickjs-emscripten (quickjs-NG sync) sandbox with the full PLG-SEC containment
(zero-capability context, 5 ms / 8 MB budgets, JSON-string boundary, length-prefixed SHA-256
consent hash stored OUTSIDE the dataDir, fail-closed counter, desktop-only), and the normative
[`PLUGINS.md`](PLUGINS.md) (`api: 1`) — all in `src/lib/effects/plugin-*`. Plugin-token failures
surface via `deriveIssues` → content health. The design decisions, the PLG-SEC containment
checklist, the state model (three channels) and the authoritative derive stage-list are the
design-of-record in [`PLUGINS.md`](PLUGINS.md) and [`EFFECTS.md`](EFFECTS.md) §4/§6 (AUDIT
SPEC1 / SPEC8 / SPEC9 map there); git holds the per-phase log. Open tails: the dedicated
plugin-dependency notification view + portability / version awareness (fresh-eyes review #2).

---

## Backlog (post-spellcasting, prioritized) — carve down gradually

Flagged during the persistence/build/spellcasting work. Grouped; ~rough priority within each.

### Implementation order (current focus — WAVES, set 2026-08-10)

The order the maintainer and Claude are actually working to. Wave = a coherent chunk, not a sprint;
the SEQUENCING REASONS matter more than the numbering and are given per wave, because most of them
were learned the hard way.

- **W0 · REL-4 content packs — IN PROGRESS.** The maintainer's priority: get SRD content out of the
  app so rules data updates without an app release. Slice 1 done (`ccd247c`, a pack is a folder,
  discovered by scanning). Slice 0 (split SRD into its own repo) needs the maintainer to create the
  remote — do not do it unasked. **Consequence worth planning around:** after W0 the content passes
  (MAGIC-ITEM-EFX, E4, D6/D10) leave the app roadmap entirely; they ship from the content repo.
- **W1 · Roll card (UBUG-20 + UX-3) — DONE 2026-08-10.** One `RollRow` across toast / Playbar / log /
  tray, retroactive advantage as a three-state pill, the reroll pill, the one-line strip. Tails are
  listed on UBUG-20 itself.
- **W2 · The roller → ROLLER-N → UBUG-11.** Now has its own ledger, **[`docs/ROLLER-PLAN.md`](ROLLER-PLAN.md)**,
  after the 2026-08-10 audit turned "add a loop for N attacks" into "the result SHAPE is what aged".
  Carries `UBUG-21` (the tray edits the to-hit while claiming to be the attack) and `UBUG-22`.
- **W3 · UX-1 error-copy pass → ARCH-1 i18n sweep.** After W0, because REL-4 adds a whole class of
  new user-facing messages that would otherwise be written twice. UX-1 before ARCH-1, or bad copy
  gets translated and then rewritten. **And after W2** — this reason is new and load-bearing: the
  roller currently writes an English SENTENCE into `log.jsonl`, and prose already on disk cannot be
  localised afterwards. The roller has to start recording facts before the i18n pass has anything
  worth localising (ROLLER-PLAN, "the record holds facts").
- **W4 · N1 Inventory → RECHARGE slice 3 (item charges) → D16 choice-UI (→ `magic_initiate`) →
  SCOPED-BONUS.** Slice 3 wants item charges, which want an inventory. SCOPED-BONUS is an L1 grammar
  change and a `docs/compatibility.md` chokepoint, so it stays its own piece rather than riding
  another wave.
- **W5 · tail:** REL-2 packaging channels, UBUG-19 (icons are drawn, not typed — ~100 sites),
  UBUG-4's real `.msi` verify (attach to the next release), ARCH-4 / B11 / B24 / R7 / TYPE-2 /
  LINT-1 / the CSS rename pass. UX-2 onboarding stays deferred.

**Out of band — do these when next in the area, don't schedule them into a wave:** `UBUG-22`
(`rollFormula` drops a mid-string modifier — an hour, and it is silently wrong numbers reachable
from content AND the plugin API).

**From AUDIT-29-07 (retired 2026-08-04 — its Bugs/Smells/Naming were all closed + verified; git
holds the done-work log; these are the OPEN tails it carried):**
- [ ] **ARCH-1 / B8 · i18n sweep of combat + build.** `en.json` has no `combat.*`/`build.*` sections;
  CombatVM/BuildVM hardcode EN (toasts, `combat/constants.ts` labels, panel headers, buttons) — the
  biggest gap from "i18n is data-driven". Partial is safe (EN-fallback is the contract). **Plan:**
  namespace `combat.*`/`build.*` in en/uk.json → start with component-level static labels (`$_` works
  natively in `.svelte`, no VM plumbing) → then VM toasts, which need a decision: inject a `translate`
  into the VM (the house pattern — logic-layer stays `$_`-free, UI injects, cf. `formatNote(note,
  translate?)`) OR allow `get(_)` in a VM (a VM is the UI layer, not rules-core, so `get(_)` is
  defensible — but it's not the established pattern). UA copy uses formal «ви» ([[uk-formal-vy]]).
  **Do UX-1 first** — translating copy that's about to be rewritten costs the UA pass twice.
- [x] **UX-3 · Roll access: retroactive advantage instead of a pre-roll gesture — BUILT 2026-08-10,
  see UBUG-20 for what shipped.** The problem was that `Alt/Ctrl-click` opened the roll tray, on an app
  explicitly used on a phone where modifiers do not exist. The answer: don't bind a gesture to opening
  a configurator at all — roll, and if it turns out to have been advantaged, tap the d20. RAW-exact
  (the rule says roll a second d20 and take the higher; rolling it late changes nothing) and identical
  on mouse and finger. Full survey + the three findings behind it:
  [`docs/research/roll-surfaces.md`](research/roll-surfaces.md).
- [ ] **UX-2 · First-run onboarding — DEFERRED, not a priority (maintainer, 2026-08-10; recorded so the
  need doesn't get re-derived from scratch each time a non-obvious affordance ships).** The trigger: the
  app keeps accumulating things a first-time user cannot deduce (Alt/Ctrl-click a stat to open the roll
  tray instead of rolling it, `Ctrl+K`, the fact that all content is CSV on disk they may edit live,
  and — once UBUG-20 lands — that an eligible damage pill is clickable). **Maintainer constraints:**
  minimum text, maximum interactivity, because (a) less to translate, (b) long tutorials actively repel
  people from a new app.
  **Design position to start from (not yet agreed, argue it when it's picked up):**
  1. A tutorial that teaches individual CONTROLS is usually a patch over a discoverability bug — the
     first fix is the affordance ([[charnik-interactive-affordance]]), not a screen explaining it.
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
- [ ] **UX-1 · Error copy pass — audit every user-facing message and rewrite what a non-technical
  person can't act on (maintainer request 2026-08-09).** The app is explicitly built for people who
  own their data as plain CSV, not for developers (CLAUDE.md), but most of our messages are written
  from the ENGINE's point of view: they name internal identifiers and assume the reader knows the data
  model. Real examples, all currently shipped:
  - `no prepared/known count for warlock at level 5 in 5.5e, and this system states no formula — add a
    class_casting row` (mine, 2026-08-09) — says `class_casting`, a file the user has never heard of,
    and `5.5e` instead of the friendly "D&D 5.5e (2024)" label we already have a helper for.
  - `unknown target "armorclass" for flat_bonus` · `spell_lists: unknown class "warlock-typo"` ·
    `#content-type: unknown content type` · `malformed locale column` · `duplicate source:id`.
  - `plugin budget for this computation exhausted` · `result too large` · `invalid result: bad target key`.
  - Row headers render as `Warlock · class_casting:warlock` — a raw token as the primary label.
  **The standard to apply:** each message answers three things in the user's words — *what happened*,
  *what it means for their sheet*, *what to do next* (which file, which row, what to type). Keep the
  exact technical detail (token, id, file:line) but demote it to a secondary line, because the
  content-health panel is ALSO the homebrew author's debugging tool — this is a rewrite for a second
  audience, never a deletion of detail. Use the friendly edition/source labels ([[friendly-source-labels]]),
  never raw `5e`/`SRD 5.2.1` in prose.
  **Scope:** the content-health panel (loader issues, missing metadata, hash drift, token lints, derive
  issues), toasts across combat/build, dialog copy, homebrew-form validation, plugin failures.
  **Sequencing:** do this BEFORE **ARCH-1**'s i18n sweep — otherwise every bad string gets translated
  into UA and has to be redone twice. Ties [[play-tracker-surfaces-never-forces]] (a message the player
  can't act on is the same failure as a silent one) and AI-CONVENTIONS §2.7.
- [ ] **ARCH-4 · stylelint spacing px-guard.** The `font-size:["px"]` guard is DONE + enforced (green).
  The spacing half (`padding`/`margin`/`gap` px → `--space-*`) is ~523 warnings: blocked on a design
  call — either add spacing-scale tokens for the off-scale values or migrate-with-screenshot-verify,
  not a blind sweep. Warn-only on 523 = noise that trains people to ignore stylelint, so it stays out
  until the migration is done as its own pass.
- [x] **B25 / RV4 · Subclass-caster spell list.** The seam is DATA, not a class-name branch: a
  `spell_list` column on the `subclass` row naming the class lists it draws from (RAW an EK/AT casts
  off the WIZARD list, which cannot be inferred from `class_id`). A blank column keeps a subclass out
  of the index — never silently given a list. EK/AT are PHB, not SRD, so coverage lives in fixtures.
- [ ] **D16 · generalized player-choice model.** Half-feat ability-choice is DONE (§ Builder, 2026-08-02);
  still open: Magic Initiate spell picks + Skilled skill/tool-choice grants — both need the shared
  choice UI (see `docs/N2-PLAN.md` feat tail). One "player choice at a slot" abstraction covers all.
- [ ] **D6 / D10 / E4 · mechanics from prose → columns.** `effectHint`/`healDice`/`durationToRounds`/
  `castingIcon` hardcode spell names EN-only; most SRD spells still ship EMPTY `effects` columns (E4)
  so there are no tokens to summarize. Tracked live under UBUG-9 (the caption idea) — E4 is its blocker.
- [ ] **UBUG-22 · `rollFormula` silently drops a flat modifier that isn't at the end of the formula
  (found in the roller audit 2026-08-10).** `rollFormula('1d6+3+1d4')` totals **10, not 13** — proven
  with maximal dice. `parseDicePool` collects every `NdM` group, but the flat modifier is read by a
  TAIL regex (`/([+-]\s*\d+)\s*$/`), so any `+N` with a dice term after it is simply lost.
  **Why it matters: it is reachable from CONTENT, not just from a typed formula.** `RollButton` rolls
  formulas straight out of compendium CSVs, and `heal:<formula>` arrives from a `resource_option.action`
  cell — so a homebrew author writing `heal:1d8+2+1d4` gets a quietly smaller heal with no warning.
  Same failure class as UBUG-21 and the reason for the never-a-silently-wrong-number rule.
  **Fix independently of the roller rewrite** — it is a parse bug, not a shape problem: sum every
  signed standalone term instead of reading only the tail, and cover `1d6+3+1d4`, `2d6-1`, a bare
  `+3`, and a modifier before any dice. Listed as slice 1 in [`docs/ROLLER-PLAN.md`](ROLLER-PLAN.md).
- [ ] **UBUG-21 · The dice tray edits the TO-HIT while claiming to be the attack — dice and modifier
  you add for damage land on the d20 instead (reported by the maintainer 2026-08-10, long-standing;
  `design-preview/dice-bug.png`). Fix WITH `ROLLER-N`, below — same seam, and pointless to build twice.**
  Alt/Ctrl-clicking an attack prefills the tray from `attackRoll`'s tray branch: `dice: {20:1}`,
  `mod: at.toHit + fx.flat`, and the damage goes to `queueDamage`, where it is INVISIBLE and
  unadjustable — `doRoll` rolls the shown pool, then rolls the queued parts from their fixed specs.
  So everything the tray shows, and everything it lets you change, belongs to the to-hit, under a
  heading that says "Greataxe".
  **Why this is worse than a missing control:** the pool is editable, so a player adding "+1d6" for a
  damage rider gets it summed into the ATTACK roll — the card reads `Roll 1d20 + 1d6 +6` and resolves
  `13 · 5 · 20(dropped) · +6 = 24`. A silently-wrong number, which is exactly the failure mode item 9
  exists to prevent, not merely an absent feature. The `− mod +6 +` stepper is the same problem one
  step quieter: it is the ATTACK bonus, and the damage modifier cannot be reached at all.
  **A spec gap, not an open design question — the roadmap already describes the right shape** (§9:
  "opens the roll builder in **attack mode**: (1) to-hit (d20 + attack bonus, adv/dis) vs AC, then
  (2) damage (weapon/spell dice + mod) with a **Crit toggle**"). Only stage 1 was ever built. The tray
  needs the two-part structure the ROLL CARD already renders — to-hit and damage as separate,
  separately-adjustable sub-rolls — which is the model `ROLLER-N` must introduce anyway
  ([[charnik-dicetray-attack-damage-concept]]). Building it here first would build it twice.
  **Interim honesty option if the roller slips:** label the pool "to hit" and render the queued damage
  visible-but-read-only. Cheap, stops the silent-wrong-roll, and pre-builds no structure.
- [ ] **ROLLER-N · one roller that fires N independent sub-rolls (promoted to its own item 2026-08-09;
  working ledger + the 2026-08-10 audit behind it → [`docs/ROLLER-PLAN.md`](ROLLER-PLAN.md)).**
  Was filed as a sub-tail of UPCAST (`UPCAST-ROLLER`, was D14) — the wrong home, because upcast is only
  one of its callers. **The capability:** N sub-rolls from one action, each its OWN to-hit + damage (own
  advantage, own crit, own target), rendered as one grouped result. **Callers, all blocked on this and
  nothing else:** (1) `count`-scaling cantrips — Eldritch Blast beams, Scorching Ray, Magic Missile,
  Chain Lightning; today `remindCountScaling` (`combat/state.svelte.ts`) casts ONE instance and toasts
  "N×: make N separate rolls at this level", a reminder standing in for the rolls (item 9: never a
  silently-wrong single big die). (2) **UBUG-11** — a class action that makes N attacks (Flurry of Blows
  = 2× Unarmed Strike); that item keeps its own half, the `rolls` intent in ACTIONS.md that lets a
  feature CALL this. (3) any future multiattack. **Build it once here** — a second per-feature path is
  the failure mode to avoid. **Carries `UBUG-21` with it** (above): the tray only ever built the
  to-hit half, so the sub-roll model this item introduces is the same one that fixes it — close them
  together.
  **The audit says the shape itself is what aged** — the roller answers with a formatted STRING that
  the UI parses back, so provenance, damage type and crit-doubling have nowhere to live, and the
  advantage amend/undo does string surgery. Details, decisions and slices are in `ROLLER-PLAN.md`;
  the two items below are the ones already agreed.
  **Fold the advantage two-state while in here (maintainer, 2026-08-10).** One fact is currently
  spelled twice under two names — `AdvantageRoll.mode?: 1 | -1` on the rolled result and
  `RollToastAttack.advantageMode?: 1 | -1` on the view model, the second re-derived from the first
  with a legacy fallback. That breaks [[one-name-per-fact]], and both are two-state where a named
  member belongs (AI-CONVENTIONS §1.5 — the same reasoning that turned `RollRow`'s `line: boolean`
  into `ROLL_LAYOUT`). Two changes, and the FOLD is the bigger one:
  - **Collapse, don't just rename.** `RollToastAttack` carries `dropped` AND `advantageMode` — both
    are projections of the one `AdvantageRoll`. Carry the object itself and the two fields become
    one, along with the fallback that re-derives the mode.
  - **Name the members** (`advantage` / `disadvantage`) rather than `1 | -1`. This field is persisted
    into `log.jsonl`, where `-1` tells a reader nothing.
  **Do NOT convert the input axis with it.** `rollPool(advantage)` / `netAdvantage(fx)` use −1 · 0 ·
  +1 as arithmetic that sums and clamps across effects; that is a different fact from "how this roll
  was decided", and it stays numeric. Only the RESULT's record becomes a named member.
  **The rolled dice must SURVIVE a state change (maintainer, 2026-08-10) — and today they don't.**
  Cycling back to neutral drops the second d20 from the record, so the next tap draws a fresh one and
  a player who keeps cycling keeps getting new dice to pick from. That defeats the exact property the
  control was justified with. The fix is that a roll records the dice it drew and the mode merely
  selects which counts — NOT pre-rolling two batches for every roll, which would draw dice nobody
  asked for and change the RNG consumption of every roll in the app (`ROLLER-PLAN.md` has the shape). ~~Contract `DiceTrayRequest.instances` is already fixed~~ — **WRONG, corrected
  2026-08-10: no such field exists anywhere in `src`.** Nothing of the contract is settled; the loop,
  the grouped roll/toast/log rendering and the request shape are all unbuilt. The reminder text stays the fallback for what the roller
  can't express. Ties [[charnik-dicetray-attack-damage-concept]] + the RollToast row model (UBUG-12).
- [ ] **SCOPED-BONUS · a bonus that applies to ONE thing, not everything (merged 2026-08-09 from
  `UPCAST-INVOCATION-SCOPE` + the Magic Weapon `enhancement` tail of UPCAST-ROLLER — they were the same
  problem written twice).** L1 can say `flat_bonus:damage+n` but not "…only for this weapon / only for
  this spell / only on this instance", so: **Magic Weapon** buffs ALL the caster's weapons (and leaks
  into spell rolls), and **Agonizing Blast** (+CHA per beam) / **Eldritch Spear** can't be expressed at
  all. Both need the same thing — a scope key on the bonus. `attacks.ts` §A/§B already scopes by weapon
  CATEGORY; the extension is a general scope (`weapon_id` / `spell_id` / per-instance), NOT a feat
  enumeration — every invocation is then just "a scoped effect on a spell". **This is an L1 grammar
  change and a `docs/compatibility.md` chokepoint** (effect-token grammar) — decide it there, not
  ad-hoc in the fold. Independent of ROLLER-N (each ships without the other), but the per-beam case
  only becomes visible once N beams actually roll. Also the mechanical half of DEMO-1 gap 4 / N2
  invocations.
- [ ] **B11 · size-cap on `Storage.read()`** (`size` on `FileEntry`). Needs a cap-value decision + 5
  storage impls, and risks rejecting legitimately-large homebrew CSVs — likely YAGNI; recorded, not queued.
- [ ] **B24 · granular per-file watcher reparse.** The watcher reparses coarsely; per-file is deeper in
  the watcher plumbing, not a one-liner. Low priority.
- **A17 ritual/pact residual** — pact-slot pips + upcast picker SHIPPED (see UBUG-6). Residual is only
  the pure-warlock slot-gating nuance + ritual-source (`L13` in the hazards above). Minor.
- **Won't-do (recorded so they aren't re-audited as bugs):** **D19** exhaustion `max 6` stays a RAW
  constant (identical both editions — not a data-driven win, YAGNI); **SMELL-2** `deriveHealth` is
  single-open + `characterName` is a display-only label — keying it by `c.id` is dead flexibility;
  loose `z.record` play-state keys stay un-branded (see `docs/AI-CONVENTIONS.md` §2.1).

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
  - [ ] **UPCAST-DURATION-TAIL · Geas/Dominate multi-day durations.** Expressible via `duration:step`, but
    low value in the rounds canon (30 days = 432000 rounds) — a curated follow-up, not a blocker.
  - [ ] **UPCAST-PREVIEW-TOOLTIP · pre-cast per-slot preview** ("5th: 10d6, 6th: 12d6") before choosing a
    slot. v1 ships the picker + an on-select `castPreview` only; a hover tooltip over the whole ladder is
    the nicety left.
- [x] **CONCENTRATION · Timer + end-points — DONE (was `docs/CONCENTRATION-PLAN.md`).** **Model C**
  is the load-bearing decision: `play.concentration` is a `string | null` REF, and the timer lives on
  a carrier effect in `play.effects` — concentration is "a ref to its own timer-effect", not a
  separate clock. That reuses the existing expiry + duration UI (editing the carrier's
  `durationRounds` IS editing the concentration) and cost ~1 line, where giving concentration its own
  clock needed a display proxy and a second expiry path. A concentration spell ALWAYS gets a carrier,
  even token-less, which is what gave Hold Person and Web a timer. The CON save on damage is a toast
  REMINDER, never an auto-drop ([[play-tracker-surfaces-never-forces]]). Duration canon = rounds.
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
  2× Unarmed Strike, and the general case for any "make an attack" ability. Ties into ACTIONS.md (the
  `rolls` intent field) + [[charnik-dicetray-attack-damage-concept]]. The whole "action from a class
  feature" model is the target, not just Flurry.
  **Split 2026-08-09:** the "fire N sub-rolls" half is `ROLLER-N` (a general roller, also what a
  `count`-scaling cantrip needs — re-reported the same day on a Warlock: Eldritch Blast at level 5 just
  toasts "2×: make 2 separate rolls at this level"). **What stays UBUG-11** is the action half: the
  `rolls` intent in ACTIONS.md that lets a class feature CALL that roller with the right weapon, instead
  of degrading to `note:` text. Don't build a Flurry-shaped roller here.
- [x] **UBUG-12 · Roll feedback is hard to read — the toast became a component (2026-08-09, design
  5A from `design-preview/toast-update/`).** Superseded by UBUG-20, which made that component the ONE
  renderer for all four roll surfaces. Two rules from it are still load-bearing and both live in code:
  a natural 20 is labelled "nat 20" and never "crit", because the same 20 is a crit on an attack and
  just a 20 on a check and the tracker surfaces rather than rules (`dice/roll-toast.ts`); and an
  attack "deals damage" on **dice OR a flat value**, since Unarmed Strike's flat `1 + STR` silently
  rolled nothing while the gate asked for dice (`dealsDamage`, `combat/roll.ts`).
- [x] **UBUG-13 · Level-up re-offered an ASI and double-applied it.** Root cause worth remembering:
  only the FLATTENED `abilityBoosts`/`feats` were persisted, never the per-slot mapping, so a
  restored slot could re-derive its boost a second time.
- [x] **UBUG-14 · A long rest clears one level of Exhaustion.** SRD-verified; the 2024 text's "has
  also ingested some food and drink" applies unconditionally because rations are not modelled.
- [x] **UBUG-15 · Death is modelled, and there is a dead screen.** One typed `play.death: {cause}`
  (an OPEN cause enum, not a `dead` boolean) and ONE `die(cause)` seam every lethal rule lands on.
  The two SRD interpretations behind it live at that seam in code (`state.svelte.ts`): instant death
  runs the 5.1 text in BOTH editions because 5.2.1 omits the chapter carrying it, and revive drops
  one exhaustion level in 2014 too, where RAW is silent, since reviving onto a lethal 6 would kill
  you again on the spot. The dead screen is deliberately **not dismissible by backdrop or Escape** —
  a roster link is the other way out, so a dead character cannot lock the player out.
  - [ ] **RAW tail:** taking damage at 0 HP should add a death-save failure (two on a crit); we do
    not know crit-ness at the Damage button, so it needs its own think.
- [x] **UBUG-16 · Abilities now cost their action / bonus action.** The rule, since it decides what
  a resource chip DOES: with exactly ONE spend option, using the resource IS that action, so the chip
  runs it through `activateResourceOption` (validate → spend → charge the turn slot → run the
  token). With several options or none it only decrements — there is no single action to infer, and
  that doubles as the honest escape hatch for spending a resource on something unmodelled. An L2
  `available` guard is enforced INSIDE `activateResourceOption`, not in a `disabled` attribute, so no
  caller can route around it.
  - [ ] **Tail, pre-existing:** `gain_action` REFUNDS a spent action (`turn.action − 1`), so using
    Action Surge BEFORE you have acted burns a use for nothing. RAW it grants an ADDITIONAL action —
    a per-turn max bump, not a spent-counter nudge.
- [x] **UBUG-17 · Action/Bonus/Reaction pips look interactive, and all of them are** — every pill
  in that bar signals it the same way (hover + pointer + the global focus ring).
- [x] **UBUG-18 · Abilities block used a different background** than the panels around it.
- [ ] **UBUG-19 · Icons are DRAWN, never typed — replace every font glyph doing an icon's job
  (2026-08-09; scope and rationale corrected 2026-08-10).** It was filed as "three emoji to swap": the
  speed/movement field, the lightning by Bonus Action, the bug on the report button. A census says
  otherwise — roughly a hundred glyph-as-icon uses across `src/**/*.svelte`, led by `↻` (14), `∞` (13),
  `✕` (11), `⚠` (8), `🎲` (7), `☾` (7), `▾`/`▸` (12), `★`/`☆` (9), `⚑` (5), `✓` (4), `✎` (4), `✦` (4),
  `☀` (3), `⚙` (3), `🔍` (2). Bundle SVGs locally with attribution ([[charnik-icon-sources]]) — no
  emoji, no icon-font dep.
  **Why it is a correctness issue and not taste — three distinct failure modes, two of them hit for
  real while building the roll card (2026-08-10):** (1) **rasterisation** — a small filled glyph with
  no vertical stem has nothing to hint against, so `◆` at cue size came out a rounded blob; (2) **font
  fallback** — a glyph absent from the app's fonts is substituted from whatever the OS has, with
  different metrics, which is why `⇈` drew its two arrows at different heights; (3) **presentation
  drift** — codepoints like `⚠`, `☀`, `✦` render as colour emoji on one platform and monochrome on
  another, so the same UI is not the same UI. All three get worse as the display gets smaller or the
  page is zoomed out, which is exactly where a tracker gets used.
  **The rule (see AI-CONVENTIONS §4.7):** a character that is TEXT stays text — `−`, `≥`, `∞` inside a
  sentence are set at text size and the font was designed for them. A character standing in for an
  ICON is drawn instead: an inline SVG, or CSS geometry when the shape is trivial. The roll card's
  advantage cues are the worked example — three `clip-path` polygons in `currentColor`, exact
  geometry at a size we choose, no font in the path at all.
- [x] **UBUG-20 + UX-3 · One roll card everywhere, and its live controls — DONE 2026-08-10.** One
  `RollRow` is mounted by the toast, the Playbar, the roll log and the dice tray; the d20 pill cycles
  advantage → disadvantage → neither after the fact, and the damage pill rerolls.
  **Constraints later work must not undo** — each is stated at its own seam in code, listed here so
  nobody has to rediscover them: controls live in the Playbar and the log and NEVER in the toast (a
  toast expires mid-decision and click-anywhere dismisses it — `RollToast.svelte`); the reroll
  affordance is the damage PILL, not a bar or a row-click, because neither can say WHICH damage it
  means once a card has several (`RollLog.svelte`); and `onAdvantage` deliberately takes no attack
  index, so a per-attack chooser cannot ship before something actually rolls more than one attack
  (`RollRow.svelte`). Survey evidence: [`docs/research/roll-surfaces.md`](research/roll-surfaces.md).
  **Open tails:** an inert ↻ MARKER on the toast's pill (a cue, not a capability — the always-visible
  Playbar carries the live control on the same roll); the toast has no labelled close control, which
  is its own a11y nit since the card IS a labelled dismiss button today; the volley chooser waits on
  `ROLLER-N`. That an amendment never reaches the append-only `log.jsonl` is finding G in
  [`docs/ROLLER-PLAN.md`](ROLLER-PLAN.md), not a tail of this item.
- [x] **UBUG-10 · Spellbook "show on sheet" (eye) did nothing.** Fixed end-to-end via a persisted
  `ui.spellsHidden`; pins likewise persist in `ui.spellsPinned` (D3), no demo hardcode.
- [x] **REL-3 · Desktop content re-seed on update.** A `CONTENT_SEED_VERSION` marker re-seeds
  shipped files on update, preserving any the user hand-edited (hash drift). The "bump it whenever
  shipped SRD data changes" rule lives on the constant itself (`schema/version.ts`).
- [ ] **REL-4 · Content packs from a URL — update content independently of the app (maintainer
  2026-08-10; design settled in conversation, nothing built).** The ask: a Settings field where you paste
  a repo URL, and the app checks for (and offers) content updates, so a user isn't re-downloading and
  unpacking dozens of CSVs by hand. **The shipped SRD becomes one of these packs**, so rules data can be
  updated without shipping an app release.

  **Slice 1 SHIPPED 2026-08-10 — a pack is a folder, roots are discovered, not declared.** The
  hardcoded `CONTENT_ROOTS = ['content/srd-2024','content/srd-2014']` is gone: `discoverContentRoots`
  scans `content/` for folders (excluding the writable homebrew root), so the bundled SRD is simply
  the pack we ship and a folder dropped in beside it loads with no code change. Desktop scans the real
  directory; the web build's `FetchStorage.list` now reports the manifest's roots as SUBdirectories
  (it previously could not see a directory at all, so a `list('content')` came back empty);
  `tools/build-static-content.mjs` scans instead of listing roots too. `graph.packRoots` carries the
  discovered set so homebrew authoring still knows which files are pack-managed (it read the constant
  before). **Two findings worth keeping:**
  - **Root ORDER is load-bearing and was accidental.** The compendium never dedupes an article across
    editions — `groupRows` sorts stably, so the first root's rows head every list. Sorting roots
    alphabetically silently flipped every list from 5.5e to 5e (caught by `tools/visual/shot.mjs`, not
    by the 1084 unit tests). Discovery now sorts DESCENDING to keep 2024 ahead of 2014, which is a
    stand-in, not a rule: **the real fix is for the browse list to choose an edition explicitly rather
    than inherit filesystem order** — do that before packs can define overlapping articles.
  - Deleting a bundled pack still re-seeds it on next launch (`copyMissingRoots`), which is the
    "deleting or downgrading the SRD pack needs an answer" item below, now reachable from the UI-side.

  **Manifest-free by design** (the case that produced the general rule — **AI-CONVENTIONS §1.6**, "no
  manifests or index files: discover by scanning, describe in-band"). A sidecar `pack.json` was proposed
  and REJECTED: the project deliberately
  keeps data in CSV, and every `#content-*` header already carries what a manifest would —
  `#content-source` (pack identity, and the namespacing key), `#content-license` + `#content-url`
  (attribution), `#content-id` (a GUID), `#content-updated_at`, `#content-hash`, `#content-systems`.
  Consequences worth stating because they are BETTER than the manifest version, not merely equal:
  - **A pack is a FOLDER.** The one thing headers can't give is the file list; a folder listing filtered
    to files that parse as content gives it, with no new format. (Folder-per-pack also makes uninstall a
    delete, keeps the file × `source` two-dimensional filtering intact, and never mixes with homebrew.)
  - **Match remote↔local by `#content-id`, not by filename** — a pack that renames a file is still the
    same file, so a rename can't produce a duplicate.
  - **There is no pack version and none is needed.** `#content-hash` answers "did THIS file change",
    which is finer-grained than a pack semver AND lines up exactly with the per-file hand-edit check.

  **Network channel: Rust, not the webview.** `SECURITY.md` §5 states "No remote content loading" and
  the CSP governs the webview's network. The precedent to copy is §1's updater: an outbound HTTP
  *client* in Rust (`plugin-updater`), never webview `fetch`. Host allowlist in capabilities. Doing this
  via webview fetch would require relaxing a shipped security invariant — don't.

  **Applying is always a user action** (`SECURITY.md` §7, "never silent overwrite"). Content is rules;
  changing them mid-campaign unasked is the worst thing a tracker can do.

  **Hand-edited files: the rule already exists and is unit-tested — reuse REL-3.** This was flagged as
  the biggest risk in the design conversation and turns out to be solved: `seedShippedContent` rewrites
  each shipped file EXCEPT one whose body no longer matches its own `#content-hash` (drift ⇒ the user
  edited it ⇒ preserve, and HashDrift surfaces it). The pack updater must reuse that rule, ideally the
  same code path, not reinvent a merge strategy.

  **Other correctness items:**
  - **SRD keeps a bundled floor.** A fresh install with no network must still have content, so SRD ships
    in the bundle at `CONTENT_SEED_VERSION` (REL-3) and packs update *above* that floor. Deleting or
    downgrading the SRD pack needs an answer — the demo character depends on it.
  - **Removals break characters, additions don't.** Before applying, list the rows that disappear and
    which characters reference them. "Render what's possible + flag it" already exists, but the warning
    belongs BEFORE the update, not after.
  - **`#content-source` must be stable.** Identity is `source:id`; a pack that changes its source tag
    re-namespaces everything and breaks every character reference at once. Treat a changed source as a
    NEW pack, never an update.
  - **Atomicity + the watcher.** Per-file temp→rename exists, but a 12-file update that dies on file 7
    leaves an unresolvable root — needs pack-level all-or-nothing (or resumability), and the watcher must
    ignore the app's own writes (existing invariant) or a bulk update triggers a reload storm.
  - **No plugins in packs (v1).** Otherwise "paste a URL" becomes "run third-party code". The QuickJS
    sandbox and `PluginConsentDialog` exist, but a plugin is a separate consent category, not a silent
    passenger inside a content pack.
  - **No built-in pack directory.** "Paste a URL" is a tool; "browse popular packs" is a piracy index —
    PHB-as-CSV would appear in week one. Show `#content-license`, never host, mirror or aggregate a list.

  **Settings shape (maintainer-specified).** A dropdown that governs the NETWORK only — *don't check* /
  *check and notify* / *check and pre-download* — plus a manual button (global **and** per-pack, since
  "I want to test this one" is the real use) that deliberately bypasses the throttle. Config text states
  it plainly: **at most one update request per repo per day.** Naming matters: *download ≠ apply*;
  applying stays a click. If auto-apply is ever wanted it should be **per-pack**, for a pack the user
  explicitly trusts, never a global toggle. **Pins:** "don't update this pack" — a campaign in progress
  must not have its rules shift under it.

  **Rate limits are a non-issue if done right.** GitHub unauthenticated = **60 req/hr per IP**, but a
  `304` from `If-None-Match` **does not count against it** — so steady state (nothing changed) costs
  **zero quota for any number of packs**. One API call per repo
  (`GET /repos/{o}/{r}/git/trees/{branch}?recursive=1`) returns every path with its blob SHA, so one
  request says what changed; the CSVs themselves come from `raw.githubusercontent.com`, which is not the
  REST API and not on that budget. GraphQL could batch several repos into one request but **requires a
  token** — a dead end for an unauthenticated desktop app; don't re-propose it.
  The residual costs are NOT quota: a shared IP (office / CGNAT) burns first-run checks for everyone
  behind it; the check must never block startup or first paint; offline must fail **silently** after the
  first failure (no toasts — see UX-1: an error the user can't act on shouldn't jump at them); and
  **privacy** — pinging a third party on every launch contradicts the offline-first, no-account posture.
  **Privacy, not quota, is why the default is manual.** `ETag` / `lastCheckedAt` are local state and do
  NOT belong in the CSVs.

  **Don't build a GitHub client — build a fetcher for an HTTPS URL.** Self-hosting is a stated project
  value, and coupling the model to one forge breaks it for nothing. GitHub is then a convenience case:
  recognise `github.com/owner/repo`, derive the raw URLs, use the tree API as a per-host *optimisation*.
  The semantics stay in the CSV headers, so a plain static file server works too.

  **Interaction with the (still unbuilt) bundle export.** Bundle export is designed but NOT implemented
  (P7 `TODO`; the `character/schema.ts` comment says "a bundle export (later) embeds the rows") — so
  shape it already knowing about packs:
  - **A bundle that embeds rows redistributes third-party content, invisibly inside a JSON.** Worse than
    a pack directory because nobody sees it. `#content-license` makes the right behaviour automatic PER
    SOURCE: CC-BY / CC0 → embed, attribution preserved; unknown / all-rights-reserved / author-owned →
    record a *reference* to the pack instead and tell the user why. The sharer's own homebrew is theirs
    and gets embedded knowingly.
  - **Reference-mode bundles can pin `#content-hash`**, so import can report "built against SRD 5.2.1 @
    `abc`, you have `def`, 3 referenced rows differ". Real reproducibility, free, because the hashes are
    already there.
  - **Open question, decide when building:** do embedded rows on import become a real content source
    (colliding with the user's own packs through `source:id`) or a character-scoped overlay? Leaning
    overlay plus an explicit "add to my content" action — silently injecting foreign rows into the shared
    pool is a surprise.
- [x] **REL-1 · Linux release build** — `release.yml` matrix (ubuntu + windows, `max-parallel: 1`
  so the legs merge into one release). AppImage is the auto-updatable target, `.deb` a plain
  installer; rpm omitted (no `rpmbuild` on the runners), macOS deferred on notarization.
- [x] **A11Y-1 · Dialog focus management.** `trapFocus` on every dialog. **Deliberately NOT
  trapped:** `CommandPalette` (it restores focus itself — a second restorer fights it) and the
  combat popovers, which are anchored menus rather than modals.
- [ ] **REL-2 · Package-repo distribution channels.** Beyond GitHub Releases, ship Charnik through
  the platform package managers so users install/update the native way. Target set (decided):
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
- [x] **SEC-2 · Every `{@html}` goes through the sanitizer** — no hand-rolled escaping; see
  `docs/SECURITY.md`.
**Data versioning (DECIDED 2026-07-06 — design below; surfaced in the refactor, 2026-07-05):**
- **DATA-VER-1 · content versioning — BUILT (2026-07-06, tasks 1–5).** Design-of-record: a
  `#content-<key>:` directive header block (leading comment lines before the CSV column row) carries
  per-FILE `type`/`source`/`systems`/`url`/`license`/`id`(uuidv7)/`updated-at`/`schema`/`hash` — the
  per-row `source`/`systems` COLUMNS are dropped (the file is the unit of source+edition; split files
  for mixed). Shipped: `content/meta.ts` (`parseContentDirectives` / `checkFileMeta`→`MetaIssue`),
  `content/hash.ts` (`xxhash-wasm`, normalized-body `xxh64:` hash = the change DETECTOR, Excel-resave
  safe), `FileEntry.mtime`, all SRD CSVs migrated (2815 rows, 0 metaIssues / 0 drift), and the loader
  surfaces `graph.metaIssues` / `driftItems` → `ContentMetaModal` (missing required source/license)
  + `HashDriftModal` (body edited after the last stamp), per-session dismiss. Missing meta never
  hard-blocks — machine keys (id/hash/updated-at/schema/type) auto-fill; human keys (source/license)
  prompt; a missing `systems` defaults to both editions. **OPEN (task 6):** the modal confirm actions
  (`onFillAndSave`/`onUpdate`) still only DISMISS — the directive write-back (atomic BOM+CRLF,
  watcher-ignored, app-writable files only), the Settings "content-editing mode" auto-stamp toggle,
  the in-app authoring stamp, and per-type `CONTENT_MIGRATIONS` via `migrate()` remain to wire;
  `CONTENT_SCHEMA_VERSION` is exported but not yet consumed by a content migration. Web is read-only
  (detect, no write-back). Git holds the full design log (per-key rules, fill-classes, drift copy).

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
- [x] **The rest of the L1 vocab is mechanically applied** — see `docs/EFFECTS.md`.
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
    Initiate), skill/tool CHOICE grants (Skilled — needs a choice UI too).
- [x] **Plugin sandbox** (QuickJS-WASM) — see `docs/PLUGINS.md`.
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
  Fix = teach `convert-2014.mjs` to parse the per-class Features tables' "Cantrips Known" / "Spells Known"
  columns and emit the rows (the same shape 2024 already ships). Fiddly only because those tables are
  space-aligned text — assert per-class counts against the source, since wrong numbers here ship silently.
  Also still open: backfilling the truncated 2014 class-feature prose.
- [~] **Combat UI**: multiclass DC + header **DONE** — `SpellsPanel` renders every caster class's
  save DC / attack (A18-tail), and the sheet header (`combat.className`) now joins all classes
  ("Wizard 2 / Fighter 3") instead of `classes[0]`. **Still open [ ]:** pact pool as a distinct
  short-rest pip section; spell picker preview (EntryList+WikiDetail on pick).

**Platform / content:**
- [x] **Tauri fs Storage** impl + platform factory.
- [~] **Content-type identification** — loader `#charnik-type: <type>` first-line directive DONE
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
  the `source` value itself stays exact for attribution ([[friendly-source-labels]]).
- [ ] **CSS class-naming rename pass** — the combat sheet has cryptic classes (`.ae`, `.aedot`,
  `.mcell`, `.sk`, `.atk`, `.an/.ah/.ad/.am`, `.hpadj/.hpbtn`, `.combatsw`, …) that read poorly and
  invite collisions (already hit `.combat`, `.modrow`). Rename to verbose, self-evident, kebab-case
  names with a feature prefix; do it opportunistically per file when touched, not big-bang. New code
  already follows this (`modifier-row`, `modifier-amount`).

**Refactoring debt (self-flagged — patterns that drifted from "this is TypeScript, model it"):**
- [x] **R1–R5 · Typing/extraction refactors.** `EditContext` for edit/level-up state; typed
  `overlay.kind`; a named action-economy slot type; effect-token parsing centralised on the bounded
  vocab; the click-to-set pip helper extracted (`pipClick`).
- [~] **R6 · Source-tag constants** — mostly MOOT. App code already uses consts (`HOMEBREW_SOURCE`,
  `SOURCE_LABELS` keys, a local `S` in demo/sheet); the raw `'SRD 5.x'` strings that remain live in the
  edition-SCOPED converters (each `.mjs` emits one edition, declared once) + per-file test `S` consts,
  where a shared TS const can't reach cleanly. Low value; leave.
- [ ] **R7 · Strict/Free as a named mode** — NOT DONE (optional, low priority). `strict: boolean` is
  self-documenting and works; deferring.
Done R1–R5 as a focused pass (typos, duplication, drift). R6 moot, R7 deferred. (The R1–R7 +
CH1–CH14 call-chain and per-file audit checklists were COMPLETE 2026-07-11/14 — the done log lived
here and was removed in the 2026-07-27 plan trim; git holds the detail.)

### Compendium-editor refactor set (planned 2026-07-09)

A coordinated set: split the wiki detail into components, type the loader properly, and harden
the lint gate. The WikiDetail decomposition + RollButton shipped (see WD-1 below; live shapes in
`docs/SURFACE.md`). Ordering + open decisions below.

- [x] **WD-1 · Split `WikiDetail`.** Read + translate parity only; `editor` mode stayed a stub.
  **Unverified note carried from that pass, worth checking when next in there:** the Cast action was
  said to render only in the generic branch, so a spell in the Spellbook may never show it.
- [x] **WD-2 · Extract `RollButton`** — the shared roll affordance.
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
- [x] **LOC-CHECK · Flag partial/mis-filled translations.** A loader WARN issue, never a throw —
  the same channel as a bad row. A fully-untranslated row stays silent: EN fallback is the contract.
- [x] **LOC-STATUS · Tracked per-locale localization status.** `loc_status_<loc>` column, an open
  enum (`not_started|machine|started|reviewed`) whose members drive the marker + control
  automatically — add a member and it appears (`content/schemas.ts`).
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
7.5 **Frontend architecture** — component tree, sheet layout, props from core types,
   store/`$derived` wiring for live switches. (UX pattern contract → `AI-CONVENTIONS.md` §4.6;
   live component inventory → generated `docs/SURFACE.md`. `FRONTEND.md` retired 2026-08-04, its
   living contract folded into AI-CONVENTIONS, its inventory superseded by SURFACE.md.)
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

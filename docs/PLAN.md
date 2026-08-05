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
  - [x] **Editor** (`4423e9d`) — token→value form over `THEMEABLE_TOKENS` (native color picker for
    color tokens, free-form text for overlay/shadow), seeded self-contained from the base via
    `snapshotBaseTokens` (a custom `[data-theme]` can't inherit another theme by cascade); live
    preview (verified: edit accent → applies with no reload).
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
- [ ] **MAGIC-ITEM-EFX · Tokenize the shipped SRD magic-item effects (GLOBAL content task,
  surfaced by DEMO-1 gap 2, 2026-08-04).** The `item` schema already carries an `effects` column and
  equipped/attuned effects already flow through `gatherEffects` → AC/attacks/saves re-derive — but
  **every shipped SRD magic-item row leaves `effects` EMPTY**, so an attuned item (e.g. Cloak of
  Protection, Ring of Protection) shows its attunement slot + prose yet gives NO derived bonus. Task =
  author the bounded-vocab tokens on the SRD magic items whose mechanics ARE expressible today
  (`flat_bonus:ac+1`, `flat_bonus:saves+1`, resist/immune, `set_override`, `grant_resource`…), leaving
  the procedural ones as text fallback. Converter must PRESERVE authored item effects on re-run (same
  invariant as class_features / conditions) + re-stamp the content hash. RAW-faithful values only (never
  invent). This is what makes the demo's attuned Cloak actually read +1 AC/+1 saves; it's whole-content,
  not demo-specific.
- [x] **DEMO-1 · Showcase demo character: warlock/barbarian multiclass (user-decided
  2026-07-19; DEMO-SPECIFIC scope DONE 2026-08-04).** SEED REBUILT 2026-08-04 (`src/lib/demo/sheet.ts`):
  **Karroth the Red** — Tiefling (Infernal) · Soldier · **Warlock 5 (Fiend Patron) × Barbarian 3
  (Path of the Berserker)**, id `karroth`. Verified deriving against the REAL shipped SRD 5.2.1 graph
  (`missing: []`, `deriveIssues: []`): Rage max 3 (live `barbarian_rage` grant_resource token),
  Alert feat token (init +prof works), pact pool `pact-3`×2 forcedUpcast + warlock DC 13/+5,
  abilityBoosts (str/con), mixed Hit-Dice d12×3+d8×5, AC 14 (Shield of Faith +2 live), attuned
  Cloak of Protection, active concentration on Hex, inspiration. SRD-only. `browser.test.ts`
  updated (id/name). The demo is a normal seeded character; `recreateDemoCharacter()` restores it.
  **DONE this pass:** (a) **"Restore demo" button in Settings ▸ Data** (`StorageSettings.svelte` — a
  `pill-btn` row + `ConfirmDialog`, web + desktop; mirrors the `/dev` action). (b) **Gap 1 CLOSED** —
  pact pips now tracked in combat (see below). (c) **Visual baseline regenerated** for the Karroth
  persona (`tools/visual/baseline/*` — gitignored/local; the prior baseline still showed Valen, which
  is why roster/combat/spellbook all drifted). expertise intentionally DROPPED (no SRD producer on this
  pairing — Rogue/Bard only). The demo seeds first-run on web + desktop, so it IS the first impression
  of the system's scope.
  - **Gap ledger — status after the 2026-08-04 finish pass:**
    (1) ✅ **DONE — Pact pips tracked in combat.** `PACT_SLOT_KEY` const + `pactPool()`/`pactSpend()`
    in `rules/spellcasting.ts`; `slotToSpend` now spends the pact pool for a pure-pact caster
    (`{key:'pact'}` / block when empty / block above pact level). `buildSpellGroups` renders a rowless
    "Pact Magic · Nth" pip strip (excluded from `slotsByLevel`); `cast()` computes the forced-upcast
    slot level (no NaN). Browser-verified: strip shows 1 full + 1 spent; pip-click AND casting Hold
    Person both decrement. Tests updated (pure-pact spends; non-caster still null).
    (2) ⏭ **MOVED TO GLOBAL — magic-item effect tokenization (see MAGIC-ITEM-EFX below).** Every SRD
    magic-item row ships an EMPTY `effects` column, so the attuned Cloak of Protection shows the
    attunement slot + prose but gives NO derived +1 AC/saves. NOT demo-specific (the schema +
    `gatherEffects` flow already support it — only the shipped data is unpopulated).
    (3) **Unarmored Defense not tokenized** (`barbarian_unarmored_defense` empty) → the "armor vs
    unarmored" contrast can't be shown; moot while armored — folds into N2 (features-as-data).
    (4) **Invocations have no choice-group** (`warlock_eldritch_invocations` empty) → renders as prose,
    not pickable — N2 (choice groups, shape 3).
    (5) ⏭ **MOVED TO GLOBAL — subclass-feature tokenization = N2.** Fiend-patron features (Dark One's
    Blessing temp HP etc.) render as prose only until class/subclass features are authored as data (N2).
    (6) **`casterLevel` is 0** (barbarian non-caster) → the "pact pool ALONGSIDE shared-slot math" goal
    is NOT exercised by this pairing (accepted 2026-08-04 — kept warlock×barbarian over a caster swap).
    (7) ✅ **DONE — visual baseline regenerated** for Karroth (local; no committed screenshots exist).
  - **Ritual demo caveat (user 2026-07-20):** a base **Warlock does NOT have Ritual Casting** — only
    via the Pact of the Tome *Book of Ancient Secrets* invocation (then any-class rituals). So the
    A17 `R` badge (now gated on `class.ritual` — E7) won't appear on the warlock×barbarian build
    unless it takes that invocation. Either give the demo Book of Ancient Secrets, OR demo rituals on
    a Wizard/Cleric-flavored aspect; a ritual-tagged spell alone isn't enough. Use a REAL shipped SRD
    ritual (verify id ships + `ritual` tag; NEVER hand-author). Also fix the stale `fire-bolt` demo
    pin → `fire_bolt` (kebab, post-E3 never matches — ties D3: move the pin hardcode to persisted
    per-character `ui`).
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
- [~] **N4 · Skills system fixes.** (a) **DONE (2026-08-02):** `toggleExpertise` capped from data
  — a curated `expertise_slots` `level:count` column on class_features (ONE row carries the
  progressive grant: Rogue `1:2,6:2`, Bard `3:2,10:2` 2014 / `2:2,9:2` 2024, 2024 Ranger `9:2`;
  converter-preserved like `effects`). Build sums the active-feature grants → `expertiseCap`;
  Strict enforces (Free doesn't), UI shows `expertise N/M` + disables ×2 at cap. Wizard "Scholar"
  (1 restricted-list expertise) deliberately NOT encoded — the count model can't express the skill
  restriction, so encoding it would over-permit. Unit + real-content tests both editions. **UI not
  screenshot-verified in a Rogue state** (needs a build-flow drive). (b) effects integration:
  `grant:expertise` missing (EFX-1),
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

### Implementation order (current focus — set 2026-08-04)

Dependency-forced across the play-tracking ledgers. The linchpin is **N2 `onEvent`** — it gates every
event-driven recharge. **Decision 2026-08-04: start with N2** (it's needed by the later waves anyway,
so getting it ready first avoids a stall); **Concentration-save B4 is unblocked and can slot in at any
point** (it depends on nothing).

1. **N2 · `savage_attacker`** — small extension of the SHIPPED `onUse` executor: a damage roll-mode
   ("roll the pool twice, keep the higher") intent field + a once-per-turn `turn`-recharge gate. Warms
   up the onUse path with reusable primitives (`docs/N2-PLAN.md`).
2. **N2 · `onEvent` write-half** — the deferred half of the intent model (`docs/ACTIONS.md` §1/§4).
   Build it WITH its first consumer (below) so the executor isn't speculative.
3. **RECHARGE slice 2 · onEvent regain** — Persistent Rage / Uncanny Metabolism (initiative-regain);
   the first `onEvent` consumer, so 2+3 land together (`docs/RECHARGE-PLAN.md` slice 2).
4. **Concentration-save B4** — unblocked, universal, UX decided (`RECHARGE-PLAN` §6); do anytime.
5. **B25 subclass casters** → **D16 choice-UI → `magic_initiate`** → **RECHARGE slice 3** (item charges).
6. Content passes (MAGIC-ITEM-EFX, D6/D10/E4); **ARCH-1 i18n sweep**; then low/YAGNI (ARCH-4 spacing,
   B11, B24).

- [ ] **AUDIT-1 · Full-project audit backlog (2026-07-14) → [`docs/AUDIT.md`](AUDIT.md).**
  Whole-`src/` correctness pass: rules-math bugs (A1 heavy-armor AC, A2 multiclass HP —
  verified vs both editions), unfinished invariants (B1 effect expiry, B2 dead play fields,
  B5 source filtering only in compendium, B6 config → dataDir file, DECIDED), token/CSS
  violations, structure/size, data gaps (no 2024 languages CSV), semantic duplicates jscpd
  can't see (F1–F9: titleCase ×6, signed ×4, ability-list ×5…), plus the **effects-engine
  buildout plan (EFX-1..4)** — the vocab/gathering/catalog/lifecycle gaps behind "effects
  account for too little". Stable letter+number IDs; tick items THERE, graduate designs here.

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
- [ ] **ARCH-4 · stylelint spacing px-guard.** The `font-size:["px"]` guard is DONE + enforced (green).
  The spacing half (`padding`/`margin`/`gap` px → `--space-*`) is ~523 warnings: blocked on a design
  call — either add spacing-scale tokens for the off-scale values or migrate-with-screenshot-verify,
  not a blind sweep. Warn-only on 523 = noise that trains people to ignore stylelint, so it stays out
  until the migration is done as its own pass.
- [ ] **B25 / RV4 · subclass-caster spell list.** EK/Arcane-Trickster get slots/DC/cap, but their
  spell list is EMPTY — `buildSpellAccess` indexes only `class` rows. Add the subclass→list seam
  (the character-level access layer already designed under "Caster profile" / L6 / L12 above).
- [ ] **D16 · generalized player-choice model.** Half-feat ability-choice is DONE (§ Builder, 2026-08-02);
  still open: Magic Initiate spell picks + Skilled skill/tool-choice grants — both need the shared
  choice UI (see `docs/N2-PLAN.md` feat tail). One "player choice at a slot" abstraction covers all.
- [ ] **D6 / D10 / E4 · mechanics from prose → columns.** `effectHint`/`healDice`/`durationToRounds`/
  `castingIcon` hardcode spell names EN-only; most SRD spells still ship EMPTY `effects` columns (E4)
  so there are no tokens to summarize. Tracked live under UBUG-9 (the caption idea) — E4 is its blocker.
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
- [x] **UBUG-6 · Casting a spell doesn't consume a spell slot (reported 2026-07-19).** DONE 2026-07-20
  (AUDIT A17). `cast()` auto-spends the lowest available leveled slot (pure `slotToSpend`, unit-tested)
  via `play.spellSlotsSpent` and blocks with a toast when none remain; cantrips spend nothing; a slot
  is spent in AND out of combat (like HP). A RITUAL cast (the `R` badge, gated on `class.ritual`
  ritual-casting eligibility — E7) spends no slot. **Both former tails now CLOSED:** the manual upcast
  picker landed with the structured-upcast work (slot-picker overlay + ⇡ affordance, browser-verified);
  warlock PACT-slot pips landed 2026-08-04 (`031c944`, DEMO-1 gap 1) — the pact pool is spent on a
  pure-pact cast (`slotToSpend` → `{key:'pact'}`) and rendered as a "Pact Magic" pip strip.
- [x] **UPCAST · Structured spell-upcasting engine — DONE (was `docs/UPCAST-PLAN.md`, closed 10/10, folded
  in here 2026-08-04 when that plan doc was retired).** Whole vertical slice engine→data→UI, ~985 tests.
  **What shipped:** one `upcast` column on `spells.csv`, token = `kind:formula` (several via `;`), parsed
  by the existing effect grammar (`splitGuard` on `?` + the token-parser slot-discipline — NO naive
  `split(':')`, verified there's no `?:` ternary so `:` is structural-only); `per_slot(amount[,step])`
  sugar over the effect evaluator; eval is CAST-EPHEMERAL (`{slot, spell_level}` ctx built in the VM
  cast methods, NEVER in derive — a persistent `slot` would break BUILD/PLAY separation). Slot picker
  (overlay + ⇡ affordance + per-slot `castPreview`); multitype damage via `SpellRow.damageParts`
  (ice_knife done — the old "SpellRow flattens" note was superseded); hp_max/temp_hp/`enhancement`
  (Magic Weapon +n) scale a spawned effect's magnitude through the same seam; count/area chips; roll-log
  provenance line ("Xd base + Yd @ slot N"); concentration timer + tails (see the CONCENTRATION entry
  below, Model C). **Key LOCKED decisions (kept here so the "why" survives the doc's deletion):** (1) combine =
  DELTA for structured kinds (`base+delta`, base is the single source), ABSOLUTE for count/duration; `inf`
  only ever in `duration` so `base+inf` can't happen by construction. (2) `cantripDieMultiplier`
  (`spellcasting.ts`, the 5/11/17 tier) is RETAINED, NOT folded into `upcast` — the cantrip tier is a
  UNIFORM system rule (rules-core), `upcast` is per-spell data; different axes (char_level vs slot),
  merging would be a regression not a dedup (H7 reappraised). (3) N6 — upcast is NOT gated on the
  auto-calc toggle: that toggle gates effect-MODIFIER layers (Bless/Rage/conditions), not a spell's own
  mechanic, so `castCtx` is always built (from base state even when auto-calc is off). Dice-upcast works
  off; effect-magnitude upcast (Aid, Magic Weapon) is inert off because its spawned tokens are effects.
  (4) Conjure* tables + meta-rules (Dispel Magic, Globe) stay prose `higher_level` — not number-scaling,
  a permanent exclusion, not a bug. **OPEN tails (deferred, NOT blockers — the reason this became a
  backlog entry rather than staying closed-in-its-own-doc):**
  - [ ] **UPCAST-ROLLER (was D14) · multi-instance per-instance roller.** The `DiceTrayRequest.instances`
    contract is fixed but the roller loop is unbuilt, so `count`-scaling spells (Scorching Ray, Magic
    Missile, Chain Lightning, Eldritch Blast beams) degrade to an "N×" chip + a manual roll rather than N
    independent to-hit+damage sub-rolls with per-target assignment. Same gap makes the Magic Weapon
    `enhancement` tokens UNTYPED (`flat_bonus:attack/damage+n` buffs ALL the caster's weapons + slightly
    their spell rolls) — a weapon-scoped flat DAMAGE bonus isn't expressible without an L1 grammar change
    (a `compatibility.md` chokepoint), and there's no per-instance weapon target yet. Ties
    [[charnik-dicetray-attack-damage-concept]]; the roller rework is its own item.
  - [ ] **UPCAST-AUTHORING (was N8) · guided upcast-token builder** in `EditContentForm` (form → token),
    so a non-technical author never hand-writes `per_slot(1d6)` (CLAUDE.md "everything from the UI"). v1
    ships a raw `upcast` text field (like the effect-token field); prose `higher_level` stays the fallback.
  - [ ] **UPCAST-INVOCATION-SCOPE · invocation effects scoped to a spell** (Agonizing Blast +CHA/beam,
    Eldritch Spear range) — NOT upcast/scaling but a per-instance effect keyed on `spell_id`, reusing the
    `attacks.ts` §A/§B scope mechanism extended from weapon-category to `spell_id` (no need to enumerate
    feats — each is "a scoped effect on a spell"). Rides the roller's per-instance path; also the
    mechanical half of DEMO-1 gap 4 / N2 invocations.
  - [ ] **UPCAST-DURATION-TAIL · Geas/Dominate multi-day durations.** Expressible via `duration:step`, but
    low value in the rounds canon (30 days = 432000 rounds) — a curated follow-up, not a blocker.
  - [ ] **UPCAST-PREVIEW-TOOLTIP · pre-cast per-slot preview** ("5th: 10d6, 6th: 12d6") before choosing a
    slot. v1 ships the picker + an on-select `castPreview` only; a hover tooltip over the whole ladder is
    the nicety left.
- [x] **CONCENTRATION · Concentration timer + end-points — DONE (was `docs/CONCENTRATION-PLAN.md`,
  fully implemented, folded in here 2026-08-04 when that doc was retired).** **Model C** (the load-bearing
  decision worth keeping): `play.concentration` stays a `string | null` **ref** — the timer lives on a
  **carrier effect** in `play.effects` (`source = ref`, `durationRounds` + `startedRound`), so concentration
  is "a ref to its own timer-effect", NOT a separate clock. This reuses the existing effect-expiry +
  duration-UI (editing the carrier's `durationRounds` IS editing the concentration) — zero migration, no
  `schemaVersion` bump. The one code change was: **always create a carrier for a concentration spell, even
  token-less** (empty `effects: []`, just timer + source), which gave token-less control spells (Hold
  Person, Web) a timer. (Rejected Model A — concentration owns a separate clock — needed a display/edit
  proxy + a new expiry path; C added ~1 line.) **All end-points shipped:** timer expiry → `concentration =
  null` (`economy.svelte.ts`); replace on a new conc-cast; manual drop (tap the `◎ Concentration` badge,
  `EffectsPanel.svelte`); long rest; **0-hp / incapacitated → `endConcentrationIfBroken`** (reactive
  `$effect`, `state.svelte.ts` + `combat/+page.svelte`); **CON-save-on-damage = a toast REMINDER** (DC
  `max(10, ⌊dmg/2⌋)`), never an auto-drop — the play-tracker "surfaces, never forces" principle
  ([[play-tracker-surfaces-never-forces]]). Duration-upcast feeds `carrier.durationRounds` (Hunter's Mark
  8h→24h). Duration canon = **rounds** (`rounds→human` is a display formatter); `inf` → indefinite (null).
- [x] **UBUG-7 · Effect (i) rules text renders raw, not Markdown/HTML.** DONE 2026-07-21. Extracted the
  compendium's marked+DOMPurify pipeline into a shared `content/markdown.ts` (`renderContentMarkdown`)
  reused by `ArticleProse`; the effect ⓘ box (`PanelCard.svelte`) now renders through the `ArticleProse`
  component itself, so Markdown/sanitized-HTML formatting + styling match the compendium (no dup CSS).
  Enabled `breaks: true` in the shared renderer so CSV cells that use `•` + hard newlines (conditions,
  items, feats) keep line-per-bullet layout instead of collapsing (blank-line paragraphs unaffected).
- [x] **UBUG-8 · Resources should be highlighted + used like spells.** DONE 2026-07-21. Added
  `ResourceTracker.useResource(id, max)` — the resource analogue of casting a slot: spends the next
  unit (`resourcesSpent`+1), BLOCKS with a toast when exhausted, and toasts the remaining count on use
  (ties UBUG-5). The resource NAME is now a clickable "use one" button (highlighted on hover like a
  spell row — reuses `.spell-row:hover` surface-2) in BOTH render sites (`PanelCard` resources section
  + top `ResourceBar`); the pips stay for manual restore / arbitrary set (`resourceClick`), exactly as
  spell-slot pips sit beside a castable spell row. Unit-tested (use spends one, blocks at max, no
  overspend). Action economy is intentionally NOT wired (resources carry no action-cost data).
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
- [ ] **UBUG-12 · Roll feedback is hard to read — rework the toasts / roll surface (2026-08-05).** Rolls
  report through svelte-sonner toasts; the kept/dropped advantage dice + per-type damage breakdown +
  totals are cramped and hard to parse at a glance. Redesign the roll output for readability (a clearer
  roll-result card / dice-tray result / restructured toast) so a to-hit, its dropped die, and typed
  damage read cleanly. Some toasts elsewhere likely want the same pass. Cross-ref the roll log + DiceTray.
- [ ] **UBUG-13 · Level-up re-offers ASI and DOUBLE-applies it (not filled/persisted; 2026-08-05).** On
  the level-up page an ASI/feat slot opens EMPTY every time, so re-selecting an ASI adds its ability
  increase AGAIN (stacking on the sheet) and lets you re-pick a slot already spent. The chosen ASI/feat
  per level-slot must be PERSISTED (shown filled on open, applied once) so re-opening level-up can't
  re-grant it. Relates to the build ASI → `abilityBoosts` flow + the per-class feat-slot model.
- [x] **UBUG-10 · Spellbook "show on sheet" (eye) did nothing — hidden spells still showed in
  combat.** DONE 2026-07-21. The spellbook's eye/pin were local `$state` sets on a THROWAWAY
  `demoCharacter()` (never persisted, never read by combat), and `buildSpellGroups` rendered every
  `build.spells` row — so hiding a spell had no effect on the sheet. Fixed the HIDE path end-to-end:
  new persisted field `ui.spellsHidden` (effectiveIds; zod-defaulted so old saves load, no migration);
  the spellbook now edits the ACTIVE character (`characters.active`, demo fallback on direct nav) and
  the eye writes/saves `spellsHidden`; `buildSpellGroups` filters those out (matched on `SpRow.ref` =
  effectiveId). Prepare toggles now persist too. Unit-tested + e2e-verified (hide in spellbook →
  vanishes from combat, live via the shared store). PIN stays a local set — its combat side is still
  the `CombatVM.pinned` demo hardcode (**D3**); wiring pin end-to-end is left to D3.
- [x] **REL-3 · Desktop content re-seed on update (0.4.0 data change).** DONE 2026-07-20. The desktop
  seed (`content/provider.ts`) was skip-if-root-exists → a returning user stayed on their FIRST-run
  SRD copy and never got shipped data changes (0.4.0 redid a lot: snake_case ids, snake `#content-`
  headers, regenerated CSVs). Fixed with a `CONTENT_SEED_VERSION` marker (`content/.seed-version`,
  outside the scanned roots): on an install whose on-disk version is older (or absent — every pre-0.4.0
  install), `seedShippedContent` REWRITES each shipped file with the new bundled copy, EXCEPT one the
  user hand-edited (its body no longer matches its own `#content-hash` → drift → preserved, and the
  existing HashDrift flow still surfaces it). Homebrew + characters are never touched (different roots);
  character refs already migrate kebab→snake (v1→v3). WEB needs nothing — it always fetches the fresh
  deploy. Unit-tested over two MemoryStorages (first-run / overwrite-untouched / preserve-edited /
  up-to-date-noop). **Bump `CONTENT_SEED_VERSION` whenever shipped SRD data changes.**
- [x] **REL-1 · Linux release build.** (2026-07-21) `release.yml` is now a `strategy.matrix`
  (`ubuntu-22.04` + `windows-latest`, `max-parallel: 1` so the two legs merge into one release +
  `latest.json` instead of racing). The Linux leg apt-installs the Tauri v2 deps
  (`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `patchelf`,
  …). Widened `src-tauri/tauri.linux.conf.json` `targets` to `["appimage", "deb"]` (Tauri auto-merges
  it on the Linux leg) — AppImage is the auto-updatable one (its `.sig` feeds `latest.json`), `.deb` is
  a plain installer. **rpm omitted**: needs `rpmbuild`, absent on GitHub runners (add it + widen the
  targets later if Fedora demand appears). macOS still deferred (needs Apple notarization/signing,
  $99/yr, else Gatekeeper warns).
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
  amount) → `flat_bonus` token, applied live via the reactive sheet.
- [x] **Mechanically apply the rest of the vocab** — DONE. `advantage` presets adv on the roll;
  dice bonus (`+1d4` Bless / `−1d4` Bane) is rolled into the total; `grant_proficiency` grants
  skill/save proficiency; `resist_immune` collects damage defenses (shown on the sheet);
  `apply_condition` expands to the referenced condition's own tokens. All gated on the effects-auto
  toggle. (flat_bonus / set_override were already applied.)
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
- [x] **Plugin sandbox** (QuickJS-WASM) for exotic homebrew logic — **BUILT** (PLG-1..3, 2026-07-19;
  full QuickJS-NG-in-WASM host with PLG-SEC containment, 58 tests). Details in the "PLG · Plugin
  sandbox (L3 expressiveness) — BUILT" section above. Open tails are only the plugin-dependency
  notification view + portability/version awareness — NOT the sandbox itself.

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
  Remaining: 2014 **class_casting** counts (cantrips/prepared differ by edition — 2024 uses table
  columns, 2014 uses per-class formulas → the rules layer needs the 2014 formula), and backfilling
  the truncated 2014 class-feature prose.
- [~] **Combat UI**: multiclass DC + header **DONE** — `SpellsPanel` renders every caster class's
  save DC / attack (A18-tail), and the sheet header (`combat.className`) now joins all classes
  ("Wizard 2 / Fighter 3") instead of `classes[0]`. **Still open [ ]:** pact pool as a distinct
  short-rest pip section; spell picker preview (EntryList+WikiDetail on pick).

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
- [x] **R4 (CH2) · Centralise effect-token parsing** — the bounded-vocab regexes (`flat_bonus:…`,
  `grant_resource:…`, `grant_proficiency:…`, advantage/dice) are re-implemented in `effects/index.ts`
  (parseEffect/collectResources), `derive.ts` (abilityBonus + grant_proficiency scan), `combat/
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
Done R1–R5 as a focused pass (typos, duplication, drift). R6 moot, R7 deferred. (The R1–R7 +
CH1–CH14 call-chain and per-file audit checklists were COMPLETE 2026-07-11/14 — the done log lived
here and was removed in the 2026-07-27 plan trim; git holds the detail.)

### Compendium-editor refactor set (planned 2026-07-09)

A coordinated set: split the wiki detail into components, type the loader properly, and harden
the lint gate. The WikiDetail decomposition + RollButton shipped (see WD-1 below; live shapes in
`docs/SURFACE.md`). Ordering + open decisions below.

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
  content-health. Low-noise by construction. (A mis-fill signal — orthogonal to the tracked **LOC-STATUS**
  below, which is a per-locale workflow state the user sets, not a completeness check.)
- [x] **LOC-STATUS · Tracked per-locale localization status (translate view)** — DONE 2026-07-19. Each
  content row carries a tracked localization status PER target language, set + shown in `/translate`:
  **not_started / started / machine / reviewed** (UA «Не почато» / «Почато» / «Машинний переклад» /
  «Вичитано»). Stored **in-file** in a `loc_status_<loc>` column via the SAME write-path as prose
  (`saveLocStatus`, re-stamps `#content-hash`; the loader re-attaches it like the prose columns). The
  vocabulary is a `LOC_STATUS` const (schemas.ts) — **extensible**: a new member + a marker glyph + a
  `translate.status.<x>` i18n key auto-appears in the control + list marker (both iterate
  `LOC_STATUS_ORDER`). `reviewed` and `machine` are set **only explicitly**; an UNSET column DERIVES a
  default from prose coverage (no prose → not_started, some → started), so legacy already-translated rows
  read right and pristine rows need no write. The **source language is always `reviewed`** (virtual),
  read from a per-file `#content-source-lang` directive (default `en`) threaded onto `LoadedRow.sourceLang`
  — so "en isn't always the source" needs no data write. The old `translationStatus` coverage fn was
  renamed `translationCoverage` (now the private default-deriver + content-health helper); the list
  marker + header switched from coverage (○~✓) to the tracked status. Tests: loader (col re-attach,
  source-lang, no phantom locale) + translate (`locStatus` precedence, `saveLocStatus` write/re-stamp).
  **Boundary:** single-value column (one status per locale); orthogonal flags (e.g. `outdated` AND
  `reviewed`) would be a later multi-column change. Chrome copy in the view stays hardcoded-EN (pre-
  existing; only the status labels went through i18n).
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

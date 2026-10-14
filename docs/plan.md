# Charnik — D&D Character Tracking System (Plan)

> Index doc. Companions: [testing.md](internals/testing.md) · [security.md](internals/security.md) ·
> [research/existing-generators.md](./research/existing-generators.md). Frontend UX pattern
> contract → [internals/ui.md](internals/ui.md) ▸ The UX pattern contract; live component inventory → generated
> [surface.md](./surface.md).

## Context

FOSS, **standalone desktop (Tauri)** app for
D&D **5e (2014) + 5.5e (2024)**. **Scope is a full character TRACKING system**, not just a
sheet generator. Three roles in one UI:
1. **Build & level-up** — create a character and advance it level by level.
2. **Play tracking** — live state during play (HP, slots, resources, conditions,
   concentration, rests, XP…).
3. **Compendium / database browser** — view, search, sort everything loaded from CSV.

Core intent:
- **Standalone desktop app (Tauri)** — the 99% use case; data is **local files on disk**.
  **Windows + Linux** (macOS ~free). **No HTTP server** → reaching your own data over LAN or remotely is **not** a
  goal; players linking their apps at one table is a layer of its own (TABLE-LINK-SPEC). **Responsive** kept as a light nicety (window resize), not a phone-over-LAN driver.
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
  declaration) · **bundled data = CC-BY-4.0** (`LICENSE`
  + `ATTRIBUTION.md` in `charnik-content-srd`, WotC SRD credit) · **user homebrew = author-owned** (app
  relicenses nothing). Summary lives in root `COPYING.md` + README "Licensing".
- **Per-source license metadata**: every `source` carries its own `license` +
  `attribution` columns in the content model, so shipped SRD (CC-BY) and community/homebrew
  sources (any license) coexist and the About/Compendium UI can credit each correctly.

---

## Effects & modifier engine

The pivotal design: derived stats update automatically from species traits, class features, feats,
equipped items and conditions, and the player can see and trust what happened. It is a **bounded
vocabulary of interpreted data, never code in a CSV**, folded through ONE stacking pipeline, and it
is **removable** — the core computes base stats without it and every value keeps the same
`{value, trace, notes}` shape whether effects are on, off, or the module is deleted.

That is the whole of what belongs here. The normative spec — the token vocabulary, the L2 formula
grammar, the derive pipeline, the state model, and the reasons behind each — is
[`internals/effects.md`](internals/effects.md), with [`plugins.md`](internals/plugins.md) for L3 and
[`security.md`](internals/security.md) for why content is never executed.

## Feature requirements

### Calculators / automation
- Point-buy stat generator (5e.tools-style) + standard array + manual/rolled.
- Ability modifiers auto; **proficiency + expertise** toggles on skills/saves.
- ASI from correct source per system (5e: species; 5.5e: background) + level-up
  ASIs/feats. **Feat/ASI slots are per-class at class-specific levels** (Fighter
  4/6/8/12/14/16/19; most 4/8/12/16/19; Rogue +10); prerequisites respected.
- **Free-feat mode**: default RAW; user may add extra feats at ANY level (house rule);
  RAW slots vs free additions tracked distinctly.
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
- **XP tracking** — **fully optional**: `play.xp` + a per-character `ui.levelingMode`
  (`milestone` | `xp`). In `xp` mode accumulated XP is tracked against the edition's own
  advancement table and the sheet marks a level as EARNED; taking it is the level-up flow, because
  a level asks questions only the builder can take answers to. Milestone mode ignores XP.

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
death saves; **proficiency bonus**; passive senses; conditions. **Heroic Inspiration is
deliberately NOT tracked**: the roller already lets a player amend any landed d20, which is the whole
of what spending it does, and a flag whose only effect is to unlock a second way to do that is a
control that earns nothing.
Attacks: name, atk/save bonus, damage & type, **mastery (Прийоми)**. Spellcasting:
ability mod, save DC, attack; slots (lvl 1-9, total/used); spells table (level, name,
casting time, **concentration/ritual/material К/Р/М**, notes, prepared/known). Inventory
w/ per-item weight → totals + (optional) capacity; **attunement (3 slots)**; currency
cp/sp/ep/gp/pp. **Optional appearance** (age, height, weight, eyes, skin, hair, marks).
**Notes** (free-form). UA official terms (CON = Статура) seed the `uk` locale.

**Separate sections — NOT one blob**: Class features · Species traits · Feats ·
Armor/weapon proficiencies · Tool proficiencies · Languages — each its own section.

**Attacks — proficiency model:** `classes` carry `weapon_profs`/`armor_profs` (normalized
categories + specific weapon ids). A weapon you lack proficiency with drops the proficiency bonus and
says so; worn armour you lack proficiency with blocks spellcasting and says so. A class that declares
no proficiency column stays proficient with everything — old homebrew is never wrong-downward.

### Compendium / browser
- Browse every content type. **Search respects active system, or across both** when the
  user picks "all". Sort/filter: spells by level/school/(class, casting time…); generic
  sort/filter elsewhere (groupings: level/school/source/A–Z + school/source facets + edition; the
  class and casting-time spell facets are an optional nice-to-have).
- **Content-health view** (Settings ▸ Content health): diagnostics over loaded content — broken
  references, missing translations, ID collisions, malformed rows. Valuable since content is
  user-edited.
- **Two-dimensional source filtering + collision resolution.** Settings ▸ Sources (per-source and
  per-file switches; a row shows iff its file AND its source are enabled) and ▸ Collisions (the same
  `type:id` overlapping an edition → keep-all / keep-one, the `collisions.json` resolution). It is
  browse-layer only — the loader's graph is untouched, so it is live and never drops data.
- **Settings ▸ Themes.** Users author their own colour themes without a rebuild: clone a built-in,
  edit its tokens, export or import one as a file. Colours only — `internals/ui.md` ▸ Theming.

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
  (debounced; manual refresh fallback).
- **System is a property of the CHARACTER, not a free toggle.** A built character is
  **bound to the system it was created in** (stored in its JSON) and always renders in
  it — you don't reinterpret a 5e character as 5.5e. The active-system switch only sets
  the **compendium/creation** context. **Converting a character between systems is OUT
  of scope** (mechanics differ too much); a character stays in its system.
- **PWA deferred** (not dropped): it would add install and an offline shell to the web demo, and
  the demo keeps nothing a player returns for.
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

## Implementation order

**The open items live in [`docs/work/`](work/), one file per subject; this section is the ORDER they
are done in.** A wave names items, never files — an item moves between waves as priorities change,
and its file does not move with it.

| file | what is in it |
| --- | --- |
| [work/roller.md](work/roller.md) | the roller and every surface a roll appears on |
| [work/ui.md](work/ui.md) | screens, the builder, accessibility, UI copy |
| [work/mechanics.md](work/mechanics.md) | rules core, effects, features, resources, play state |
| [work/content.md](work/content.md) | shipped rows, converters, packs, versioning |
| [work/authoring.md](work/authoring.md) | compendium editor, homebrew, drafts, translation |
| [work/code-quality.md](work/code-quality.md) | repo-wide typing, lint, refactoring debt |
| [work/release.md](work/release.md) | packaging, distribution, dependencies |

The order the maintainer and Claude are actually working to. Wave = a coherent chunk, not a sprint,
named after what it does rather than numbered — the order is this list's order, so a wave that
closes leaves the list and nothing else is renamed. The SEQUENCING REASONS matter more than the
position and are given per wave, because most of them were learned the hard way.

- **The release gate — three clauses, and they stand for every version.** What blocks a release is
  **a number we know to be wrong**, **a path a user can start and cannot finish**, and **shipped
  content that visibly does nothing**. A release that ships with one anyway says so in the changelog
  rather than letting a player hunt for it.
  Half the gate is automated, because what a hand pass found twice running was the same thing — a
  mechanism built and never given its first consumer, the worst kind of done, since the suite is
  green and the player sees nothing. Two assertions over the shipped packs hold it now: **every
  effect KIND has a shipped row** (with a pinned list of the three that legitimately have none, each
  carrying its reason), and **every shipped token names a TARGET the sheet consumes**. Losing the
  last user of a kind fails loudly instead of quietly.
  **An absent feature is not a wrong number**, and blocks nothing. `versatile:1d10` ships on every
  weapon and is read by nothing; the Champion's crit threshold cannot be got wrong because the app
  never decides a crit at all. Each is a grip or a choice the PLAYER makes, so each wants state and a
  control before it can mean anything.
- **What a release runs before it is cut** is the routine, not a wave: `work/release.md` ▸
  AUDIT-DRIFT, the full `pnpm lint:typed`, the version in three files (`package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) and the changelog's top heading. Open work a
  release ships without is named in that release's changelog, where a player would look for it.
- **0.9.0 · the short queue, and it is an ORDER rather than a wave.**
  1. **DEFENCE-STRIP** — `ui.md`. The strip is one component on both screens, groups named for what
     MOVES and the qualifier in the chip; the `Saves` group has not found its formatting. The
     maintainer redraws the mock, and nothing is built until it exists.
  2. **The log, reworked: LOG-EVENTS** (`roller.md` — what it holds) **with COMBAT-RAIL ▸ 1**
     (`ui.md` — where it stands). One change, because what makes the log worth a pinned rail is that
     it finally says what happened in a turn rather than only what was rolled.
  3. **ITEM-INSTANCE** — `ui.md`. A `+1/+2/+3` item is picked as the one you found and named as
     itself in the inventory ("Longsword +2"), not carried as the book's generic heading with
     dropdowns on the row.

  **Deliberately not in a wave:** RULES-TEXT, which is transcription from the SRD, not app work.

- **What the playtest left.** The first outside playtest is where the current work comes from, and
  its tail is MOBILE-ALPHA — a narrow layout that is usable rather than finished. First, because
  it is a player already standing in front of it.
- **The content-shaped work**, once the app stops moving under it: N2's three kinds of class feature, with
  FEATURE-PASSIVES naming the passive kind. MASTERY-HALF's tail sits here: the properties whose
  rule is still only text. OPTION-ROWS sits here too — the 2014 fighting styles, Metamagic and the
  2024 invocations as rows — with A17's tail: a Tome warlock casts rituals, and the Book of
  Shadows' own two are still text. So do Mystic Arcanum, SCOPED-BONUS's Agonizing Blast and E4.
- **Deliberately in no wave:** TABLE-LINK-SPEC (the specification before any transport code; the
  app ships the seams and no line of networking — `internals/overview.md` ▸ TableLink is the seam a
  table stands on), DISTRIBUTION-EXPANSION (its own session, blocked on accounts, not
  on code), ANY-HOST-PACKAGE-DISTRIBUTION (post-1.0), ONBOARD (its own design session, once the UI
  stops moving), ITEM-AT-THE-TABLE (a stated big goal with its own design session — authoring a custom
  item from play, not from the compendium), COMBAT-RAIL (the play screen as a scrolling body beside a
  pinned rail, left-aligned, with the panel regions re-decided — also its own session; RESOURCE-PIN
  asks the same "where does a pin land" question and wants answering with it), PROSE-MARKDOWN (211
  HTML tables in content prose become Markdown — 211 diffs a human reads, so its own session too) and
  COMPANION (its research is written; four answers wait on a sign-off).

## Verification
Automated coverage and conventions live in [testing.md](internals/testing.md) (run
`pnpm test`). Manual acceptance per feature: live switches (no reload); sources
(2nd CSV, homebrew folder, toggle off, collision resolve); live reload (edit CSV on
disk); portability (move JSON to fresh install → renders + flags missing; bundle opens
anywhere); play loop (damage → rest → restore; concentration; level-up; multiclass
slots); sheet (effects panel auto-vs-manual, photo, weight+metric, capacity toggle,
print/export).

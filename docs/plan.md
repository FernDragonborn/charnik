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
- **XP tracking** — **fully optional**: a `xp` field + a `levelingMode`
  (`milestone` | `xp`) toggle. In `xp` mode, level derives from XP thresholds and
  accumulated XP is tracked. Milestone mode ignores XP.

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
  - [x] **Persistence + portability** — a theme is a file: one tagged JSON per theme under `themes/`
    in the data dir through the `Storage` seam (`styles/themeFiles.ts`), which is what makes it
    copyable, hand-editable and shareable like a content pack, plus export/import of a single theme
    in the Themes tab. Files are the source of truth at startup; every load re-sanitizes, because a
    file on disk is untrusted input. The app-store copy stays as the live array the injector reads
    and as the one-time migration source for themes written before this.
  - **Theme scope is COLOURS ONLY.** Density, roundness and type stay app-owned even though
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
- **What the playtest left.** The first outside playtest is where the current work comes from, and
  its tail is PLAYTEST-UI, PLAYTEST-TRAY, ADD-ITEM-SURFACE and MOBILE-ALPHA — the screens, the dice
  tray, the chrome the add-item picker wears, and a narrow layout that is usable rather than
  finished. First, because each one is a player already standing in front of it.
- **The content-shaped work**, once the app stops moving under it: N2's three shapes, with
  FEATURE-PASSIVES naming shape 1 and N2b (Wild Shape) no longer blocked on data — the attacks column
  and the 116 creatures of SRD 5.1's two appendices ship, which is where every animal a 2014 druid
  can turn into actually lives. MASTERY-HALF's remaining half sits here: the eight mastery EFFECTS,
  most of which act on a creature the app does not model.
- **CONVERTERS-SUNSET, in two commits and in that order.** The row-count assertion gets a home in
  `charnik-content-srd` first, because between the two there is otherwise a state where nothing
  guards the pack; then `tools/srd/` goes, and the "never re-run a converter to re-stamp" hazard goes
  with it.
- **Ready, unscheduled, and app-only:** FEAT-FREE-CAST. The POOL a once-per-long-rest cast spends
  is already expressible; what does not exist is SPENDING it, because the cast path offers slots and
  nothing else. It needs no content and nothing else needs it first.
- **0.8.0 · MAGIC-ITEM-VOCAB.** The magic items still written as prose, grouped by the vocabulary gap
  each one wants rather than by item: a QUALIFIER on a defence ("against spells", "against ranged
  attacks"), a choice the item asks per INSTANCE (Ring of Resistance's damage type — two rings in one
  party are different rings), the `+1/+2/+3` rows whose bonus is set by their own rarity, `speed.climb`
  (sized: ~8 lines), the senses, and attack rolls made AGAINST you. It blocks no release, because every one
  of those rows already SAYS what it does as a note and nothing is silently wrong — the work is
  grammar, and grammar wants a release of its own.

  **Two of its three questions are settled** (`work/content.md` ▸ MAGIC-ITEM-VOCAB). A sense is a
  MECHANIC — two sources take the greater range, which is stacking and not something `note:` can do —
  and it is a chip on the Defenses card beside the fly and swim speeds already written that way. The
  `+1/+2/+3` rows stay ONE row each and grow a per-instance answer, the same shape Ring of Resistance
  wanted: the SRD prints one entry per kind, the tokens already exist on Holy Avenger, and three rows
  would fix in three places the `rarity: very_rare` those rows wrongly claim for their +1 and +2.
- **Deliberately in no wave:** DISTRIBUTION-EXPANSION (its own session, blocked on accounts, not
  on code), ANY-HOST-PACKAGE-DISTRIBUTION (post-1.0), ONBOARD (its own design session, once the UI
  stops moving), ITEM-AT-THE-TABLE (a stated big goal with its own design session — authoring a custom
  item from play, not from the compendium), COMBAT-RAIL (the play screen as a scrolling body beside a
  pinned rail, left-aligned, with the panel regions re-decided — also its own session; RESOURCE-PIN
  asks the same "where does a pin land" question and wants answering with it), PROSE-MARKDOWN (211
  HTML tables in content prose become Markdown — 211 diffs a human reads, so its own session too) and
  COMPANION (research first).

**Out of band — do these when next in the area, don't schedule them into a wave:** _(empty —
`UBUG-22` was the last one and is closed.)_

## Verification
Automated coverage and conventions live in [testing.md] (suites map to phases; run
`pnpm test`). Manual acceptance per feature: live switches (no reload); sources
(2nd CSV, homebrew folder, toggle off, collision resolve); live reload (edit CSV on
disk); portability (move JSON to fresh install → renders + flags missing; bundle opens
anywhere); play loop (damage → rest → restore; concentration; level-up; multiclass
slots); sheet (effects panel auto-vs-manual, photo, weight+metric, capacity toggle,
print/export).

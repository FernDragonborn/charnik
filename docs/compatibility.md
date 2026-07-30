# Charnik — Multi-system compatibility (foot-gun ledger)

Working note for future-me. We ship **5e + 5.5e** and deliberately do NOT build a 3.5 /
Pathfinder engine (YAGNI — `CLAUDE.md`: *"3.5 out of scope; keep the cheap `systems`
column + thin seam"*). This doc exists so we don't **bake a 5e-only assumption into a
shared chokepoint** that a future system would also flow through. Read it before touching
the rules core, the fold pipeline, the effect grammar, or the character/content schemas.

> Rule of engagement: **do NOT pre-build any abstraction here.** The whole port is mostly
> *additive new modules* (a new engine, new schemas, new render), which the architecture
> already allows. The only job now is not smearing 5e-isms into the ~5 shared vessels
> below. Building the strategy/interface now is the *other* foot-gun (over-engineering for
> a maybe-future).

---

## Mental model: not 3 systems, 3 engine *families*

- **Family A — d20 + proficiency:** 5e, 5.5e. One progression bonus
  (`2+⌊(lvl-1)/4⌋`), stacking by **layer**, advantage/disadvantage, one AC.
- **Family B — d20 + BAB + bonus-types:** D&D 3.5, **Pathfinder 1e**. No proficiency
  bonus; per-class **BAB** (full/¾/½) + separate **Fort/Ref/Will** (good/poor) + skill
  **ranks** (points/level); stacking by **bonus type** (~20: enhancement, deflection,
  dodge, morale, luck, …; same-type = highest, *dodge & circumstance stack*, untyped
  stacks); **three ACs** (normal / touch / flat-footed); spell DC = `10 + spell level + mod`.
- **Family C — proficiency ranks + 3-action + degrees of success:** **Pathfinder 2e**.
  Ranks (untrained/trained/expert/master/legendary, all `+level`), **3 bonus types**
  (item/status/circumstance), 3-action economy, every check = 4 outcomes
  (crit-succ/succ/fail/crit-fail).

**PF1e ≈ 3.5 + tweaks** → build B once, get ~80% of PF1e free. **PF2e is a separate build
the size of family B.** So "3.5 + Pathfinder" = **two projects (B and C), not three**.

The 5e/5.5e split is *within* family A — a handful of close-edition branches, which is
why inline `if (system === '5e')` is fine today and stops being fine the moment a second
family lands.

---

## What the architecture already got right (don't touch — it's the escape hatch)

- `abilityModifier = ⌊(score-10)/2⌋` (`rules/core.ts`) — **identical in all five systems.**
- **Slot tables as data** (`spell_slots` keyed by `kind`, class → `slot_table`;
  `caster_share`/`prepare_style` are columns, not class-name hardcode — `content/schemas.ts`).
  A 3.5 table is just more rows.
- **Effect targets are free strings, not a closed enum** (`token-parser.ts` validates
  target downstream) → `save.fort`, `bab`, `ac.touch` are additive.
- **Unknown token → inert, never rejected** (`effectsField`, B12). Vocabulary grows
  additively; `advantage`/`disadvantage` simply go unused in B/C, harmless.
- **Character is system-bound + `schemaVersion` + build/play split** (`character/schema.ts`)
  → a 3.5 character is a different build-shape alongside; old 5e saves don't break.
- **`Computed {value, trace, notes}` is a generic contract** (`rules/pipeline.ts`) — a new
  engine returns the same type; the provenance UI works unchanged.

---

## The chokepoints (shared vessels with baked 5e semantics)

Ranked by depth. For each: **why it's shared · cheap-now discipline · do NOT build.**

### 1. `fold()` + `Contribution.layer` — the stacking algebra `rules/pipeline.ts`

7 fixed **layers**, "most-potent set wins", adds accumulate. Family B stacks by **bonus
type** (different algebra, not different numbers); C uses 3 types. This is the **only**
place a new engine reaches into *shared* code instead of living beside it.

- **Cheap now:** keep `fold` the single chokepoint (it is). **No code outside the engine
  may pattern-match on specific `layer` values.** The provenance tooltip must group the
  trace **by `source`, not by "our 7 layers"** — else that render becomes a second
  dependency to rip out.
- **Do NOT build:** bonus-type stacking. For two close editions the layer model is ideal.
  Just know: `layer` = "stacking bucket", and *its value set is system-specific.*

### 2. `build` schema bakes family-A's proficiency model `character/schema.ts`

`skills: string[]` (proficient list), `expertise: string[]`, `saves: Ability[]`. In 3.5
skills are **ranks (a number per skill)**; in PF2e a **rank enum per skill**. So the
build-shape differs A ≠ B ≠ C.

- **Cheap now:** don't let new code read `character.build.skills` directly — **route
  through `derive`.** build will become a `system`-discriminated union; `schemaVersion`
  already covers migration.
- **Do NOT build:** the discriminated union now (it'd be one branch with a single member).

### 3. `if (system === '5e')` as the scaling pattern `rules/core.ts`

Inline edition branch in `carryingCapacity`. Fine for two close editions; turns to mush at
4 systems across a family line. The right answer *when B starts* is a per-system
**strategy object** (`RulesEngine` with `spellSaveDC`/`ac`/`proficiency`/`fold`), NOT
`if/else`.

- **Cheap now:** keep every `system ===` / `activeSystem` branch **inside `rules/` +
  `build/`**, never in components. A boundary-eslint rule is worth it. This is the first
  file you'll write when B begins.
- **Do NOT build:** the `RulesEngine` interface now (two impls sharing 95%).

### 4. `flat_bonus` has no bonus-type slot `effects/token-parser.ts`

Grammar `kind:target[:value]`; `flat_bonus:ac+2` doesn't say enhancement vs deflection —
family B can't stack without the type.

- **Cheap now:** nothing. Grammar is extensible (extra `:` segment). Just **don't spend
  the 4th token segment on a 5e-only meaning** — mentally reserve it for bonus-type.

### 5. License / attribution is per-source, not global

5e SRD = CC-BY-4.0. 3.5 SRD = OGL 1.0a. PF1e = OGL. **PF2e = ORC License.** If B/C data
ever ships, attribution must be **per-source**.

- **Cheap now:** don't hardcode `"CC-BY"` as *the* license string in attribution UI. The
  `source` tag exists; a per-source license column is a later addition.

---

## Purely additive (mentioned for completeness — do nothing)

- **Sizes:** family B adds Fine/Diminutive/Colossal (9 vs our 6). `SIZES` is an ordered
  enum → extends.
- **PF2e-only:** degrees-of-success (4 bands vs `RESOLUTIONS` pass/fail), 3-action economy
  (`play.turn` is `{action,bonus,reaction,move}` = 5e), focus spells. All inside the C
  engine; fully deferred.
- **PF1e-only:** CMB/CMD (combat maneuver) — one more stat. Additive.
- **Bonus spells/day from ability score** (B) — a formula in the B spell engine.

---

## Do-now checklist (all cheap; the only work this doc authorizes)

1. **This doc exists** and is wired into `CLAUDE.md` — stops future-me smearing 5e-isms. ✅
2. **Grep-audit done** (2026-07-30) — concrete findings below.
3. **Discipline:** build access via `derive` (§2); reserve the 4th token segment for
   bonus-type (§4); no hardcoded single license string (§5).

---

## Audit findings (2026-07-30 grep sweep) — the concrete to-fix list

Verdict: the rules core is clean — every `system ===` branch lives in `rules/` + `build/`
where it belongs (`core.ts:233`, `build/rules.ts:64`, `build/state.svelte.ts:468`,
`draft.ts`). `fold`/`layer` is the sole owner in `pipeline.ts`. `diag/bundle.ts`'s
`activeSystem` is a diagnostic string, not a branch. Only these leak:

### 🔴 Real chokepoint leak (§1) — fix to keep the door open

`routes/combat/blocks/Abilities.svelte:23`
```js
{@const prof = a.save.trace.some((t) => t.layer === 'proficiency')}
```
UI decides "save is proficient" by **sniffing the 5e-specific `'proficiency'` layer** in
the trace. Family B has no such layer (saves are Fort/Ref/Will good/poor) → this widget
would silently render wrong. **Fix:** expose a semantic flag on the save `Computed`
(`proficient: boolean`, or a structured note) so UI reads a *value*, not a layer name.
This is the ONLY finding that actually touches cross-system compatibility.

### 🟠 Single-owner violation: `SYSTEMS` duplicated as literal lists in ≥4 UI spots

Not a rules leak, but adding a 3rd system means hunting all of these:
- `lib/components/settings/GeneralSettings.svelte:13` — own `SYSTEMS:[{id,label}]` list
- `lib/components/ContentMetaModal.svelte:27` — `EDITIONS = ['5e','5.5e']`
- `routes/build/blocks/BuildHead.svelte:16-17` — two hardcoded switch buttons
- `lib/stores/app.svelte.ts:40` — `activeEditions:['5e','5.5e']` default

Two separate label mechanisms exist: `content/detail.ts:209 editionLabel()` maps *source
tags* (`'SRD 5.1'→'D&D 5e'`), while `GeneralSettings` keeps its own id→label list.
**Fix:** one `SYSTEM_LABELS` map (id→"D&D 5e (2014)") beside the `SYSTEMS` owner, and make
every picker **iterate `SYSTEMS`** instead of literals. Then a 3rd system = one map row,
and `git grep '5.5e' src/lib/components` becomes a self-sufficient lint (see below).

### 🟡 Minor

- `lib/combat/actions.ts:24` `const is2024 = system === '5.5e'` (used 3×: action list +
  "Utilize" vs "Use an Object"). Pure fn but lives outside `rules/`, and the `is2024`
  boolean is a family-A pattern (the action set is itself family-specific). **Later:** make
  combat actions data-driven per-system when B starts. Note only — leave now.
- Magic default-system literals: `routes/combat/state.svelte.ts:702` `?? '5.5e'`,
  `routes/build/draft.ts:63` `system:'5.5e'`. **Fix:** a named `DEFAULT_SYSTEM` beside the
  owner instead of scattered literals.

### Boundary-eslint rule — decided AGAINST

Auto-banning `system ===` outside `rules/`+`build/` can't be clean: UI pickers legitimately
must know the members, so the rule either false-positives on pickers or needs a whitelist —
more hassle than value. The 🟠 fix (iterate `SYSTEMS`) is the real safeguard: afterward
almost no `'5.5e'` literal survives in `components/`, and a plain `git grep` is the lint.

**Do NOT build now:** `RulesEngine` interface, bonus-type stacking, per-system build union,
degrees-of-success, 3-action economy, 3.5/PF schemas. All YAGNI until family B/C actually
starts — and when it does, it's *new additive modules*, not surgery on the 5e core.

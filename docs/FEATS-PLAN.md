# FEATS-PLAN — Claude working ledger (feat mechanics)

> **What this is:** my own execution ledger for wiring up feat mechanics, kept across sessions.
> Working notes, not a polished spec (that's `EFFECTS.md` / `PLUGINS.md`). `[ ]` open · `[~]` partial ·
> `[x]` done+verified. Update it in the same change as the code.
>
> **North star (CLAUDE.md):** the ENGINE must be able to represent the whole game (PHB + official +
> popular homebrew), but we **ship SRD-only data**. So: design vocab/plugins to SUPPORT any feat;
> author+ship only SRD feats; a homebrew author dropping a PHB feat's CSV row must Just Work.
>
> **Hard rules that gate this work:** RAW fidelity (output == SRD RAW for the edition, flag deviations
> — [[charnik-srd-raw-fidelity]]); no hallucinated data (values are curated SRD facts, never invented —
> [[charnik-no-hallucinated-data]]); **data lives in the CSV only** (converters preserve authored
> columns; NO values in committed scripts/code — the engine holds only parsers/logic).

## The three buckets (why "not every feat is a pure token")

A feat's mechanic falls into one of three tiers. The dividing line is deliberate: L1/L2 is a **bounded**
declarative vocabulary (a security property — "data, never eval", `SECURITY.md`). Pushing it far enough
to express arbitrary logic would make it a programming language and destroy that property. The escape
hatch for the procedural tail is **L3 plugins** (QuickJS-WASM sandbox, already BUILT) referenced by a
`plugin:<ns>:<handler>` token — so the CSV still DRIVES it, but the logic is sandboxed code, not a token.

1. **Declarative now** — pure L1/L2 token(s) in the CSV `effects` column (+ small build columns like
   `ability_choice`). Covers all flat/conditional stat bonuses, ability +1, proficiency/resource/resist
   grants, guarded effects. The majority of feats by count.
2. **Needs a bounded vocab EXTENSION** — one general grammar addition (not per-feat code), after which
   the feat is pure data. E.g. weapon-category-scoped attack/damage bonuses.
3. **Procedural → L3 plugin** — new actions/reactions, once-per-X triggers with choices/resources, spell
   grants, complex multi-step conditionals. A plugin behind a `plugin:` token; until then the mechanic
   shows as faithful RAW **text** (`text + manual` fallback, never fabricated, never dropped).

## Status — shipped SRD feats

### 2024 (SRD 5.2.1) — 17 feats

| feat | tier | status | plan |
|---|---|---|---|
| `alert` | 1 (+3 text) | [x] | `flat_bonus:initiative+proficiency_bonus`. Initiative Swap = text (relational). |
| `grappler` | 1 (+3 text) | [x] | half-feat `ability_choice=str,dex`. Grapple advantage/punch-grab/fast-wrestler = text. |
| 7× `boon_of_*` | 1 (+3 text) | [x] | half-feat `ability_choice=any` (+1 to 30). Each boon's POWER = text (mostly plugin later). |
| `defense` | 1 | [x] | `armor_type != none ? flat_bonus:ac+1` (2026-08-02). Guard verified: +1 AC while armored, 0 unarmored (derive test w/ leather armor). |
| `ability_score_improvement` | — | [x] | the ASI itself; handled by the ASI slot system, not a feat effect. Leave. |
| `archery` | 2 | [x] | `flat_bonus:attack:ranged+2` (2026-08-02). Vocab §A attack-scope built; folds into ranged weapons' to-hit in `computeAttacks`, skipped in the generic roll path (no double-count). Derive-tested: longbow +2 / dagger +0. |
| `great_weapon_fighting` | 2 | [x] | §B DONE (2026-08-02). **2024 SRD = "treat 1–2 as 3" = `min_die:damage:…:3` (a FLOOR, NOT the 2014 reroll)** — RAW-fidelity correction to this row's old note. The OR (Two-Handed **or** Versatile) = two AND-scoped tokens: `min_die:damage:two_handed,melee:3;min_die:damage:versatile,melee:3` (min_die takes the max of whichever matches, both floor 3). Reachable in the build (fighting-style feats are slot-selectable). **⚠ grip untracked:** RAW needs a two-hand grip; a Versatile weapon held one-handed still gets it (over-applies) — flagged. |
| `two_weapon_fighting` | 3 | [~] | **ASSESSED 2026-08-02: currently a NO-OP → stays text.** RAW removes the off-hand penalty (add the ability mod to the off-hand attack's damage). But `computeAttacks` ALREADY adds the ability mod to EVERY equipped weapon's damage (`mod: p.mod + mod + w.damage`) — the off-hand penalty was never modelled, so there's nothing for TWF to remove. Encoding it would change nothing observable. Revisit only if/when an off-hand/light-weapon bonus-action attack model is built (would also need grip/hand designation on inventory). |
| `savage_attacker` | 3 | [ ] | **ASSESSED 2026-08-02: BLOCKED on the onUse action executor (roadmap N2, unbuilt).** It's an ACTIVE, on-hit, once-per-turn CHOICE ("roll the damage dice twice, use either" = pool-advantage on damage). The architecturally-correct home is a plugin `onUse` hook — but the sandbox is **passive-only** (`plugin-sandbox.ts:62` "the only `api: 1` hook"); there is NO onUse/onEvent executor yet. So the only routes are (a) build the onUse action executor (N2 — a foundational project), or (b) a feat-specific bounded hack (pool-advantage primitive in `rollPool` + a once-per-turn toggle/flag in the combat VM + UI) that drifts from data-driven. Neither is a quick win. Recommend it rides on N2. |
| `skilled` | 3 (choice) | [x] | §C choice-grant DONE (2026-08-02, skills-only). `skill_choice=3` CSV col → per-slot/origin-feat skill picker in FeatsCard → `build.featSkills` → proficiency. **⚠ RAW deviation:** SRD reads "skills OR tools"; tools unmodelled → skills-only, flagged in UI + here. Reachable only via a homebrew background/feat (no shipped BG grants it — engine-support). |
| `magic_initiate` | 3 (spells) | [ ] | 2 cantrips + 1 L1 spell (list choice) + once/long-rest free cast → spell-learning + limited-cast mechanic. Biggest; own subproject. |

### 2014 (SRD 5.1) — 1 feat

| feat | tier | status | plan |
|---|---|---|---|
| `grappler` | 3 | [ ] | 2014 Grappler is NOT a half-feat (no +1). Advantage vs grappled + pin action = text/plugin. Leave text. |

## Vocab extensions to design (bounded, general — not per-feat)

### §A · Weapon-category-scoped attack/damage bonuses — **[~] attack side done (2026-08-02)**
**Attack scope BUILT:** `flat_bonus:attack:<category>+N` → `ParsedEffect.weaponScope` (dedicated
field, not overloaded `damageType`). The `:type`-vs-`:category` collision is resolved by TARGET in
`qualifierSlot` (`token-parser.ts`): an `attack` bonus is never damage-typed → its qualifier is always
a `weaponScope`; every other target keeps the qualifier as `damageType`. `NumericFact` carries it;
`computeAttacks` builds each weapon's category tag set (`weaponScopeSet` = item_type words + property
words, `two-handed`→`two_handed`) and folds a scoped bonus into to-hit only when the weapon matches
(`scopedAttackBonus`); `rollEffectsFor` SKIPS scoped facts so the roll path doesn't double-count what
`computeAttacks` already baked into `at.toHit`. Only literal `add` amounts fold; a scoped dice/expr
bonus would ride the roll path (none shipped). Unblocks Archery.
**flat-DAMAGE-scope side STILL DEFERRED (Dueling):** GWF (step 4) turned out to need the §B roll-manip
path (`min_die:damage:<scope>:3`), NOT a `flat_bonus:damage:<scope>` — so the flat-damage-scope
collision is still unresolved (no shipped feat needs it yet; Dueling `flat_bonus:damage:melee+2` would).
For `target=damage` a qualifier still means damage TYPE (flaming-weapon extra part — unchanged). When
Dueling lands, resolve the collision by having `computeAttacks` (weapon-aware) check the qualifier
against the weapon's scope set: in-set → scoped damage fold; else → typed extra part. That keeps the
vocab out of L1 (compatibility.md — no weapon-category enum baked into the parser). NB §B already proved
the multi-tag scoped-token pattern for the roll-manip half.

### §B · Roll-manip scoping + once-per-turn (GWF / Savage Attacker)
**(1) Weapon-category scope — [x] DONE 2026-08-02 (GWF).** `reroll`/`min_die` grammar gained an
OPTIONAL middle scope segment: `<kind>:<target>[:<scope-list>]:<int>` where `<scope-list>` is a comma
list of weapon-category tags, ALL required (`min_die:damage:two_handed,melee:3`). `RollMod.weaponScope`
carries it; `rollEffectsFor(facts, key, weaponScopes?)` applies a scoped fact only when the rolling
weapon's tag set ⊇ the list (unscoped facts always apply; a non-weapon roll skips scoped ones).
`Attack.scopes` (built by `weaponScopeSet` in `computeAttacks`) is threaded from `attackRoll` →
`effectsFor` → `rollEffectsFor`. An OR across properties = several AND-scoped tokens (GWF's
two_handed/versatile). Tests: parser, roll-path gate, derive-integration (greataxe floors, longbow
doesn't). The final die-flooring (`rollPool` minDie) was already unit-tested.
**(2) once-per-turn gate for Savage Attacker — [ ] STILL OPEN.** Once-per-turn is play-state (a
per-turn used-flag) — likely a plugin (onEvent) or a small combat-state mechanic. Assess vs plugin.

### §C · Choice-grant UI (Skilled, Prodigy, etc.) — **[x] DONE 2026-08-02 (skills-only)**
Data-driven `skill_choice=N` feat column (author-set count, NO feat-id hardcode → homebrew Skilled/
Prodigy Just Works). Draft field `slotFeatSkills: Record<key, string[]>` (key = a feat-slot key, or
`'origin'` for the background-granted feat); a reusable `skillPicker` snippet in `FeatsCard` shows
"pick N skills" reusing `.pick-chip`/`.asi-block`. **Strict** disables an already-proficient skill
(wasted pick) + enforces the N cap; **Free** is lenient. Folds into a NEW `build.featSkills` field
(kept SEPARATE from `build.skills` so the class-skill cap counter isn't inflated on edit; merged into
proficiency at derive via `deriveSkills`' `chosenProf`, carried verbatim on edit like `abilityBoosts`).
**Deviation from the original plan:** folded into `build.featSkills` (a resolved list), NOT synthetic
`grant_proficiency` facts — simpler, reuses the existing skill-proficiency derive, no synthetic-effect
machinery. **TOOLS DEFERRED:** SRD Skilled is "skills OR tools"; tools aren't modelled anywhere (no
schema/content/UI) → skills-only, a flagged RAW deviation (strict/free is about ENFORCEMENT, not which
proficiency TYPES exist — tools are a separate content-modelling gap). Tools = own subproject.
**Unexercised by shipped SRD** (no background grants Skilled; origin feats aren't slot-selectable) →
UI verified by svelte-check + proven-component composition + logic tests, not a live screenshot;
reachable via homebrew. Generalizes to Prodigy etc.

## L3 plugin candidates (tier 3, after the sandbox demand justifies authoring plugins)
`magic_initiate` (spell grants), `two_weapon_fighting` (off-hand), `savage_attacker` (once/turn reroll),
grapple mechanics, epic-boon powers, and the PHB long tail (Lucky, Sentinel, Polearm Master, Great
Weapon Master, Fey Touched, Metamagic Adept, War Caster, …). Each: a `plugin:<ns>:<handler>` token in
the CSV + a sandboxed handler. **Not urgent** — text fallback is honest until then.

## Execution order (recommended)
1. ~~**`defense`**~~ **[x] DONE 2026-08-02** — `armor_type != none ? flat_bonus:ac+1`, derive-tested.
2. ~~**Vocab §A attack-scope + `archery`**~~ **[x] DONE 2026-08-02** — `flat_bonus:attack:ranged+2`;
   `weaponScope` field + per-weapon fold in `computeAttacks`, roll-path skip. Damage-scope side left
   for GWF (step 4). Tests: parser, `rollEffectsFor` skip, derive (longbow +2 / dagger +0).
3. ~~**§C choice-grant UI + `skilled`**~~ **[x] DONE 2026-08-02** — `skill_choice=N` col + skill picker
   → `build.featSkills`. Skills-only (tools deferred). Reusable for Prodigy etc.
4. ~~**GWF** on top of §A+§B~~ **[x] DONE 2026-08-02** — `min_die:damage:<scope>:3` (2024 = floor, not
   reroll); weapon-scoped roll-manip grammar + `rollEffectsFor` gate + `Attack.scopes` threading.
5. **Tier-3 — ASSESSED 2026-08-02; every shipped feat is now DONE or genuinely tier-3.** No quick
   declarative wins remain. The four open items and their real nature:
   - `two_weapon_fighting` — **[~] NO-OP → stays text** (off-hand penalty never modelled; nothing to remove).
   - 2014 `grappler` — **stays text** (advantage-vs-grappled + pin; relational, not single-sheet).
   - `savage_attacker` — an ACTIVE once-per-turn on-hit ability. Its proper home is a plugin `onUse`
     hook, but the sandbox is **passive-only** (verified: `plugin-sandbox.ts:62`) — the onUse action
     executor is roadmap **N2, UNBUILT**. So it's BLOCKED on N2 (or a data-drifting hack).
   - `magic_initiate` — the biggest: spell-learning + once/long-rest free cast. Own subproject.
   **⇒ The tier-1/tier-2 encodable feat work is COMPLETE, and every remaining feat is BLOCKED on a
   foundational subsystem that is its own project** — not on "authoring a plugin" (the passive sandbox
   can't host an active ability), but on **N2 (the onUse/onEvent action executor)** for savage_attacker
   and a **spell-learning subsystem** for magic_initiate. These are roadmap projects, the user's call to
   open (see `docs/PLAN.md` N2). Until then, RAW text fallback is honest. See [[charnik-status]].

## Conventions (do not drift)
- **CSV-only data**: author values into `content/**/feats_srd.csv` (and class_features etc.); converters
  (`convert.mjs`, `convert-classes.mjs`, `convert-2014.mjs`) PRESERVE the authored columns
  (`effects`, `ability_choice`, `expertise_slots`) by id on re-run. **No committed seeder scripts / no
  values in code.** Sync `static/content` via `build-static-content.mjs` (gitignored, not committed).
- **RAW fidelity**: encode only what maps faithfully; the rest stays exact SRD text. Flag any deviation.
- **Ship SRD-only**: shipped feats stay SRD; PHB feats are engine-support test targets (homebrew authors
  add rows). Never commit non-SRD feat content.
- **Tests**: pure parsers in `build/derive.test.ts`; real-content (row → parsed) in
  `class_features_content.test.ts`; a driven UI check for new build UI (design-preview/, gitignored).
- Related decisions live in `docs/PLAN.md` ("Feat stat/skill bonuses") and `docs/EFFECTS.md` (grammar).

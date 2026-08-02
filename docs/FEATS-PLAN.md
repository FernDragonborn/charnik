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
| `archery` | 2 | [ ] | `flat_bonus:attack:ranged+2` — needs the weapon-category attack slot (see Vocab §A). |
| `great_weapon_fighting` | 2 | [ ] | reroll 1–2 on damage dice of a two-handed **melee** weapon → weapon-scope + `reroll:damage:2` scoped to a property. Needs Vocab §A + a property filter. |
| `two_weapon_fighting` | 3 | [ ] | add the ability mod to the OFF-HAND attack's damage. Off-hand attacks aren't modelled distinctly → needs the attack model to know main/off hand. |
| `savage_attacker` | 3 | [ ] | once-per-turn: roll the weapon's damage dice twice, keep either. Roll-time, once-per-turn state → plugin or a dedicated roll-manip mechanic. |
| `skilled` | 3 (choice) | [ ] | +3 skill/tool proficiencies of choice → a choice UI like skills (repeatable). |
| `magic_initiate` | 3 (spells) | [ ] | 2 cantrips + 1 L1 spell (list choice) + once/long-rest free cast → spell-learning + limited-cast mechanic. Biggest; own subproject. |

### 2014 (SRD 5.1) — 1 feat

| feat | tier | status | plan |
|---|---|---|---|
| `grappler` | 3 | [ ] | 2014 Grappler is NOT a half-feat (no +1). Advantage vs grappled + pin action = text/plugin. Leave text. |

## Vocab extensions to design (bounded, general — not per-feat)

### §A · Weapon-category-scoped attack/damage bonuses
Mirror the `flat_bonus:damage:<type>` slot I already added. Grammar: `flat_bonus:attack:<category>+N` /
`flat_bonus:damage:<category>+N` where `<category>` ∈ {ranged, melee, thrown, two_handed, finesse, …}
(weapon properties/kinds). `computeAttacks` filters character-level effects with a category qualifier
and applies to matching weapons only (it already has weapon props/`item_type`). Unblocks Archery, and is
the seam for GWF/TWF. **Design carefully in `token-parser.ts` (the `:type`-vs-`:category` collision — a
`damage` target's slot means damage TYPE, an `attack` target's slot means weapon CATEGORY). Keep them
distinct.** Consider a dedicated field (`weaponScope`) rather than overloading `damageType`.

### §B · Roll-manip scoping + once-per-turn (GWF / Savage Attacker)
`reroll:damage:<threshold>` exists (L1). Needs: (1) scope it to a weapon category (§A machinery), (2) a
once-per-turn gate for Savage Attacker. Once-per-turn is play-state (a per-turn used-flag) — likely a
plugin (onEvent) or a small combat-state mechanic. Assess vs plugin.

### §C · Choice-grant UI (Skilled, Prodigy, etc.)
A reusable "pick N proficiencies from a set" the way expertise/skills already work. Store in a draft
field; fold as `grant_proficiency` facts. Skilled = 3 from any skill+tool. Generalizes Prodigy, etc.

## L3 plugin candidates (tier 3, after the sandbox demand justifies authoring plugins)
`magic_initiate` (spell grants), `two_weapon_fighting` (off-hand), `savage_attacker` (once/turn reroll),
grapple mechanics, epic-boon powers, and the PHB long tail (Lucky, Sentinel, Polearm Master, Great
Weapon Master, Fey Touched, Metamagic Adept, War Caster, …). Each: a `plugin:<ns>:<handler>` token in
the CSV + a sandboxed handler. **Not urgent** — text fallback is honest until then.

## Execution order (recommended)
1. ~~**`defense`**~~ **[x] DONE 2026-08-02** — `armor_type != none ? flat_bonus:ac+1`, derive-tested.
2. **Vocab §A** (weapon-category attack/damage scope) + **`archery`**: the highest-value extension; also
   the seam GWF/TWF need. Tests + a driven attack check.
3. **§C choice-grant UI** + **`skilled`**: reusable, unblocks a class of feats.
4. **GWF** on top of §A+§B (reroll scoped to two-handed melee).
5. Tier-3 plugins (magic_initiate, TWF off-hand, savage_attacker) — only when we commit to authoring
   sandboxed plugins; until then keep RAW text.

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

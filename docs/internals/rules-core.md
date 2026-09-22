# Rules core

> For maintainers. The pure engine underneath everything: what it computes, what it may depend on,
> and what the two editions do differently.

## Pure and framework-agnostic

All D&D math lives in `src/lib/rules` as plain TypeScript with Vitest tests, never in a Svelte
component: ability modifiers, proficiency, the ASI source, passive senses, carrying capacity, attack
and spell DCs, and the modifier stacking pipeline.

The core is a small shared base with **per-system overrides** for `5e` and `5.5e`, and it is reactive
to the active system — the switch is live, with no reload.

**A third game system is out of scope.** Do not build a 3.5 or Pathfinder engine. What exists is the
cheap `systems` data column and a thin system seam, and `compatibility.md` lists the chokepoints
where a 5e-only assumption would block one later. Consult it before touching the fold pipeline, the
effect grammar, or the schemas — the point is to avoid baking 5e-isms into shared code, **not** to
pre-build an abstraction nobody needs yet.

## Every value carries its provenance

The core returns **a value plus a trace**, never a bare number: each `{source, op, amount}`
contribution, plus rule notes and blocks. That is what lets the UI explain any stat on hover.

A contribution the ENGINE names ("DEX mod", "Proficiency", "Armor") carries its catalog `key` — and a
`noteKey` for its detail — beside the English, so the trace reads in the player's language; render it
through `sourceText` / `sourceNoteText`, and compare a contribution by its key rather than by the
English word it happens to read as. One a CONTENT row names — a species, a magic item — carries no
key at all: that word is data, and no UI catalog knows it. Per-ability labels are flat keys
(`abilityMod.str`), because a phrase a translator has to see whole beats an ability substituted into
an English frame.

Blocks matter as much as bonuses. "Spellcasting is blocked by worn armor you are not proficient in"
is a rule-based fact the trace carries, not a silently missing number.

This contract — `{value, trace, notes}` — is **identical whether the effects module is on, off, or
deleted from the repo**.

## The effects engine is data, never code

Auto-calculation flows through one **stacking pipeline**:

```
base → ability mod → proficiency → item → feature → condition → override
```

clamped to caps, fed by a **bounded effect vocabulary**: flat bonus, set override, advantage,
disadvantage, grant proficiency, resist/immune, apply condition, grant resource, the roll-manipulation
kinds, note, and plugin.

Effects are **interpreted data, not `eval` and not an executing DSL**. That is a security property as
much as a design one — see `security.md`.

An unknown effect degrades to **text plus a manual modifier**. It is never silently dropped, and it
is surfaced in the effects panel.

The whole auto-calculation system has a **global toggle**. Off means stats are manual and textual
only. Users can add custom or temporary effects at runtime through a "+" — a catalog from the
`effects` content type plus a Custom… option — each with an optional **duration in rounds** that a
round counter expires. Those live in runtime play-state, not in the build.

**The module is isolated, optional, and removable.** It sits in `src/lib/effects/` and joins the core
at exactly one seam, `applyEffects`. The core computes base stats with no dependency on it, so the
module can be deleted without breaking core or UI. **Core tests must not import it**, and eslint's
`no-restricted-imports` enforces that `src/lib/rules/**` never does either.

### Module layout, by expressiveness layer

- **L1 — the bounded token vocabulary.** `token-parser.ts` (`parseToken`: string → `ParsedEffect`)
  and `apply.ts` (`collectFacts`, `applyEffects`, the fold seam).
- **L2 — value expressions.** `expression-parser.ts` (formula → AST) and `expression-evaluator.ts`
  (AST → value).
- **Shared.** `dependency-graph.ts` — the one resolve stage, run in dependency order — and
  `context.ts`, the context a formula may read.
- **L3 — plugins.** `plugin-registry.ts` and `plugin-sandbox.ts`.

The normative spec for all of it is `effects.md`, with `plugins.md` and `actions.md` as companions.

### Token versus effect

A raw effect **string** is a **token** until `parseToken` turns it into an object, after which it is
an **effect** (`ParsedEffect`). String-form identifiers say token (`token`, `tokens: string[]`,
`parseToken`, `splitGuard(raw)`); object-form identifiers say effect (`ParsedEffect`, `applyEffects`,
`EFFECT_KIND`, `resolveEffectValue`). Keep new code on that seam.

## Class and caster mechanics are pure data

A homebrew or third-party class is added as CSV rows with **zero code changes**. Never write
`if (className === …)`.

Express per-class rules as descriptor columns: `caster_share` (`full` / `half` / `half-up` / `third` /
`none` — the multiclass contribution and its rounding, so Artificer's round-up is just `half-up`),
`slot_table` (an id pointing at an arbitrary `spell_slots` table, not a fixed four-value enum),
`prepare_style`, `spell_ability`, `ritual`. Non-spell class mechanics — Infusions, Crimson Rite, Rage,
Ki — are **resources** granted by tokens.

Validate the architecture against real non-SRD classes: **Artificer** (half-caster rounding up, plus
Infusions) and **Blood Hunter** (martial with hemocraft resources, and a Profane Soul subclass that
is a pact-like caster). Truly exotic logic the bounded vocabulary cannot express belongs in the
plugin sandbox, never in baked-in code.

## Spellcasting, in one mechanism

**A slot IS a resource.** One "castable pool" engine covers everything: a pool is
`{id, spellLevel?, max, recharge}`, so class slots are pools keyed by level recharging on a long
rest, pact slots recharge on a short one, and a Mystic Arcanum or an item's "3/day" is the same shape
without a spell level. The UI renders level-tagged pools as pips and the rest as trackers. Anything
"N/day" is therefore `grant_resource:<id>:<max>:<recharge>`, a spell says how it is paid for
(`cast_via: slot | resource:<id> | at-will`), and `grant_slot:<level>` covers the rare artifact that
grants a real slot.

**Multiclass slots are the SUM, never the senior class**: Σ full levels + Σ⌊half/2⌋ + Σ⌊third/3⌋
(`half-up` rounds up, which is all Artificer needs), indexed into the ONE full table. **Warlock
levels contribute nothing** — Pact Magic is a separate pool alongside it. A single-class caster reads
its own table by its own level.

**The known-set is one concept with three populations.** Wizard = a spellbook the player owns and
grows; sorcerer, bard and ranger = a self-known list; cleric and druid = a curated prepared set sized
by data. Prepared is then a subset of the known-set, and the cap is a column, never a formula in
code. A **per-class picker appears only when multiclassed** — one caster class gets a flat list,
which is the 99% case; with two, each class gets its own block, its own caps and its own attribution
for a spell that sits on both lists.

**Spell ↔ class access is a bidirectional UNION index**, so neither side has to edit the other's
files: a spell may tag its classes, and a class may list spell ids in its own `spell_lists` file.
The loader unions both into `class_id → spells` and its reverse. Three things follow. Access carries
**provenance**, not a boolean — `{via: class-list | subclass | feat | item | species, flavor:
selectable | always-prepared | resource}` — which is what lets the sheet say "you can cast this
because you are a Wizard" rather than merely that you can. It is **edition-scoped**: a 2014 class
resolves to 2014 spells, never across. And a spell article's "available to" list must read the
**reverse index**, never the raw `classes` column, or a class that gained the spell through
`spell_lists` silently vanishes from it.

The character level sits ABOVE that index: subclass, feat, item and species grants are computed in
derive, not baked into the shared content index.

**A caster profile is not always a class.** A feat that teaches spells (Magic Initiate) names the
ability its spells are cast with, which is the whole of what a profile decides, so it becomes one —
appended after the class profiles, carrying the counts its `spell_choice` column states as its
cantrip/known caps, the chosen class list as its access map, and no slots and no share of the caster
level. Everything downstream then needs no case for it: `casterForSpell` attributes its spells to it,
the builder's picker gets a section, and a non-caster class who took the feat casts.

**The rules that are easy to get wrong**, each of which the model has to keep expressible:
always-prepared spells (domain, oath) sit OUTSIDE the prepared count but still count
as class spells, and a spell a FEAT teaches is outside it because the feat is its own caster profile
(below), not because of a flag; a ritual is castable without preparation or a slot, and its SOURCE varies (a wizard
rituals from the spellbook unprepared, a prepared caster only what is prepared); cantrips are
independent of slots, which is why a pure warlock has cantrips and no shared slots; a slot casts any
spell of level ≤ its own, and **Pact Magic forces the upcast** — every pact spell is cast at the
current pact-slot level; and the highest level you can LEARN is capped by your level in that class,
while slots may exceed it.

The builder's spell picker follows the page's Strict/Free toggle like every other picker: Strict
offers only what is legal through the access map and the caps, Free offers everything, for homebrew
and house rules.

## Preparation, and the two kinds of caster

A **prepared** caster (cleric, druid, wizard, paladin) keeps a known or spellbook pool and prepares a
subset: a per-spell toggle against a cap of class level plus the ability modifier, with
always-prepared and domain spells flagged, and rituals castable unprepared where the class allows
it. A **known** caster (sorcerer, bard, warlock, ranger) skips preparation — everything known is
castable. A rule option allows preparing PAST the cap (off by default; the counter then reads 12/11),
because house rules exist and the tracker does not enforce.

**Grapple and Shove have no fixed DC, and the editions disagree about what they even are.** 2014
makes them a CONTEST — your Athletics against the target's Athletics or Acrobatics — so the
"difficulty" is another creature's roll and must render as `contest`, never as a number. 2024 makes
them a save against a derived DC of `8 + STR mod + proficiency`. A single "DC" field for both would
be wrong in one edition whichever way it was filled.

## Scope: the whole game, shipped data only SRD

The engine must be able to represent the **entire PHB, the official rulebooks, and the most popular
homebrew** — not only the SRD. When a mechanic exists in official material (multiclass-casting
subclasses like Eldritch Knight and Arcane Trickster, one-third casters, non-SRD feats), wire it up as
data-driven rules; do not punt because the *shipped* data happens to be SRD-only.

Never hardcode a "SRD-only" assumption into the rules core or the schemas. A homebrew or PHB author
dropping in CSV rows must just work. This does not change what ships — see `content.md`.

## RAW, RAI, and saying which

Mechanical output defaults to the **RAW** of the active edition (5e is SRD 5.1, 5.5e is SRD 5.2.1).
Where RAW is ambiguous, self-contradictory, or an obvious artifact of the ruleset's sheer volume,
follow **RAI** — the designers' clear intent — instead of a robotic literal reading.

Either way, **surface the interpretation** so the table can override it. Where RAW and RAI diverge as
a genuine table choice (Magic Missile as one save or one per dart; 2014's separate save per source
versus 2024 dropping it), **offer both** rather than hardcoding one.

**RAI interprets rules; it never invents data.** Spells, items, stats, and costs always come from a
real SRD source. RAI is "how to read this mechanic", never "fabricate content", and it triggers on
ambiguity, not on taste.

Derive answers from the actual SRD text of both editions rather than from a convenient global rule —
RAW is often per-effect. A Headband of Intellect sets Intelligence to 19 "unless it is already
higher"; grappled sets speed to 0 *and* blocks speed bonuses. There is no single max/min rule.

A RAW- or RAI-correct behavior that cannot currently be implemented is logged as a **known gap**, not
recast as a design choice. When answering a rules question, tag each option as RAW-forced,
RAI-resolved, or a free architectural choice, so decisions are asked only where the rules leave room.

## Units and capacity

Render **imperial first with metric in parentheses** — feet to metres ×0.3048, pounds to kilograms
×0.4536.

Carrying capacity is **optional**, behind a toggle. The encumbrance tiers with their ×5 and ×10 speed
penalties are a **5e-only variant**, off by default, and not part of 5.5e core — in 5.5e, being over
capacity simply drops speed to 5 ft.

## The system belongs to the character

A built character is bound to the system it was created in, stored in its JSON, and always renders in
it. The active-system switch only sets the compendium and creation context.

**Do not reinterpret a 5e character as 5.5e.** Cross-system conversion is out of scope; the mechanics
differ too much for it to be anything but a lie.

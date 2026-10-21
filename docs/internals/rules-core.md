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

The whole auto-calculation system has a **per-character toggle** (`play.autoCalc`). Off means stats
are manual and textual only. It is an escape hatch for a number the engine got wrong, not a rules
variant, so it lives on the Effects panel's head — beside the layers it drops — and stays invisible
until the head is hovered or it takes focus. Switched OFF it shows accented whatever the pointer
does: an engine a player turned off is a state they have to see and be able to undo. Users can add custom or temporary effects at runtime through a "+" — a catalog from the
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
`prepare_style`, `spell_ability`, `ritual_source`. Non-spell class mechanics — Infusions, Crimson Rite, Rage,
Ki — are **resources** granted by tokens.

**A grant that grows with level is ONE row with a `level:count` ladder** — `expertise_slots`
(`1:2,6:2` for a Rogue) and `mastery_slots` (`1:3,4:1,10:1,16:1` for a 2024 Fighter), both read by
`slotsGrantedAtLevel`. Strict enforces the cap and Free does not; at the cap a click replaces the
oldest pick (`ui.md` ▸ rule 10). Multiclass mastery grants SUM, which is RAW rather than a convenience:
the 2024 multiclassing rules name their exceptions and Weapon Mastery is not one. A grant the count
cannot express honestly is left out rather than over-permitted — the Wizard's one expertise from a
restricted list is not encoded. A feat that raises one of several abilities says so in
`ability_choice` (`str,dex`, or `any`), the same "list or keyword" grammar a species' `feat_choice`
uses.

**What a weapon swings with, and what a shield is worth, come from the row in the hand.** A finesse
weapon's ability is the player's choice, keyed by weapon KIND (a +1 Rapier is a Rapier); an absent key
means "whichever modifier is higher", and the control shows only where there is a choice. It is not
cosmetic: the ability an attack resolves from is an effect SCOPE, so Rage pays out on a rapier swung
with Strength and not with Dexterity — which is why a silent `Math.max` sometimes picked the worse
number. A shield gives the AC its own row declares while it is EQUIPPED: there is no "raised" flag,
because 5e has no such action, so a +1 shield is worth 3 and the play sheet's Shield toggle is that
row's equip button.

Validate the architecture against real non-SRD classes: **Artificer** (half-caster rounding up, plus
Infusions) and **Blood Hunter** (martial with hemocraft resources, and a Profane Soul subclass that
is a pact-like caster). Truly exotic logic the bounded vocabulary cannot express belongs in the
plugin sandbox, never in baked-in code.

**The XP a level takes is a table, per edition** — `advancement` rows (`level`, `xp`), one file per
pack, read by `rules/advancement.ts`, whose only rule is each SRD's own sentence: a total that equals
or exceeds a threshold has reached that level. A pack with no table gives no answer, never another
edition's (`compatibility.md` §3b).

## Spellcasting, in one mechanism

**A slot IS a resource.** One "castable pool" engine covers everything: a pool is
`{id, spellLevel?, max, recharge}`, so class slots are pools keyed by level recharging on a long
rest, pact slots recharge on a short one, and a Mystic Arcanum or an item's "3/day" is the same shape
without a spell level. The UI renders level-tagged pools as pips and the rest as trackers. Anything
"N/day" is therefore `grant_resource:<id>:<max>:<recharge>`.

**What pays for a cast is chosen at the cast.** `cast(r, e, { pool })` spends one use of a pool and no
slot, and the picker that offers slot levels offers the pools beside them — which is how "cast it once
without a spell slot" (Magic Initiate, and the same sentence on several items) is paid. **The player
names the pool, because nothing in the data links one to a spell**: there is no column saying which
pool a given spell may spend, so the picker lists every pool with a use left and the feat's own text
decides. The pool is spent and gated on BEFORE the action economy is touched, the way a slot is
reserved first, so an exhausted pool blocks the whole cast rather than casting for free. Narrowing the
list to a DECLARED pool later is a filter on that same control.

**A slot can be what an option COSTS.** "Give yourself one use by expending a spell slot" (Wild
Resurgence) is the `spend_slot` verb on a spend-option (`actions.md` §2): the slot is reserved with
the option's other costs through the same `slotToSpend` a cast uses, and which level to give up is
asked of the player.

**A slot a feature GIVES is counted, not restored.** "Give yourself a level 1 spell slot" (Wild
Resurgence) is the `gain_slot:<level>` verb: `play.spellSlotsGained` is added to the table's counts
where the pools are built (`rules/spellcasting` ▸ `withGainedSlots`), so the pips, the cast picker and
upcasting all see one more slot of that level. It does not raise the level of spell a caster can
learn, which reads the class's own table. A Long Rest takes it away: Font of Magic says so of the
slots it creates, Wild Resurgence is silent, and a slot that outlived every rest would be a permanent
one — RAI.

**A cast leaves the spell's own `effects` on the CASTER**, as a carrier effect that lasts the
spell's duration and holds its concentration, so ending either ends both. A spell row therefore
carries a token only for an effect its own text states on its target — Mage Armor's base AC,
Shield's +5 — and a spell whose effect needs a choice or a word the vocabulary lacks stays prose
(`work/content.md` ▸ E4). The model is self-only: a spell laid on someone else still lands here.
**The row of a spell that rolls nothing is captioned from those tokens**, resolved against the sheet
(`combat/effects-view.ts` ▸ `effectsCaption`): "AC = 15" is this character's Mage Armor. No list of
spell names says what a spell does; a row with no tokens reads as utility.

**Upcasting is one `upcast` column of `kind:formula` tokens**, parsed by the effect grammar. Four
things about it are settled. Combining is a DELTA for structured kinds (`base + delta`, the base being
the single source) and ABSOLUTE for a count or a duration — `inf` only ever appears in `duration`, so
`base + inf` cannot happen by construction. The cantrip tier (5/11/17) is NOT folded into `upcast`:
it is a uniform system rule keyed on character level, where `upcast` is per-spell data keyed on the
slot. Upcast is NOT gated on the auto-calc toggle, which gates effect-modifier layers and not a
spell's own mechanic. And the Conjure tables and the meta-rules (Dispel Magic, Globe of
Invulnerability) stay prose `higher_level` — a permanent exclusion, not a gap.

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
(below), not because of a flag; a ritual is castable without a slot, and its SOURCE varies (a wizard
rituals from the spellbook unprepared, a prepared caster only what is prepared) — `ritual_source`
says which, on the class, on a subclass that grants it to a class with none, or on an option the
character chose of a class feature (a 2014 warlock's Book of Ancient Secrets), the option's
statement winning over the subclass's and that over the class's; and it is asked of
the class a spell is cast AS (`canCastAsRitual`), never of the character as a whole: a wizard's
spellbook does not make a sorcerer's spell a ritual; cantrips are
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

**A doubling or a halving multiplies the finished value — RAI.** "The target's speed is doubled"
(Haste) and "Speed halved" (2014 exhaustion) name the speed the creature has, its other bonuses
included; neither SRD orders a multiplication against an addition beyond rounding down. So `mult`
folds after every layer and before the caps (`rules/pipeline.ts` ▸ `fold`): Haste over Longstrider
is (30 + 10) × 2.

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

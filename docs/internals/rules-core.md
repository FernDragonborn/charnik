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
much as a design one — see `SECURITY.md`.

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

The normative spec for all of it is `EFFECTS.md`, with `PLUGINS.md` and `ACTIONS.md` as companions.

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

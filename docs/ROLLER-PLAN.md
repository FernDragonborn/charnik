# ROLLER-PLAN — Claude working ledger (the roller rewrite: ROLLER-N + the audit behind it)

> Scope: `src/lib/rules/dice.ts` (the pure roller), `src/lib/combat/roll.ts`, `src/lib/dice/roll-toast.ts`,
> `src/routes/combat/roll.svelte.ts`. Companion to `docs/PLAN.md` · `ROLLER-N`, which stays the
> roadmap entry; this is the working detail.
> `[ ]` open · `[~]` partial · `[x]` done+verified. Update it in the same change as the code.

## Why now

The roller was written first, before effects, before the roll card, before upcasting. It has held up
mechanically — one roll path, injectable rng, cost caps, 35 unit tests — but its **result shape** is
from a time when a roll was a line of text. Four separate pieces of work are now blocked on that
shape (`ROLLER-N`, `UBUG-21`, crits, the advantage fold), so the shape is the thing to change, once.

**What is NOT wrong** (don't "fix" these): the injectable `Rng` that makes tests deterministic; the
`MAX_DICE_PER_TERM` / `MAX_DIE_SIDES` caps that stop a hostile formula freezing the tab; `DieMods`
deliberately not touching signed bonus dice (GWF rerolls the weapon's dice, not a Bless die); the
single roll path itself, which exists because three copies had already drifted.

---

## Audit (2026-08-10, maintainer asked "where has the roller aged")

### A · The roller returns a formatted STRING, and the UI parses it back — the root finding

`Rolled.expr` ("d8(5) + d6(2) +3") is the only per-die record, and it is what gets persisted into
`log.jsonl`. `parseRollExpr` then recovers per-die chips from it with a regex. Consequences:

- **It breaks the house contract.** CLAUDE.md: "computed values are explainable — core returns value
  + provenance trace, each `{source, op, amount}`, never bare numbers". `rules/pipeline.ts` does
  exactly that. The roller is the one computation in the app that answers with prose instead.
- **The format is a persisted schema with no version.** Change how a die is written and every
  historical log entry renders differently or not at all.
- **What can't be encoded doesn't exist**: which effect contributed a die (a Bless d4 vs the weapon's
  own d8), a die's damage type, whether a die was doubled by a crit.
- **It is already lossy.** `formatExpr` documents that it cannot round-trip a positive bonus die's
  sign, so after one round trip a pool die and an effect die are indistinguishable.
- **The tell:** `amendWithAdvantage` and `clearAdvantage` do string surgery — parse the expr, remove
  or re-insert a `d20(n)` term, re-join — to add and undo a die.

**Decision: the roller returns structured dice, and the string becomes a rendering of them, not the
record.** A rendered `expr` may stay for backwards compatibility with already-persisted entries;
nothing new should read it.

### B · Crits do not exist

A natural 20 tints the roll card gold and does nothing else — attack damage is not doubled anywhere
in `attackRoll` or `cast`. PLAN §9 specifies both the Crit toggle and the rule-option for crit method
(*classic* = double the dice · *loyal* = one set maxed + one set rolled, default classic, switchable
in settings and per-roll). Neither exists. The rendering already anticipates it: the toast model's
comment says "a crit's doubled dice ride ONE pill, divided".

Crits need the structured shape from A — "these dice are the doubled ones" is not expressible in a
string — which is why this rides the rewrite rather than being bolted on.

### C · `Rolled` is flat, so the volley model lives one layer too high

One roll, one total. The N-attacks-in-one-action model therefore lives in the TOAST layer as
`RollToastAttack[]`, i.e. the data structure describing rolls sits in the view. That is why
`ROLLER-N` looks large: it is not adding a loop, it is moving the model down to where it belongs.

### D · Advantage is an argument, not a property of the roll

`rollPool(dice, mod, advantage, …)` applies advantage to **the first d20 in the pool only**
(`k === 0`). A pool with two d20 silently rolls the second one straight. `natural` is likewise "the
first d20's", so a multi-d20 pool has no defined nat-20. Nothing in the app rolls two d20 in one pool
today, so this is a latent trap rather than a live bug — but it is the same modelling error as A:
the roll's *manner* is passed alongside the dice instead of being part of what a roll IS.

### E · `rollFormula` silently drops a flat modifier that isn't at the end — REAL BUG

Proven: `rollFormula('1d6+3+1d4')` with maximal dice totals **10, not 13**. The `+3` is lost, because
the modifier regex only looks at the tail (`/([+-]\s*\d+)\s*$/`).

Reachable from CONTENT, which is what makes it matter: `RollButton` rolls formulas straight out of
compendium CSVs, and `heal:<formula>` comes from a `resource_option.action` cell. A homebrew author
writing `heal:1d8+2+1d4` gets a quietly smaller heal. Same failure class as `UBUG-21` — a wrong
number with no complaint — and the reason the project's rule is "never a silently-wrong single big
die". **Filed separately as `UBUG-22`: it is independent of the rewrite and should not wait for it.**

### F · `Rolled.natural` was documented wrong — FIXED 2026-08-10

The interface said "post reroll/floor"; the implementation is post-reroll, **pre**-floor, and the
implementation is right (Reliable Talent's "treat as 10" must not erase a natural 1). Comment
corrected in place — no behaviour change.

---

## The dice must survive a state change (maintainer, 2026-08-10) — and today they don't

**The requirement.** Toggling advantage / disadvantage / neither must never re-roll. The dice that
were rolled are a fact; the mode is an interpretation of them.

**This is currently broken, and it is worse than a nicety.** `cycleAdvantage` goes
none → advantage → disadvantage → none, and `clearAdvantage` *removes* `advantageRoll` on the way
back to neutral. The second die is then forgotten, so the next tap rolls a **fresh** one. A player
who keeps cycling keeps drawing new second dice and can stop on whichever they like. That defeats the
exact property the control was justified with ("only the first tap draws a die, so tapping can never
manufacture a better outcome"). It is a slot machine with extra steps.

**On the maintainer's "return two batches up front and switch between them in the UI".** Half right,
and the right half is the important one:

- **Preserving both dice: yes.** That is the fix.
- **Rolling both up front, always: no** — that is the crutch you suspected. Every ordinary roll would
  quietly roll a d20 nobody asked for, the RNG draw of every roll in the app would change, and the
  log would record a die that was never in play. It also does not generalise: the same argument
  would demand pre-rolling a third die for Elven Accuracy, and a doubled set for a possible crit.

**The clean shape — the roll records the dice it rolled; the mode selects which one counts.**

```ts
// sketch, not final
d20s: number[];              // every d20 this roll drew, in the order drawn
advantage: 'advantage' | 'disadvantage' | 'neither';   // an interpretation, freely switchable
```

`kept` / `dropped` become derived, not stored. `original` (added 2026-08-10 purely so neutral could
be reconstructed) disappears — it is just `d20s[0]`. Switching mode never draws; the FIRST switch
away from `neither` appends one die and every switch after that is pure. Elven Accuracy is then a
third element rather than a new concept, and the "which was rolled first" question stops being a
special field.

This also folds the two-state duplication already recorded on `ROLLER-N`: `AdvantageRoll.mode` and
`RollToastAttack.advantageMode` are one fact spelled twice, and `dropped` + `advantageMode` are both
projections of the pair.

---

## Slices (draft — sequence, not yet estimates)

1. `[ ]` **UBUG-22 first, on its own** — the `rollFormula` mid-string modifier bug. Independent of
   everything below, reachable from content, cheap.
2. `[ ]` **Structured result.** `Rolled` carries dice, not prose: per-die `{sides, value, face,
   detail, source?}`. Keep emitting `expr` as a rendered view for entries already on disk; nothing
   new reads it. `parseRollExpr` survives only as a **legacy log reader** and is documented as such.
3. `[ ]` **Advantage as recorded dice + a mode** (the section above). Kills the re-roll leak, folds
   `mode`/`advantageMode`/`dropped`/`original` into one representation, and makes Elven Accuracy a
   data point rather than a feature.
4. `[ ]` **Sub-rolls.** A roll becomes a tree: one action → N attacks → each a to-hit + damage parts.
   Moves `RollToastAttack[]` out of the view layer. This is `ROLLER-N` proper, and it is also what
   `UBUG-21` needs (the dice tray can finally show and edit the damage half, not just the to-hit).
5. `[ ]` **Crits.** The `natural === 20` hook exists; the toggle, the per-roll override and the
   *classic* / *loyal* rule-option (PLAN §9) do not. Needs slice 2's structure to mark which dice are
   the doubled ones.

**Not in scope, recorded so it isn't re-derived:** the −1 · 0 · +1 axis on `rollPool(advantage)` /
`netAdvantage(fx)` stays numeric. That is arithmetic over effects that sums and clamps — a different
fact from "how this roll was decided", which is the one that becomes a named member.

## Conventions (do not drift)

- The roller stays **pure**: no Svelte, no toast, no storage. Determinism under a seeded rng is a
  test property and a correctness property.
- A change to what a roll RECORDS is a change to `log.jsonl`. Old entries must keep loading — the
  legacy reader is the seam for that, not a migration.
- Never a silently-wrong number. Where the roller cannot express a mechanic, it must surface a
  reminder rather than roll something plausible (PLAN item 9).

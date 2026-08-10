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

### G · The PERSISTED roll is a far poorer record than the in-session one — two schemas, silently

Bigger than A, and it is data loss rather than awkward encoding. `persistRoll`
(`state.svelte.ts`) writes `{t, kind, label, result, detail: expr}` and **drops everything else**:
`damage[]` (the whole per-type damage array), `advantageRoll` (both dice and the mode) and `note`
(upcast provenance, amendment records). `tray.seed` rehydrates `{label, expr, total}`.

So after a reload the log is not the log you were looking at:
- every attack has lost its damage — the number the player actually cared about;
- every advantage/disadvantage roll has lost its pair, so no frame and no struck-through die;
- an upcast's "Xd base + Yd @ slot N" and any amendment record are gone.

And it interacts badly with what shipped 2026-08-10: the d20 pill will cheerfully offer to amend a
REHYDRATED roll, computing from a partial record — and `reviseEntry` never writes back, so the
correction dies with the session anyway. **Any rewrite must make the persisted entry and the
in-session entry the same shape**, and decide the write-back question rather than inherit it.

### H · `LogEntry.kind` is a dead taxonomy, and a bare string

The interface documents `"attack" | "save" | "check" | "damage" | "custom"`; every write hardcodes
`'roll'`. So the field costs bytes and buys nothing, and when it is revived it should be a named
member, not a free string (AI-CONVENTIONS §1.5).

### I · PLAN §9 promises a roll log the code does not deliver

The spec says the panel is backed by `log.jsonl` for a "full persistent history across sessions,
grouped by session/date and searchable — **NOT capped to recent rolls**", scrolling the whole history
(virtualized), with a hover-delete per row. Reality: capped at `LOG_MAX_LINES = 500` on disk and
`ROLL_LOG_MAX = 200` in memory, no grouping, no search, no virtualization, no per-row delete.
Not a bug in itself — but the rewrite is when to either build it or move the spec, because both
numbers are the roller's own contract.

### J · The plugin contract makes the FORMULA STRING a public API and a trust boundary

`PLUGINS.md`: *"Randomness belongs to the host. You never roll dice — you return dice FORMULAS …
Charnik's single dice path rolls them, so the roll log stays honest"*, with `rolls: [{label,
formula}]` on the action contract. So `rollFormula` — the function with **UBUG-22**'s silent
modifier loss — is the sandboxed-plugin entry point. That raises UBUG-22 from "a content bug" to
"the plugin API quietly miscomputes and the plugin cannot tell", and it sets a rule for the rewrite:
**a formula the parser cannot fully account for must SURFACE, never roll the part it understood.**
The existing cost caps guard cost; nothing currently guards meaning.

### K · `DiceTrayRequest.instances` does not exist, though PLAN says the contract is fixed

ROLLER-N reads "Contract `DiceTrayRequest.instances` is already fixed; the loop … unbuilt". There is
no such field anywhere in `src`. Corrected in PLAN. Also note `formula: string` is REQUIRED even when
`pool` is supplied, so the string sits on the critical path of every tray roll too.

### L · "This is a d20 test" is implied, not stated — and a plugin hook depends on it

`PLUGINS.md` defines the hook group `d20_tests`, which "fans out to every d20 roll (saves,
checks/skills, attack, initiative)". Today that concept exists only as `{20: 1}` happening to be in
the pool. Once a roll can carry sub-rolls, "which of these is the d20 test, and which kind" has to be
explicit in the model or the hook has nothing reliable to bind to.

### M · Changing the draw ORDER breaks every seeded expectation — do it in one deliberate commit

TESTING.md pins a seeded RNG for the dice roller as a determinism contract. Any reshuffle (rolling
the advantage die at a different moment, pre-rolling anything) changes what a seeded sequence
produces. Harmless live, noisy in tests — so it must be one intentional change, not a drift across
slices. Keep `rngSequence`'s over-draw throw: it is what catches an accidental extra draw.

**Property tests are missing for the roller specifically.** TESTING.md's fast-check list covers the
mod formula, capacity, stacking order-stability and save/load identity — nothing for dice. The
rewrite is the moment to pin: total = Σ contributing dice + mod; a kept advantage die is never worse
than the dropped one; **cycling the advantage state never changes the multiset of dice drawn** (the
property the current leak violates); and amend→flip→clear returns the original roll exactly.

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

## What the programmatic interface should look like (agreed with the maintainer 2026-08-10)

The one sentence the rest follows from: **the roller should return what HAPPENED, not how to show
it.** Today it returns a rendering, and every gap in the audit above is a consequence.

### 1. One typed request in, not five positional arguments

`rollPool(dice, mod, advantage, bonusDice, opts)` puts a magic `−1 / 0 / +1` in the third position.
AI-CONVENTIONS §2.8 forbids exactly this, and the best evidence is that `RollSpec` in the tray
**already exists** with the motivation spelled out in its own comment — "so a roll site passes one
typed object instead of 5–6 positional args". The right request was invented one layer up; the
roller should take it directly.

### 2. Every die carries where it came from

```ts
// sketch
interface RolledDie {
	sides: number;
	face: number;   // what it showed — after a reroll, BEFORE a min_die floor
	value: number;  // what it contributed
	sign: 1 | -1;
	source?: string; // "Greataxe" · "Bless" · "Rage" — the provenance a string can never hold
	role?: 'pool' | 'bonus' | 'alternate' | 'crit';
}
```

`source` IS the house contract ("value + provenance trace") in one field — right now nothing can say
the d4 came from Bless and the d8 from the weapon. `role` is what lets crits and advantage stop being
side channels: "these dice are the doubled set" and "this die is the alternate" become properties of
a die instead of extra fields beside it.

### 3. Amendments are STRUCTURE, not prose

The current wart, and it is self-inflicted (2026-08-10): `amendWithAdvantage` returns the roll and
lets the CALLER compose the note sentence — which forced an `AMEND_NOTE` regex in `roll.svelte.ts`
to find and replace that sentence inside a note so cycling back to neutral wouldn't eat an upcast's
provenance. A regex that parses a sentence we ourselves wrote is the same sin as `parseRollExpr`, one
floor up.

Want instead: `amendments: [{ kind: 'advantage', from, to, dice }]`. Then "the record stays truthful"
is a structure, not a sentence that has to be parsed back out.

### 4. The record holds FACTS; the UI writes the sentences

Direct consequence of §3, and it converges with **ARCH-1**: today an English sentence is written into
`log.jsonl`. Prose already on disk cannot be localised later, so the UA pass would have nothing to
work with. Facts on disk render in any locale for free.

### 5. `{ roll, issues }`, never a bare roll (§2.7)

`rollFormula` currently has no way to say "I did not understand part of this", which is precisely why
**UBUG-22** is silent. Since the formula string is the plugin API (finding J), this is a trust
boundary: an unparsed fragment must surface as an issue, not be dropped while the understood part
rolls. The content loader is the house precedent — collect `issues[]`, never throw.

### 6. Two levels, not a general tree

Action → instances → parts (a to-hit plus damage parts). The pull toward "arbitrary depth, just in
case" should be refused: ROLLER-N needs exactly two levels and nobody has asked for a third.

### Explicitly NOT wanted

- A formatted string as the RECORD. Rendering is a pure function OF the record, computed at display
  time — so `expr` survives only as a reader for logs already on disk, renamed to say so
  (`parseLegacyExpr`), and nothing new reads it.
- The roller drawing anything the caller did not ask for (no pre-rolled second dice — see the
  section above on why the "two batches up front" shape was rejected).
- Any knowledge of toasts, storage or language inside the roller. It stays pure.

---

## Slices (draft — sequence, not yet estimates)

1. `[ ]` **UBUG-22 first, on its own** — the `rollFormula` mid-string modifier bug. Independent of
   everything below, reachable from content, cheap.
2. `[ ]` **One record, persisted and in-session (finding G).** Today the disk entry silently drops
   damage, the advantage pair and the note. Make the persisted shape the same shape, decide whether
   an amendment writes back, and keep old lines loadable. Do this EARLY: every slice below makes the
   in-session record richer, which widens the gap if the disk side is left behind.
3. `[ ]` **Structured result.** `Rolled` carries dice, not prose: per-die `{sides, value, face,
   detail, source?}`. Keep emitting `expr` as a rendered view for entries already on disk; nothing
   new reads it. `parseRollExpr` survives only as a **legacy log reader** and is documented as such.
4. `[ ]` **Advantage as recorded dice + a mode** (the section above). Kills the re-roll leak, folds
   `mode`/`advantageMode`/`dropped`/`original` into one representation, and makes Elven Accuracy a
   data point rather than a feature.
5. `[ ]` **Sub-rolls.** A roll becomes a tree: one action → N attacks → each a to-hit + damage parts.
   Moves `RollToastAttack[]` out of the view layer. This is `ROLLER-N` proper, and it is also what
   `UBUG-21` needs (the dice tray can finally show and edit the damage half, not just the to-hit).
6. `[ ]` **Crits.** The `natural === 20` hook exists; the toggle, the per-roll override and the
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

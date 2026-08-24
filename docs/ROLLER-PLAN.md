# ROLLER-PLAN — Claude working ledger (the roller rewrite: ROLLER-N + the audit behind it)

> Scope: `src/lib/rules/dice.ts` (the pure roller), `src/lib/combat/roll.ts`, `src/lib/dice/roll-toast.ts`,
> `src/lib/dice/roller*.ts` (the organ), `src/lib/components/Roller*.svelte`,
> `src/routes/combat/roll-tray.svelte.ts`. Companion to `docs/PLAN.md` · `ROLLER-N`, which stays the
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
nothing new should read it. **SHIPPED 2026-08-22 (slice 3).** Every consequence listed above is
closed except the last: the toast no longer parses a string, the format is no longer a versionless
persisted schema (the dice are), a die's role is expressible, and the amend path is dice surgery
rather than string surgery. WHICH EFFECT contributed a die is the one that stays open — `source` is
on `RolledDie` and no roll site fills it yet.

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

`rollPool`'s `advantage` applies to **the first d20 in the pool only**
(`k === 0`). A pool with two d20 silently rolls the second one straight. `natural` is likewise "the
first d20's", so a multi-d20 pool has no defined nat-20. Nothing in the app rolls two d20 in one pool
today, so this is a latent trap rather than a live bug — but it is the same modelling error as A:
the roll's *manner* is passed alongside the dice instead of being part of what a roll IS.

### E · `rollFormula` silently drops a flat modifier that isn't at the end — REAL BUG, FIXED 2026-08-21

Proven: `rollFormula('1d6+3+1d4')` with maximal dice totals **10, not 13**. The `+3` is lost, because
the modifier regex only looks at the tail (`/([+-]\s*\d+)\s*$/`).

Reachable from CONTENT, which is what makes it matter: `RollButton` rolls formulas straight out of
compendium CSVs, and `heal:<formula>` comes from a `resource_option.action` cell. A homebrew author
writing `heal:1d8+2+1d4` gets a quietly smaller heal. Same failure class as `UBUG-21` — a wrong
number with no complaint — and the reason the project's rule is "never a silently-wrong single big
die". **Filed separately as `UBUG-22`: it is independent of the rewrite and should not wait for it.**

**Fixed** (slice 1 below): the two parsers now share one `DICE_TERM` regex, and `parseFlatModifier`
strips the dice before summing every signed term — so the pool parser and the modifier parser cannot
disagree about what is a die, which was the root cause rather than the tail regex itself. `attacks.ts`
lost its private copy (`segmentMod` + `segmentFlatBase`) to the shared one. Note for slice 3: this
still does NOT surface what it could not parse (§5) — an unrecognised fragment is ignored, not
reported. That stays open, and it is now the only part of finding J's rule still unmet.

### F · `Rolled.natural` was documented wrong — FIXED 2026-08-10

The interface said "post reroll/floor"; the implementation is post-reroll, **pre**-floor, and the
implementation is right (Reliable Talent's "treat as 10" must not erase a natural 1). Comment
corrected in place — no behaviour change.

### G · The PERSISTED roll is a far poorer record than the in-session one — two schemas, silently

Bigger than A, and it is data loss rather than awkward encoding. `persistRoll`
(`combat-view-model.svelte.ts`) writes `{t, kind, label, result, detail: expr}` and **drops everything else**:
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

### H · `LogEntry.kind` is a dead taxonomy, and a bare string — FIXED 2026-08-21

The interface documented `"attack" | "save" | "check" | "damage" | "custom"`; every write hardcoded
`'roll'`, so a reader could not trust the field. It is now `LOG_KIND` with the ONE member that is
actually written (AI-CONVENTIONS §1.5). Reviving the taxonomy means adding a member, at which point
every switch over it stops compiling until it handles the new one — which is the whole point of a
named member over a free string. The field stays on the line: every entry already on disk carries it.

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

**Property tests were missing for the roller specifically — ADDED 2026-08-24.** All four are in
`rules/dice.test.ts` and in TESTING.md's list: total = Σ contributing dice + the one d20 that counts
+ mod; a kept advantage die is never worse than a dropped one; **cycling the advantage state never
changes the multiset of dice drawn** (the property the 2026-08-22 leak violated); amend→flip→clear
returns the roll exactly as it landed.

---

## The dice must survive a state change (maintainer, 2026-08-10) — BUILT 2026-08-22 (slice 4)

> The shape below is what shipped, with one correction from slice 3: `d20s` holds `RolledDie`, not
> bare numbers, or an ordinary d20's reroll/floor story would be lost the moment it moved out of the
> pool. `kept`/`dropped`/`original` are derived exactly as predicted, and `original` is gone.

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

### 1. One typed request in, not five positional arguments — `[~]` HALF DONE 2026-08-14

`rollPool(dice, mod, advantage, bonusDice, opts)` put a magic `−1 / 0 / +1` in the third position.
AI-CONVENTIONS §2.8 forbids exactly this, and the best evidence is that `RollSpec` in the tray
**already exists** with the motivation spelled out in its own comment — "so a roll site passes one
typed object instead of 5–6 positional args". The right request was invented one layer up; the
roller should take it directly.

**Done:** the signature is now `rollPool(dice, RollPoolOptions | Rng)` — `mod`, `advantage` and
`bonusDice` are named fields, and a `RollEffects` spreads straight in
(`{ ...fx, mod: fx.flat, advantage: netAdvantage(fx) }`). The bare-`Rng` shorthand stayed, because
most test call sites pass nothing else. This was taken early, out of order, because `max-params`
was warning on it and the fix is independent of the result-shape work.

**Still open:** taking `RollSpec` ITSELF — one request carrying the label, the type and the damage
parts, not just the dice. That belongs with the structured result (3 below); until the roller
answers with facts there is nothing for the extra request fields to become.

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
lets the CALLER compose the note sentence — which forced an `AMEND_NOTE` regex in `roll-tray.svelte.ts`
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

1. `[x]` **UBUG-22 — DONE 2026-08-21, on its own.** The `rollFormula` mid-string modifier bug; see
   finding E for what shipped (one shared `DICE_TERM` + `parseFlatModifier`, `attacks.ts`'s duplicate
   parser deleted). What it deliberately did NOT do: surface an unparsed fragment (§5) — that waits
   for the `{roll, issues}` shape.
2. `[x]` **One record, persisted and in-session — DONE 2026-08-21.** `LogEntry.roll` now carries the
   WHOLE `RollLogEntry` (a type-only import, so the character layer gains no runtime edge into
   combat), and `logLineFor` is the one builder an append and a revision share — they cannot write
   different shapes. The flattened `result`/`detail` stay, written but never read back when `roll` is
   present: an older build can still read a new line, and a line from before today still loads (it
   rehydrates to exactly the poor record it always was). `RollLogEntry.at` moved the timestamp onto
   the ROLL — the line used to invent its own at write time, which is part of how the two records
   drifted apart.
   **The write-back question, decided: an amendment REWRITES its own line.** `reviseLog` replaces the
   line matching the roll's `at`, on the same per-slug chain as the append. Appending would record one
   roll twice; leaving it alone was the actual bug — the pill offered to amend a rehydrated roll and
   the correction died with the session. The file is rewritten in full on every append anyway, so this
   is not a new write pattern. A roll that has rotated off disk is a silent no-op, never an append.
   **Verified live** (web build, IndexedDB): a Greataxe attack survives a reload with its damage AND
   its disadvantage pair intact — before, the reloaded log had a label and a total and nothing else.
3. `[x]` **Structured result — DONE 2026-08-22.** `Rolled` carries `dice: RolledDie[]` + `mod`, and
   the roller answers with what happened instead of with a rendering of it. Each die is
   `{sides, value, face, sign, detail, role, source?}`.
   **`role` was added to the sketched shape, and it earns its place twice.** It is what makes `expr`
   an EXACT rendering — a positive bonus die writes its `+`, a pool die does not, the one thing the
   old chip formatter documented that it could not round-trip — and it is where slice 6's "these are
   the doubled dice" goes without a field beside the die. A named member (`DIE_ROLE`), so adding
   `crit`/`alternate` later fails every unhandled switch.
   **The legacy string is now behind ONE seam.** `parseRollExpr` → **`parseLegacyExpr`**, documented
   as the reader for lines already on disk and nothing else; every stored roll enters through
   `rehydrateRoll`, and a log row through **`rehydrateLogEntry`** (combat layer), which also fills the
   DAMAGE parts — rehydrating only the row gave a reloaded attack its d20 back while its damage pills
   stayed empty. The dev fixture ladder is written in `expr` strings and rehydrated, so the preview
   and the legacy reader are exercised by the same 26-state visual run (0 px).
   **What came off string surgery:** `amendWithAdvantage` and `clearAdvantage` add and remove the d20
   in the dice array now, and re-render `expr` after. A floored d20's natural is right for the first
   time — the amend path fell back to the die's VALUE because a string could not tell 3→10 apart.
   **Deliberately not done here:** `source` is declared but nothing fills it yet (a roll site has to
   pass provenance — it lands with slice 5's sub-rolls, where a die's origin is the point); advantage
   still lives beside the dice (slice 4); `{roll, issues}` (§5) still open.
4. `[x]` **Advantage as recorded dice + a mode — DONE 2026-08-22.** `Rolled` carries
   `d20s: RolledDie[]` (every d20 it drew, in DRAW order) + `advantage: AdvantageMode`
   (`neither`/`advantage`/`disadvantage`). `kept`/`dropped`/`original`/`mode`/`advantageMode` are all
   gone: `keptD20`, `droppedD20s` and `naturalOf` derive them, so a mode switch cannot disagree with
   the dice it is switching between.
   **The re-roll leak is closed and verified in the browser.** `setAdvantage` draws only on the first
   switch away from `neither`; six taps round the cycle on `/dev/rolltoast` keep the same pair
   ({9, 3}) and the note follows it. `amendWithAdvantage`/`flipAdvantage`/`clearAdvantage` collapsed
   into that one function, with `cycleAdvantage` a three-line loop over it.
   **A visible consequence, called out for a look:** back at `neither` the second die is still shown,
   struck through and unframed, because it really was rolled — the old code deleted it, which is
   exactly how the next tap could draw a fresh one.
   **A second, older bug fell out of it.** The amendment sentence was matched back out of the note by
   a regex that could only eat as far as the next `·`, so "advantage after the roll · kept 19 over 7"
   left "· kept 19 over 7" behind on every lap and the note grew. The sentence is now ONE segment
   ("… (kept 19 over 7)"), built by a pure `amendedNote` in `combat/roll.ts` that the combat VM and
   the dev preview share, with a test that walks a full lap. The structured
   `amendments: [{kind, from, to}]` of §3 is still the real fix.
   **Legacy:** an old `{kept, dropped, mode?, original?}` pair converts on read; without `original`
   the pair is known but its ORDER is not, so such a roll reads either way round but cannot return to
   `neither` (`drawOrderUnknown`) — a total built on a guessed first die is exactly the silently-wrong
   number the house rule forbids.
   Elven Accuracy is now a third element in `d20s` rather than a new concept — still unbuilt, but no
   longer a modelling question.
5. `[x]` **Sub-rolls — DONE 2026-08-24, as the ROLLER ORGAN.** A roll is now built as LINES, and a
   line carries a role: a d20 test is a verdict (one die decides, the rest only colour it), damage is
   a quantity (every die counts and they add up). One action fires N instances of them
   (`RollerOrgan.roll()` answers with `RollLogEntry[]`), each logged on its own line and toasted as
   one card. `RollToastAttack[]` stays as the toast's VIEW model, which is what it always should have
   been — what moved down is the thing that produces it.
   **`UBUG-21` closes with it.** The tray's damage was a queue it could neither show nor edit, so
   everything adjustable belonged to the to-hit under a heading that said "Greataxe"; a `+1d6` typed
   for a damage rider was summed into the d20. It is now the second LINE, made of the same pills.
   **Two silently-wrong numbers fell out on the way.** A prefilled roll dropped an effect's DICE
   entirely — alt-clicking under Bless rolled a d4 short of the same roll tapped normally — and the
   reroll/bound facts now ride the POOL's own dice (`DicePill.min`/`max`/`reroll`), so a Great Weapon
   Fighting reroll cannot reach a Bless die in the same line.
   **What a line does NOT do:** it is two levels, not a tree (§6 above). A per-instance target, a
   per-instance advantage and Elven Accuracy are all still unbuilt — the volley rolls the same set N
   times, which is what §12 of the design decided a volley IS.
6. `[x]` **Crits — DONE 2026-08-24.** `DIE_ROLE.crit` + `CRIT_METHOD` (*classic* rolls the dice
   twice, *loyal* maxes one set), a toggle on the damage line, a rule option in Settings ▸ General
   and a per-roll override in the roller itself. RAW: every DIE the roll made gains a twin — the
   weapon's and an effect's alike — and the flat modifier gains nothing, which is the half of the
   rule tables get wrong. A crit is never inferred from a natural 20: the same 20 is a crit on an
   attack and just a 20 on a check, and a crit happens without one (finding B).

**Not in scope, recorded so it isn't re-derived:** the −1 · 0 · +1 axis on `rollPool(advantage)` /
`netAdvantage(fx)` stays numeric. That is arithmetic over effects that sums and clamps — a different
fact from "how this roll was decided", which is the one that becomes a named member. The two meet at
exactly one seam, `advantageMode()` in `roll-tray.svelte.ts`.

---

## The organ (design agreed 2026-08-24, built the same day)

The design doc is a Claude Design page ("Roller Spec"); what it DECIDED lives here, because a link
is not a record. Modules: `dice/roller.ts` (pure model), `dice/roller-vocabulary.ts` (the suggestion
menu, pure), `dice/roller-sources.ts` (the one file that reads the content graph),
`dice/roller.svelte.ts` (live state), `components/Roller.svelte` + `RollerLine.svelte`.

- **The app never knows AC or DC, so no threshold is ever shown.** "Hit" is the player's call. The
  one outcome the app may name by itself is a natural 1.
- **A line is a list of PILLS, not a formula string** — the same decision `Rolled.dice` made one
  floor down. A pill holds what a string cannot: which effect gave the die, that a bound applies to
  it, that a damage type was inherited rather than typed.
- **Colour lives in the TEXT, never in a pill's fill.** Every pill is `--color-surface-2` +
  `--color-border-strong`; the number's colour says what it is. Tinted fills belong to the two state
  toggles alone, so "this is a test" and "this line is focused" cannot read as one signal — which is
  also why line focus is a neutral light border rather than the role colour.
- **Only a fragment that looks like arithmetic and did not parse blocks the roll** (`+d4?`). A bare
  WORD never blocks: on a damage line it is a damage type (homebrew invents them freely), anywhere
  else it is a label the player wrote beside a die. A missing damage type underlines and rolls — the
  number is not in doubt.
- **The language you type in is not the language the UI is in.** A name matches across every
  localized `name_*` a row carries and against the key; the menu SHOWS the interface locale's name;
  the pill and the log keep the key. An exact name two candidates share stays unresolved rather than
  guessed.
- **Rejected, so it is not re-proposed:** a `|` pipe separating the two halves of one field; tabs
  instead of two lines (both halves must be visible at once); a separate "situational modifier"
  control (it is an ordinary pill in the line it belongs to); an "untyped" segment in the result.

**Deliberately not built, with the reason** (so none of it reads as an oversight):

- **Clicking a pill's NUMBER does not place a caret inside it.** The spec wants text behaviour to
  win there; pills are elements beside an `<input>`, not runs inside a contenteditable, so there is
  no caret to place. What a mouse gets instead: click selects the pill (focus IS the selection, and
  Del removes it), double-click unfolds it back to the exact text it was made from, and `−`/`+`
  appear on hover for the quantity. The contenteditable rewrite is the only way to close this and it
  buys one interaction.
- **The mouse wheel over a pill.** Svelte registers `onwheel` passively, so the handler cannot
  `preventDefault` and the tray would scroll under the cursor while the number changed. The `−`/`+`
  cover it.
- **The resist/vulnerability reminder under a result** (§10, third row). The app knows the
  CHARACTER's resistances and not the target's, so the honest version of this reminder is a line
  that says the same thing on every damage roll — noise. It needs a target concept first.

**Still open.** Where the organ lives physically — a popover anchored to whatever launched it,
inline in the Playbar for the last roll, or both modes of one panel — is undecided; today it is the
dice-tray popup, which is what §12 said it replaces. `RolledDie.source` is still filled only for a
die the player named: a prefilled effect die arrives known but UNNAMED (`pillsFromPool` gives it an
empty source so it stays an effect die), because no roll site threads the effect's identity yet.
Damage types have no localized names anywhere in the data, so they match and display in English
until some content carries them.

## Conventions (do not drift)

- The roller stays **pure**: no Svelte, no toast, no storage. Determinism under a seeded rng is a
  test property and a correctness property.
- A change to what a roll RECORDS is a change to `log.jsonl`. Old entries must keep loading — the
  legacy reader is the seam for that, not a migration.
- Never a silently-wrong number. Where the roller cannot express a mechanic, it must surface a
  reminder rather than roll something plausible (PLAN item 9).

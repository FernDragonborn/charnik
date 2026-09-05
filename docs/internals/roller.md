# The roller

> For maintainers. The pure dice engine, the record a roll leaves behind, and the dice tray the
> player types into. The ROLLER is the pure engine and its UI (`roller.ts`, `Roller.svelte`); the
> DICE TRAY is the live state the player edits and the popover it is mounted in. What is still
> OPEN lives in [`work/roller.md`](../work/roller.md).

## A roll answers with what happened, not with how to show it

`rollPool` returns structured dice; the string is a **rendering** of them, never the record. Every
consumer reads the dice.

```ts
interface RolledDie {
	sides: number;
	face: number;   // what it showed — after a reroll, BEFORE a min_die floor
	value: number;  // what it contributed
	sign: 1 | -1;
	detail: string; // the raw story — "4", "1↻4" rerolled, "3→10" floored
	role: DieRole;  // pool · bonus · crit
	source?: string; // which effect gave it — "Greataxe", "Bless"
}
```

This is the house contract (`rules-core.md` ▸ "Every value carries its provenance") applied to the
one computation that used to answer in prose. A formatted string cannot say which effect contributed
a die, what damage type it is, or that a die was doubled by a crit — and it cannot round-trip a
positive bonus die's sign, so after one pass a pool die and an effect die become indistinguishable.

`role` earns its place twice: it makes the rendered `expr` EXACT (a positive bonus die writes its
`+`, a pool die does not), and it is where "these are the doubled dice" lives without a field beside
the die.

**A flat modifier answers the same way.** `Rolled.mod` is a sum, and `modParts: FlatPart[]` is what
the sum was made of — so "+2 from Bless" and "+2 someone typed" stay two facts. It is recorded only
when at least one part knows its source: an anonymous `+3` is fully described by the total already
beside it, and the roll log is a capped file every roll pays into. `rollPool` takes `mod` OR
`modParts`, never both, so exactly one place decides the number.

**The legacy string is behind one seam.** `parseLegacyExpr` reads lines already on disk and nothing
else; a stored roll enters through `rehydrateRoll`, a log row through `rehydrateLogEntry` (which also
refills the damage parts — rehydrating only the row gives a reloaded attack its d20 back while its
damage pills stay empty). Nothing new reads `expr`.

## Advantage is recorded dice plus a mode

`Rolled` carries `d20s: RolledDie[]` — every d20 the roll drew, in draw order — and an
`AdvantageMode` (`neither` / `advantage` / `disadvantage`). `keptD20`, `droppedD20s` and `naturalOf`
DERIVE from that pair, so a mode switch cannot disagree with the dice it switches between.

**The dice that were rolled are a fact; the mode is an interpretation of them.** `setAdvantage` draws
a die only on the first switch away from `neither`; every switch after is pure. Without that, cycling
the control draws a fresh second die each lap and a player can stop on whichever they like — a slot
machine with extra steps, defeating the exact property the control is justified with.

Rolling both dice up front is the wrong fix and stays rejected: every ordinary roll would draw a d20
nobody asked for, the RNG consumption of every roll in the app would change, and the log would record
a die that was never in play. It also does not generalise — the same argument demands a pre-rolled
third die for Elven Accuracy and a doubled set for a possible crit.

Back at `neither` the second die is still SHOWN, struck through and unframed, because it really was
rolled. Elven Accuracy is a third element in `d20s`, not a new concept.

**Legacy:** an old `{kept, dropped}` pair converts on read, but without `original` the pair is known
and its ORDER is not, so such a roll reads either way round and cannot return to `neither`
(`drawOrderUnknown`). A total built on a guessed first die is exactly the silently-wrong number the
house rule forbids.

## Crits

`DIE_ROLE.crit` plus `CRIT_METHOD` — *classic* rolls the dice twice, *loyal* maxes one set and rolls
the other. There is a toggle on the damage line, a rule option in Settings ▸ General, and a per-roll
override in the roller.

RAW: **every die the roll made gains a twin** — the weapon's and an effect's alike — and the flat
modifier gains nothing, which is the half of the rule tables get wrong.

**A crit is never inferred from a natural 20.** The same 20 is a crit on an attack and just a 20 on a
check, and a crit happens without one. The tracker surfaces; it does not rule.

## Lines, roles, and instances

A roll is built as LINES, and a line's `ROLLER_ROLE` decides what it is for:

- **`test`** — a d20 test. One die decides it; the rest only colour it.
- **`damage`** — every die counts and they add up.

The role drives the stripe colour, which state toggle the line gets, and the line's vocabulary: a
damage type is neither offered nor resolved on a `test` line.

One action fires N instances of those lines — `DiceTray.roll()` answers with `RollLogEntry[]`,
each logged on its own line and toasted as one card. `RollToastAttack[]` is the toast's VIEW model,
which is all it should ever have been.

**A roll site describes the whole action ONCE.** `RollSpec` carries the label, the d20 test, the
damage parts, the note and how many instances fire; an absent `test` is what makes a roll a
QUANTITY (a Fireball's target saves, so it has no to-hit half). An attack used to arrive in two
calls whose second label was dropped on the floor. `times` belongs to the ACTION and not to its
test half, so a damage-only spell can fire N times too. The advantage axis is numeric in the
request — arithmetic over effects — and becomes the named mode at one seam, `RollTray.prefill`.

**The action survives the roll.** Entries of one action share a `group` GUID — a GUID because the
lines are written independently and each may be rewritten by an amendment, so nothing may depend on
their order or count. A lone roll carries none: one line already says it, and the log is capped.
`actionRuns` reads the log back as the actions it recorded; the log draws a run as one bracketed
`×N` block, one row per throw, so every throw keeps the live controls that belong to it.

**Two levels, not a tree.** Action → instances → parts. The pull toward arbitrary depth is refused:
nobody has asked for a third level. A volley rolls the same set N times — that is what a volley IS —
so a per-instance target and a per-instance advantage do not exist.

## The dice tray

`dice/roller.ts` (pure model) · `dice/roller-vocabulary.ts` (the suggestion menu, pure) ·
`dice/roller-sources.ts` (the one file that reads the content graph) ·
`dice/dice-tray.svelte.ts` (live state) · `components/Roller.svelte` + `RollerLine.svelte`.

- **The app never knows AC or DC, so no threshold is ever shown.** "Hit" is the player's call. The one
  outcome the app may name by itself is a natural 1.
- **A line is a list of PILLS, not a formula string** — the same decision `Rolled.dice` makes one floor
  down. A pill holds what a string cannot: which effect gave the die, that a bound applies to it, that
  a damage type was inherited rather than typed.
- **The fold keeps what a pill knows.** `foldValues` hands `rollPool` dice that carry their own
  `source` and a modifier told as its parts, so a Bless d4 and a typed d4 stay different on the card,
  in the toast and on disk. A die's and a modifier's hover names the effect; a `note` pill has no
  number, so `rollerNotes` takes the player's own words to the roll's note instead. The one loss
  still taken knowingly is per-die bounds — `min`/`max`/`reroll` fold to the LINE's `DieMods`, marked
  `ponytail:` in place, because no 5e mechanic writes two floors in one line.
- **Colour lives in the TEXT, never in a pill's fill.** Every pill is `--color-surface-2` +
  `--color-border-strong`; the number's colour says what it is. Tinted fills belong to the two state
  toggles alone, so "this is a test" and "this line is focused" cannot read as one signal — which is
  why line focus is a neutral light border rather than the role colour.
- **Only a fragment that looks like arithmetic and did not parse blocks the roll** (`+d4?`). A bare
  WORD never blocks: on a damage line it is a damage type (homebrew invents them freely), anywhere
  else it is a label the player wrote beside a die. A missing damage type underlines and rolls — the
  number is not in doubt.
- **Whitespace parses a token, but a token typed WITHOUT it still splits.** `2d6+3` is what a person
  types and what a pasted statblock carries, so a compound token becomes its signed terms — but only
  when EVERY term means something arithmetic on its own. `+d4?` therefore still arrives whole and
  still blocks, and `dm's-luck` stays one label instead of a word plus an unrollable `-luck`.
- **The caret is in the line.** ← / Ctrl+Z / Ctrl+arrow walk it token by token, and typing inserts
  where it stands.
- **The language you type in is not the language the UI is in.** A name matches across every localized
  `name_*` a row carries and against the key; the menu SHOWS the interface locale's name; the pill and
  the log keep the key. An exact name two candidates share stays unresolved rather than guessed.

**Where the dice tray lives:** a popover anchored to whatever launched it. Inline-in-the-Playbar and
a two-mode panel were both weighed and are not built.

**Deliberately unbuilt, with the reason:** Elven Accuracy — merely a third element in `d20s`, not a
modelling question; a per-instance target; and a per-instance advantage. A volley rolls the same set
N times, which is what the two-level model decided a volley IS.

**Rejected, so it is not re-proposed:** a `|` pipe separating the two halves of one field; tabs
instead of two lines (both halves must be visible at once); a separate "situational modifier" control
(it is an ordinary pill in the line it belongs to); an "untyped" segment in the result.

### Deliberately not built, with the reason

- **Clicking a pill's NUMBER does not place a caret inside it.** Pills are elements beside an
  `<input>`, not runs inside a contenteditable, so there is no caret to place. What a mouse gets
  instead: click selects the pill (focus IS the selection, and Del removes it), double-click unfolds it
  back to the exact text it was made from, and `−`/`+` appear on hover for the quantity. The
  contenteditable rewrite is the only way to close this and it buys one interaction.
- **The mouse wheel over a pill.** Svelte registers `onwheel` passively, so the handler cannot
  `preventDefault` and the tray would scroll under the cursor while the number changed. The `−`/`+`
  cover it.
- **A resist/vulnerability reminder under a result.** The app knows the CHARACTER's resistances and
  not the target's, so the honest version says the same thing on every damage roll — noise. It needs a
  target concept first.

## What is NOT wrong — do not "fix" these

The injectable `Rng` that makes tests deterministic. The `MAX_DICE_PER_TERM` / `MAX_DIE_SIDES` caps
(1000 each) that stop a hostile formula freezing the tab. `DieMods` deliberately not touching signed
bonus dice — Great Weapon Fighting rerolls the weapon's dice, not a Bless die. The single roll path,
which exists because three copies had already drifted.

The `−1 · 0 · +1` axis on `rollPool`'s `advantage` and on `netAdvantage(fx)` stays numeric: that is
arithmetic over effects which sums and clamps, a different fact from "how this roll was decided",
which is the named member. The two meet at exactly one seam, `advantageMode()` in `roll-tray.svelte.ts`.

## Conventions

- **The roller stays pure**: no Svelte, no toast, no storage. Determinism under a seeded rng is both a
  test property and a correctness property, and the four roller properties are listed in `testing.md`.
- **The log is a rolling recent history, not an archive** — the last **100 rolls**, which survive a
  restart so reopening the app shows the session before. Measured: a structured attack line (d20 +
  the advantage pair + a damage line + a note) is 678 B and a plain save 296 B, so the cap is
  ~30–66 KB. It is also the per-roll IO cost, because `writeLogLine` reads and rewrites the whole
  file on every append. Grouping by session, search, virtualized scrollback and a per-row delete are
  deliberately **not built**: nothing has asked for them, and an unbounded log makes every roll pay
  for the whole campaign.
- **A change to what a roll RECORDS is a change to `log.jsonl`.** Old entries must keep loading — the
  legacy reader is the seam for that, not a migration. The persisted entry and the in-session entry
  are the SAME shape (`logLineFor` is the one builder an append and a revision share), and an
  amendment REWRITES its own line rather than appending a second record of one roll.
- **A roll's NAME is a catalog key plus the word that is data.** `labelKey`/`labelValues` carry which
  sentence and what goes into it; `label` stays beside them as the English fallback, which is also all
  a custom roll or a homebrew spell's name ever has. A content row's own word passes through — no
  catalog knows what a user's pack calls its spell — while the phrase around it is the app's, and a
  slot picks a different key rather than being appended to the phrase it produced. A forced outcome is
  the same shape one field over: `outcome` is a FACT on the entry and `RollRow` says "{label} —
  auto-fail" around it, because a marker holds one key and the sentence could not have been one.

- **A roll's own provenance is FACTS, never a sentence — and so is an amendment.** `noteParts:
  SaidText[]` says what an upcast added and out of which slot, or which formula fragment rolled
  nothing; `amendments: RollAmendment[]` says what was changed after the roll — advantage re-read, a
  damage part rerolled. `rollToastModel` and `describeAmendments` are the two places that turn them
  into words, both taking the translator. `note` is the PLAYER's own words from a `note` pill, which
  are data and pass through; a row written before 2026-09-05 also carries the app's prose there, and
  that still renders — it is the legacy seam, and nothing writes it any more. Prose composed into
  `note` had to be matched back out with a regex, which ate an upcast's provenance once and grew the
  note a lap; prose already written into `log.jsonl` also cannot be localised afterwards, which is the
  whole reason the record keeps facts. Only what cannot be derived is stored: an advantage amendment carries the two MODES, never the dice,
  because the roll's own `d20s` are the record of those. The pre-2026-09-04 sentence is stripped by
  `withoutLegacyAmendment` the first time such a roll is amended — the `parseLegacyExpr` seam again.
- **Never a silently-wrong number.** Where the roller cannot express a mechanic it surfaces a reminder
  rather than rolling something plausible. Changing the draw ORDER breaks every seeded expectation, so
  it is one deliberate commit, never a drift across changes; `rngSequence`'s over-draw throw is what
  catches an accidental extra draw.
- **A bare number in a formula counts only as a LEADING value in a segment with no dice.** "70" and
  "1 bludgeoning" are values; `12 (2d6 + 5)` is the statblock average form the shipped monsters use
  and must roll 2d6+5, never 2d6+17. Prose numbers ("1d20 vs AC 15") are ignored for the same reason:
  a missing number beats a wrong one. One `DICE_TERM` regex is shared by both parsers, because what
  one skips the other must not read as a number.
- **An attack deals damage on dice OR on a flat value.** Unarmed Strike is `1 + STR` and rolled
  nothing while the gate asked for dice.
- **The formula string is a plugin-facing trust boundary.** `plugins.md` makes randomness the host's:
  a plugin returns formulas and Charnik's single dice path rolls them. So a formula the parser cannot
  fully account for SURFACES rather than rolling the part it understood: `parseFormula` answers with
  the pool, the modifier, and every fragment neither of them took, and `rollFormula` is sugar over it
  for the callers that have nowhere to show them. A word is never a fragment — it cannot make a total
  smaller — and neither is a leading bare number, which the rule above already accounts for.

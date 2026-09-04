# Roller — open work

> Tracker. What is left on the roller and the surfaces a roll appears on. The design of record is
> [`../internals/roller.md`](../internals/roller.md); the ORDER these are done in is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [x] **UX-3 · retroactive advantage instead of a pre-roll gesture.** Roll, and if it turns out to
  have been advantaged, tap the d20 — RAW-exact and identical on mouse and finger, where
  `Alt/Ctrl-click` does not exist. Survey: `docs/research/roll-surfaces.md`.
- [x] **UBUG-23 · a stacked toast was resized to the front toast's height.** `svelte-sonner` forces
  `height: var(--front-toast-height)` on collapsed background toasts and makes it harmless by fading
  their content — but only for `data-styled='true'`, which a custom-component toast is not. The
  fix extends the library's own content-fade to the unstyled toasts it skips.
- [x] **UBUG-22 · `rollFormula` dropped a flat modifier that was not at the end of the formula.**
  `1d6+3+1d4` totalled 10, not 13 — reachable from content and from the plugin API. One shared
  `DICE_TERM` regex plus `parseFlatModifier`; `roller.md` ▸ Conventions carries the rule about what
  an unsigned number means.
- [x] **UBUG-21 · the dice tray edited the to-hit while claiming to be the attack.** Damage is the
  second LINE now, made of the same editable pills, so a `+1d6` typed for a rider lands on the
  damage. Closed with ROLLER-N — same seam, pointless to build twice.
- [x] **ROLLER-N · one roller that fires N independent sub-rolls.** One action fires N instances of
  two-level lines, each logged on its own line and toasted as one card; crits landed with it. The
  roller answers with structured dice instead of a formatted string, advantage is a mode over
  recorded dice, and the persisted record is the in-session record. **The design, the rejected
  alternatives and the conventions are `docs/internals/roller.md`**; only what is still open lives
  here:
  - [x] **`{roll, issues}` — a formula the parser could not fully account for SURFACES.**
        `parseFormula(str) → {dice, mod, issues}` is the whole parse: `parseDicePool` and
        `parseFlatModifier` each answer for their own half, and `issues` is every fragment NEITHER of
        them took. `rollFormula` stays sugar over it and drops the issues, so no call site had to
        change. **What is deliberately not an issue:** a bare WORD (it can never make a total
        smaller) and a LEADING bare number, which is accounted for either way — counted when the
        segment has no dice, ignored on purpose in the statblock average form `12 (2d6 + 5)`.
        Two surfaces, because a data defect must be visible outside the moment of the roll: a weapon
        or spell damage string carries `DamagePart.issues` to the attack row's note, and every
        instant-roll affordance goes through `rollFormulaEntry`, which puts them in the roll's own
        note. Inside the roller the raw pill was already the surfacing.
  - [x] **Amendments are STRUCTURE, not a sentence.** `amendments: RollAmendment[]` — a discriminated
        union over `AMENDMENT_KIND`, carrying only what cannot be derived (an advantage amendment
        holds the two modes; the dice are the roll's own `d20s`). `describeAmendments` is the ONE
        place they become words, which is what the i18n sweep now has to work with instead of prose
        on disk. The Savage Attacker reroll became an amendment in the same change — it used to
        overwrite `note`, destroying an upcast's provenance. A pre-2026-09-04 prose amendment is
        stripped by `withoutLegacyAmendment` when such a roll is next amended.
  - [x] **Provenance survives the fold.** `foldValues` narrowed every contribution to the four
        shapes `rollPool` happened to accept and threw the rest away one step before the roll. It
        now hands over dice that carry their own `source` (`BonusDie.source` → `RolledDie.source`)
        and a flat modifier told as the `FlatPart[]` it was made of, so a Bless d4 and a typed d4
        are two things on the card, in the toast and on disk. `modParts` is recorded only when
        something is named — the roll log is capped, and a list that says nothing does not earn its
        bytes. A `note` pill carries no number, so it never belonged in the fold: `rollerNotes`
        takes the player's own words to the roll's note. Per-die bounds stay a knowing loss, marked
        `ponytail:` in place, because no 5e mechanic writes two floors in one line.
  - [x] **A volley stays a volley after it is rolled.** `RollLogEntry.group` — a GUID, stamped in
        `recordRolls`, the one seam every multi-instance action passes through. Absent on a lone
        roll: being one line already says it, and the log is a capped file every roll pays into.
        `actionRuns` reads it back into the actions the log recorded, and the log draws a run as one
        bracketed `×N` block while each throw keeps its own row and its own live controls.
  - [x] **The roller takes `RollSpec` itself** — one request carrying the label, the test half, the
        damage parts, the note and the instance count. `prefillDamage` and `queueDamage` are gone:
        an absent `test` is what makes a roll a quantity, and an attack no longer arrives in two
        calls whose second label was dropped. `times` moved to the ACTION, so a damage-only spell
        can be prefilled as a volley — it could not be before.
  - [x] **A token typed WITHOUT spaces parses as one raw fragment and blocks the roll** (`2d6+3`).
        `addToken` splits a compound token into its signed terms first, so every path that builds a
        line — typing, a paste, a prefill retyped — gets it from one seam. It splits only when EVERY
        term is arithmetic on its own, which is what keeps `+d4?` blocking and `dm's-luck` one label.
  - [ ] **Damage types have no localized names anywhere in the data**, so they match and display in
        English. Rides the same boundary as ARCH-1: the 13 SRD types are a closed rules vocabulary
        and take catalog keys, an invented homebrew type is data and passes through.
  - [ ] **Deliberately unbuilt, with the reason:** Elven Accuracy (now merely a third element in
        `d20s`, not a modelling question), a per-instance target, and a per-instance advantage — a
        volley rolls the same set N times, which is what the two-level model decided a volley IS.
- [ ] **SAVAGE-TAIL · two known limits of the `damage_reroll` offer.** It rerolls the WHOLE primary
  damage part, so a Bless die riding that part is rerolled with the weapon dice — arguably "use
  either roll", but not what the feat says. And the offer rides the INSTANT attack tap only: the
  `Alt`+click tray path rolls damage later and gets no offer there. Both are small and neither is a
  wrong number.

- [x] **UBUG-2 · An attack/spell shows its to-hit roll**, combined with its damage in one entry.
- [x] **UBUG-3 · The dropped adv/disadv die shows on every roll surface.**
- [ ] **UBUG-11 · Class-granted actions must DO their mechanical effect, not just toast a note
  (reported 2026-08-05, tested on a Monk).** A Monk's Flurry of Blows only toasts "Make two Unarmed
  Strikes" — its `resource_options.action` is a `note:`, so nothing rolls. That's meaningless when the
  app can roll attacks. The N2 executor (`runActionToken`) resolves heal/roll/apply_effect/apply_condition/
  gain_action/rest, but a "make N attacks" action degrades to text. **Rework how class actions resolve:**
  let an action fire ATTACK sub-rolls (to-hit + damage) through the existing `attackRoll` path — Flurry =
  2× Unarmed Strike, and the general case for any "make an attack" ability. Ties into actions.md (the
  `rolls` intent field) + the roller. The whole "action from a class
  feature" model is the target, not just Flurry.
  **Split 2026-08-09:** the "fire N sub-rolls" half is `ROLLER-N` (a general roller, also what a
  `count`-scaling cantrip needs — re-reported the same day on a Warlock: Eldritch Blast at level 5 just
  toasts "2×: make 2 separate rolls at this level"). **What stays UBUG-11** is the action half: the
  `rolls` intent in actions.md that lets a class feature CALL that roller with the right weapon, instead
  of degrading to `note:` text. Don't build a Flurry-shaped roller here.
  **The APP half is built:** `attack:<weapon id>[:<count>]` is an executor verb (docs/internals/actions.md
  §2), firing the ordinary attack path so a strike inside an action carries exactly what a tap on the
  Attacks panel does, and charging no turn slot of its own. The weapon is named by bare content id, so
  `Attack` grew an `id` (its display name never was an identity). **What is left is CONTENT, in
  `charnik-content-srd`:** the `resource_options` rows that still say `note:` — Flurry of Blows becomes
  `attack:unarmed_strike:2` — hand-edited in both editions and `pnpm restamp`ed, never re-converted.
- [x] **UBUG-12 · roll feedback is hard to read.** The toast became a component, then UBUG-20 made
  that component the one renderer for all four roll surfaces. Both rules it left live in `roller.md`.
- [x] **UBUG-20 · one roll card everywhere, and its live controls.** One `RollRow` mounted by the
  toast, the Playbar, the roll log and the dice tray; the d20 pill cycles advantage after the fact
  and the damage pill rerolls. The constraints later work must not undo are stated at their own
  seams in code (controls never in the toast; the reroll affordance is the PILL; `onAdvantage` takes
  no attack index).
  **Open tails:** an inert ↻ marker on the toast pill, and the toast has no labelled close control —
  an a11y nit, since the card itself IS the dismiss button today.

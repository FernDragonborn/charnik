# Audit — everything since 0.6.2

Covers `v0.6.2 3104f2a 2026-08-22` through `b79d255 2026-09-07`: 254 commits, 395 files,
+37 546 / −11 788. Read for IMPLEMENTATION defects — a number that comes out wrong, a rule the code
knows in one place and forgets in another, a half-finished change whose siblings were left behind —
not for missing features.

Readers go over the release one subsystem at a time, in parallel batches: rules core and derive,
combat and play state, the roller, the effects module, content and storage, the UI surfaces, the
plugin layer, storage and the pack lifecycle, character persistence and builder state. Each finding
names the method that reproduced it, and the ones that could not be reproduced are kept separate
under their own heading rather than mixed in. The sections headed *second pass* and *third pass* are
the later batches; they carry the same contract.

**Progress.** Every finding's heading carries a box: `[x]` is closed — fixed, or deliberately
dismissed with the reason written under it — and `[ ]` is still open. The box is the only progress
record; nothing else in this document tracks state.

Coverage is **partial by construction** and each reader says where it stopped — see *What was not
reached* at the end. Read that section before concluding a subsystem is clean: "not reported" here
means "not read", not "correct".

## The dev toolbox

### A · [x] TRIVIAL · the content-health probe is the one page the dev toolbox does not list

`src/routes/dev/+page.svelte` enumerates the probes, and its own comment states the rule it exists
to keep: *"a probe nobody can find is a probe nobody runs."* It lists twelve. There are thirteen
directories under `src/routes/dev/`, and `dev/health` — the only visual coverage the content-health
panel's problem states have, since the shipped SRD always renders "all clear" — is not among them.

**Reproduced** by diffing the `dev(...)` hrefs in the index against `ls -d src/routes/dev/*/`:
present on disk, absent from the list. `grep -rn 'dev/health' src/ docs/` finds no other entry point;
the only hits are two generated lines in `docs/surface.md`. The page was maintained this cycle
(8 lines changed since v0.6.2), so it is live code you reach only by typing the URL.

**Fix:** one `<li>` under Design previews.


## Play and combat

`src/lib/combat`, `src/lib/actions`, `src/routes/combat`. Five confirmed, each reproduced against
real packs.

### 1 · [x] HIGH · Extra Attack is on the sheet and blocked in play

`sheet-rolls.svelte.ts:222` — `attackRoll` opens with
`if (!this.host().economy.trySpend('action')) return;`, so **every** tap costs a whole Action.
`combat.sheet.attacksPerAction` is computed (`derive.ts:415`) and displayed
(`AttacksPanel.svelte:13`), but no play path reads it. The commit that added it (`8a70bef`, "a
level-5 martial attacks twice, **on the sheet and in play**") touched the two display components and
nothing else.

**Reproduced** — real packs, fighter 5, `inCombat: true`, two taps on the same row:

| pack | `attacksPerAction` | log entries after 2 taps | `turn.action` | toast |
| --- | --- | --- | --- | --- |
| srd-2024 (5.5e) | **2** | **1** | 1 / max 1 | "No action left this turn" |
| srd-2014 (5e) | **2** | **1** | 1 / max 1 | "No action left this turn" |

The second attack rolls **nothing** — it is not merely uncharged, it is discarded. Both editions.

**Fix:** count strikes inside the Action rather than Actions. Charge the Action on the first strike
of the turn and count the rest against `sheet.attacksPerAction` — a `play.turn.attacksMade` reset in
`TurnEconomy.nextTurn`/`toggleCombat` beside the existing pips, spending the slot when
`attacksMade % attacksPerAction === 0`. `ActionExecutor.rollAttackNow` already bypasses the economy,
so Flurry is unaffected.

### 2 · [x] HIGH · a standard action rolls its skill check with no effect key

`combat-view-model.svelte.ts:466` — `actionClick` calls `this.rolls.roll({...}, a.roll[1], e)` with
**no `RollTarget`**. `SheetRolls.roll` computes `fx` and advantage only `if (key)`, so Hide, Search,
Study, Grapple and Shove pick up no advantage/disadvantage, no bonus dice (Bless) and no
reroll/min-die. `SkillsPanel.svelte:42` passes `{ key: 'skill.<id>', scopes }` for the identical
check — so one Stealth check rolls two different ways depending on which panel you tap.

**Reproduced** — srd-2014, rogue 3, Stealth proficient, `play.exhaustion = 1` (2014 RAW
"Disadvantage on Ability Checks", token `exhaustion>=1 ? disadvantage:ability_checks`):

```
effectsFor('skill.stealth') = {advantage:false, disadvantage:true, ...}
SKILLS panel  -> d20s: [6, 17]  advantage:"disadvantage"  total 8
ACTIONS panel -> d20s: [19]     advantage:"neither"       total 21
```

The flat is fine — `a.roll[1]` is the already-folded `sheet.skills[k].value`. What is lost is the
advantage axis and the effect dice.

**Fix:** one argument — pass `{ key: skill.<id> }` to `roll`, carrying the skill id on
`StandardAction`. `actions.ts` already knows `r.skill` and drops it after computing the hint.

### 3 · [x] MEDIUM · an owed concentration save outlives the spell it was owed for

`hit-points.svelte.ts:50` — `pendingConcentrationSave` is cleared in `clearConcentration`,
`dropConcentrationFromSave`, `dismissConcentrationSave` and on a passed roll, but **not** when
concentration is *replaced* (`spell-casting.svelte.ts:524`) or ended by a long rest
(`resource-tracker.svelte.ts:242`). The banner renders on `pendingConcentrationSave && combat.conc`,
so it re-attaches itself to whatever is concentrated on next.

**Reproduced** — 5.5e, Bless active, 20 damage taken at 30 HP:

| step | observed |
| --- | --- |
| after damage | `pending = {"dc":10}` (for Bless) |
| cast Hold Person (replaces concentration) | `concentration = hold_person`, `pending` **still** `{"dc":10}` |
| pre-set `{dc:25, failed:true}`, then cast Hold Person | `pending` **still** `{"dc":25,"failed":true}` — the banner opens already in the "Save failed — Hold Person ends" state, offering **Drop**, for a spell just cast and never rolled for |
| damage, `pending={dc:10}`, then `rest('long')` | `concentration = null`, `pending` **still** `{"dc":10}`, armed for the next spell |

**Fix:** the flag belongs to the concentration, so clear it where concentration changes. Root-cause
version: a reactive sync beside `syncDyingState` — `if (!play.concentration) pendingConcentrationSave
= null` — which covers both writers and any future one.

### 4 · [x] MEDIUM · a long rest restores HP to the *manual* max, not the *effective* max

`resource-tracker.svelte.ts:241` —
`c.play.hp = { ...c.play.hp, current: c.play.hp.max ?? sheet.maxHp.value, temp: 0 }`. Everything
else on the HP path goes through `effectiveHpMax` (A14: "a manual max no longer silences `hp_max`
effects — they re-fold on top of it", `hit-points.svelte.ts:66`, `:294`). This is the one writer
that recomputes it by hand — and the header of `hit-points.svelte.ts` claims "the action executor
and the short rest read it from there rather than recomputing".

**Reproduced** — 5.5e fighter 3, `play.hp.max = 30` manual, Aid `flat_bonus:hp_max+5`, current 5:

```
effective hpMax (what heal/damage clamp to) = 35
long rest -> current = 30      <- 5 short of full
control (no manual max)       = 27 -> long rest -> 27   ok
```

**Same bug, display half:** `HpPanel.svelte:34` prints `{c.play.hp.max ?? s.maxHp.value}` — the
readout says **"5 / 30"** while the bar beside it is scaled to 35 and Heal fills to 35.

**Fix:** both sites read a value that already exists. `RestControlsHost`/`ExecutorHost` carry
`hpMax`; give `ResourceTracker` the same getter and have the panel print `combat.hpMax`.

### 5 · [x] MEDIUM-LOW · filling the third success pip by hand does not stabilise

`hit-points.svelte.ts:250` — `toggleDeathSave` checks `failures >= 3` and calls `die()`, but has no
success branch. The rolled path `deathSave()` (`:236`) calls `stopDying()` on the third success.
`syncDyingState` only fires above 0 HP, so at 0 HP the manual track sits at 3/0 for ever, and the
next damage press adds a failure to a character who is RAW stable.

**Reproduced:** 5.5e fighter at 0 HP, `combat.toggleDeathSave('successes', 2)` gives
`{"successes":3,"failures":0}`; the rolled path gives `{0,0}`.

**Fix:** mirror the failure line — on the third success, `stopDying`.

### Suspected, not reproduced — combat

- ~~A bare ability check is the one d20 roll no effect can reach.~~ **Settled — see finding 55.** It
  is a defect, not a deliberate gap: the save button six lines below it in the same component passes
  the target the check omits.
- **`ActionExecutor`'s `rest:` comment contradicts `actions.md`.** `action-executor.svelte.ts:~236`
  says a rest-granting consumable "MUST have recharge `other`"; `actions.md` §2 says `consumable`.
  Comment-only — no code reads it — and not checked against shipped rows.
- ~~`restoreUpTo` reads spent unclamped.~~ **Settled — not a defect.** `resource-tracker.svelte.ts:163`
  does read `c.play.resourcesSpent?.[id] ?? 0` raw, but the very next line is
  `Math.min(spent, Math.max(0, def.max - upTo))`, and that second term is `≤ def.max` for every
  `upTo ≥ 0` — so the stored value is clamped no matter how stale it is, and pre-clamping changes
  nothing. The only input that would slip through is a NEGATIVE stored spent, which
  `schema.ts:165` (`z.number().int().min(0)`) refuses at load.
- ~~Scoped damage bonuses show on the roll but not on the attack row.~~ **Settled — see finding 82.**
  It is not a "row static, roll live" split: the row is live for the attack axis and dead for the
  damage one, and a raging barbarian's row prints a number two lower than the tap rolls, in both
  editions.

### Checked and correct — combat

- **Instant death and damage at 0 HP** (`hit-points.svelte.ts:130`): the temp-HP soak happens after
  resist/vuln and before the `n - before >= hpMax` threshold, and `taken` rather than `n` drives the
  death-save failure, per the SRD's "any damage".
- **`stopDying` coverage.** Every exit from dying — a natural 20, a third rolled success, `revive`,
  `syncDyingState` — resets the death-save track *and* `damageWasCrit`. The previous audit's findings
  2 and 3 are genuinely fixed.
- **`restRecharge` / `parseRecharge`** (`rules/recharge.ts`): `short`→`all` on a long rest, `long(N)`
  pays its own authored amount, `dawn`/`dusk` ignore rests, `consumable`/`other` return null. The
  previous audit's finding 5 holds.
- **`hitDiceRecoveredOnLongRest`** (`core.ts:221`): 5e half-round-down-min-1, 5.5e all; `applyLongRest`
  spends the recovery largest-die-first and clamps stored spent. (The 5.5e "all" is a maintainer
  ruling, not a code question — SRD 5.2.1 omits the rest chapter.)
- **`TurnEconomy`.** `slotMax` (base 1 + `grantedActions` + `flat_bonus:<slot>` facts, zeroed by
  `incapacitated`), the all-or-nothing `canSpend`/`trySpend` split, `nextTurn`/`toggleCombat`
  resetting `grantedActions`, and `expireTimedEffects` ending carried concentration.
- **`gain_action`** grants an extra pip rather than refunding a spent one — the documented earlier bug
  is fixed.
- **`ActionExecutor` is all-or-nothing**: available → afford → `canSpend` → then both spends, with no
  partial path. The `attack:` verb bypasses the economy correctly, the option's `action_type` having
  already paid.
- **`rest('short')`** deletes only `PACT_SLOT_KEY`, and the 600-round outlive filter compares
  *remaining* rounds rather than total.
- **`rollEffectsFor` scope handling** (`roll.ts:388`): the comma-list rule the previous audit fixed is
  applied on the roll side and in `scopedAttackBonus` (`attacks.ts:~289`). Advantage facts carry no
  scope by type, so the unscoped `advantage` lookup is not a hole.
- **`endConcentrationIfBroken`** covers 0 HP, incapacitated and `blocks_concentration`, and is wired
  reactively in `combat/+page.svelte:66`.

## Rules core, character and build

`src/lib/rules`, `src/lib/character`, `src/lib/build`, `src/routes/build`.

### 6 · [x] HIGH · a 2014 caster cannot be created at all

`build/derive.ts:299` (`spellTodos`) emits a **required** todo `spells`/`cantrips` whenever
`preparedCap - leveledChosen > 0`, with no regard for whether the Strict picker built by
`buildSpellPicker` (`derive.ts:110`) has anything in it. The Strict pool gate is
`access.has(s.effectiveId)`, and in `srd-2014` the access index is empty for **every** class.

**Reproduced** — vitest, real packs via `loadPacks`:

| pack | spells loaded | `spellIdsForClass` per class |
| --- | --- | --- |
| `srd-2014` | 319 | bard **0**, cleric **0**, druid **0**, paladin **0**, ranger **0**, sorcerer **0**, warlock **0**, wizard **0** |
| `srd-2024` | 339 | bard 130, cleric 109, druid 124, paladin 38, ranger 48, sorcerer 140, warlock 72, wizard 218 |

The root cause is content — every row in `srd-2014/spells_srd.csv` has an empty `classes` column and
the pack ships no `spell_lists` file. The app-side consequence is the defect:
`blocking = todos.filter(t => t.required)` and `canCreate = blocking.length === 0`
(`build-view-model.svelte.ts:492`), so the review bar says "choose 4 spells", the pane it links to is
empty, and `save()` returns `null`. Measured for a 2014 cleric 5: `preparedCap 8`, `cantripCap 4`,
`pickerGroups []`.

**Fix, app side:** in `spellTodos`, skip the under-cap line when that class's picker has no pickable
options, or drop `required` there. The content fix (populate the 2014 `classes` column) is the other
half and belongs in the content repo.

### 7 · [x] MEDIUM · a 2014 half-caster has spell slots at level 1

`character/spellcasting.ts:307` — `slotCountsFor(slotTable(graph,'half'), classLevel)` indexes the
`half` table by **class level**. `srd-2014/spell_slots_srd.csv` row `half_1` is `2,0,0,…`, which is
the multiclass caster-level value, not the 2014 ranger/paladin class-level value. RAW 2014: no slots
until level 2.

**Reproduced** — 2014 Ranger 1, WIS 16: `pools: ["slot-1:2"]`, `maxSpellLevel: 1`, `preparedCap: 3`.
RAW is 0 slots, 0 known, max spell level 0. Levels 2+ are correct (`half_2 = 2`, `half_3 = 3`,
`half_5 = 4,2`).

A one-cell content error — `half_1` should be zeros in `srd-2014` only, since 2024 rangers do cast at
level 1. Recorded here because it surfaces as a wrong number out of the derive.

### 8 · [x] MEDIUM · the builder and the derive disagree about a feat-granted skill

- `character/derive-stats.ts:176` — `chosenProf = new Set([...build.skills, ...(build.featSkills ?? [])])`,
  so a Skilled-granted skill derives as `proficient` and expertise on it is honoured.
- `routes/build/skill-picks.svelte.ts:74` — `isProficient = autoSkills.includes(skill) ||
  draft.skills.includes(skill)`. **`featSkills` is not consulted.**

Everything downstream runs through that one predicate:

- `expertiseOffered` (`skill-picks.svelte.ts:96`) is false, so the ×2 control is never offered on a
  Skilled-granted skill although RAW expertise only requires proficiency — and the sheet beside it
  already reads "proficient".
- `toggleExpertise` (`:103`) returns early for the same reason.
- `build-view-model.svelte.ts:367` — `expertise: this.draft.expertise.filter(s => this.skillPicks.isProficient(s))`
  — so expertise already held on a feat-granted skill, e.g. loaded from a save, is **silently
  dropped at assemble**. This is the load-bearing half.

**Fix:** one line — `isProficient` also checks `feats.featSkillPicks`, the derive's own union,
already computed at `feat-slots.svelte.ts:155`.

### Suspected, not reproduced — build

- ~~`switchClass` wipes skills/expertise/spells when the FIRST class is picked.~~ **Settled — see
  finding 49.** Confirmed, and reachable more easily than suspected.
- ~~Stale `slotFeatAbility[ORIGIN_SLOT_KEY]` across a background swap.~~ **Settled — see finding 50**,
  which reproduces the same bug through the feat-slot door, where shipped 2024 content reaches it.
- **Shields never contribute their `ac:` tag.** `derive-stats.ts:214` adds a hardcoded `+2` gated on
  `play.shieldRaised` and reads `ITEM_TAG.ac` only off `equippedArmor`. So equipping a shield in the
  *builder* moves AC by 0, and `shield_of_the_cavalier`'s `flat_bonus:ac+2` rides globally while
  merely attuned — the same shape as the weapon leak in the previous audit's finding 1. Needs a
  design ruling before it counts.
- ~~`expertiseUsed` vs the cap.~~ **Settled — see finding 48.** The divergence costs a live pick.

## The roller

`src/lib/dice`, `src/lib/rules/dice.ts`, `src/lib/components/Roller*.svelte`,
`src/routes/combat/roll-journal.svelte.ts`, `src/lib/combat/roll.ts`. The largest new surface in the
release, and the one with the most findings.

### 9 · [x] HIGH · a subtracted dice term is silently ADDED, and `issues` reports nothing

`rules/dice.ts:252` (`DICE_TERM`), `:256` (`parseDicePool`), `:324` (`parseFormula`).

`parseDicePool` matches `(\d*)d(\d+)` with no sign, so the minus of `2d6-1d4` is invisible;
`SIGNED_DICE_TERM` (`:291`) *does* eat the sign when computing the residue, so `issues` comes back
empty. The formula path is the plugin and content trust boundary that exists precisely to surface
what it could not account for — and here it accounts for the term with the wrong sign.

**Reproduced:**

```
parseDicePool('2d6-1d4')          = {"4":1,"6":2}
parseFlatModifier('2d6-1d4')      = 0
parseFormula('2d6-1d4')           = {"dice":{"4":1,"6":2},"mod":0,"issues":[]}
parseFormula('1d8 - 1d4 + 2')     = {"dice":{"4":1,"8":1},"mod":2,"issues":[]}
rollFormula('2d6-1d4', max-rng)   = 16   <- 2d6+1d4, not 2d6 minus 1d4
```

The tray's own parser gets the same string right — `parseDiceTerm('-1d4')` gives `sign:-1`, and
typing `2d6-1d4` folds to `dice {6:2}` plus `bonusDice [{sides:4,sign:-1}]`. Two parsers, one string,
two numbers. No shipped SRD row uses a subtracted dice term, so this is homebrew- and
plugin-reachable rather than wrong today.

**Fix:** give `parseDicePool` the sign — reuse `SIGNED_DICE_TERM` and split the pool into positive
dice and negative `BonusDie`s; or, smaller, have `parseFormula` report a leading minus before a dice
term as an issue so it surfaces instead of rolling wrong.

**Closed** with the split (`parseSignedDice`), so the formula path — the plugin and content trust
boundary — rolls what it says. A caller holding only a POOL takes the second door: `parseDamageParts`
cannot express a penalty die in `{sides: count}`, so it carries the term in the part's `issues` rather
than rolling it with the wrong sign.

### 10 · [x] HIGH · two rolls in the same millisecond share one identity; an amendment rewrites both

`roll-journal.svelte.ts:206` (`pushRoll` stamps `at: Date.now()`), `:274` (`reviseEntry` matches on
`at`), `character/repository.ts:469` (`rewriteLogLine` uses `findIndex`).

`pushVolley` (`:236`) and `DiceTray.roll()` (`dice-tray.svelte.ts:616`) both use `at + i` **because
of this exact problem**, with the comment "an amendment rewrites ITS beam, not a sibling that shared
the millisecond". `pushRoll` is the sibling that was never fixed — and `action-executor.svelte.ts:275`
(`makeAttacks`, the `attack:unarmed_strike:2` verb behind Flurry of Blows) calls `rollAttackNow` then
`pushRoll` in a **synchronous loop**.

**Reproduced:**

```
at equal? true 1788792781478 1788792781478
log after revising only the FIRST entry:
  [{"label":"REVISED","total":11,"at":...},{"label":"REVISED","total":11,"at":...}]
persistRevision payloads: 1
```

Both log rows become the first roll — the second strike's dice are gone from the view — and on disk
only one line is rewritten, so memory and `log.jsonl` diverge. Same cause, two more symptoms on the
same path: `makeAttacks` never stamps a `group`, so two Flurry strikes are two unrelated actions and
`actionRuns` cannot bracket them; and each `pushRoll` toasts separately, while `recordRolls` and
`rollToastModel` exist and are documented for "several attacks resolved as one action (Extra Attack /
Flurry of Blows)".

**Fix:** route `makeAttacks` through `recordRolls` — collect the N entries and hand them over once.
That buys the unique `at`, the `group` and the single toast card in one change, and leaves `pushRoll`
for genuine lone rolls.

### 11 · [x] MEDIUM · a retroactive re-read loses the roll's `min_die` / `reroll` floor

`rules/dice.ts:659` — `setAdvantage` draws `plainD20(rollDie(20, rng))`, raw. The docstring (`:641`)
argues this is safe: "RAW would floor the new die the same way — so the higher contribution is the
right outcome either way". That holds for **advantage only**. `cycleAdvantage` reaches disadvantage
on the second tap of the same control, and there the unfloored die wins.

**Reproduced** — rogue with Reliable Talent, `minDie: 10`, +11:

```
rolled:                        21   d20(3->10) +11   natural 3
after 1st tap (advantage):     21   d20(3->10) +11   d20s [[10,"3->10"],[6,"6"]]
after 2nd tap (disadvantage):  17   d20(6) +11       kept 6
RAW at disadvantage would be:  21   (both dice floored to 10)
```

Same class with `reroll` (Halfling Lucky): the amendment die came back a natural 1 that RAW rerolls —
`[[17,"1->17"],[1,"1"]]` — and one more tap makes that 1 the deciding die, so `naturalOf` reports a
natural 1 the rule says cannot stand.

**Fix:** have `rollPool` record its `DieMods` on the `Rolled` (an optional `mods?: DieMods`), and
`setAdvantage` apply them to the die it draws instead of `plainD20`. About six lines, and it makes
the drawn die's `detail` tell the same story as the original's.

### 12 · [x] MEDIUM · the dice tray cannot carry `labelValues`, so a tray roll's name loses its ICU values

`roll-journal.svelte.ts:155` (`prefill` forwards `labelKey`, never `labelValues`),
`dice-tray.svelte.ts:102` (no `labelValues` field), `:609` (`roll()` emits `labelKey` only).
`RollSpec` declares `labelValues` (`:57`) and `RollLogEntry` stores it — the half in the middle is
missing.

**Reproduced:**

```
prefill({label:'Unarmed Strike 1/2', labelKey:'combat.log.numberedAttack',
         labelValues:{n:1, of:2, name:{catalog:'attacks', id:'unarmed_strike'}}, test:{...}})
tray entry: {"label":"Unarmed Strike 1/2","labelKey":"combat.log.numberedAttack",
             "dice":[],"d20s":[...],"mod":5,"total":16,...}
```

No `labelValues` — the recorded row asks the catalog for a numbering frame with no numbers in it.
Two callers make it worse by dropping the key as well, so Shift-click and tap disagree about whether
the log is language-frozen: `spell-casting.svelte.ts:309` passes a pre-translated sentence with no
key on the tray path while the instant path (`:331`) passes the full `RollName`; and `:444` drops
`name.key` and `name.values` entirely while the instant path (`:447`) keeps both.

**Fix:** add `labelValues` to `RollerPrefill` and `DiceTray` and forward it in `prefill` and `roll()`,
then pass `nameFields(name)` at the two `spell-casting` tray sites instead of a translated string.

### 13 · [x] MEDIUM-LOW · `bumpPill` leaves a stale `text`, and unfolding it flips a penalty die's sign

`dice-tray.svelte.ts:448` rewrites the token as count-plus-sides only. `PillCommon.text`
(`roller.ts:54`) is documented as "kept verbatim so Backspace and double-click can unfold the pill
back into the exact text the player typed". `bumpPill` rewrites it without the sign, the source, or
the bound.

**Reproduced:**

```
before: [{"text":"1d20","sides":20,"sign":1,"min":10},
         {"text":"-1d4","sides":4,"sign":-1,"source":"Bane"}]
after bump: [{"text":"2d20",...,"min":10},{"text":"2d4",...,"sign":-1,"source":"Bane"}]
draft after unfold: ["2d4"]
after unfold+commit: [{"text":"2d20",...,"min":10},{"text":"2d4","sign":1}]   <- sign flipped, source gone
```

Nudge a Bane die's count then double-click it and minus-2d4 becomes plus-2d4, an 8-point swing on a
d20 test. The floored `1d20` case loses its Reliable Talent bound the same way. The pill's *rendered*
number is derived (`diceText`), so nothing on screen warns you — only the tooltip shows the stale
token.

**Fix:** rebuild the token the way it is spelled, sign and source and bound included, or keep a
`text` builder beside `diceText` so the pill and its token cannot drift.

**Closed** with the builder (`dicePillToken`), which writes the sign — so the penalty die survives a
nudge and an unfold. The BOUND is deliberately not spelled into it: a bound arrives as its own token
(`>10`) and lands on the die, a pill is exactly one token, and a text holding both would come back
from an unfold as one unparsable fragment that blocks the roll. Unfolding a floored die therefore
still drops its floor, which is the token model's limit rather than this defect.

### 14 · [x] LOW-MEDIUM · a forced-outcome marker is never persisted

`roll-journal.svelte.ts:319` — `logMarker` never calls `this.persist`. `StoredRollLogEntry.outcome`,
`rehydrateLogEntry` (`roll.ts:209`) and `logLineFor`'s `Number.isFinite(roll.total)` guard
(`repository.ts:398`) are all built for this line, and nothing writes it.

**Reproduced:** `logMarker({text:'DEX save', key:'k'}, 'fail')` gives
`marker persisted? 0 log len 1 total NaN`. So a paralysed character's auto-failed save is in the log
until reload and gone after, and the same applies to `spell-casting.svelte.ts:417`'s no-roll cast
marker.

**Fix:** one `this.persist?.(entry)` in `logMarker`. `logLineFor` already omits `result` for a `NaN`
total.

### 15 · [x] LOW · a doc that lies: `rerollKeptD20` no longer exists

`docs/internals/roller.md:211` is a normative "Conventions" bullet describing `rerollKeptD20` and
per-edition Heroic Inspiration. Commit `9984cb2` deleted the function from `rules/dice.ts` and the
whole control; its file list does not include the doc. AGENTS.md: "Fix the docs in the change that
proves them wrong."

**Fix:** replace the bullet with what `AMENDMENT_KIND.d20Reroll` now is — a legacy kind kept so old
logs stay readable, which `roll.ts:249` already says.

### 16 · [x] LOW · `adv` typed on a damage line is accepted, invisible and ignored

`dice/roller.ts:202` checks `ADVANTAGE_WORDS` before the resolver. `vocabularyFor`
(`dice-tray.svelte.ts:136`) withholds mode rows from a damage line, and the doc claims "because the
same list backs the resolver — typing the name in full can't get past what the menu withheld".
`ADVANTAGE_WORDS` is not that list.

**Reproduced:** `addToken(emptyLine(damage), 'adv')` gives `advantage ["dice"]` on a damage line. The
mode is set, no toggle renders it, and `DiceTray.roll()` only ever reads `testRoll(test)` — so it
does nothing, for ever.

**Fix:** gate the `ADVANTAGE_WORDS` branch on `line.role === ROLLER_ROLE.test`, which `addToken`
already has, so the word falls through to `wordPill` and becomes a label.

### 17 · [x] LOW · an ambiguous effect name silently becomes a damage TYPE on a damage line

`dice/roller.ts:341` (`wordPill`) versus the comment at `:522`. `candidateResolver` returns null for
a name two candidates share, which the comment says lands as a blocking `raw` pill — "true whether
the fragment is nonsense or merely ambiguous". On a damage line `wordPill` converts every raw word
into a damage type first, so the ambiguity never reaches `rollerIssues`: typing `bless` when two
packs both ship a Bless adds a damage type named "bless" and drops the `+1d4`. Needs two
identically-named rows, hence LOW.

### Suspected, not reproduced — roller

- ~~The Roll button may be disabled at the moment you click it with a half-typed token.~~
  **Settled — see finding 98.** The open question was whether the click lands or the blur commit
  fires first; driven in chromium, neither happens, so the button never becomes clickable at all.
- **The volley cost cap is borrowed from the dice cap.** `roller.ts:216` clamps a `count` pill with
  `MAX_DICE_PER_TERM` (1000). Measured: 500 rolls produced 500 entries in 3 ms with 500 distinct
  `at` — the roll is cheap. Unmeasured is the cost downstream: `recordRolls` calls `persist` once per
  entry and `writeLogLine` reads and rewrites the whole `log.jsonl` each time, serialized per slug,
  while only 100 survive the cap. Plausibly a multi-second freeze on a fat-fingered hundred.
- **`loyal` crit maxes a PENALTY die's magnitude.** `dice.ts:405` takes
  `Math.min(die.sides, maxDie ?? die.sides)` and ignores the sign; a Bane penalty twin came back at
  full magnitude. `CRIT_METHOD.loyal` is documented as "a guaranteed floor"; on a negative die it is
  a guaranteed ceiling of harm. No 5e mechanic writes a negative damage die, so this is a
  maintainer's call rather than a defect.

## The effects module

`src/lib/effects` and its single seam `applyEffects`.

### 18 · [x] MEDIUM · `on_event`'s action formula is the one L2 slot `lintEffectTokens` still does not lint

`effects/apply.ts:469`. Its own docstring (`:465`) claims it "lints **every** L2 expression slot —
guard, value, resource max, resource recharge AMOUNT". `on_event:<event>:<action>` added a fifth: the
action verb's formula (`heal:5+con_mod`), which `resolveActionFormula` (`action-token.ts:44`)
evaluates as an ordinary L2 expression at derive time. Nothing lints it. This is the *identical*
defect the previous audit fixed as its finding 6 — the recharge amount — re-introduced one commit
later by `55666ac`.

**Reproduced:**

```
LINT flat_bonus:ac+1d7            => ["flat_bonus:ac+1d7 — unusual die d7"]
LINT grant_resource:x:2:dawn(1d7) => ["grant_resource:x:2:dawn(1d7) — unusual die d7"]
LINT grant_roll:x:1d7             => ["grant_roll:x:1d7 — unusual die d7"]
LINT on_event:turn_start:heal:1d7 => []          <- nothing
```

**Fix:** push the action's formula onto `exprs` alongside the other four. Better still, export a
small `actionFormulaOf(action)` from `action-token.ts` so the linter and the evaluator cannot drift —
that drift is exactly this finding.

### 19 · [x] MEDIUM · six token kinds have no `effectTag` formatter, and a raging barbarian sees the raw string

`combat/effects-view.ts:119` (`TAG_FORMATTERS`), fallback at `:183`.
`docs/internals/effects.md` §4: "A new kind/target must be added in THREE places … (2) `effectTag`
(the panel label) … miss (2)/(3) → it works but shows as a raw string." Missing: `reroll`, `min_die`,
`blocks_concentration`, `damage_reroll`, `regain_on_initiative`, `on_event`. (`grant_resource` is
deliberately absent — it has its own Resources section.)

**Reproduced:**

```
"blocks_concentration":   "blocks_concentration"
"damage_reroll":          "damage_reroll"
"reroll":                 "reroll damage 2"
"min_die":                "min_die d20_tests 10"
"regain_on_initiative":   "regain_on_initiative focus 4"
"on_event":               "on_event turn_start heal 5+con_mod"
```

Reachability is confirmed for `blocks_concentration`, and it ships in **both** packs
(`srd-2014/conditions_srd.csv:57`, `srd-2024/conditions_srd.csv:73`, both on `rage`). The path is
`EffectsPanel.svelte:60` to `conditionTokens` to `effectTagResolved` to the raw fallback, so a raging
barbarian's Rage row reads: `resist · bludgeoning`, `resist · piercing`, `resist · slashing`,
`adv · STR save`, `adv · Athletics`, `Damage +2`, and then **`blocks_concentration`**.

**Fix:** two marker entries plus the two roll-mods in `TAG_FORMATTERS`, using the `say(tr, key, en)`
helper already there, plus the matching catalog keys. `on_event` and `regain_on_initiative` are the
same one-line pattern.

Scope note: `blocks_concentration` itself landed in `0f258b7` (2026-08-05), before `v0.6.2` — so the
user-visible half predates this window. `on_event` (`55666ac`), `damage_reroll` and
`regain_on_initiative` are in range and repeat the omission.

### 20 · [x] LOW · `mergeFacts` uses a different resource tie-break from `collectFacts`, while claiming it is the same

`effects/apply.ts:361` versus `:305`. `pushResource` picks the larger max and, at an equal max, the
faster recharge (`rechargeRank`, added by `5f89962`). `mergeFacts` — the plugin pre-pass path — still
compares max only, while its docstring (`:337`) asserts it applies "the same rule `collectFacts`
itself applies within one pass". It no longer does: a plugin returning a `grant_resource` with the
same max and a faster trigger silently loses.

Read-only evidence: `rechargeRank` appears at `apply.ts:29` and `:313` and nowhere in `mergeFacts`.
Not exercised at runtime because no shipped plugin grants a pool.

**Fix:** add the `rechargeRank` tie-break to `mergeFacts`.

### 21 · [x] LOW · the effects spec names a file that no longer exists

`docs/internals/effects.md:47` lists `suggest.ts` as an effects-module file and `:156` points at "a
`suggest.ts` did-you-mean". Commit `5a60e46` moved it out ("didYouMean leaves effects — nothing in
effects ever called it"); it now lives at `src/lib/util/suggest.ts` and is called from
`character/derive-targets.ts:10`. Predates `v0.6.2`.

**Fix:** point both lines at `util/suggest.ts` and name `derive-targets.ts` as the caller.

### Suspected, not reproduced — effects

- ~~Are `on_event` / `regain_on_initiative` / `damage_reroll` tokens actually reachable by
  `effectTag`?~~ **Settled — reachable, through user content only.** The panel path is
  `EffectsPanel.svelte:60` → an `EffectInstance`'s own `effects`, or `conditionTokens(id)`, which
  returns a condition row's `effects` column **verbatim** with no kind allowlist anywhere on the load
  path (`lintEffectTokens` is a content-health soft-warn, not a gate). So a homebrew `effects.csv` or
  `conditions_srd.csv` row carrying any of the three renders raw — `"on_event:turn_start:heal:5"` →
  `"on_event turn_start heal 5"`, measured. The in-app custom-modifier control cannot reach them (it
  only ever emits `flat_bonus:<target><sign><amount>`, `combat-view-model.svelte.ts:322`), and no
  shipped row does. Latent for the three, live for `blocks_concentration`, and finding 19's fix
  covers all six.
- ~~`flat_bonus:attack.<scope>:<qualifier>` drops the dotted scope.~~ **Settled — see finding 85.**
  Run, and it does: the qualifier wins and nothing is surfaced.
- ~~`set_override` never runs `scopedTarget`.~~ **Settled — the loud half is real, so it is a spec
  divergence rather than a defect.** Measured: `set_override:damage.melee:5` parses to
  `{target:"damage.melee"}` and `isEffectTargetSupported` returns `{supported:false}`, same for
  `attack.melee`. An author who writes a scoped override sees it refused rather than silently
  mis-applied; what stays wrong is that `effects.md`'s target grammar reads as one grammar while two
  parsers implement it differently.

## Content and storage

`src/lib/content`, `src/lib/storage`, `tools/srd`, and the sibling `charnik-content-srd` repo — 63
app commits and 22 content commits in the window.

### 22 · [x] HIGH · `CONTENT_SEED_VERSION` was never bumped for 0.7.0, so a new shipped file and 18 commits of rules data can never reach an existing install

`src/lib/schema/version.ts:27` (`export const CONTENT_SEED_VERSION = 4;`), enforced at
`src/lib/content/provider.ts:199`.

`docs/internals/content.md:194`: "**Bump `CONTENT_SEED_VERSION`** whenever the shipped set of files
changes. A new file is the easiest case to miss, because nothing about the existing files looks stale
— and without the bump a desktop install seeded at the old version never receives it." The constant's
own comment block (`version.ts:22`) records exactly this failure happening once before, for v3 and
`resources_srd.csv`. It happened again.

**Reproduced:**

```
$ git log --format='%h %ci' -p -- src/lib/schema/version.ts | grep CONTENT_SEED_VERSION
1097771 2026-08-27 20:21:39 +0200   +export const CONTENT_SEED_VERSION = 4;      <- last bump

$ cd charnik-content-srd && git log --since='2026-08-27 20:21:39' --oneline | wc -l
18

$ git log --diff-filter=A --format='%h %ci %s' -- srd-2014/class_casting_srd.csv
0d57fbf 2026-09-06 21:22:04 +0200   <- a NEW FILE, added after the last bump
```

Release `f5db6fa chore(release): 0.7.0` is dated 2026-09-07 00:10, after most of those content
commits, and the constant was not touched. The blocking line is `provider.ts:199`:

```ts
const onDisk = await readSeedVersion(to);
if (onDisk === shippedVersion) return { preserved: [] };
```

An install already at 4 returns before the copy loop. The belt-and-suspenders fallback at `:207`
fills only a genuinely missing **root** (`srd-2014/`), never a missing **file** inside a root that
exists — so `srd-2014/class_casting_srd.csv` never lands, and a 2014 caster on an upgraded install
keeps reading zero cantrips and zero prepared, which is precisely the bug `0d57fbf` fixed in the data.

**Blast radius:** one new file plus every value changed by the other 17 content commits — Rage damage
per edition, Extra Attack, charged items, `grant_proficiency` rows, 2024 species branches, the monk
movement ladder, Reliable Talent, item descriptions, magic-item `flat_bonus` rows. All invisible on a
desktop install seeded at v4.

**Fix:** `CONTENT_SEED_VERSION = 5`, with a `// v5:` comment naming
`srd-2014/class_casting_srd.csv`, matching the v3 note's format. No other code change.

### Pre-existing, outside the window — content

All three were surfaced by the cross-edition sweep and then date-checked; each predates `v0.6.2`, so
they are recorded as pre-existing rather than as regressions from this release.

- **Cross-edition base slugs differ, so the article edition-toggle never groups them.**
  `content.md` groups the 5e/5.5e toggle by the same base slug. Observed pairs that are one article
  under two spellings: `pathoftheberserker`/`path_of_the_berserker`, `collegeoflore`/`college_of_lore`,
  `lifedomain`/`life_domain`, `circleoftheland`/`circle_of_the_land`, `oathofdevotion`/`oath_of_devotion`
  (`subclasses_srd.csv`); `cloak_of_thebat`/`cloak_of_the_bat` (`items_srd.csv`);
  `see_i_nvisibility`/`see_invisibility` (`spells_srd.csv`). The last is additionally a **malformed
  id** — an underscore injected mid-word, almost certainly a converter slug bug. Dated `d0207e2`
  (2026-07-01) and `8bed039` (2026-07-16). The id divergence is established; the toggle's absence was
  not driven in the article view.
- **Columns present in one edition and absent in the other:** `species_srd.csv` has `boost_choice` in
  2014 only; `feats_srd.csv` has `ability_choice` and `skill_choice` in 2024 only;
  `resource_options_srd.csv` has `available` in 2024 only; `monsters_srd.csv` has 11 extra 2024
  columns. Whether any of these is read by `src/` in a way that misbehaves when absent is still open.

## The UI surfaces

`src/lib/components`, `src/lib/styles`, `src/lib/i18n`, and the `.svelte` files under `src/routes`.
The findings here cluster on one shape: a row made a `<button>`, its accessories then made spans with
`tabindex="-1"`, and the keyboard handler written for a span that can never receive focus.

### 23 · [x] HIGH · the compendium list has zero tabbable elements — the whole list is keyboard-dead

`src/lib/components/EntryList.svelte:46`:

```svelte
<div class="entry-row" role="button" tabindex="-1"
     onclick={() => onselect(e)}
     onkeydown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && onselect(e)}>
```

`tabindex="-1"` makes the row unfocusable by keyboard, so the `onkeydown` on the next line **can
never fire**. There is no up/down walk, no Home/End, no roving tabindex, no `aria-activedescendant`.

Violates `docs/internals/ui.md` ▸ UX pattern contract rule 5 verbatim: "Lists are keyboard-navigable:
↑/↓ move a highlight, **Enter is identical to a left click**, Home and End jump… This holds for the
command palette, spell and attack lists, the roll log, **the compendium**, and every dropdown."

**Reproduced** — Playwright drive against the live dev server, `/compendium`, 500 rows rendered:

```
entry rows: 500
entry-row tabindex values: [ '-1' ]
tabbable inside .rows: 0
Tab 1 -> DIV.rows            (the scroll container, browser-assigned)
Tab 2 -> BODY
Tab 3 -> A.skip-link         (focus has left the list entirely)
after ArrowDown+Enter from search: url changed? false
  selected row count: 0
```

Not covered by the tracked a11y picker rework in `docs/work/ui.md` — that item is about
`SectionedPicker`/`OptionGrid` in the builder. `EntryList` is a different component, used by the
compendium **and** the spellbook.

**Fix:** give `EntryList` the walk that already exists — `src/routes/build/option-walk.ts`
(`e.code`-based up/down/Home/End/Enter) driven from the search input, with the rows roving
`tabindex={id === here ? 0 : -1}` and the search box naming the highlight via
`aria-activedescendant`, exactly as `SectionedPicker.svelte:236` already does. Reuse, do not
re-derive.

### 24 · [x] HIGH · Ctrl+Z in the dice roller is bound to `e.key`, so it is dead on a Cyrillic layout

`src/lib/components/RollerLine.svelte:141` — `if (event.key === 'z' && held)`.

AGENTS.md ▸ Taste and `ui.md` ▸ Accessibility both state it: shortcuts match the physical key
(`e.code`), never `e.key`, which is layout-dependent. On a Ukrainian layout the Z key yields `"я"`;
with CapsLock on it yields `"Z"`. Both miss, and Ukrainian is a shipped locale.

**Evidence** — this is the *only* letter or digit shortcut in `src/` still on `e.key`, which is what
makes it a regression rather than a convention:

| site | key test |
| --- | --- |
| `CommandPalette.svelte:100` | `e.code === 'KeyK'` ✓ |
| `+layout.svelte:92` | `e.code === 'KeyR'` ✓ |
| `build/+page.svelte:94` | `event.code === 'KeyY'` / `'KeyZ'` ✓ |
| **`RollerLine.svelte:141`** | **`event.key === 'z'`** ✗ |

The build page's own undo, one file over, is the correct implementation of the same gesture. (The
other ~30 `e.key` sites all test named keys — `Escape`, `Enter`, `Arrow*`, `Tab`, `Backspace` — where
`key` and `code` agree and `key` is the standard choice.)

**Fix:** `event.code === 'KeyZ'`.

### 25 · [x] HIGH · a resource-borne effect can be added but not removed without a mouse

`src/routes/combat/blocks/panels/EffectsPanel.svelte:226` — a `role="button" tabindex="-1"` span with
an `onclick` and **no `onkeydown` at all**, under an `a11y_click_events_have_key_events` suppression.
The identical control on the ordinary effect row — same file, `:106` — is a real `<button>` and works.
So one of the two "Effects & conditions" row shapes has a remove by keyboard and the other does not.

Violates AGENTS.md ▸ Hit every surface ▸ Reverse states: "If you added a way in, add the way out and
the way to see it. A one-way door is a bug."

Secondary defect at the same site: this `role="button"` span is nested **inside**
`<button class="resource-row">` (`:193`). Interactive content inside a `<button>` is invalid HTML and
is the reason the outer element swallows the tab stop.

**Fix:** make it the same `<button class="icon-button effect-remove">` that `:106` already uses, and
demote the outer `.resource-row` from a `<button>` to a row with the click on an inner button — the
nesting is what forced the span in the first place.

### 26 · [x] MEDIUM-HIGH · every secondary control on a combat spell row is mouse-only

`src/routes/combat/blocks/panels/SpellsPanel.svelte:72` (`.prep`), `:87` (`.pin-star`), `:110`
(`.ritual-cast`), `:131` (`.cast-icon`).

- `.prep` (toggle prepared) — `onclick` only, no `role`, no `tabindex`, no `onkeydown`.
- `.pin-star` — `role="button" tabindex="-1"` **with** an Enter/Space `onkeydown` (`:96`) that can
  never fire: the same dead-handler shape as finding 23.
- `.ritual-cast` — `role="button" tabindex="-1"`, no keydown. **Ritual casting has no keyboard path
  anywhere in the app.**
- `.cast-icon` — `onclick` raising a toast, no keyboard path.

All four sit inside `<button class="spell-row">`, so they are also invalid nested interactive
content. `.upcast-btn` (`:156`) is the exception — `tabindex="0"` and a correct `e.code` keydown —
but it is a focusable element nested in a `<button>`, the same structural problem wearing a better
hat.

**Reproduced** — same browser drive, `/combat`, demo character (Warlock 5 / Barbarian 3), 5 spell
rows:

```
tabbable inside first .spell-row: []
prep toggles: 5   (role, tabindex) = [ null, null ]
Tab 1 -> BUTTON.spell-row "Hex   1d6 necrotic  1st"
Tab 2 -> BUTTON.spell-row "Hold Person   utility WIS save"
Tab 3 -> BUTTON.spell-row "Invisibility"
Tab 4 -> BUTTON.spell-row "Darkness"
Tab 5 -> DIV.card "Features …"      <- left the panel; no inner control was ever reached
```

Tab goes row, row, out. Prepared is at least reachable from the spellbook; ritual cast, pin and the
cast-time note are reachable nowhere.

**Fix:** stop making the row a `<button>`. Make `.spell-row` a `<div>` whose name span is the cast
button and the four accessories real `<button>`s beside it — then the browser gives all five tab
stops for free, and every `svelte-ignore` and hand-rolled keydown in this block deletes itself.

### 27 · [x] MEDIUM · resource pips in the combat strip are click-only

`src/routes/combat/blocks/CombatStrip.svelte:111` — `<span class="resource-pip" role="button"
tabindex="-1">`, `onclick` only, with the a11y warning suppressed. `ui.md` rule 7 makes pips a
first-class interaction ("Resource, slot, and economy pips are click-to-set") and requires a keyboard
path. `Turnbar.svelte:35` carries an explicit comment justifying its own `tabindex="-1"` pips by
naming the pill-based fallback; `CombatStrip` has the same shape with no such fallback documented,
and its enclosing `<button>` fires `useResourceOrEnter` — spend one, not set to N. So keyboard users
can spend a pip but cannot restore one.

**Fix:** either document the same pill-based fallback the Turnbar has, or give the pip row a roving
tabindex with left/right.

**Closed** by making each pip a real `<button>`, as the Spells panel's slot pips already were, and
taking the chip's own `<button>` off the container that held them — a pip nested in a button is
invalid content whose tab stop the button swallows, which is why neither answer above was needed once
the nesting went. Finding 52's site (the same pip in `EffectsPanel`) is the same change.

### 28 · [x] MEDIUM · two literal English user-facing strings in `.svelte`

- `src/routes/combat/blocks/panels/EffectsPanel.svelte:196` — `title="Use one {r.name}"`
- `src/lib/components/settings/ThemesSettings.svelte:284` — `aria-label="{label(token)} colour"`

AGENTS.md ▸ Locales, and `ui.md`: "A user-facing sentence is a key in `src/lib/i18n/locales/*.json`."
The second is worse than it looks — it is glued from a value plus an English noun, which `ui.md` bans
outright: "A phrase is ONE key, never a noun substituted into a frame."

**Evidence:** a scan of every `title=`/`aria-label=`/`placeholder=`/`alt=` literal and every bare
markup text run across all non-`/dev` `.svelte` files returns exactly these two, plus `"Ctrl K"` at
`+layout.svelte:362`, a key-cap glyph that is correctly untranslated. The shape that scan cannot see
is an English sentence in a `{}` expression handed to a prop, which is what finding 69 found two more
of — so the census is complete for attributes and markup runs. **The prop half is now closed too:
finding 92**, four more sites.

**Fix:** an ICU key taking `{name}`, and a whole `themes.tokenColorLabel` key taking `{token}`.

### 29 · [x] MEDIUM · `border-radius` is off-token in 62 places, and stylelint guards font-size but not radius

`config/stylelint.json:20` guards only `{"declaration-property-unit-disallowed-list": {"font-size":
["px"]}}`. `ui.md` ▸ Theming: "Never a hardcoded hex, rgb, **px font-size, or radius**." AGENTS.md:
"Stylelint guards the colour half only — sizes are on you."

**Evidence** — scan of every `.svelte` `<style>` block and `.css` file under `src/`:

| check | result |
| --- | --- |
| literal hex / `rgb(` / `hsl(` outside `tokens.css` | **0** ✓ |
| `font-size` in `px` | **0** ✓ (the guard works) |
| `border-radius` in `px`, excluding the `999px` pill radii | **62** ✗ |

The literals in use are 2, 3, 4, 7, 10, 12, 13, 16, 20 and 999px. The tokens are `--radius-sm:6px`,
`--radius:8px`, `--radius-md:11px`, `--radius-lg:14px`, `--radius-full:999px`. **Not one of the six
distinct non-999 literals matches a token value**, so this is not drift — the radius scale was never
adopted. Concrete: `components.css:69,240,247,360,392,542`, `SpellsPanel.svelte:248,335,417,426`,
`CombatStrip.svelte:220,268,325`, `HpPanel.svelte:292,301,322`,
`ClassPicker.svelte:110,132,146,171,181`. The consequence is what the doc names: a user theme that
remaps `--radius*` moves nothing on these 62 spots.

**Fix:** add `"border-radius": ["px"]` to the existing rule in `config/stylelint.json` and let the
failures drive the mapping. Widening the scale by one or two values is the honest half of that
change — 7px and 10px appear 20+ times between them.

**Closed:** the rule is in (with `tokens.css` exempt, where the scale is defined), and all 64
declarations map by INTENT rather than by nearest number — every 20px and 999px site is a pill
(`--radius-full`), 13/16px are cards (`--radius-lg`), 10/12px are panels and popovers
(`--radius-md`), 7px is the base `--radius`, and 2–4px became one new token, `--radius-xs`. The 16
`50%` declarations stay: a circle is geometry, not a size, and a theme that remapped it would turn
the pips into squares. Pixel-diffed against a baseline taken at the commit before — the only drift
is corner pixels.

(The other 516 `px` literals are padding, gap, width and height. `--space-*` is a `rem` scale, so
those are not a like-for-like swap and are not called defects here.)

### Suspected, not reproduced — UI

- **`.upcast-btn` (`SpellsPanel.svelte:156`) may be unreachable in practice.** It has `tabindex="0"`
  and a correct `e.code` keydown, but it is a focusable element nested inside a `<button>`, where
  browser behaviour is not uniform. Untested: the demo character is a Warlock with single-level pact
  slots, so `castableSlots(r).length > 1` was never true and the control never rendered. Needs a
  prepared full-caster to drive.
- **Global and scoped CSS name collisions.** `tools/visual/css-name-collisions.mjs` reports 120 class
  names reused across files with different styles — `.on` (19 files, 28 distinct styles), `.page`
  (14), `.body` (8), `.spacer` (7), `.save` (6). `ui.md` names this exact hazard. Svelte scoping means
  most cannot actually bleed, and the repo already ships the detector, so this is not called a defect
  without isolating a case where a global bare rule reaches a scoped element that meant something
  else. Candidates worth an hour: global bare `.card` (`components.css:2`) against
  `MobileWarning.svelte`, and global bare `.meter`/`.stepper` (`components.css:235,252`) against
  `InventoryPanel.svelte`.


## Storage and the pack lifecycle

Second pass, reading the half the first pass never opened: `src/lib/storage/**`,
`content/{disk,packs.svelte,homebrew,watcher,reload,review.svelte,provider}.ts`, `content/remote/**`.
Verified against a **real filesystem** (`NodeStorage` on a temp dir, real Windows handles), because
the existing suite for this area runs on `MemoryStorage` — and `MemoryStorage` is wrong about the one
OS behaviour these designs rest on. See the note under *checked and correct* below.

The mechanical check first: `grep -rn "@tauri-apps" src/` returns 8 non-test source hits. Seven are
legitimate — the four files on eslint's ignore list plus one test with a written justification. The
eighth is finding 33.

### 30 · [x] MEDIUM-HIGH · three of the four pack writers have no `guarded()`, so a disk failure is an unhandled rejection and a half-done state

`pack-lifecycle.ts:243` (`renamePack`), `:286` (`uninstallPack`), and `updates.svelte.ts:371` →
`install.ts:389` (`rollbackPack`). `guarded`'s own docstring
(`pack-update-state.svelte.ts:161`) states the rule these three break, verbatim: "The disk half of an
apply can THROW where the network half returns a value: a full disk, `EBUSY` from a content CSV
someone left open in Excel, a folder the OS refuses. Every one of those is an ordinary failure the
panel should state, and without this they surfaced as **an unhandled rejection and a silent no-op —
the one shape of failure the user cannot even see**." Only `applyPackUpdate` and `installPack` are
wrapped. Only `swapInNewTree` (`install.ts:262`) settles the disk before rethrowing.

**Reproduced** — real fs, real Windows lock (`fs.openSync` on a file inside the folder):

```
rollbackPack, live folder cannot be renamed away  -> EPERM   content/ = [ p, p.prev ]
rollbackPack, .prev cannot be renamed into place  -> EPERM   content/ = [ p.new, p.prev ]   <- the pack is GONE
```

The second row is the damaging one. The throw escapes `duringPackWrite` and reaches
`PackUpdatesSettings.svelte:409` as a rejected promise: no toast, no error row, and
`afterDiskChange()` — the only thing that reloads content and re-reads `rollbackablePacks()` — never
runs. The pack folder does not exist and the panel still lists it.

The same shape at the other two sites, visible without a probe:

- `uninstallPack:282` calls `revokePackPlugins(pack)` **before** `storage.remove` at `:288`. A throw
  there skips `removeStaging` and `forgetPack`, so the pack is still installed and its plugin code
  still on disk, with its consent revoked — and the confirm row stays open saying nothing.
- `renamePack:244` — if the second rename (`<from>.prev` → `<to>.prev`, `:248`) throws,
  `renamePackEntry` and `renameFileRoot` never run. The folder has moved and the registry has not, so
  the next rebuild's `forgetUninstalledPacks` drops the entry, repo URL and pin with it, and the
  user's per-file browse toggles are stranded — which is exactly what `packs.md` promises will not
  happen.

**Fix:** a `guardedVoid` beside `guarded` (try/catch to `fail({kind:'raw'})`) around all three
bodies; give `rollbackPack` the `catch { await recoverInterruptedApply(...); throw e; }` that
`swapInNewTree:265` already has; and move `revokePackPlugins` after the successful delete.

### 31 · [x] MEDIUM · `installPack` asks only the registry whether a folder name is taken; `renamePack` also asks the disk

`pack-lifecycle.ts:145` — `const ownerName = claimedPackName(typed);` and nothing else, and
`claimedPackName` (`packs.svelte.ts:224`) searches `packConfig.packs` only.
`freeLocalPackName`'s docstring (`packs.svelte.ts:396`) states the rule: "A name is taken if the
registry claims it **or if `onDisk` holds it** (a folder can exist without an entry — the user may
have copied one in by hand, and **overwriting it would be the data loss this whole check exists to
avoid**)." `discoverPacks:85` does pass `onDisk` when computing the *suggestion*, but
`PackUpdatesSettings.svelte:209` renders an editable input over it and `:223` hands whatever was
typed to `installPack`, where the disk is never consulted. `renamePack:229` gets it right.

**Reproduced:**

```
claimedPackName("registered")            = registered
claimedPackName("on-disk-only")          = undefined      <- registry-only
freeLocalPackName("on-disk-only", [..])  = on-disk-only-2  <- disk-aware, but only for the suggestion
```

Type the un-suffixed name back into the box and the install runs `diffPack` against a stranger's
folder and renames it to `.prev`. Not total loss — `buildAndSwap` carries over every file the remote
does not mention — but two packs end up merged under one registry entry, and a later uninstall
deletes both.

**Fix:** one argument. `installPack` has `storage` at `:165`; move it above the check and add
`|| (await storage.exists(...))` to the refusal at `:147`, matching `renamePack:229`.

### 32 · [x] MEDIUM · the overwrite guard is asked on the write path and never on the DELETE path

`diff.ts:135` classifies every local `isPackFile` the remote does not list as `FILE_CHANGE.removed`
without calling `isProtectedText`; `install.ts:186` then passes them to `swapInNewTree` as
`dropping`. `packs.md` ▸ Applying is all-or-nothing: "A file the user has changed is never
overwritten. The `#content-hash` overwrite guard decides that, and it applies here exactly as it
applies to seeding."

**Reproduced** — real fs, a user-authored `mine_srd.csv` dropped into a pack folder:

```
protected before?  true                       <- unstamped, so it is the user's
diff: p/mine_srd.csv=removed                  <- not `preserved`
apply: {"removed":["p/mine_srd.csv"]}
hand-edited file still there? false
```

Held at MEDIUM because `removeDeleted` is off by default and behind its own button. What is missing
either way is that the preview cannot distinguish a file upstream dropped from a file the user wrote
— both render as one `removed` count (`PackUpdatesSettings.svelte:79`).

**Fix:** `diff.ts` has the bytes in hand two lines up for the `expectLocal` hash — feed them to
`isProtectedText` and emit `preserved`, or flag the change as the user's so the list can say so.

### 33 · [x] MEDIUM · the Tauri architecture gate does not see dynamic `import()`, and one lives above the seam

`eslint.config.js:79` and `src/routes/+layout.svelte:156`. `overview.md:35`: "There is no scattered
raw `fs`, and **nothing above the interface imports Tauri** (eslint's `no-restricted-imports` pins
that to `lib/storage/tauri.ts` and `lib/update/**`)." The layout's
`void import('@tauri-apps/plugin-opener').then(...)` is a route component, not on the ignore list,
with no disable comment — and it passes.

**Reproduced** (eslint 10.8.0):

```
$ npx eslint --print-config src/routes/+layout.svelte | jq .rules['no-restricted-imports']
[2, {"patterns":[{"group":["@tauri-apps/*","@tauri-apps/**"], ...}]}]   <- rule IS active on the file
$ echo "import * as fs from '@tauri-apps/plugin-fs'; …" | npx eslint --stdin …
  1:1  error  '@tauri-apps/plugin-fs' import is restricted …            <- static: caught
$ echo "export async function f(){ return await import('@tauri-apps/plugin-opener'); }" | npx eslint --stdin …
  (no output, exit 0)                                                   <- dynamic: invisible
$ npx eslint src/routes/+layout.svelte ; echo $?
  0
```

Sibling defect at the same line: **the doc's exemption list is stale.** The config ignores four paths
(`storage/tauri.ts`, `update/**`, `diag/**`, `content/remote/tauri-fetch.ts`); `overview.md:36` names
two.

**Fix:** `no-restricted-imports` cannot cover `import()` expressions — add a `no-restricted-syntax`
rule beside it matching `ImportExpression > Literal[value=/^@tauri-apps/]`, then either add the
layout to the ignores with a written reason (`openUrl` is not file IO) or put the OS-link hand-off
behind a seam function. Correct `overview.md:36` in the same change.

### 34 · [x] MEDIUM-LOW · `homebrew.ts` re-stamps any file it is handed, destroying a hand-edited file's permanent protection

`homebrew.ts:379` (`writeStampedHomebrew` → `stampWithHash` → `storage.write`), reached from
`saveHomebrewRow:434`, `upsertHomebrewRow:341` and `removeHomebrewRow:364` — none of which look at
where `targetFile` points. `content.md` ▸ Hashes: "a file whose body no longer matches its stamp, or
that carries no stamp at all, is treated as the user's own, so desktop seeding and every pack update
skip it **forever**." And ▸ Writing CSV back: "The app writes **only files it created** (homebrew).
It never rewrites a hand-edited user file."

**Reproduced** — real fs, a hand-edited `content/srd-2014/items_srd.csv`:

```
protected before the app writes?  true
saveHomebrewRow(..., 'content/srd-2014/items_srd.csv') -> {"ok":true,"id":"axe"}
protected AFTER?                  false
```

The user's edit survives the write and is then unprotected: the next seed or pack update overwrites
the whole file, edits and homebrew row together.

**Reachability, stated honestly:** the UI blocks both entrances today —
`EditContentForm.svelte:252` refuses an add into a shipped target and `:91` forks an edit of a
shipped row into `homebrewFile(type)`. So this is a live footgun in the module, not a live bug in the
app — the exact shape `pack-lifecycle.ts:268` warns about: "an invariant that depends on one
component calling two functions in the right order is one caller away from being false."

**Fix:** move the check into the writer. `isShippedFile` already exists in this module
(`homebrew.ts:219`); have the three public writers take `packRoots` and refuse a target inside one.

### 35 · [x] LOW-MEDIUM · `configWritesSettled` names the data-folder move as its reason to exist, and the move never calls it

`json-config.ts:94`: "Resolves when every queued write for this file has landed. For the callers that
must not race the queue — **a data-folder move (which swaps the Storage under it)** and the tests."
`grep -rn "configWritesSettled" src/` returns the definition and its own test. Nothing else.

The move is `StorageSettings.svelte:157` → `migrateDataDir` → `finalizeMove` (`tauri.ts:172`:
`setDataDirOverride`, then `fsRemove(oldDir, {recursive:true})`) → `reloadApp()`, whose `flushAll()`
(`reload.ts:22`) drains only the `onBeforeReload` set — the config queue is a separate chain and is
not in it. So a `charnik.config.json` write queued moments before the move (a pin, a
`dismissedMissing`, an ETag) is copied in its pre-write state, and the queued flush then executes
against a cached `TauriStorage` whose root points at the folder `finalizeMove` just deleted. A narrow
race — but the one function written to close it is dead code.

**Fix:** one line — await it before `migrateDataDir`/`mergeDataDir`, or register it as an
`onBeforeReload` flusher so every reload path gets it.

### 36 · [x] LOW · `content.md` describes a watcher mechanism the watcher does not have

`content.md:218`: "The file watcher **ignores the app's own writes**, or a write triggers a reload
which triggers a write." `watcher.ts:8` documents the opposite design, and is what the code does:
"`reloadContent()` only READS (never writes), so the app's own homebrew save can't create a
write→reload→write loop — at worst one redundant re-read." There is no own-write suppression
anywhere in the file; the only gate is `isPackWriteInFlight()` (`:54`), which is about swaps.

The loop the doc guards against is in fact closed, but by a different argument: `autoAdoptDrift`
(`review.svelte.ts:94`) *does* write from the watcher callback, and terminates because a re-stamped
file no longer drifts, plus the `adopting` re-entrancy flag at `:83`.

**Fix:** replace the sentence with what is true.

### 37 · [x] LOW · the `Storage` interface promises a sandbox two of its four implementations do not enforce

`types.ts:3`: "Paths are relative to the configured `dataDir` root and are **sandboxed by the
implementation** (traversal outside the root is rejected)." `path.ts:8` doubles down: "the seam's own
validation is what the node/in-memory impls rely on entirely, so it must be correct here."

`sandboxRelative` is called by `MemoryStorage` (`memory.ts:2`) and `TauriStorage` (`tauri.ts:273`);
`NodeStorage` has its own equivalent (`node.ts:16`). `BrowserStorage` (`browser.ts:27`) and
`FetchStorage` (`fetch.ts:24`) have neither — `norm`/`url` strip leading and trailing slashes only.
Harmless for `BrowserStorage` (a flat IndexedDB keyspace), but `FetchStorage.url('../../x')` produces
`${base}/../../x`, which the browser resolves before fetching. Both are read-only-ish and their paths
come from the generated manifest, so this is a latent contract violation rather than an exploit.

**Fix:** `sandboxRelative` in both, two lines, and the interface comment becomes true.

### Suspected, not reproduced — storage

- **`uninstallPack`'s throw ordering needs a `remove` that actually fails.** The consequence is
  certain from the code, but it could not be triggered: `NodeStorage.remove` (`fs.rm` with force and
  retries) succeeded on Windows even with an `r+` handle open on a file inside the folder. The
  runtime implementation is Rust's `remove_dir_all` through the Tauri fs plugin, which has no retry
  loop and is the one that would report the `EBUSY` the codebase keeps citing. **The `/dev/` probe
  that settles it:** a page that creates `content/probe-pack/x.csv`, opens it via the Tauri fs plugin
  without closing, calls `uninstallPack('probe-pack')`, and writes
  `{threw, folderStillThere, entryStillInRegistry, pluginConsentRevoked}` into the data dir.
- **`buildAndSwap:285` can promote stale `.new` files into the live pack.**
  `await storage.remove(next).catch(() => {})` then `mkdir(next, {recursive})`: a failed remove leaves
  a previous attempt's files in the staging tree, and they land in the pack after the swap without
  appearing in `ApplyResult.written`. Needs the same untriggerable failure. `install.ts:303`'s
  `remove(prev).catch(() => {})` is the one swallow in this file with no comment saying why.
- **A restamp that never clears drift would be an unbounded watcher loop.** `autoAdoptDrift` writes,
  the watcher fires, 300 ms later the reload lands and calls it again; the `adopting` flag is already
  down by then, so the only thing terminating the cycle is `driftItems` going empty. `restampText`
  hashes the text it just produced, so it should always clear — but a file where it does not would
  write to disk every 300 ms for ever.
- **The homebrew rewrite grows the file by every blank schema column.** `buildRow:267` writes `''`
  into every column of the type, so `columnsWithExtras:178` appends them all: a user's 7-column CSV
  came back with 16 columns and nine empty trailing cells on every pre-existing row. Order and locale
  columns *are* preserved, and `content.md:270` does sanction appending "columns the rows have
  gained" — but it sits against the same paragraph's "editing one row through the UI is not a reason
  to restyle their file". A maintainer's call.

### Checked and correct — storage

- **The headline item holds: the user-edited-file rule works on the UPDATE path**, not just the seed
  path. Real fs, real blob SHAs, real `applyPackUpdate`: a changed shipped file was rewritten, an
  edited one came back `preserved` and byte-identical, a `NOTES.md` the remote never mentions was
  carried across the swap, the file stayed protected afterwards, and the staging ended `.prev`
  present, `.new` gone.
- **The design's core OS assumption is real, and the fake contradicts it** — the `AGENTS.md` case
  exactly:
  ```
  win32   dir -> existing EMPTY dir : EPERM
  win32   dir -> existing FULL  dir : EPERM
  MemoryStorage  a -> b             : NO THROW | b now contains [ x.txt, y.txt ]   <- silently MERGED
  ```
  Every `install.test.ts` assertion about the two-rename swap is therefore exercising a store that
  would have happily flattened two packs into one. `BrowserStorage.rename` (`browser.ts:113`) shares
  the overwrite-happy behaviour, which matters because `types.ts:38` says "Overwriting an existing
  target is not promised".
- **`rollbackPack` and `recoverInterruptedApply` happy paths, on real fs.** Apply then rollback
  restored the original bytes with no staging litter; a `.prev` + `.new` tree recovered from `.prev`
  and swept `.new`.
- **Startup ordering is safe.** `provider.ts:68` runs `recoverInterruptedApplies` *before*
  `forgetUninstalledPacks` at `:75`, so even an unguarded mid-swap throw does not cost the registry
  entry — the folder is back before anything reads the listing.
- **No IO bypasses the seam.** `node:fs` appears only in `storage/node.ts`, one test-support file and
  five node-only tests. `localStorage` is used only for preferences the docs place outside the
  dataDir, never as the user-data store. Raw `fetch(` appears only inside `FetchStorage`.
- **Homebrew writes are UTF-8-BOM + CRLF and atomic**, and preserve the file's own column order and
  every locale column (`text_de`, `name_uk` round-tripped intact).
- **`isReservedPackName` / `isUsablePackFolderName` / `freeLocalPackName`** cover the Windows name
  hazards `packs.md` names — case folding, `.new`/`.prev`, `homebrew`, DOS device names, trailing dot
  or space, control chars — and `sanitisePackFolderName` provably terminates its `-2`/`-3` loop.
- **`collisions.json` is genuinely separate** from `charnik.config.json`, as `content.md` requires.
- **`writeConfigSection`'s coalescing does not drop the registry's failure report.** A second call in
  the same tick discards its `onWrite` (`json-config.ts:69`), which would violate `packs.md`'s "A
  failed registry write reaches the user" — but `packs.svelte.ts:364` is the file's only tenant and
  every call installs the identical callback. Benign today; a real bug the moment a second section is
  added to `charnik.config.json`.

## The L3 plugin layer

Second pass over the largest block the first pass never opened: `plugin-host.ts`,
`plugin-sandbox.ts`, `plugin-registry.ts`, `plugin-store.svelte.ts` and `upcast.ts`, all five read in
full against `plugins.md`, `security.md` and `effects.md` §L3.

The headline is that **the sandbox holds** — see *checked and correct* below, where a full global
enumeration from inside a live plugin is recorded. What does not hold is the contract around it: the
target vocabulary, the budget, and the consent lifecycle.

### 38 · [x] HIGH · eight of the eighteen documented contribution target keys are rejected, and they take the whole result down with them

`plugin-registry.ts:103` (`TARGET_KEY_RE`), enforced at `:150`. `plugins.md` §4.4 lists the legal
keys: `ac · initiative · speed · speed.fly · speed.swim · hp_max · attack · damage · spell_dc ·
spell_attack · save.<ab> · skill.<id> · passive.<skill-id>` — "**any of the 18** — every check has a
passive form, **not only the three senses the strip highlights**" — plus `action · bonus · reaction ·
d20_tests`. The regex admits `passive.(perception|investigation|insight)` and nothing else beyond the
basics.

These are not aspirational keys. `character/derive-targets.ts:22` (`NUMERIC_TARGETS`) already
consumes every one of them, `derive.ts:390` folds `speed.fly`/`speed.swim`, `:370` folds
`spell_dc`/`spell_attack`, and `TurnEconomy.slotMax` consumes `action`/`bonus`/`reaction`. And
`derive-targets.ts:39` carries the *same sentence* as the doc about passive scores of any skill.

The failure mode is whole-result rejection (§4.3), so a handler that also returned `tokens` and
`notes` loses those too:

```
ACCEPT  ac / initiative / speed / hp_max / attack / damage / save.dex / skill.stealth / passive.perception
REJECT  speed.fly        tokens=0 notes=0  invalid result: bad target key "speed.fly"
REJECT  speed.swim       tokens=0 notes=0  invalid result: bad target key "speed.swim"
REJECT  spell_dc         tokens=0 notes=0  invalid result: bad target key "spell_dc"
REJECT  spell_attack     tokens=0 notes=0  invalid result: bad target key "spell_attack"
REJECT  passive.stealth  tokens=0 notes=0  invalid result: bad target key "passive.stealth"
REJECT  action / bonus / reaction / d20_tests
```

`tools/plugin-test.ts:115` routes through the same `expandPluginEffects`, so the author-facing CLI
reproduces the rejection identically: an author following the spec is told their spec-conformant
result is invalid.

**Fix:** the closed set already exists once. Replace the hand-written regex with a membership test
against `NUMERIC_TARGETS`, keeping the existing ≤20 key cap — which is what actually stops
prototype-pollution keys, as the comment at `:100` says. That also deletes the second copy that
caused the drift.

### 39 · [x] HIGH · the per-derive budget does not cover the post-trip sandbox rebuild, and a sibling handler's success keeps the fail-closed counter from ever firing

`plugin-sandbox.ts:256` (`bootPlugin` on a limit trip, inside `call`), `plugin-registry.ts:96`
(`AGGREGATE_BUDGET_MS = 20`), `:327` (the gate), `:343` (`noteSuccess`).

`plugins.md` §5 promises "per sheet computation: **~20 ms aggregate** across ALL plugin tokens" and
"3 consecutive failures disable the plugin for the session". Neither holds. When a call trips the
5 ms interrupt, `call` immediately re-evaluates the *whole* `main.js` in-line to recycle the context
— and QuickJS's interrupt handler does not bound parse or compile, so a legal 250 KB `main.js` costs
about 65 ms per rebuild, charged to the derive *after* the aggregate gate has already been passed.

**Reproduced** — 250 KB `main.js`, one hanging handler, one `ctx.play`-reading handler, eight HP
ticks:

```
hp=41: 101 ms  reasons=[over budget]
hp=40:  70 ms  hp=39: 68 ms  hp=38: 74 ms
hp=37:  67 ms  hp=36: 66 ms  hp=35: 71 ms  hp=34: 76 ms
```

"plugin disabled for the session" never appears. `resolvePluginToken` calls `noteSuccess(fkey)` on
the *good* handler's call, and `fkey` is `(namespace, characterId)` — one counter for the whole
plugin — so the good handler wipes the bad handler's strikes on every derive. With the hanging
handler alone the counter does trip after three derives, which is why existing coverage misses this:
`plugin.test.ts:299` asserts the streak reset deliberately, and `plugin-perf.test.ts:62` bounds
sandbox **call counts**, not wall time, with a fake evaluator that has no rebuild cost.

Net effect: about 70 ms added to *every* derive — every HP tick, every condition toggle — for as long
as the plugin stays enabled.

**Fix:** key the fail-closed counter on `(namespace, handlerName, scope)` in `failKey`
(`plugin-registry.ts:195`), so a hanging handler accumulates its own three strikes regardless of what
a sibling does. Second half, if the overrun itself matters: do not rebuild inside `call` — leave
`p.context = null` and let the next call boot it, so the rebuild lands after the aggregate gate
rather than behind it.

**Closed with both halves.** The counter is per handler, so the hanging one reaches three strikes and
stops being called while its healthy sibling keeps running (asserted in `plugin.test.ts`), and a
tripped call disposes the context instead of re-evaluating `main.js` behind the gate.

### 40 · [x] MEDIUM · the plugin ctx's `hpMax` and `isBloodied` disagree with the max the app clamps to

`character/derive-plugins.ts:53` —
`const preHpMax = character.play.hp.max ?? applyEffects('hp_max', o.maxHpBase, facts).value;` — and
`:70`, `isBloodied: character.play.hp.current <= preHpMax / 2`. A manual `play.hp.max` short-circuits
the fold entirely, so `hp_max` effects vanish from the plugin's view. Everywhere else on the HP path
this was fixed as A14: `combat/defense.ts:43`'s `effectiveHpMax` re-folds the manual max as a `base`
`set` with the sheet trace's layers on top.

**Reproduced** — real `srd-2024`, fighter 3, CON 14, `play.hp.max = 30` manual, Aid
`flat_bonus:hp_max+5`, current 16:

```
sheet.maxHp.value      = 33
effectiveHpMax (app)   = 35   -> bloodied? true      (16 <= 17.5)
plugin ctx.play.hpMax  = 30   -> isBloodied: false   (16 >  15)
```

The handler is told it is not Bloodied while the HP bar, the heal clamp and the damage clamp all say
it is. `plugins.md` §4.2 does say "a manual play-state max wins", so the doc blesses half of this —
but §4.2's own naming rule ("A fact never has two names across the layers") and AGENTS.md's "One name
per fact everywhere" do not survive three spellings of one number.

**Sibling, same root:** `character/derive-context.ts:89`'s `hpMaxLive()` is
`character.play.hp.max ?? state.hpMax.value` and `:98`'s `is_bloodied` reads it — so the L2 guard
variable has the identical divergence. One fix covers both.

**Fix:** route `derive-plugins.ts:53` through `effectiveHpMax`, which already takes exactly a
`Computed`. This is finding 4's shape in a third place — worth fixing all three together.

**Closed with finding 51**, which did fix all of them together: both this site and `hpMaxLive()` go
through `effectiveHpMax` now, so the plugin ctx, the L2 `is_bloodied` variable, the bar and the two
clamps read one number.

### 41 · [x] MEDIUM · `plugins.md` §4.3 describes pre-D12 `set` semantics

`docs/internals/plugins.md:245` versus `rules/pipeline.ts:202` and `effects/apply.ts:386`. The doc
says an `op: "set"` folds "exactly like a content `set_override` (at the override stage,
most-potent-wins across all sets)". `apply.ts:386`'s own docstring records the change that made the
parenthetical false: "D12 layering (the fact's own layer, **sets no longer forced to `override`**)".
The pipeline takes `Math.max` over sets **within one layer**, then walks `LAYER_SEQUENCE`, so a later
layer's set overwrites an earlier layer's larger one.

**Reproduced** — one plugin result, two sets:

```
contributions.ac = [ {layer:'feature', op:'set', amount:20}, {layer:'condition', op:'set', amount:10} ]
doc says (most-potent across all sets) -> 20
observed AC = 10
trace = [Base/base/set/10, ns: Big set/feature/set/20, ns: Small set/condition/set/10]
```

The clause "exactly like a content `set_override`" is still true; the parenthetical is the stale
half. Per the spec header ("Where this document and code disagree, THIS document wins — or gets
amended first"), this is a doc fix: name the layer, the within-layer max, and the later-layer
override.

### 42 · [x] MEDIUM-LOW · the web demo does ship the QuickJS runtime — 528 KB of it

`plugins.md:341`: "Desktop only. … The web demo (GitHub Pages) has no plugin discovery and **does not
bundle the QuickJS runtime**." `effects.md:369`: "**Desktop-only** — the web build ships no sandbox."
`plugin-store.svelte.ts:93` imports `./plugin-sandbox` dynamically, which makes it a lazy *chunk*,
not an excluded one, and `.github/workflows/pages.yml:55` runs the same `pnpm build` and uploads
`build/` wholesale.

**Reproduced** against the checked-in `build/`:

```
$ find build -name '*.wasm' -printf '%s %p\n'
528551 build/_app/immutable/assets/emscripten-module.1o1lmnrM.wasm
$ grep -rl quickjs build/_app | head
build/_app/immutable/assets/emscripten-module.1o1lmnrM.wasm
build/_app/immutable/chunks/Cd8MkZPT2.js
```

The *runtime* claim underneath it holds — `loadPlugins` returns at `plugin-store.svelte.ts:66` when
the platform is not Desktop, so the chunk is never fetched and the sandbox never exists on the public
URL. What is wrong is "does not bundle": half a megabyte is deployed to Pages on every release.

**Fix:** either amend both doc lines to "never loaded on web" (accurate, zero code), or gate the
chunk out of the Pages build. The doc edit is the honest small one; the exclusion is the one that
saves the bytes.

**Closed** with the doc edit: both lines now say the runtime is shipped and never loaded, and name
what excluding it would cost (a build-mode stub for `plugin-sandbox`). Half a megabyte of unfetched
lazy chunk is a size fact, not a behaviour one, and nothing has asked for the build mode.

### 43 · [x] MEDIUM-LOW · deleting a hand-placed plugin folder leaves its consent, so re-dropping the same bytes runs it with no dialog

`plugin-store.svelte.ts:147` (`revokePackPlugins`) has no local-plugin counterpart, and
`PluginsSettings.svelte` offers no way to revoke consent — `disablePlugin` (`:159`) only flips
`enabled`, leaving `prefs.consent[ns]` for ever, and the button then reads "enable" and re-enables
through `enableConsented` with no dialog.

`revokePackPlugins`'s own docstring states the principle it does not extend to local folders:
"Consent … OUTLIVES the files it was granted for. Without this, re-installing the same pack later
would silently start running its code again — technically consented (the bytes match) but never said
out loud, and 'I removed that pack' is the clearest possible statement that the permission is over."

**Reproduced** with `MemoryStorage` plus `discoverPlugins`/`isRunnable`:

```
after consent  -> runnable: true
after delete   -> discovered: 0   prefs: {"consent":{"evil":"7443ca74…"},"enabled":{"evil":true}}
after re-drop  -> runnable: true            <- runs immediately, no dialog, no notice
```

Also AGENTS.md ▸ Reverse states: consent is a way in with no way out and no way to see it — the
Settings row simply disappears while the grant persists.

**Fix:** a "forget this plugin" action on the Settings row doing for one namespace what
`revokePackPlugins` does for a pack, and optionally pruning prefs for namespaces no longer discovered
on `refreshPlugins`.

### 44 · [x] LOW · a dice-carrying upcast formula produces a fractional modifier

`effects/upcast.ts:125` (`toPoolFlat`) against `:118`, which documents the field as "Numeric
contribution (**floored**; 5e round-down)". The `number` branch does `Math.floor(v.value)`; the
`dice` branch returns `v.dice.flat` untouched.

**Reproduced:**

```
count:slot/2                   slot=5 base=1 -> flat 2      (floored)
temp_hp:slot/2                 slot=5 base=1 -> flat 2      (floored)
damage:per_slot(1d6)+slot/2    slot=3 base=1 -> pool {6:2}, flat 1.5   <- not floored
```

`spell-casting.svelte.ts:283` pushes that straight through as `mod: res.flat`, so the spell rolls
`2d6 + 1.5`.

**Fix:** one `Math.floor` on the dice branch's `flat`.

### 45 · [x] LOW · upcast has a second, more permissive guard-truthiness rule than the resolver

`upcast.ts:143` versus `effects/resolver.ts:258`. The resolver treats a guard whose value is not a
`number` as unreadable: it pushes `ISSUE_KEY.unreadableGuard` ("the guard … is not a yes/no
condition") and marks the token inert. `evalUpcast` checks only
`g.value.type === 'number' && g.value.value === 0`, so a dice-valued guard falls through as **true**,
silently.

**Reproduced:**

```
1d4 ? damage:per_slot(1d6)          slot=3 base=1 -> APPLIES, pool {6:2}, no error
0   ? damage:per_slot(1d6)          -> contributes nothing (correct)
nonsense(( ? damage:per_slot(1d6)   -> error "unknown function 'nonsense'" (correct)
```

Same `<cond> ? <token>` grammar, two answers — in a file whose header claims it "reuses the existing
grammar discipline (N1)".

**Fix:** mirror the resolver — reject a non-number guard before the zero check.

### 46 · [x] LOW · the `readPlay` memo flag is a sandbox self-report, and a handler can forge it

`plugin-sandbox.ts:245` — `return JSON.stringify({ result: r ?? {}, playRead });`. `plugins.md` §4.2
says "**The host tracks** which sub-objects a handler actually reads". It does not: the wrapper
computes `playRead` inside the sandbox and hands it over inside the same string the handler can
control, because `JSON.stringify` is not frozen.

**Reproduced** — a handler that genuinely reads `ctx.play`, then replaces `JSON.stringify` before
returning: `FORGE playRead -> {"ok":true,"resultJson":"{\"notes\":[\"forged\"]}","readPlay":false}`.

Host-side consequence: the result lands in `memoBuild` (`plugin-registry.ts:344`), keyed on the build
half only, so it is served stale across every HP tick and condition change. The content is still zod-
validated and clamped, so this is a wrong-number and determinism issue, not an escalation. Replacing
`JSON.stringify` at *load* time is already fail-closed; only the in-call replacement gets through.

**Fix:** capture the intrinsics in the setup script before `main.js` runs, or `Object.freeze(JSON)`
in `SETUP_SCRIPT` alongside the existing `Object.freeze(Math)`.

### 47 · [x] TRIVIAL · `registerPluginEvaluator` resets half the cross-evaluator state

`plugin-registry.ts:82` clears `failCounts` but not `memoBuild`/`memoFull`, while its docstring says
"Replaces any previous": `register(evaluatorA)` then `register(evaluatorB)` still serves A's note, B
never called. Not live — `plugin-store.svelte.ts:104` calls `clearPluginMemo()` immediately before
every `registerPluginEvaluator`, and that clears the fail counts too — so the app path is correct and
the registry-side clear is redundant. It is a trap for the next caller.

**Fix:** call `clearPluginMemo()` inside `registerPluginEvaluator`/`clearPluginEvaluator` and drop
the redundant clear in the store.

### Suspected, not reproduced — plugins

- **A broken *local* folder blocks a working pack copy of the same namespace.**
  `plugin-host.ts:151` writes into `claimed` before `readPlugin` runs, so an unparseable
  `<dataDir>/plugins/shared/` wins the namespace and the pack's valid copy is reported as the loser.
  Both rows come back visible with reasons, so nothing is silent — whether "the hand-placed folder
  wins" should still hold when it is broken is a design call.
- **A plugin over the 256 KB cap reports the wrong reason.** `plugin-sandbox.ts:198` skips it with
  `continue`, so it is absent from `plugins` and reports "handler not registered" rather than the
  size. Unreachable today: `readPlugin` (`plugin-host.ts:180`) rejects it first with the right
  message. Defence in depth with the wrong wording.
- **`pluginStatus` ignores the kill switch.** `plugin-store.svelte.ts:185` returns `'enabled'` for a
  consented and enabled plugin while `isRunnable` returns false; the row is only dimmed. Read, not
  driven in a browser.
- **Doc §8.4's per-system Bloodied seam does not exist in code.** `derive-plugins.ts:70` computes
  `isBloodied` identically under both editions. The formula is the same either way, so this is
  probably correct-as-written and only the doc oversells it.

### Checked and correct — the sandbox

The security boundary was the reason to read this block, and it holds. Recorded in detail so nobody
re-derives it.

- **No escape.** Full global enumeration from inside a live plugin returns only intrinsics plus
  `handlers`, `globalThis`, `performance`, `queueMicrotask` and the standard functions. **No host
  object, no `fetch`, no `require`, no `process`, no timer** — `queueMicrotask` enqueues onto a job
  queue the host never drains. `Date` is genuinely absent. `eval`, `WeakRef`, `FinalizationRegistry`
  and `performance` are present as names but `undefined`. `Atomics` is absent, so `SharedArrayBuffer`
  is inert.
- **`Function` is reachable and grants nothing new.** `Function('return 1+1')()` is 2;
  `Function('return this')()` yields the sandbox global, not a host object;
  `Function('return typeof eval')()` is `undefined`. An inconsistency with §5's "the `eval` binding is
  removed" wording, not an escape.
- **Prototype pollution inside the sandbox is confined to that runtime** — the host reads only a
  string across the boundary and parses it in its own realm.
- **A hostile `toString` on the boundary value cannot hang the host** — a returned object whose
  `toString` loops for ever comes back as `{"ok":false,"reason":"invalid result: not JSON"}` in 7 ms.
- **Argument injection into the call wrapper fails** — `U+2028`, `U+2029`, quotes, backticks,
  backslashes and `${x}` all round-trip intact with no template break.
- **A hostile `handlers` Proxy** whose getter throws yields "handler not registered": fail-closed.
- **The aggregate budget works for a token flood** — ten hanging tokens with a small `main.js`: 25 ms
  total, one call made, nine degraded. The bound breaks only under finding 39's rebuild.
- **A returned token cannot smuggle a guard** — `'is_raging ? flat_bonus:ac+5'` lands in
  `facts.unknown`, inert and surfaced, never applied unconditionally.
- **Host clamps on returned tokens hold** — `flat_bonus:ac+999999999` clamps to 1 000 000,
  `grant_resource:x:99999:short` to 1 000, nested `plugin:` tokens are dropped.
- **Notes and failed tokens render as escaped text** — no `{@html}` anywhere on the plugin path.
- **Errors are surfaced, never swallowed** — every degrade pushes `ISSUE_KEY.pluginFailed` with the
  reason in `detail` plus an entry in `facts.unknown`; a real `main.js` `SyntaxError` reaches
  Settings.
- **Consent hashing matches §6.3 exactly** — SHA-256 over the 8-byte big-endian length-prefixed pair,
  covering both files, stored outside the dataDir, with a corrupt record sanitised on load.
- **`per_slot` semantics are right** — `above = slot − spell_level`, `mult = max(0, floor(above/step))`,
  routed through `*` so dice and numbers scale identically; an empty pool at or below the base slot;
  `step <= 0` errors; `inf` legal only for `duration`. `withCastSlot` shadows exactly `slot` and
  `spell_level`, so upcast vars cannot leak into the persistent derive. Absolute-kind zeros fall back
  to the base, so a guarded-off upcast never zeroes a spell.
- **No shipped SRD row exercises upcast** — both packs carry the `upcast` column and it is empty in
  every row, so findings 44 and 45 are authoring-only today and there is no per-edition upcast
  divergence to find. `upcast.ts` is also effectively unchanged in the window: `b94d791` only added
  an `export`.


## Builder state — second pass

Queue item 4, started. These two settle SUSPECTED entries from the first pass and, in doing so, turn
one of them into a data-loss finding rather than the bookkeeping curiosity it looked like.

### 48 · [x] HIGH · un-picking a skill orphans its expertise, and the orphan then evicts a live one

`skill-picks.svelte.ts:38` (`toggleSkill`) removes a skill from `draft.skills` and touches
`draft.expertise` not at all. An exhaustive grep of every write to that array — `class-picks-cache.ts:128`
(restore), `:180` (the wipe), `skill-picks.svelte.ts:108` and `:118` — confirms **nothing prunes it**.
So expertise can name a skill you are no longer proficient in.

Two counters then disagree about that array. `expertiseUsed` (`:88`) counts only entries that are
still proficient — this is what the player is shown. `toggleExpertise` (`:118`) delegates to
`toggleCapped(draft.expertise, skill, this.expertiseCap)`, which slices against the **raw**
`list.length` (`draft.ts:48`). The dead entry is invisible to the player and fully counted by the
evictor.

**Reproduced** — cap 2, the arithmetic of the two pure functions, verbatim output:

```
start expertise                          ["acrobatics","stealth"]
start used (proficient only)             2
after un-picking stealth: expertise      ["acrobatics","stealth"]
after un-picking stealth: used shown     1        <- UI invites another pick
after un-picking stealth: raw length     2        <- evictor thinks it is full
after adding perception: expertise       ["stealth","perception"]
acrobatics survived?                     false    <- a live pick, silently gone
orphan stealth survived?                 true
used shown in UI                         1        <- still says 1 of 2
assembled (isProficient filter)          ["perception"]
```

A Rogue with two expertise slots ends holding **one** usable expertise, having been shown "1 of 2"
throughout and never told that Acrobatics was dropped. The eviction order is what decides it: the
orphan survives whenever it is the newer of the two, because `toggleCapped` drops from the front.

This also settles the first pass's SUSPECTED "`expertiseUsed` vs the cap — impact unclear". The
impact is a lost pick.

**Fix at the root, not at the counter:** prune on the way out. `toggleSkill`, in the branch that
removes a proficiency, drops the same skill from `draft.expertise` — one line, and both counters
agree again for free because there is no longer anything for them to disagree about. Filtering at
assemble (`build-view-model.svelte.ts:367`) already exists and is not enough: it repairs the saved
character while the builder keeps mis-counting the live one.

### 49 · [x] MEDIUM · picking your FIRST class empties the skills you already chose, unrecoverably

`class-picks-cache.ts:177` — the wipe is guarded on `draft.classes.length === 1`, and its comment
explains the intent: "the shared pools belong to whoever is in the draft, so they only empty when the
ONE class that could have filled them is the class leaving". In the first-class case there is no
class leaving. `leaving` is `null`, `stashClassPicks` returns `null` at its own first line
(`:77`, `if (!entry?.classId) return null`), so **nothing is stashed** — and the wipe runs anyway:

```
draft.skills = [];  draft.expertise = [];  draft.selectedSpells = [];
```

Nothing was cached, so the cache cannot hand it back when the class is switched again. Undo is the
only way out.

**Reachable, and easily.** With no class chosen, `classRow` is undefined, so
`classSkillCount = Number(undefined ?? 0) = 0`. That value is the escape hatch in both guards:
`pickable` (`skill-picks.svelte.ts:79`) returns true for every skill, and `toggleSkill`'s Strict
branch (`:55`) is `if (this.classSkillCount === 0 || this.chosenCount < this.classSkillCount)` — so
skills are added with **no cap at all**. The pane itself is ungated: `SheetSkills.svelte:21` is a
plain toggle onto `{ id: 'skills' }` with no dependency on a class being present.

So the sequence is: open Skills before choosing a class, pick freely, choose your class, and they are
gone.

The guard immediately above it shows the authors were thinking about exactly this class of bug —
`:171`, "on a single-class draft it empties the skills, expertise and spells for a click that
appeared to do nothing at all" — but that guard covers a stale row index, not the first pick.

**Fix:** the wipe belongs to a class *leaving*, so gate it on one — `if (leaving && draft.classes.length === 1)`.
The restore path below is unaffected: `returning` is keyed on the incoming `classId` and does not
depend on anything having been stashed this call.

### 50 · [x] MEDIUM · swapping a half-feat keeps the old ability, which the boost then silently ignores

`feat-slots.svelte.ts:106` — `if (first) featAb[key] ??= first;`. The `??=` is the defect: on a feat
swap the slot already holds an ability, so the default never fires and the **previous feat's** choice
stays. The line directly below it does the right thing for the sibling field — `delete featSk[key]`,
with the comment "§C: a feat swap clears the slot's skill choice-grant picks (stale for the new
feat)". The ability is the same kind of stale and is kept.

Two readers then disagree about that value, exactly as in finding 48:

- `ability-allocation.svelte.ts:199` — `if (ab && halfFeatOptionsFor(key).includes(ab))` — a stale
  ability is **silently skipped**, so the +1 is not applied.
- `feat-slots.svelte.ts:179` (`originChoicesOwed`, and the slot todos alongside it) tests
  `!draft.slotFeatAbility[key]` — the value **is** set, so nothing is owed and no todo appears.

**Reproduced** — the real `BuildVM` driven through `setSlotFeat`, fighter 4, one feat slot, two
half-feats with disjoint option sets:

```
after picking Wide — options    ["int","cha"]
chosen ability                  "int"
boost while on Wide             {"int":1}
after swap — options            ["str","dex"]
after swap — ability still      "int"      <- kept from the previous feat
after swap — boost applied      {}         <- the +1 is gone
todos                           [{kind:"background"},{kind:"abilities",key:"abilityPoints"}]
```

Neither todo is about the slot — both are leftovers of the minimal probe draft. So the character
quietly loses an ability point, the feat row shows a half-feat with an ability that is not one of its
options, and nothing anywhere says so.

**Reachable on shipped 2024 content.** `featOptionsFor` (`feat-slots.svelte.ts:59`) gates epic boons
on `level >= EPIC_BOON_MIN_LEVEL` and offers general feats at every level, so a level-19+ slot lists
both. The seven `boon_of_*` rows carry `ability_choice = any` (all six abilities) and `grappler`
carries `str,dex` — verified by parsing `srd-2024/feats_srd.csv` with the repo's own papaparse: 17
rows, 0 errors, 8 rows with a non-empty `ability_choice`. Pick a boon, take the +1 in CHA, swap that
slot to Grappler, and CHA is neither offered nor applied nor mentioned. The probe above used
synthetic feats only to isolate the mechanism from the level-19 setup.

**Fix:** mirror the line below it — replace `??=` with an assignment that re-validates:
`featAb[key] = this.halfFeatOptionsFor(key).includes(featAb[key]) ? featAb[key] : first;`. That keeps
a choice the new feat still offers (swapping between two `any` boons should not reset it) and drops
one it does not.

This also settles the first pass's SUSPECTED "stale `slotFeatAbility[ORIGIN_SLOT_KEY]` across a
background swap": the origin variant is the same bug reached through a different door, and it is the
homebrew-only half, since no SRD background grants a half-feat origin feat. The slot variant above is
the shipped-content half, and one fix covers both.

### 51 · [x] MEDIUM-HIGH · the effective HP max has two callers and four hand-rolled copies, and one of them decides a rules guard

Findings 4 and 40 each name a site that recomputes the effective HP max by hand. They are not two
bugs; they are two of four. An exhaustive grep settles the shape of it:

| site | what it feeds | uses `effectiveHpMax`? |
| --- | --- | --- |
| `hit-points.svelte.ts:68` | the heal/damage clamp | **yes** |
| `hit-points.svelte.ts:294` | the bar's denominator | **yes** |
| `resource-tracker.svelte.ts:241` | what a long rest restores to | no — finding 4 |
| `HpPanel.svelte:34` | the "current / max" readout | no — finding 4, display half |
| `derive-plugins.ts:53` | the plugin ctx's `hpMax` and `isBloodied` | no — finding 40 |
| `derive-context.ts:89` | **the L2 variable `is_bloodied`** (`:98`) | no — the one not yet named |

`combat/defense.ts:43` is the single function that knows the rule, and A14 is the change that
established it: "a manual max no longer silences `hp_max` effects — they re-fold on top of it". Two
of six sites got the memo.

The fourth row is the one that makes this worse than a display inconsistency. `derive-context.ts:89`
is `hpMaxLive()`, and `:98` builds the **effect-guard variable** `is_bloodied` out of it. So a
character with a manual HP max and an `hp_max` effect in play crosses the bloodied threshold at a
different number for the rules than for the bar beside them: every shipped `is_bloodied ? …` token —
and both packs ship them — evaluates against a maximum the rest of the app does not use.

**Fix:** the same one-line change at all four sites, since `effectiveHpMax` already takes exactly
what each of them has in hand — a nullable manual max and the sheet's `Computed`. Fixing them
together is what keeps the count from drifting back to five sites and three answers; fixing them one
finding at a time is how it got here.

### 52 · [x] MEDIUM · the click-only resource pip has a second home, which finding 27 does not name

`EffectsPanel.svelte:208` is the same `<span class="resource-pip" role="button" tabindex="-1">` with
an `onclick` and no keyboard handler, under the same `a11y_click_events_have_key_events`
suppression, as `CombatStrip.svelte:116`. Finding 27 names only the strip.

This is the shape AGENTS.md warns about under Hit every surface — "a change that works on the path
you tested and is missing everywhere else". Whoever fixes 27 by giving the strip's pip row a roving
tabindex will leave this one behind unless both are on the list.

**Evidence** — a brace-aware census of every `tabindex="-1"` element in `src/`, resolving each
element's real extent so arrow-function bodies do not truncate the tag, gives ten
`role="button"`-or-click-without-key sites in total:

| site | status |
| --- | --- |
| `EntryList.svelte:50` | finding 23 |
| `CombatStrip.svelte:116` | finding 27 |
| `EffectsPanel.svelte:231` | finding 25 |
| `EffectsPanel.svelte:208` | **this finding — not previously named** |
| `SpellsPanel.svelte:90`, `:112` | finding 26 |
| `Turnbar.svelte:53` | documented exception — its comment names the pill-based keyboard fallback |
| `RollerLine.svelte:275` | correct by design — see below |
| `RollerLine.svelte:399` | correct by design — see below |
| `PanelCard.svelte:65` | **finding 53** |

So the census is now closed: every unfocusable clickable in the app is either a named finding, a
documented exception, or explained above. That is the useful half of this entry — the next reader
does not need to re-run it.

**Fix:** whatever fixes 27, applied here in the same change.

### 53 · [ ] LOW-MEDIUM · panel reordering is pointer-only, and its handle claims to be a button

`PanelCard.svelte:62` — `<span class="drag-handle" role="button" tabindex="-1"
aria-label={…dragToReorder} onpointerdown={…}>`. The only handler is `onpointerdown`. There is no
keydown, the element is out of the tab order, and no other control anywhere reorders the combat
panels.

Two separate problems in one element. The `role="button"` is a promise the element does not keep:
assistive technology announces a button, and pressing it does nothing, because nothing listens for a
key. And the capability itself — arranging your own combat screen — has no keyboard path at all,
which is AGENTS.md ▸ Reverse states applied to an affordance rather than to state: the layout can be
changed only with a pointer, and a keyboard user cannot get back to a layout they did not choose.

Recorded with the caveat the repo itself sets: a drag is explicitly the maintainers' to confirm in
the running app, so the *drag* is not what is claimed here. What is claimed is the missing keyboard
alternative and the mislabelled role, both readable from the source.

**Fix, smallest:** make the handle a real `<button>` in the tab order and give it the keyboard
equivalent the pattern already implies — `ArrowUp`/`ArrowDown` (by `e.code`) moving the card one
place, which is the same reorder the pointer performs. If reordering is meant to stay pointer-only,
the honest version is to drop `role="button"` and mark the handle `aria-hidden`, so nothing announces
an action that is not there.

### 54 · [ ] MEDIUM · the "no exceptions" language-switch rule has five exceptions, and a modal is where it matters most

`docs/internals/ui.md:305`: "**Every full-screen dialog, modal, or banner carries `LangSwitcher` in
its top-right corner. No exceptions.**"

`DialogShell.svelte` bakes it in, so everything built on the shell complies. Five attention dialogs
are built by hand instead, and none of them carries it:

| component | `LangSwitcher` | via `DialogShell` |
| --- | --- | --- |
| `MobileWarning.svelte` | yes | — |
| `FirstRunModal.svelte` | yes | — |
| `settings/PluginConsentDialog.svelte` | yes | — |
| `combat/blocks/DeathScreen.svelte` | — | yes |
| **`ConfirmDialog.svelte`** | **no** | **no** |
| **`OrphanDialog.svelte`** | **no** | **no** |
| **`SchemaDiscardDialog.svelte`** | **no** | **no** |
| **`settings/DataMigrationDialog.svelte`** | **no** | **no** |
| **`settings/DataConflictDialog.svelte`** | **no** | **no** |

All five are genuine modals, not inline panels — `ConfirmDialog.svelte:29` and
`OrphanDialog.svelte:149` each render a `.dialog-backdrop` above a
`role="dialog" aria-modal="true"` card, and each backdrop's `onclick` dismisses. So while one is
open the topbar's switcher is not merely covered, it is a dismiss target: reaching for it cancels the
dialog.

That is what makes the rule a rule rather than a decoration, and these five are the worst places to
miss it. Their whole job is to ask for a decision that cannot be taken back — a destructive confirm,
a schema discard, a data-folder migration, a conflict resolution. A reader who cannot follow the
sentence has no way to change the language without first dismissing the question.

The five also share a lineage: each names the same house template in its header comment
("the house attention-dialog template, `charnik-dialog-design-template`"), so they were written
against the visual spec and the `LangSwitcher` clause was missed by all of them equally — the sign
of a template that carries the look without carrying the contract.

**Fix:** the shell already solves it. Either move these five onto `DialogShell`, or — if their
bespoke layouts are the point — put the switcher in the shared `.dialog-head` markup they all use,
so the template carries the contract that its comment claims.

### `$effect` write-back cycles — checked, none

Queue item 7's first line, closed. All 36 `$effect` sites in `src/` were enumerated with a
brace-matching scan and their bodies read for writes to reactive state. Five write at all:

| site | writes | verdict |
| --- | --- | --- |
| `+layout.svelte:114` | `el.dataset.theme`, `el.lang`, `el.dir` | DOM properties, not reactive state — cannot re-trigger |
| `build/+page.svelte:42` | `ui.fullBleed = true`, cleanup sets it false | reads nothing reactive; its own comment cites the way-in/way-out rule |
| `compendium/[...entry]/+page.svelte:268` | `ui.fullBleed`, same shape | same |
| `combat/CombatMenus.svelte:72` | `combat.overlay = null` | written inside a pointer listener, not on the reactive read path; the write makes the effect's own `if (!overlay) return` guard fire, so it settles in one step |
| `combat/menus/DiceTray.svelte:27` | `diceTray.candidates` | reads `content.graph`, the character's effects and `app.activeLocale`, none of which it writes — and re-deriving on a locale switch is the point, since the menu shows names in the UI language |

No effect writes into anything it reads. Nothing to fix, and recorded so the 35-site list is not
walked again.

### 55 · [x] HIGH · a bare ability check is the one d20 roll no effect reaches, and its own sibling six lines away does it right

The first pass listed this as suspected, unable to say whether an unmodelled bare ability check was
deliberate. It is not. The two controls sit on the same tile in the same component:

`Abilities.svelte:38` — the **check** button:

```svelte
roll({ text: `${ab.toUpperCase()} check`, key: `combat.roll.check.${ab}` }, a.mod, e)
```

`Abilities.svelte:52` — the **save** button, six lines below:

```svelte
roll({ text: `${ab.toUpperCase()} save`, key: `combat.roll.save.${ab}` }, a.save.value, e,
     `save.${ab}`)
```

The save passes a `RollTarget` and the check passes nothing. The `key` each carries is an **i18n
catalog key for the label**, not a roll target — the fourth argument is the target, and only one of
them has it. The modifiers match that split: `a.save.value` is the folded `Computed`, `a.mod` is the
raw `abilityModifier` (`derive-stats.ts:161`), never folded.

A complete census of every `roll({…})` entry point in the app — there are five — shows how lopsided
this is:

| site | rolls | target passed |
| --- | --- | --- |
| `Abilities.svelte:52` | a saving throw | `save.<ab>` ✓ |
| `SkillsPanel.svelte:42` | a skill check | `skill.<id>` ✓ |
| `Abilities.svelte:38` | a bare ability check | **none** |
| `combat-view-model.svelte.ts:468` | Hide, Search, Study, Grapple, Shove | **none** — finding 2 |
| `CombatStrip.svelte:51` | "AC (touch)", a raw d20 | none — no effect target would apply |

**The second half: even passing a key would not help today.** `effects/facts.ts:15` fans a group
target out to exact prefixes only:

```ts
if (effTarget === 'saves'  && key.startsWith('save'))  return true;
if ((effTarget === 'skills' || effTarget === 'ability_checks') && key.startsWith('skill')) return true;
if (effTarget === 'd20_tests' && (key.startsWith('save') || key.startsWith('skill')
    || key === 'attack' || key === 'initiative')) return true;
```

There is no `check.*` or `ability.*` case, so a bare ability check matches nothing under any group.

**What that costs, in both editions, with shipped content.** 2014 exhaustion level 1 is
`disadvantage:ability_checks`, and `ability_checks` fans out to `skill.*` — so a level-1-exhausted
character rolls Athletics at disadvantage and a bare STR check straight. 2024 exhaustion is
`flat_bonus:d20_tests-2*exhaustion`, which the docstring above calls "every d20-based roll" — and it
reaches the save and the skill and not the check on the same tile. The first pass measured exactly
that at exhaustion 2: STR save **−2**, Athletics **−4**, STR check tile **0**.

The comment at `facts.ts:12` is what made this look deliberate — "`skills`/`ability_checks`→`skill.*`
(the ability checks the sheet models)". That parenthetical was true when skills were the only ability
check on screen. The sheet now renders a button that rolls a bare one, so the comment describes the
fan-out rather than justifying it.

**Fix, two lines in two files:** pass `` `check.${ab}` `` as the fourth argument at
`Abilities.svelte:38` and fold `a.mod` the way `a.save.value` is folded; then add `check` to the
`ability_checks` and `d20_tests` fan-outs in `matchesTarget`, and correct the parenthetical in the
docstring above it. Both editions' exhaustion then lands on all three rolls instead of two.
## Second pass — the roller remainder

`dice-tray.svelte.ts`, `roller.ts`, `RollerLine.svelte`, and the damage seam at `combat/roll.ts`.
The items *What was not reached* left open: the caret state machine, `movePill` across lines,
`setDamage`'s `real` filter, `savageReroll`'s tie case and the two-column type picker.

### 56 · [x] MEDIUM · taking a pill out parks the caret one token short of the end, and the next thing typed lands mid-line

`dice-tray.svelte.ts:434` — `removePill` compensates the caret with
`if (pillIndex < this.caretAt(index)) this.setCaret(index, this.caretAt(index) - 1)`, and `caretAt`
(`:392`) CLAMPS the `AT_END` sentinel down to the line's length. Read *after* the pill is gone, a
caret nobody has ever moved therefore reports "in front of the last pill", the guard fires, and
`AT_END` is materialised one place further left. The sentinel exists precisely so a caret parked at
the end STAYS there through every edit (`:96`); this is the one writer that reads it through the
clamp instead of testing the stored value.

**Reproduced** — type `1d20 +3 +5`, take out the first pill with its `×` (or with Delete on the
focused pill, `RollerLine.svelte:241` — both reach the same method), then type the next token:

```
before removal   pills ["1d20","+3","+5"]   caret 3 (end)
after  removal   pills ["+3","+5"]          caret 1   <- not 2
type "+9"        pills ["+3","+9","+5"]
```

It is not only order. `addToken` lands a bound on the last die LEFT of the caret, so the same
sequence turns a Reliable Talent floor into an unaccounted fragment that blocks the roll:

```
type "1d6 1d20"  pills ["1d6","1d20"]   caret 2
remove "1d6"     pills ["1d20"]         caret 0
type ">10"       pills ["raw:>10","dice:1d20"]
issues           [{"key":"roller.issue.unaccounted","values":{"text":">10"},"blocking":true}]
rollable         false
control (no removal): "1d20 >10" -> ["dice:1d20 >10"]
```

Removing the LAST pill is safe — the guard's `<` is false there — which is why the case survives the
tray's own suite.

**Fix:** test the stored caret, not the clamped one: read `this.carets[index]` raw and skip the
adjustment when it is `AT_END`.

### 57 · [x] LOW · a pill dragged across lines keeps no caret, and a damage type may be dropped on a d20 line

`dice-tray.svelte.ts:458` — `movePill` rewrites both lines and touches `carets` in neither, which is
the opposite of the sibling thirty lines above it (finding 56's guard). It also takes any pill to any
line: `vocabularyFor` (`:136`) withholds damage-type rows from a test line, and the doc states the
consequence — "because the same list backs the resolver — typing the name in full can't get past
what the menu withheld". Drag-and-drop (`RollerLine.svelte:253`) goes through neither.

**Reproduced** — a `fire` pill dragged from the damage line onto the test line:

```
damage line before  ["dice:2d6","damageType:fire"]
test line after     ["damageType:fire"]
testRoll(test)      {"dice":{},"mod":0,"bonusDice":[],"mods":{},"advantage":0}
issues              [{"key":"roller.issue.untypedDamage","blocking":false}]   <- for the line it LEFT
```

The type sits on the d20 line as a real pill, contributes nothing to `testRoll`, and is reported by
nothing; the damage line it left now warns that its damage is untyped. Both halves are what the
player asked for with the mouse, and neither is a state the model admits from the keyboard.

**Fix:** `movePill` already has both roles in hand — refuse a `damageType` pill onto a `test` line,
and carry the caret the way `removePill` means to.

### 58 · [x] LOW · a damage part made only of effect dice is not damage at all

`combat/roll.ts:50` — `dealsDamage` is `Object.keys(p.dice).length > 0 || p.mod !== 0`, and
`dice-tray.svelte.ts:551`'s `real` filter repeats the same predicate verbatim. Neither counts
`bonusDice`, which is the field that carries an effect's damage DICE. The comment governing the call
site (`sheet-rolls.svelte.ts:260`) states the intent the pair misses: "asked AFTER the effects fold
in, so a flat damage effect on a damage-less weapon still counts" — a flat one does, a dice one does
not.

**Reproduced** — the tray handed one part, dice-less and modifier-less, carrying a `+1d6` effect die:

```
prefill damage [{dice:{}, mod:0, type:"bludgeoning", bonusDice:[1d6 "Divine Favor"]}]
lines -> [["test",["1d20","+5"]]]                    <- no damage line at all
control, the same part with mod 1:
lines -> [["test",["1d20","+5"]],["damage",["+1d6","+1","bludgeoning"]]]
```

Reachable wherever the weapon's own damage folds to zero: an Unarmed Strike at Strength 8
(`attacks.ts:426` gives it `mod: 1 + strMod`), or a Net (`attacks.ts:396` gives a damage-less weapon
a part carrying the ability modifier alone) at ability modifier 0. No shipped row grants damage
DICE — every `flat_bonus:damage` in both packs is `+1`, `+2` or `+3` — so this is homebrew- and
plugin-reachable rather than wrong today, the same footing as finding 9.

**Fix:** one clause in `dealsDamage`, which `real` should then call rather than restate.

### 59 · [x] LOW-MEDIUM · the gate `AGENTS.md` prescribes cannot see a type error, and one reached `main`

`AGENTS.md` ▸ "Run the whole gate before committing" names `pnpm test && pnpm lint && pnpm build` and
says a subset is a false green. None of the three runs a type-checker: `test` is `vitest run` (oxc
transpile, no checking), `build` is `vite build` — the same file says it "type-checks *nothing*" —
and `lint` is prettier, eslint, stylelint, knip, jscpd and madge. `svelte-check` lives only in
`pnpm check`, which the gate omits, and the pre-commit hook runs surface, prettier and eslint.

**Reproduced** by the repository itself: `combat.test.ts:2020` wrote
`character.play.death = { cause: 'death_saves', round: 1 }` while `playSchema.death` is `{ cause }`
alone (`character/schema.ts:186`). An excess property, rejected by `svelte-check`, invisible to every
gate above, and on `main` from the commit that added it until this pass ran `pnpm check`.

**Fix:** put `pnpm check` in the gate. It is the only one of the five that reads types, and the
sentence about a subset being a false green is what leaving it out costs.

### Suspected, not reproduced — the roller remainder

- **Blur takes the highlighted suggestion rather than the text that was typed.**
  `RollerLine.svelte:207`'s `onblur` calls `commit(index)`, and `commit` prefers
  `this.menu[this.highlight]` whenever the line is the focused one. Tab, Enter and a click on a row
  are documented as one act (§6); leaving the field is a fourth path into the same branch, so typing
  `bl` and then clicking a die button in the header inserts Bless. Unmeasured: whether the ghost
  makes that legible enough to be the intent — the comment at `:202` argues it is.
- **`savageReroll` spends the use on a tie.** `sheet-rolls.svelte.ts:319` keeps the original when the
  two sums are equal (`>`), then still records an amendment reading `from: n, to: n` and burns the
  once-per-turn use. Correct RAW — the feature was used — but the log line says nothing happened.
- **`setDamage`'s replace branch is unreachable.** `:562` handles an existing damage line, and its
  only caller is `prefill` (`:530`), which has just `reset()` the lines. The comment above it
  describes an attack arriving "in two calls" that `grep -rn setDamage src/` says no longer exist.

### Checked and correct — the roller remainder

- **The two-column type picker is consistent end to end.** `TYPE_COLUMNS = 2` and
  `typeRows = ceil(menu.length / 2)` (`RollerLine.svelte:42`) feed both `--type-rows`
  (`grid-template-rows: repeat(var(--type-rows), auto)` under `grid-auto-flow: column`, `:722`) and
  the `selectAcross(±typeRows)` stride, so the arrow keys and the drawn columns are one arithmetic.
  An odd row count leaves the second column one short and `selectAcross`'s clamp handles it;
  `menu.length === 0` cannot reach the `repeat(0, …)` that would drop the declaration, because
  `menuOpen` requires a non-empty menu.
- **`savageReroll`'s weapon/effect split is right.** `weaponOnly` drops `bonusDice` and the flat
  modifier and keeps `mods` and `crit`, both candidates are re-totalled through the same `partWith`,
  and the effect dice keep the faces they rolled. The one hole is its own `ponytail:` comment — a
  crit twin of an effect die counts with the weapon's dice — and it is marked.
- **`caretLeft` / `caretRight` are sound.** Both read the caret BEFORE folding the draft, both step
  over inherited type pills, and both answer whether they actually moved; `commitText` advances the
  caret by however many pills a compound token became, so `2d6+3` cannot leave the caret inside
  itself.
- **The volley identity holds.** `roll()` stamps `at + i`, so the entries of one volley never share
  the timestamp an amendment matches on — finding 10's fix, verified at this seam.
- **The tray has no locale of its own, as designed.** An unnamed roll carries `roller.customRoll` as
  its key and the literal `'Custom roll'` only as `sayRollName`'s no-translator fallback, and the
  prefill's `labelKey` rides through `roll()` untouched — so the log says the roll's name in the
  language it is being READ in, not the one it was rolled in.

## Second pass — play and combat, the remainder

`src/routes/combat/inventory.svelte.ts`, `spell-casting.svelte.ts`, `roll-journal.svelte.ts`,
`effects-editor.svelte.ts`, `resource-tracker.svelte.ts`, `turn-economy.svelte.ts`,
`CombatMenus.svelte`, `blocks/` and every `blocks/panels/*` except HP and Attacks;
`src/lib/combat/spells.ts`, `effects-view.ts`, `actions.ts`, `defense.ts`, `constants.ts`.
Eleven confirmed, each reproduced against the real packs or read out of the markup. A twelfth —
`logMarker` never persisting a no-roll cast — is finding 14, reproduced a second time here with a
spy `persist`: in-session log 2, persisted 1.
### 60 · [x] MEDIUM-HIGH · an item that requires attunement grants its benefits while merely equipped

`src/lib/character/derive-gather.ts:62` — `if (inv.equipped || inv.attuned)` pushes an item's tokens
on either flag, so the `attunement` tag is never a gate. RAW, both editions: a magic item that
requires attunement confers no benefit until attuned. `needsAttunement` exists
(`character/inventory.ts:35`) and has exactly one consumer — `inventory.svelte.ts:97`, which uses it
to decide whether to draw the Attune button. Nothing reads it as a rule.

It bites only on `armor` / `shield` / `weapon`, which are the categories `isEquippable` covers;
21 shipped rows in `srd-2014` and 27 in `srd-2024` carry `attunement`, an effects cell and one of
those categories.

**Reproduced** — real packs, one item, `equipped: true, attuned: false`:

```
srd-2024 armor_of_invulnerability   equipped only -> resist ["bludgeoning","piercing","slashing"]
srd-2024 armor_of_invulnerability   carried only  -> resist []
srd-2014 demon_armor                equipped only -> AC 19
   trace: Armor +18 · DEX (heavy: ignored) +0 · Demon Armor +1  (flat_bonus:ac+1)
srd-2014 control, no armor          -> AC 10
```

**Fix:** one clause in the gather — `inv.attuned || (inv.equipped && !needsAttunement(item))`,
resolving the row through `resolveItem` as the panel already does, so the tag it reads is the
merged one.

### 61 · [x] MEDIUM-HIGH · the combat spell row's prepare toggle finds the entry by bare id, and flips the wrong spell

`spell-casting.svelte.ts:548` — `const idOf = (ref: string) => ref.split(':').pop();` then
`build.spells.find((s) => idOf(s.spell) === r.id)`. `r.id` is the row's **bare** id, so two spells
sharing an id across sources are indistinguishable and the FIRST entry always wins. The comment two
lines below claims the gate is "the ONE shared seam … identical in the spellbook, D13" — the
spellbook keys its entry map by `row.effectiveId` (`routes/spellbook/+page.svelte:77`,
`togglePrepare(id)` at `:103`), which is the identity AGENTS.md ▸ glossary defines
(`type:source:id`, "so the same `id` from two sources coexists").

**Reproduced** — a two-row fixture, same id, two sources, both prepared; tap the prep dot on
**Fireball B**:

```
before: [{Pack A fireball, prepared:true}, {Pack B fireball, prepared:true}]
after : [{Pack A fireball, prepared:false}, {Pack B fireball, prepared:true}]
```

The spell the player did not touch is the one that un-prepares, and the one they tapped keeps its
dot lit — so the gesture reads as a no-op and the second tap un-prepares nothing again.

**Fix:** `build.spells.find((s) => s.spell === r.ref)`. `SpellRow.ref` is already the effectiveId
and is already what `hidden` filters on (`spells.ts:282`).

### 62 · [x] MEDIUM · a magic item weighs nothing, and the load meter is the one place capacity is shown

`inventory.svelte.ts:91` (`weightLb`) and `:139` (`carriedLb`) both read
`row.data.weight_lb` off the item's OWN row. `resolveItem` (`content/resolved-item.ts:57`) merges
the base row's **tags** and **damage** underneath a magic row — "a +1 longsword IS a longsword" —
and does not merge `weight_lb`. Every shipped row that names a `base_item_id` leaves its own weight
blank: 24 of 24 in `srd-2014`, 21 of 21 in `srd-2024`. A template answered through the row's own
base picker (`setBase`) is the same story.

**Reproduced** — srd-2024, three rows carried:

| row | `weightLb` | `meta` (inherits) |
| --- | --- | --- |
| Dagger | 1 | `weapon · 1d4 piercing` |
| Dagger of Venom (base `dagger`, 1 lb) | **0** | `weapon · 1d4 piercing` |
| Defender, base set to Longsword (3 lb) | **0** | `weapon · 1d8 slashing` |

```
carriedLb = 1        <- the mundane dagger, and nothing else
carriedLb after picking the Defender's base = 1
```

So the damage line inherits and the weight does not, on the same row, from the same call.

**Fix:** have `resolveItem` carry the resolved weight the way it already carries `damage`
(`weightLb: row.data.weight_lb ?? base.data.weight_lb`), and read it from the `ResolvedItem` at both
inventory sites — which also fixes the build sheet's own reduce (`SheetInventory.svelte:16`).

### 63 · [x] MEDIUM · the combat sheet prints content names in English, beside two of its own panels that translate them

`src/lib/combat/spells.ts:365` (`name: d.name_en`) and `inventory.svelte.ts:89`
(`rowName(item.row)`, which is `name_en ?? id` — `content/loader.ts:80`). `localizedName`
(`content/detail.ts:102`) is documented as "the one localized-name reader (AUDIT F9)", and the
Attacks panel and the Features panel use it (`combat/attacks.ts:404`, `FeaturesPanel.svelte:47`).
The same divergence runs through `combat-view-model.svelte.ts:375` (class line), `:381` (species),
`:389` (the concentration indicator's spell), `:458` (the level-up menu) and
`effects-editor.svelte.ts:38` / `:95` (the condition list and the "+" effect catalog).

**Reproduced** — one fixture row carrying `name_uk`, one character carrying that item and that
spell:

```
SPELL panel row name        = Bless        <- name_en
localizedName(spell, 'uk')  = Благословення
INVENTORY panel row name    = Dagger       <- rowName -> name_en
ATTACKS panel row name      = Кинджал      <- localizedName(row, locale)
```

The same dagger is two different words on one screen. The shipped SRD carries no `name_uk`, so
today this only shows on a translated or homebrew pack — which the in-app `/translate` view writes
into exactly these columns.

**Fix:** `localizedName(row, locale)` at each of the eight sites; `spellRow` and `InventoryTracker`
need the locale threaded in the way `computeAttacks` already takes it.

### 64 · [x] MEDIUM · the add-effect menu has a search box that searches nothing

`CombatMenus.svelte:117` — `<input placeholder={$_('combat.menu.searchEffects')} />` with no
`bind:value`, no `oninput`, and no consumer. The list under it is
`combat.effects.effectCatalog` (`effects-editor.svelte.ts:87`), a straight `graph.list('effect')`
map with no filter anywhere in either file. The catalog is user-extendable content, so the box is
the only way this list would ever be navigable at size, and it is a control that looks live and is
not — the dead-end shape `ui.md` rule 10 exists to forbid.

**Reproduced** by reading the two files: the only `$state` the menu owns for this overlay is
`combat.effects.newEffectDuration`; `grep -n "search" src/routes/combat/CombatMenus.svelte
src/routes/combat/effects-editor.svelte.ts` returns the placeholder and the icon and nothing else.

**Fix:** a local `let effectQuery = $state('')` bound to the input and a
`.filter((p) => p.label.toLowerCase().includes(effectQuery.trim().toLowerCase()))` on the `{#each}`
— or delete the input, because an inert one is worse than none.

### 65 · [x] MEDIUM · a condition is switched on with the app's own Switch and cannot be switched off with it

`CombatMenus.svelte:404` — `onclick={() => added ? null : addEffect({…})}`, under a row whose right
edge is `<span class="toggle-track" class:on={added}>` (`:413`). `.toggle-track` is the class the
shared `Switch` component renders (`components/Switch.svelte:12`, `styles/components.css:600`), so
`ui.md` rule 1 — "State on or off is a toggle `Switch` (teal when on)" — is being *used*, and then
half of it is refused: clicking a lit row does literally nothing, with no notice.

The way out exists, in a different panel (`EffectsPanel.svelte`'s ✕), which is exactly the split
AGENTS.md ▸ Hit every surface ▸ Reverse states names: "If you added a way in, add the way out and
the way to see it. A one-way door is a bug."

**Reproduced** from the markup: the ternary's true branch is `null`. The row is a `<button>`, so it
takes hover and focus and Enter, and every one of them is silent.

**Fix:** `added ? combat.effects.removeEffect(iidOfCondition) : addEffect(…)`, matching on the
`apply_condition:<id>` token (`conditionIdOf`, `effects-view.ts:262`) rather than on the label — see
the label-matching note under *Suspected* below.

### 66 · [x] MEDIUM-LOW · the carrying-capacity readout carries no provenance, and the 5e encumbrance tiers live only there

`blocks/panels/InventoryPanel.svelte:20` prints `carried / capacity` as plain text.
`ui.md` rule 3 lists the values that must carry a provenance popover and names **carrying capacity**
among them. The builder's own load block does it (`build/blocks/SheetInventory.svelte:83`,
`use:provenance={why(s.carryingCapacity, $_)}`); the play sheet — the surface a player actually
loads up on — does not.

The cost is not only the breakdown. `rules/core.ts:310` puts the **5e-only encumbrance tiers**
(`Encumbered at STR×5 (−10 ft)`, `Heavily encumbered at STR×10 (−20 ft)`) into
`carryingCapacity`'s `notes`, and `why()` is what renders notes. So on a 2014 character the two
thresholds that actually change their speed are computed, attached, and unreachable from the combat
sheet; the panel's only load feedback is `overCapacity`, which is the 5.5e rule.

**Reproduced** by reading the markup — the `<span class="load-figure">` has no `use:provenance`, and
`grep -n provenance src/routes/combat/blocks/panels/InventoryPanel.svelte` is empty while every
other combat panel has one.

**Fix:** `use:provenance={why(s.carryingCapacity, $_)}` on the figure. The panel already takes
nothing but `combat`, so it needs the sheet threaded in the way `SkillsPanel` and `SpellsPanel`
take it.

### 67 · [x] MEDIUM-LOW · the effect-duration menu is a dialog Escape cannot close

`blocks/EffectDurationMenu.svelte:84` — `role="dialog"` with `place()`, a scroll follower and a
`pointerdown`-outside closer, and no key handling at all. Its sibling, the combat overlay it opens
on top of, uses `use:dismissOnEscape` (`CombatMenus.svelte:103`), and
`actions/dismissOnEscape.ts:4` calls itself "the one home for the `<svelte:window onkeydown>` +
Escape-check every attention dialog hand-wrote".

The way IN is fully keyboard-reachable — `.duration-select` is a real `<button>`
(`EffectsPanel.svelte:99`) — so a keyboard user can open a dialog they can only leave with a mouse.

**Reproduced** from the markup: the only listeners the component registers are `scroll`, `resize`
and `pointerdown`; there is no `onkeydown`, no `svelte:window`, and no `dismissOnEscape` import.

**Fix:** `use:dismissOnEscape={onclose}` on the `.dur-menu` div.

### 68 · [x] LOW-MEDIUM · a spell pin is stored by bare id, so it pins every same-id spell

`combat-view-model.svelte.ts:253` (`togglePin(id)`) writes `ui.spellsPinned` from `r.id`, and `:250`
reads it back as a bare-id map that `SpellsPanel.svelte:88` indexes with `pinned[r.id]`. The eye in
the same panel filters on the full ref (`spells.ts:282`, `hidden.includes(x.row.ref)`), so two
controls one row apart disagree about what a spell IS.

**Reproduced** — two `fireball` rows from two sources, `togglePin('fireball')` once:

```
ui.spellsPinned    = ["fireball"]
pinned group rows  = ["Fireball A","Fireball B"]      <- one click, two pins
after hiding B by ref: ["pinned/Fireball A","3/Fireball A"]   <- the eye is per-ref
```

The pinned ids also land on disk in `ui.spellsPinned`, so the ambiguity outlives the session.

**Fix:** store and index the ref, as `spellsHidden` does.

### 69 · [x] LOW · the combat page hands the loading screen two English literals

`routes/combat/+page.svelte:32` —
`content.graph ? 'Computing your character sheet…' : 'Loading content…'`, passed to `<Loading
message={…}>` at `:110`. Every other route passes a key: `$_('compendium.loading')`,
`$_('spellbook.loading')`, and `build/+page.svelte` passes nothing at all and takes the component's
own English default (`components/Loading.svelte:8`, `'Crunching the numbers…'`). The `loading.*`
namespace already exists with four keys, and the `loading.patience` line renders translated directly
underneath these two.

Finding 28 states there are **two** literal English user-facing strings in `.svelte` across the
repo; these are two more, and the component default is a third.

**Reproduced** by rendering the branch mentally against the catalog:
`grep -n '"loading' src/lib/i18n/locales/en.json` yields `failedBody`, `failedReport`,
`failedTitle`, `patience` — no message key exists for either sentence.

**Fix:** two keys (`loading.sheet`, `loading.content`), and give `Loading`'s `message` prop a
key-based default instead of an English one.

### 70 · [x] LOW · the pin-skills menu title-cases skill ids while the skills panel translates them

`CombatMenus.svelte:305` — `<span class="skill-name">{titleCase(skill)}</span>`.
`SkillsPanel.svelte:55` prints the same eighteen ids as
`$_('skillName.' + skill, { default: titleCase(skill) })`, and `CombatStrip.svelte` does the same
for the passive row. The view-model even says so at `combat-view-model.svelte.ts:434`: "the KEY
only — the word for a skill is `skillName.<id>`, and a view-model has no locale to spend on it".

`titleCase('animal_handling')` also produces `Animal_handling` rather than `Animal Handling` —
`util/format.ts`'s `titleCase` upper-cases the first letter of each word, and the ids are
snake-case (`constants.ts:37` records the snake-case migration).

**Reproduced** by reading the two components against `en.json`, which carries all eighteen
`skillName.*` keys.

**Fix:** `$_(\`skillName.${skill}\`)`, the same call one file over.

### Suspected, not reproduced — play and combat

- **The Resources section names a pool twice, two different ways.** `EffectsPanel.svelte:189`
  prints `r.name` from `parseResourceEffect` (`effects-view.ts:288`), which is `eff.label` — the
  runtime effect's label. Every notice about the same pool uses
  `ResourceTracker.resourceName` (`resource-tracker.svelte.ts:42`), which is the `resource`
  content row's name per RES-NAME (`character/resource-names.ts`). Not reproduced because no
  shipped `effects_srd.csv` row in either pack carries a `grant_resource` token, so the section is
  reachable only through user content. The probe: a homebrew `effects.csv` row granting an id that
  also has a `resources.csv` row, then compare the row header with the toast the click raises.
- **The condition menu matches "already applied" on the LABEL.** `CombatMenus.svelte:401` —
  `play.effects.some((e) => e.label === cn.label)`. A custom modifier the player names "Poisoned"
  would light the Poisoned row's switch and block the real condition. `conditionIdOf`
  (`effects-view.ts:262`) is the id-based predicate that already exists. Probe: add a custom effect
  labelled after a condition, then open the condition menu.
- **Movement is the one distance printed without metric.** `Turnbar.svelte:74` prints
  `{moveLeft} / {moveMax}` + a `feet` label; `CombatStrip.svelte:78` prints
  `{s.speed.value} ft ({metres(...)})` for the same number, and `metres()` is a shared helper. Same
  for the per-row item weight (`InventoryPanel.svelte:65`, `combat.inventory.pounds`) beside the
  total, which does carry `kilograms()`. `ui.md` rule 6 is unconditional; the Turnbar's own comment
  explains dropping *the unit word* at narrow widths, not the conversion, so this may be a
  deliberate density call. Needs a maintainer ruling rather than a probe.
- **`effectHint` reads English spell NAMES and returns untranslated English.** `spells.ts:93` —
  `/mage hand|prestidig|light|message|minor illusion|mage armor|fly|invis|mirror/i.test(name)` over
  `d.name_en`, returning `'utility'`, `'teleport'`, `'negate spell'`, `'set AC 13'`, `'fly 60 ft'`,
  `'3 duplicates'`. These are the `summary` column of every non-damage spell row on the panel. It is
  not prose-mining (the name is a declared column), but it is a hardcoded English lookup that a
  translated or homebrew row cannot match, and its output reaches the user untranslated.
  `'fly 60 ft'` also violates rule 6. Probe: render the panel at `uk` with a row named
  `name_uk = "Політ"`.
- **Removing a resource-granting effect leaves its spend count behind.**
  `effects-editor.svelte.ts:138` filters `play.effects` and never touches
  `play.resourcesSpent[id]`. `resourceSpent` clamps to a max of 0 for a pool nothing grants
  (`resource-tracker.svelte.ts:49`), so it is invisible — until the same id is granted again, when
  the stale spend reappears. Probe: grant, spend, remove, re-grant.
- **A ritual cast still spends the turn slot.** `spell-casting.svelte.ts:527` charges
  `ctSlot(r.castTimeIcon)` before it knows the cast was a ritual; RAW a ritual takes ten minutes
  longer and is not the spell's own casting time. Reachable only in combat, where nobody rituals.
- **`CombatStrip.svelte:49`'s "AC (touch)" row rolls a bare d20 with no `RollTarget`** — the same
  omission as findings 2 and 55, on a control whose modifier is a literal `0`. Whether that row
  should exist at all is the prior question.

### Checked and correct — play and combat

- **`InventoryTracker`'s four verbs are symmetric.** `equip` and `attune` both call the shared
  toggles in `character/inventory.ts`; `attune` blocks the fourth item only in Strict and only on
  the way IN, matching `toggleAttuned`'s own contract, and un-attuning is never gated. `use` removes
  the last of a stack rather than leaving a zero row (`useOne`), and `bumpQty` floors at 1 so the
  stepper cannot silently delete an item. `setBase('')` deletes the key rather than keeping the last
  pick.
- **The coin surface is complete in both directions.** `toggleCoin` / `isCoinShown` / `shownCoins`
  and `toggleCoinWeight` all have their control in the `coins` overlay
  (`CombatMenus.svelte:334`–`:349`), reached from the inventory panel head
  (`PanelCard.svelte:52`); a hidden denomination keeps its coins and its weight, as
  `rules/currency.ts` requires.
- **The autosave covers every play-time write.** `combat/+page.svelte:71` deep-tracks `play`, `ui`
  *and* `build`, so the inventory verbs (which write `build.inventory`), the pins (`ui`) and the
  prepared flags (`build.spells`) all schedule a save without each verb calling
  `saveCharacterToStore` itself; `onBeforeReload` flushes it.
- **`passBoundary`** recharges only pools whose own `recharge.trigger` matches, skips a pool with
  nothing spent rather than announcing it, rolls a dice amount through `rechargeCount` with the
  sheet's `castCtx`, floors at 0, and says what came back per pool. `hasBoundaryPool` gates its two
  buttons so neither can appear as a no-op. `rest()` correctly ignores dawn/dusk pools via
  `restRecharge`.
- **`TurnEconomy`'s `usedRolls` marker.** `toggleCombat` and `nextTurn` both reset it with the rest
  of `play.turn`, and `ActionsPanel.svelte:31` shows the marker only while a turn is being tracked —
  which is what clears it — so a stale mark cannot survive into a fight.
- **`expireTimedEffects` / `advanceTime`.** One partition pass, a toast per expiry (never silent),
  `endConcentrationCarriedBy` on the expired set, and no action-economy reset out of combat.
- **`effects-view.ts`'s tag layer.** `numericFactTag` formats from the FACT fields and never
  re-parses the token (the D7 invariant), `effectTagResolved` prefers a resolved `NumericFact` so an
  L2-expression value renders as a number instead of a bare "Damage +", `targetLabel` covers the
  dotted families and falls through to `titleCase` for a homebrew target, and every branch has an
  English fallback for a caller with no translator.
- **`durationToRounds`** maps every shape the shipped `duration` column uses — `"1 minute"` → 10,
  `"Concentration, up to 1 hour"` → 600, `"8 hours"` → 4800, `"Until dispelled"`/`"Instantaneous"` →
  null (indefinite carrier) — and `carrierRounds` lets an absolute `duration` upcast override it,
  with `isInfinite` → no timer.
- **`SpellCasting.cast`'s ordering is all-or-nothing.** The slot is RESERVED (typed
  `{key}|{blocked}`, not a string sentinel) before the economy is asked, the economy is asked before
  the slot is spent, and a block at either gate returns with nothing mutated. A ritual reserves no
  slot; `castSlotLevel` resolves a pact slot to the pool's forced level.
- **The upcast paths.** `evalUpcastAt` is the single place the ephemeral `{slot, spell_level}` ctx
  is built, with `spellcasting_mod` re-pointed at the class the spell is cast AS; `upcastDamageParts`
  drops a zero delta so a base-slot cast adds no phantom part; `spellDamageParts` routes a typed
  delta onto the part sharing its type and appends a new part when the base has none, and rides the
  primary fx (or the heal's ability mod) on part 0 only; a broken formula toasts and falls back to
  base rather than producing a wrong number. `castPreview` and `upcastLadder` read the same
  evaluation the cast will use.
- **`RollJournal`'s identity handling.** `pushVolley` stamps `at + i` so an amendment rewrites its
  own beam; `recordRolls` groups a multi-throw action under one `crypto.randomUUID()` and leaves a
  single roll ungrouped; `reviseEntry` matches on `at` and falls back to object identity only for an
  unstamped entry; `pushRoll` returns `this.log[0]` so a caller holds the reactive proxy the
  `{#each}` iterates. `ROLL_LOG_MAX` matches `LOG_MAX_LINES` on disk.
- **`spells.ts`'s cantrip scaling.** `castingDice` multiplies dice by `cantripDieMultiplier(level)`
  only for `level === 0`, and explicitly NOT when the row's `upcast` is a `count:` (Eldritch Blast
  scales beams, not die size). The scaled string feeds both the row's `summary` and its
  `damageParts`, so what is shown is what is rolled.
- **`groupByLevel` / `groupByPrepared` / `groupBySchool` and the pact strip.** The pact pool is
  excluded from `slotsByLevel` and rendered as its own rowless header keyed by `PACT_SLOT_KEY`;
  `forcedUpcast` pools never leak into the per-level pip counts; a homebrew school falls back to the
  row's own word through `labelKey`+`label`.
- **`applyDamageSensitivity` and `effectiveHpMax`** (`defense.ts`) — immune before vulnerable before
  resist, resist floors, and the manual max re-folds the item/feature/condition/override layers
  through the same pipeline rather than re-summing facts.
- **`standardActions`** filters by system, renames Utilize → "Use an Object" on 5e only, and carries
  every reader-visible string as a catalog key derived from the row id.
- **The two anchored-menu placement effects** (`CombatMenus.svelte:71`, `EffectDurationMenu:51`) both
  clamp on open and follow without clamping on scroll, both listen in the capture phase, and both
  clean up every listener on teardown.

## Second pass — the UI remainder

The lines *What was not reached* left open: the duplicated CSS census, a `:focus-visible` pass, and
the reverse states beyond finding 25 — pin persistence, source enable/disable, theme
install/uninstall, pack apply/rollback.

### 71 · [ ] LOW · the top of the duplicated-CSS census is the shared class being re-typed beside itself

`node tools/visual/css-dups.mjs` — the repo's own survey, and the source of the census this audit
already carries: **102 duplicated declaration blocks, 100 of them spanning more than one file.** The
number is not the finding; what the top of the list IS, is. AGENTS.md ▸ Working on it: "A shared
class lives in exactly one place; a shared control is one component" — and these are not near-misses,
they are that class re-typed beside itself:

| ×  | the block | where the shared one already lives |
| --- | --- | --- |
| 11 | `border-color: var(--color-border-strong); color: var(--color-text)` | `components.css:67` `.pill-btn:hover` and `:611` `.chip:hover` — the other nine are `.cls:hover`, `.syschip:hover`, `.cancel:hover`, `.source-tag.as-toggle:hover`, `.jumpbtn:hover`, `.step:hover`, `.action-economy-reset:hover`, `.action:hover`, `.disclosure[open] summary` |
| 10 | `color: var(--color-text-muted); font-family: var(--font-mono); font-size: var(--font-size-micro)` | the `.eyebrow` family (`components.css:92`), whose own comment calls it "the single most-reused label primitive" |
| 9 | `border-color: var(--color-accent); color: var(--color-accent-bright)` | the accent-selected state of the same two families |
| 9 | `color: var(--color-text-muted); font-size: var(--font-size-xs)` | `components.css:92` / `:140` (`.eyebrow`, `.dialog-label`) |
| 6 | `background: var(--color-accent-soft); border-color: var(--color-accent); color: var(--color-accent-bright)` | the selected chip, five files over |

`pnpm lint` cannot see any of it: `jscpd` runs at `minTokens: 35` (`config/jscpd.json`), and a
two-declaration hover block is far under that floor.

**Fix:** the five rows above are one hover state, one selected state and one micro-label. Compose
`.pill-btn` / `.chip` / `.eyebrow` in the markup instead of restating their hover and selected pairs
— which is what those classes exist for — and re-run `css-dups.mjs` to see what is left.
`tools/visual/hoist-class.mjs` and `rename-class.mjs` are the mechanical half of that move.

### 72 · [ ] MEDIUM · opening a builder picker leaves the keyboard 89 Tab stops away from it

Nothing moves focus into the Inspector when a picker opens: `PickerSearch.svelte` has no autofocus,
`OptionGrid`/`SectionedPicker` have none, and the pane is the last column in the DOM. `ui.md` ▸ the
picker contract builds everything on the opposite: "The caret stays in the search box … with focus
that never moves, it is the only thing a screen reader has to go on", and `option-walk.ts:47` says
outright "The walk happens from the search box". A keyboard user cannot start that walk.

**Reproduced** — chromium against the dev server, `/build`, a fresh character; focus the Species
card, press Enter to open its picker, then walk forward:

```
focus right after Enter        button:"Species Not chosen …"   <- the trigger, not the picker
one Tab                        button:"Background Not chosen"  <- the NEXT card, past the picker
Tabs to the first control
inside the open pane           89                              ("Close the inspector")
```

Everything the contract asks for is there once focus arrives — which is what makes this the one
missing line rather than a rewrite:

```
roles present                  searchbox 1 · listbox 1 · option 9, every option a <button> with an id
ArrowDown from the search box  ad=c1-species:SRD_5.2.1:dragonborn
ArrowDown again                ad=c1-species:SRD_5.2.1:dwarf   aria-selected="false"  (arrows commit nothing)
Enter                          opens Dwarf's PickerCard        (Enter = a left click on the highlight)
```

**Fix:** focus the search box when a picker opens, and return focus to the trigger when it closes —
the pair `CommandPalette.svelte:125`/`:138` already implements for its own input.

### Checked and correct — the UI remainder

- **The `outline: none` sites all have a replacement, bar one that cannot be reached wrong.** All 13
  were read against `app.css:35`'s own rule ("never `outline: none` without a replacement"):
  `ArticleProse`, `EditableTitle` and `ContentMetaModal` swap the outline for an accent border on
  `:focus`; `PickerSearch` moves it to the wrapper's `:focus-within`; `RollerLine`'s pill swaps in a
  border plus a fill, and its input is framed by `.roller-field.focused`, which the tray drives from
  `diceTray.focus`; `+layout.svelte`'s `main` is the skip-link's `tabindex="-1"` scroll region.
  `CommandPalette.svelte:233` is the one input with no focus style at all, and it is the palette's
  only focusable element and is focused on open — nothing can be focused elsewhere to make its ring
  matter.
- **Theme install and uninstall are symmetric, including the active-theme case.**
  `ThemesSettings.svelte:82` — `remove` drops the store entry, deletes the file through
  `removeThemeFile`, re-points `app.theme` at `dark` when the deleted theme was live so `<html>`
  never names a theme that is gone, and leaves the editor if it was open on it. Import, export,
  duplicate and clone-from-builtin each have their control on the same card.
- **Source enable/disable is one toggle in both directions**, at both grains:
  `SourceManager.svelte:109` `toggleSource` and `:133` `toggleFile`, each an `aria-pressed` switch
  with a labelled `aria-label`, and the pack-level switch derives its state from its files rather
  than keeping a third flag.
- **Pack apply and rollback both have a control and a visible condition.**
  `PackUpdatesSettings.svelte:405` shows Undo only for a pack `rollbackablePacks()` names, and
  `provider.ts:108` keeps the `.prev` copy that makes the answer true. A deletion's undo is offered
  separately (`provider.ts:145`) and a "yes, I meant it" does not take it away (`:257`).
- **A spell pin persists**: `ui.spellsPinned` is part of the deep-tracked autosave
  (`combat/+page.svelte:71`), so pinning schedules a save with no verb of its own. What the pin
  stores is wrong — finding 68 — but it survives a reload.
- **Findings 64, 65 and 67 are no longer markup reads.** Driven in chromium against the dev server:
  typing `zzzz` into the add-effect search leaves all 9 rows standing; re-opening the condition menu
  shows Blinded's switch lit, and a click on it and Enter on it both leave the popup open, the switch
  on and the condition applied; the duration menu's `role="dialog"` survives Escape and Tab walks
  straight out of it.

## Second pass — character persistence and builder state

Queue item 4. `src/lib/character/{repository,schema,store.svelte,draft-repository,photo,derive-plugins}.ts`,
`src/routes/build/{draft,draft-history.svelte,draft-session.svelte,class-picks-cache,class-rows.svelte,option-walk,picker-reading.svelte,card-placement,rows,draft-inventory,inspector.svelte,inspector-specs,build-view-model.svelte}.ts`,
`src/routes/+page.svelte`, `src/routes/build/+page.svelte`. Nine confirmed.
### 73 · [x] MEDIUM-HIGH · deleting a character is one unconfirmed click, and it takes the snapshots that would undo it

`src/routes/+page.svelte:125` — `onclick={() => removeCharacter(c.id)}` on the roster's ✕. No dialog,
no toast, no undo. `removeCharacter` → `deleteCharacter` → `storage.remove(dirOf(slug))`
(`repository.ts:363`), which is the whole folder: `character.json`, `photo.*`, `log.jsonl`, and every
`character.bak.save.*` / `character.bak.launch.*` the ring wrote. `:103` is the same bare click on a
draft card.

The app already owns the control this needs and uses it for far cheaper losses.
`compendium/[...entry]/+page.svelte:614` puts a homebrew ROW behind `ConfirmDialog`, and
`settings/StorageSettings.svelte:263` puts "Restore demo" behind one with a comment stating the rule:
*"It's destructive, so it goes behind a confirm."* A character is the single most expensive thing the
user owns and it is the one destructive action with no guard — AGENTS.md ▸ Hit every surface
("Reverse states: if you added a way in, add the way out"), applied to the only action here with no
way out at all.

**Reproduced** — the delete path read end to end and confirmed against the two sites that do gate:

| button | guard | what it destroys |
| --- | --- | --- |
| `+page.svelte:125` roster ✕ | **none** | the character folder: save, photo, roll log, all 5 backups |
| `+page.svelte:103` draft ✕ | **none** | `character-drafts/<guid>.json` |
| `compendium/…/+page.svelte:614` delete row | `ConfirmDialog` `danger` | one homebrew CSV row |
| `StorageSettings.svelte:263` Restore demo | `ConfirmDialog` `danger` | the demo's play-state edits |

`grep -rln ConfirmDialog src/` returns exactly those two files. Predates `v0.6.2` — the button is
from `32c407e` (2026‑07‑03) and the file was still edited this cycle (+74/−17).

**Fix:** the two roster ✕ buttons take the same `ConfirmDialog danger` the compendium row uses, with
the character's name in the title.

### 74 · [x] MEDIUM · a picked portrait outlives the build it was picked for, and overwrites the next character's

`build-view-model.svelte.ts:497` — `pickedPhoto` is cleared in exactly two places, `clearPhoto`
(`:521`) and `persistPhoto` after a successful write (`:535`). None of the three entry points that
start a *different* build clears it: `reset` (`:112`), `hydrateDraft` (`:139`), `hydrate` (`:152`)
each reset the draft, the class stash, the session guid, the history and the inspector, and leave the
bytes behind. The BuildVM is a singleton and `build/+page.svelte:53` runs one of those three on every
navigation, so the bytes cross from one character to the next.

`portraitSource` (`:501`) prefers the pick over the stored file, so the wrong face is on screen the
whole time; `persistPhoto` (`:529`) then writes it into whatever folder is being saved, and
`writeCharacterPhoto` removes the existing portrait first.

**Reproduced** — real `Storage` (fake-indexeddb through `getUserStorage`), a saved character `bevan`
with `photo.webp` = `[9,9,9,9]` on disk; a new build picks `[1,2,3]`, is abandoned, and the player
goes to level Bevan up:

```
after reset(): still holds a picked portrait   true
after reset(): the blank sheet shows           "picked"
after hydrate(): still holds it                true
after hydrate(): Bevan's sheet shows           "picked"   <- someone else's face on Bevan
blocking                                       []
saved id                                       "bevan"
Bevan's portrait bytes on disk                 [1,2,3]    <- his own is gone
```

`821632e` ("a character can have a face"), this release.

**Fix:** `pickedPhoto = null` in `reset`, `hydrate` and `hydrateDraft` — the three already clear every
other cross-build carry-over, and this is the one they missed.

### 75 · [x] MEDIUM · the v1 save migration snakes every content ref except the languages

`repository.ts:48` — `for (const key of ['feats', 'skills', 'expertise'] as const)`. The E3 rename
(`f11fab4`, kebab → snake ids) is what `migrateV1toV2` exists to repair, and it walks `species`,
`speciesOption`, `background`, `feats`, `skills`, `expertise`, `spells`, `classes`, `inventory`,
`play.concentration` and `play.effects[].source`. `build.languages` — an array of `language:src:id`
refs, present in the v1 schema since `274dc14` (2026‑07‑04), twelve days *before* the rename — is not
in any of those lists. `git show f11fab4~1:src/lib/character/schema.ts` confirms the v1 build schema
held exactly one ref-carrying field the migration does not touch, and this is it.

**Reproduced** — a v1 save written to a **real** fs (`NodeStorage` in a `mkdtemp` root), loaded
through `loadCharacter`:

```
schemaVersion    3
species          "species:SRD 5.1:half_elf"
background       "background:SRD 5.1:folk_hero"
skills           ["sleight_of_hand"]
expertise        ["sleight_of_hand"]
feats            ["feat:SRD 5.1:war_caster"]
inventory        ["item:SRD 5.1:chain_mail"]
spells           ["spell:SRD 5.1:magic_missile"]
concentration    "spell:SRD 5.1:magic_missile"
languages        ["language:SRD 5.1:deep-speech", "language:SRD 5.1:common"]   <- untouched
```

The stale ref resolves to no row: `f11fab4` renamed `deep-speech` → `deep_speech` in
`srd-2014/languages_srd.csv`, and the shipped packs today carry `deep_speech` (2014) plus
`common_sign_language`, `deep_speech`, `thieves_cant` (2024). A v1 save loses those languages
silently — `characters.md` ▸ Versioning promises the opposite ("old saves are migrated forward").
Predates `v0.6.2`.

**Fix:** add `'languages'` to the `snakeRefs` list at `:48`. Idempotent on already-snake ids, so
re-running v2→v3 (which re-invokes the same function) needs no separate change.

### 76 · [x] MEDIUM · a level set before the class locks that class out at 20

`class-rows.svelte.ts:36` — `totalLevel` is `classes.reduce((n, c) => n + (c.classId ? c.level : 0), 0) || 1`.
The `|| 1` is a floor for display, and `levelAfterTaking` (`:83`) subtracts a real held level from it:
`this.totalLevel - held + (stashed ?? row.level ?? 1)`. With no class held anywhere, `held` is 0 and
`totalLevel` is the floor rather than 0, so taking the first class is computed as **level + 1**.
`setClass` (`:75`) refuses anything over 20.

The row's level stepper is rendered for every row including a classless one
(`blocks/SheetClasses.svelte:116`, no `{#if clsRow}`), and `bumpClassLevel`'s own guard is
`canRaiseLevel` = `totalLevel < 20`, which the floor keeps at 1 the whole way up. So the stepper
takes a blank row to 20 and then no class can be put in it. `ui.md` ▸ The builder is a live sheet:
"a character may be built at ANY starting level".

**Reproduced** — real `BuildVM`, one blank row, the stepper pressed the way the UI presses it:

```
row level after 25 presses    20
totalLevel (no class held)     1        <- the floor, not 0
classId after picking Wizard   null
toast                          build.notice.levelCapFull
at row level 19: classId       "class:SRD 5.2.1:wizard"   <- the boundary
```

The same door opens from `switchSystem` (`build-view-model.svelte.ts`), which clears a class whose
row the new edition lacks and leaves the row's level where it was: a level‑20 5e Fighter flipped to
5.5e cannot take any 5.5e class. `797b091`, this release.

**Fix:** drop the floor inside the arithmetic — `levelAfterTaking` should sum the held levels itself
rather than borrow the display value: `classes.reduce((n, c, j) => n + (c.classId && j !== i ? c.level : 0), 0) + (stashed ?? row.level ?? 1)`.

### 77 · [x] MEDIUM · a storage failure on Create says nothing, to anyone

`build-view-model.svelte.ts:541` — `save()` wraps its four awaited storage calls in `try/finally`
with no `catch`, and `build/+page.svelte:106` is `const id = await build.save(); if (!id) return;`
with none either. So a full disk, a renamed data folder, or a permission error during Create leaves
an unhandled promise rejection, no toast, and a button that goes from "Saving…" back to "Create" as
if nothing was asked of it.

Its sibling two files over does it right and says why: `draft-session.svelte.ts:76` catches, resets
`written` so the next change retries, and raises one standing toast — *"a rejection escaping here is
an unhandled promise rejection nobody sees — the exact loss the autosave exists to prevent."* The
same reasoning applies with more force to the button that creates the character. AGENTS.md ▸ Taste:
"Errors are handled or surfaced, never swallowed." This is finding 30's shape (pack writers with no
`guarded()`) on the builder's one commit button.

**Reproduced** — a creatable draft, `storage.write` stubbed to reject:

```
outcome                  REJECTED out of save(): disk full
savingResetByFinally     false
```

Nothing catches it above `save()`; `create()` returns a rejected promise into an `onclick`.

**Fix:** `catch` in `save()` — toast the failure with the same one-id pattern as
`DRAFT_SAVE_FAILED_TOAST` and return `null`, which `create()` already treats as "do not navigate".

### 78 · [x] MEDIUM-LOW · the autosave that lands after Create resurrects the draft Create just discarded

`build-view-model.svelte.ts:534` — `persistPhoto` writes `this.draft.photo = name` **during** `save()`.
That is a draft mutation, and `build/+page.svelte:76` subscribes to the whole draft by deep snapshot,
so it arms a fresh 600 ms autosave timer at that moment. `save()` then does three more awaited
storage round-trips (`saveCharacterToStore`, which re-reads the entire roster, then `discard()`, then
`openCharacter`) before `create()` starts a route transition to `/combat`; the build page's `$effect`
cleanup — the only thing that cancels the timer — does not run until that transition destroys the
component. `DraftSession` has nothing that marks a session consumed: `discard()` (`draft-session.svelte.ts:89`)
deletes the file and leaves `guid` and `written` exactly as they were, so the next `persist()` writes
the same file back.

**Reproduced** — real `Storage`, a complete draft with a picked portrait, Create, then the pending
autosave:

```
drafts before Create                    1
created id                              kesh-8c9c
drafts right after Create               0
drafts after the pending autosave       1
resurrected under the same guid         true
roster                                  Karroth the Red, Kesh
```

The ghost sits in the roster's unfinished section forever, and resuming it and pressing Create again
mints a **second** character (`uniqueCharacterId` gives it a new id), which is the expensive half.
Without a portrait the same window opens whenever the last draft edit is within 600 ms of the click —
there `written` is stale for the ordinary reason.

**Fix:** `renew()` at the end of `save()`, beside `discard()` — a session whose draft became a
character has no identity left to write under. It costs one line and closes both doors.

### 79 · [x] MEDIUM-LOW · Enter on a focused language chip takes the highlighted one instead

`picker-reading.svelte.ts:108` — `fromOptions` passes the host straight through:
`walkOptions(event, this.host())`. Its own docstring six lines above says the opposite — *"Enter is
deliberately left to the browser — the focused button's own click is the right answer there"* — and
`fromSearch` is the one that supplies `onenter`. But `walkOptions` (`option-walk.ts:50`) fires
`onenter` whenever the host carries one, and `LanguagesPane.svelte:27` does
(`onenter: (id) => b.toggleLanguage(id)`, because a language has no article to read). Its chips are
real `<button role="option">` inside a `tabindex="-1"` container whose `onkeydown` is `fromOptions`
(`:55`), so a keydown on a focused chip reaches it.

Enter there `preventDefault()`s the browser's own click on the FOCUSED chip and toggles the
HIGHLIGHTED one, then `fromOptions` moves the caret back to the search box. `ui.md` §5: "Enter is
identical to a left click."

**Reproduced** — browser project, `LanguagesPane`'s exact host; the walk highlights Elvish from the
search box, then the player Tabs onto the Common chip and presses Enter:

```
highlight                  "language:src:elvish"
defaultPrevented           true                       <- the focused chip's click is cancelled
toggled                    ["language:src:elvish"]    <- the wrong language
caretYankedBackToSearch    true
```

`picker-reading.browser.test.ts:145` covers this case ("leaves Enter to the focused button itself")
but builds its picker without `onenter`, which is the only configuration where the claim holds.
`dcfa4d0`, this release.

**Fix:** `fromOptions` drops `onenter` before delegating — destructure it off the host rather than
spreading it — which is what its docstring already describes.

### 80 · [ ] LOW-MEDIUM · the rotating backups have no reader, no restore, and on the web no way to reach them

`repository.ts:118–192` maintains two rings on every save and every launch — `character.bak.save.*`
(2 deep, 10‑minute throttle) and `character.bak.launch.*` (3 deep) — and the block comment states the
purpose: *"No DB → recover a clobbered/corrupted save from a sibling snapshot."* `characters.md`
repeats it ("rotating backups"). Nothing reads one. `listBackups` is module-private and its only
caller is `backupCharacter` itself; `grep -rn 'bak' src/routes src/lib/components` finds no surface,
and no item under `docs/work/` schedules one.

On desktop a user who knows the layout can rename the file, which is consistent with "the data
belongs to the user". On the **web demo** the same code runs against IndexedDB, where there is no
folder and no file manager — so five snapshots per character are written, pruned, and unreachable by
any means the app or the browser offers. And on both targets the roster's ✕ deletes them along with
the save (finding above), which is the one moment they exist for.

**Reproduced** — the census, mechanical:

| question | answer |
| --- | --- |
| writers of `character.bak.*` | `backupCharacter` (`:154`), reached from `saveCharacter:205` and `snapshotCharacterOnLaunch:184` |
| readers | none — `listBackups` (`:130`) is private and used only to prune |
| UI entry point | none (`grep -rn 'bak\|backup' src/routes src/lib/components` → one comment in `combat-view-model.svelte.ts:283`) |
| planned work item | none (`grep -rn -i 'restore\|recover' docs/work docs/plan.md`) |

**Fix, smallest:** Settings ▸ Data lists a character's snapshots by their filename timestamp with a
"Restore" button per row — `loadCharacter` already migrates and validates whatever is read, so the
restore is a copy over `character.json` plus a roster reload. Until then the comment at `:119` and
`characters.md`'s "rotating backups" describe a capability that does not exist.

### 81 · [x] LOW-MEDIUM · four screens show a raw system id, and only one shows the label

*Widened in the third pass — the original finding said "the roster is the one screen", which is
wrong. Its census grepped `sysbadge`, a class name, so it could only ever find the roster.*

`SYSTEM_LABELS` (`rules/pipeline.ts:20`) exists for exactly this and its own comment says so:
*"What a system is CALLED to a user — never the raw id in prose."* `ui.md` ▸ Error copy names it as
the way an edition is said. Grepping for the RENDER rather than for one class name
(`{sys}` / `{c.system}` / `{d.summary.system}` across `src/**/*.svelte`) gives five sites in four
files, of which exactly one is right:

| site | renders | |
| --- | --- | --- |
| `routes/+page.svelte:97`, `:115` | `{d.summary.system}` / `{c.system}` | the roster — the original finding |
| `combat/blocks/Hero.svelte:40` | `{c.system}` | the play sheet's hero line, beside a translated proficiency label |
| `build/blocks/BuildHead.svelte:113` | `{sys}` | the builder's edition switcher |
| `EditContentForm.svelte:309` | `{sys}` | the homebrew form's system chips |
| `settings/GeneralSettings.svelte:71` | `{SYSTEM_LABELS[sys]}` | **the only one that is right** |

The builder's is the sharpest, because the comment two lines above it
(`BuildHead.svelte:107`) is *about* `SYSTEM_LABELS` — *"a third system is a row in SYSTEM_LABELS,
not a button somebody has to remember to add here"* — and the button it introduces prints `sys`.
So a user switching editions in the builder reads `5.5e` while the same control in Settings reads
`D&D 5.5e (2024)`.

**Fix:** `SYSTEM_LABELS[...]` at all five. The badges want something shorter than
`D&D 5.5e (2024)`, and the honest version of that is a short-label row added beside
`SYSTEM_LABELS` — not a raw id read at the call site, which is the state that produced four
different answers to one question.

### Suspected, not reproduced — persistence and builder state

- **`drafts/store.ts:216` `discardDrafts` throws on a structurally-valid but shapeless draft file.**
  `parseDraft` (`:221`) returns whatever `JSON.parse` gives with no shape check, so a file holding
  `{}` or `123` becomes a `DraftEnvelope` with `schemaVersion: undefined`, lands in `findStaleDrafts`,
  and `deleteDraft(storage, d.target)` → `keyString(undefined)` → `TypeError` reading `.kind`, taking
  the discard dialog's whole batch with it. The probe: write `drafts/junk.json` containing `{}`
  through `NodeStorage`, call `findStaleDrafts` then `discardDrafts`. Adjacent to this item rather
  than in it (content drafts, not character drafts) — left for whoever owns `drafts/store.ts`.
- **Sorting is locale-blind in the builder's pickers and the roster.**
  `build-view-model.svelte.ts:195` sorts option lists with `rowName(a).localeCompare(rowName(b))` and
  `repository.ts:358` sorts the roster the same way, both with no locale argument, while
  `content/grouping.ts:47` and `content/linked-tables.ts:71` pass one. `ui.md` ▸ Strings: "sorting
  goes through `Intl.Collator` for the active locale". The probe worth running is whether the host
  default collator actually reorders any shipped Ukrainian name set — ICU root collation may make the
  difference nil, which is why this is not filed.
- **`ensureActiveCharacter` (`store.svelte.ts:68`) prefers the demo over the character the player
  last opened**, and nothing persists which that was, so every app restart lands on the demo sheet.
  The comment at `:72` reads as deliberate ("prefer the demo (present on first run / after a
  Restore)"), so this needs a design ruling before it counts as a defect rather than a missing
  last-opened key.
- **`downscalePhoto` (`photo.ts:71`) can name bytes it did not produce.** `PHOTO_TYPES[encoded.type] ? encoded.type : FALLBACK_TYPE`
  claims `image/png` for any blob type outside the map, and the extension follows the claim, against
  the module's own "the extension on disk always matches the bytes in it". The HTML spec makes
  `toBlob` fall back to PNG, so this is only reachable on a webview that returns a third type; a
  driven-browser probe across the Tauri WebView2 would settle it.

### Checked and correct — persistence and builder state

Recorded so none of it is re-derived.

- **`previewSheet`'s reused trial VM is sound.** It is called from exactly one place,
  `Inspector.changes` (`inspector.svelte.ts:118`), which is a `$derived.by` — so every preview writes
  `$state` from inside a derived, which is what Svelte's `state_unsafe_mutation` guard exists to stop
  and what the method's own docstring says the separate-VM design was chosen to avoid. It does not
  throw: driven through three successive derived runs (`trial.graph`, `trial.draft`,
  `trial.classPicks` and the mutate all firing on runs 2 and 3, when the trial's sources are no
  longer in that run's `current_sources`), all three read `ok`. Isolation holds too — the trial takes
  a `structuredClone($state.snapshot(...))` of the draft and a deep clone of every stash entry per
  call, and every `PickSpec.apply` in `inspector-specs.ts` writes through its `host` PARAMETER, never
  a closed-over `b`, so `classRows.setClass` / `feats.setSlotFeat` / `pickSpecies` all land on the
  trial. `trial.edit` is shared by reference, and nothing on any apply path writes into it.
- **`DraftHistory` is correct, including the undo-then-record no-op.** `freeze` clones through
  `structuredClone($state.snapshot(...))` for the reason its comment gives (outside the browser
  `$state.snapshot` returns the object itself), `step()` writes a fresh clone into the draft so later
  edits cannot reach the stack entry, and `present` is left as the restored step — so the autosave's
  `record()` that follows an undo compares equal and adds no step. `past` is capped at `DEPTH`; the
  draft and the class stash travel as one `DraftStep`, so an undo cannot leave the cache describing a
  swap that no longer happened.
- **`DraftSession.persist` has no read/write interleave.** Everything it reads — `host.draft`,
  `host.classPicks`, `this.guid`, `this.written` — is read synchronously before the first `await`, so
  a `renew()` or `adopt()` landing mid-flight cannot make it write one draft's body under another's
  guid. `written` is set only after the write returns, and cleared in the catch, which is what makes
  a failed autosave retry.
- **`adoptRowIds` (`draft.ts:100`) migrates index-keyed slot maps correctly** on both read paths
  (`parseDraftState` and `draftFromCharacter`), skips a row that already carries an id, and is
  idempotent. `hydrate` clones the draft BEFORE handing it over so `edit.loaded` and the live draft do
  not share the freshly-minted ids.
- **`parseDraftState` and `parseClassPicks` degrade rather than repair.** Every field has a `.catch`
  whose fallback is a FUNCTION, so no two drafts share a `[]` or `{}`; a stash entry that will not
  parse is dropped rather than half-restored. `draft-repository.ts` validates nothing by design and
  drops an unreadable record from the roster, matching `characters.md` ▸ "Nothing here validates".
- **The `save`-tier backup throttle and both prune rings are arithmetically right.** `listBackups`
  parses the timestamp out of the filename and sorts newest-first; the prune slices the new entry
  plus the existing list past `BACKUP_KEEP`, so `save` keeps 2 and `launch` keeps 3, and the
  `NodeStorage` temp file (`<path>.tmp-<pid>-<ms>`) is excluded by the `.json` suffix test.
  `snapshotCharacterOnLaunch` is once per id per module load.
- **`assembleCharacter`'s last-resort fallback is not reachable from content.** The obvious door —
  `saves: this.classRow?.data.saves ?? []` feeding `z.array(z.enum(ABILITIES))` from a CSV column — is
  shut upstream: `content/schemas.ts:259` already validates `saves` as `csvList(z.array(Ability))`, so
  a bad save id is a content issue and never reaches the build. Ability scores are bounded by
  `MANUAL_SCORE_BOUNDS` / point-buy, class levels by `MAX_CHARACTER_LEVEL`, and `slugify` collapses
  any non-ASCII name to `''` → `FALLBACK_SLUG`, so no name produces an invalid `id`.
- **`walkOptions` and `card-placement` behave.** The walk clamps at both ends (`ArrowUp` from no
  highlight lands on the first option, not the last), handles `NumpadEnter`, and returns whether it
  consumed the key; `jumpKeys: false` from the search box correctly leaves Home/End to the caret.
  `entryElement` falls back to the picker itself for a collapsed or filtered row, and `placeCard`
  reads `getComputedStyle(picker).direction` rather than assuming LTR.
- **`switchClass`'s row-index guard and `removeClassRow`'s bounds are both live** and do what their
  comments claim; `removeClass` closes an inspector pane opened on a class or subclass, because the
  rows behind the removed one shift.
- **Already recorded, not re-reported:** the builder/derive `featSkills` proficiency split is
  finding 8 (re-observed here on a fixture Rogue: `expertiseOffered('perception')` false,
  `assembled.build.expertise` `[]`, while `deriveSheet` with the expertise forced in gives
  `prof: "expertise"`, +3 instead of +1 — so finding 8's "load-bearing half" is confirmed, and it is
  homebrew-only on shipped content: `skilled` is the only `skill_choice` feat in either pack, it is
  category `origin`, and no shipped 2024 background grants it). `derive-plugins.ts:53`'s `preHpMax`
  and `derive-context.ts:89`'s `hpMaxLive` are two of finding 51's four hand-rolled copies.

## Third pass — the remainders, and the suspicions settled

The backlog *What was not reached* left, worked item by item. Findings 82-85; the settled suspicions
are folded back into their own *Suspected* headings above.

### 82 · [x] MEDIUM · the attack row prints a damage number the attack does not roll

`attacks.ts:321` (`computeAttacks`) folds a weapon's own tokens and the character-level **attack**
bonuses that a scope names (`scopedAttackBonus:278`), and no damage effect at all.
`sheet-rolls.svelte.ts:246` (`attackSpec`) then adds `effectsFor('damage', scopes).flat` to the
primary part. So the number `AttacksPanel.svelte:32` prints and the number the same row rolls when
tapped are two different numbers, with nothing on the row saying so.

**Reproduced** — real packs, barbarian 5, STR 16, greataxe, Rage applied through the shipped
`effects_srd.csv` row (`apply_condition:rage`):

| pack | row damage | roll adds | what a tap actually rolls | row notes |
| --- | --- | --- | --- | --- |
| srd-2014 (5e) | `1d12 +3 slashing` | +2 | `1d12 +5` | `[]` |
| srd-2024 (5.5e) | `1d12 +3 slashing` | +2 | `1d12 +5` | `[]` |

The token differs per edition (`damage.melee,str` in 2014, `damage.str` in 2024) and the outcome does
not. Adding an unscoped `flat_bonus:damage+1` on top moves the roll to +3 and the row not at all.

The attack axis is coherent and proves the asymmetry is not a design position but a gap: the row
folds a scoped attack bonus, and `roll.ts:392` skips exactly those on the roll side so they cannot
count twice — *"a scoped bonus is already in the row's to-hit … picking it up again here would count
it twice"*. Measured with `flat_bonus:attack.melee+2`, `attack.ranged+2` and `attack+1` live at once:
row to-hit 8 (melee folded, ranged correctly excluded), roll flat 1, effective 9. No double count,
and no note about the +1 either.

AGENTS.md ▸ *Every number can explain itself*. This one cannot: the row carries the ability modifier
and a magic weapon's own bonus, so it does not read as a base value, and a player quoting their
damage to the table quotes the wrong one for as long as Rage is up.

**Fix:** fold the flat half of the character-level damage facts in `computeAttacks` the way the
attack axis already does, and drop `dmgFx.flat` from `attackSpec`'s primary part so the two cannot
diverge. What cannot fold into a static number — bonus dice, `min_die`, `reroll` — is what
`AttackNote` is for, and `attackNotes` already renders it on the row's title.

### 83 · [x] MEDIUM-HIGH · every play-loop save is fire-and-forget, so a character can stop persisting for a whole session in silence

`saveCharacterToStore` (`character/store.svelte.ts:107`) has no `catch`, `saveCharacter`
(`repository.ts:196`) throws on both of its failure modes, and **not one of its nine call sites has a
catch either.** Six discard the promise outright:

```
combat/+page.svelte:81            setTimeout(() => void saveCharacterToStore(c), 800)   ← the autosave
combat/combat-view-model.svelte.ts:445
combat/resource-tracker.svelte.ts:225, :306                                             ← every rest
spellbook/+page.svelte:66, :119
```

The autosave one is inside a `setTimeout` callback, so no caller could catch it even if one wanted
to. The three that DO await it hand the rejection somewhere just as quiet: `build-view-model:554`
inside `save()`, which is finding 77; `Hero.svelte:46` inside an `onclick`, which then navigates to
the builder anyway; and `combat/+page.svelte:88`, the `onBeforeReload` flusher — where it is worse
than quiet, because `flushAll` (`content/reload.ts:23`) is a `Promise.all` and `reloadApp:28` awaits
it before `location.reload()`. One rejecting flusher means the reload the user pressed simply does
not happen, and two of the three `reloadApp` callers are `void reloadApp()`.

This is finding 77's shape (Create says nothing) and finding 30's (`guarded()` missing) on the path
the player spends the whole session on: HP, slots, resources, conditions, rests, pins, prepared
spells. `draft-session.svelte.ts:76` states the rule they break — *"a rejection escaping here is an
unhandled promise rejection nobody sees"*.

**Two ways in, and neither is exotic.**

- **The disk.** Measured on a real Windows filesystem: a file another process holds with
  `FileShare.None` — a sync client, a backup agent, the user's own editor on `character.json` —
  fails an atomic temp→rename with `EPERM`, and `NodeStorage.writeBytes:40` is exactly that rename.

  ```
  read:   EBUSY
  rename onto locked target: FAILED EPERM
  after unlock: "ORIGINAL"          ← the write never landed
  ```

- **The schema**, which needs no disk failure at all — see finding 84. `saveCharacter:198` refuses to
  persist a character that fails `characterSchema`, by throwing, into the same `void`.

Either way the sheet keeps working, every subsequent autosave throws the same way, and the next load
returns the character as it was before the failure began.

**The roll log has the same shape and one extra hazard.** `persistRoll`
(`combat-view-model.svelte.ts:307`) is `void appendLog(...)`, and `writeLogLine:434` opens with
`try { prev = await storage.read(...) } catch { /* first entry */ }` — an unconditional catch that
names a cause it never checks, and whose recovery is to rewrite the file from one entry. Simulated
against a 100-line log with the file locked, the read fails and the code would write 1 line. It does
not lose the log in *that* scenario, because the same lock fails the write (EPERM above) — but the
`Storage` interface has `exists()`, so the branch can distinguish "no log yet" from "could not read
the log" instead of assuming.

**Fix:** a shared `guardedSave` that catches, toasts once with a stable id (the
`DRAFT_SAVE_FAILED_TOAST` pattern), and is used by all six `void` sites; `writeLogLine` gates its
catch on `await storage.exists(logOf(slug))` and rethrows otherwise. `flushAll` wants
`Promise.allSettled` instead, so one failed flush cannot swallow the reload.

### 84 · [x] MEDIUM · the exhaustion stepper clamps to the data cap, the schema caps at 20, and the gap silently bricks saving

`effects-editor.svelte.ts:54` — `setExhaustion` clamps to `this.exhaustionMax`, the exhaustion row's
own `max_level`, and its comment says why: the ceiling is DATA, *"so a homebrew ladder of a different
height still kills at its own top"*. `schema.ts:193` bounds the same field at 20, and its comment
says it is *"only a generous sanity bound so a homebrew ladder taller than 6 still validates (D19)"*.
Both are deliberate, they were written for the same case, and they disagree above 20.

**Reproduced** — a homebrew `conditions_srd.csv` with `exhaustion,5.5e,Homebrew,Exhaustion,25`:

```
exhaustionMax from data:                 25
play.exhaustion after setExhaustion(25): 25
schema accepts the character:            false
  issue: play.exhaustion Too big: expected number to be <=20
toasts: ["combat.notice.died"]
```

The character is told it died. Nothing is told that it will never be saved again — see finding 83,
which this is the no-disk-failure door into.

**Fix:** one bound, not two. The schema's is the durable one, so clamp `setExhaustion` to
`Math.min(dataMax, EXHAUSTION_MAX)` and export that constant from `schema.ts` — or drop the schema
bound to a positive-int check and let the data own the ceiling outright, which is what the stepper's
comment already assumes.

### 85 · [x] LOW · a `flat_bonus:attack` carrying both a dotted scope and a qualifier keeps only the qualifier

`token-parser.ts:239` and `:253` build `{...(scope ? {scope} : {}), ...qualifierSlot(target, slot)}`,
and `qualifierSlot:202` returns `{scope: q}` when the base target is `attack`. Later spread wins, so
the dotted scope is overwritten rather than combined.

**Reproduced**, real `parseToken`:

```
flat_bonus:attack.melee+2            -> {target:"attack", scope:"melee"}
flat_bonus:attack:versatile+2        -> {target:"attack", scope:"versatile"}
flat_bonus:attack.melee:versatile+2  -> {target:"attack", scope:"versatile"}   <- "melee" is gone
flat_bonus:damage.melee:fire+1d6     -> {target:"damage", scope:"melee", damageType:"fire"}
```

The `damage` row is the shape that works, because its qualifier lands in a different slot. On
`attack` the two slots are the same slot, so the token widens instead of narrowing — `+2 on melee
versatile weapons` becomes `+2 on every versatile weapon` — and `isEffectTargetSupported` says
`{supported: true}`, so nothing is surfaced. No shipped row uses both slots; this is latent.

**Fix:** the two slots are one fact, so join them rather than letting one win —
`scope: [scope, qual.scope].filter(Boolean).join(',')`, which is already the AND-semantics
`rollEffectsFor:388` and `scopedAttackBonus:292` apply to a comma list.

### 86 · [x] MEDIUM-LOW · a failed RELOAD blanks the builder and is invisible on the other four views

`content/store.svelte.ts:27` assigns `content.graph` only on success, so a failed reload keeps the
working graph and sets `content.error` beside it. Five routes then read that pair, and one of them
reads it differently:

| route | gate | what a failed reload does |
| --- | --- | --- |
| `build/+page.svelte:115` | `{#if content.error}` | **replaces the whole builder** with the error screen |
| `combat/+page.svelte:109` | `{:else if !sheet \|\| !character}` | nothing |
| `compendium/[...entry]/+page.svelte:372` | `{#if !graph}` | nothing |
| `spellbook/+page.svelte:136` | `{:else if !graph \|\| !character}` | nothing |
| `translate/+page.svelte:250` | `{#if !graph}` | nothing |

**Reproduced** — the real store with `getContentGraph` rejecting on the second call:

```
after first load    → graph: {"marker":"the working graph"}  error: null
after failed reload → graph: {"marker":"the working graph"}  error: "Error: EBUSY: content/ unreadable"
guid rotated: false
build/+page.svelte:115  -> renders <Loading error> : true
combat/+page.svelte:109 -> renders <Loading error> : false
```

`content.error` is cleared only by a *successful* load, so the builder stays blanked until some later
reload succeeds — navigating away and back does not clear it, the store is module state.

This is reachable on desktop without anything unusual, and by the workflow the product promises:
editing a CSV in a text editor is watched (`watcher.ts:55`), and `discoverContentRoots`
(`disk.ts:44`) throws **by design** when `content/` exists but cannot be listed, so one transient
listing failure mid-build is enough. The build page's own comment says why the branch is there — *"A
content-load failure was silent here (empty pickers) — surface it like other views"* — and the fix
overshot: the other views surface it only when the graph is actually missing.

**Fix:** one rule, in one place. `build/+page.svelte` gates on `!build.graph` like its four siblings
(it has `build.graph`, `build-view-model.svelte.ts:83`) and keeps passing `content.error` to
`Loading`. A stale-but-working graph with a failed refresh behind it is a NOTICE, not a screen — and
if it should be one, it belongs to all five, not to the one page a user is mid-task on.

### 87 · [x] HIGH · moving a saved ASI to another ability grants BOTH, and it compounds with every move

`ability-allocation.svelte.ts:219` reconciles the carried flat boosts against what the restored slots
re-derive, **per ability**:

```ts
Math.max((this.host().edit?.boosts[a] ?? 0) - (slots[a] ?? 0), 0)
```

`edit.boosts` is the loaded character's `build.abilityBoosts` carried verbatim and never recomputed
(`build-view-model.svelte.ts:172`); `slots` is live off `draft.slotAsi`. So the subtraction only
cancels while the slot still points at the ability the save recorded. Move the pick and the old
ability has nothing to subtract against — it survives as "residue" — while the slot adds its full
amount on the new one.

**Reproduced** — real `srd-2024`, fighter 8, one ASI slot taken as +2 STR, saved through
`build.assembled` and re-opened, which is the level-up path:

```
SAVED character   → abilityBoosts {"str":2}   slotPicks.asi {…:4:{"shape":"2","picks":["str"]}}
re-opened         → slotBoosts {"str":2}   abilityBoosts {"str":2}   STR 17  DEX 14
move STR → DEX    → slotBoosts {"dex":2}   abilityBoosts {"str":2,"dex":2}   STR 17  DEX 16
```

STR keeps the boost it just gave up. `assembled` carries `{"str":2,"dex":2}`, so the inflation is
written to `character.json` — and from there the next open reads it as the new baseline:

```
save, re-open, move DEX → CON  →  {"str":2,"dex":2,"con":2}     STR 17  DEX 16  CON 15
save, re-open, move CON → INT  →  {"str":2,"dex":2,"con":2,"int":2}
total granted by ONE +2 ASI: 8
```

**The same arithmetic, one door over:** re-open the original save and swap the ASI for a feat.

```
slotFeats {…:4: "feat:SRD 5.2.1:alert"}   slotBoosts {}   abilityBoosts {"str":2}   STR 17
```

The ASI is gone, the +2 is not, and the feat is granted as well — a free +2 for taking a feat.

This is the exact defect `docs/work/mechanics.md` ▸ UBUG-13 is ticked as fixed for ("a restored slot
could re-derive its boost a second time"). Persisting the per-slot mapping fixed the *re-derive*
half; the *re-pick* half was never covered, and the module's own header says the subtraction is what
stands between the two.

**Fix:** subtract what the SAVE's own picks granted, not what the LIVE slots grant. The residue is
`edit.boosts` minus the boosts computed from `edit.loaded.slotAsi` / `edit.loaded.slotFeatAbility` —
the draft as it was loaded, which `EditContext.loaded` (`draft.ts:414`) already holds — computed once
and independent of the live picks. The ASI half needs no content graph at all (the picks are in the
save), so the race the current comment guards against does not apply to it; only the half-feat half
reads `halfFeatOptionsFor`, and it can subtract lazily by the same rule.

**Watch for the sibling** while fixing: `slotBoosts` folds the half-feat `+1` from
`draft.slotFeatAbility` through the same `Math.max` at the same line, so the same move-the-pick
inflation applies to a half-feat's ability by construction. Finding 50 is a *different* bug on that
same map — there the ability does not move when it should.

### 88 · [x] MEDIUM-LOW · reading a draft destroys the stale one the warning exists to show

`drafts/store.ts:87` — `readDraft` removes the file when `schemaVersion` differs, and returns null.
`findStaleDrafts:211` exists to list exactly those files *before* they go, and says so: *"Surfaced
(before removal) so the user is WARNED their unsaved work is being dropped, rather than it vanishing
silently on the next read"*. Whichever runs first wins, and the read has three call sites the warning
does not gate:

```
translate/+page.svelte:165     void readDraft(...) per row opened
EditContentForm.svelte:163     on the edit form's own restore
OrphanDialog.svelte:110        the conflict re-check, via repointDraft:152 too
```

The warning itself runs in one place — `compendium/[...entry]/+page.svelte:108`, `onMount`. So a user
who opens Translate (or an edit form) before ever landing on the compendium has their stale drafts
deleted by the visit, and the dialog that would have named them has nothing left to name.

**Reproduced** — real fs (`NodeStorage`, temp dir), one editor draft aged one schema version:

```
stale drafts BEFORE any read: 1
readDraft returned:           null
file still on disk:           false
stale drafts AFTER the read:  0     <- what the warning would list
```

**Fix:** make `readDraft` answer the question it was asked. Return null on a version mismatch without
removing anything; the file is already destined for `discardDrafts`, which is the path that has a
user behind it. `repointDraft`'s conflict check (`:156`) gets the same benefit for free — today it
can delete a stale draft at the destination and then report "no conflict" and overwrite the slot.

### 89 · [x] LOW-MEDIUM · one unrecognised `.json` in `drafts/` takes down the whole discard dialog

`parseDraft:221` returns whatever `JSON.parse` produced, unvalidated. Anything parseable but not a
draft envelope therefore counts as a *readable* draft with `target: undefined`, and since its
`schemaVersion` is undefined it lands in `findStaleDrafts` rather than in `findUnreadableDrafts`.
Both consumers then dereference the target:

- `SchemaDiscardDialog.svelte:36` — `const t = env.target;` and `t.type` on the next line, in the
  label function called for every row. It throws while RENDERING the dialog.
- `discardDrafts:216` → `deleteDraft` → `draftPath` → `keyString(target)` → `target.kind`. The loop
  is sequential with no guard, so it stops there, and `discardStale`
  (`compendium/[...entry]/+page.svelte:113`) has no `catch` — an unhandled rejection, and the
  `staleDrafts = []` reset two lines down never runs.

**Reproduced** — one genuine stale draft plus a `drafts/stray.json` holding `{"hello":"world"}`:

```
findStaleDrafts:      2   [{"kind":"add","type":"spell","addGuid":"g1"}, null]
findUnreadableDrafts: []
discardDrafts THREW:  TypeError: Cannot read properties of undefined (reading 'kind')
files left:           ["stray.json"]
```

`{#each drafts as env (env.target)}` (`:83`) also keys by the target object, so two such files are a
duplicate-key error as well.

This breaks the module's own opening promise — *"A lost/corrupt file loses only that draft, never the
set"* (`store.ts:8`) — and the folder is inside the data dir the product invites the user to open.

**Fix:** validate the envelope where it is parsed. `parseDraft` returns null unless `target` and
`schemaVersion` are present and the target's `kind` is one of the three, which routes every other
file to `findUnreadableDrafts` — where it is already handled by path, needs no target, and is exactly
what that list is for.

### 90 · [x] LOW · the draft filename encoding is legal on every OS except for one character

`draftPath:57` calls the encoding *"a valid, collision-free (reversible) filename on every OS — no
`:` / space hazard"*. `encodeURIComponent` leaves `! ' ( ) * - . _ ~` unescaped, and exactly one of
those — `*` — is forbidden in a Windows filename.

**Reproduced** — real fs on Windows, `writeDraft` for an `editor` target across a range of sources:

```
source "SRD 5.2.1"    -> wrote ok, read back: yes
source "My*Pack"      -> WRITE FAILED: ENOENT
source "Jane's Pack"  -> wrote ok, read back: yes
source "a<b>c" "a:b" "a|b" "a?b"  -> all wrote ok      <- the encoding does work for these
```

Reachable through a pack whose `#content-source` contains `*`; the write fails and the caller sees an
unhandled rejection, since `writeDraft`'s callers treat it as fire-and-forget.

**Fix:** escape it — `encodeURIComponent(key).replace(/\*/g, '%2A')` keeps the mapping reversible and
closes the set.

### 91 · [x] LOW · `BrowserStorage.rename` is the one implementation that neither refuses a bad move nor reports it

`storage/types.ts:37` states the rename contract for every implementation: *"Overwriting an existing
target is not promised — remove it first."* `browser.ts:118` re-keys every matching entry with `put`,
so an occupied destination is MERGED rather than refused, and a source that does not exist matches
nothing and returns successfully.

**Measured** under a real IndexedDB implementation (`fake-indexeddb`, the same one the suite uses):

```
a/ = {one.txt: "A-one", two.txt: "A-two"}     b/ = {one.txt: "B-one", three.txt: "B-three"}
rename(a → b)  ->  b = [one.txt, three.txt, two.txt]
                   b/one.txt   = "A-one"      <- B's file, overwritten
                   b/three.txt = "B-three"    <- survives a "move" that replaced the folder
                   a exists: false
rename('nope', 'elsewhere')  ->  silent no-op (a real fs throws ENOENT)
```

The second row is the one no sibling shares: `MemoryStorage.rename:104` throws `no such path`, and
both real filesystems throw `ENOENT`. On the occupied-target half `MemoryStorage` merges too, which
is the audit's own standing lesson — *"`MemoryStorage` silently merges a rename that Windows
refuses"* — now shown to hold for the SHIPPED web implementation as well, not only the test double.

**Latent today, and worth fixing before it is not.** Every caller respects the contract by hand:
`swapInNewTree:303` removes `prev` before renaming onto it, `recoverInterruptedApply:397` does the
same with `scratch`, and the whole pack lifecycle is desktop-gated
(`pack-update-state.svelte.ts:77`, `updates.svelte.ts:77`), so nothing reaches the divergence now.
It becomes live the day pack management reaches the web build, and it will not fail loudly when it
does — a half-swapped pack folder would look like a successful update.

**Fix:** two guards in `browser.ts`'s `rename`, in the same transaction it already opens — throw when
nothing matches `src`, and throw when any key under `dst` exists. That makes all four
implementations agree, and the callers' hand-written removes become belt-and-braces rather than the
only thing holding the invariant.

**Also measured, since the backlog asked:** `list()` is `getAllKeys` over the whole store plus one
`get` per child — a 50-entry folder costs 15 ms once the store holds 2 050 keys, and listing a
2 000-entry folder costs 388 ms. `rename` of a 2 000-key subtree is 189 ms and `remove` 29 ms. On the
web build IndexedDB holds only homebrew, characters and drafts (content comes from `FetchStorage`),
so none of this is reachable at a size that matters today.

### 92 · [x] MEDIUM · finding 28's open half, closed: six more English strings, and two raw content-type ids

Finding 28 said its census was "complete for attributes and markup runs, and open for props" — an
English sentence inside a `{}` expression is the shape its scan could not see. Two scans close it:
string literals in the MARKUP half of all 117 non-`/dev` `.svelte` files, and then the same over the
SCRIPT half plus every `*.svelte.ts` view-model, comments stripped first. Six sites survive, and the
second scan is where the two worst live because a default value never looks like user copy:

| site | what renders | why it is not a key |
| --- | --- | --- |
| `Loading.svelte:8` | `message = 'Crunching the numbers…'` | the shared load screen's DEFAULT, and `build/+page.svelte:117` omits `message` — so the builder's loading screen is English in every locale |
| `OrphanDialog.svelte:57` | `if (t.kind === 'add') return '(new entry)';` | the orphan dialog's id column, for every unsaved new entry |
| `compendium/[...entry]/+page.svelte:542` | `searchPlaceholder="Search {selectedType.replace(/_/g, ' ')}…"` | the compendium's own search box — an English verb glued to a **raw type id** |
| `EditContentForm.svelte:283` | `{type.replace(/_/g, ' ')} · {editing ? 'edit' : 'new homebrew'}` | the authoring form's eyebrow; same raw type id |
| `EditContentForm.svelte:284` | `· fork to homebrew` | a bare markup run the earlier scan should have caught |
| `RollerLine.svelte:277` | `` `${pill.type}${pill.inherited ? ' · inherited from the group on its left' : ''}` `` | the damage-type pill's tooltip |

Two of them break the *same* rule twice. `ui.md`: "A phrase is ONE key, never a noun substituted
into a frame" — `Search {type}…` is exactly that frame — and the substituted noun is
`selectedType.replace(/_/g, ' ')`, the raw content type. `contentType.*` exists and holds all 18
types, and finding 70 is the same defect one view over (the pin-skills menu title-cases skill ids
while the skills panel translates them). A Ukrainian user browsing species options reads
**«Search species option…»**.

`en.json` carries no `compendium.search*` key and no `roller.*inherited*` key, so all four need new
ones rather than a re-point.

**Fix:** one ICU key each taking `{type}` / `{name}`, with the type value coming from
`$_('contentType.' + type)`. The eyebrow's `edit` / `new homebrew` / `fork to homebrew` are three
states of one label, so they are one key with a `{mode}` value rather than three.

**What the scans RULED OUT is worth as much as what they found.** Every other two-word English
literal in a view-model is the documented `{text, key, values}` pair, where the English is the
fallback a translator-less caller reads — `hit-points.svelte.ts:189` and `:227`,
`rest-controls.svelte.ts:69` and `:106`, `spell-casting.svelte.ts:302`, and `dice-tray.svelte.ts:609`
(`'Custom roll'`), which the roller pass had already cleared. That pattern is used consistently
enough that the exceptions above stand out by their absence of a `key`.

**Method note for the next sweep:** each scan is about 40 lines and runs in under a second. The
markup one is worth re-running as written; the script one is only usable with comments stripped
first (`/* */`, `<!-- -->` and `//` blanked to spaces, preserving line numbers), because prose in
comments was ~80% of the raw hits. Neither is worth wiring into the gate as written — the signal is
"a user-facing string with no sibling `key`", and expressing that as a lint rule is the real fix.

### 93 · [ ] LOW-MEDIUM · shipped content nests conditions two deep, and the engine expands one — Unconscious is listed as Prone and is not Prone

`effects.md` states the rule three times — `apply_condition` expands *"a condition row's own tokens
ONE level"* (`:100`), *"ONE level per id"* (`:331`), *"expands ONE level, no cascade"* (`:339`) — and
`resolver.ts:204` implements exactly that: `gatherInstances` walks each effect's OWN tokens and calls
`ensureExpansion` on each `apply_condition`, and the children it appends to `insts` are never walked
again. The engine is right. The **content** assumes a cascade the engine promised not to do.

**Reproduced** — real `srd-2024`, one condition applied at a time:

```
unconscious   conditions = ["unconscious","incapacitated","prone"]   disadvantage = []
prone         conditions = ["prone"]                                 disadvantage = ["attack"]
stunned       conditions = ["stunned","incapacitated"]               disadvantage = []
```

`prone` on its own carries `disadvantage:attack`. Applied THROUGH `unconscious` it contributes
nothing — and it is otherwise fully present. Measured on the other side too, by guarding an
`flat_bonus:ac+5` on the implied condition and reading the AC:

```
apply_condition:prone        + has_condition.prone ? +5 AC   ->  AC 15
apply_condition:unconscious  + has_condition.prone ? +5 AC   ->  AC 15   <- the implied one fires the guard
apply_condition:unconscious  + has_condition.incapacitated ? +5 AC -> AC 15
0 ? apply_condition:rage     + is_raging ? +5 AC             ->  AC 10   <- a refused apply registers nothing
```

So an implied condition is real to every guard, every `is_*` flag and the plugin ctx, and unreal only
to its own `effects` column. A condition that is listed, queryable and inert is the worst of the
three readings — and it means a homebrew author can work around the gap with a guard while the
shipped row cannot.

**The whole census, both packs**, by parsing every `conditions_srd.csv` row's `effects` and checking
what each nested target actually carries:

```
srd-2014 / srd-2024  (identical)
  paralyzed  -> incapacitated   (notes only)
  petrified  -> incapacitated   (notes only)
  stunned    -> incapacitated   (notes only)
  unconscious-> incapacitated   (notes only)
  unconscious-> prone           LOST MECHANICS: ["disadvantage:attack"]
```

One lost mechanic, in both editions, and nothing else nested carries anything but `note:`. The
practical bite today is small — an Unconscious creature is not attacking anyway — but the shape is
not: the four `incapacitated` parents lose their child's three `note:` lines as well, and those are
the G2 info channel `conditionTokens` exists to deliver (*"the 'attacks against you have advantage',
concealed, auto-crit parts a single-character sheet can't fold onto any stat still reach the player
as reference"*). The panel tags the implied condition by NAME and stops there.

**Fix belongs in the content, not the engine.** The one-level rule is a deliberate guard against a
cascade loop, and widening it would need cycle detection for a case one row needs. Flatten the parent
instead: `unconscious`'s `effects` gains `disadvantage:attack` beside its `apply_condition:prone`, in
both packs, and gets re-stamped. That is a `charnik-content-srd` commit.

**Guard it so it cannot come back:** a test that walks every shipped condition row, expands one level
by hand, and fails when a nested target carries a non-`note:` token the parent does not also carry.
It is the same shape as the existing "a shipped token that folds onto nothing fails the suite"
gate (`111ba48`), and it would have caught this row the day it was written.

### 94 · [x] HIGH · a level-up silently strips a template magic item's chosen base weapon

`draft.ts:316` builds the draft's inventory field by field —
`{ item, qty, equipped, attuned }` — and `base` is not among them. `DraftState.inventory`
(`:156`) has no such field either, so `assembled` (`build-view-model.svelte.ts:385`) spreads a draft
entry that no longer carries it. Opening a character in the builder and saving therefore erases
which weapon a template magic item IS.

**Reproduced** — real `srd-2024`, a Flame Tongue with a longsword chosen as its base, fighter 5,
STR 16, through `build.hydrate` → `build.assembled`, which is the level-up path:

| | to-hit | damage | notes |
| --- | --- | --- | --- |
| saved character | **+6** | `1d8 +3 slashing` | — |
| after the round trip | **+3** | `+3`, no dice, **no damage type** | "Base weapon not set — roll its own dice" · "Not proficient — no proficiency bonus" |

Three separate losses, because everything the template inherits comes through
`resolveItem(graph, row, inv.base)` (`attacks.ts:349`): the damage dice, the damage TYPE, and the
category tags that decide weapon proficiency — so the character also stops being proficient with
their own sword. It is written straight to `character.json`, and nothing says a word.

**Root cause is a half-finished change inside this window.** `adff707` (2026-09-06, *"a Flame Tongue
is told which weapon it is"*) added `base` to `schema.ts`, taught `resolved-item.ts`, `attacks.ts`,
the inventory panel and `inventory.svelte.ts` about it, added tests and both locale catalogs, and
updated `content.md` — eleven files, and **not `routes/build/draft.ts`**, the one place a character
is taken apart and put back together. The mapper it missed carries the tell: its sibling line is
`attuned: i.attuned // preserve attunement through the builder round-trip (D15)`, a comment added
because the same field-by-field copy had already dropped `attuned` once.

**Fix:** carry it — `base: i.base ?? null` in `draftFromCharacter`, the field on `DraftState.inventory`,
and back out through `assembled`. The deeper fix is the one D15 already paid for once: this mapper
enumerates fields by hand, so every new inventory column silently drops until someone notices. A
round-trip test (`character → draft → assembled` deep-equals on `build.inventory`) would have caught
both `attuned` and `base`, and is the guard that stops the third one.

### 95 · [ ] LOW · `content.md` names class → features as a full-key link; it is deliberately a bare-id one

`content.md:34` — *"Links (class → features, character → content) and the loader's `byEffectiveId`
all use the full key."* The second half is true; the first is the counter-example.
`derive-gather.ts:112` states the opposite and says why: features are matched on
*"class_id + edition, NOT source, so a user's PHB/homebrew feature for an SRD class attaches
(B26)"*, and the shipped data agrees — `subclasses_srd.csv` rows carry `class_id` values like
`barbarian`, not `class:SRD 5.2.1:barbarian`. `build-view-model.svelte.ts:213` and `:223` compare the
same way for subclasses and species options, and `derive.test.ts:208` pins it as intended behaviour.

The cost of the lie is specific: this is the third-party extension point of the whole content model,
and a maintainer reading the Identity section would "fix" it into a full-key comparison and break
every homebrew pack that extends an SRD class. That is `work-artifacts.md`'s worst class of doc rot —
a doc that instructs building what the architecture forbids.

**Fix:** name the exception where the rule is stated. Character → content and `byEffectiveId` use the
full key; a content-to-content link that must survive re-sourcing (`class_id`, `subclass_id`,
`species_id`) is a BARE id on purpose, and `content.md` should say so beside the identity rule rather
than leaving `derive-gather.ts`'s comment as the only place it is written down.

### 96 · [x] MEDIUM-HIGH · a level-up re-prepares every spell the player unprepared, and demotes every always-prepared one

The same shape as finding 94, one field over. `draftFromCharacter:306` reduces the character's spells
to bare refs — `char.build.spells.map((s) => s.spell)` — and `assembled`
(`build-view-model.svelte.ts:387`) rebuilds the flags from the spell's LEVEL:

```ts
return { spell: ref, prepared: lvl > 0, alwaysPrepared: lvl === 0 };
```

Its comment reads *"cantrips are always-prepared; leveled spells start prepared (tweak in the
Spellbook)"* — a sensible default for a NEW character, applied unconditionally to an EDIT.

**Reproduced** — real `srd-2024`, cleric 5, through `build.hydrate` → `build.assembled`:

| spell | saved | after the round trip |
| --- | --- | --- |
| a cantrip | `prep:false always:true` | `prep:false always:true` ✓ |
| an ordinary prepared level 1 | `prep:true always:false` | `prep:true always:false` ✓ |
| one the player **unprepared** | `prep:false always:false` | **`prep:true`** |
| an **always-prepared** domain spell | `prep:true always:true` | **`always:false`** |

Both wrong rows cost something a rule counts. `spells.ts:130` excludes `alwaysPrepared` from the
prepared tally, so demoting a domain spell to an ordinary prepared one **raises the count against
`preparedCap`** — a gate the sheet displays — and makes a spell the class grants unconditionally into
one the player can switch off. The re-prepared row is the smaller half and still a decision taken on
the player's behalf, which is the one thing `AGENTS.md` says a tracker never does: *"a play-tracker
surfaces and suggests; it never auto-applies."*

**Fix:** `assembled` already knows whether it is editing (`this.edit`). Carry the flags for a ref the
character already had and default only for a newly picked one — the same repair finding 94 needs, and
the same round-trip test catches both: `character → hydrate → assembled` must deep-equal on
`build.spells` and `build.inventory` when nothing was clicked.

### 97 · [x] MEDIUM · the data-dir trust check passes `..`, and what stops the escape is a coincidence one layer down

`src-tauri/src/lib.rs:75` — `set_data_dir` decides whether a path is trusted with

```rust
.any(|g| dir == *g || dir.starts_with(g))
```

and `Path::starts_with` compares whole COMPONENTS, which is right for the attack it was written
against and blind to `..`, because `..` is an ordinary component.

**Reproduced** — real `rustc`, the same predicate against one granted directory
`C:\Users\fern\CharnikData`:

```
C:\Users\fern\CharnikData                            trusted=true    <- the pick
C:\Users\fern\CharnikData\charnik                    trusted=true    <- the documented child
C:\Users\fern\CharnikDataEvil                        trusted=false   <- sibling-prefix, correctly refused
C:\Windows\System32                                  trusted=false
C:\Users\fern\CharnikData\..\..\..\Windows\System32  trusted=TRUE
C:\Users\fern\CharnikData\sub\..\..\Desktop          trusted=TRUE
```

The file's own comment states the invariant this breaks: *"`set_data_dir` refuses to persist anything
not already in this set. So malicious page JS can no longer widen the sandbox to an arbitrary
directory."* The renderer can hand it any path it likes as long as it is spelled as a descent from
the picked folder.

**It does not currently escape, and the reason is not in this file.** Traced through the crates:
`allow_directory` (`tauri-2.11.5/src/scope/fs.rs:351`) stores a glob built by `push_pattern:100`,
which is `path.components().collect()` — Rust's `Components` normalises `.` and duplicate separators
and **leaves `..` alone**, so the stored pattern literally contains `..`. The matching side does the
opposite: `is_allowed:420` runs `try_resolve_symlink_and_canonicalize` on every REQUESTED path. A
canonicalised request can never match a `..`-bearing pattern, so the grant is inert either way round.
The sandbox holds by an asymmetry between how a pattern is stored and how a path is matched — not by
the check that exists to hold it, and not by anything either side documents.

**What it does do today** is brick the install. `set_data_dir` persists the raw string into the
Rust-owned pointer, and `apply_saved_data_dir:98` re-grants it at every launch with no check at all.
The JS side then uses that string as the storage root, every operation resolves to a real location the
inert pattern does not cover, and every read and write is refused. There is no UI for the pointer —
it is deliberately Rust-owned so page JS cannot forge it — so the only way out is deleting
`<appConfig>/config.json` by hand.

**Fix:** reject the shape rather than rely on the layer below. One guard before the trust test —
`if dir.components().any(|c| matches!(c, Component::ParentDir)) { return Err(...) }` — or canonicalise
both sides before comparing, which also closes the symlink variant the check does not consider.
`allow_directory` should then be receiving only normalised paths, which is what its stored pattern
already assumes.

**And it should be written down.** `docs/internals/security.md` never mentions the data-dir grant,
`pick_data_dir`, `set_data_dir` or `GrantedDirs`; `testing.md:53` names the picker only to say no
driver can reach it. The actual sandbox boundary of the desktop app is documented exclusively in
comments inside the file it guards, which is the one place a reader checking the boundary would not
think to look.

### 98 · [x] LOW-MEDIUM · a finished formula with no trailing space cannot be rolled with the mouse at all

The first pass filed this as a suspicion and named the open question exactly: *"Not observed: whether
the click still lands, since a disabled button swallows the event in Chrome and whether the blur
commit fires first is the open question."* Driven in a real chromium, the answer is neither — the
blur never fires, so the state does not self-correct and the button never becomes clickable.

**Reproduced** — `Roller.svelte` mounted in the browser project, one line, `userEvent` typing:

```
typed "2d6"  (no trailing space) → pills 0 · rollable false · disabled TRUE
   one click on Roll            → Playwright TIMED OUT waiting for it to become enabled (14.7 s)
typed "2d6 " (trailing space)   → pills 1 · rollable true  · disabled false
   one click on Roll            → onroll called once
```

A disabled button takes no pointer events and does not move focus, so the `onblur` on the line
(`RollerLine.svelte:207` → `diceTray.commit(index)`) — the thing that would turn `2d6` into a pill —
is never reached by clicking Roll. The draft sits uncommitted, `rollable` stays false
(`dice-tray.svelte.ts:198`, `canRoll(this.lines)`, and the draft is not in `lines`), and the user's
click does nothing at all. Not a lost first click that a second one fixes: the timeout is the proof
that no number of clicks helps until they go back to the line and type a space.

What the app says about it is a `title` — *"the formula is not fully accounted for"* — on a
**disabled** control, so it is mouse-hover-only and reaches nobody on a keyboard, and it describes a
state the user cannot tell they are in (`2d6` looks finished). The keyboard path is fine, as the
first pass said: Ctrl+Enter goes through the panel handler and is covered by
`Roller.browser.test.ts:105`.

**The method the button calls was built for exactly this case.** `DiceTray.roll`
(`dice-tray.svelte.ts:587`) opens with `this.commit(this.focus)` and its docstring says why: *"Half-typed
text is committed first, so pressing Roll can never quietly leave a token out of the roll it was typed
into."* The `disabled` attribute on the button guarantees Roll is never pressed in the one case that
sentence was written for — and the same docstring's next line, *"Empty when the lines are unrollable,
which the button already shows"*, is what the two halves lean on each other for.

**Fix:** let `roll` be the one that decides, since it already does. Keep `class:muted` on `rollable`
for the affordance and drop `disabled`; `roll` commits, re-checks, and returns `[]` if it is still
unrollable. That also retires the hover-only explanation, because a click can then produce a real
message instead of a `title` nobody on a keyboard can read.

### Suspected, not reproduced — third pass

- **Typing during the authoring form's initial draft scan is discarded.**
  `EditContentForm.svelte:145` — `onMount` awaits `listTypeTargets`, then `listDrafts` (which reads
  every draft file on disk), and then assigns `draft = restored` with **no guard on whether the user
  has already changed it**. Anything typed inside that window is replaced, and `baseline` is reset to
  the restored text so the auto-save effect sees no divergence and schedules nothing. The pending
  600 ms write from before the restore is cancelled by the effect re-running, so the restored draft
  itself is safe — only the typing is lost, plus an orphan draft file under the discarded fresh
  `addGuid` if the timer happened to fire first. Read, not driven: reproducing it wants the browser
  project and a mounted form, and the fix is one condition
  (`if (JSON.stringify(draft) === baseline)`), so the cost of proving it exceeds the cost of the
  guard.

### Not attempted, and why — third pass

One method this repo prescribes was available and deliberately not used, so the next session does not
have to re-derive the decision.

**The `/dev/` probe on the real desktop app.** `AGENTS.md` ▸ Verifying is explicit that filesystem
and network work is signed off there — write a `/dev/<name>` probe, point `devUrl` at it, run the
app, read the report. The toolchain is present (`cargo 1.96.0`, a warm `src-tauri/target/debug`), so
this was a choice, not a blocker:

- **Most of what it would prove was reachable more cheaply, on the same OS.** The behaviours that
  make the desktop path different from `MemoryStorage` are Windows filesystem semantics, and those
  were exercised directly with real `node:fs` on this machine: an `EBUSY` read and an `EPERM`
  rename onto a `FileShare.None`-locked file (finding 83), and the rename contract every
  implementation is measured against (finding 91). The Rust half was read and its one load-bearing
  predicate re-run under real `rustc` (finding 97).
- **What is genuinely left is what a probe still could not reach.** The native folder picker is an
  OS dialog outside any webview — `testing.md:53` already says so — and `walkTree`'s symlink skip
  wants a real junction, which is a filesystem fixture rather than an app run.
- **The tree was shared.** Another session was editing `src/lib/components/RollRow.svelte` and the
  roller docs during this pass; pointing `devUrl` at a probe route means editing
  `src-tauri/tauri.conf.json` and reverting it, and a config edit that outlives its window is the
  kind of leftover that costs somebody an afternoon.

So the honest statement is: **the desktop-only half of storage is READ and reasoned, not RUN.** The
items it leaves open are named in the storage bullet above, and every one of them is a `/dev/` probe
away for whoever has the tree to themselves.

### Ruled out — third pass

- **`EditContentForm`'s `editShipped` captured before the graph loads.** `packRoots` is
  `$derived(content.graph?.packRoots ?? [])` and `editShipped` is computed once at init with
  `state_referenced_locally` suppressed, so an empty `packRoots` would make a SHIPPED row look like
  homebrew and `saveTargetFile()` would return the shipped file to write into. The invariant its
  comment claims does hold: the only two mount sites
  (`compendium/[...entry]/+page.svelte:561`, `:573`) are both inside the `{:else}` of
  `{#if !graph}` (`:372`), so the graph is loaded before the component can exist.
- **`UpcastBuilder.svelte`** — clean. It validates the token it is about to write through
  `parseUpcast`, the same parser the loader uses, so it cannot offer one the app would refuse; every
  control is a real `select` / `input` / `button` with an `aria-label`; and the raw field stays
  editable beside it, which is the way back out of anything the builder cannot express.
- **`isRaging`'s two sourcings are equal** — the backlog assumed it; this proves it. The plugin ctx
  reads `facts.conditions` (`derive-plugins.ts:71`) and the L2 expression ctx reads the resolver's
  live `state.conditions` (`context.ts:129` via `derive-context.ts:112`). Driven across five shapes —
  a direct apply, a guard that refuses the apply, a directly-applied `prone`, and an implied one
  reached two ways — the two views agree in every case, including that a refused
  `apply_condition` registers in neither. The measurements are in finding 93, which is the one place
  the two DO diverge in effect rather than in membership.
- **The plugin memo is bounded and its LRU claim holds** — measured, not read.
  `plugin-registry.ts:175` evicts one entry before inserting when `map.size >= MEMO_MAX`, and
  `memoGet:165` re-inserts on a hit so Map order approximates LRU. Driven with a counting evaluator
  over 600 distinct tokens against `MEMO_MAX = 512`:

  ```
  600 distinct tokens, cold          -> evaluator called 600 times   (no false hits)
  token 0 re-run after 600 inserts   -> called 1   (evicted: the cache holds 512 of 600)
  the 10 NEWEST re-run               -> called 0   (hot)
  tokens 1..10 (oldest) re-run       -> called 10  (evicted)
  token 0 again, after being touched -> called 0   (the touch protected it)
  ```

  The last line is the one that matters: a touched key survives the next eviction wave, so the
  approximation is real LRU for the get+set pattern the derive uses.
- **`plugin.bench.ts` runs** (`vitest bench`), in both projects, and reports the two pure-JS hot
  paths in microseconds — node 304k ops/s fast path and 211k memo hit; chromium 724k and 284k. The
  fast path is 1.4x (node) / 2.6x (chromium) ahead of a memo hit, which is the shape the file's own
  header predicts. Nothing here is near the derive's cost.
- **`Hero.svelte` and `PanelCard.svelte`** — read in full, and everything they carry is already
  filed: the hero's raw `{c.system}` badge is finding 81, and `PanelCard`'s `.drag-handle`
  (`role="button" tabindex="-1"` with only an `onpointerdown`) is finding 53. `PanelCard` is a pure
  dispatcher otherwise, and every head control on it is a real `<button>` or `<a>`.
- **`readCharacterFiles` + `charactersReferencing`** — read. The raw substring scan
  (`diff.ts:234`, `json.includes('"' + key + '"')`) is deliberate and is the right direction to be
  wrong in: a `notes` field quoting a ref over-reports an affected character, which is a louder
  warning rather than a missed one. One caveat worth knowing before trusting the update preview:
  `repository.ts:321` reads each save with `.catch(() => '')` and the empty ones are filtered out, so
  a character whose file cannot be read at that moment is silently absent from "which characters does
  this update affect?" — the one direction that under-warns. Same shape as finding 83's log catch,
  and one `exists()` from being distinguishable.
- **`tools/restamp.ts` and `content/restamp.ts`** — read. `matchStyle` decides the whole file's line
  endings from `original.includes('\r\n')`, so one CRLF inside a quoted cell would flip an LF file to
  CRLF wholesale; no shipped CSV contains a `\r` at all (measured across all 34 files in both packs),
  and the hash normalises `\r\n?` either way, so nothing is reachable from it today. The CLI's
  header claims a terminal-stamped and a UI-stamped file are "byte-identical" — they differ in
  `#content-updated_at`, which the CLI always moves and the UI leaves alone — but that line is
  outside the hash by design (`hash.ts:38`), so the material claim holds.

## Independent verification

Every finding above was reproduced by the reader that filed it. This section records a **second,
independent** re-run by the editor of this document, from the finding's text alone, to catch a
reader that reported something it had not actually observed. A finding is listed here only when it
was re-executed here; silence means not re-run, not doubted.

**Verified — exact match to the reported output.**

| finding | how it was re-checked | result |
| --- | --- | --- |
| 1 · Extra Attack blocked in play | `grep -rn attacksPerAction src/` | only two readers, both display: `SheetAttacks.svelte:24` and `AttacksPanel.svelte:13`. No play path. `trySpend('action')` sits at `sheet-rolls.svelte.ts:180` (the report said 222) |
| 4 · long rest uses the manual max | read `resource-tracker.svelte.ts:241` | `current: c.play.hp.max ?? sheet.maxHp.value` — verbatim |
| 5 · third success pip does not stabilise | read `hit-points.svelte.ts` | `if (kind === 'failures' && ds.failures >= 3) this.die(...)` and no success branch — verbatim |
| 9 · subtracted dice term is added | vitest, real module | `parseDicePool('2d6-1d4') = {"4":1,"6":2}` · `parseFormula('2d6-1d4') = {dice:{4:1,6:2}, mod:0, issues:[]}` · `parseFormula('1d8 - 1d4 + 2') = {dice:{4:1,8:1}, mod:2, issues:[]}` |
| 18 · `on_event` formula is not linted | vitest, real `lintEffectTokens` | the three linted slots each warn "unusual die d7"; `on_event:turn_start:heal:1d7` returns `[]` |
| 22 · `CONTENT_SEED_VERSION` not bumped | read `version.ts:27` + git | still `= 4`; `class_casting_srd.csv` added 2026-09-06, after the last bump |
| 24 · Ctrl+Z on `e.key` | read `RollerLine.svelte:141` | `if (event.key === 'z' && held)` — verbatim |
| 23 · compendium list keyboard-dead | read `EntryList.svelte:46` | `role="button" tabindex="-1"` with an `onkeydown` on the next line — verbatim |
| 28 · two literal English strings | grep | `EffectsPanel.svelte:196` `title="Use one {r.name}"` · `ThemesSettings.svelte:284` `aria-label="{label(token)} colour"` |
| 44 · fractional upcast modifier | vitest, real `evalUpcast` | `damage:per_slot(1d6)+slot/2` at slot 3 → `flat: 1.5`; `count:slot/2` at slot 5 → `flat: 2` (floored). The two branches differ exactly as reported |
| 45 · upcast guard truthiness | vitest, real `evalUpcast` | `1d4 ? damage:per_slot(1d6)` → applies, `pool {6:2}`; `0 ? …` → contributes nothing; `nonsense(( ? …` → `"upcast guard failed: unknown function 'nonsense'"` |

**Verified with a correction.**

| finding | reported | measured here |
| --- | --- | --- |
| 29 · off-token `border-radius` | 63 places | **62** by `grep -rn "border-radius:[^;]*px"` minus the `999px` pill radii (66 including them). The five radius tokens and the ten distinct literals are exactly as reported, and none of the six non-999 literals matches a token — the substance stands, the count was one out. Corrected in the finding above |
| 81 · raw system id | "the roster is the ONE screen" | **four screens, five sites.** The reader grepped `sysbadge` — a CSS class — so its census could only return the roster. Grepping the RENDER finds `Hero.svelte:40`, `BuildHead.svelte:113` and `EditContentForm.svelte:309` as well. Corrected and widened in the finding above; severity raised to LOW-MEDIUM |
| 28 · English literals | "complete for attributes and markup runs, open for props" | the open half is now closed — **finding 92**, six more sites, two of them also printing a raw content-type id, and the two worst found only by also scanning the SCRIPT half (a component's default prop value) |

**Every `file:line` in this document resolves — checked mechanically, third pass.** All 397
line-anchored references were extracted and each resolved against `git ls-files` (bare filenames by
basename, which is how this document mostly writes them) and checked against the file's real length.
**Three were stale and are corrected above** — in `reload.ts` (line 93 → 22, `flushAll`), in
`json-config.ts` (158 → 69, the early return that drops the second `onWrite`) and in `constants.ts`
(184 → 37, the snake-case note). The substance of all three findings was unaffected; the numbers had
simply drifted past the end of files that shrank. *The stale numbers are spelled out in prose here
rather than as `file:line` so that re-running the check does not flag this paragraph — a verifier
that trips over its own changelog is one nobody runs twice.* Three more point outside the app
repo by design — two shipped `conditions_srd.csv` and one crate source — and 14 basenames are
ambiguous across two files, which is inherent to writing `derive.ts:415` rather than a full path.
The check is ~40 lines and worth re-running whenever a batch of findings lands; "in range" is weaker
than "the right line", so it catches drift, not a typo that stays inside the file.

**Also confirmed, on the audit's own terms.**

- i18n parity: 1634 leaf keys in `en.json` and 1634 in `uk.json`, **0** present in one and missing
  from the other, by an independent walk of both trees. Matches the reported sweep exactly.
- The suite is green at the audited commit: 110 files passed, 1 skipped; 2328 tests passed, 3
  skipped. The three skips are the opt-in live-GitHub tests, not disabled coverage.
- No `TODO`/`FIXME`/`HACK`/`XXX` anywhere in `src/`; the six `ponytail:` comments each name their
  ceiling, as the convention requires. No empty catch block — every best-effort swallow states its
  reason.
- Every `src/`, `tools/`, `docs/` and `static/` path named anywhere in the docs exists on disk, with
  one exception that is not a defect: `tooling.md:65` names `tools/visual/_verify.mjs` as the *example*
  filename for a throwaway script you write and delete.

**Two more, re-checked at the source rather than through the reader's harness.**

- **Finding 6 — a 2014 caster cannot be created.** The root cause was re-counted directly in the
  content repo, parsing both `spells_srd.csv` files and counting non-empty `classes` cells:

  ```
  srd-2014 rows 161 classes filled 0
  srd-2024 rows 107 classes filled 107
  ```

  Zero of 161, against 107 of 107. `ls srd-2014/` confirms there is no `spell_lists` file to supply
  the association another way. So the empty Strict picker is not an artifact of the reader's probe —
  the data it reads from is empty by the same count in every row.

- **Finding 38 — rejected plugin target keys.** The regex at `plugin-registry.ts:104` reads, verbatim:

  ```
  /^(ac|initiative|speed|hp_max|attack|damage|save\.(str|dex|con|int|wis|cha)
    |skill\.[a-z][a-z0-9_]{0,31}|passive\.(perception|investigation|insight))$/
  ```

  `speed.fly`, `speed.swim`, `spell_dc`, `spell_attack`, `action`, `bonus`, `reaction` and
  `d20_tests` are absent, and `passive.` is limited to the three senses — exactly the eight the
  finding names. Worth noting for whoever fixes it: the comment directly above the regex explains
  that skills are validated by *grammar* rather than membership because "folding is string-compare
  into arrays (never `obj[key] =`), so an unknown id folds onto nothing" — which is the argument for
  why widening this pattern to the full `NUMERIC_TARGETS` set is safe.
## What was checked and is correct

Recorded so the next audit does not re-derive it.

**Content integrity — clean, and this was the highest-value mechanical check run.** The app's
verifier was reimplemented byte-for-byte from `content/hash.ts` and `meta.ts` (BOM strip, CRLF to LF,
drop the two stamp lines, per-line trailing-whitespace trim, trailing-blank-line strip, xxHash64 via
the repo's own `xxhash-wasm`), including the legacy body-only fallback, and run over every CSV in
both packs: **34 files, 0 not clean-match**. No file is frozen on disk. The vendored
`static/content/` copy matches the same way and is byte-identical to the content repo;
`manifest.json` lists all 17 files per root.

**Effect-token data — clean.** Every `effects` cell of every shipped CSV in both packs, split as
`effectsField` splits it, guard stripped by the real `splitGuard`, then through the real `parseToken`,
the real `lintEffectTokens` and the real `parseExpression` on all four linted L2 slots: **0 unknown
tokens, 0 lint warnings, 0 expression parse errors** across 702 token occurrences and 18 kinds. No
dead data, no malformed token anywhere in the shipped set.

**Loader integrity — clean.** `loadPacks` over each pack with the real `NodeStorage`: srd-2014 1390
rows, srd-2024 1647 rows, and in both **0 issues, 0 drift items, 0 meta issues**, locales `["en","uk"]`.
Papaparse reported zero field mismatches across all 34 files, so no row is short or long against its
header.

**Prose is not a data source — no live exception in `src/`.** Every read of `text`/`text_<locale>`
and of the other prose bases (`material`, `higher_level`) was checked at its site, looking for the
two-statement read-then-extract that the line-based `prose-is-not-data.test.ts` admits it cannot see.
Every hit is display, search index, translate form, or a `slice()` preview. No `Number()`,
`parseInt`, capturing regex or `split` on any prose value.

**The parsed-versus-applied token vocabulary diff is complete and clean.** All 21 `EFFECT_KIND`
members parse, and each populates the `EffectFacts` field it should; `note` and `plugin` produce none
by design. No kind is parsed-but-never-applied, and none is applied-but-undocumented.
`content/schemas.ts`'s `EFFECT_KINDS` is in exact sync with the parser's `EFFECT_KIND`.

**Core removability holds.** `src/lib/rules/` contains zero imports from `effects/` — two comments
only. Core tests do not import the module. `applyEffects` re-folds under `base.clamp`, preserving the
on/off/deleted `{value, trace, notes}` invariant.

**The stacking pipeline is correct**, including the cap-last rewrite: `set`, `floor`, `mult`, `add`
within a layer, layers in `LAYER_SEQUENCE` order, `cap` folded once across all layers before the
clamp. Belt of Dwarvenkind (the only shipped `:cap` row, present in both editions) gives 20 from base
19 plus `+2` plus `set_override:con:20:cap`; a later-layer `set` is not clobbered by an earlier-layer
`add`. The trace was complete in every case — every contribution present, no bare number.

**Unknown effects degrade correctly, end to end.** `frobnicate:ac+2` parses to `kind:'unknown'`,
lands in `facts.unknown`, leaves AC at 10 rather than being dropped, comes back from
`describeDerivedEffects`, and renders as text.

**The expression parser and evaluator behave**, across precedence, left-associativity, lazy `if`
branches, `step`, division by zero, unknown variables and chained comparisons — each surfacing an
error rather than a number. The precedence ladder matches `effects.md` §3 exactly. **No `eval`, no
`Function`, no dynamic dispatch**: identifiers resolve against a closed table and variables against
closed whitelist sets, and `context.ts:56` guards prototype pollution on dotted ids. Cycles are
caught by Tarjan in `dependency-graph.ts` and condemned to `inert` plus a `dependencyCycle` issue —
no fixpoint loop.

**The comma-scope rule now has no third implementation.** All three consumers split and require every
part — `roll.ts:389`, `attacks.ts:292`, and the token grammar itself. There is no fourth. The
previous audit's finding 4 is fixed with no siblings left behind.

**The `half` to `partial` rung rename is complete** across the parser, `PROF_ORDER`, `skillCheck`,
`facts.ts`, both panels and both catalogs, and the `proficient` roll scope correctly excludes
`partial`, which is what Reliable Talent requires.

**Multiclass math is right.** Fighter 5 / Wizard 5 on real srd-2024: level 10, PB +4, maxHp 74 by
RAW, hit-dice pools kept separate as `d10:5, d6:5`, `attacksPerAction 2` rather than 3, saves
proficient on the first class only, no missing entries and no derive issues. Spellcasting shape
likewise: caster level 5, the wizard's own slot table, one profile, warlock correctly excluded.

**Recharge, rests and the turn economy** behave as the previous audit's fixes left them —
`restRecharge`, `parseRecharge`, `rechargeRank`, `hitDiceRecoveredOnLongRest`, `TurnEconomy`'s
all-or-nothing spend, `gain_action` granting rather than refunding, and the short rest deleting only
the pact slot key.

**Instant death and damage at 0 HP** match the SRD paragraph clause by clause, and every exit from
dying resets both the death-save track and the crit answer — the previous audit's findings 2 and 3
are genuinely fixed.

**Crit doubling, advantage composition and the roll record are correct.** The flat modifier is never
doubled; every pool and bonus die gains a twin that keeps sign and source and inherits reroll and
min-die; a d20 is never twinned. `netAdvantage` cancels correctly, `setAdvantage` draws only on the
first switch away from neither, and `keptD20`/`droppedD20s`/`naturalOf` all derive from the dice plus
the mode, so a mode switch cannot disagree with the dice. Statblock average form (`12 (2d6 + 5)`)
rolls `2d6+5`, not `2d6+17`. `d%` is surfaced as an issue rather than silently dropped. The in-session
log cap matches the disk cap.

**i18n parity is complete.** Every literal key passed to a translator across `src/` exists in
`en.json`: 0 missing. The `en`/`uk` key-set difference is **0 in both directions**, 1634 leaf keys
each, guarded ongoing by `catalogs.test.ts`, which also asserts no blank value and ICU-placeholder
parity. The 17 keys never appearing literally in `src/` are all consumed through template lookups —
no true orphans. `LOCALES` is the single registry and every consumer discovers from it; no component
hardcodes a language.

**Colours are fully tokenised** — 0 hex, `rgb(` or `hsl(` outside `tokens.css`, across every
`.svelte` and `.css` in `src/`. **`base` is on every internal link** — all 11 `goto()` sites, every
internal `href`, both link helpers, the palette and the one `location.assign`: 0 violations.
**`$derived` is pure** — a scan of all 300+ bodies for outer-scope assignment, store writes,
navigation, toasts, fetch, storage and console produced 8 hits, all false positives (local `Map.set`
/ `Array.push` inside pure IIFEs).

**The repo's own hygiene holds.** The suite is green (2328 passed, 3 skipped — the three skips are
opt-in live-GitHub tests). No `TODO`/`FIXME`/`HACK` anywhere in `src/`; the six `ponytail:` comments
all name their ceiling. No empty catch blocks — every best-effort swallow says why. Every `src/`,
`tools/`, `docs/` and `static/` path named in the docs exists.

## What was not reached

The readers were interrupted once by a session limit and resumed for a checkpoint, so each area has a
remainder. Listed so the next pass is deliberate rather than a re-sweep.

- **Plugins (L3) — covered in the second pass** (findings 38–47), and the SURFACE half is now read
  and clean. `PluginConsentDialog.svelte` carries `dismissOnEscape` and `trapFocus`, renders every
  manifest field as plain text, and shows the `url` as text rather than as a link.
  `PluginsSettings.svelte` is real `<button>`s throughout — the kill switch, refresh and every
  per-plugin toggle — so none of findings 23–27 repeats here. The manifest caps the spec states are
  enforced by a strict zod schema (`plugin-host.ts:35`), so no unbounded attacker text reaches the
  dialog. The namespace-collision path is sound end to end: `discoverPlugins:141` marks the second
  claimant `ok: false` with a problem, and `pluginStatus:186` returns `broken` before it touches
  prefs — so the fact that `consent` / `enabled` / `loadErrors` are all keyed by NAMESPACE ALONE,
  while the list is keyed `origin/namespace` and its own comment says "the namespace alone is no
  longer unique", cannot be reached by a runnable plugin. Two small things left standing, neither
  worth a numbered finding: `plugins.md:100` says the `url` *"opens in the OS browser, never
  in-app"* and nothing opens it anywhere — the consent dialog is its only consumer and shows it as
  text, so the doc line promises a behaviour that does not exist; and `PluginsSettings.svelte:106`
  checks `loadErr` ahead of `p.problem` for the status badge only, so a duplicate-namespace loser
  can be labelled "load failed" while its own row explains the clash.

  `isRaging`'s two sourcings are now PROVEN equal rather than assumed — see *Ruled out — third
  pass* — and `UpcastBuilder.svelte` and `EditContentForm.svelte` are read (the first clean, the
  second contributing to findings 92 and the third pass's one suspicion). What is left of the item is
  the engine's edges: the load-time microtask queue undriven, and discovery over the real Tauri `Storage` —
  Windows case-folding against `NAMESPACE_RE`, a plugin folder inside a watched pack directory —
  which wants the `/dev/` probe this pass did not run.
- **Storage and packs — covered in the second pass** (findings 30–37), and the Rust half is now read:
  finding 97, with the trust predicate re-run under real `rustc` and the escape traced through the
  `tauri` and `tauri-plugin-fs` crate sources to the layer that actually stops it.
  `discardFailedCopy`'s empty-target-only claim holds — `migrateDataDir` is the sole caller and
  `StorageSettings.svelte:149` gates it behind `dirIsEmpty(target)`; the residue is a TOCTOU window
  (anything that lands in the target between the check and a copy failure is deleted by the recursive
  sweep), which is inherent to check-then-act on a folder the user just picked.
  `copyFilesInto`'s mtime asymmetry is documented at the function itself and unchanged.
  `remote/github.ts` is now read whole and came back clean — `branchCandidates` costs one request in
  the ordinary case and only the failing path pays for the rest, the ETag is repo-scoped and survives
  the branch fallback correctly, `truncated` short-circuits ahead of `MAX_REPO_PACKS`, and
  `isPackFile`'s `.csv` test matches the loader's byte for byte (`loader.ts:350`), so the two sides of
  a diff cannot disagree about what a pack file is. `storage/browser.ts` is read and measured under a real
  IndexedDB — finding 91, which carries the scan costs too. `content/store.svelte.ts` is read —
  finding 86.

  **What is left of this item needs the real desktop app and was not run** — see *Not attempted, and
  why* below: the data-folder move driven end to end, `walkTree`'s symlink skip against a real
  junction, and the native picker, which no driver reaches.
- **The SRD converters — deliberately OUT of scope, not merely unread.** Five converter commits in
  the window are unopened and will stay that way: `docs/work/content.md` ▸ CONVERTERS-SUNSET puts the
  block up for possible deletion, and reading 3 500 lines to improve code that may go is the
  expensive kind of thorough. The one thing worth extracting from it is the `see_i_nvisibility` slug
  bug, which is a live data defect and whose *shape* outlives whatever produced it.
  `restamp.ts` is a different matter and stays on the list — it is runtime-adjacent, it is what any
  future import path leans on, and it is unread (the hashes are clean, so nothing is mis-stamped
  today).
- **Character persistence — covered by findings 73-81, and by 83-84 in the third pass.**
  `repository.ts`'s roll-log half is now read in full and its failure path measured against a real
  Windows lock (finding 83); `readCharacterFiles` is still unexercised. `schema.ts` was read against
  the play writers this time, which is where finding 84 came from — but only for the bounded fields;
  `store.svelte.ts`'s `seedDemoIfFirstRun` and `recreateDemoCharacter` read, not driven;
  `drafts/store.ts` is read in full — findings 88, 89 and 90, all reproduced on a real filesystem,
  and `findUnreadableDrafts` / `deleteDraftFiles` themselves came back correct (a missing path does
  not stop the sweep);
  `derive-plugins.ts` is read: `pluginResources`' own-property guard
  is correct (`Object.hasOwn` against a prototype key, and `Math.max(0, max - spent)` clamps a stale
  spent the way its siblings do), and the plugin-granted condition path expands exactly ONE level,
  the same rule the main resolver applies — see finding 93 for what that rule costs against shipped
  content.
- **Builder state machines — covered by findings 73-81 and 87**, and `previewSheet`'s reused trial VM
  came back clean, including the `$state`-inside-`$derived` question its own docstring raises.
  `ability-allocation.svelte.ts`'s boost reconciliation — the UBUG-13 subtraction — is finding 87, and
  it is the worst thing in this pass. Left: in
  `build-view-model.svelte.ts`, `list()`'s RV3 keep-set is read and complete — `refsHeld`
  (`draft.ts:370`) covers every ref-holding draft field, checked against `DraftState` line by line.
  What the same check found instead is finding 94: the inventory mapper beside it drops a field the
  draft type never had. `build/blocks/` was not read line by line but was swept for this audit's
  recurring shapes and is CLEAN on them — no `role="button"` and no `onclick` on a `div`/`span`
  anywhere in its 34 files, one `a11y_no_static_element_interactions` suppression
  (`Inspector.svelte:62`) which is a background-click clearer whose `onkeydown` correctly reads
  `e.code`, and no untranslated user string (the finding 92 scans covered it). `assembled`'s prepared/alwaysPrepared split is
  finding 96. Still open there: no `/dev/` probe was written, so the photo write,
  the backup ring under a Windows rename refusal and `deleteCharacter` against an open handle are
  unproven on a real desktop install.
- **Combat remainder — covered by findings 60-70, and the third pass closed the reading tail.**
  `CombatStrip.svelte`, `blocks/Abilities.svelte`, `DeathScreen.svelte`, `panel-layout.svelte.ts`,
  `menu-overlay.svelte.ts` and `rest-controls.svelte.ts` are now read in full and came back clean of
  new defects — the short-rest hit-dice picker steps through real `<button>`s, the combat overlay it
  opens in carries `dismissOnEscape`, and `panel-layout.restore` reconciles a saved layout in both
  directions. `provenance` (`actions/provenance.ts:102`) turns any traced value that is not already a
  control into a tab stop, so the Speed tile being a `<div>` is not the a11y gap it looks like.
  One thing was noticed and is a maintainer's call rather than a finding: `spendHitDie`
  (`rest-controls.svelte.ts:63`) heals `Math.max(1, roll + CON)` and calls the floor RAW, and the
  rest chapter is in no shipped CSV, so nothing in this repo can check the claim. It only bites a
  character with a negative CON modifier. `Hero.svelte` and `PanelCard.svelte` below their markup are
  still unread.
- **Roller remainder — covered by findings 56-59**, and closed. The locale surface holds: an unnamed
  roll carries `roller.customRoll` as its KEY and the literal `'Custom roll'` only as the fallback
  `sayRollName` reaches for when there is no translator, so a log line is not frozen in the language
  it was rolled in.
- **UI remainder — one line left.** Closed: all 36 `$effect` sites (none cycles), the `LangSwitcher`
  sweep (finding 54), the unfocusable-clickable census (finding 52), the duplicated-CSS census
  (finding 71 — 102 blocks, 100 cross-file, by the repo's own `css-dups.mjs`), the `outline: none` pass, and the four
  reverse-state pairs, of which pack rollback, source toggling and theme removal are complete and the
  spell pin is finding 68, and the builder pickers' ARIA, driven in chromium — finding 72, with the
  contract's own walk confirmed correct once focus reaches it.
- **The both-editions sweep — closed.** See queue item 8 below: 96 class sheets and 811 build-path
  derives across both packs, zero issues, zero unknown tokens, zero missing refs, with a control that
  fires. What it does NOT cover is the play loop — a rest, a cast, an action option — which is still
  mostly one-pack, and findings 82's table is the parameterised part of it.

## A note on scope

Three findings — 19 (`blocks_concentration`'s raw chip), 21 (the `suggest.ts` doc line) and the
cross-edition slug divergence under 22 — predate `v0.6.2` and are recorded because they were found,
not because this release caused them. Findings 7 and 22's blast radius are content-repo facts
surfacing as app-side wrong numbers; both halves are named.

## How to continue this scan in a later session

The audit is one pass, not a finished sweep. *What was not reached* above is the backlog; this
section is how to work it without re-deriving anything.

**The shape that worked.** One reader per subsystem, run in parallel, each told: read `AGENTS.md`
then the subsystem's own doc first; scope with `git diff v0.6.2..HEAD -- <path>`; **reproduce every
finding** with a throwaway script rather than inferring it; do not edit any repo file; report as four
parts — CONFIRMED (title, severity, `file:line`, what is wrong and which doc line it violates, the
observed output, the smallest fix) · SUSPECTED but not reproduced · RULED OUT · NOT YET CHECKED. The
fourth part is what makes the next session cheap, so demand it.

**Budget.** Six readers at once exhausted a session mid-run. Three at a time is the working number.
Temp tests go in the repo only when module resolution demands it, named `*.audit-tmp.test.ts` and
deleted before reporting; everything else belongs in the scratchpad.

**Do not re-check** anything under *What was checked and is correct* — content hashes, the token
vocabulary diff, i18n parity, `base` on links, colour tokenisation, `$derived` purity, the stacking
pipeline, crit doubling, the comma-scope rule, multiclass math. Those were run mechanically over the
whole surface and came back clean.

### The queue, highest value first

1–3. **Plugins L3 · Storage · Pack update and rollback — DONE**, findings 30–47, and the third pass
   closed the tails: the consent dialog and Settings keyboard path (clean), `github.ts` whole
   (clean), `browser.ts` under real IndexedDB (finding 91), `content/store.svelte.ts` (finding 86)
   and the Rust half of the data-dir grant (finding 97). The ONLY thing still open across all three
   is what needs the app running — see *Not attempted, and why*. Two lessons from that pass are
   worth carrying: read the files **in full** — both readers found their best material past the
   point a skim would have stopped — and verify anything filesystem-shaped against a **real** fs,
   because `MemoryStorage` silently merges a rename that Windows refuses. The third pass adds a
   third: **when the question is about a boundary, read the layer BELOW it too.** Finding 97 looked
   like an escape until the `tauri` and `tauri-plugin-fs` sources showed what actually blocks it, and
   the answer changed the finding from "exploit" to "an invariant nothing in this repo enforces".
Items 4–7 were each STARTED by a reader and stopped within minutes, before any file was read through.
**Nothing from those aborted runs is recorded anywhere in this document.** Findings 48–55 came later
and from a different source — the editor's own pass, working the same items by hand — so where an
item below says something is closed, that is the hand pass talking, never the aborted one.

4. **Character persistence and builder state — DONE**, findings 73-81, plus the three suspicions
   settled by hand earlier. What is left of the item is listed under *What was not reached*, and the
   sharpest of it is that nothing here ran against a real desktop install.

   The three suspicions this item carried became findings 48, 49 and 50 in the hand pass before it,
   and `switchSystem`'s drop sweep was checked there and is correct (`pickSpecies` does clear
   `speciesBoostPicks`, which was the suspected gap).
5. **Combat remainder — DONE**, findings 60-70. Two of them are reverse-state defects (a condition
   the app's own Switch will not switch off, a dialog Escape cannot close) and two are identity
   defects of the same shape — a bare id where the ref belongs. What is left is listed under *What
   was not reached*.
6. **Roller remainder — DONE**, findings 56-59: the caret state machine, `movePill` across lines,
   `setDamage`'s `real` filter and the two-column picker. `savageReroll`'s split is correct and its
   tie case is recorded as suspected, not a defect. Nothing of it is left open.
7. **UI remainder — DONE**, findings 71 and 72. The builder pickers' ARIA was driven rather than
   read, and so were findings 64, 65 and 67: all three reproduce in chromium.
8. **The both-editions sweep — DONE, and clean.** Every shipped class in both packs was derived at
   levels 1 / 5 / 11 / 20 (12 x 4 x 2 = 96 sheets) and every species, background, feat and item in
   both packs was put through the build path one at a time (811 more), reading `deriveIssues`,
   `facts.unknown` and `missing` on each. **Zero** of any of the three, and the probe's own control
   (a bogus `species:Nope:nope` / `feat:Nope:nope` ref) fires `missing=1` in both packs, so the
   silence is a measurement rather than a broken probe.

   The edition divergences that showed up are all the ones the rules actually have and the code
   already asserts: fighter Second Wind 1 (2014) versus 2/3/4 (2024), monk `ki` versus
   `focus`+`uncanny_metabolism`, barbarian `rage/Infinity` at 20 (2014) versus `rage/6` +
   `persistent_rage` (2024), and the prepared-cap formula versus table. Slot pools are identical
   across editions at every level and match the SRD table (4,3,3,3,3,2,2,1,1 at 20). The one real
   divergence is finding 6, visible here as `acc0` on every 2014 caster against `acc109` /
   `acc218` on the 2024 ones.

9. **The third pass — findings 82-97.** It worked the backlog above rather than a subsystem, so what
   it leaves is not a subsystem either. Highest value first for whoever picks it up:

   - **Three round-trip losses share one root and one fix** — 87 (a moved ASI grants both abilities
     and compounds), 94 (a template weapon loses its base) and 96 (every prepared flag is recomputed).
     All three are the builder rebuilding a play-side field instead of carrying it, and ONE test
     closes all three: `character → hydrate → assembled` must deep-equal on `build` when nothing was
     clicked. That test is worth writing before any of the three fixes.
   - **The silent-failure family now has four members** — 30 (pack writers), 77 (Create), 83 (every
     play-loop save, plus the roll log and the reload flusher) and the route-load sites named in 83.
     One `guarded`-shaped helper retires the lot; doing them one at a time will miss the next one.
   - **Two doc lies with teeth** — 95 (`content.md` names a bare-id link as full-key, and a
     maintainer "fixing" it breaks every homebrew pack extending an SRD class) and 97's tail (the
     desktop sandbox boundary is documented only inside the file it guards).
   - **One content fix** — 93, a `charnik-content-srd` commit plus the gate that stops it returning.

### The suspected items, which are cheap to settle

Each is a short probe away from being a finding or a dismissal, and they are listed with their
evidence under the *Suspected* headings. Four have since been settled and became findings 48–50 and
55 — `switchClass` wiping picks on the first class, the orphaned expertise entry, the stale
half-feat ability, and the unreachable bare ability check — which is the argument for spending the
probe rather than leaving the suspicion standing: all four turned out to be defects, and three of
them cost the player something.

The third pass spent the remaining probes. Settled there: `restoreUpTo`'s unclamped spent (not a
defect — the sibling `min` clamps it anyway), the three token kinds' reachability (reachable, through
user content only), the scoped damage bonus's row-versus-roll split (finding 82), the dotted
scope-plus-qualifier collision (finding 85) and `set_override`'s divergent target grammar (loud, so a
spec divergence rather than a defect).

Nothing is left on this list. The last one — whether the Roll button eats a click on a half-typed
token — needed a browser rather than a node probe, and is finding 98.

# Audit — everything since 0.6.2

Covers `v0.6.2 3104f2a 2026-08-22` through `b79d255 2026-09-07`: 254 commits, 395 files,
+37 546 / −11 788. Read for IMPLEMENTATION defects — a number that comes out wrong, a rule the code
knows in one place and forgets in another, a half-finished change whose siblings were left behind —
not for missing features.

Six readers went over the release in parallel, one per subsystem: rules core and derive, combat and
play state, the roller, the effects module, content and storage, the UI surfaces. Each finding names
the method that reproduced it, and the ones that could not be reproduced are kept separate under
their own heading rather than mixed in.

Coverage is **partial by construction** and each reader says where it stopped — see *What was not
reached* at the end. Read that section before concluding a subsystem is clean: "not reported" here
means "not read", not "correct".

## The dev toolbox

### A · TRIVIAL · the content-health probe is the one page the dev toolbox does not list

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

### 1 · HIGH · Extra Attack is on the sheet and blocked in play

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

### 2 · HIGH · a standard action rolls its skill check with no effect key

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

### 3 · MEDIUM · an owed concentration save outlives the spell it was owed for

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

### 4 · MEDIUM · a long rest restores HP to the *manual* max, not the *effective* max

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

### 5 · MEDIUM-LOW · filling the third success pip by hand does not stabilise

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
- **`restoreUpTo` reads spent unclamped.** `resource-tracker.svelte.ts:~163` uses
  `c.play.resourcesSpent?.[id] ?? 0` where every sibling uses the clamping `resourceSpent(id)`.
  Matters only after a pool's max shrinks.
- **Scoped damage bonuses show on the roll but not on the attack row.** `scopedAttackBonus` folds
  only `target === 'attack'`; a scoped `flat_bonus:damage…` (2014 Rage) reaches the roll via
  `attackSpec`'s `effectsFor('damage', scopes)` but never the panel's `formatDamageParts`. May be the
  intended "row static, roll live" split — not confirmed either way.

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

### 6 · HIGH · a 2014 caster cannot be created at all

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

### 7 · MEDIUM · a 2014 half-caster has spell slots at level 1

`character/spellcasting.ts:307` — `slotCountsFor(slotTable(graph,'half'), classLevel)` indexes the
`half` table by **class level**. `srd-2014/spell_slots_srd.csv` row `half_1` is `2,0,0,…`, which is
the multiclass caster-level value, not the 2014 ranger/paladin class-level value. RAW 2014: no slots
until level 2.

**Reproduced** — 2014 Ranger 1, WIS 16: `pools: ["slot-1:2"]`, `maxSpellLevel: 1`, `preparedCap: 3`.
RAW is 0 slots, 0 known, max spell level 0. Levels 2+ are correct (`half_2 = 2`, `half_3 = 3`,
`half_5 = 4,2`).

A one-cell content error — `half_1` should be zeros in `srd-2014` only, since 2024 rangers do cast at
level 1. Recorded here because it surfaces as a wrong number out of the derive.

### 8 · MEDIUM · the builder and the derive disagree about a feat-granted skill

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

### 9 · HIGH · a subtracted dice term is silently ADDED, and `issues` reports nothing

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

### 10 · HIGH · two rolls in the same millisecond share one identity; an amendment rewrites both

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

### 11 · MEDIUM · a retroactive re-read loses the roll's `min_die` / `reroll` floor

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

### 12 · MEDIUM · the dice tray cannot carry `labelValues`, so a tray roll's name loses its ICU values

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

### 13 · MEDIUM-LOW · `bumpPill` leaves a stale `text`, and unfolding it flips a penalty die's sign

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

### 14 · LOW-MEDIUM · a forced-outcome marker is never persisted

`roll-journal.svelte.ts:319` — `logMarker` never calls `this.persist`. `StoredRollLogEntry.outcome`,
`rehydrateLogEntry` (`roll.ts:209`) and `logLineFor`'s `Number.isFinite(roll.total)` guard
(`repository.ts:398`) are all built for this line, and nothing writes it.

**Reproduced:** `logMarker({text:'DEX save', key:'k'}, 'fail')` gives
`marker persisted? 0 log len 1 total NaN`. So a paralysed character's auto-failed save is in the log
until reload and gone after, and the same applies to `spell-casting.svelte.ts:417`'s no-roll cast
marker.

**Fix:** one `this.persist?.(entry)` in `logMarker`. `logLineFor` already omits `result` for a `NaN`
total.

### 15 · LOW · a doc that lies: `rerollKeptD20` no longer exists

`docs/internals/roller.md:211` is a normative "Conventions" bullet describing `rerollKeptD20` and
per-edition Heroic Inspiration. Commit `9984cb2` deleted the function from `rules/dice.ts` and the
whole control; its file list does not include the doc. AGENTS.md: "Fix the docs in the change that
proves them wrong."

**Fix:** replace the bullet with what `AMENDMENT_KIND.d20Reroll` now is — a legacy kind kept so old
logs stay readable, which `roll.ts:249` already says.

### 16 · LOW · `adv` typed on a damage line is accepted, invisible and ignored

`dice/roller.ts:202` checks `ADVANTAGE_WORDS` before the resolver. `vocabularyFor`
(`dice-tray.svelte.ts:136`) withholds mode rows from a damage line, and the doc claims "because the
same list backs the resolver — typing the name in full can't get past what the menu withheld".
`ADVANTAGE_WORDS` is not that list.

**Reproduced:** `addToken(emptyLine(damage), 'adv')` gives `advantage ["dice"]` on a damage line. The
mode is set, no toggle renders it, and `DiceTray.roll()` only ever reads `testRoll(test)` — so it
does nothing, for ever.

**Fix:** gate the `ADVANTAGE_WORDS` branch on `line.role === ROLLER_ROLE.test`, which `addToken`
already has, so the word falls through to `wordPill` and becomes a label.

### 17 · LOW · an ambiguous effect name silently becomes a damage TYPE on a damage line

`dice/roller.ts:341` (`wordPill`) versus the comment at `:522`. `candidateResolver` returns null for
a name two candidates share, which the comment says lands as a blocking `raw` pill — "true whether
the fragment is nonsense or merely ambiguous". On a damage line `wordPill` converts every raw word
into a damage type first, so the ambiguity never reaches `rollerIssues`: typing `bless` when two
packs both ship a Bless adds a damage type named "bless" and drops the `+1d4`. Needs two
identically-named rows, hence LOW.

### Suspected, not reproduced — roller

- **The Roll button may be disabled at the moment you click it with a half-typed token.**
  `Roller.svelte:97` is `disabled={!diceTray.rollable}` while `dice-tray.svelte.ts:588` commits the
  draft *then* checks `rollable`, and `rollable` reads `canRoll(this.lines)` — the uncommitted draft
  is not in `lines`. Confirmed in a real chromium drive: after typing `2d6` with no trailing space,
  `disabled-before-click: true, pills: 0, draft: ["2d6"]`. Not observed: whether the click still
  lands, since a disabled button swallows the event in Chrome and whether the blur commit fires first
  is the open question. The keyboard path is safe — Ctrl+Enter goes through the panel handler and is
  covered by `Roller.browser.test.ts:105`.
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

### 18 · MEDIUM · `on_event`'s action formula is the one L2 slot `lintEffectTokens` still does not lint

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

### 19 · MEDIUM · six token kinds have no `effectTag` formatter, and a raging barbarian sees the raw string

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

### 20 · LOW · `mergeFacts` uses a different resource tie-break from `collectFacts`, while claiming it is the same

`effects/apply.ts:361` versus `:305`. `pushResource` picks the larger max and, at an equal max, the
faster recharge (`rechargeRank`, added by `5f89962`). `mergeFacts` — the plugin pre-pass path — still
compares max only, while its docstring (`:337`) asserts it applies "the same rule `collectFacts`
itself applies within one pass". It no longer does: a plugin returning a `grant_resource` with the
same max and a faster trigger silently loses.

Read-only evidence: `rechargeRank` appears at `apply.ts:29` and `:313` and nowhere in `mergeFacts`.
Not exercised at runtime because no shipped plugin grants a pool.

**Fix:** add the `rechargeRank` tie-break to `mergeFacts`.

### 21 · LOW · the effects spec names a file that no longer exists

`docs/internals/effects.md:47` lists `suggest.ts` as an effects-module file and `:156` points at "a
`suggest.ts` did-you-mean". Commit `5a60e46` moved it out ("didYouMean leaves effects — nothing in
effects ever called it"); it now lives at `src/lib/util/suggest.ts` and is called from
`character/derive-targets.ts:10`. Predates `v0.6.2`.

**Fix:** point both lines at `util/suggest.ts` and name `derive-targets.ts` as the caller.

### Suspected, not reproduced — effects

- **Are `on_event` / `regain_on_initiative` / `damage_reroll` tokens actually reachable by
  `effectTag`?** Confirmed only for `blocks_concentration`. The other three ship on class features and
  feats (`class_features_srd.csv:396`, `:438`, `:80`; `feats_srd.csv:20`), which enter the sheet at
  layer `feature` rather than as `EffectInstance`s, and `describeDerivedEffects` (`effects-view.ts:231`)
  emits only numeric facts. Evidence so far says the raw render is probably not reachable for those
  three today — which makes finding 19 a latent trap for them and a live bug only for
  `blocks_concentration`.
- **`flat_bonus:attack.<scope>:<qualifier>` drops the dotted scope.** `token-parser.ts:239` and
  `:253` spread `qualifierSlot` after `scope`, and `qualifierSlot` (`:202`) returns `{scope: q}` when
  the base target is `attack` — so a token carrying both slots would have the first overwritten. No
  shipped row uses both. Read, not run.
- **`set_override` never runs `scopedTarget`.** `parseSetOverride` (`token-parser.ts:269`) returns
  the literal target, so `set_override:damage.melee:5` keeps `damage.melee` and gets no scope, unlike
  `flat_bonus`. It would then be rejected by `isEffectTargetSupported` and surfaced, so it degrades
  loudly — but the two parsers say different things about the same target grammar.

## Content and storage

`src/lib/content`, `src/lib/storage`, `tools/srd`, and the sibling `charnik-content-srd` repo — 63
app commits and 22 content commits in the window.

### 22 · HIGH · `CONTENT_SEED_VERSION` was never bumped for 0.7.0, so a new shipped file and 18 commits of rules data can never reach an existing install

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

### 23 · HIGH · the compendium list has zero tabbable elements — the whole list is keyboard-dead

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

### 24 · HIGH · Ctrl+Z in the dice roller is bound to `e.key`, so it is dead on a Cyrillic layout

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

### 25 · HIGH · a resource-borne effect can be added but not removed without a mouse

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

### 26 · MEDIUM-HIGH · every secondary control on a combat spell row is mouse-only

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

### 27 · MEDIUM · resource pips in the combat strip are click-only

`src/routes/combat/blocks/CombatStrip.svelte:111` — `<span class="resource-pip" role="button"
tabindex="-1">`, `onclick` only, with the a11y warning suppressed. `ui.md` rule 7 makes pips a
first-class interaction ("Resource, slot, and economy pips are click-to-set") and requires a keyboard
path. `Turnbar.svelte:35` carries an explicit comment justifying its own `tabindex="-1"` pips by
naming the pill-based fallback; `CombatStrip` has the same shape with no such fallback documented,
and its enclosing `<button>` fires `useResourceOrEnter` — spend one, not set to N. So keyboard users
can spend a pip but cannot restore one.

**Fix:** either document the same pill-based fallback the Turnbar has, or give the pip row a roving
tabindex with left/right.

### 28 · MEDIUM · two literal English user-facing strings in `.svelte`

- `src/routes/combat/blocks/panels/EffectsPanel.svelte:196` — `title="Use one {r.name}"`
- `src/lib/components/settings/ThemesSettings.svelte:284` — `aria-label="{label(token)} colour"`

AGENTS.md ▸ Locales, and `ui.md`: "A user-facing sentence is a key in `src/lib/i18n/locales/*.json`."
The second is worse than it looks — it is glued from a value plus an English noun, which `ui.md` bans
outright: "A phrase is ONE key, never a noun substituted into a frame."

**Evidence:** a scan of every `title=`/`aria-label=`/`placeholder=`/`alt=` literal and every bare
markup text run across all non-`/dev` `.svelte` files returns exactly these two, plus `"Ctrl K"` at
`+layout.svelte:362`, a key-cap glyph that is correctly untranslated. The i18n sweep is otherwise
complete.

**Fix:** an ICU key taking `{name}`, and a whole `themes.tokenColorLabel` key taking `{token}`.

### 29 · MEDIUM · `border-radius` is off-token in 62 places, and stylelint guards font-size but not radius

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

### 30 · MEDIUM-HIGH · three of the four pack writers have no `guarded()`, so a disk failure is an unhandled rejection and a half-done state

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

### 31 · MEDIUM · `installPack` asks only the registry whether a folder name is taken; `renamePack` also asks the disk

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

### 32 · MEDIUM · the overwrite guard is asked on the write path and never on the DELETE path

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

### 33 · MEDIUM · the Tauri architecture gate does not see dynamic `import()`, and one lives above the seam

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

### 34 · MEDIUM-LOW · `homebrew.ts` re-stamps any file it is handed, destroying a hand-edited file's permanent protection

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

### 35 · LOW-MEDIUM · `configWritesSettled` names the data-folder move as its reason to exist, and the move never calls it

`json-config.ts:94`: "Resolves when every queued write for this file has landed. For the callers that
must not race the queue — **a data-folder move (which swaps the Storage under it)** and the tests."
`grep -rn "configWritesSettled" src/` returns the definition and its own test. Nothing else.

The move is `StorageSettings.svelte:157` → `migrateDataDir` → `finalizeMove` (`tauri.ts:172`:
`setDataDirOverride`, then `fsRemove(oldDir, {recursive:true})`) → `reloadApp()`, whose `flushAll()`
(`reload.ts:93`) drains only the `onBeforeReload` set — the config queue is a separate chain and is
not in it. So a `charnik.config.json` write queued moments before the move (a pin, a
`dismissedMissing`, an ETag) is copied in its pre-write state, and the queued flush then executes
against a cached `TauriStorage` whose root points at the folder `finalizeMove` just deleted. A narrow
race — but the one function written to close it is dead code.

**Fix:** one line — await it before `migrateDataDir`/`mergeDataDir`, or register it as an
`onBeforeReload` flusher so every reload path gets it.

### 36 · LOW · `content.md` describes a watcher mechanism the watcher does not have

`content.md:218`: "The file watcher **ignores the app's own writes**, or a write triggers a reload
which triggers a write." `watcher.ts:8` documents the opposite design, and is what the code does:
"`reloadContent()` only READS (never writes), so the app's own homebrew save can't create a
write→reload→write loop — at worst one redundant re-read." There is no own-write suppression
anywhere in the file; the only gate is `isPackWriteInFlight()` (`:54`), which is about swaps.

The loop the doc guards against is in fact closed, but by a different argument: `autoAdoptDrift`
(`review.svelte.ts:94`) *does* write from the watcher callback, and terminates because a re-stamped
file no longer drifts, plus the `adopting` re-entrancy flag at `:83`.

**Fix:** replace the sentence with what is true.

### 37 · LOW · the `Storage` interface promises a sandbox two of its four implementations do not enforce

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
  the same tick discards its `onWrite` (`json-config.ts:158`), which would violate `packs.md`'s "A
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

### 38 · HIGH · eight of the eighteen documented contribution target keys are rejected, and they take the whole result down with them

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

### 39 · HIGH · the per-derive budget does not cover the post-trip sandbox rebuild, and a sibling handler's success keeps the fail-closed counter from ever firing

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

### 40 · MEDIUM · the plugin ctx's `hpMax` and `isBloodied` disagree with the max the app clamps to

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

### 41 · MEDIUM · `plugins.md` §4.3 describes pre-D12 `set` semantics

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

### 42 · MEDIUM-LOW · the web demo does ship the QuickJS runtime — 528 KB of it

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

### 43 · MEDIUM-LOW · deleting a hand-placed plugin folder leaves its consent, so re-dropping the same bytes runs it with no dialog

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

### 44 · LOW · a dice-carrying upcast formula produces a fractional modifier

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

### 45 · LOW · upcast has a second, more permissive guard-truthiness rule than the resolver

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

### 46 · LOW · the `readPlay` memo flag is a sandbox self-report, and a handler can forge it

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

### 47 · TRIVIAL · `registerPluginEvaluator` resets half the cross-evaluator state

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

### 48 · HIGH · un-picking a skill orphans its expertise, and the orphan then evicts a live one

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

### 49 · MEDIUM · picking your FIRST class empties the skills you already chose, unrecoverably

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

### 50 · MEDIUM · swapping a half-feat keeps the old ability, which the boost then silently ignores

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

### 51 · MEDIUM-HIGH · the effective HP max has two callers and four hand-rolled copies, and one of them decides a rules guard

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

### 52 · MEDIUM · the click-only resource pip has a second home, which finding 27 does not name

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

### 53 · LOW-MEDIUM · panel reordering is pointer-only, and its handle claims to be a button

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

### 54 · MEDIUM · the "no exceptions" language-switch rule has five exceptions, and a modal is where it matters most

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

### 55 · HIGH · a bare ability check is the one d20 roll no effect reaches, and its own sibling six lines away does it right

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

- **Plugins (L3) — covered in the second pass** (findings 38–47); the remainder is the surface, not
  the engine: `PluginConsentDialog.svelte` unread (what it shows, and whether its `https://`-only
  `url` goes through the layout's capture-phase opener rather than an in-app navigation); the
  Settings ▸ Plugins keyboard and focus-trap path undriven, which matters given findings 23–27;
  `plugin.bench.ts` read but not run; memo eviction above `MEMO_MAX = 512` unmeasured; the
  load-time microtask queue undriven; `isRaging`'s two sourcings (`facts.conditions` versus
  `state.conditions`) assumed equal, not proven; and discovery over the real Tauri `Storage` —
  Windows case-folding against `NAMESPACE_RE`, a plugin folder inside a watched pack directory —
  which wants a `/dev/` probe. `UpcastBuilder.svelte` and `EditContentForm.svelte`, both new in
  `b94d791`, were not opened.
- **Storage and packs — covered in the second pass** (findings 30–37); what is left of it is narrow:
  `storage/tauri.ts`'s data-folder move driven on the real app (`walkTree`'s symlink skip,
  `copyFilesInto`'s Windows-vs-Linux mtime asymmetry at `tauri.ts:157`, which silently changes what
  `mergeCopyList` calls "newer", and `discardFailedCopy`'s empty-target-only claim); the Rust half in
  `src-tauri` (`saved_data_dir`, `set_data_dir`, `pick_data_dir` — the actual sandbox boundary, and
  the whole "Rust refuses a path not chosen through the picker" claim at `tauri.ts:51`);
  `remote/github.ts` past line 175 (the byte and pack caps, branch fallback, whether `truncated`
  reaches a refusal on every path); `storage/browser.ts` under real IndexedDB, where `list()` is one
  `get` per child and `remove`/`rename` scan every key; and `content/store.svelte.ts`'s
  `reloadContent`, the cache-rotation coordinator, never opened.
- **The SRD converters.** Five converter commits in the window unopened; their row-count asserts and
  extraction correctness are unexamined. The `see_i_nvisibility` slug bug probably lives there.
  `restamp.ts` unread (the hashes are clean, so nothing is mis-stamped today).
- **Character persistence.** `repository.ts` (atomic write, backups, photo siblings),
  `schema.ts` migrations and defaults, `store.svelte.ts`, `draft-repository.ts`,
  `derive-plugins.ts` and its interaction with `maxHpBase`.
- **Builder state machines.** `draft-history.svelte.ts` (undo/redo over draft plus class picks),
  `draft-session.svelte.ts` (autosave, adopt, renew), `option-walk.ts`, `picker-reading.svelte.ts`,
  `card-placement.ts`, `rows.ts`, `draft-inventory.ts`. Also `previewSheet`'s reused trial VM.
  `switchSystem`'s drop sweep is **no longer open**: it was suspected of stranding `slotFeatSkills`,
  `slotFeatAbility` and `speciesBoostPicks`, and it does not — `pickSpecies` clears the boost picks,
  and the two slot maps are trimmed downstream by the feat's own count once the feat is gone.
- **Combat remainder.** `inventory.svelte.ts` (equip, attune, attunement caps), `CombatMenus.svelte`,
  the panels other than HP and Attacks, `roll-journal.svelte.ts` past line 200, `spells.ts`,
  `effects-view.ts`, the upcast paths, and `passBoundary`.
- **Roller remainder.** `savageReroll`'s weapon/effect-die split and its tie case; the caret state
  machine; `movePill` across lines; `setDamage`'s `real` filter; the roller's locale surface;
  `RollerLine.svelte`'s two-column type picker.
- **UI remainder.** Two of its lines are now closed: all 36 `$effect` sites are scanned and none
  cycles, and the `LangSwitcher` sweep produced finding 54. The unfocusable-clickable census is
  closed too (finding 52). Still open: reverse states beyond finding 25 — pin persistence, source
  enable/disable, theme install/uninstall, pack apply/rollback. The 102 duplicated CSS declaration
  blocks, 100 of them cross-file, the top two repeated ten and nine times. A `:focus-visible` pass.
  The builder pickers' ARIA driven rather than read.
- **The both-editions sweep.** Most probes ran on one pack. Extra Attack, the exhaustion fan-out and
  the two 2014 spellcasting probes are the parameterised ones; the rest are not.

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

1–3. **Plugins L3 · Storage · Pack update and rollback — DONE**, findings 30–47. What is left of the
   three is narrow and listed under *What was not reached*: the consent dialog and the Settings
   keyboard path, the data-folder move and the Rust half of `tauri.ts`, `github.ts` past line 175,
   `browser.ts` under real IndexedDB, and `content/store.svelte.ts`'s `reloadContent`. Two lessons
   from that pass are worth carrying: read the files **in full** — both readers found their best
   material past the point a skim would have stopped — and verify anything filesystem-shaped against
   a **real** fs, because `MemoryStorage` silently merges a rename that Windows refuses.
Items 4–7 were each STARTED by a reader and stopped within minutes, before any file was read through.
**Nothing from those aborted runs is recorded anywhere in this document.** Findings 48–55 came later
and from a different source — the editor's own pass, working the same items by hand — so where an
item below says something is closed, that is the hand pass talking, never the aborted one.

4. **Character persistence and builder state.** Partly done by hand: the three suspicions this item
   carried are settled and became findings 48, 49 and 50, and `switchSystem`'s drop sweep was checked
   and is correct (`pickSpecies` does clear `speciesBoostPicks`, which was the suspected gap). **The
   files themselves are still unread** — `repository.ts`, `schema.ts` migrations, `store.svelte.ts`,
   `draft-repository.ts`, `draft-history.svelte.ts` (undo/redo over draft *and* class picks),
   `draft-session.svelte.ts`, `previewSheet`'s reused trial VM, and the five small builder helpers.
   About 1 600 lines.
5. **Combat remainder — untouched.** `inventory.svelte.ts`, `spells.ts`, `effects-view.ts`,
   `CombatMenus.svelte` and the panels other than HP and Attacks, read for reverse states
   specifically. About 3 300 lines, and the largest block of live code on a path the player uses
   daily.
6. **Roller remainder — untouched.** `savageReroll` and its tie case, the caret state machine,
   `movePill` across lines, `setDamage`'s `real` filter.
7. **UI remainder.** Three lines closed by hand: all 36 `$effect` sites scanned (none cycles), the
   `LangSwitcher` sweep done (finding 54), and the unfocusable-clickable census closed (finding 52).
   Left: reverse states beyond finding 25 — pin persistence, source and theme enable-then-disable;
   the 102 duplicated CSS blocks; a `:focus-visible` pass; the builder pickers' ARIA, driven rather
   than read.
8. **The both-editions sweep.** Most probes ran on one pack. Re-run the build and resource paths on
   `srd-2014`.

### The suspected items, which are cheap to settle

Each is a short probe away from being a finding or a dismissal, and they are listed with their
evidence under the *Suspected* headings. Four have since been settled and became findings 48–50 and
55 — `switchClass` wiping picks on the first class, the orphaned expertise entry, the stale
half-feat ability, and the unreachable bare ability check — which is the argument for spending the
probe rather than leaving the suspicion standing: all four turned out to be defects, and three of
them cost the player something.

Still open and still cheap: `restoreUpTo`'s unclamped spent; whether the Roll button eats a click on
a half-typed token; whether `on_event` / `regain_on_initiative` / `damage_reroll` can actually reach
`effectTag`; whether the scoped damage bonus's row-versus-roll split is intended.

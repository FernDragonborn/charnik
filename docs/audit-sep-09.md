# Fresh-eyes audit — the work since the last one

Covers `2026-09-04 f41891b` (the roller review, the last time anything was read for defects) through
`2026-09-07 111ba48`, in both repos: the i18n sweep, the 0.7.0 gate wave, the magic-item authoring,
and the three grammar changes of the last day. Read for IMPLEMENTATION defects — a number that comes
out wrong, a rule the code knows in one place and forgets in another — not for missing features.

Every finding below was reproduced, not inferred: the method is named on each one, and each one
carries what happened to it. All seven are fixed.

## 1 · HIGH · a magic weapon's `+N` rides every attack you make, and its own attack twice

`derive-gather.ts:60` pushes **every equipped or attuned item row** into the global effect facts.
That is right for a Cloak of Protection and wrong for a weapon: a `+1` sword's own
`flat_bonus:attack+1` / `flat_bonus:damage+1` are per-weapon by D9, and `computeAttacks` already
folds them into that weapon's row through `weaponBonus`. `attacks.ts` states the invariant —
"a +1 sword must not grant +1 to every attack — so it can't ride gatherEffects/global facts" — and
nothing enforces it.

The second half is the roll path: `sheet-rolls.ts` rolls a to-hit at `at.toHit + fx.flat`, where
`fx.flat` is that global fold. So the bonus lands once on the row and once again at the roll.

**Reproduced** (node, real packs, `srd-2024`): fighter 5, every ability 10, PB +3, carrying a Dagger
of Venom (+1) and a mundane Longsword.

| attack | sheet row | actually rolled | RAW |
| --- | --- | --- | --- |
| Dagger of Venom | +4 | **+5** | +4 |
| Longsword (mundane) | +3 | **+4** | +3 |
| Unarmed Strike | +3 | **+4** | +3 |

Damage goes the same way: the longsword rolls `1d8+1` and the fists deal 2.

It gets worse in two directions. **Attunement alone is enough** — a Defender (+3) sitting sheathed in
your pack (`equipped: false, attuned: true`) puts +3 on every attack you make with something else.
And **they stack**: a Defender and a Dagger of Venom together measured a global `+4` to attack and to
damage.

**Blast radius:** 41 weapon rows across the two packs carry `flat_bonus:attack+N`, all authored this
cycle by MAGIC-ITEM-EFX — before that the rows were empty and there was nothing to leak.

**The fix is per-TOKEN, not per-row.** A weapon row's other tokens are legitimately global while it
is carried: the Luck Blade's `flat_bonus:saves+1`, the Quarterstaff of the Acrobat's
`advantage:skill.acrobatics`, the Staff of Power's `flat_bonus:ac+2`. The Staff of Power is the whole
problem in one cell — `flat_bonus:attack+2;flat_bonus:damage+2;flat_bonus:ac+2;flat_bonus:saves+2`,
where the first two belong to the staff and the last two to the wielder. So the gather must drop the
`attack`/`damage` numeric tokens of a **weapon-category** row and leave everything else alone.

**FIXED.** `gatherEffects` drops a weapon-like row's own `attack`/`damage` tokens from the global
facts, by the same `isWeaponOwnBonus` predicate `weaponBonus` folds them with — so the two can never
disagree about which tokens are the weapon's and lose one between them. Three cases pinned in
`items_content.test.ts`: the wielded pair, the sheathed-but-attuned Defender, and a Luck Blade whose
`flat_bonus:saves+1` must still ride.

## 2 · MEDIUM · healing from 0 HP leaves the death-save pips filled

SRD 5.1, Death Saving Throws, verbatim: "The number of both is **reset to zero when you regain any
hit points** or become stable."

`hit-points.svelte.ts` implements every other clause of that paragraph — a natural 20 revives and
resets, a third success stabilises and resets, `revive()` resets and its own comment cites the rule
("it resets on regaining HP"). But `heal()` is three lines and touches `p.hp.current` only, and
`applyLongRest` restores HP to full without clearing the track either.

So: drop to 0 with two failures, take a Cure Wounds, and the sheet still shows two failures. The next
time you go down, one failed save kills you.

**Found by** reading `heal()` against the SRD paragraph; every write to `deathSaves` in the codebase
is accounted for above, so nothing else clears it.

**FIXED**, and at the root rather than in `heal()`: `syncDyingState` runs reactively beside
`clampCurrentHp` and clears the track whenever a living character is above 0 HP, so every way hit
points come back — a heal, a long rest, the number field — is covered by one rule instead of three
places remembering it.

## 3 · MEDIUM-LOW · a ticked "was it a critical?" can survive to a later hit

`damageWasCrit` is documented as "off again after each hit", but it is cleared inside the
`before === 0` branch of `damage()` only. The checkbox renders only at 0 HP, so the flag goes
invisible the moment you are healed — while staying `true`.

Tick "was critical" at 0 HP, get healed instead of hit, go down again later, take an ordinary hit:
**two** death-save failures for a hit nobody called a crit, with no control on screen to explain it.

**Found by** tracing every write to the field — there are two, the checkbox and that one branch.

**FIXED** by the same `syncDyingState`: the crit answer is state that only means anything at 0 HP,
so it goes when the death-save track does. Pinned in `combat.test.ts`.

## 4 · LOW · an attack-target scope cannot be a comma list, though the grammar says it can

The scope rule is stated once in `effects.md` — "a scope matches when EVERY comma-separated part is
one of the rolling thing's scopes" — and implemented twice.

- `roll.ts` `inScope`: `scope.split(',').every((t) => scopes.has(t))` — correct.
- `attacks.ts` `scopedAttackBonus`: `scopes.has(f.scope)` — an exact lookup of the whole string.

So `flat_bonus:damage.melee,str+2` (2014 Rage) works and `flat_bonus:attack.melee,str+2` silently
matches nothing, because the scope set holds `melee` and `str` and never the literal `"melee,str"`.
Attack scopes fold in `computeAttacks` precisely because that is where the weapon is known, so this
is the half of the rule with no shipped consumer to catch it — Archery is the single-part
`flat_bonus:attack:ranged+2`, which is why the suite is green.

**Found by** reading the two implementations of one documented sentence side by side.

**FIXED.** `scopedAttackBonus` splits the scope and requires every part, the sentence `roll.ts`
already applied.

## 5 · LOW · a `long(N)` recharge gives the whole pool back

`restRecharge` returns `RECHARGE_ALL` for any policy on a long rest, ignoring an authored amount.
That is right for `short_one` — a long rest does refill Second Wind completely — and wrong for a pool
whose own trigger is `long` with a partial amount: the author wrote "2 back on a long rest" and gets
all of them.

**Reproduced:** `parseRecharge('long(2)')` → `{trigger:'long', amount:'2'}`, then
`restRecharge(p, 'long')` → `'all'`. No shipped row uses it — every partial amount in both packs is a
`dawn(...)` — so this is a trap waiting for a homebrew pack, not a wrong number today.

**FIXED**, after the semantics were settled rather than assumed: "a long rest refills everything a
short rest would" is a sentence about the SHORT-rest pool — it is RAW's own wording for Second Wind
("one expended use on a Short Rest, and all of them on a Long Rest") — and says nothing about a pool
whose own boundary IS the long rest. There, the authored amount is exactly what a long rest gives
back. So the amount is read for both triggers instead of one, and `long(2)` hands back two.

## 6 · LOW · content-health lints three of the four expression slots

`lintEffectTokens` says it lints "every L2 expression slot — guard, value, resource max". A resource
token has a fourth: the recharge AMOUNT.

**Reproduced:** `grant_resource:ki:1d7:short` warns "unusual die d7"; `grant_resource:ki:2:dawn(1d7)`
warns nothing. Same author, same typo, one slot over.

**FIXED.** The recharge amount joins the three slots already linted, and the function's own
docstring now names four.

## 7 · TRIVIAL · the `half` → `partial` rename ran through two comments about halving

`partial` replaced `half` as the proficiency rung's name, and the sweep caught two places where
"half" was the ordinary English word:

- `token-parser.ts`, on the `halve` kind: "exhaustion L2 = speed **partial**, L4 = hp-max **partial**"
- `class_features_content.test.ts:427`: "L2: speed **partial** (30 → 15)"

Both mean halved. Nothing computes from a comment, but the first one sits inside the vocabulary's own
definition of `halve`.

**FIXED** — both say halved again.

## What was checked and is correct

Recorded so the next audit does not re-derive it.

- **Extra Attack, both editions, multiclassed.** The 2014 fighter carries the ladder as
  `step(class_level.fighter, 5->2, 11->3, 20->4)`; 2024 says the same thing in three rows, because
  2024 prints it as three features. A fighter 5 / barbarian 5 still attacks twice.
- **Exhaustion reaches passive scores in both editions** — 2014 through disadvantage (−5), 2024
  through the `d20_tests` numeric (−6 at level 3). The `d20_tests` fan-out was the suspect; it is not.
- **Rage's scope.** A raging barbarian's crossbow carries `dex` and never matches `damage.str`.
- **Coins.** Fifty to the pound, the five PHB values, and a purse holding a coin nobody minted
  contributes neither weight nor worth.
- **Instant death and damage at 0 HP** match the 5.1 paragraph clause by clause, including the crit's
  two failures and the "damage remaining ≥ hit point maximum" threshold.
- **The magic items' divergent charge tables are right per edition.** The Cube of Force regains
  `1d20` in 2014 and `1d6` in 2024; the Medallion of Thoughts `1d3` and `1d4`. Both read off that
  edition's own text.
- **Species options.** A gold dragonborn resists fire; a fire goliath gets a pool of 2 at level 1
  (Proficiency Bonus uses, back on a long rest).
- **The `proficient` scope has exactly one producer.** `SkillsPanel` is the only site that rolls a
  `skill.*` key, so there is no second surface where Reliable Talent would silently not apply.
- **A magic weapon's `+N` is not double-counted on its own ROW** — only at the roll, which is
  finding 1.

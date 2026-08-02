# RECHARGE-PLAN — Claude working ledger (recharge-roadmap, 3 slices)

> **What this is:** my execution ledger for the three recharge/restore patterns the `Recharge` enum
> can't express (the table from the 2026-08-02 design thread). Build order is dependency-forced:
> Hit Dice (no deps) → onEvent regain (needs the N2 write-half) → item-charge `{trigger, amount}`
> recharge (needs item-charge tracking). Normative homes: **`docs/EFFECTS.md` §Recharge-model roadmap**
> (the enum + why), **`docs/ACTIONS.md`** (the onEvent intent model), **`docs/PLAN.md` B2** (hit dice).
> `[ ]` open · `[~]` partial · `[x]` done+verified. Update it in the same change as the code.
> [[csv-open-enums-not-binary]] — extend by an enum member / subsystem, never a boolean flag.

## Why these three, and why NOT one generic engine now

The `recharge ∈ short|long|short_one|other` enum covers every **rest-full/partial** policy by adding a
member. The three below are genuinely different AXES, each with its own prerequisite — so each rides its
own subsystem, and we do NOT pre-build a universal `{trigger, amount}` recharge before a consumer exists
(YAGNI). The generic model earns its place only in slice 3 (item charges), where trigger×amount is real.

---

## Slice 1 — Hit Dice subsystem (no deps) `[x]` DONE + app-verified 2026-08-02

**Goal:** the play-tracking staple. Spend Hit Dice on a short rest to heal; regain half your level on a
long rest. The "½-on-long" pattern lives HERE (its own math), not on the generic resource enum.

**What exists:** `play.hitDiceSpent` (schema record, keyed) is a STUB — consumed nowhere. Class rows carry
`hit_die` (`d6/d8/d10/d12`); `DIE_MAX` (core.ts, private) + `rollFormula` (dice.ts) are reusable.

**In:**
1. `[x]` **Derive a HD pool** — `hitDicePools(build, graph)` (pure, `derive.ts`) → `sheet.hitDice:
   HitDiePool[]` grouped by die size, largest first. Exported `DIE_MAX` from core.ts.
2. `[x]` **Short-rest spend → heal:** `CombatVM.spendHitDie(die)` rolls `1dX + CON` (min 1 HP RAW),
   heals clamped to max, logs via the tray, decrements `hitDiceSpent`; blocked when the pool is empty.
   `ResourceTracker.hitDiceSpent(die)` = the clamped accessor. UI: a Hit Dice chip-row in HpPanel
   (chip spends one; pips show remaining) — app-verified (d6 3/3 → click → d6(5)+2=7, HP 14→20, 2/3).
3. `[x]` **Long rest regains HD — EDITION-DIVERGENT (SRD-verified):** **2014** = half total HD, min 1
   (SRD 5.1 §"a number of dice equal to half of the character's total number of them"); **2024** = ALL
   spent HD (SRD 5.2.1 Long Rest "regain all lost Hit Points and all spent Hit Point Dice"). Pure
   `hitDiceRecoveredOnLongRest(system, total)` in `rules/core.ts`; `rest('long')` recovers largest-die-
   first up to that count. **Known simplification (ponytail):** v1 auto-picks largest-first for the 2014
   half case; RAW lets the player choose which dice — upgrade to a picker if anyone asks. 2024 = all.
4. `[x]` **Edition check DONE:** short rest spends HD → roll die + CON, min 1 HP each (both editions);
   long rest regain diverges (2014 half / 2024 all — above). Multiclass pools by die type (both).

**Verify:** unit (derive: pool per class incl. multiclass; ResourceTracker: short-rest spend heals
dieSize+CON clamped & decrements the pool, empty pool blocks; long rest regains floor(level/2)); drive
the app (spend a die on short rest → HP up + pip spent; long rest → pips return). Screenshot.

## Slice 2 — onEvent regain (needs the N2 write-half) `[ ]`

**Goal:** "when you roll Initiative and have no uses left, regain one" (2024 Barbarian Rage / Monk Focus).

**Blocker:** the `onEvent` executor is the N2 deferred write-half (`docs/ACTIONS.md` §1/§4; only `onUse`
is started). Event vocab is PINNED (`turnStart`/`turnEnd`/`attackMade`/`damageTaken`/`rest`/… ACTIONS.md
§3) — NB "roll initiative" ≈ combat start / round-1 `turnStart`; decide the mapping (a `combatStart`
member or reuse `turnStart` gated on round 1).

**In (sketch — detail when reached):**
1. `[ ]` **A data-driven onEvent handler** on a feature: `{trigger, guard?, intent}` read from content,
   fired by the host on the event. Reuses the ACTIONS.md intent + validation (all-or-nothing, formulas).
2. `[ ]` **Fire `turnStart`/combat-start** from `TurnEconomy` (nextTurn / toggleCombat) → run matching
   handlers → apply intents (here a negative `spend` = regain a use).
3. `[ ]` **Guards:** post-hoc (fires AFTER), no recursive cascade, deterministic order (ACTIONS.md §3).
4. `[ ]` **Data:** the 2024 initiative-regain features (Rage line 329, Focus line 5172 in the SRD md) as
   onEvent rows — SRD-verified.

**Verify:** unit (event fires → intent applied; 0-uses guard; no cascade); app-drive an initiative regain.

## Slice 3 — item charges + `{trigger, amount}` recharge (needs item-charge tracking) `[ ]`

**Goal:** magic items with charges — "regain 1d6+1 charges at dawn", "recharge 5 (1d6) on a short rest".

**Blocker:** we don't track item charges as resources at all (no data column, no consumer). Building the
generic `{trigger, amount}` recharge before this = speculative.

**In (sketch — detail when reached):**
1. `[ ]` **Item-charge data:** a `charges` (max) + `recharge` spec on the item schema; an attuned/owned
   charged item grants a resource pool (reuse `grant_resource` / the resource subsystem).
2. `[ ]` **Generalize recharge → `{trigger, amount}`:** trigger ∈ `short|long|dawn|dusk`, amount ∈
   `all|<N>|<formula>`. The `short|long|short_one` enum members become sugar over it (back-compat).
   Formula amount resolves via the L2 evaluator at rest/dawn time.
3. `[ ]` **Wire `dawn`/`dusk`** to the existing out-of-combat "pass time" control (`advanceTime`) — a
   day boundary fires the dawn recharge.
4. `[ ]` **Data:** a shipped SRD charged item or two as the first consumer — SRD-verified.

**Verify:** unit (formula recharge at dawn; enum sugar still works); app-drive a wand recharging at dawn.

## Conventions (do not drift)
- **CSV-only data**; re-stamp with `pnpm restamp <file>` after a hand-edit [[content-csv-hash-restamp]].
- **RAW fidelity**: encode only what maps faithfully; VERIFY against `tools/srd-src/**` text; flag
  deviations [[charnik-srd-raw-fidelity]], [[charnik-no-hallucinated-data]].
- **Enums/subsystems, not booleans** [[csv-open-enums-not-binary]] — each new policy = a member or a
  subsystem seam, never a two-state flag.
- **Executor is isolated/removable** — every intent field lands on an existing system (ACTIONS.md §2).

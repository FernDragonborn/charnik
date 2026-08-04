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

## Design findings (2026-08-02) — WIP, RESHAPES slices 2-3, refine before building

> Captured from the design thread with the maintainer. **Not final** — to review/edit together, then
> rewrite slices 2-3 under it. A prototype must be chosen first (see §6). [[sync-plan-with-code-on-drift]]

1. **CORE PRINCIPLE (emerged across 3 cases): a play-tracker SURFACES & SUGGESTS — it never
   auto-applies or forces a player decision.** It highlights / reminds / pre-fills a smart default; the
   PLAYER clicks. Why: (a) most RAW features are "you *can*" = a choice; (b) a tracker doesn't hold full
   game state (what counts as one *instance* of damage; whether you "attacked an enemy" this turn), so
   it can't correctly auto-decide; (c) forcing is bad UX — a concentration prompt on every Damage press
   breaks on corrections (took 72, enter 71, then +1 to fix → must not re-prompt). [[play-tracker-surfaces-never-forces]]

2. **Slice 2 (initiative regain) REFRAMED — NOT an auto event-bus.** Conditional activated abilities are
   ALWAYS listed, greyed when unavailable, highlighted + a notice when their window opens; the action
   stays a player click (onUse). Reuse: onUse executor + an L2 **availability guard** on the option + a
   new `is_combat_start` ctx var + a new verb **`restore_resource:<id>`** (regain ALL of a pool).
   Consumers: Persistent Rage (Barbarian L15), Uncanny Metabolism (Monk L2) — player-choice, each gated
   by its own once-per-long-rest resource (a `:1:long` pool the activation spends).

3. **Concentration-save-on-damage = a SEPARATE, more valuable slice** (universal — every caster).
   Must follow the principle: **NOT** an auto-prompt per Damage press. UX = an on-demand "Concentration
   save" affordance by the concentration indicator (like the death-save button at 0 HP), highlighted
   after damage, with a suggested-but-EDITABLE DC = `max(10, ½ last damage)`; player clicks when the
   instance is done; fail → OFFER to drop concentration. **SURFACE CHOSEN: B4 (§6).**
   **STATUS NOTE (verified in code 2026-08-04):** the earlier "today `damage()` does NOT handle it" is
   STALE — `damage()` (`state.svelte.ts:425`) ALREADY fires a CON-save **toast reminder** with the
   DC. So this slice is an **upgrade** of that ephemeral toast → the persistent B4 banner + a real
   roll, not a from-scratch build. Build template = **`deathSave()`** (`state.svelte.ts:646`): roll
   instantly via `rollPool` over `effectsFor('save.con')` + auto-apply the outcome — the SAME reason as
   the death save (the tray contract has no result callback, and `save.con` effects — Bless, War
   Caster advantage — already fold through `effectsFor`). Route the B4 Roll through that path.

4. **SRD facts locked (verified in tools/srd-src):** 2024 Rage lasts *until the end of your next turn*,
   extend by (attack an enemy / force a save / Bonus Action); ends on Heavy armor or Incapacitated. 2014
   Rage = 1 min, ends if no attack-on-hostile AND no damage-taken since last turn. Persistent Rage /
   Uncanny Metabolism = "you can, once per long rest, regain ALL". Concentration save = per damage
   instance, DC `max(10, floor(instance/2))`.

5. **Genuinely-automatic (no-choice) features DO exist** (concentration save is *mandatory*; Rage
   auto-ends; regeneration / "start of your turn gain X"). So an event layer is eventually justified —
   but as **event → reminder/highlight**, rarely as silent state-mutation. A full auto-mutating
   event-bus is *rarely* correct in a tracker.

6. **Concentration UX — BEHAVIOR = variant A, SURFACE = B4 (CHOSEN 2026-08-04).** The BEHAVIOR is
   variant A (smart — after a Damage press while concentrating, a suggested but EDITABLE DC =
   `max(10, ½ damage)` + one-click Roll save; corrections just update the suggestion, no modal; fail →
   OFFER to drop concentration). The SURFACE is **B4 · Slim inline banner** — a thin, **persistent**
   (won't vanish) bar **under the HP panel** while a check is due: `⚠ Concentration check due · <spell>
   · DC <n> · d20 + CON (+m)` + **Roll** + **Drop** right in the bar. Not floating, not modal, not a
   toast. Prototype: `design-preview/concentration-popover-variants.html` (B4). Chosen over the floating
   popovers (A1–A3), the indicator badge (B1), the auto-dismiss toast (B2), and the dice-tray hand-off
   (B3) — the banner can't be missed and stays put through corrections, matching "surface, don't force."
   HP has **no pips** — only Heal/Damage + an amount field, so "an instance" = one Damage press's amount
   (corrections reuse the button → never force). (The earlier "wide call-out" surface + the plain
   manual-DC button are both superseded by B4.)
   **Render site:** the banner lives under `HpPanel.svelte`, driven by a `pendingConcentrationSave`
   VM field set in `damage()` (replacing the toast) and cleared on Roll / Drop / when concentration ends.

## Concentration DC — EDITION DIVERGENCE + the multi-save idea (SRD-verified 2026-08-02)

Verified in `tools/srd-src`:
- **2014 (SRD 5.1):** "If you take damage from **multiple sources, such as an arrow and a dragon's
  breath, you make a separate saving throw for each source of damage.**" DC = 10 or ½ damage, **no cap**.
- **2024 (SRD 5.2.1):** the multiple-sources sentence is **GONE**. "If you take damage… DC 10 or half
  the damage taken (round down)… **up to a maximum DC of 30**." Leans to one save on the instance.

**⇒ two faithful divergences to encode:** DC cap = 30 in 2024, uncapped in 2014; and the *number* of
saves — 2014 RAW is explicitly **per source**, 2024 dropped it (one-save-leaning). The **Magic Missile**
case (3 darts, one spell) is the famous ambiguous sub-case tables rule differently in BOTH editions.

**⇒ DC scaling (SRD-verified):** `DC = max(10, floor(dmg/2))`, capped 30 (2024) / uncapped (2014). It
only rises above 10 at **22+ on a SINGLE hit** (21 → floor 10.5 = 10). So sub-22 hits are a flat DC 10.

**⇒ multi-save — REFRAMED after design review (2026-08-02).** Rejected the rich "+ add source /
per-source DC / split-and-divide" ideas: we're **not a VTT**, we have no per-source data, and nobody
types attack names — that's friction with no data behind it. Two real cases:
- **Different sources** (arrow + dragon breath, different amounts) → handled by SEPARATE Damage presses;
  each press raises its own variant-A save with its own DC. **No special UI.**
- **One lump of EQUAL projectiles** (Magic Missile, Scorching Ray) → the maintainer's **split-button**:
  a segmented `1 (wide) · 2 · 3` control that picks HOW MANY saves. Because the projectiles are equal
  AND small (<22 each), **all saves share ONE flat DC 10** (editable) — do NOT divide the entered
  damage (it doesn't feed a per-dart DC; that was a wrong turn in the prototype). Prototype:
  `design-preview/concentration-split-button.html`. Niche → **parked nice-to-have**, ship single-save
  (variant A) first.

## Related damage-path mechanics (backlog — LOW priority, bundle when touching `damage()`)

Surfaced during the concentration design; both fire on taking damage, so do them alongside/after the
concentration work rather than as their own visits.

- **Overkill instant death — RAW (SRD), a real gap. LOW priority.** SRD 2014 (verified,
  `tools/srd-src/2014/…:3642`): when damage reduces you to 0 AND the **leftover damage ≥ your FULL
  Hit-Point maximum** (100%, not half), you die instantly — skip death saves. Example: max 12, at 6,
  take 18 → 0 with 12 leftover = max → dead. Our `damage()` currently just clamps to 0 (no instant-death
  check). 2024 keeps the same threshold (full max). Cheap to add in `damage()`: after applying, if
  `leftover ≥ effectiveHpMax` → mark dead (not dying). [[charnik-srd-raw-fidelity]]
- **Massive Damage / System Shock — DMG OPTIONAL, not SRD. Future toggle, not shipped data.** ≥ half
  max HP in one instance → DC 15 CON save → roll on the System Shock table (drop to 0 / stunned / no
  reactions — NOT exhaustion). A DMG variant many tables ignore; support later as an optional toggle
  (like encumbrance), never as core/shipped rows. (Corrects the earlier "50% → exhaustion" recollection
  — no such rule exists in RAW.)

## Other-tracker survey — concentration save (2026-08-02, informs variant A)

How existing tools handle "concentrating creature takes damage". Two camps:

**Auto-roll (app rolls the save for you):**
- **Foundry dnd5e (native):** auto-rolls the CON save when a concentrating token takes damage, DC
  `max(10, ½ dmg)`; config toggle.
- **Foundry Midi-QOL:** detects damage → rolls the CON save (DC 10 / half) → auto-removes the effect on
  a fail. Deepest automation, wired into its damage pipeline.
- **Roll20 Concentration API (`Auto Roll Save` mode):** marks the token on cast, auto-rolls CON on
  applied damage. Caveat: misses spell-*attack* damage (no concentration info sent).

**Notify + click (app surfaces, player rolls) — this is OUR variant A:**
- **Foundry Concentration Notifier:** does NOT auto-roll — posts a message with **buttons** ("roll
  save" + "remove concentration"), **shows the computed DC** (½ dmg, min 10), links the concentrated
  item. Popular precisely because it doesn't steal the roll. Flags worth stealing: `concentrationAbility`
  (WIS instead of CON), `concentrationAdvantage` (War Caster!), `concentrationBonus`, `concentrationReliable`
  (min-10). Fail → OFFER remove (a button), doesn't force.
- **Roll20 (reminder mode):** just reminds to do a check.
- **D&D Beyond / mobile (Fight Club, Game Master 5e):** lighter — track concentration as a tag; the
  save is largely manual (no auto-prompt-on-damage).

**Takeaways for our build (variant A = the notify+click camp, validated):**
1. Everyone computes + SHOWS `max(10, ½ dmg)`. Standard.
2. The save is a normal **CON save** → route it through our existing save path so `save.con` effects
   fold automatically: **Bless**, **War Caster** (advantage on concentration saves), etc. Don't special-case.
3. Steal Concentration Notifier's flags as effect targets we likely already have or can add:
   advantage on concentration saves (War Caster), an ability override, a bonus, min-10 (reliable).
4. Fail → **offer** to drop concentration (a button/dialog), never auto-drop — matches our principle
   and Concentration Notifier; Midi's auto-drop is the more-aggressive end we deliberately avoid.
5. Our edge over the VTTs: damage flows through ONE Damage button with an explicit amount → clean
   instance/DC; the only nuance is corrections reuse the button (→ suggest, don't force; variant A).

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

## Slice 2 — initiative-regain (`[~]` in progress) — REFRAMED: onUse resource-options, NOT an event bus

**Goal:** "When you roll Initiative, you can regain all uses of Rage / all Focus Points" — Persistent
Rage (Barb 11), Uncanny Metabolism (Monk 2), + the auto siblings (Superior Inspiration, Perfect Focus,
Evergreen Wild Shape). All SHIPPED in `content/srd-2024/class_features_srd.csv`.

**KEY REFRAME (per Design-findings §2 — do NOT build an auto event-bus).** "When you roll Initiative,
you *can*…" is a **player choice at a window**, so it's an **onUse resource-option**, availability-gated
to combat start — NOT an onEvent handler. The onUse executor (N2 first slice) already exists; this slice
just adds the gate + a regain verb. This keeps the whole thing on the SHIPPED onUse path.

**In:**
1. `[x]` **`restore_resource:<id>` verb** — regain ALL uses of a pool. `ResourceTracker.restoreAll(id)`
   + the executor branch in `runActionToken`; tested (Persistent Rage: regains all Rage, spends its
   once/long-rest gate; blocked when the gate is empty). The "once per long rest" is modelled by a
   companion `grant_resource:<gate>:1:long` pool the option's `cost` spends (reuses `canAffordOption`).
2. `[x]` **`available` L2-guard column on `resource_option`** — resolved in `resolveResourceOptions`
   (`resolveAvailable`) → `ResourceOption.available`; empty → always available; a malformed guard fails
   OPEN + a deriveIssue (surface, never silently hide). Tested.
3. `[x]` **`is_combat_start` ctx var** — a `flags` getter in `derive-context.ts`
   (`play.inCombat && play.round <= 1`) + added to the parser `BOOLEAN_VARS` whitelist (the B13-trap:
   both places, caught by the derive test). Tested (greyed out of combat, open at round 1).
4. `[x]` **UI** — ActionsPanel greys/disables an unavailable option + a title. (Highlight-when-open
   pulse = later polish.)
5. `[ ]` **Data** (SRD-verified): `barbarian_persistent_rage` (gate `persistent_rage:1:long`, action
   `restore_resource:rage`, `available=is_combat_start`); then `monk_uncanny_metabolism` — needs a
   MULTI-action (heal Martial-Arts-die + Monk level AND `restore_resource:focus`); single `action` is one
   token today, so multi-action (or the full intent) is a follow-up. Auto siblings (Superior Inspiration,
   Perfect Focus) are "you regain" (no choice) → the genuinely-automatic tail (§5), later.

**Verify:** unit (restore_resource regains all + gate blocks — DONE; available-guard greys the option);
app-drive an initiative regain on a Barb 11.

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

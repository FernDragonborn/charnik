# N2-PLAN — Claude working ledger (activatable actions / N2)

> **What this is:** my execution ledger for the **N2 activatable-actions** phase — clicking a
> data-defined ability in play (Second Wind, Action Surge, Lay on Hands, smites, Channel Divinity)
> and having it spend/heal/roll/apply through the systems that already exist. Working notes, not the
> spec (that's **`docs/ACTIONS.md`** — the normative intent/executor model — and `docs/PLAN.md` N2).
> `[ ]` open · `[~]` partial · `[x]` done+verified. Update it in the same change as the code.
>
> **Supersedes `docs/FEATS-PLAN.md`** (retired 2026-08-02): the feat phase's encodable (tier-1/2) work
> is complete + committed (Alert, Grappler half-feat, Epic Boons, Defense, **Archery/§A**,
> **Skilled/§C**, **GWF/§B**). The settled §A/§B/§C token designs and encoded feats live on in the
> code + git history. The still-open feat tail rides N2 / a spell-learning subsystem — carried below.

## Why this phase

`savage_attacker` and the active-ability feat tail are blocked on the **`onUse` write-half**
(`docs/ACTIONS.md`): using an ability = validate an **intent** `{rolls, spend, effects, hp, tempHp,
cost, notes}`, then execute it through existing systems. `passive` (the derive read-half) is built;
`onUse`/`onEvent` are the deferred write-half. Activatable abilities are **core to the play-tracking
mission**, so we build the N2 foundation rather than one-off hacks.

## Key reuse finding — the executor is a STUB, not missing

The activatable-action machinery mostly EXISTS from the "piece 3" resource-options work:
- **Data model:** `resource_options` schema (`schemas.ts:463`) — `resource_id`, `cost` (L2 expr / `x`),
  `action` (bounded token: `apply_condition`/`heal`/`roll`/`note`), `action_type`
  (`action`/`bonus_action`/`reaction`/`free`).
- **Derive:** `resolveResourceOptions` → `sheet.resourceOptions` (`derive.ts:122`).
- **UI:** `ActionsPanel.svelte` renders each option as a clickable row with a cost chip.
- **Executor: STUB.** `ResourceTracker.spendOption` (`resources.svelte.ts:81`) deducts the resource +
  toasts, but explicitly does NOT cost the turn slot or run `heal:`/`roll:`/`apply_condition:` (its own
  comment: "wire to the dice tray in a follow-up; v1 surfaces the note: text").

**⇒ N2's first slice = COMPLETE that executor** (not a from-scratch build). Matches `docs/ACTIONS.md` §2
+ `docs/PLAN.md` N2 ("activatable actions = COMPOSITION of existing systems — no new engine").

## First slice — complete the executor + Second Wind

### In (v1) — DONE + VERIFIED 2026-08-02
1. `[x]` **Executor, all-or-nothing — DONE + tested.** Also
   added `TurnEconomy.canSpend(slot)` (silent check-half of `trySpend`) + `ACTION_TYPE_SLOT` map. **This
   closed the piece-3 gap — activating an option now actually costs its turn slot** (Flurry etc.
   previously spent Ki but not the bonus action). `CombatVM.activateResourceOption(opt)` (in
   `state.svelte.ts`, where HP + tray + economy are all reachable): validate (`canAffordOption` AND the
   turn slot is free) → then deduct (`spendOption`, the resource math it already does) + spend the turn
   slot (`economy.trySpend`, `action_type`→slot; `free`=none) + execute the action token. Validate
   EVERYTHING before any mutation (ACTIONS.md core rule). Tests: `combat.test.ts` "N2 executor" —
   both all-or-nothing directions (no bonus left / pool exhausted → nothing applied).
2. `[x]` **Action-token execution — ALL DONE (`runActionToken`).** `heal:<formula>` → `rollFormula`
   → `hp.current` clamped to `hpMax` + log; `roll:<formula>` → `rollFormula` → `tray.pushRoll` + log;
   `apply_condition:<id>` → `addEffect`; `note:` → toast; `gain_action` (Action Surge → refund one
   `play.turn.action`). Ad-hoc `indexOf(':')` split (these are ACTION verbs, not L1 effect tokens, so
   `parseToken`'s effect-vocab doesn't cover heal/roll/gain_action — a 2-line split is right here).
3. `[x]` **Resolve the action formula's L2 at derive — DONE** (`resolveActionFormula`) — `resolveResourceOptions` resolves
   `heal:1d10+class_level.fighter` → `heal:1d10+5` (mirror resource-max / `grant_roll` resolution), so
   the option carries a ready dice formula. Tested in `derive.test.ts` (piece 3 heal-formula case).
4. `[x]` **Wire the UI — DONE** — `ActionsPanel.svelte` `spendOption(o)` → `activateResourceOption(o)`;
   cost chip humanizes the resourceId (`second_wind` → "Second Wind").
5. `[x]` **Second Wind + Action Surge SHIPPED, both editions, RAW-faithful + app-verified.** Added
   `grant_resource:second_wind:<uses>:short` / `action_surge` to the feature `effects`, and
   `resource_options` rows (SW → `cost=1, action=heal:1d10+class_level.fighter, action_type=bonus_action`;
   AS → `action=gain_action, action_type=free`). Uses/recharge confirmed against real content at L1/5/17:
   2014 SW=1, AS=1(2@L17); 2024 SW=2→3@L4→4@L10 (via `step()`, not per-level rows — the rage pattern),
   AS=1(2@L17). Drove the app (demo Valen carries `second_wind`): click → rolls 1d10, raises HP, spends
   the bonus + the one use, then the row disables. Screenshots in `design-preview/n2-second-wind-*.png`.
   - **2024 Second Wind short-rest recharge — FIXED (`<this commit>`).** RAW: regain ONE use on a Short
     Rest + all on a Long Rest. Extended the `Recharge` enum with `short_one` (an open enum member, NOT a
     boolean partial-recharge flag — the rule this triggered, docs/AI-CONVENTIONS §1.5 / CLAUDE.md): one
     new member in `spellcasting.ts`, one alternation in the token parser, one branch in `rest()`, one
     `rechargeLabel` case. 2024 SW row now `...:short_one`. 2014 SW/AS + 2024 AS ("short or long rest" =
     full) stay `short` (RAW-exact). Tested: short rest regains one, long rest regains all.

### Shipped after the first slice — Enter Rage (N2 shape 2: an activated buff)
- `[x]` **`apply_effect:<id>` executor verb + Enter Rage — DONE + app-verified.** The applied-effect-with-
  duration case the first slice deferred: a resource-option activation that turns a STATE on. New verb
  `apply_effect:<catalog-id>` in `runActionToken` applies a NAMED `effects.csv` buff via the SAME
  "+"-catalog add path (`effectCatalog` → `addEffect` with `ref`/`negative`→positive/`duration_rounds`),
  so no new mutation path. **Content (both editions):** an `effects.csv` `rage` row (`apply_condition:rage`,
  `negative=false`, `duration_rounds=10`) = the timed positive wrapper; a `conditions.csv` `rage` row
  carries the mechanics (`resist_immune:resist:{b,p,s}`, `advantage:save.str`,
  `flat_bonus:damage+step(class_level.barbarian, 1->2, 9->3, 16->4)`, `note:` for the STR-check + melee
  caveat) AND registers `has_condition.rage` → flips the existing `is_raging` flag (so subclass riders
  like Zealot's `is_raging ? flat_bonus:damage+cha_mod` fire off the SAME state). A `resource_options`
  `barbarian_rage_enter` row (`cost=1`, `apply_effect:rage`, `bonus_action`) surfaces it in the Actions
  block. Rage damage folds at ROLL time via `effectsFor('damage')` (gated on the auto-calc toggle, per the
  maintainer's call: auto-add only when auto-calc is on); RAW-faithful STR-melee scoping is the open §A
  `damage:<qualifier>` tail, so v1 applies broadly + a note. Verified: Karroth (Barb 3) → Enter Rage →
  buff panel shows Rage with b/p/s resist + adv STR-save + damage chips + 10-rd timer, one rage use spent.
  Tests in `class_features_content.test.ts` (option shape + resist/adv + damage scaling 2/3/4, both editions).

### Deferred (OUT — keep the slice small)
- `savage_attacker` — needs a **damage roll-mode** ("roll pool twice, keep higher") intent field + a
  `turn`-recharge once-per-turn gate; a later small extension once this executor lands.
- Roll-dependent LOGIC (read the die, then decide) — ACTIONS.md marks it a later API.
- Plugin `onUse` (`api:2`), `onEvent`, choice groups (N2 shape 3), Wild Shape, the rest of N2.

### Verification
- Unit (`combat.test.ts`, already tests `spendOption`): all-or-nothing (blocked resource OR used turn
  slot → nothing applied); a good Second Wind deducts 1 use, costs the bonus action, heals `1d10+level`
  clamped to max.
- Derive (`derive.test.ts`, already seeds `resource_options`): `heal:1d10+class_level.fighter` resolves
  to `heal:1d10+5` for an L5 fighter.
- Content: Second Wind / Action Surge rows carry the grant + option, both editions.
- **Drive the app** — a Fighter's Second Wind row: click → rolls 1d10+level, raises HP, spends the
  bonus action + one use; blocked when out of uses / no bonus action. Screenshot to `design-preview/`.

## Carried over from FEATS-PLAN (the feat tail that rides this phase)
- `savage_attacker` — **[ ] blocked on N2** (this phase) + a later damage roll-mode extension.
- `magic_initiate` — **[ ] own subproject:** spell-learning (2 cantrips + 1 L1 from a chosen list) +
  once/long-rest free cast. Not N2 — a separate spell-learning subsystem.
- `two_weapon_fighting` — **[~] NO-OP → stays text.** `computeAttacks` already adds the ability mod to
  every weapon's damage, so the off-hand penalty TWF removes was never modelled.
- 2014 `grappler` — **stays text** (relational: advantage vs a creature grappled by you).
- **§A flat-DAMAGE-scope** — still open for **Dueling** (`flat_bonus:damage:melee+2`): GWF used the §B
  roll-manip path, not `flat_bonus:damage`. Resolve the `damage:<qualifier>` type-vs-scope collision in
  `computeAttacks` (weapon-aware) when Dueling lands. Keep the weapon-category vocab OUT of L1.

## Conventions (do not drift)
- **CSV-only data**: author into `content/**/*.csv`; **re-stamp with `pnpm restamp <file>`** after a
  hand-edit (NOT a converter re-run — it drops `conditions_srd.csv`'s `max_level`).
  [[content-csv-hash-restamp]].
- **RAW fidelity**: encode only what maps faithfully; flag deviations. [[charnik-srd-raw-fidelity]].
- **Ship SRD-only**: Fighter + Second Wind + Action Surge are SRD; PHB actives are engine-support test
  targets (homebrew authors add rows).
- **Executor is isolated/removable** — no new mutation paths; every intent field lands on an existing
  system (ACTIONS.md §2). Core tests must not depend on it.

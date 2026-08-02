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

### In (v1)
1. `[~]` **Executor, all-or-nothing — DONE in code 2026-08-02 (`<this commit>`), tests pending.** Also
   added `TurnEconomy.canSpend(slot)` (silent check-half of `trySpend`) + `ACTION_TYPE_SLOT` map. **This
   closed the piece-3 gap — activating an option now actually costs its turn slot** (Flurry etc.
   previously spent Ki but not the bonus action). `CombatVM.activateResourceOption(opt)` (in
   `state.svelte.ts`, where HP + tray + economy are all reachable): validate (`canAffordOption` AND the
   turn slot is free) → then deduct (`spendOption`, the resource math it already does) + spend the turn
   slot (`economy.trySpend`, `action_type`→slot; `free`=none) + execute the action token. Validate
   EVERYTHING before any mutation (ACTIONS.md core rule).
2. `[~]` **Action-token execution — `heal:` DONE (`runActionToken`); roll/apply_condition/gain_action next.** `heal:<formula>` → `rollFormula`
   (`dice.ts:199`) → `hp.current` clamped to `hpMax` + log; `roll:<formula>` → `rollFormula` →
   `tray.pushRoll` + log; `apply_condition:<id>` → `addEffect`; `note:` → toast (done); + a small new
   `gain_action` (Action Surge → refund one `play.turn.action`). Parse via the existing `parseToken`
   vocab, not a new ad-hoc parser.
3. `[x]` **Resolve the action formula's L2 at derive — DONE** (`resolveActionFormula`) — `resolveResourceOptions` resolves
   `heal:1d10+class_level.fighter` → `heal:1d10+5` (mirror resource-max / `grant_roll` resolution), so
   the option carries a ready dice formula.
4. `[x]` **Wire the UI — DONE** — `ActionsPanel.svelte` `spendOption(o)` → `activateResourceOption(o)`.
5. `[ ]` **← RESUME HERE: tests + Second Wind data.** Tests (combat: heal adds HP + costs the bonus +
   all-or-nothing block; derive: `heal:1d10+class_level.fighter`→`heal:1d10+5`). Then **ship Second Wind
   (+ Action Surge), both editions, RAW-faithful.** Rows already exist as
   TEXT-ONLY features (`fighter_second_wind`, `fighter_action_surge`, 2024 + 2014). Add
   `grant_resource:second_wind:<uses>:short` (+ `action_surge`) to their `effects`, and
   `resource_options` rows (Second Wind → `cost=1, action=heal:1d10+class_level.fighter,
   action_type=bonus_action`; Action Surge → `action=gain_action, action_type=free`). **Verify exact
   uses/recharge per SRD table** (2014: SW 1/rest, AS 1 (2@L17); 2024: SW 2→+1@L4/L10 via per-level
   re-grant rows, AS 1 (2@L17)). Convert from real SRD text — [[charnik-no-hallucinated-data]].
   Re-stamp with `pnpm restamp <file>` after the hand-edit — [[content-csv-hash-restamp]].

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

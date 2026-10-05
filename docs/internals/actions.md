# Charnik core action / event / state-channel model

> **STATUS: NORMATIVE SPECIFICATION — the `onUse` executor is implemented; the `onEvent` write-half
> and both plugin hooks are deferred.** This document OWNS the play-state mutation model that
> plugins.md §8 pins from the plugin side: using an ability, reacting to a game event, and the action
> economy are things the TRACKING app needs with or without plugins, so the model is a CORE concern
> and plugin hooks are THIN adapters returning this same shape. Where plugins.md §8 and this document
> disagree, THIS document wins.
> **Implementation:** `activateOption` + `runAction` (`src/lib/play/options.ts`), all-or-nothing
> validate→execute; `ActionExecutor` on the sheet is the names the panels call. What is still
> open is the plugin `onUse`/`onEvent` hooks at `api: 2`.

## 1. The three state channels

Every state transition in play maps to exactly one channel:

| Channel   | Fires               | Direction                     | Reads                              |
| --------- | ------------------- | ----------------------------- | ---------------------------------- |
| `passive` | every derive (auto) | READS state → contributions   | the dependency-resolved state      |
| `onUse`   | explicit user click | WRITES state, once            | the LIVE state at the click        |
| `onEvent` | a game event        | WRITES state, once            | the LIVE state at the event        |

`passive` is implemented (the derive pipeline: DAG resolve → facts → fold; the L3 plugin
`passive` hook rides it as a pre-pass). `onUse` is implemented for the native first slice (N2:
`activateOption` + `runAction`). `onEvent` is implemented for L1: an
`on_event:<event>:<action>` token runs one of the executor verbs when a fired event happens
(`turn_start` is the only member of the vocabulary, and it fires). The L3 PLUGIN `onEvent` hook —
arbitrary handler logic on an event — remains deferred to `api: 2`, and that is the deferred write
half this table's last row still describes.

## 2. The declarative intent — the ONE play-state mutation language

A use/event handler (native OR plugin) never mutates anything. It RETURNS an intent; the host
validates the WHOLE intent, then executes it through the systems that already exist. Every field
optional; `{}` = "nothing happened".

```json
{
	"rolls":   [{ "label": "Smite", "formula": "2d8" }],
	"spend":   [{ "resource": "grit", "n": 1 }],
	"effects": ["flat_bonus:ac+2", "apply_condition:blessed"],
	"hp":      { "delta": "2d4+2" },
	"tempHp":  { "amount": "cha" },
	"cost":    "bonus",
	"notes":   ["Second Wind"]
}
```

Host execution mapping (each field lands on an EXISTING system — no new mutation paths):

| Field     | Executes through                                                                  |
| --------- | --------------------------------------------------------------------------------- |
| `rolls`   | the one dice path (`rules/dice.ts` `rollPool`) + the roll log                     |
| `spend`   | `play.resourcesSpent` / spell-slot pools (affordability checked BEFORE anything)  |
| `effects` | the L1 token parser + `play.effects` add path (durations ride the round counter)  |
| `hp`      | the normal HP path (temp absorbs first, heal clamps to max, 0 → death-save flow)  |
| `tempHp`  | 5e "don't stack, take the higher"                                                 |
| `cost`    | the turn economy tracker (`action \| bonus \| reaction \| free`)                  |
| `notes`   | plain-text log/tooltip lines (never markup)                                       |

**Implemented executor verbs (N2 first slice, `runAction`).** Until the full JSON intent lands,
a native action is ONE bounded token in a `resource_options.action` column, dispatched by verb — each
still landing on an existing system per the table above:

| Token | Executes |
| --- | --- |
| `heal:<formula>` | HP path, clamped to max (L2-resolved to dice at derive) |
| `roll:<formula>` | the dice path + roll log |
| `apply_condition:<id>` | the `play.effects` add path |
| `apply_effect:<id>` | a NAMED `effects.csv` buff/debuff (Rage) → the `play.effects` add path via the "+"-catalog seam (its `ref` re-resolves LIVE, `negative`→buff/debuff, `duration_rounds`→timer). The multi-token, timed, positive analogue of `apply_condition` — a class-feature ACTIVATION that turns a state on (Enter Rage). |
| `gain_action` | one ADDITIONAL action this turn (Action Surge) — `play.turn.grantedActions`, which raises the per-turn max. Never a refund of a spent action: surging before you act must be worth a whole action, not nothing. It lives in play-state rather than as a `flat_bonus:action+1` effect because a grant is a one-turn fact and must still work with effects-auto off. |
| `rest:short` / `rest:long` | **take that rest** — the SAME system the rest buttons use (recharge pools by type, reset slots, restore HP + hit dice on a long rest, expire outlasted timed effects). Models a Potion of Angelic Slumber / a rest-granting spell. |
| `restore_resource:<id>` | regain ALL uses of a pool — `ResourceTracker.restoreAll` (Persistent Rage, Uncanny Metabolism) |
| `spend_resource:<id>[:<n>]` | **spend `n` uses (default 1) of ANOTHER pool** — the one the option's own `cost` does not name. A feature that pays out of a pool a different feature owns and is itself limited says both: Wild Resurgence's cost is its once-a-rest gate, and its action spends the use of Wild Shape. Checked with the cost, BEFORE anything is paid, so a pool that cannot cover it refuses the whole action. |
| `gain_slot:<level>` | **one more spell slot of that level** — `play.spellSlotsGained`, counted into the slot pools the cast and the pips read (`rules-core.md` ▸ Spellcasting). It is a slot, not a restored one: it stands above the table's count until a Long Rest. |
| `attack:<weapon id>[:<count>]` | **make `count` attacks** (default 1) with that weapon, through the ORDINARY attack path (`SheetRolls.rollAttackNow`) — same to-hit, magic bonus, Rage damage and scoped effects as a tap on the Attacks panel. Flurry of Blows is `attack:unarmed_strike:2`. The weapon is its **bare content id**, never its display name, so the token survives a translated sheet; `unarmed_strike` names the fists, which have no row. Charges **no turn slot of its own** — the option's `action_type` already paid for the whole flurry. A weapon the character has not equipped is **surfaced by toast**, because an action that rolls nothing is the bug this verb exists to remove. Capped at 12 strikes, against a content typo rather than against a rule. |
| `assume_form:<form id>` | **assume a form** whose rules the character's features state (`effects.md` ▸ A form) — Wild Shape. The one verb that ASKS before anything is paid: the picker opens on the eligible stat blocks, and the resource use and the turn slot are spent when one is taken, so backing out costs nothing. Taking one sets `play.form`, hands over hit points as the form's rules say, and adds the carrier effect whose clock is the form's. A form already worn is left first. |
| `note:<text>` | a log/toast line |
| `a;b;c` (a `;`-list) | **MULTI-action** — run each sub-token in order on ONE activation (Uncanny Metabolism = `restore_resource:focus;heal:<MA die>+monk_level`). Cost + turn slot are still validated once, up front (all-or-nothing). Ceiling: a `note:` can't contain `;` (it's the separator). |

**A verb lands on a system that EXISTS, so some class actions stay a `note:` on purpose.** Patient
Defense and Step of the Wind grant the Dodge, Disengage and Dash ACTIONS, and the app models none of
the three — a verb for them would be a play-state channel invented for one row.

> **`rest` constraint.** A consumable that GRANTS a rest (a potion = a `grant_resource` with charges +
> a `resource_option` whose `action` is `rest:short|long`) uses recharge **`consumable`** — a one-use /
> N-charge item whose charges are consumed and never refill on a rest (so the long rest it triggers
> can't refund its own charge → no infinite potions). `consumable` self-documents "one-use" where bare
> `other` (manual/special recharge) didn't. Delivery beyond resource-options (a spell casting an action
> token, a dedicated item-use path) is a follow-up; the `rest` verb itself is edition-agnostic and
> reachable today via the option path.

Core rules (owned HERE, restated for authors in plugins.md):

- **All-or-nothing.** Validate the entire intent (affordability, caps, well-formedness) first;
  apply every part or reject the whole with a notice. Never a partial (a spent resource with a
  failed heal).
- **Formulas, not rolled numbers.** Randomness stays in the host's single dice path — an intent
  carries `"2d6"`, never a number something else rolled (honest roll-log provenance).
- **Single-pass.** An intent is produced BEFORE any dice are rolled — roll-dependent OUTCOMES are
  formulas; roll-dependent LOGIC (read the die, then decide) needs a host callback and is a later
  API.
- **Self-target only.** An intent affects the active character (single-character app).
- **Fail-closed.** A handler throw / invalid intent applies NOTHING; write handlers never run
  during derive or render — only on a gesture/event.

**`resource_options` surfacing + identity (design decisions):**
- **A combat action-option (Flurry of Blows, Stunning Strike) surfaces in the ACTIONS block with a
  cost-chip — NOT under the resource pips.** Pips are pure counters (how many ki are left); *spending
  ki to DO something* is an action, and lives where actions live. Keep the two separate.
- **`resource_options.resource_id` links a `grant_resource` token's id through a FLAT namespace**
  (`"ki"`, not source-namespaced), and a row's identity is `(resource_id, id)` resolved via the
  collision UI. `isRowActive` (file+source filtering) applies to this table too.
- **`apply_condition` in an action is self-only** — there is no TARGET model, so an on-enemy effect
  (Stunning Strike's condition on the target) degrades to `note:` + the DC, not an applied condition.

**What a resource chip DOES depends on how many spend options the pool has.** With exactly ONE,
using the resource IS that action, so the chip runs `activateOption`: validate → spend →
charge the turn slot → run the token. With several options or none it only decrements — there is no
single action to infer, and that doubles as the honest escape hatch for spending a resource on
something unmodelled. **Only the pool's OWN options are counted.** An option another feature gives
on the pool carries that feature's id in `granted_by` — Wild Companion, Land's Aid and Nature's
Sanctuary each spend a use of Wild Shape — and it is offered only to a character who has the
feature: absent otherwise, never greyed, because greyed is for a window that can open. Those are
further uses of the pool, so they do not stop the chip from being what the pool exists for. An L2 `available` guard is enforced INSIDE `activateResourceOption`, never as
a `disabled` attribute, so no caller can route around it.

## 3. The event vocabulary (pinned)

`turnStart` · `turnEnd` · `attackMade` · `damageTaken` · `rest` · `wentUnconscious` ·
`effectGained` · `effectLost`. **This is the vocabulary a plugin `onEvent` handler grows towards;
what the app fires TODAY is the smaller `PLAY_EVENT` set in `token-parser.ts`** (`turn_start`), which
L1's `on_event:<event>:<action>` hooks — an event name the app does not fire would parse cleanly and
then never happen, so a new trigger is a name there plus the one call site that fires it. The last two map onto the existing `play.effects` add/expire path —
a condition IS an effect, so "gained poisoned" and "gained rage" are the same event, carrying
`{ effect: { id, source, positive, durationRounds? } }`. Guards (pinned with the vocabulary):
post-hoc not veto (`effectGained` fires AFTER application); no recursive cascade (an intent
applied by an event handler does not re-fire events); deterministic order (multiple listeners
resolve in a fixed order).

## A class's action list is DATA, never a hardcoded list

Battle Master maneuvers, Monk ki actions, Rogue cunning action, Barbarian rage, Sorcerer metamagic,
Warlock invocations, Paladin and Cleric Channel Divinity, Druid Wild Shape — every one of them is the
same shape: a named list of options bound to a class **resource**, shown only for the granting class.
So there is ONE generic feature-action group panel and no class-name branch anywhere near it. The
entries come from content rows, which is what lets homebrew merge identically — a user adds a
maneuver exactly as they add a spell, source-namespaced and behind the same per-source toggle.

## 4. Consumers, in build order

1. **Native activatable actions (N2's action kind) — the 90% case, no sandbox.** An action is DATA: its
   activation IS a static intent (spend + effects + cost + rolls) read from content columns and
   executed by the host on click. This ships first and exercises the executor.
2. **Plugin `onUse` (`api: 2`).** A sandbox handler computes the intent from `(token, ctx)` —
   same shape, same validation, plus the sandbox caps (plugins.md §8.2).
3. **Plugin `onEvent` (`api: 2+`).** Same intent, fired by the event vocabulary above.

## 5. Where a mutation lives

A play-state action is a pure function in `src/lib/play`:
`(character, intent, ctx) → { character, log, notices }`. It returns the character that results and
never writes to the one it was given; the roll-log lines and the notices it would have raised come
back as data. The view-model builds the intent from its form fields and carries the outcome out
through one method, `CombatVM.act` (`play-outcomes.ts`) — the only place a result reaches the held
character (`adoptCharacter`, in place, so only what moved re-renders), the roll log and the toasts.
A caller with no screen calls the same function and gets the same character.

Every verb on the play sheet that changes what a character IS at the table is one: hit points and
dying, effects and exhaustion, concentration, pools and spell slots, rests, the turn, forms,
experience, a feature's spend-option and its verbs, the two events that fire features, a cast, and
what is carried.

- **`ctx.derive` is a function, not a sheet**, because an action can change what the sheet says in
  the middle of itself: a hit that breaks a form is finished against the character's own hit-point
  maximum, where the sheet it started with still states the form's.
- **The rules that follow a change live inside the action.** `settlePlay` (`play/settle.ts`) states
  each once — a form that has ended is left, concentration is ended by 0 HP, incapacitation or a
  state that forbids it, current HP never stands above the effective maximum, and no death-save
  track survives above 0 HP — and runs at the end of every action that can move one of their
  causes, re-deriving the sheet after each step until nothing moves. A rule enforced by something
  that watches the screen holds only while that screen is mounted.
- **A swap is ONE action.** A re-cast takes the old effect down and puts the new one up inside
  `castSpell`: settled between the two, a clamp would cost the hit points the new effect gives
  back.
- **An intent carries numbers and ids, never a token or a dice formula.** The dice are the
  action's own (`ctx.rng`), so a roll's provenance is the function that made it.
- **An action is all-or-nothing, and says when it was nothing.** A pool that cannot pay, an empty
  Hit Die, a turn slot already spent — the outcome is `refused`, carries the notice, and its
  character is the one it was given. `act` returns that as a boolean, so a caller with a further
  step reads it before taking it. `chain` runs one action after another as ONE outcome, and stops
  at a refused first step.
- **A roll the player may build is the host's, and the action ASKS for it.** A strike made by an
  `attack:` verb and the rolls of a cast come back in the outcome's `asks`, and the sheet rolls
  them through its own paths — the tray, the effects on the roll, ammunition. The action has paid
  for the roll, and nothing about the result lands in play-state, so it is neither an argument (a
  caller would be handing in a number it rolled) nor the action's own (the tray could not build
  it). A QUESTION is the other thing asked: which stat block a form takes, and which weapon a
  spell is laid on, is put before anything is paid, and the action is called again with the
  answer.
- **An option is reachable by id.** `activateOptionById` names it as a row is identified — its own
  id on the pool it spends — and reads everything else off the sheet. The sheet's own panels hand
  over the option they are showing.
- **What is not play-state is not in the character.** A concentration save a hit left owed comes
  back beside the character (`concentrationSave`); the view-model holds it and drops it when the
  concentration it names ends.
- **The inventory is build data and its play-time verbs are actions all the same**, because what
  is equipped and attuned moves the sheet. What moves no rule stays a plain write in the
  view-model: a view preference, a prepared mark, which ability a finesse weapon is swung with.
- **The sheet can change with no action at all** — content reloaded, a source or a plugin
  switched — and the combat page asks the same rules again when it does
  (`PlayOutcomes.settle`, in an `$effect`). That is the one thing still enforced by a mounted
  screen, and nothing a verb relies on: with no screen there is no reload to react to, and the next
  action settles.

## 6. Relation to the resolve order

The read half (`passive`, conditional effects, dependency order, cycle = content bug) is already
implemented and specified in plan.md (the derive stage list) and plugins.md §8.4 — this document
does not duplicate it.

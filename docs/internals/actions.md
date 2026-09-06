# Charnik core action / event / state-channel model

> **STATUS: NORMATIVE SPECIFICATION — the `onUse` executor is implemented; the `onEvent` write-half
> and both plugin hooks are deferred.** This document OWNS the play-state mutation model that
> plugins.md §8 pins from the plugin side: using an ability, reacting to a game event, and the action
> economy are things the TRACKING app needs with or without plugins, so the model is a CORE concern
> and plugin hooks are THIN adapters returning this same shape. Where plugins.md §8 and this document
> disagree, THIS document wins.
> **Implementation:** `ActionExecutor.activateResourceOption` + `runActionToken`
> (`src/routes/combat/action-executor.svelte.ts`), all-or-nothing validate→execute. What is still
> open rides `plan.md` — the `onEvent` generalization under RECHARGE-TAIL, plugin `onUse`/`onEvent`
> at `api: 2`.

## 1. The three state channels

Every state transition in play maps to exactly one channel:

| Channel   | Fires               | Direction                     | Reads                              |
| --------- | ------------------- | ----------------------------- | ---------------------------------- |
| `passive` | every derive (auto) | READS state → contributions   | the dependency-resolved state      |
| `onUse`   | explicit user click | WRITES state, once            | the LIVE state at the click        |
| `onEvent` | a game event        | WRITES state, once            | the LIVE state at the event        |

`passive` is implemented (the derive pipeline: DAG resolve → facts → fold; the L3 plugin
`passive` hook rides it as a pre-pass). `onUse` is implemented for the native first slice (N2:
`activateResourceOption` + `runActionToken`); `onEvent` (and both plugin hooks) remain the deferred
write half.

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

**Implemented executor verbs (N2 first slice, `runActionToken`).** Until the full JSON intent lands,
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
| `attack:<weapon id>[:<count>]` | **make `count` attacks** (default 1) with that weapon, through the ORDINARY attack path (`SheetRolls.rollAttackNow`) — same to-hit, magic bonus, Rage damage and scoped effects as a tap on the Attacks panel. Flurry of Blows is `attack:unarmed_strike:2`. The weapon is its **bare content id**, never its display name, so the token survives a translated sheet; `unarmed_strike` names the fists, which have no row. Charges **no turn slot of its own** — the option's `action_type` already paid for the whole flurry. A weapon the character has not equipped is **surfaced by toast**, because an action that rolls nothing is the bug this verb exists to remove. Capped at 12 strikes, against a content typo rather than against a rule. |
| `note:<text>` | a log/toast line |
| `a;b;c` (a `;`-list) | **MULTI-action** — run each sub-token in order on ONE activation (Uncanny Metabolism = `restore_resource:focus;heal:<MA die>+monk_level`). Cost + turn slot are still validated once, up front (all-or-nothing). Ceiling: a `note:` can't contain `;` (it's the separator). |

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
using the resource IS that action, so the chip runs `activateResourceOption`: validate → spend →
charge the turn slot → run the token. With several options or none it only decrements — there is no
single action to infer, and that doubles as the honest escape hatch for spending a resource on
something unmodelled. An L2 `available` guard is enforced INSIDE `activateResourceOption`, never as
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

1. **Native activatable actions (N2 shape 2) — the 90% case, no sandbox.** An action is DATA: its
   activation IS a static intent (spend + effects + cost + rolls) read from content columns and
   executed by the host on click. This ships first and exercises the executor.
2. **Plugin `onUse` (`api: 2`).** A sandbox handler computes the intent from `(token, ctx)` —
   same shape, same validation, plus the sandbox caps (plugins.md §8.2).
3. **Plugin `onEvent` (`api: 2+`).** Same intent, fired by the event vocabulary above.

## 5. Relation to the resolve order

The read half (`passive`, conditional effects, dependency order, cycle = content bug) is already
implemented and specified in plan.md (the derive stage list) and plugins.md §8.4 — this document
does not duplicate it.

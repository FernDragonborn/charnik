# Charnik core action / event / state-channel model

> **STATUS: NORMATIVE SPECIFICATION — `onUse` executor implemented (first slice); `onEvent` +
> plugin hooks deferred.** This document OWNS the play-state mutation model that PLUGINS.md §8
> previously pinned from the plugin side — the fresh-eyes #1 correction (2026-07-15, PLAN.md):
> using an ability, reacting to a game event, and the action economy are things the TRACKING app
> needs with or without plugins, so the model is a CORE concern and plugin hooks are THIN adapters
> returning this same shape. Where PLUGINS.md §8 and this document disagree, THIS document wins.
> **Implementation:** the `onUse` write-half shipped with N2 (activatable actions, shape 2) —
> `CombatVM.activateResourceOption` + `runActionToken` (`src/routes/combat/state.svelte.ts`),
> all-or-nothing validate→execute, verified 2026-08-02 (see `docs/N2-PLAN.md`). **Still deferred:**
> the `onEvent` write-half (`docs/RECHARGE-PLAN.md` slice 2) and plugin `onUse`/`onEvent`
> (`api: 2`), which hook in after.

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
| `gain_action` | refund one action this turn (Action Surge) |
| `rest:short` / `rest:long` | **take that rest** — the SAME system the rest buttons use (recharge pools by type, reset slots, restore HP + hit dice on a long rest, expire outlasted timed effects). Models a Potion of Angelic Slumber / a rest-granting spell. |
| `note:<text>` | a log/toast line |

> **`rest` constraint.** A consumable that GRANTS a rest (a potion = a `grant_resource` with charges +
> a `resource_option` whose `action` is `rest:short|long`) uses recharge **`consumable`** — a one-use /
> N-charge item whose charges are consumed and never refill on a rest (so the long rest it triggers
> can't refund its own charge → no infinite potions). `consumable` self-documents "one-use" where bare
> `other` (manual/special recharge) didn't. Delivery beyond resource-options (a spell casting an action
> token, a dedicated item-use path) is a follow-up; the `rest` verb itself is edition-agnostic and
> reachable today via the option path.

Core rules (owned HERE, restated for authors in PLUGINS.md):

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

## 3. The event vocabulary (pinned)

`turnStart` · `turnEnd` · `attackMade` · `damageTaken` · `rest` · `wentUnconscious` ·
`effectGained` · `effectLost`. The last two map onto the existing `play.effects` add/expire path —
a condition IS an effect, so "gained poisoned" and "gained rage" are the same event, carrying
`{ effect: { id, source, positive, durationRounds? } }`. Guards (pinned with the vocabulary):
post-hoc not veto (`effectGained` fires AFTER application); no recursive cascade (an intent
applied by an event handler does not re-fire events); deterministic order (multiple listeners
resolve in a fixed order).

## 4. Consumers, in build order

1. **Native activatable actions (N2 shape 2) — the 90% case, no sandbox.** An action is DATA: its
   activation IS a static intent (spend + effects + cost + rolls) read from content columns and
   executed by the host on click. This ships first and exercises the executor.
2. **Plugin `onUse` (`api: 2`).** A sandbox handler computes the intent from `(token, ctx)` —
   same shape, same validation, plus the sandbox caps (PLUGINS.md §8.2).
3. **Plugin `onEvent` (`api: 2+`).** Same intent, fired by the event vocabulary above.

## 5. Relation to the resolve order

The read half (`passive`, conditional effects, dependency order, cycle = content bug) is already
implemented and specified in PLAN.md (the derive stage list) and PLUGINS.md §8.4 — this document
does not duplicate it.

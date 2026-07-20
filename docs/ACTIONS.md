# Charnik core action / event / state-channel model

> **STATUS: NORMATIVE SPECIFICATION (core executor not yet implemented).** This document OWNS the
> play-state mutation model that PLUGINS.md §8 previously pinned from the plugin side — the
> fresh-eyes #1 correction (2026-07-15, PLAN.md): using an ability, reacting to a game event, and
> the action economy are things the TRACKING app needs with or without plugins, so the model is a
> CORE concern and plugin hooks are THIN adapters returning this same shape. Where PLUGINS.md §8
> and this document disagree, THIS document wins. Implementation lands with the core "activatable
> actions" feature (N2 shape 2); plugin `onUse`/`onEvent` (`api: 2`) hook in after.

## 1. The three state channels

Every state transition in play maps to exactly one channel:

| Channel   | Fires               | Direction                     | Reads                              |
| --------- | ------------------- | ----------------------------- | ---------------------------------- |
| `passive` | every derive (auto) | READS state → contributions   | the dependency-resolved state      |
| `onUse`   | explicit user click | WRITES state, once            | the LIVE state at the click        |
| `onEvent` | a game event        | WRITES state, once            | the LIVE state at the event        |

`passive` is implemented (the derive pipeline: DAG resolve → facts → fold; the L3 plugin
`passive` hook rides it as a pre-pass). `onUse` / `onEvent` are the deferred write half.

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

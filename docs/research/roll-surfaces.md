# Roll surfaces in existing trackers — how a rolled attack is shown, and where a per-roll decision lives

Research collected 2026-08-10 while designing the volley toast (UBUG-11/UBUG-20) and the
per-attack damage reroll. Companion to `existing-generators.md`, which covers **builders**;
this one covers the **play/roll surface** — the thing Charnik's `RollToast` + roll log are.

The question that started it: with a multi-attack action (Extra Attack, Flurry of Blows), a
once-per-turn reroll (2024 Savage Attacker) applies to **one** attack — so the player must pick
WHICH. How do the existing tools surface that?

## The short answer: nobody solved it

The field splits into two camps, and **both avoid the situation rather than resolving it**.

### Camp 1 — one chat card per attack (the default nearly everywhere)

Stock **Foundry dnd5e**: an Attack activity produces its own chat card with its own damage
button. Extra Attack is not automated — the player presses the attack button again. **Roll20**
and **Fantasy Grounds** are the same shape: one roll, one output line.

The "which attack?" question never arises, because a reroll button physically lives on its own
card. This is avoidance, not a solution — but it is cheap and it works.

### Camp 2 — a grouped card (opt-in, third-party)

Getting Charnik's shape in Foundry needs a module. **Multiattack 5e** patches `rollAttack` /
`rollDamage`, suppresses the original chat messages, and renders the array of rolls through its
own template as **one condensed card**. RSReforged does something similar (attack + damage split
by type + per-target apply buttons in one card).

Grouping buys compactness and costs exactly the thing at issue: these modules have no per-attack
decision affordance. The rows are a readout, not a set of targets.

## D&D Beyond is the instructive case

Savage Attacker on DDB is **effectively not automated** — the feat adds text saying you may
reroll, with no mechanic behind it. Community threads name the reason directly: once-per-turn
features "are super annoying when having multiple attacks and make it work poorly with extra
attack automation."

So the largest commercial tracker **declined to automate it**, and the stated blocker is exactly
the combination Charnik is walking into: *once per turn* × *several attacks*.

For **Midi-QOL** (the deepest automation stack in Foundry) no documented "choose which attack to
reroll" flow was found.

## Lessons for Charnik

1. **Grouped card + per-row action is genuinely unoccupied ground.** Not a risk to steer around —
   it is the part of the design that does something the existing tools don't. Worth the cost.
2. **A separate reroll button doesn't scale to the grouped card.** Camp 2's cards prove the
   negative: once there are N rows, one bar under the card can't say which row it means, and N
   bars is not a design. The affordance has to live *on the row*, ideally on the thing being
   rerolled (the damage pill), not beside it.
3. **The blocker DDB hit is a UI problem, not a rules problem.** The rules are unambiguous (pick
   one attack, once per turn); what nobody built is a surface where picking is natural.
4. **Sequential resolution is a formality more than a practice.** RAW resolves attacks one at a
   time, so no existing tool grants the player "see all three, then choose" — but real tables
   routinely roll every attack and every damage die at once. A grouped card is closer to how
   people actually play than sequential cards are; the information gain is a deviation from RAW
   procedure, not from RAW outcome. (Maintainer decision 2026-08-10: acceptable, surfaced.)

## Sources

- Multiattack 5e — module that condenses several attacks into one chat card:
  <https://github.com/jessev14/Multiattack-5e>
- Foundry dnd5e — Activity Type: Attack (stock per-attack card behaviour):
  <https://github.com/foundryvtt/dnd5e/wiki/Activity-Type-Attack>
- RSReforged (quick rolls, damage split by type, per-target buttons in one card):
  <https://foundryvtt.com/packages/rsreforged>
- Savage Attacker (2024 text) — D&D Beyond:
  <https://www.dndbeyond.com/feats/1789183-savage-attacker>
- DDB forum — Savage Attacker automation + the once-per-turn / Extra Attack conflict:
  <https://www.dndbeyond.com/forums/dungeons-dragons-discussion/rules-game-mechanics/205817-savage-attacker>
- Midi Quality of Life Improvements: <https://foundryvtt.com/packages/midi-qol>

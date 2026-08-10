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

---

# Part 2 — how a roll gets CONFIGURED (advantage, modifiers) before it fires

Researched 2026-08-10 for a separate question: Charnik binds Alt/Ctrl-click on a stat to "open the
roll tray", and the app is explicitly used on a phone, where modifiers do not exist. What do the
others bind, and how do they reach it on touch?

## The single most useful finding: nobody binds a modifier to "open the configurator"

Every tool surveyed binds the gesture to the **outcome** — roll with advantage, roll with
disadvantage — not to "open a thing where you can choose". Charnik's `Alt-click → tray` is the odd
one out, and it costs an extra step for the case that dominates play.

That is independent confirmation of the decomposition argued in PLAN (UX/tray discussion): for a
skill/save/ability row the pool is always 1d20, so the tray offers exactly two things — advantage and
a manual modifier — and advantage is the frequent one by a wide margin. Access should be to the
frequent OPTION, not to the configurator holding it.

## The three shipped strategies

**Foundry dnd5e — dialog by default, modifiers as accelerators.** A click opens the roll dialog;
holding **Shift** fast-forwards using whatever advantage mode is already in play, **Alt** adds a
source of advantage, **Control** adds a source of disadvantage. Skipping the dialog is exposed as a
*named key binding* rather than a hardcoded key — and a small industry of modules (MRE, Ready Set
Roll, Advantage Reminder) exists to reconfigure these. That modules exist at all is the finding: no
default modifier set satisfies everyone, which matches the collision analysis (Foundry's
`Ctrl` = disadvantage is macOS's secondary click). Desktop-only culture — no touch story.

**Roll20 — four user-selectable strategies, because tables differ.** The 5E sheet's Settings tab has
a "Roll Queries" option with: *Always Roll Advantage* (the default — roll two d20 every time and show
both), *Advantage Toggle*, *Query Advantage* (prompt on every roll), *Never Roll Advantage*.
- **"Advantage Toggle" is precisely the three-state armed control** proposed for Charnik: it adds
  Advantage / Normal / Disadvantage buttons **at the top of the sheet**, and you then click rows
  normally. So the idea is shipped and load-bearing in the largest VTT, not speculative.
- Roll20's *default*, though, is a fourth idea worth keeping in mind: **ask nothing, roll 2d20 always,
  show both**. Zero UI cost and zero gestures — but noisy, and it has no answer for "what is the
  total", which matters for a toast built around one big number.
- Shipping four is itself a caution in both directions: no single strategy fits every table, but four
  settings for one question is a lot of surface.

**D&D Beyond — one gesture, identical on desktop and touch.** Advantage/disadvantage is reached by
**right-click on desktop or long-press on mobile**, then picking the option from the menu. Same
mental model on both inputs, no per-row control, no modifier.

## Part 3 — what the Foundry module ecosystem is actually fixing

A caveat on popularity first: **no reliable install-count ranking was obtainable.** Foundry's own
year-in-review reports only that a typical user runs ~19 modules, and names Midi-QOL and Dice So Nice
among the popular ones. What follows is therefore read from *what the modules do and how many
independently attack the same problem* — which is itself the signal, not a substitute for it.

### The complaint: too many clicks, in too many places

Core dnd5e takes roughly **four clicks in three different locations** to resolve one attack: click
the attack on the sheet → pick normal/advantage/disadvantage in a dialog → find the result in chat →
click "damage" there → pick normal/critical. This is the ecosystem's central grievance and it has
produced a whole family of independent fixes:

- **Faster Rolling by Default** — *inverts the prompt*: never ask, unless Shift is held.
- **RSReforged** (maintained fork of **Ready Set Roll**) — skill/save/attack/damage straight to chat,
  no dialog; attack and damage in one card with per-target apply buttons.
- **Better Rolls 5e** (now unmaintained) — attack grouped with damage in one card.
- **Minimal Rolling Enhancements (MRE)** — configurable modifier keys for the same.

**Careful with the credit here — two different things are being conflated, and only one of them is
uncommon:**

| | roll fires on | attack + damage |
|---|---|---|
| **D&D Beyond** | instant tap | **two separate taps** (to-hit, then damage) |
| **Roll20 5E** | instant (default even rolls 2d20 and shows both) | separate buttons |
| **Foundry dnd5e** | **a dialog first** | separate: attack card → damage button in chat |
| **Charnik** | instant tap | **one tap → one card carrying both** |

1. **Instant rolling is the NORM, not an edge** — D&D Beyond and Roll20 both fire on tap. Foundry is
   the outlier, and the modules above exist to make Foundry behave like the other two. So "don't
   regress toward a pre-roll dialog" is sound advice, but it is *staying normal*, not leading.
2. **Grouping the to-hit and every damage type into ONE action and ONE card is the uncommon part.**
   Foundry needs a module for it; D&D Beyond and Roll20 keep them as separate rolls. That is where
   Charnik is actually ahead, and it is the thing worth protecting.

### The genuinely important find: RETROACTIVE advantage

There is a dedicated, actively maintained module — **Retroactive Advantage DnD5e** — whose entire
purpose is buttons **on the result card** that change a d20 roll's advantage state *after* it was
rolled, reusing the dice already rolled. The same feature is built into **Ready Set Roll** and
**RSReforged**, the latter also offering "promote a hit to a critical" and "change which die is kept".
Three independent implementations of one idea is a strong demand signal.

**Why this matters more than it first looks: retroactive advantage is not a fudge, it is RAW-exact.**
The rule says roll a second d20 and use the higher. Rolling that second d20 *after* the first changes
nothing mechanically — so a player who learns mid-resolution that they had advantage (which is how
tables actually play; the DM says it after the die is already on the table) can have it applied with
no fiction broken and no re-roll of the original.

### What that does to the advantage problem

It **dissolves** it rather than solving it. The armed three-state toggle proposed earlier (Roll20's
"Advantage Toggle") exists to capture a decision *before* the roll — and its documented failure mode
is that people forget it is armed. If advantage can be applied *after*, there is nothing to arm,
nothing to forget, no per-row control, no mode, and no pre-roll gesture at all:

> Roll. If it turns out to have been advantaged, tap the d20 pill and a second d20 joins it.

That is zero interface space, works identically with a mouse and a finger, needs no modifier key, and
needs no tutorial provided the pill looks like a control. **It also unifies with the Savage Attacker
reroll already designed** (PLAN UBUG-20): the pill is not a one-off affordance for one feat, it is the
general interaction model of a roll card — click the d20 to change how it was rolled, click a damage
pill to reroll what it dealt.

**And it retroactively justifies the shared toast/log renderer.** A transient toast is a poor host for
an after-the-fact edit; the log is permanent and, being the same component, inherits every pill
control for free and forever. The decision to share the renderer pays for itself here.

**Caveat to carry:** an edited roll must stay a truthful record — the log entry should say the roll was
changed after the fact (the existing `savageReroll` note pattern, "kept X, other roll Y"). Whether a
player is *entitled* to the advantage is a table-trust question, not ours to police
([[play-tracker-surfaces-never-forces]]).

## What this settles for Charnik

1. **The touch question has an industry answer and it is not a per-row button.** Long-press is the
   touch equivalent of right-click, and DDB ships exactly that for exactly this. So the context-menu
   proposal costs zero interface space on either input.
2. **A modifier should map to an outcome, not to a configurator.** If a modifier survives at all it
   should be "roll with advantage", not "open the tray".
3. **The armed three-state control is proven but SUPERSEDED — see Part 3.** Roll20's "Advantage
   Toggle" ships it, and its documented failure is that people forget it is armed ("keeps rolling with
   advantage" threads). An auto-resetting charge would patch that failure; **retroactive advantage
   removes the failure's cause instead**, and costs no interface at all. Prefer retroactive.
4. **Do not hardcode one strategy.** Roll20 needed four settings; Foundry needed rebindable keys. The
   lesson is not "add settings" but "pick a default that is harmless when the user does nothing" — and
   a roll that can be amended afterwards is exactly that.
5. **Don't regress toward a pre-roll dialog** — but that is staying normal, not leading: instant
   rolling is already the norm (D&D Beyond, Roll20), and Foundry is the outlier its own modules are
   fixing. **The part actually worth protecting is the GROUPING** — one tap producing one card that
   carries the to-hit and every damage type. Foundry needs a module for that and the other two don't
   do it at all (Part 3).

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

Part 2:

- Foundry dnd5e — advantage/disadvantage modifier keys + skip-dialog binding:
  <https://github.com/foundryvtt/dnd5e/issues/4515> ·
  <https://github.com/foundryvtt/dnd5e/issues/5338>
- Minimal Rolling Enhancements (configurable modifier keys):
  <https://foundryvtt.com/packages/mre-dnd5e>
- Ready Set Roll for D&D5e: <https://github.com/MangoFVTT/fvtt-ready-set-roll-5e>
- Advantage Reminder for dnd5e (hold Ctrl/Alt/Shift/Meta to fast-forward):
  <https://foundryvtt.com/packages/adv-reminder>
- Roll20 5E sheet — Roll Queries setting (Always / Advantage Toggle / Query / Never):
  <https://help.roll20.net/hc/en-us/articles/360037773573-D-D-5E-by-Roll20> ·
  <https://wiki.roll20.net/D%26D_5E_by_Roll20>
- Roll20 forums — the persistent-toggle failure mode ("keeps rolling with advantage"):
  <https://app.roll20.net/forum/post/7296302/keeps-rolling-with-advantage>
- D&D Beyond — right-click / long-press for advantage & disadvantage:
  <https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/digital-dice-feedback/66074-roll-with-advantage-or-disadvantage>
- D&D Beyond — Digital Dice on the mobile app:
  <https://www.dndbeyond.com/posts/920-digital-dice-are-now-live-on-the-mobile-app>

Part 3:

- dnd5e issue — redundant clicks rolling items from the sheet:
  <https://github.com/foundryvtt/dnd5e/issues/4459>
- dnd5e issue — attack/damage buttons on the inventory tab:
  <https://github.com/foundryvtt/dnd5e/issues/3022>
- Faster Rolling by Default (invert the prompt; Shift to ask):
  <https://foundryvtt.com/packages/faster-rolling-by-default-5e>
- RSReforged (maintained fork of Ready Set Roll): <https://foundryvtt.com/packages/rsreforged> ·
  <https://github.com/arrowedisgaming/RSReforged>
- Better Rolls 5e (unmaintained; attack grouped with damage):
  <https://github.com/RedReign/FoundryVTT-BetterRolls5e>
- **Retroactive Advantage DnD5e** — change a d20 roll's advantage state from the chat card:
  <https://foundryvtt.com/packages/retroactive-advantage-5e> ·
  <https://github.com/ElfFriend-DnD/foundryvtt-retroactive-advantage-5e>
- Foundry VTT Year in Review 2026 (module counts; no per-module install ranking published):
  <https://www.enworld.org/threads/foundry-vtt-year-in-review-2026-most-popular-game-systems.719217/>

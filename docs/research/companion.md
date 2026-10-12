# A bound creature — per-edition spec sheet (the research COMPANION starts as)

Source of every rules statement below: the SHIPPED SRD content repo `charnik-content-srd`,
`spells_srd.csv`, `class_features_srd.csv`, `items_srd.csv` and `monsters_srd.csv` of both packs,
column `text_en`. Nothing here comes from a rulebook or from memory. Quotes are verbatim.

Rows read in full: `find_familiar` and `find_steed` (both packs); 2014 `warlock_pact_boon`,
`conjure_animals`, `conjure_elemental`, `animate_dead`, `animate_objects`, `staff_of_the_python`,
`bag_of_tricks`, `figurine_of_wondrous_power`; 2024 `druid_wild_companion`,
`paladin_faithful_steed`, `draconic_sorcery_dragon_companion`, `giant_insect`, `summon_dragon`,
`animate_dead`, `animate_objects`, `staff_of_the_python`, `bag_of_tricks`. Found by matching every
shipped row's text against the words a bond is stated in (familiar, steed, summon, obeys, "under
your control", "initiative", "command"): 39 spell rows, 4 class features and 23 items in 2014;
28, 5 and 24 in 2024. Most only mention a companion in passing; the ones above define one.

**What is NOT shipped, and so is not specified here:**

- **A ranger's companion.** No row of either pack mentions a Beast Master or a Primal Companion —
  the SRD's ranger has the Hunter only. The work item's "a 2024 Beast Master's companion spends
  the OWNER's action" is a rule from outside both packs.
- **The 2024 Pact of the Chain.** No 2024 row mentions it. The 2014 one is a paragraph inside
  `warlock_pact_boon`, a choice of three that has no row per option.
- **The rules on mounted combat.** 2024 Find Steed points at them — "it functions as a controlled
  mount while you ride it (as defined in the rules on mounted combat)" — and the packs carry no
  rules chapters (`../work/content.md` ▸ RULES-TEXT).
- **Most of three 2024 stat blocks.** Find Steed "uses the **Otherworldly Steed** stat block",
  Giant Insect and Summon Dragon each use one of their own, and those stat blocks live in the
  spell's own text as an HTML table that ends after the six ability scores. Armor Class, hit
  points, speed, traits and actions are not in the cell, and there is no monster row for any of
  the three. The one sentence about scaling that did ship is Find Steed's `higher_level`: "Use the
  spell slot's level for the spell's level in the stat block." So a 2024 paladin's steed has no
  numbers the app can show without typing them from somewhere else — the failure `AGENTS.md`
  names first.

Every other creature these rows name IS a monster row in both packs: the familiar's forms that the
SRD prints, `imp`, `pseudodragon`, `quasit`, `sprite`, `warhorse`, `mastiff`, `skeleton`, `zombie`,
`giant_constrictor_snake`.

---

## 1. What the creature is

**It is a stat block somebody else printed, with one or two lines changed.**

> 2014 Find Familiar: "the familiar has the statistics of the chosen form, though it is a celestial, fey, or fiend (your choice) instead of a beast."
> 2014 Find Steed: "The steed has the statistics of the chosen form, though it is a celestial, fey, or fiend (your choice) instead of its normal type. Additionally, if your steed has an Intelligence of 5 or less, its Intelligence becomes 6, and it gains the ability to understand one language of your choice that you speak."
> 2024 Find Familiar: "the familiar has the statistics of the chosen form (see "Monsters"), though it is a Celestial, Fey, or Fiend (your choice) instead of a Beast."

So the model the work item already fixed — an editable overlay over a monster ref — is what the
text describes, and the overlay is not only for drift at the table: the spell itself writes into it
(creature type, an Intelligence floor, a language).

**Which stat block is a choice from a list the row states**, and the list is prose in both packs:
"bat, cat, crab, frog (toad), hawk, lizard, octopus, owl, poisonous snake, fish (quipper), rat,
raven, sea horse, spider, or weasel" (2014), the same without four and with "or another Beast that
has a Challenge Rating of 0" (2024). The second half is the shape Wild Shape's eligibility already
has (`form:<id>:creature:beast`, `max_cr`); the first half is a list of ids.

**How many, and for how long, differs by source:**

| | lasts | how many |
| --- | --- | --- |
| Find Familiar (both) | until dismissed or 0 hit points; "It reappears after you cast this spell again" | "You can't have more than one familiar at a time" |
| 2024 Wild Companion | the same spell, but "disappears when you finish a Long Rest" | one |
| Find Steed 2014 | "a long-lasting bond"; casting again "summons the same steed, restored to its hit point maximum" | "You can't have more than one steed bonded by this spell at a time" |
| Find Steed 2024 | until 0 hit points "or if you die" | "the steed is replaced by the new one" |
| Conjure Animals 2014 | concentration; "disappears when it drops to 0 hit points or when the spell ends" | one, two, four or eight, by Challenge Rating |
| Animate Dead (both) | "under your control for 24 hours", renewed by casting again | "up to four creatures" reasserted per casting, with no ceiling stated on the total |

A familiar and a steed are things a character HAS between sessions. A conjured animal is an effect
with a clock. The file has to hold the first kind; the second kind is closer to an active effect
that happens to have hit points.

---

## 2. Whose turn it acts on — the editions disagree, and so do the rows inside one edition

| Source | Initiative | What a command costs |
| --- | --- | --- |
| Find Familiar, 2014 and 2024 | "it rolls its own initiative and acts on its own turn" | nothing stated: "it always obeys your commands" |
| Conjure Animals / Elemental, 2014 | "Roll initiative for the summoned creatures as a group, which has its own turns" | "(no action required by you)" |
| Staff of the Python, 2014 | "acts on its own initiative count" | "On your turn, you can mentally command the snake" — no cost stated |
| Animate Dead, both | not stated | "a bonus action to mentally command" (2014) · "a Bonus Action" (2024) |
| Bag of Tricks, 2024 | "it acts immediately after you on your Initiative count" | "a Bonus Action to command how the creature moves and what action it takes" |
| Giant Insect, Summon Dragon, 2024 | "shares your Initiative count, but it takes its turn immediately after yours" | "(no action required by you)" |
| Animate Objects, 2024 | "shares your Initiative count and takes its turn immediately after yours" | "a Bonus Action to mentally command" |
| Staff of the Python, 2024 | "shares your Initiative count, taking its turn immediately after yours" | "(no action required)" |
| Find Steed, 2024 | "it shares your Initiative count, and it functions as a controlled mount while you ride it"; if you are Incapacitated, "takes its turn immediately after yours and acts independently" | the mounted-combat rules, not shipped |
| Find Steed, 2014 | **NOT IN SRD row** — "Your steed serves you as a mount, both in combat and out" | not stated |

Three things follow.

- **It is two facts per source, not one per edition**: where the creature sits in the order (its
  own roll · right after you · with you as a mount) and what telling it to act costs (nothing ·
  free on your turn · a Bonus Action). 2024 moved most summons to "right after you", and left the
  familiar where it was.
- **The one place the OWNER's action is spent is the 2014 Pact of the Chain**: "when you take the
  Attack action, you can forgo one of your own attacks to allow your familiar to make one attack
  of its own with its reaction." A familiar otherwise "can't attack, but it can take other actions
  as normal."
- **What an uncommanded creature does is stated per row too**: "they defend themselves from hostile
  creatures, but otherwise take no actions" (2014 conjure), "it takes the Dodge action and uses its
  movement to avoid danger" (2024 summons), "the creature only defends itself" (2014 Animate Dead).

The app has a round counter and no initiative order, so none of this can be enforced and none of it
should be: it is a line the creature's card SAYS — "rolls its own initiative", "acts right after
you", "a Bonus Action to command" — and, for the first kind, an initiative roll of its own.

---

## 3. Whether the owner's effects fold onto it

**No shipped sentence puts the owner's bonuses on the creature.** What the rows state instead is
four narrower things, each a rule of its own:

- **The creature's senses reach the owner, by an action**: "you can see through your familiar's
  eyes and hear what it hears until the start of your next turn, gaining the benefits of any
  special senses that the familiar has. During this time, you are deaf and blind with regard to
  your own senses" — an action in 2014, a Bonus Action in 2024.
- **The owner's spell leaves through the creature, and stays the owner's roll**: "your familiar
  can deliver the spell as if it had cast the spell … If the spell requires an attack roll, you
  use your attack modifier for the roll" (2014). The 2024 text keeps the delivery and drops the
  sentence about the modifier.
- **One spell the owner casts on themself may land on the steed as well**: "While mounted on your
  steed, you can make any spell you cast that targets only you also target your steed" (2014
  only).
- **The spell's level sets numbers in a 2024 stat block**: "Use the spell slot's level for the
  spell's level in the stat block" — whose own lines did not ship (above).

So the creature derives from its own stat block and its own overlay, with no fold from the owner's
effects. The owner-to-creature links are two: a spell the owner chooses to share, which is an
effect put on the creature by hand, and a cast level, which is a value the bond itself carries.

---

## 4. What other tools do — two shapes

- **A list on the owner's sheet.** D&D Beyond keeps an "Extras" section on the character with
  categories for a familiar, a pet, a mount and a summoned creature, each a stat block picked from
  its monsters. From forum reports only — the threads sit behind a sign-in and were not read at
  their source: little on the stat block is editable beyond hit points and Armor Class, a Find
  Steed user could not raise the warhorse's Intelligence as the spell says, and stat blocks whose
  numbers depend on the owner are not supported.
- **A creature of its own, made from the owner's.** Foundry's dnd5e system summons through a
  Summon activity (<https://github.com/foundryvtt/dnd5e/wiki/Activity-Type-Summon>, read
  2026-10-12): the spell lists profiles, each a linked stat block or "a maximum CR and one or more
  creature types" to pick from, and the copy that appears can "Match Proficiency", "Match Attacks"
  and "Match Saves" to the summoner and take a bonus to Armor Class, hit dice, hit points and
  damage from formulas over the summoning item. A player needs "Create New Tokens" to do it.

The first is where a player looks for the thing; the second is what the 2024 stat blocks need —
numbers taken from the cast. Neither is a second character with a build.

---

## What the four answers look like, and what each one costs

These are recommendations for the maintainers to accept or change; nothing here is built.

1. **Where it lives on screen — a panel on the owner's play surface, one card per creature.** It
   has no build, so it is not a roster entry; its hit points, its attacks and the line about its
   turn are read in the middle of the owner's turn, so it belongs where the owner's are. The card
   is the monster view the compendium already has, with the overlay's fields editable. Which
   region of the Combat screen takes the panel is COMBAT-RAIL's question (`../work/ui.md`).
2. **Whose turn — said, not enforced, from two facts the granting row states**: where it acts
   (own initiative · after you · mount) and what a command costs. A creature with its own
   initiative gets its own roll.
3. **The owner's effects do not fold onto it.** It derives from its stat block plus its overlay
   plus effects put on IT, through the same pipeline, so each of its numbers has a trace. A cast
   level is a value on the bond.
4. **Where it sits in the file — in `play`, as a list**, beside `play.form`, which is the same
   pairing of a monster ref with state of its own: `{ id, monster, name, overlay, hp, effects,
   source, castLevel? }`, with a GUID for the id. A familiar that persists and a conjured wolf
   that ends with the spell are the same entry with a different `source`; what ends one is the
   source's own rule, as `ends_when` is for a form.

**What it waits on before any of it is code:**

- The four answers above.
- **A way for a row to say "this grants a creature"** — which stat blocks (a list of ids, or
  Wild Shape's `creature` / `max_cr` test), how many, where it acts, what a command costs. That
  is a new token kind or a few new columns, and so `../internals/effects.md` and
  `../internals/compatibility.md` before it is a schema.
- **The three 2024 stat blocks as rows**, transcribed from the SRD in the content repo, with the
  lines that depend on the spell's level. Until then a 2024 steed, a Giant Insect and a Draconic
  Spirit have six ability scores and nothing else.
- The 2014 Pact of the Chain waits on the boon being a choice (N2's choice kind), like the Tome.

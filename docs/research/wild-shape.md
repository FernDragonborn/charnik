# Wild Shape — per-edition spec sheet (gate for N2b)

Source of every statement below: the SHIPPED SRD content repo `D:\data\code\charnik-content-srd`,
`srd-2014/class_features_srd.csv` and `srd-2024/class_features_srd.csv`, column `text_en`, plus
`monsters_srd.csv` for what a beast row actually carries. Nothing here comes from the PHB or from
memory. Quotes are verbatim, including the OCR artifacts the 2014 rows carry (`andCharisma`,
`creature'sbonus`, `Transformingdoesn't`) — they are in the shipped cell and a matcher must expect them.

Rows read: 2014 `druid_wild_shape`, `druid_beast_spells`, `druid_archdruid`, `druid_timeless_body`;
2024 `druid_wild_shape`, `druid_wild_companion`, `druid_wild_resurgence`, `druid_elemental_fury`,
`druid_improved_elemental_fury`, `druid_beast_spells`, `druid_archdruid`,
`circle_of_the_land_lands_aid`, `circle_of_the_land_natures_sanctuary`.
`grep -ric "wild shape"` over the whole content repo hits **only** `class_features_srd.csv` in each
edition (4 matches in 2014, 13 in 2024) — no other shipped file mentions the feature at all.
In 2014 **no Circle of the Land row references Wild Shape**; in 2024 two do.

---

## 1. Uses per rest and recharge

**2014** — flat two, both rest types refill everything.
> "you can use your action to magically assume the shape of a beast that you have seen before. You can use this feature twice. You regain expended uses when you finish a short or long rest."

At 20: unlimited.
> `druid_archdruid`: "At 20th level, you can use your Wild Shape an unlimited number of times."

No other 2014 druid or subclass feature spends a use. **NOT IN SRD (2014):** any per-level increase to
the number of uses — the shipped 2014 text never grows it above two before level 20.

**2024** — two, asymmetric recharge, and a per-level growth the shipped text does NOT contain.
> "_Number of Uses._ You can use Wild Shape twice. You regain one expended use when you finish a Short Rest, and you regain all expended uses when you finish a Long Rest."
> "You gain additional uses when you reach certain Druid levels, as shown in the Wild Shape column of the Druid Features table."

**NOT IN SRD (2024) — and it is a hole in the shipped data, not in the licence:** the Druid Features
table is not shipped anywhere. `srd-2024/classes_srd.csv` has no per-level table column, and the grep
above proves no other file mentions Wild Shape. So **the actual number of uses at levels 3–20 is
unknown to the app.** Two is the only number the content supports; anything above it would be authored
from memory, which is the failure mode AGENTS.md names first.

Other 2024 ways to gain / spend a use (all shipped, all quotable):
- `druid_wild_resurgence` (L5): "Once on each of your turns, if you have no uses of Wild Shape left, you can give yourself one use by expending a spell slot (no action required). In addition, you can expend one use of Wild Shape (no action required) to give yourself a level 1 spell slot, but you can't do so again until you finish a Long Rest."
- `druid_archdruid` — Evergreen Wild Shape: "Whenever you roll Initiative and have no uses of Wild Shape left, you regain one expended use of it."
- `druid_archdruid` — Nature Magician: "Choose a number of your unexpended uses of Wild Shape and convert them into a single spell slot, with each use contributing 2 spell levels… Once you use this benefit, you can't do so again until you finish a Long Rest."
- `druid_wild_companion` (L2): "As a Magic action, you can expend a spell slot or a use of Wild Shape to cast the _Find Familiar_ spell without Material components."
- `circle_of_the_land_lands_aid` (L3) and `circle_of_the_land_natures_sanctuary` (L14) each "expend a use of your Wild Shape" for a non-transform effect.

So in 2024 the pool is a currency with five non-transform sinks; in 2014 it is a transform counter only.

---

## 2. HP model and dropping to 0

**2014 — the beast's own HP pool replaces yours, with carryover on the way out.**
> "When you transform, you assume the beast's hit points and Hit Dice. When you revert to your normal form, you return to the number of hit points you had before you transformed. However,if you revert as a result of dropping to 0 hit points,any excess damage carries over to your normal form. For example, if you take 10 damage in animal form and have only 1 hit point left, you revert and take 9 damage. As long as the excess damage doesn't reduce your normal form to 0 hit points, you aren't knocked unconscious."

So: a second, separate HP pool (max = the beast row's `hp`), the druid's own current HP frozen and
restored on revert, and overflow damage applied to the druid pool after reverting.
**NOT IN SRD (2014):** whether healing received in beast form persists after reverting (it cannot —
"you return to the number of hit points you had before you transformed" is unconditional), and what
happens to temporary HP the druid held before transforming.

**2024 — no separate pool at all. Temporary HP on top of your own HP.**
> "**Temporary Hit Points.** When you assume a Wild Shape form, you gain a number of Temporary Hit Points equal to your Druid level."
> "Your game statistics are replaced by the Beast's stat block, but you retain your creature type; Hit Points; Hit Point Dice; Intelligence, Wisdom, and Charisma scores; class features; languages; and feats."

**NOT IN SRD (2024):** there is no drop-to-0 clause and no carryover rule — because there is nothing to
carry over; the druid keeps one HP pool the whole time. Dropping to 0 does not appear among the revert
triggers either (see §5): the shipped text does not say a 0-HP druid leaves the form. Do not invent one.

---

## 3. CR / movement limits per level

**2014 — `_Beast Shapes_` table, reproduced exactly as shipped (an HTML `<table>` inside `text_en`):**

| Level | Max. CR | Limitations | Example |
| --- | --- | --- | --- |
| 2nd | 1/4 | No flying or swimming speed | Wolf |
| 4th | 1/2 | No flying speed | Crocodile |
| 8th | 1 | - | Giant eagle |

Framed by:
> "Your druid level determines the beasts you can transform into, as shown in the Beast Shapes table. At 2nd level, for example, you can transform into any beast that has a challenge rating of 1/4 or lower that doesn't have a flying or swimming speed."

**2024 — `**Beast Shapes**` table, reproduced exactly as shipped:**

| Druid Level | Known Forms | Max CR | Fly Speed |
| --- | --- | --- | --- |
| 2 | 4 | 1/4 | No |
| 4 | 6 | 1/2 | No |
| 8 | 8 | 1 | Yes |

Framed by:
> "You know four Beast forms for this feature, chosen from among Beast stat blocks that have a maximum Challenge Rating of 1/4 and that lack a Fly Speed… When you reach certain Druid levels, your number of known forms and the maximum Challenge Rating for those forms increases, as shown in the Beast Shapes table. In addition, starting at level 8, you can adopt a form that has a Fly Speed."

Divergence: 2014 gates **swim** at level 2 and drops that gate at 4; 2024 has **no swim gate at all**,
only Fly. 2014 has no known-forms concept; 2024's table adds the Known Forms column.

**NOT IN SRD (both):** what "has a flying/swimming speed" means for a row whose speed string reads
`10 ft., fly 40 ft.`, and whether a burrow or climb speed matters — the app must define the parse.
Also **NOT IN SRD:** whether `swarm of tiny beasts` and `beast (dinosaur)` (both real `creature_type`
values in `srd-2024/monsters_srd.csv`) count as "Beast stat blocks".

---

## 4. Replaced vs retained

**2014:**
> "Your game statistics are replaced by the statistics of the beast, but you retain your alignment,personality, and Intelligence, Wisdom, andCharisma scores. You also retain all of your skill and saving throw proficiencies, in addition to gaining those of the creature. If the creature has the same proficiency as you and the bonus in its stat block is higher than yours, use the creature'sbonus instead of yours. If the creature has any legendary or lair actions, you can't use them."
> "You retain the benefit of any features from your class, race, or other source and can use them if the new form is physically capable of doing so.However, you can't use any of your special senses,such as darkvision, unless your new form also has that sense."

| | 2014 |
| --- | --- |
| STR / DEX / CON | replaced by beast |
| INT / WIS / CHA | retained |
| HP / Hit Dice | **replaced** ("you assume the beast's hit points and Hit Dice") |
| AC, speed, attacks, senses | replaced (part of "game statistics"); special senses only if the form has them |
| Skill + save proficiencies | retained, union with the creature's; **higher stat-block bonus wins** |
| Alignment, personality | retained |
| Class/race/other features | retained, "if the new form is physically capable of doing so" |
| Legendary / lair actions | explicitly unusable |
| Speech / hands | "limited to the capabilities of your beast form" (§7 quote) |

**2024:**
> "Your game statistics are replaced by the Beast's stat block, but you retain your creature type; Hit Points; Hit Point Dice; Intelligence, Wisdom, and Charisma scores; class features; languages; and feats. You also retain your skill and saving throw proficiencies and use your Proficiency Bonus for them, in addition to gaining the proficiencies of the creature. If a skill or saving throw modifier in the Beast's stat block is higher than yours, use the one in the stat block."
> "While in a form, you retain your personality, memories, and ability to speak"

| | 2024 |
| --- | --- |
| STR / DEX / CON | replaced by beast |
| INT / WIS / CHA | retained |
| HP / Hit Dice | **retained** (the single biggest divergence) |
| Creature type | **retained** (2014 says nothing) |
| AC, speed, attacks, senses | replaced |
| Skill + save proficiencies | retained, **your own Proficiency Bonus applies**, union with creature's; higher stat-block modifier wins |
| Languages, feats, class features | retained, unconditionally |
| Speech | **retained unconditionally**; object handling limited to the form's limbs |
| Legendary / lair actions | **NOT IN SRD (2024)** — no clause forbids them |

The proficiency rule differs mechanically: 2014 compares *the creature's bonus* against yours; 2024
says you apply *your* PB to your own proficiencies and then take the higher of the two final modifiers.

---

## 5. Duration and reverting

**2014:**
> "You can stay in a beast shape for a number of hours equal to half your druid level (rounded down). You then revert to your normal form unless you expend another use of this feature. You can revert to your normal form earlier by using a bonus action on your turn. You automatically revert if you fall unconscious, drop to 0 hit points, or die."

Transform costs an **action** ("you can use your action to magically assume the shape"); revert is a
**bonus action**; expiry can be deferred by spending another use.

**2024:**
> "As a Bonus Action, you shape-shift into a Beast form that you have learned for this feature… You stay in that form for a number of hours equal to half your Druid level or until you use Wild Shape again, have the Incapacitated condition, or die. You can also leave the form early as a Bonus Action."

Transform costs a **Bonus Action** (2014: Action); revert is a Bonus Action in both.

Divergences: 2024 drops "fall unconscious" and "drop to 0 hit points" and replaces them with the
**Incapacitated** condition (which does ship — `srd-2024/conditions_srd.csv`, id `incapacitated`), and
adds "or until you use Wild Shape again", making a re-shape a swap rather than a stack.
**NOT IN SRD (2024):** the words "rounded down" on the duration, and any way to extend the duration by
spending another use — 2014 states both.

---

## 6. Equipment

Both editions carry effectively the same clause; 2024 titles it `**Objects.**` and prepends a limb rule.

**2014:**
> "You choose whether your equipment falls to the ground in your space, merges into your new form,or is worn by it. Worn equipment functions as normal, but the GM decides whether it is practical for the new form to wear a piece of equipment,based on the creature's shape and size. Yourequipment doesn't change size or shape to match the new form, and any equipment that the new form can't wear must either fall to the ground or merge with it. Equipment that merges with the form has no effect until you leave the form."

**2024:**
> "**Objects.** Your ability to handle objects is determined by the form's limbs rather than your own. In addition, you choose whether your equipment falls in your space, merges into your new form, or is worn by it. Worn equipment functions as normal, but the GM decides whether it's practical for the new form to wear a piece of equipment based on the creature's size and shape. Your equipment doesn't change size or shape to match the new form, and any equipment that the new form can't wear must either fall to the ground or merge with the form. Equipment that merges with the form has no effect while you're in that form."

Three states in both: **fall / merge / worn**. "Worn equipment functions as normal" is the only case
where the druid's own item effects keep applying.

**NOT IN SRD (both):** how worn equipment reconciles with the AC that the stat block just replaced,
and whether the fall/merge/worn choice is per item or one decision for everything (the text says "your
equipment" and then discusses "a piece of equipment" — ambiguous in both editions; the RAI reading is
per item).

---

## 7. Spellcasting while transformed

**2014 base:**
> "You can't cast spells, and your ability to speak or take any action that requires hands is limited to the capabilities of your beast form. Transformingdoesn't break your concentration on a spell you'vealready cast, however, or prevent you from taking actions that are part of a spell, such as call lightning , that you've already cast."

**2024 base:**
> "**No Spellcasting.** You can't cast spells, but shapeshifting doesn't break your Concentration or otherwise interfere with a spell you've already cast."

Both: no casting, concentration survives, already-cast spells stay drivable.

**2014 `druid_beast_spells` (L18):**
> "you can cast many of your druid spells in any shape you assume using Wild Shape. You can perform the somatic and verbal components of a druid spell while in a beast shape, but you aren't able to provide material components."

Druid spells only; **every** material component blocked.

**2024 `druid_beast_spells` (L18):**
> "While using Wild Shape, you can cast spells in Beast form, except for any spell that has a Material component with a cost specified or that consumes its Material component."

Any spell, not only druid spells; only *costed or consumed* materials blocked.

**2014 `druid_archdruid` (L20):**
> "you can ignore the verbal and somatic components of your druid spells, as well as any material components that lack a cost and aren't consumed by a spell. You gain this benefit in both your normal shape and your beast shape from Wild Shape."

**2024 `druid_archdruid` (L20)** has no component clause at all — it is Evergreen Wild Shape +
Nature Magician + Longevity (quoted in §1). The 2014 component-ignoring benefit has **no 2024 counterpart**.

**2024 `druid_elemental_fury` (L7)** is the only feature in either edition that touches the beast form's
*attacks*:
> "_Primal Strike._ Once on each of your turns when you hit a creature with an attack roll using a weapon or a Beast form's attack in Wild Shape, you can cause the target to take an extra 1d8 Cold, Fire, Lightning, or Thunder damage (choose when you hit)."

Raised by `druid_improved_elemental_fury` (L15): "The extra damage of your Primal Strike increases to 2d8."

---

## 8. What each edition has that the other lacks

**2024 only:** Known Forms — a bounded chosen list of 4/6/8, one swap per Long Rest ("Whenever you
finish a Long Rest, you can replace one of your known forms with another eligible form") — named
recommendations ("The **Rat**, **Riding Horse**, **Spider**, and **Wolf** are recommended"), Temporary
HP, retained creature type / HP / Hit Dice / languages / feats, unconditionally retained speech,
Bonus-Action transform, Incapacitated as the involuntary exit, the whole use-as-currency economy
(Wild Companion, Wild Resurgence, Land's Aid, Nature's Sanctuary, Nature Magician), Evergreen Wild
Shape, Primal Strike on a form's attack, per-level extra uses (unquantified), and an explicit "you may
look in other sources for eligible Beasts if the Game Master permits you to do so".

**2014 only:** the beast HP pool and the carryover-on-0 rule, the swim-speed gate at level 2, revert on
unconscious / 0 HP, extending the duration by spending another use, "rounded down" on the duration, the
ban on legendary and lair actions, the "a beast that you have seen before" prerequisite (2024 replaces
it with Known Forms), retained alignment, the special-senses restriction ("you can't use any of your
special senses,such as darkvision, unless your new form also has that sense"), unlimited uses at 20,
Archdruid's component-ignoring benefit, and the "features from your class, race, or other source… if
the new form is physically capable" caveat (2024 retains class features unconditionally).

---

## HOW THE APP MODELS IT

Every rule above that the app applies is stated by the feature row's own tokens, so the two editions
differ in their CSV and not in code (`../internals/effects.md` ▸ A form):

| Spec point | Where it is said |
| --- | --- |
| §1 uses and recharge | `grant_resource:wild_shape:…` — 2014 `step(class_level.druid, 2->2, 20->inf):short`; 2024 the Druid Features ladder `2->2, 6->3, 17->4` with `short_one` |
| §1 Evergreen Wild Shape | `regain_on_initiative:wild_shape:1` on the 2024 Archdruid |
| §2 hit points | `form:wild_shape:own_hp` (2014) · `form:wild_shape:temp_hp:class_level.druid` (2024) |
| §3 CR and movement | `form:wild_shape:max_cr:step(…, 2->1/4, 4->1/2, 8->1)` and guarded `without:fly` / `without:swim` |
| §3 "Beast stat blocks" | `form:wild_shape:creature:beast` — `beast (dinosaur)` is one, `swarm of tiny beasts` is not (RAI: the SRD does not say) |
| §4 replaced and retained | the stat block's STR/DEX/CON, AC and speeds are SET; its saves, skills and senses are FLOORS (`character/forms.ts`) |
| §4 special senses (2014) | `form:wild_shape:only_senses` — a sense the stat block does not list reads 0 while shaped, with the form as the last line of its trace |
| §4 attacks | the monster row's `attacks` column, read whole (`combat/form-attacks.ts`) |
| §5 duration and transform cost | `form:wild_shape:hours:floor(class_level.druid/2)`; the resource option's `action_type` — `action` in 2014, `bonus_action` in 2024 |
| §5 what ends it unasked | `form:wild_shape:ends_when:unconscious` (2014) · `…:ends_when:incapacitated` (2024); death answers for both, and 0 hit points ends only the 2014 form, whose hit points are its own |
| §7 casting | blocked while shaped, lifted by `form:wild_shape:casts` on Beast Spells |
| §8 Known Forms | `form:wild_shape:known:step(…, 2->4, 4->6, 8->8)`, chosen in the builder into `build.forms` |

The 2024 duration's rounding is not stated; `floor` is the edition's general rule and is RAI here.
What the app does not model is listed, in order, under N2b in `../work/mechanics.md`.

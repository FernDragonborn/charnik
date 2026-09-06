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

## WHAT THE APP MODEL NEEDS

Given N2b's `play.form = {monsterRef, formHp} | null` plus a `deriveSheet` branch.

| Spec point | Data / model need | Status in shipped content |
| --- | --- | --- |
| §1 uses | A resource pool `wild_shape`, 2 uses, short+long recharge (2014) vs 1-on-short/all-on-long (2024) | **MISSING.** No `wild_shape` id in either `resources_srd.csv` (2014: rage, bardic_inspiration, second_wind, action_surge, ki; 2024: those minus ki plus focus, persistent_rage, uncanny_metabolism). `druid_wild_shape.resource` and `.effects` are **both empty** in both editions. A `grant_resource:wild_shape:2:short`-shaped token must be authored **through the converter from this SRD text**, never by hand. |
| §1 2024 recharge | The `grant_resource` grammar is `id:count:recharge` — it cannot express "1 back on a short rest, all on a long rest" | **Grammar gap.** Needs a partial-regain segment or a per-resource `short_regain` column. |
| §1 2024 per-level uses | A level→uses progression | **NOT IN SRD / NOT IN CONTENT.** The Druid Features table is not shipped in any file. Ship 2 at every level and surface "the SRD does not state the higher-level counts" — do not fill it from memory. |
| §1 alternate spends (2024) | Wild Shape as a currency for 5 non-transform sinks, plus slot↔use conversion in both directions | No druid rows in `resource_options_srd.csv` (it carries monk `focus` options only). Needs those rows **and** a slot↔resource conversion the effect vocabulary does not have. |
| §2 HP (2014) | `play.form.formHp = {current, max}` with `max` = the row's `hp`; druid's own current HP frozen; overflow applied after the revert | `monsters.hp` is `optInt` — **supported**. `hp_formula` ("2d8 + 2") is a string, rollable but parsed nowhere today. |
| §2 HP (2024) | **`formHp` is the wrong field here.** 2024 needs `tempHp += druidLevel` on the existing pool and nothing more | Supported — temp HP already exists in play state. This is the load-bearing branch: `formHp` must be optional and edition-driven, not intrinsic to `play.form`. |
| §3 CR gate | Compare `cr` against 1/4, 1/2, 1 by level | `monsters.cr` is `optStr` with fractions. A fraction-aware comparator does not exist in `src/lib` today. |
| §3 movement gate | Detect fly (both editions) and swim (2014 only) | `speed` is a **free string**, and case differs across editions (2014 `"swim 40 ft."`, 2024 `"Swim 30 ft."`). No structured movement column. A case-insensitive substring match on a declared column is the only option — narrow and defensible, but it is not a typed field. |
| §3 "Beast stat blocks" | Filter on `creature_type` | Free-form: real 2024 values include `beast`, `beast (dinosaur)`, `swarm of tiny beasts`. Prefix match needed; the swarm question is **NOT IN SRD**. |
| §3 the 2014 roster | Any legal form at all | **BLOCKER for 2014.** `srd-2014/monsters_srd.csv` ships **4 beasts total**: `plesiosaurus` (CR 2), `triceratops` (CR 5), `tyrannosaurus_rex` (CR 8), `stirge` (CR 1/8, `fly 40 ft.`). Only the stirge is CR ≤ 1, and it flies — so a 2014 druid has **zero legal forms at levels 2–7 and exactly one from level 8**. The table's own examples (Wolf, Crocodile, Giant eagle) are **not in the 2014 file**. 2024 is healthy: 69 beasts at CR ≤ 1 (24 at CR 0, 9 at 1/8, 18 at 1/4, 9 at 1/2, 9 at 1), including all four recommended forms (`rat`, `riding_horse`, `spider`, `wolf`). `giant_eagle` exists in 2024 but is `celestial`, not a beast. |
| §4 replaced scores | STR/DEX/CON, AC, speed from the row | `str`…`cha` and `ac` are `optInt` — **supported**. |
| §4 attacks | The form's attacks with to-hit and damage | **BLOCKER, both editions.** `monsters_srd.csv` has **no attack column of any kind**. Every attack lives only in `text_en` prose (`"**_Bite._** _Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Piercing damage."`). Mining that from `src/` is exactly what `prose-is-not-data.test.ts` forbids. Two honest options: (a) a new structured `attacks` column produced by the converter, or (b) render the stat block prose read-only and let the player add a manual attack row. |
| §4 skills / saves | Union of the druid's proficiencies with the creature's, higher wins | `skills` is a free string (`"Perception +5, Stealth +4"`) that must be parsed into `skill → bonus` to compare. 2024 has typed `str_save`…`cha_save` (`optInt`); **2014 has no save columns at all**, so the 2014 "higher creature bonus" comparison has data for skills and none for saves. |
| §4 senses (2014) | Suppress the druid's own darkvision unless the form has it | `senses` is a free string, and the druid's own senses are not modelled as a suppressible set. |
| §4 legendary / lair ban (2014) | Nothing to enforce — no column, and no CR ≤ 1 beast carries them | No code needed; a note in the form panel covers it. |
| §5 duration | `floor(level/2)` hours (2014 explicit, 2024 unstated rounding) | Derivable from build level. Wants a `play.form` expiry; the existing timer machinery is `durationRounds` on effects — hours are a different scale, so this is a new clock or an explicit "no timer, revert manually". |
| §5 revert triggers | 2014: voluntary, expiry, unconscious, 0 HP, death. 2024: voluntary, expiry, re-shape, Incapacitated, death | `incapacitated` ships as a 2024 condition row, `unconscious` in both, and 0 HP is already play state — so a watcher has everything it needs. Per AGENTS ("surfaces and suggests; never auto-applies") these should prompt, not force. |
| §6 equipment | Per-item three-way state: fall / merge / worn | **Not modelled** — inventory rows have no form-state field. Since the SRD's granularity is ambiguous anyway, one form-wide choice plus a note is the honest minimum. |
| §7 casting | Block casting while `play.form` is set; unblock at L18 with the edition's own exception; concentration explicitly survives | Detection is by feature id (`druid_beast_spells`, `druid_archdruid`); both rows ship with **no effect token**, so this is a feature-id branch unless tokens are authored. Spell rows do carry a `material` column, so the 2024 "cost specified" test has something to read — but deciding whether a cost is specified still means parsing that string. |
| §7 Primal Strike | +1d8 / +2d8 on "a Beast form's attack" | Entirely gated on the attacks blocker above. |
| §8 Known Forms (2024) | `build.wildShapeForms: monsterRef[]`, capped 4/6/8 by level, one swap per Long Rest | **New build-state field.** It belongs in `build`, not `play` — it is a choice, not runtime state — but the long-rest swap is then a build edit triggered from play, which the build/play split (`docs/internals/characters.md`: "A long rest only ever edits `play`") deliberately makes hard. Decide that seam before coding. |

**Model verdict for N2b:** `play.form = {monsterRef, formHp} | null` fits **2014** and is wrong for
**2024**, which has no second HP pool at all — 2024 needs `{monsterRef}` plus a temp-HP grant on the
existing pool, and a `build.wildShapeForms` list beside it. Make `formHp` optional and edition-driven
rather than intrinsic to the form object.

**The two hard blockers are content, not code:** no `wild_shape` resource row exists in either edition
(there is no pool to spend), and `monsters_srd.csv` has **no attacks column** in either edition (a form
cannot fight). On top of that, 2014 has effectively **no legal beast to become** — which makes 2024 the
only edition where a finished Wild Shape can be demonstrated against shipped content.

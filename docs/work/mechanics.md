# Rules and play mechanics — open work

> Tracker. The rules core, the effect vocabulary, features, resources and play state. The specs are
> [`../internals/rules-core.md`](../internals/rules-core.md), [`../internals/effects.md`](../internals/effects.md)
> and [`../internals/characters.md`](../internals/characters.md); the ORDER is [`plan.md`](../plan.md) ▸
> Implementation order.

## The three kinds a class feature reduces to: passive, action, choice

Roadmap work, not defects. **An item id is stable — never renumber one**: ids are how items in the
other `work/` files, and comments in the code, refer to these.

Core insight: PHB class features reduce to THREE kinds, and the engine for two of them
already exists — a **passive** (modifier tokens on the row, folded like any other), an **action**
(activatable) = COMPOSITION of existing systems (`economy.trySpend` + `resourcesSpent` + `addEffect`
with duration + `rollPool` — no new engine, new `class_features` columns: activation slot,
resource cost, applied tokens, duration, roll), and a **choice** (`option` rows + the feature's `choose` column; generalizes the builder's slotFeats
pattern; a chosen row then behaves as a passive or an action).
Level scaling stays formula-free: per-level `class_features` rows re-grant (monk die d6→d12,
superiority d8→d12) — the table is already keyed by level; L2 expressions not needed for ~90%
of PHB. **Acceptance: FULL PHB integration — every feature of every PHB
class must be EXPRESSIBLE via one of the three kinds (or explicitly marked manual-text
fallback) — PLUS the tier-1 homebrew set:** this sizes the vocabulary, it does not authorize
authoring PHB rows; what SHIPS stays SRD. The homebrew set is Blood Hunter (Mercer;
D&D-Beyond-hosted, the most-played homebrew), Gunslinger (Mercer), Pugilist (Ben Hoffman),
KibblesTasty Psion/Warlord/Inventor/Spellblade, laserllama alternate classes (Exploit Dice),
Scholar (A. M. Black). That set adds a mechanics superset the engine must cover:
**HP-as-cost** (Crimson Rite, Blood Curse amplify), **variable point cost per use** (Psion
psi powers — spending is not always 1 pip), **event-based recharge** (Gunslinger grit on
crit/kill — v1: manual restore button + note, automate later), **attack dice riders**
(hemocraft/exploit/sneak dice — existing bonusDice path, per-level scaling via data rows),
**weapon properties misfire/reload** (item columns; v1 display-only, no enforcement).
Choice groups already cover maneuvers = curses = exploits = invocations = metamagic (one
shape). PHB examples remain the smoke set: Rage, Second Wind + Action Surge, ki + martial
die + Flurry, Sneak Attack, Wild Shape, Divine Smite; Metamagic point↔slot conversion may
stay semi-manual.

- [ ] **N2 · Class-feature engine ("features as data").** The three kinds above, in the order
  passive → choice → action. Wild Shape is not one of the shapes: it is a stat-block REPLACEMENT, and it is built (`../internals/effects.md` ▸ A form).
  Superiority dice: extend the grammar —
  `grant_resource:superiority-dice:4:d8:short` (die BEFORE recharge —
  "what the resource is, then when it refills"; ResourceDef + `die`). The die segment is
  optional and shape-distinguishable (`d\d+` vs `short|long|other`), so existing 3-segment
  tokens (`grant_resource:rage:2:long`) keep parsing unchanged. Spending rolls the die into
  attacks via the existing `bonusDice` path. Extra Attack is built (`../internals/effects.md` ▸
  Targets). The fold ALREADY gathers feature tokens (`derive-gather` ▸ `considerFeature` pushes each qualifying row at the `feature` layer), so a passive token on a
  class-feature row works the day it is written — FEATURE-PASSIVES is written against that. **The
  choice kind is built**: a feature's options are rows of the `option` type and its `choose`
  column says how many (`../internals/content.md` ▸ One row, several options), with the builder's
  Feature options pane asking. Every choice of a ROW the SRD prints ships on it; what a choice of
  a WORD still waits on is FEATURE-PASSIVES ▸ "A choice of a word". What is still owed here is
  the content-schema column bump for the action kind.
  **Every pool the class features state ships**, typed from its own sentence or table column, in
  both editions: Lay on Hands, Channel Divinity (one pool both classes fill, so a multiclass takes
  the larger ladder, which is SRD 5.1's own cleric 6 / paladin 4 example), Sorcery Points,
  Indomitable, Arcane Recovery and Natural Recovery (two in 2024: the free cast and the slots),
  beside `rage`, `bardic_inspiration`, `second_wind`, `action_surge`, `ki`, `focus`,
  `persistent_rage`, `uncanny_metabolism`, `wild_shape` and `wild_resurgence`. Mystic Arcanum waits
  on its design (Spellcasting ▸ Resource subsystem below).
  **The spend side ships where a verb exists**: Lay on Hands on yourself (`heal:x`), on another
  creature and as a cure; every Channel Divinity effect in the packs, each offered only to whoever
  has the feature that grants it (`granted_by`), Divine Spark as a roll; Stunning Strike; and Sorcery
  Points into a slot at the table's cost, held to 2024's minimum sorcerer level. What is left wants
  a verb: Font of Magic's slot INTO points gives as many points as the slot's level, which no
  `restore_resource` count can say; Arcane and Natural Recovery restore slots (designed under
  Spellcasting ▸ Resource subsystem below), and Indomitable rerolls a save — each is a pip the
  player spends by hand until then.
- [ ] **OPTION-HELD-ONCE · the maintainer checks that a shared option is held once per character.**
  An option offered by several features (`option_of` naming more than one parent) can be taken
  through only one of them: a 2014 Fighting Style taken by the Fighter is refused (Strict) or noted
  (Free) under the Champion's second pick (`OptionPicks.takenElsewhere`, `OPTION_BLOCK.taken`).
  The rule is written to SRD 5.1's "You can't take a Fighting Style option more than once, even if
  you later get to choose again", and applies to EVERY shared option, not only styles. To check: is
  "once per character" right for every option that may be shared later, or should a row say so?

- [ ] **RESOURCE-PIN · pin ANY trackable thing to the play surface, not only spells.** Asked for in
  feedback. Today `ui.spellsPinned` pins spells to the top of the combat spell list and nothing else
  can be pinned — so a Barbarian hunting Rage, or a player who wants the two potions they are actually
  carrying within reach, scrolls a panel for them mid-turn.
  **The shape already exists and is the cheap half**: a pin is a per-character array of refs on `ui`,
  and `spellsPinned` is exactly that, keyed by the same `type:source:id` identity everything else uses.
  So a resource and an inventory row pin by their own refs through the same mechanism.
  **The design half is WHERE a pin lands**, and that is the question to answer first: the spell pin
  sorts within its own panel, but a pin that spans spells, resources and inventory has no single panel
  to sort inside. Either it is a surface of its own — which is COMBAT-RAIL's question, so these two
  want answering together — or each panel keeps sorting its own and "pinned" stops meaning one place.
  **One rule it must not break:** a pin is a VIEW preference. It never changes what a character has,
  and un-pinning is always one click from where the pin shows (`AGENTS.md` ▸ Reverse states).

- [ ] **EXCEPT-DAMAGE · "resistance to all damage except X" has no form.** `damage_sensitivity`
  names ONE type or `all`; the exclusion in between is unsayable, so 2024 Superior Defense (all
  damage except Force) degrades to a note. The cheap shape is a subtractive relation
  (`damage_sensitivity:resist:all` + `damage_sensitivity:none:force`) rather than a set expression
  in the type slot, which would put a grammar inside a slot that is deliberately free-form. Not worth
  building until a second case appears — record it here so the third one does not re-open the design.
- [ ] **FEATURE-PASSIVES · the passive features, named.** N2 says the passive kind is a token; this
  is WHICH rows, found by matching each shipped feature's own SRD text against the phrases that
  declare a mechanic ("you have advantage on", "your speed increases", "your AC equals", "immune to",
  "score a critical hit on"). Every row writable against the targets that exist carries its token;
  what is left is grouped by what it waits on:

  - **Blocked on SCOPED-BONUS reaching spells.** "Add your <ability> modifier to the damage of X":
    2024 Potent Spellcasting on `blessed_strikes` and `elemental_fury` (any cantrip of that class), `empowered_evocation`
    (evocation spells), `oath_of_devotion_sacred_weapon` and 2014 `oathofdevotion_channel_divinity`
    (one weapon, attack roll), 2014 `foe_slayer` (attack OR damage, player's pick).
  - **Situational by nature — these stay `note`, and that is the answer, not a gap.** Advantage that
    depends on what you are fighting or what you did last turn: `favored_enemy`, `countercharm`,
    `lands_stride`, `hunter_defensive_tactics`, `holy_nimbus`, `thief_supreme_sneak`, 2024
    `studied_attacks`, `precise_hunter`, `innate_sorcery`. The app has no enemy and no turn history
    to test the condition against; surfacing the text is the honest behaviour.
  - **A choice of a word, which a class feature cannot ask yet.** `fiendish_resilience` and 2024
    `draconic_sorcery_elemental_affinity` — resistance to a damage type the player picks and can
    change — and the proficiencies that are a choice of skill: College of Lore's three and the 2024
    elf's one-of-three Keen Senses. An item asks for a word (`choice_options`, filled into the
    token as `item_choice`); a feature has no such column, and a row per damage type would be rows
    that say nothing (`../internals/content.md` ▸ One row, several options).
  - **An extra cantrip.** 2024 Thaumaturge and Magician ("You know one extra cantrip from the
    Cleric/Druid spell list") ship their skill bonus; the cantrip is text, since no token raises a
    class's cantrip count.
  - **Not the passive kind at all.** 2024 `superior_defense` spends 3 Focus Points for a minute of
    resistance — an activated ability with a duration (the action kind, and EXCEPT-DAMAGE for what it
    resists). 2014 `ki_empowered_strikes` stays prose: "unarmed strikes count as magical" has no
    target and no enemy to test against. The Gnomish Lineages stay prose too — each grants cantrips
    and a prepared spell, and no token grants a spell.
  - **Qualified grants stay text**: Stonecunning's doubled bonus applies only to stonework-origin
    History checks, Elven Chain grants proficiency with ITSELF and not with medium armour, and the
    2024 Sun Blade's grant is conditional on already being proficient with longswords.

- [~] **PLG-TAILS · a sheet cannot tell that a plugin is a DIFFERENT VERSION of the one it was
  built with.** The sheet names each plugin it counts on and is not getting, and why
  (`../internals/plugins.md` §1), which covers a character opened on an install without the plugin.
  What it cannot say is "this is version 2 and you built against 1": nothing records which version a
  character was built with, and the plugin is found by namespace alone. Recording it is a field in
  the character file, so it is a save-format decision before it is code — what is written (the
  version, or the consent hash), when (at save, or when a token first resolves), and what a mismatch
  does besides being said.
- [~] **SCOPED-BONUS · a bonus that applies to ONE thing, not everything.** The GRAMMAR is BUILT and
  is the settled shape: the scope lives in the TARGET namespace — `flat_bonus:damage.melee+2`,
  `damage.<weapon_id>`, `damage.<spell_id>` — so it costs no token segment (the 4th stays reserved
  for a bonus TYPE, `docs/internals/compatibility.md` §4) and keeps the weapon vocabulary out of L1.
  A weapon's scopes are its tags plus its own id, a cast's are the spell's id, `spell` and the class
  it is cast as, and a roll naming no scope picks up none of them. `flat_bonus:attack:<category>` (Archery) normalizes into the same
  field, so there is one shape downstream. Rage's damage reads it in both editions, 2014 Agonizing
  Blast as `damage.eldritch_blast`, 2024 Agonizing Blast as `damage.option_choice` filled with the
  cantrip its pick named (REPEATABLE-OPTION), and Magic Weapon with the weapon its cast asked for.
  Innate Sorcery's DC and advantage name the class (`spell_dc.sorcerer`, `attack.spell,sorcerer`).
  What is left: **a cast offers no SCHOOL and no CANTRIP scope**, so 2024 Potent Spellcasting (any
  Cleric or Druid cantrip) and Empowered Evocation (evocation spells) have nothing to name
  (FEATURE-PASSIVES lists them). The fix is the cast offering its school and `cantrip` beside the
  class, the way a weapon offers its tags.
- [ ] **DIVINE-SMITE · a roll that grows with the slot it spends.** SRD 5.1 paladin, level 2: "expend
  one spell slot to deal radiant damage … 2d8 for a 1st-level spell slot, plus 1d8 for each spell
  level higher than 1st, to a maximum of 5d8 … increased by 1d8 if the target is an undead or a
  fiend". `spend_slot` exists; a roll that reads the level of the slot it spent does not. SRD 5.2.1's
  Paladin's Smite is the Divine Smite SPELL always prepared with one free cast a long rest — a
  feature's `spells` and a pool.
- [ ] **FEATURE-SKILLS · a skill or an expertise a feature has the player choose.** SRD 5.2.1 Primal
  Knowledge (one more skill from the barbarian list), Scholar (Expertise in one of six skills
  already held) and Deft Explorer (Expertise in one held skill, and two languages); College of Lore's
  three skills of any kind in both editions. Skills come from a class, a species and a background
  today; a feature's `expertise_slots` names a count and no list.
- [ ] **SLOT-RECOVERY · one verb for the features that give slots back.** Arcane Recovery, Natural
  Recovery (the designed `recover_slots`, Spellcasting ▸ Resource subsystem below) and SRD 5.2.1
  Magical Cunning ("regain expended Pact Magic spell slots but no more than a number equal to half
  the maximum (round up)", once a long rest).
- [ ] **REACTION-ROLLS · the dice a reaction or a rest rolls, as options.** Cutting Words (a Bardic
  Inspiration die off an enemy's roll), Song of Rest (SRD 5.1, a d6 more on a short rest's hit
  dice), Deflect Missiles / Deflect Attacks (1d10 + Dexterity + monk level), Slow Fall (five times
  the monk level), Tactical Mind (SRD 5.2.1, a Second Wind use for +1d10 to a failed check).
- [ ] **ACTION-OPTIONS · a feature's action that spends no pool.** Many features are an action, a Bonus
  Action or a Reaction that does something and has no uses to count: Cunning Action, Fast Hands,
  Steady Aim, Stillness of Mind, Self-Restoration, Tranquility, Countercharm; Dark One's Blessing is
  the player pressing "I dropped a creature" for `temp_hp:cha_mod+class_level.warlock`. The turn
  economy and the verbs exist (`actions.md` §2); a `resource_option` needs a pool. An option bound to
  the FEATURE that grants it — spending its turn slot and running its verbs — turns a dozen
  text-only features into buttons. Wants a design of where such options live (a `feature_option`
  type, or a `resource_option` with no `resource_id`) before code.
- [ ] **TOGGLE-STATES · a state the player turns on for a turn.** Reckless Attack (Advantage on
  Strength melee attacks, and attacks against you have it) and SRD 5.2.1 Steady Aim, as effect rows
  added in one press like any other.
- [ ] **HUNTERS-PREY · the Hunter's choice.** SRD 5.1: one of Colossus Slayer (an extra 1d8 once a
  turn), Giant Killer and Horde Breaker; SRD 5.2.1: Colossus Slayer or Horde Breaker, swappable on a
  rest. Option rows; Colossus Slayer a limited roll.
- [ ] **FRENZY · the Berserker's.** SRD 5.2.1: Reckless Attack while raging adds Rage-damage d6s to the
  first hit each turn; SRD 5.1: a bonus-action melee attack each turn of the rage, and a level of
  Exhaustion when it ends.
- [~] **REPEATABLE-OPTION · an option taken more than once, each time with its own answer.** An option
  row's `answer` column says what each pick asks (`OPTION_ANSWER`: `cantrip.damage`,
  `cantrip.attack`); such an option is taken once per answer, stored as `id.answer` in the same
  `build.options` list, and its `option_choice` tokens read that answer (`../internals/content.md` ▸
  One row, several options). Agonizing Blast, Eldritch Spear and Repelling Blast ship on it.
  **Left: Lessons of the First Ones** — "gain one Origin feat of your choice … Each time you do so,
  choose a different Origin feat". Its answer is a FEAT, which wants the feat slot a feature's
  `feat_choice` opens, opened per pick; the row is taken once and asks nothing until then.
- [ ] **A17 · what a 2014 Book of Shadows holds besides the warlock's own spells.** A Tome
  warlock casts rituals: Pact Boon is a choice of three, Book of Ancient Secrets is an invocation
  that requires Pact of the Tome, and holding it gives the warlock `ritual_source: prepared` —
  "You can also cast a warlock spell you know as a ritual if it has the ritual tag"
  (`../internals/rules-core.md` ▸ Spellcasting). Two things the same texts state are still only
  text, and both want a spell a character holds OUTSIDE their class list:
  - **The book's own rituals.** "Choose two 1st-level spells that have the ritual tag from any
    class's spell list … You can't cast the spells except as rituals", and more are transcribed
    into it later. A spell choice with no class list behind it and a ritual-only flag on the
    entry; a feat's `spell_choice` is the nearest shape and asks for ONE list.
  - **Pact of the Chain's find familiar** — "You learn the find familiar spell and can cast it as
    a ritual. The spell doesn't count against your number of spells known": a spell a row GRANTS,
    which no token says. The Tome's three cantrips from any list are the same gap.
- **Won't-do (recorded so they aren't re-audited as bugs):** **CONCENTRATION-SPLIT** — a segmented
  `1 · 2 · 3` beside Damage, to raise several DC 10 saves for one lump of equal projectiles (Magic
  Missile). 2024 dropped the per-source sentence, under 2014 the player presses Damage once per dart
  and gets the same saves, and how a table reads "one source" is a table's call, not the app's;
  **MASSIVE-DAMAGE / System Shock** — the ≥ half-max-HP → DC 15 CON → System Shock table rule is
  **DMG, not SRD, so no CC-BY text for it exists**. Authoring it from memory is exactly the failure
  that passes every gate. If it ever ships it is content someone else authors into a pack, and what
  we might add is the general ability to install such optional-rule content — never the rule itself;
  **ARCH-4** the `padding`/`margin`/`gap` px → `--space-*` sweep — measured at 186 declarations, of
  which 2px (61) and 1px (24) are hairline nudges no spacing scale should own, and the rest cluster
  where the scale simply has no step (13–15, 17–22). The reason to hold the line was themeability, and
  themes are colours-only, so an off-scale `14px` breaks nothing for anyone; **D19** exhaustion
  `max 6` stays a RAW
  constant (identical both editions — not a data-driven win, YAGNI); **SMELL-2** `deriveHealth` is
  single-open + `characterName` is a display-only label — keying it by `c.id` is dead flexibility;
  loose `z.record` play-state keys stay un-branded (see `docs/internals/characters.md` ▸ Play-state modelling);
  **2014 `grappler`** stays text — it is relational ("advantage against a creature grappled
  by you") and the app has no target model.
- [ ] **COMPANION · no data model exists for a bound creature** — a familiar, a steed, a beast
  companion, a summon. Not a missing panel: there is nothing in the character schema for a creature
  that belongs to a character, so a Ranger's companion and a Wizard's familiar are today entirely
  outside the app. Adjacent to Wild Shape (`play.form`), which replaces the character's own
  statblock rather than adding a second creature beside it — related shapes, different problems.
  **The research is written** — [`../research/companion.md`](../research/companion.md), every rule
  quoted from the shipped packs — and it changes what the item is:
  - **The four answers are proposed there and wait on a sign-off**: a panel on the owner's play
    surface rather than a sheet of its own; whose turn it acts on SAID from two facts the granting
    row states (own initiative · right after you · a mount, and what a command costs), since the
    rows disagree inside one edition and the app has no initiative order to enforce; no fold of
    the owner's effects onto it, because no shipped sentence asks for one; a list in `play` beside
    `play.form`.
  - **A ranger's companion is not in either pack.** The SRD's ranger has the Hunter only, so the
    2024 Beast Master this item was written around is homebrew's to bring.
  - **Three 2024 stat blocks are six ability scores and nothing else**: the Otherworldly Steed,
    the Giant Insect and the Draconic Spirit live in their spell's text as a table that ends after
    the scores, and have no monster row. They are transcribed in the content repo before a 2024
    steed can show a number.
  - **It needs a way for a row to say "this grants a creature"** — which stat blocks, how many,
    where it acts, what a command costs — which is `../internals/effects.md` before it is code.
  **One constraint is already fixed:** a companion's stats start from a `monster` row but are
  the player's to EDIT — every score, HP and attack stays writable, because a bound creature drifts
  from its statblock the moment a table plays it. So the model is an editable overlay over a monster
  ref, never a read-only pointer at one — and the spells write into that overlay themselves (a
  creature type, an Intelligence of 6, a language).

## Builder and character
- [~] **Level-up flow** — the sheet's "▲ Level up" control NAVIGATES to the builder in level-up
  mode (`?levelup=<slug>`), which hydrates the draft from the saved character; the sheet only decides
  whether to offer the control. The in-place "+1 and a toast telling you to open the builder" path it
  replaced is deleted, along with the popup nothing opened any more. **The prerequisite this item
  used to name — "needs the builder to hydrate from an existing character" — is BUILT.** What is
  actually left: the guided choices at the new level (ASI/feat, new spells, subclass at its level)
  are picked in the builder like any other build choice rather than being walked through, and adding
  a class while levelling goes through the builder too.
## Spellcasting
- [~] **Resource subsystem · Mystic Arcanum is a pool, not a slot.** Pools, their pips, the spend
  path, both rests, a slot a feature gives (`gain_slot`), a slot as what an option costs
  (`spend_slot`) and a cost the player names (`x`) are built (`../internals/actions.md` §2,
  `../internals/rules-core.md` ▸ Spellcasting). Wild Resurgence's "once on each of your turns" is
  not held: the option's window is having no use left, and nothing counts turns for an option.
  What is left:
  - **Mystic Arcanum — the design is agreed with the maintainer; build it after 0.8.2.** RAW, both
     editions: at warlock level 11 one level 6 Warlock spell, then one of level 7 at 13, 8 at 15 and
     9 at 17, each cast "once without expending a spell slot" and regained on a Long Rest — four
     separate uses, each tied to its own spell, not one pool. Pact slots stop at level 5, so they
     never pay for one, and the spells are not counted among those known or prepared. SRD 5.2.1
     lets a warlock "replace one of your arcanum spells with another Warlock spell of the same
     level" on gaining a level; SRD 5.1 is silent (RAW: no swap; many tables allow it). What blocks
     it today: the level a warlock may learn reads the Pact Magic table, so no level 6 spell can
     be chosen.
     **The shape**, reusing the feat caster profile (`character/spellcasting.ts` ▸
     `featCasterProfiles`: its own list, caps and spell level):
     - the feature row carries `spell_choice` = `6:1@11,7:1@13,8:1@15,9:1@17` — `spell level:count`
       as in a feat's column, and `@` the class level it opens at (`../internals/content.md` ▸ At a
       level is `@`); `spell_choice_lists` = `warlock`; a new open-enum column `spell_free_cast` =
       `long` — "each spell chosen here casts once per long rest" (a later row may say `short`);
     - the builder's spell picker gains a section per opened rung ("Mystic Arcanum — level 6
       spell, choose 1"), not counted against the warlock's own cap;
     - each chosen spell gets a one-use pool of its own; casting it spends that pool, the cast
       picker offers that pool and no slot (the first time data ties a pool to one spell — today
       the picker lists every pool with a use left, `../internals/rules-core.md` ▸ Spellcasting);
     - swapping is the builder's free edit as for any spell; the hover says the edition's rule.
  - **Arcane Recovery and Natural Recovery — the design, sized at about two hours.** A verb
    `recover_slots:<budget>:<max slot level>` — `recover_slots:ceil(class_level.wizard/2):5` — on a
    resource option of the pool that already ships. The player is not asked slot by slot: the
    executor lists every MAXIMAL combination of spent slots within the budget ("two level 1 slots",
    "one level 2 slot") as rows of the existing `OptionQuestionDialog`, which learns to show a label
    rather than a number, and restores the one taken. 2024 Natural Recovery's free cast is its
    second pool (`natural_recovery_spell`), already shipped.

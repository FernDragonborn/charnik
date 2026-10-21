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
  `restore_resource` count can say; Arcane and Natural Recovery restore slots, and Indomitable
  rerolls a save — each is a pip the player spends by hand until then.
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
  A weapon's scopes are its tags plus its own id, a cast's is the spell's id, and a roll naming no
  scope picks up none of them. `flat_bonus:attack:<category>` (Archery) normalizes into the same
  field, so there is one shape downstream. Rage's damage reads it in both editions; what is left is
  the other consumer:
  - [ ] **2024 Agonizing Blast.** The 2014 row carries `flat_bonus:damage.eldritch_blast+cha_mod`
        and a held one reaches Eldritch Blast and no other spell. The 2024 row is text: "Choose one
        of your known Warlock cantrips that deals damage", so its scope is a cantrip the PLAYER
        names, and the invocation is _Repeatable_ — once per eligible cantrip. Both halves are
        REPEATABLE-OPTION below.
        Magic Weapon, the other consumer this line named, is built: the cast asks which weapon and
        scopes the bonus to that weapon's id, so two copies of one weapon both take it — an
        inventory entry has no identity of its own to scope to.
- [ ] **REPEATABLE-OPTION · an option taken more than once, each time with its own answer.** SRD
  5.2.1 marks four invocations _Repeatable_: Agonizing Blast, Eldritch Spear and Repelling Blast
  ("Each time you do so, choose a different eligible cantrip") and Lessons of the First Ones
  ("choose a different Origin feat"). `build.options` holds a feature's picks as a set of option
  ids and an option is held once (`content.md` ▸ One row, several options), so today each of the
  four is taken once and asks nothing. What it needs: a row that says it may repeat (an open-enum
  column, since "once per character" is the other policy and a third will come), an answer per
  pick — a cantrip the character knows, or an Origin feat slot — and the token's scope filled
  from the cantrip answer the way `item_choice` fills an item's. The four rows ship as text until
  then.
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
  - **Mystic Arcanum** — both SRDs say "cast … once without expending a
     spell slot", which is the pool a cast already offers to pay from. What blocks it is not a
     token: the level of spell a warlock may learn reads the Pact Magic table, which stops at 5,
     so there is no way to choose the level 6 spell the arcanum is. Natural Recovery's free cast
     and the slot recovery of Arcane Recovery are the same two shapes: a pool that is sayable
     today, and slots a player already restores by their pips.

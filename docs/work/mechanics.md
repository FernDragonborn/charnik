# Rules and play mechanics — open work

> Tracker. The rules core, the effect vocabulary, features, resources and play state. The specs are
> [`../internals/rules-core.md`](../internals/rules-core.md), [`../internals/effects.md`](../internals/effects.md)
> and [`../internals/characters.md`](../internals/characters.md); the ORDER is [`plan.md`](../plan.md) ▸
> Implementation order.

## The three shapes a class feature reduces to

Roadmap work, not defects. **An item id is stable — never renumber one**: ids are how items in the
other `work/` files, and comments in the code, refer to these.

Core insight: PHB class features reduce to THREE data shapes, and the engine for two of them
already exists — (1) passive modifier tokens (blocked only on the fold gathering them), (2) activatable
actions = COMPOSITION of existing systems (`economy.trySpend` + `resourcesSpent` + `addEffect`
with duration + `rollPool` — no new engine, new `class_features` columns: activation slot,
resource cost, applied tokens, duration, roll), (3) choice groups (`choice_group` + `choose_n`
columns; generalizes the builder's slotFeats pattern; chosen rows then behave as 1/2).
Level scaling stays formula-free: per-level `class_features` rows re-grant (monk die d6→d12,
superiority d8→d12) — the table is already keyed by level; L2 expressions not needed for ~90%
of PHB. **Acceptance: FULL PHB integration — every feature of every PHB
class must be EXPRESSIBLE via one of the three shapes (or explicitly marked manual-text
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

- [x] **N1 · Inventory view.** The combat panel (`pid: 'inventory'`): qty stepper, equip / attune
  (cap 3 — Strict blocks, Free allows and says so), "use" on a consumable, and the weight →
  carrying-capacity bar. **What must survive:** money is its OWN thing (N6), never an inventory row;
  ADDING an item stays in the builder, because that is a search through hundreds of rows while the
  panel is the four verbs play needs; item charges live in RECHARGE-3, not here.
- [x] **DEMO-1 · Showcase demo character.** **Karroth the Red**, id `karroth` —
  Tiefling · Soldier · **Warlock 5 (Fiend) × Barbarian 3 (Berserker)**, SRD-only, derives clean
  against the real shipped SRD 5.2.1 graph. It seeds first-run on web AND desktop, so it IS the first
  impression of the system's scope — keep it deriving clean. `recreateDemoCharacter()` restores it;
  Settings ▸ Data has the button.
  **What this pairing does NOT exercise** (so nobody assumes the demo covers it): `casterLevel` is 0
  for the barbarian half, so pact-pool-alongside-shared-slot math is never hit; Unarmored Defense and
  the Eldritch Invocations are untokenized, both waiting on N2; and a base Warlock has **no Ritual
  Casting**, so the `R` badge cannot appear here without Book of Ancient Secrets — demo rituals on a
  Wizard/Cleric aspect instead, and with a REAL shipped SRD ritual, never a hand-authored one.
- [ ] **N2 · Class-feature engine ("features as data").** The three shapes above, in the order
  1→3→2. Wild Shape carved out as N2b: it is a stat-block REPLACEMENT, not one of the shapes.
  Superiority dice: extend the grammar —
  `grant_resource:superiority-dice:4:d8:short` (die BEFORE recharge —
  "what the resource is, then when it refills"; ResourceDef + `die`). The die segment is
  optional and shape-distinguishable (`d\d+` vs `short|long|other`), so existing 3-segment
  tokens (`grant_resource:rage:2:long`) keep parsing unchanged. Spending rolls the die into
  attacks via the existing `bonusDice` path. Extra Attack: `flat_bonus:attacks+N` →
  Attacks panel shows ×N — carved out as EXTRA-ATTACK below, because it blocks 0.7.0 and the rest
  of N2 does not. The fold ALREADY gathers feature tokens (`derive-gather` ▸
  `considerFeature` pushes each qualifying row at the `feature` layer), so a passive token on a
  class-feature row works the day it is written — FEATURE-PASSIVES is written against that. What is
  still owed here is the content-schema column bump for shapes 2 and 3.
  **The measurement that sizes shape 3, so it is not re-taken:** of the shipped class-feature rows
  in both editions, only a handful carry any effect token. So Fighting Style · Metamagic · Eldritch Invocations · Weapon Mastery · Pact Boon · Divine
  Order · Primal Order · Epic Boon have no column a picker could read, and a panel for them today
  would be a lie — they are blocked on the `choice_group` / `choose_n` columns, not on UI.
  Same for the pools the prose describes and no `grant_resource` creates: Lay on Hands, Channel
  Divinity, Font of Magic, Wild Shape, Indomitable, Arcane Recovery, Mystic Arcanum, Stunning Strike.
  The Resources block discovers pools from the engine, so each appears the moment content encodes it;
  the ids that DO exist are `rage`, `bardic_inspiration`, `second_wind`, `action_surge`, `ki`,
  `focus`, `persistent_rage`, `uncanny_metabolism`. **These rows come through the converters**
  (`docs/internals/content.md` ▸ "Where the shipped data comes from") — a mechanic stated in SRD prose
  is still game data, and hand-authoring it from memory is the failure that passes every gate.
- [ ] **EXCEPT-DAMAGE · "resistance to all damage except X" has no form.** `damage_sensitivity`
  names ONE type or `all`; the exclusion in between is unsayable, so 2024 Superior Defense (all
  damage except Force) degrades to a note. The cheap shape is a subtractive relation
  (`damage_sensitivity:resist:all` + `damage_sensitivity:none:force`) rather than a set expression
  in the type slot, which would put a grammar inside a slot that is deliberately free-form. Not worth
  building until a second case appears — record it here so the third one does not re-open the design.
- [x] **PROF-GRANT · `grant_proficiency` has data, and its target namespace reaches equipment.**
  The token could only ever say a save or a skill, and no shipped row said even that. Both halves
  shipped together, because the saves alone would have left the design question open.

  **The namespace it grants in is its own** (`docs/internals/effects.md` ▸ Targets): abilities and
  `save.<ability>` plus the `saves` GROUP, skills, `armor.<category>` and `weapon.<category|item_id>`.
  Equipment is binary — there is no expertise in wearing plate — and it folds ON TOP of the class
  columns via `withGrantedProfs`, which leaves an UNCONSTRAINED character unconstrained: a lenient
  (undeclared) class must never be turned constrained by a grant. A specific weapon id is open
  vocabulary for the same reason a damage type is — `derive-targets.ts` has no graph to check an id
  against, and a mistyped category cannot be told from an id it has never heard of. Armour has no ids,
  so it stays closed and spell-checked.

  **`grant_proficiency:saves` is one token, not six.** "Proficiency in all saving throws" is one
  sentence in the rules; six tokens would be data the source does not have.

  **Shipped rows that now say it rather than only printing it:** 2014 Diamond Soul + 2024 Disciplined
  Survivor (`saves`) · Slippery Mind (2014 Wisdom, 2024 Wisdom AND Charisma — the editions differ) ·
  2014 Life Domain's Bonus Proficiency (`armor.heavy`, so plate stops blocking the cleric's spells) ·
  2014 Dwarven Combat Training and High Elf's Elf Weapon Training (four weapon ids each — the elf's
  belong to `high_elf`, since the base `elf` row's text blob merely reprints the subrace section) ·
  2014 Keen Senses and Menacing (Perception / Intimidation). `class_features_content.test.ts` asserts
  each, non-vacuously — the negative case is asserted beside the positive one.

  **Still prose, deliberately:** every grant that is a CHOICE (2024 Divine Order and Primal Order,
  College of Lore, the 2024 elf's one-of-three Keen Senses) waits on the chooser, not on this token.
  Qualified grants stay text — Stonecunning's doubled bonus applies only to stonework-origin History
  checks, Elven Chain grants proficiency with ITSELF and not with medium armour, and the 2024 Sun
  Blade's grant is conditional on already being proficient with longswords.

- [x] **EXTRA-ATTACK · a level-5 martial attacks twice.** `attacksPerAction` is a folded value
  like every other number: base one from the rules core, raised by `set_override:attacks:<n>:floor`
  on the feature row, with its trace. **A SET with a floor, not an add** — RAW lists Extra Attack
  among the features with special multiclassing rules, so a fighter 5 / barbarian 5 attacks twice
  and two additive tokens would have quietly made it three. The 2014 fighter carries its whole
  ladder in one row (`step(class_level.fighter, 5->2, 11->3, 20->4)`), 2024 splits it across three
  rows that each raise the floor. The builder had been showing this number from its own sum over raw
  facts, which bypassed the fold; both views read the one value now. The 2014 paladin had no Extra
  Attack ROW at all — its SRD heading reads "Extra A ttack", an OCR artifact, so the converter's
  name lookup never matched — and the row is transcribed in.
- [x] **RAGE-SCOPE · Rage damage is a Strength bonus, and the editions mean different things by it.**
  It ships as a broad `flat_bonus:damage+2`, so it pays out on any attack. RAW is narrower and the
  two editions are NOT the same sentence: 2014 is "when you make a melee weapon attack usingStrength",
  2024 is "When you make an attack using Strength—with either a weapon or an Unarmed Strike" (no
  melee, and unarmed named). So this is two tokens, not one shared one. Player consensus is
  unanimous and matches RAW — a finesse weapon swung with Dexterity gets nothing — so there is no
  table choice to offer here, unlike most RAW/RAI splits.
  Shipped as `damage.melee,str` (2014) and `damage.str` (2024). It needed two grammar pieces that
  did not exist: an attack now carries the ABILITY it resolved from among its scopes (`attackAbility`
  in `combat/attacks.ts`, extracted so the rule has one home), and a scope may be a comma-separated
  list the roll path requires ALL of — which it already matched that way, only the parser refused to
  accept one.
- [ ] **FINESSE-ABILITY · a finesse weapon asks which ability it swings with. NEEDS A MAINTAINER'S
  EYES ON THE FEEL, not just a green test.** RAW hands the player the choice — "you use your choice
  of your Strength or Dexterity modifier" — and the app takes it silently: `Math.max(strMod, dexMod)`.
  That was invisible while the bigger modifier was strictly better. RAGE-SCOPE makes it visible and
  sometimes wrong: at STR 14 / DEX 16 the auto-pick takes Dexterity (+3/+3) while Strength gives
  +2/+2 **plus** rage damage, which is more damage on the same swing. The same shape will recur for
  any feature that keys off an ability rather than a weapon.
  Shape: a two-state control on the attack row of a finesse weapon only (everything else has no
  choice to make), defaulting to the higher modifier, remembered per weapon, and visible in the
  attack's trace so the number still explains itself.
  **The open question is not whether it computes right — it is whether a player reads it without
  being told.** That verdict is the maintainer's, from the running app; it lands in the manual-check
  report when built, not closed on a passing test.
- [ ] **GWF-2014 · Great Weapon Fighting is a REROLL in 2014 and a floor in 2024, and only one of
  them ships.** 2024 says "treat any 1 or 2 on a damage die as a 3" and carries
  `min_die:damage:two_handed,melee:3`. 2014 says "you can reroll the die and **must use the new roll**"
  — which is not the same number: a reroll can land on a 1 again, a floor cannot. The `reroll` kind was
  built for exactly this sentence and has no shipped row.

  **What actually blocks it is where 2014 keeps its fighting styles.** They are prose inside ONE
  `fighter_fighting_style` row, not a row per style, and 2014 ships exactly one feat (Grappler). So
  there is nothing to author the token onto until the styles are rows the player picks between — N2's
  chooser, same shape as the 2024 fighting-style feats already have. Once they are, the token is
  `reroll:damage:two_handed,melee:2` and the edition divergence is said rather than smoothed.

- [x] **VOCAB-CONSUMERS · every effect kind has a shipped row, or a stated reason not to.** Three
  times this cycle a kind was built, documented with a named example, and shipped with NOTHING using
  it: `grant_proficiency` (0 rows → 22), the ladder's `partial` rung (built down to the trace label,
  no producer), and `min_die` on a d20 (Reliable Talent was its documented example and was prose).
  Each was found by accident — twice by a maintainer asking a question.
  **So it is a test now**, not a habit: `class_features_content.test.ts` walks every shipped row in
  both packs and asserts that the set of kinds with no user equals a pinned list, each entry carrying
  its reason. `plugin` is user-authored by definition, `auto_succeed` has no RAW consumer (its mirror
  `auto_fail` has 16, all conditions), and `reroll` waits on GWF-2014 above. Gaining a user is now a
  deliberate edit to that list; losing the last one fails loudly.
  **The same question one level down is asked too:** a kind can be consumed while its TARGET is not,
  so a token parses, folds onto nothing, and only content-health mentions it — at runtime, to a user
  who did not write the row. B13's `isEffectTargetSupported` could always answer that; nothing had
  ever asked it of OUR data. A second assertion walks the same rows and expects an empty list.

- [x] **RELIABLE-TALENT · a rogue stops rolling under 10 where the rule says so.** `min_die` was
  built with Reliable Talent as its named example and shipped with no d20 consumer at all: the rows
  said "you can treat a d20 roll of 9 or lower as a 10" in both editions and an 11th-level rogue
  rolling a 3 kept the 3. Found by a maintainer mixing it up with Jack of All Trades, which is the
  cheapest kind of find and the reason to say what a feature does out loud.

  **What it needed was one fact the roll did not carry.** RAW keys off "an ability check that lets you
  add your proficiency bonus", and a skill roll passed no scopes, so `min_die:skills:10` would have
  floored every check including the untrained ones — over-granting, which is the failure this whole
  gate is about. The skill roll now passes ONE scope, `proficient`, meaning exactly that sentence, and
  the shipped token is `min_die:skills:proficient:10`. Expertise carries the scope too; Jack of All
  Trades' `partial` rung does not — 2024 says "uses one of your skill proficiencies", and a skill you
  are untrained in is not one.

  **`roll`'s key and its scopes became one argument** (`RollTarget`), because they answer one question
  and because a fifth positional parameter is a type. A bare string still works, so every other call
  site reads as it did.

  **Not covered, and stated rather than implied:** 2024's Reliable Talent also names TOOL
  proficiencies, which `TOOLS` has not modelled yet, so the tool half waits there.

- [ ] **FEATURE-PASSIVES · the shape-1 features, named.** N2 says shape 1 is a passive token; this
  is WHICH rows, found by matching each shipped feature's own SRD text against the phrases that
  declare a mechanic ("you have advantage on", "your speed increases", "your AC equals", "immune to",
  "score a critical hit on"). Every row below carries no token today. Grouped by what it is waiting
  on, because only the first group is pure content:

  - **Writable against the targets that exist — all shipped.** `danger_sense` (`advantage:save.dex`) ·
    `fast_movement`, 2024 `roving` and `unarmored_movement` (a speed bonus under each one's own armour
    guard; the monk's is the `step()` ladder, MONK-MOVEMENT) · `feral_instinct` and 2024
    `champion_remarkable_athlete` (`advantage:initiative`).
    Two rows that were listed here are NOT shape 1 and moved: 2024 `superior_defense` spends 3 Focus
    Points for a minute of resistance, so it is an activated ability with a duration, not a passive;
    `pact_boon` is a choice of three, so it waits on `choose_n` with the rest of the choices below.
    2014 `ki_empowered_strikes` stays prose: "unarmed strikes count as magical" has no target, no
    enemy to test against, and the Features panel already prints the sentence.
  - **Blocked on a defense bucket that is not damage.** Immunity to a CONDITION or to disease has no
    target at all — the fold's defense buckets hold damage types only. 2014 `purity_of_body`,
    `divine_health`, `circleoftheland_natures_ward`; 2024 `aura_of_courage` (Frightened),
    `path_of_the_berserker_mindless_rage` (Charmed + Frightened), `oath_of_devotion_aura_of_devotion`
    (Charmed), `circle_of_the_land_natures_ward` (Poisoned). Same shape as CONDEFF's merge — a
    condition is content, so immunity to one is a reference to a row, not a new vocabulary.
  - **Blocked on a fold target that does not exist yet — down to the crit threshold.** `extra_attack`
    (EXTRA-ATTACK), `unarmored_defense` and `draconicbloodline_draconic_ancestry` (a `set_override`
    on `ac` says the formula) and `reliable_talent` (RELIABLE-TALENT) all shipped their tokens; what
    is left is `champion_improved_critical` / `champion_superior_critical`, which need a
    CRIT-THRESHOLD target. **That one is not a wrong number, because the app never decides a crit** —
    `RollResult.crit` is set by the player on purpose ("a natural 20 is not always a crit, and a crit
    happens without one"), and the roller only HIGHLIGHTS a natural 20 as deciding. So a Champion's
    19 is a highlight the sheet cannot yet offer, not arithmetic it gets wrong: the work is a
    `crit_threshold` numeric target plus the four or five places that compare `=== 20`.
  - **Blocked on SCOPED-BONUS reaching spells.** "Add your <ability> modifier to the damage of X":
    2024 `blessed_strikes` and `elemental_fury` (any cantrip of that class), `empowered_evocation`
    (evocation spells), `oath_of_devotion_sacred_weapon` and 2014 `oathofdevotion_channel_divinity`
    (one weapon, attack roll), 2014 `foe_slayer` (attack OR damage, player's pick).
  - **Situational by nature — these stay `note`, and that is the answer, not a gap.** Advantage that
    depends on what you are fighting or what you did last turn: `favored_enemy`, `countercharm`,
    `lands_stride`, `hunter_defensive_tactics`, `holy_nimbus`, `thief_supreme_sneak`, 2024
    `studied_attacks`, `precise_hunter`, `innate_sorcery`. The app has no enemy and no turn history
    to test the condition against; surfacing the text is the honest behaviour.
  - **A choice, so it waits on `choose_n`** (N2 shape 3): `fiendish_resilience` and 2024
    `draconic_sorcery_elemental_affinity` — resistance to a damage type the player picks and can
    change.

- [ ] **N2b · Wild Shape = stat-block replacement.** A druid has no working Wild Shape at all.
  Model: `play.form = {monsterRef, formHp} | null`; deriveSheet branches — physical
  scores/AC/attacks/speed from the (already-typed) monster row, mental stays own; an isolated
  removable seam like effects; the editions diverge (2024 = temp HP + a known-forms list).
  **The per-edition spec is written and lives in [`../research/wild-shape.md`](../research/wild-shape.md)**,
  every statement quoted from that edition's own shipped SRD text. Read it before modelling: the two
  editions diverge more than the shared name suggests. 2014 REPLACES your hit points with the beast's
  pool and carries excess damage over; 2024 leaves your HP alone and grants temporary HP equal to your
  druid level — so `formHp` is a 2014-only field, not a shared one. 2014 gates forms by CR and by
  "no flying or SWIMMING speed"; 2024 has no swim gate at all and keeps a Known Forms list you swap on
  a long rest. Shaping costs an Action in 2014 and a Bonus Action in 2024.

  **Writing the spec turned up four CONTENT blockers, and they are what actually holds this up:**
  - `monsters_srd.csv` has no attacks column in EITHER edition — a stat block's attacks are prose. A
    form that cannot attack is not a form. This also blocks Primal Strike.
  - The 2014 pack ships **four** beasts (stirge CR 1/8 flying, plesiosaurus CR 2, triceratops CR 5,
    T-rex CR 8), so a 2014 druid has **zero legal forms at levels 2-7**. The wolf, crocodile and giant
    eagle its own table names are not in the file. 2024 ships 69 beasts at CR ≤ 1.
  - No `wild_shape` row exists in either `resources_srd.csv`, and `druid_wild_shape` carries neither
    a `resource` nor an `effects` value — there is no pool to spend.
  - The 2024 uses-per-level ladder lives in the Druid Features table, which is shipped nowhere; two is
    the only number the content supports, and inventing the rest is the failure AGENTS.md names first.
    2014 needs no ladder (flat two until 20).
  - A grammar gap, smaller: `grant_resource:<id>:<max>:<recharge>` cannot say 2024's split recharge
    (one back on a short rest, all on a long) — RECHARGE-3's `{trigger, amount}` model is where that
    lands.
  - [ ] **Wild Shape must be TRACKED before its event siblings work.** Evergreen Wild Shape (the
        `regain_on_initiative` auto sibling of Perfect Focus and Superior Inspiration) has no pool to
        restore, so it waits on the model above rather than on the mechanism, which is shipped.
- [x] **N4 · Skills system fixes.** (a) **DONE (2026-08-02):** `toggleExpertise` capped from data
  — a curated `expertise_slots` `level:count` column on class_features (ONE row carries the
  progressive grant: Rogue `1:2,6:2`, Bard `3:2,10:2` 2014 / `2:2,9:2` 2024, 2024 Ranger `9:2`;
  converter-preserved like `effects`). Build sums the active-feature grants → `expertiseCap`;
  Strict enforces (Free doesn't), and the skills card head reads `expertise N/M`. Wizard "Scholar"
  (1 restricted-list expertise) deliberately NOT encoded — the count model can't express the skill
  restriction, so encoding it would over-permit. Unit + real-content tests both editions.
  **Screenshot-verified on a Rogue 6 with a background** (`design-preview/rogue-expertise-cap.png`):
  the counter walks 0/4 to 4/4 and holds there. At the cap the doubling control is NOT disabled —
  `toggleCapped` REPLACES the oldest pick, the way every other capped picker in the builder behaves,
  so the count stays 4 and the ring moves. (b)+(c) are ONE grammar step: the L1
  vocab grows a proficiency LEVEL in the third segment — `grant_proficiency:skill.<id>:partial` and
  `:expertise`, defaulting to `proficient` when absent, so every existing token keeps parsing. That
  makes Jack of All Trades a content row (the partial type and `skillCheck`'s partial argument already
  exist and nothing calls them) and lets the builder show an effect-granted skill as locked-on
  instead of silently proficient. The same third segment is what `TOOLS` reuses;
  (d) **DONE (2026-08-02):** the combat SkillsPanel already showed the proficient/expertise
  tiers (filled / ringed dot) with `why()` provenance on the row hover; added the 4th tier —
  a faded `half` dot (color-mix on `--color-resource`, scaffolding until a half-prof producer
  lands per (c)) — and a friendly per-tier tooltip on the dot. Combat baseline 0px (reachable
  tiers render identically; the `on` split is behaviour-identical for none/proficient/expertise).
  **(b)+(c) DONE — the rung has a producer, and the builder reads the ladder.** The rung is an
  optional LEADING word (`grant_proficiency:[half|proficient|expertise:]<target>`) rather than the
  third segment this item once planned: the `expertise:` prefix already shipped, so extending it
  keeps ONE shape and every token written before the rung existed still parses as `proficient`.
  **Jack of All Trades is a content row** in both editions — `grant_proficiency:partial:skills`, where
  `skills` is a group target fanned out in the one place that reads the facts. RAW's "that doesn't
  already include your proficiency bonus" needs no second rule: the rungs combine by MAX, so a skill
  already proficient keeps proficiency and the half rung simply loses.
  **The builder shows the ladder, not just the pick.** A skill the sheet says is proficient that the
  draft never picked and no background gave is locked on and says "Granted by a feature" — the
  alternative is a row that looks pickable, un-picks to nothing, and reads as a bug. `half` is
  deliberately NOT a lock: it grants nothing to un-pick and the skill stays yours to train. The faded
  partial dot is the play sheet's own, so one tier looks like one tier in both views.
  **The rung is `partial`, not `half`.** A rung sits BEFORE its target, so `half:skills` reads as
  "proficiency in half the skills"; and "half" reads as a REDUCTION, while this rung is a GAIN — a
  lesser proficiency, never a cut-down one. `halved` was tried and rejected for the same reason.
  Renamed through the ladder type, `PROF_ORDER`, `skillCheck`'s argument, both dots' CSS and the two
  catalog keys, because it is one fact and one fact has one name.
  **Screenshot-verified on a level-2 bard** (every skill −1 → 0, every passive 9 → 10,
  `design-preview/joat-half-proficiency.png`) and on a 2014 elf, whose Keen Senses locks Perception.

### EXPR · L2 value-expression layer — BUILT (design → docs/internals/effects.md §3)

The bounded L2 formula layer (value expressions + condition guards, the type/resolution rules, the
worked examples, conditions/exhaustion-as-data) is **shipped** and its normative design lives in
[`effects.md`](../internals/effects.md) §3–§4. Delivered across EXPR-1..5 + CONDITIONS-1 (2026-07-17/19):
parser+evaluator (`expression-parser.ts` / `expression-evaluator.ts`), value expressions in tokens,
condition guards + the ONE resolve stage (`resolveActiveEffects`, `dependency-graph.ts`), the
dependency-order DAG (ability scores fold through the pipeline — A10), the typed-facts output
(`collectFacts`), cantrip scaling, the roll-manip L1 tail (`reroll`/`min_die`, `d20_tests`,
`speed.fly/swim`, `spell_dc`/`spell_attack`, `save.death`), and all 15 standard conditions carrying
mechanical `effects` tokens in both editions. AUDIT SPEC2–SPEC7 (grammar / type / resolution
decisions) are recorded in effects.md §3; git holds the per-phase log.

### PLG · Plugin sandbox (L3 expressiveness) — BUILT (design → docs/internals/plugins.md)

The QuickJS-in-WASM plugin layer is **shipped** (PLG-1..3, 2026-07-19): the registry + native
handlers, the quickjs-emscripten (quickjs-NG sync) sandbox with the full PLG-SEC containment
(zero-capability context, 5 ms / 8 MB budgets, JSON-string boundary, length-prefixed SHA-256
consent hash stored OUTSIDE the dataDir, fail-closed counter, desktop-only), and the normative
[`plugins.md`](../internals/plugins.md) (`api: 1`) — all in `src/lib/effects/plugin-*`. Plugin-token failures
surface via `deriveIssues` → content health. The design decisions, the PLG-SEC containment
checklist, the state model (three channels) and the authoritative derive stage-list are the
design-of-record in [`plugins.md`](../internals/plugins.md) and [`effects.md`](../internals/effects.md) §4/§6 (AUDIT
SPEC1 / SPEC8 / SPEC9 map there); git holds the per-phase log. Open tails: the dedicated
plugin-dependency notification view + portability / version awareness (fresh-eyes review #2).

---

- [ ] **CONDEFF · one content type for conditions and effects.** From the roller: "I can't add
  Poisoned to an attack roll". Poisoned IS disadvantage on the attack the same
  way Bless is +1d4 on it; that they are two content TYPES is an authoring accident the player is
  made to know about. **Already merged, and staying that way:** play-state has ONE list
  (`play.effects`, an "effect/condition instance"), everything runtime folds at the **`condition`
  LAYER** — which is stacking algebra and survives the merge untouched — and both schemas are
  `baseRow` + the same `effects` token column.
  **What actually differs:** three columns (`max_level` on conditions, `duration_rounds` on effects,
  and `negative`), plus two UIs (a binary multi-select vs the "+" catalog with a duration), plus the
  `apply_condition:<id>` indirection between an applied instance and what it does.
  **`negative` is DELETED, not merged.** Its default is inverted between the two types, so merging it
  means picking whose default wins for every row of the other — a question with no right answer.
  Replace it with `valence`, an open enum (`harmful` | `helpful` | `neutral`) with no default:
  blank reads `neutral`, the converters state it per row, and the inversion stops existing. It also
  says more than the boolean did — Bless and a cover bonus were both "not negative", which is not the
  same fact as Poisoned being harmful.
  **Size, measured not guessed:** the merged schema is the union of those columns behind a `kind`
  open enum (AGENTS.md ▸ Taste (open enums, never booleans)); `~10` call sites of `graph.list('condition', …)`
  (derive-gather, derive, resolver, effects-editor ×4, roller-sources); character JSON is untouched
  (refs are `source:id`, and `apply_condition` keeps resolving — an id lookup inside one type instead
  of the other); the content repo needs a `#content-type` change on `conditions_*.csv` + a re-stamp,
  no row rewriting, since the loader already merges any number of CSVs into one type. So: a day, and
  the risk sits in the content-repo diff, not in the engine.
  **Unblocked meanwhile:** the roller's vocabulary lists BOTH types, so Poisoned is typeable into a
  roll today; the merge is what stops the next surface from having to remember to.
  **On disk this stays a header change.** The loader folds any number of CSVs into one type, so the
  files keep their names and their rows — `conditions_*.csv` declares the merged `#content-type`,
  gets its `valence`, and is re-stamped. No row is rewritten and no id moves.
- [x] **B25 / RV4 · Subclass-caster spell list.** The seam is DATA, not a class-name branch: a
  `spell_list` column on the `subclass` row naming the class lists it draws from (RAW an EK/AT casts
  off the WIZARD list, which cannot be inferred from `class_id`). A blank column keeps a subclass out
  of the index — never silently given a list. EK/AT are PHB, not SRD, so coverage lives in fixtures.
- [ ] **D16 · generalized player-choice model.** Half-feat ability-choice and Skilled's skill grants
  are DONE, at a level's slot AND under the background's granted origin feat — both ask through the
  same `FeatSubChoices` block, keyed by a slot key or by `ORIGIN_SLOT_KEY`. Still open: Magic Initiate
  spell picks (the `magic_initiate` feat's spell-learning half). One "player choice at a slot"
  abstraction covers all. Skilled's TOOL half moved out to `TOOLS`, which is a model, not a choice.
- [ ] **TOOLS · a tool proficiency, and that is the whole mechanic.** Tools already exist as things:
  `tool` is an `ITEM_CATEGORIES` member, so they sit in the inventory today. What is missing is being
  PROFICIENT with one — a build field, a grant reusing N4's third segment
  (`grant_proficiency:tool.<id>`), and a check that adds the proficiency bonus. Nothing else: no
  crafting, no downtime, no tool-specific rules.
  **The one edition divergence:** 2014 leaves the ability for a tool check to the GM, 2024 pairs an
  ability with each tool. So the ability comes from a column where that edition's SRD states one, and
  from the player at roll time where it does not — never guessed.
  Unblocks Skilled's tool half in D16.
- [x] **RECHARGE-3 · item charges, and the `{trigger, amount}` recharge they earn.** The model is
  BUILT (`rules/recharge.ts`, `docs/internals/effects.md` ▸ How a pool comes back): triggers
  `short|long|dawn|dusk|consumable|other` with an optional amount (`dawn(1d6+1)`), the one-word
  policies as sugar over it (`short_one` = `short(1)`), the rest path reading the model instead of
  branching on words, and a **Dawn / Dusk** control in the pass-time bar shown only when this
  character has such a pool. **No `charges` column**: a charged item says
  `grant_resource:<id>:<charges>:<trigger(amount)>` in its own `effects` cell and gets the whole
  resource subsystem — pips, spend, chip, rest — for nothing.
  - [x] **Shipped charged items as the first consumers.** Eyes of Charming, Pipes of Haunting and
        Gem of Seeing in both editions, Mace of Terror in 2024, each saying its pool in its own
        `effects` cell — `grant_resource:<id>:3:dawn(1d3)`, or a bare `dawn` for the one that
        regains all of them. Authored by asserting each row's own prose states both the count and the
        recharge sentence before writing the token, so a converter re-run that changes the text fails
        the authoring script instead of leaving a token that outlived its item.
        2014's **Mace of Terror was skipped and is no longer**: its text began mid-item ("The mace
        regains 1d3 expended charges…") with the count truncated away, which ITEM-TEXT-2014 turned out
        to be — the extractor dropping the paragraph, not the source lacking it. The row reads whole
        and carries its pool.
  - [x] **Every charged item that states a pool now says it** — 54 rows across the two packs (every
        wand, most staves, the rings, the trident), generated from the sentence stating the count and
        the recharge and read back one by one against it. A RANDOM starting pool ("1d8 + 1 charges")
        is deliberately not matched — the vocabulary takes a literal max — and an item with no
        recharge in its text says `consumable` rather than borrowing a dawn nobody wrote.
- [ ] **RECHARGE-TAIL · the damage-path and rest mechanics left over from the recharge work.** Each is
  small, each fires on an existing path, and none blocks the others.
  - [x] **Champion Heroic Rally — a turn-start heal**, and the trigger dimension generalized with it:
        `on_event:<event>:<action>` crosses a closed event set with the executor verbs, so the third
        trigger costs a name and a fire site rather than a token. The event set holds only what the app
        FIRES (`turn_start`: Next turn, and entering combat — round 1 is the first turn); an unfired
        name would parse and then never happen. "Only while Bloodied" needed no condition slot of its
        own — it is the ordinary L2 guard, and the shipped row says
        `is_bloodied and hp>=1 ? on_event:turn_start:heal:5+con_mod` in both editions. Arbitrary event
        LOGIC stays L3 plugin `onEvent`: widening L1 past a bounded vocabulary is a security property.
        `regain_on_initiative` keeps its own token — "top up TO n" is not one of the verbs.
  - [ ] **Concentration: several saves for one lump of EQUAL projectiles** (Magic Missile, Scorching
        Ray) — a segmented `1 · 2 · 3` control choosing HOW MANY saves, all at the same flat DC 10,
        never dividing the entered damage. Different SOURCES already work with no new UI: they are
        separate Damage presses, each raising its own save. Prototype:
        `design-preview/concentration-split-button.html`. **Weigh killing this instead of building
        it**: 2024 dropped the per-source sentence, and even under 2014 the player can press Damage
        three times.
  - [ ] **Massive Damage / System Shock** — ≥ half max HP in one instance → DC 15 CON → the System
        Shock table. **DMG-optional, NOT SRD**, so it can only ever ship as a toggle beside
        encumbrance, never as core rows or shipped data. Opening it means opening the category
        "optional DMG rules", which is the actual decision. (SRD overkill instant death is separate
        and already built.)
  - [ ] **2014 long rest recovers HALF your Hit Dice and the app picks them largest-first**; RAW lets
        the player choose which. Visible on a multiclass d12+d6 pool. A picker if anyone asks — 2024
        recovers all and is unaffected.
- [~] **SCOPED-BONUS · a bonus that applies to ONE thing, not everything.** The GRAMMAR is BUILT and
  is the settled shape: the scope lives in the TARGET namespace — `flat_bonus:damage.melee+2`,
  `damage.<weapon_id>`, `damage.<spell_id>` — so it costs no token segment (the 4th stays reserved
  for a bonus TYPE, `docs/internals/compatibility.md` §4) and keeps the weapon vocabulary out of L1.
  A weapon's scopes are its tags plus its own id, a cast's is the spell's id, and a roll naming no
  scope picks up none of them. `flat_bonus:attack:<category>` (Archery) normalizes into the same
  field, so there is one shape downstream. What is left is the two CONSUMERS:
  - [x] **Rage's damage, RAW** — done as RAGE-SCOPE above: 2014 `damage.melee,str`, 2024
        `damage.str`, and the two grammar pieces it needed (an attack carries the ability it
        resolved from; a scope may be a comma-separated list).
  - [ ] **Magic Weapon, and Agonizing Blast.** Neither blocks 0.7.0, and Agonizing Blast is NOT
        the one content row it was billed as: the packs carry a single `warlock_eldritch_invocations`
        row and no row per invocation, in either edition, so there is nothing to hang
        `damage.eldritch_blast+cha_mod` on. Two gaps, not one — the invocation rows (the 2014 source
        names Agonizing Blast exactly once, under a heading the converter does not emit) and the
        chooser that picks two of them, which is N2 shape 3.
        Magic Weapon buffs every weapon because the cast
        spawns an unscoped `flat_bonus:attack/damage+N` — RAW it names ONE weapon you touch, so the
        fix is not grammar any more, it is a cast-time CHOICE of which weapon (D16's shape).
        Agonizing Blast needs only the content row that says `damage.eldritch_blast+cha_mod`.
- **A17 ritual/pact residual** — pact-slot pips + upcast picker SHIPPED (see UBUG-6). Residual is only
  the pure-warlock slot-gating nuance + ritual-source (`L13` in the hazards above). Minor.
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
  **`two_weapon_fighting`** stays text — `computeAttacks` adds the ability mod to every weapon's
  damage, so the off-hand penalty the style REMOVES was never modelled and there is nothing to
  encode; **2014 `grappler`** stays text — it is relational ("advantage against a creature grappled
  by you") and the app has no target model.
- [ ] **COMPANION · no data model exists for a bound creature** — a familiar, a steed, a beast
  companion, a summon. Not a missing panel: there is nothing in the character schema for a creature
  that belongs to a character, so a Ranger's companion and a Wizard's familiar are today entirely
  outside the app. Adjacent to N2b's Wild Shape (`play.form`), which replaces the character's own
  statblock rather than adding a second creature beside it — related shapes, different problems.
  **This one starts as RESEARCH, and the research owes four answers:** (1) where a companion lives on
  screen — its own sheet, or a panel on the owner's; (2) whose turn it acts on, which the editions
  disagree about (a 2024 Beast Master's companion spends the OWNER's action, a familiar spends
  nothing); (3) whether the owner's effects fold onto it at all; (4) where it sits in the character
  file. **One constraint is already fixed:** a companion's stats start from a `monster` row but are
  the player's to EDIT — every score, HP and attack stays writable, because a bound creature drifts
  from its statblock the moment a table plays it. So the model is an editable overlay over a monster
  ref, never a read-only pointer at one.
- [x] **UBUG-1 · Short rest heals via Hit Dice** — `1d<die> + CON`, min 1 HP, player picks how
  many. Long-rest HD recovery is edition-divergent (2014 half, 2024 all).
- [x] **UBUG-5 · Every resource change is announced** — spend and restore both toast.
- [x] **UBUG-6 · Casting spends a slot.** Lowest available leveled slot, blocked with a toast when
  none remain, in and out of combat; cantrips spend nothing and a RITUAL cast spends none (gated on
  the class's ritual-casting eligibility). Warlock pact slots are their own pool + pip strip.
- [x] **UPCAST · Structured spell-upcasting engine.** One
  `upcast` column on `spells.csv`, `kind:formula` tokens parsed by the existing effect grammar.
  **Locked decisions, kept because later work could undo them by accident:** (1) combining is a
  DELTA for structured kinds (`base+delta`, base is the single source) and ABSOLUTE for
  count/duration; `inf` only ever appears in `duration`, so `base+inf` cannot happen by construction.
  (2) `cantripDieMultiplier` (the 5/11/17 tier) is NOT folded into `upcast` — the cantrip tier is a
  uniform system rule keyed on character level, `upcast` is per-spell data keyed on slot; merging
  them would be a regression dressed as a dedup. (3) Upcast is NOT gated on the auto-calc toggle:
  that toggle gates effect-MODIFIER layers, not a spell's own mechanic. (4) Conjure* tables and
  meta-rules (Dispel Magic, Globe) stay prose `higher_level` — a permanent exclusion, not a gap.
  **Open tails that had no other home:**
  - [x] **UPCAST-AUTHORING (was N8) · the upcast cell is BUILT, not typed.** `UpcastBuilder` under the
        raw field in `EditContentForm`: pick what scales, how it scales, and the amount, and the token
        it will write is shown before it is added — seeing `damage:per_slot(1d6)` is what teaches the
        grammar the raw field still accepts. The composed token is read back through the LOADER's own
        parser, so the form cannot offer what the app would refuse. The raw field stays: a `step()`
        ladder, a typed sub-slot and a guard are all wider than the two shapes here, and prose
        `higher_level` is still the fallback for a spell whose scaling is not a formula at all.
  - [ ] **UPCAST-DURATION-TAIL · Geas/Dominate multi-day durations.** Expressible via `duration:step`, but
    low value in the rounds canon (30 days = 432000 rounds) — a curated follow-up, not a blocker.
- [x] **CONCENTRATION · timer + end-points.** The model — a ref plus a carrier effect — is
  `docs/internals/characters.md` ▸ Concentration is a REF, not a clock. The CON save on damage is a
  toast REMINDER, never an auto-drop. Duration canon is rounds.
- [x] **UBUG-8 · Resources are used like spells** — the name is a "use one" button, the pips stay
  for manual restore. Action economy is deliberately not wired here (resources carry no action-cost
  data); see UBUG-16 for where that landed.
- [x] **UBUG-13 · Level-up re-offered an ASI and double-applied it.** Root cause worth remembering:
  only the FLATTENED `abilityBoosts`/`feats` were persisted, never the per-slot mapping, so a
  restored slot could re-derive its boost a second time.
  The re-PICK half has the same root: the reconciliation subtracts what the SAVE's own picks granted
  (`EditContext.loaded`), never what the live ones grant — measured against the live picks, moving a
  saved ASI to another ability left the old one with nothing to cancel against.
- [x] **UBUG-14 · A long rest clears one level of Exhaustion.** SRD-verified; the 2024 text's "has
  also ingested some food and drink" applies unconditionally because rations are not modelled.
- [x] **UBUG-15 · Death is modelled, and there is a dead screen.** One typed `play.death: {cause}`
  (an OPEN cause enum, not a `dead` boolean) and ONE `die(cause)` seam every lethal rule lands on.
  The two SRD interpretations behind it live at that seam in code (`combat-view-model.svelte.ts`): instant death
  runs the 5.1 text in BOTH editions because 5.2.1 omits the chapter carrying it, and revive drops
  one exhaustion level in 2014 too, where RAW is silent, since reviving onto a lethal 6 would kill
  you again on the spot. The dead screen is deliberately **not dismissible by backdrop or Escape** —
  a roster link is the other way out, so a dead character cannot lock the player out.
- [x] **UBUG-16 · abilities cost their action or bonus action.** What a resource chip does with
  one spend option versus several is `docs/internals/actions.md` ▸ §2. `gain_action` raises the
  per-turn MAX (`play.turn.grantedActions`) rather than refunding a spent action — play-state on
  purpose, because `slotMax` only folds effect facts when auto-calc is on and a feature the player
  activated by hand must not silently do nothing.
## Builder and character
- [x] **Lineages & subraces** — Phase 1 DONE: `species_option` content type (linked `species_id`,
  `kind: subrace|lineage|legacy|ancestry`, `option_label`, effects) + 2014 converter emitting the 4
  SRD subraces (Hill Dwarf/High Elf/Lightfoot/Rock Gnome, each with its own ASI) + loader
  longest-filebase fix so `species_options_*` isn't mis-read as `species`. P2 DONE: builder 2nd
  picker (shown when the chosen species has options, per-edition label from `option_label`) +
  `build.speciesOption` gathered in derive (effects cascade like the species'). P3 DONE:
  every 2024 species that asks which branch you belong to now has its rows, and the converter reads
  the THREE SHAPES the SRD writes them in rather than flattening them: a 4-column table (Elf, Tiefling),
  a PAIRED table read across (Dragonborn's Dragon · Damage Type), and a `**Name.**` prose list (Gnome,
  Goliath). 24 rows.
  **The benefits are effects where the source states one.** A Draconic Ancestor resists the damage
  type its own table COLUMN names — the species' Damage Resistance trait says "you have Resistance to
  the damage type determined by your Draconic Ancestry", so the token is the source's own statement
  and the shape hands it over rather than mining a sentence this converter just wrote. Each Giant
  Ancestry benefit is `grant_resource:<id>:proficiency_bonus:long`, which is what its trait's lead-in
  says once for all six. The Gnomish Lineages stay prose: both grant cantrips and a prepared spell,
  and there is no token for either.
  **The count assert earned its keep** — Giant Ancestry has six options, not the eight the first pass
  guessed, and `assertCount` refused to write the file.
  **A live bug fell out of the re-run:** `effectsFromTraits` still emitted `resist_immune:`, the name
  retired in the `damage_sensitivity` rename. Nothing had re-run the converter since, so the next
  regeneration would have silently swapped three tiefling resistances for a token the engine no
  longer knows. Renamed at the source.
- [x] **Half-Elf +1/+1 choice** (5e) — data-driven, no class-name branching.
- [x] **Expertise** — DONE. `build.expertise[]`, derive exposes a `prof` **enum**
  (`none|half|proficient|expertise`, not two booleans), builder ×2 toggle on proficient skills,
  combat shows a ringed dot. (Strict cap by class-feature count still TODO.)
- [x] **Languages** — a `language` content type (16 SRD rows), granted by species/background.
- [~] **Level-up flow** — the sheet's "▲ Level up" control NAVIGATES to the builder in level-up
  mode (`?levelup=<slug>`), which hydrates the draft from the saved character; the sheet only decides
  whether to offer the control. The in-place "+1 and a toast telling you to open the builder" path it
  replaced is deleted, along with the popup nothing opened any more. **The prerequisite this item
  used to name — "needs the builder to hydrate from an existing character" — is BUILT.** What is
  actually left: the guided choices at the new level (ASI/feat, new spells, subclass at its level)
  are picked in the builder like any other build choice rather than being walked through, and adding
  a class while levelling goes through the builder too.
- [x] **Inventory/equipment at build** — an Inventory card on the build page.
## Effects vocabulary
- [x] **Custom-modifier UI** — DONE. Combat "Custom modifier" builder (grouped target · +/− ·
  amount) → `flat_bonus` token, applied live via the reactive sheet.
- [x] **The rest of the L1 vocab is mechanically applied** — see `docs/internals/effects.md`.
- [x] **Feat stat/skill bonuses** — engine folds feat `effects` already (derive-gather pushes feat
  rows). **Started (2026-08-02):** convert.mjs now PRESERVES authored feat `effects` (was wiped on
  re-run, like class_features); **Alert (2024)** encoded faithfully =
  `flat_bonus:initiative+proficiency_bonus` (real-content test). **The honest remainder is BLOCKED,
  not just unauthored** — most shipped SRD feats don't map onto the bounded vocab:
  - **Half-feat ability-CHOICE UI — DONE (2026-08-02):** `ability_choice` feat column (`str,dex`
    Grappler / `any` Epic Boons, converter-preserved), `slotFeatAbility[slotKey]` draft field, an
    ability picker under a slot that holds a half-feat (defaults to the first option), +1 folded into
    `abilityBoosts`. Epic Boons reach 30 for free — the derive already clamps ability scores at 30
    (A10), so no bespoke cap-override was needed (regular ASI is equally un-20-capped in this lenient
    model). Live-verified (Grappler L4 → STR/DEX picker). Grappler's grapple mechanics stay text.
  - **The vocabulary caught up with most of that list.** Weapon-type-conditional bonuses are
    SCOPED-BONUS (`archery` ships `flat_bonus:attack:ranged+2`), armour-gated ones are the ordinary L2
    guard (`defense` ships `armor_type != none ? flat_bonus:ac+1`), and once-per-turn damage rerolls
    are their own marker plus `min_die` (`savage_attacker` → `damage_reroll`,
    `great_weapon_fighting` → two `min_die:damage:<scope>:3`). All four are shipped rows.
  - **What is genuinely left is two OTHER items' work, not this one's:** Magic Initiate's spell grants
    are D16's last piece, and Skilled's tool half is TOOLS. Nothing about a feat's stat or skill bonus
    is open any more.
- [x] **Plugin sandbox** (QuickJS-WASM) — see `docs/internals/plugins.md`.
## Spellcasting
- [~] **Resource subsystem** — engine + tracker DONE. `grant_resource:<id>:<max>:<recharge>` parsed
  into resource pools (`collectResources`, data-driven / class-agnostic — rage, ki, sorcery points,
  item N/day are one shape); `sheet.resources`; combat "Resources" strip with click-to-spend pips +
  Short/Long **rest** buttons (recharge by type; long resets slots+HP, short returns pact slots).
  **Class resources are encoded** — the shipped rows carry `rage`, `focus` (2024's ki), `second_wind`,
  `action_surge`, `bardic_inspiration`, `persistent_rage` and `uncanny_metabolism`, each as a
  `grant_resource` on its own feature row with the count as an L2 `step(...)` over class level. Haste
  and Action Surge feed the action-economy pips through `flat_bonus:action` (the `effects_srd` Haste
  row does exactly that).
  Remaining: **`grant_slot:<level>`** — Mystic Arcanum puts an extra SLOT into the pools rather than a
  resource, and no token says that. One consumer, so it waits for a second.

- [x] **PLAYTEST-SHIELD · a wielded shield is worth +2 AC, and the sheet said 0.** `deriveAc`
  (`character/derive-stats.ts`) takes the shield's +2 from `character.play.shieldRaised` — a combat
  toggle — and its own comment says that flag is "the single source for it, not the inventory equipped
  flag". So equipping a shield in the builder changes no number, which is what the playtest reported
  and what RAW disagrees with: 5e has no "raise your shield" action, a shield you wield gives +2 while
  you wield it. The play toggle is not wrong to EXIST (a shield can be stowed mid-fight, and the app
  cannot know), but it should default from what is equipped rather than be the only source. Nothing in
  `docs/internals/` settled this, so it was an implementation shortcut and not a closed decision.
  **Done, by deleting the flag rather than defaulting it.** A shield in hand IS inventory state, so
  `play.shieldRaised` is gone and `deriveAc` reads the equipped shield — at the AC its own row
  declares, which makes a +1 shield worth 3 and a row with no `ac` tag worth nothing, the same rule
  armour already followed. The Combat toolbar's Shield toggle is now that row's equip button under
  another name, and it is absent for a character carrying no shield, where it used to offer a phantom
  +2. Old saves keep parsing: zod strips the dropped key.

- [ ] **PLAYTEST-SPECIES-GRANTS · a species can give an ability boost and nothing else.**
  `species.boost_choice` already encodes "+N to M abilities of your choice" (`schemas.ts`, 5e
  Half-Elf). Two things beside it have no column and no token: a species that grants a **feat** — and
  the feat must be a CHOICE where more than one is legal, not a fixed one — and a species that grants
  a **skill proficiency of the player's choice** (feats have `skill_choices`; species do not). Until
  both exist, a whole shape of species is unauthorable even as someone's own homebrew.
  **We do not write the rows.** The species that makes this famous is PHB, in no SRD, and there is no
  CC-BY source for it — so this item is the VOCABULARY only, and whoever wants that species writes it
  in their own pack (`AGENTS.md` ▸ Inventing game data).
  **An optional rule is a CHOICE at the point of the trait, not a settings shelf.** Settled with the
  maintainer: a variant trait is an ordinary content row that declares which trait it stands in for,
  and the builder offers the two side by side where that trait is granted — the usual one and the
  homebrew/variant. No global toggle, nothing to enable before building, and a pack someone installs
  brings its variants with it.

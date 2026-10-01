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

- [ ] **N2 · Class-feature engine ("features as data").** The three shapes above, in the order
  1→3→2. Wild Shape carved out as N2b: it is a stat-block REPLACEMENT, not one of the shapes.
  Superiority dice: extend the grammar —
  `grant_resource:superiority-dice:4:d8:short` (die BEFORE recharge —
  "what the resource is, then when it refills"; ResourceDef + `die`). The die segment is
  optional and shape-distinguishable (`d\d+` vs `short|long|other`), so existing 3-segment
  tokens (`grant_resource:rage:2:long`) keep parsing unchanged. Spending rolls the die into
  attacks via the existing `bonusDice` path. Extra Attack is built (`../internals/effects.md` ▸
  Targets). The fold ALREADY gathers feature tokens (`derive-gather` ▸ `considerFeature` pushes each qualifying row at the `feature` layer), so a passive token on a
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
  `focus`, `persistent_rage`, `uncanny_metabolism`. **These rows come from a producer sibling**
  (`docs/internals/content.md` ▸ "Where the shipped data comes from") — a mechanic stated in SRD prose
  is still game data, and hand-authoring it from memory is the failure that passes every gate.
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

- [ ] **DAMAGE-TYPE-UI · taking damage names a type, and says what the defence does before the
  press, but no more than that.** `damageTypeOptions` offers the types this character has any
  defence for, `applyDamageSensitivity` halves, doubles or zeroes accordingly, and
  `HitPoints.damagePreview` shows the result under the picker ("Resistant: 13 → 6") while the amount
  is still being typed. What is left:
  - **Nothing records damage TAKEN.** The roll journal holds rolls; a Damage press changes hit points
    and writes no entry anywhere, so there is no log that could say what the damage was. Offering
    every type in the picker buys nothing until such a record exists — a type with no defence
    resolves exactly as untyped — so it waits for the record rather than coming first.
  - **One press is one type.** A hit that deals two types (a flame tongue's slashing + fire against a
    creature resistant to one of them) has no form, and that is the case a tracker exists for.
  A play-tracker SUGGESTS and never auto-applies, so the shape is a pre-filled answer the player
  confirms, not a computed total applied for them.

- [ ] **EXCEPT-DAMAGE · "resistance to all damage except X" has no form.** `damage_sensitivity`
  names ONE type or `all`; the exclusion in between is unsayable, so 2024 Superior Defense (all
  damage except Force) degrades to a note. The cheap shape is a subtractive relation
  (`damage_sensitivity:resist:all` + `damage_sensitivity:none:force`) rather than a set expression
  in the type slot, which would put a grammar inside a slot that is deliberately free-form. Not worth
  building until a second case appears — record it here so the third one does not re-open the design.
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

- [ ] **FEATURE-PASSIVES · the shape-1 features, named.** N2 says shape 1 is a passive token; this
  is WHICH rows, found by matching each shipped feature's own SRD text against the phrases that
  declare a mechanic ("you have advantage on", "your speed increases", "your AC equals", "immune to",
  "score a critical hit on"). Every row writable against the targets that exist carries its token;
  what is left is grouped by what it waits on:

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
    change — and `pact_boon`, a choice of three. The same wait holds every proficiency that is a
    CHOICE: 2024 Divine Order and Primal Order, College of Lore, the 2024 elf's one-of-three Keen
    Senses.
  - **Not shape 1 at all.** 2024 `superior_defense` spends 3 Focus Points for a minute of
    resistance — an activated ability with a duration (shape 2, and EXCEPT-DAMAGE for what it
    resists). 2014 `ki_empowered_strikes` stays prose: "unarmed strikes count as magical" has no
    target and no enemy to test against. The Gnomish Lineages stay prose too — each grants cantrips
    and a prepared spell, and no token grants a spell.
  - **Qualified grants stay text**: Stonecunning's doubled bonus applies only to stonework-origin
    History checks, Elven Chain grants proficiency with ITSELF and not with medium armour, and the
    2024 Sun Blade's grant is conditional on already being proficient with longswords.

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

  **The forms exist and can attack** — `monsters_srd.csv` carries an `attacks` column in both
  editions, with 69 beasts at CR ≤ 1 in 2014 and 64 in 2024. Three CONTENT blockers are left:
  - No `wild_shape` row exists in either `resources_srd.csv`, and `druid_wild_shape` carries neither
    a `resource` nor an `effects` value — there is no pool to spend.
  - The 2024 uses-per-level ladder lives in the Druid Features table, which is shipped nowhere; two is
    the only number the content supports, and inventing the rest is the failure AGENTS.md names first.
    2014 needs no ladder (flat two until 20).
  - A grammar gap, smaller: `grant_resource:<id>:<max>:<recharge>` cannot say 2024's split recharge
    (one back on a short rest, all on a long) — the `{trigger, amount}` recharge model is where that
    lands.
  - [ ] **Wild Shape must be TRACKED before its event siblings work.** Evergreen Wild Shape (the
        `regain_on_initiative` auto sibling of Perfect Focus and Superior Inspiration) has no pool to
        restore, so it waits on the model above rather than on the mechanism, which is shipped.
- [ ] **PLG-TAILS · two things the plugin layer still owes its user.** A dedicated view for a
  character that depends on a plugin which is missing or not consented to — today it surfaces only as
  derive issues in content health — and portability: what a character carrying plugin tokens says on
  an install without the plugin, or with another version of it. The layer itself is
  `../internals/plugins.md`.
- [~] **SCOPED-BONUS · a bonus that applies to ONE thing, not everything.** The GRAMMAR is BUILT and
  is the settled shape: the scope lives in the TARGET namespace — `flat_bonus:damage.melee+2`,
  `damage.<weapon_id>`, `damage.<spell_id>` — so it costs no token segment (the 4th stays reserved
  for a bonus TYPE, `docs/internals/compatibility.md` §4) and keeps the weapon vocabulary out of L1.
  A weapon's scopes are its tags plus its own id, a cast's is the spell's id, and a roll naming no
  scope picks up none of them. `flat_bonus:attack:<category>` (Archery) normalizes into the same
  field, so there is one shape downstream. Rage's damage reads it in both editions; what is left is
  the other consumer:
  - [ ] **Agonizing Blast.** It is NOT the one content row it was billed as: the packs carry a
        single `warlock_eldritch_invocations` row and no row per invocation, in either edition, so
        there is nothing to hang `damage.eldritch_blast+cha_mod` on. Two gaps, not one — the
        invocation rows (the 2014 source names Agonizing Blast exactly once, under a heading the
        converter does not emit) and the chooser that picks two of them, which is N2 shape 3.
        Magic Weapon, the other consumer this line named, is built: the cast asks which weapon and
        scopes the bonus to that weapon's id, so two copies of one weapon both take it — an
        inventory entry has no identity of its own to scope to.
- **A17 ritual/pact residual** — two nuances the spellcasting model keeps expressible and the sheet
  does not yet enforce: a pure warlock's slot gating, and a ritual's SOURCE (a wizard rituals from the
  spellbook unprepared, a prepared caster only what is prepared — `../internals/rules-core.md` ▸
  Spellcasting). Minor.
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
## Builder and character
- [~] **Level-up flow** — the sheet's "▲ Level up" control NAVIGATES to the builder in level-up
  mode (`?levelup=<slug>`), which hydrates the draft from the saved character; the sheet only decides
  whether to offer the control. The in-place "+1 and a toast telling you to open the builder" path it
  replaced is deleted, along with the popup nothing opened any more. **The prerequisite this item
  used to name — "needs the builder to hydrate from an existing character" — is BUILT.** What is
  actually left: the guided choices at the new level (ASI/feat, new spells, subclass at its level)
  are picked in the builder like any other build choice rather than being walked through, and adding
  a class while levelling goes through the builder too.
- [ ] **XP-TRACKING · the spec's optional XP mode has a field and nothing else.** `plan.md` ▸
  Character lifecycle puts it in scope: a `levelingMode` (`milestone` | `xp`) toggle, level derived
  from the XP thresholds in `xp` mode. What exists is `build.xp`, optional in the schema and read by
  nothing. The thresholds are SRD data, and the 2014 pack carries them only by accident: the
  Character Advancement table sits inside `schoolofevocation_character_advancement`, a class-feature
  row the converter glued onto the Evocation school. A threshold row of its own is a producer-sibling
  fix, and 2024 ships none.
## Spellcasting
- [~] **Resource subsystem · an extra spell SLOT has no token.** Pools, their pips, the spend
  path and both rests are built (`../internals/effects.md` ▸ How a pool comes back). What is missing
  is `grant_slot:<level>`: Mystic Arcanum puts an extra SLOT into the pools rather than a resource,
  and no token says that. One consumer, so it waits for a second.

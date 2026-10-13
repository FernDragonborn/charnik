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
resource cost, applied tokens, duration, roll), and a **choice** (`choice_group` + `choose_n` columns; generalizes the builder's slotFeats
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
  passive → choice → action. Wild Shape carved out as N2b: it is a stat-block REPLACEMENT, not one of the shapes.
  Superiority dice: extend the grammar —
  `grant_resource:superiority-dice:4:d8:short` (die BEFORE recharge —
  "what the resource is, then when it refills"; ResourceDef + `die`). The die segment is
  optional and shape-distinguishable (`d\d+` vs `short|long|other`), so existing 3-segment
  tokens (`grant_resource:rage:2:long`) keep parsing unchanged. Spending rolls the die into
  attacks via the existing `bonusDice` path. Extra Attack is built (`../internals/effects.md` ▸
  Targets). The fold ALREADY gathers feature tokens (`derive-gather` ▸ `considerFeature` pushes each qualifying row at the `feature` layer), so a passive token on a
  class-feature row works the day it is written — FEATURE-PASSIVES is written against that. What is
  still owed here is the content-schema column bump for the action and choice kinds.
  **The measurement that sizes the choice kind, so it is not re-taken:** of the shipped class-feature rows
  in both editions, only a handful carry any effect token. So Fighting Style · Metamagic · Eldritch Invocations · Weapon Mastery · Pact Boon · Divine
  Order · Primal Order · Epic Boon have no column a picker could read, and a panel for them today
  would be a lie — they are blocked on the `choice_group` / `choose_n` columns, not on UI.
  Same for the pools the prose describes and no `grant_resource` creates: Lay on Hands, Channel
  Divinity, Font of Magic, Indomitable, Arcane Recovery, Mystic Arcanum, Natural Recovery, Stunning
  Strike. The Resources block discovers pools from the engine, so each appears the moment content
  encodes it; the ids that DO exist are `rage`, `bardic_inspiration`, `second_wind`, `action_surge`,
  `ki`, `focus`, `persistent_rage`, `uncanny_metabolism`, `wild_shape`, `wild_resurgence`. **These rows come from a producer sibling**
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

- [~] **DAMAGE-TYPE-UI · the hit-point block is redrawn: the hit, healing, and the face it wears at 0 hit points.**
  What ships: a Damage press records each part in the roll log — how much, of what type, and the
  defense that changed the number — a `+` beside the type picker adds a further part, the picker
  offers every damage type with the defended ones first, and a Heal press records what it restored
  (`../internals/characters.md` ▸ A tracker surfaces). The block is 157px tall at rest and grows
  when a second part, a concentration save or 0 hit points arrives.

  **The rules the redraw answers to.** Each was learned from a rendered variant that broke it, so a
  new variant is checked against all of them, not against the last remark:
  1. The block's height never jumps: nothing appears INSIDE it — no banner, no extra row.
  2. Room is scarce: no empty cell, no inflated button, no number said twice.
  3. Damage types and healing never stand in one block — a type beside a Heal reads as a kind of heal.
  4. Red is the damage press and nothing else.
  5. It is drawn for a sheet with no defense or one; more is a load test, and what does not fit goes
     to a menu.
  6. One hit is one type and one press.
  7. Healing costs no more steps than it does today, and the sheet holds ONE number field.
  8. The app's own drawn icons; `∅` marks immunity, `½` resistance, `×2` vulnerability.
  9. Height is spent before width.
  10. Temporary hit points do not blur with healing.
  11. The hit's type reaches the roll log: the control is never a bare multiplier.
  12. What a type would take from the typed amount is worth saying wherever it costs no room.

  **Settled.**
  - **A hit of several types is not composed in one press.** The `+` that adds a part goes, with
    `combat.hp.moreParts` and the paragraph "A hit is one event, however many types it deals" in
    `../internals/characters.md`. A flame tongue is two presses.
  - **A damage type on the sheet is its `DamageIcon` and its mark, never a word.** Its name, where
    the defense comes from and what it would take (`combat.hp.damagePreview.*` already says
    `Resistant: 12 → 6`) are the provenance popover's, on a resting pointer or focus.
  - **Healing and temporary hit points are one green control and one popover**: one number, Heal on
    Enter, Temp HP beside it, and the note the Temp HP menu already carries. The step count equals
    today's — press, type, Enter against press the field, type, press Heal.
  - **The hit is said as the dice tray says a damage line (W3).** One field holds the amount and
    then the type that owns it — amount, type, press, one pass left to right, as the table says
    "12 fire". The type is the tray's own pill with its chevron and opens the tray's two-column
    menu with the sheet's defended types leading, or is typed without leaving the field
    (`12 f ↵`). The line is one width whatever the sheet defends. The minus's width is reserved, so
    saying a number (`− 6`) does not move the line.
  - **The minus says a number only when a defense changed it** (`− 6`); at rest it is a bare minus.
  - **The block is one height in every state**, 117px against today's 157px.
  - **0 hit points is a face of its own, and it is an emergency that looks like one.** No current
    number — the label says `0 / 73` — no amount and no minus: a hit taken while down is a failure
    the player presses, two for a critical, so the "That hit was a critical" checkbox goes. Rescue
    pulls from the left and death from the right at the colors' full strength (`--color-good`,
    `--color-accent`), each side's ground advancing a third per save; a save is a glyph — wings
    under a halo for a success, the skull necrotic damage already wears for a failure — and the
    healing control stays as the way back up. Tints were tried and are too soft to say it.
  - **The wings are the two-feather drawing** in `design-preview/death-saves-motion.html`
    (`WING_PAIR`); the skull is `damageGlyph('necrotic')` unchanged.
  - **Motion lives on that face and nowhere else on the sheet**, and stands still under
    `prefers-reduced-motion`. At two failures the block is lit and the light drifts: it may shimmer,
    it never blinks.
  - **The field at 0 hit points is the whole block with the slanted grounds and the glyphs** (T6
    in the mock). The band, the bare field and the vessel are not built; the vessel stays in the
    mock.
  - **The concentration save a hit owes is said by the concentration chip, not by the block.**
    Nothing appears inside the block (rule 1); the chip in `Controls.svelte` already rolls the
    owed save, and it says the owed DC. It holds a QUEUE of them: two hits before a
    roll owe two saves, each at its own DC, and one press says "that was one hit" and merges them
    into one at the DC of their sum — the app cannot tell a flame tongue's two presses from two
    blows, and the rules differ. **A wrong number ships today**: a second Damage press REPLACES
    the owed save (`play-outcomes.ts`, `hp.pendingConcentrationSave = outcome.concentrationSave`),
    so 30 slashing then 10 fire owes DC 10.
  - **The third save ends it on one face, whatever motion led there.** The side that won takes
    the whole block, still moving as itself, and the block says what happened in a bold word:
    `Stabilized` on the rescue's own ground, `Dead` in white on a block gone black. Only the way
    in differs between motions. The healing control stays under `Stabilized` as the way back up
    (`_death-saves-verdict.png`). In Ukrainian the words are «Стабілізовано» and «Смерть».
  - **The `Dead` face replaces the death dialog.** `DeathScreen.svelte` goes: the block says it,
    and the sheet behind is no longer out of reach. What the dialog held moves to the face — the
    cause of death, and `Revived` as the way back, since healing does not raise the dead. The
    mock draws the healing control under `Dead`; the build draws `Revived`.
  - **Three successes are recorded in the play state**, so `Stabilized` is drawn from a fact
    rather than from a notice that has already gone.
  - **The player picks the motion, and every motion drawn ships beside a still face.** `Rays & Hellfire` plays until the player picks another; `No animation` is one press away. The choice is the character's, kept in `ui` with
    every other choice about how its sheet looks. Over it stands one setting of the app's own,
    **Reduce motion** — follow the system, on, or off — and while it is in force the block plays
    nothing whatever the character chose, and the choice is kept for when it is not. It governs
    every animation the app has, not this block alone: it is the same switch
    `prefers-reduced-motion` is, put in the player's hands. The list opens from a pencil: a tab on the block's left side, outside its frame,
    there only while the pointer or the focus is on the block — and always where there is no
    pointer to rest, since a touch screen has no other way to find it. The list never covers the
    block: it opens leftward past the tab, and while it is open the block shows its 0 hit points
    face playing what is picked (`_hp-pencil.png`). Inside by the label and a tab on the top edge
    were drawn and passed over.
  - **A narrow window gets a mock of its own before it is built.** It is the phone's layout as
    much as a narrow desktop's: icons and buttons in several rows, the elements changing place
    rather than shrinking. Two forms are drawn at 361px with every press 44px tall (`_hp-narrow.png`):
    **A** — one row under the bar, the hit's field, the minus, and healing as a bare plus, with
    the roll and healing as icons between the saves at 0 hit points; **B** — the field on a row
    of its own, then two halves that say what they do, and the same at 0 hit points. Neither is
    chosen, and in both the faces differ in height (A 157px on its feet and 129px at 0 hit
    points, B 209px and 181px, the end faces 140px), which rule 1 forbids and the chosen one
    must close.

  **Open, in the order it blocks the build.**
  1. **The 0 hit points face's motions.** The motion is liquid (a swell along the surface,
     drops pulled out and drawn back, fused by one filter) or chevrons marching toward the middle.
     The flat slanted ground has four motions of its own on the same page, each tightening with
     every failure and each looping `transform` and `opacity` only: **pressure** — the death side
     leans in, slips back and leans in again under a shadow that reaches across the middle;
     **waves** — the front's edge peels off toward the middle and fades; **burning edge** — the
     front a wavering blade of light that sheds sparks; **hatch** — stripes at the front's lean
     marching toward the middle. A fifth dresses each side as what it is: **rays and hellfire** —
     rescue as soft shafts of light breaking through cloud, each coming and going on its own
     pace; death as a dark ground whose flames rise with each failure and stay inside it. Each side's scene is laid out once across the whole block and the ground is a window onto it: a wider ground uncovers more shafts or more flames, and nothing stretches. Their cost is not measured.
     Each motion's tempo is the maintainer's eye on the running page, not a render's; which motion
     plays is the player's (Settled).
  2. **The motion is too expensive as prototyped, and the glow still flickers.** The prototype page
     holds one browser tab near 60% of a CPU with nine panels moving, while the app at rest costs
     nothing. What the prototype animates is what a compositor cannot carry: an SVG blur-and-threshold
     filter over each liquid body, `mask-position`, a `drop-shadow` on the chevrons, and `box-shadow`
     for the glow. The build animates `transform` and `opacity` only — the glow as two layers drawn
     once and cross-faded, which is also the likely end of its flicker — runs nothing while the face
     is off screen, and is measured before it is called done. The glow's drift is 30% slower than
     the prototype's 5.5s.
     **The animations are not the whole cost, and the rest is unexplained.** With every animation
     taken off the prototype page, the maintainer still measures about 25% of a CPU from it at
     rest. Nothing on that page should repaint while nothing moves, so what does is the first thing
     to find — the fused filter, the masks and `container-type` on the bubbles are the suspects —
     before any of it is carried into the app.
     **The liquid is by far the dearer of the two.** Measured apart by the maintainer, six moving
     liquid sides and six moving chevron sides differ by about 35% of a CPU; the chevrons are not
     cheap either, only much less so. Every motion ships, so every one is measured; one that stays dear ships marked as such in the pencil's list.
  3. **The halo's height** on the wings: the opening inside it is 2.1px or 3px at working size.

  **The build, and what the prototypes do that it must not.** The mocks are the look; they are
  not the implementation.
  - **Where it lands.** `HpPanel.svelte` is the block. The 0 hit points face is a component of its
    own beside it, and each motion is one more, chosen by an open enum — never a boolean, and
    `No animation` is a member of it, not its absence.
  - **The hit's line reuses the tray's parts.** The type pill, its chevron and the two-column type
    menu are `RollerLine.svelte`'s; they are lifted into shared components both use, not copied.
    The types and their matching across locales come from `dice/roller-vocabulary.ts`.
  - **A ground is a window, moved by `transform`.** The prototype sizes a ground with `width` and
    cuts its lean with `clip-path`; neither can be carried by the compositor. The build moves a
    full-width slab with `translateX` and leans it with `skewX`, under the block's own clip. Every
    motion's scene is laid out once behind it in pixels from the block's edge, and only as much of
    it as the block is wide is rendered.
  - **What loops is `transform` and `opacity`, nothing else** — no SVG filter, no animated mask,
    no animated `box-shadow`. A loop stops when the face is not on screen and when the block has
    gone black. Each motion's CPU is measured on the real app before that motion is called done.
  - **`Dead` on black needs a ground and a text token** in both themes; the prototype's are
    literals.
  - **`Stabilized` needs the play state to say so.** Three successes reset the track and post a
    notice in `hit-points.ts` today and leave nothing behind; the schema gains the fact, with its
    migration, and whatever ends it — healing, damage, a rest — clears it.
  - **Removing `DeathScreen.svelte` takes its two ways out with it**: `combat.revive` moves to the
    `Dead` face, and the roster link is the navigation's again once nothing covers it.
  - **Reduce motion is an open enum on the app's settings** (`system`, `on`, `off`) and one
    attribute on the root that every reduced-motion rule answers to beside the media query, so
    the app has one switch and not two. The pencil's list says so when it is in force, since a
    choice that visibly does nothing reads as broken.
  - **The pencil stands outside the frame**, so the block gains a wrapper that does not clip it.
    It follows the pointer and the focus, and is always there under `(hover: none)`.
  - **The surfaces.** Both systems; right-to-left, where rescue and death trade sides and every
    lean mirrors; both themes and a user's own; the narrow window; the keyboard path through the
    hit's line, the pencil's list and the saves, driven in Playwright. `shot.mjs` gains the states
    — on its feet, each count of saves, each end face — with the loops held still for the frame.

  **Kept as mocks, not built and not rejected:** **W2** — the defended types as glyph chips, the
  rest behind a menu; **W2z** — the type and a factor `∅ ½ 1 ×2` as one joined control, where a
  said type lights its factor and the player may overrule it; each drawn type first and amount
  first (`_damage-type-order.png`).

  **Rejected, so they are not drawn again:** a bare `∅ ½ 1 ×2` with no type (unspecific, rule 11);
  a switch between that and the types (two interfaces, and it breaks in Ukrainian); a type's name
  in its chip; a minus per type row; a second number field for healing; a factor with the sheet's
  glyphs drawn under it; W2z's type and factor split around the amount; the saves as a soft tint; a heartbeat on the glow.

  **The mocks**, built from the app's own glyphs and catalogs: `design-preview/damage-type-under-temp.html`
  (W2, W2z, W3, the two orders, the pencil, the narrow window, the 0 hit points faces, the wings) and `design-preview/death-saves-motion.html` (the
  motion, live — the saves are pressable). Renders: `_damage-type-w2.png`, `_damage-type-w2z.png`,
  `_damage-type-w3.png`, `_damage-type-order.png`, `_hp-pencil.png`, `_hp-narrow.png`,
  `_damage-type-down.png`, `_damage-type-wings.png`, `_death-saves-motion.png`,
  `_death-saves-arrows.png`.

  **Found on the way:** the Ukrainian catalog abbreviates hit points two ways — the button is
  `Тимч. ОЗ` (`combat.hp.tempHp`), its menu's title and note say `ЗД` (`combat.menu.tempHpTitle`,
  `tempHpNote`).

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

  **Sized, by reading rather than recalling.** SRD 5.1 prints fourteen style options under three
  class features — six for the Fighter, four each for the Paladin and the Ranger, six distinct
  styles between them — and they are options OF a feature, not feats: 2014's feats are an optional
  rule, and a style offered in an ASI slot would be a rule that edition does not have. So the home
  is an option row with a parent, the shape `species_option` already is, plus a count to pick; that
  shape is 65 references across 21 files today, which is the honest size of a second one, and a new
  content type is not a backwards-compatible change (`../internals/content.md`). It is N2's choice kind
  and is built once, for Metamagic and the Invocations with it.
  **Until then a 2014 player says a style with an effect of their own**: a homebrew effect row
  carrying `extra_attack:light:modifier` (Two-Weapon Fighting) or `reroll:damage:two_handed,melee:2`
  folds like any other, and `mastery_content.test.ts` pins the first.

- [ ] **FIGHTING-STYLE-SLOT · a 2024 class feature that grants a feat opens no slot for it.** Feat
  slots come from three places — a class's `asi_levels`, a species' `feat_choice`, a background's
  origin feat — and none of them is a class FEATURE. So a 2024 Fighter 1 reads "you gain a Fighting
  Style feat of your choice" and has nowhere to choose it: the four Fighting Style feats ship with
  their tokens, and the first slot that offers them is level 4, where taking one costs the Ability
  Score Improvement. The same holds for the Champion's second one (level 7), the Paladin's and the
  Ranger's (level 2).
  **The smallest model** is the column the species already has: `feat_choice` on the class-feature
  row, read by `FeatSlots` into one more slot whose menu is that list. It is deliberately NOT
  built without a sign-off, because it answers for 2024 the question N2's choice kind asks for both
  editions, and two answers to "a feature offers a choice" is the thing to avoid. The Paladin's and
  Ranger's alternative ("instead of choosing one of those feats, you can choose the option below")
  is not a feat and needs the choice kind either way.

- [ ] **FEATURE-PASSIVES · the passive features, named.** N2 says the passive kind is a token; this
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
  - **A choice, so it waits on `choose_n`** (N2's choice kind): `fiendish_resilience` and 2024
    `draconic_sorcery_elemental_affinity` — resistance to a damage type the player picks and can
    change — and `pact_boon`, a choice of three. The same wait holds every proficiency that is a
    CHOICE: 2024 Divine Order and Primal Order, College of Lore, the 2024 elf's one-of-three Keen
    Senses.
  - **Not the passive kind at all.** 2024 `superior_defense` spends 3 Focus Points for a minute of
    resistance — an activated ability with a duration (the action kind, and EXCEPT-DAMAGE for what it
    resists). 2014 `ki_empowered_strikes` stays prose: "unarmed strikes count as magical" has no
    target and no enemy to test against. The Gnomish Lineages stay prose too — each grants cantrips
    and a prepared spell, and no token grants a spell.
  - **Qualified grants stay text**: Stonecunning's doubled bonus applies only to stonework-origin
    History checks, Elven Chain grants proficiency with ITSELF and not with medium armour, and the
    2024 Sun Blade's grant is conditional on already being proficient with longswords.

- [~] **N2b · Wild Shape. A druid assumes a form in both editions; the tail is what the form's rules say beyond the body.**
  The pool, the eligible stat blocks, whose hit points are counted, the form's clock, its attacks and
  the casting block ship, each stated by the feature's own `form` tokens
  (`../internals/effects.md` ▸ A form) and proven against both packs. The per-edition spec is
  [`../research/wild-shape.md`](../research/wild-shape.md). What is left, in the order it is worth doing:
  1. **Two of the things a 2024 use buys.** Wild Companion, Land's Aid, Nature's Sanctuary and the
     use-for-a-slot half of Wild Resurgence ship as options (`../internals/actions.md` ▸ §2). What
     is left trades in the other direction or in bulk, and both are under Spellcasting below:
     Wild Resurgence's first half spends a spell SLOT for a use, and Nature Magician turns several
     uses into one slot.
  2. **Primal Strike** (2024 Elemental Fury) is one of TWO options the feature offers, so it waits
     on N2's choice kind like every other choice. What it is once chosen is sayable: "once on each of
     your turns when you hit … you can cause the target to take an extra 1d8" is a granted roll
     limited to a turn, the shape Sneak Attack has, and it needs no scope for a form's attacks.
  3. **What a 2024 form leaves of the SPECIES.** SRD 5.2.1 replaces "your game statistics" and
     lists what is retained — "creature type; Hit Points; Hit Point Dice; Intelligence, Wisdom, and
     Charisma scores; class features; languages; and feats" — and a species trait is not on the
     list, so RAW an elf's Darkvision and a dwarf's poison resistance are gone in the form while a
     feat's Blindsight stays. Nothing takes them away today. It is every species trait and not only
     the senses, it turns on where a token CAME from rather than on what it targets, and it is a
     reading many tables do not play — so it wants both offered, not one picked. (The 2014 sentence
     about special senses is built: `form:wild_shape:only_senses`.)
  4. **Equipment.** Both editions let each item fall, merge or be worn, and only worn equipment
     keeps working. Nothing is modelled: a worn item's bonus still folds, and the form's SET of
     Armor Class is what stands over an armor's.
  5. **Swapping a known form on a Long Rest** is an edit in the builder, like every other choice
     made ahead of time; the rest itself offers nothing.
  6. **2024 "use your Proficiency Bonus"** for the creature's own proficiencies is read as the stat
     block's listed modifier standing as a floor — the same number in every shipped beast, and RAI
     where a homebrew stat block lists a proficiency its modifier does not show.
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
  - [ ] **Agonizing Blast.** It is NOT the one content row it was billed as: the packs carry a
        single `warlock_eldritch_invocations` row and no row per invocation, in either edition, so
        there is nothing to hang `damage.eldritch_blast+cha_mod` on. Two gaps, not one — the
        invocation rows (the 2014 source names Agonizing Blast exactly once, under a heading the
        converter does not emit) and the chooser that picks two of them, which is N2's choice kind.
        Magic Weapon, the other consumer this line named, is built: the cast asks which weapon and
        scopes the bonus to that weapon's id, so two copies of one weapon both take it — an
        inventory entry has no identity of its own to scope to.
- [ ] **A17 · a 2014 warlock's Pact of the Tome cannot ritual.** Ritual casting ships for every
  class and for a spell a feat teaches: `ritual_source` on the class, subclass or feat row, both
  packs' 29 ritual tags, and the rule in `../internals/rules-core.md` ▸ Spellcasting. The one caster
  left is the Tome warlock, and **the boon is not where SRD 5.1 puts the rituals.** Pact of the
  Tome gives a Book of Shadows and three cantrips; what inscribes rituals in it is an INVOCATION,
  Book of Ancient Secrets ("Prerequisite: Pact of the Tome feature … You can now inscribe magical
  rituals in your Book of Shadows"). The boon's only ritual is the Chain's, and it is one spell
  ("You learn the find familiar spell and can cast it as a ritual"). So this is two choices and a
  link between them, not one row: the boon as a choice of three, the invocations as options —
  which the pack does not carry at all, the row names them and lists none — and an option that
  REQUIRES another. The shape is signed off with the item varieties it shares
  (`content.md` ▸ MAGIC-ITEM-VOCAB ▸ 1: `option_of`, `requires`, `ritual_source`). The invocation
  rows are typed from the SRD like any other (`content.md` ▸ SRD-TRANSCRIPTION), and the same rows
  are what SCOPED-BONUS's Agonizing Blast waits on.
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
  outside the app. Adjacent to N2b's Wild Shape (`play.form`), which replaces the character's own
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
- [~] **Resource subsystem · a slot can be gained; it cannot yet be the PRICE.** Pools, their pips,
  the spend path, both rests and a slot a feature gives (`gain_slot`, `../internals/rules-core.md` ▸
  Spellcasting) are built. What is left, in the order it is worth doing:
  1. **A spell slot as what an option costs.** Wild Resurgence: "if you have no uses of Wild Shape
     left, you can give yourself one use by expending a spell slot"; Wild Companion takes "a spell
     slot or a use". An option's cost names a POOL, and which slot to give up is the player's
     choice, so this is the cast's slot picker reached from an option, plus a verb that gives ONE
     use back (`restore_resource` gives all). The window is sayable today:
     `resource.wild_shape==0` in `available`.
  2. **Nature Magician: several uses become one slot**, "each use contributing 2 spell levels".
     The cost is `x`, which the schema reads and no control lets a player pick — every option is
     activated with an amount of 1 — and the action would have to read that amount
     (`gain_slot:2*x`), while an action's formula is resolved at derive, before any amount exists.
  3. **Mystic Arcanum is a pool, not a slot** — both SRDs say "cast … once without expending a
     spell slot", which is the pool a cast already offers to pay from. What blocks it is not a
     token: the level of spell a warlock may learn reads the Pact Magic table, which stops at 5,
     so there is no way to choose the level 6 spell the arcanum is. Natural Recovery's free cast
     and the slot recovery of Arcane Recovery are the same two shapes: a pool that is sayable
     today, and slots a player already restores by their pips.

# Changelog

## 0.7.0

The release where the app stops speaking only English and stops guessing what you meant. Three big
things: **every screen reads in your language**, **the roller became a thing you can steer**, and
**the builder became a live sheet you edit rather than a form you fill**. Under all of it, a play
layer that now tracks money, recharges, events and the reasons behind each number.

### The app speaks your language — all of it

- **Every screen, panel, dialog and notice reads from the language catalog.** Not the chrome only:
  attack notes, a roll's name, damage types, the effects panel's mechanical tags, provenance
  popovers, rule blocks, content-health findings, the compendium's groupings and detail views, the
  homebrew form's errors, page titles, the empty states. Switching language changes them all, live.
- **A roll in the log is not frozen in the language it was rolled in.** A roll's name and its
  provenance travel as facts, so yesterday's log reads in whatever language you open it in today.
- **A language that reads right-to-left lays the app out right-to-left.** Panels, labels and
  spacing follow the direction of the text rather than being pinned to the left, so adding such a
  language is a translation job and not a redesign.

### The roller

- **A roll is one action, not two calls.** An attack arrives as its name, its d20 test, its damage
  parts and how many instances — so the to-hit and the damage stay one thing, keep their label, and
  a volley of beams stays one block of N rather than N unrelated lines, including after a reload.
- **A formula is a line of pills you can steer**, not a string you retype: advantage is a mode,
  each die and modifier remembers where it came from (a Bless d4 is distinguishable from a die you
  typed), a compound term splits into the terms a person wrote, and a note without a number stays a
  note instead of joining the sum.
- **The formula says what it could not read.** A homebrew weapon with a damage string the parser
  cannot finish now says so on the attack row and in the roll, instead of quietly rolling less.
- **An amendment is a fact.** Changing a roll's advantage after the fact records what it changed
  from, sticks across a reload, and disappears cleanly when you put it back.
- **Savage Attacker rerolls the weapon's dice** and not everything riding along with them, and a
  granted roll can be marked spent for this turn.

### The builder

- **It is a live sheet with an inspector, not a form.** Picking an option is the click — no
  confirm step — and the inspector says what a choice would do to your numbers before you take it.
  Double-click takes a row; Ctrl+Z takes it back.
- **An unfinished character waits for you.** Drafts persist and are parsed back off disk rather
  than assumed; trying a different class no longer costs you the one you had; a level-up applies a
  level instead of rewriting the character.
- **A blocked option is shown and explained** instead of quietly missing, switching edition says
  what it will cost you first, and the feat a background hands you asks its own questions.
- **A character can have a face.** Pick a portrait in the builder's header; it is downscaled on
  pick, stored beside the character as a file, and shown on the play sheet.


### Rules that were simply missing

- **A level-5 fighter, barbarian, monk, ranger or paladin attacks twice.** Extra Attack was not
  modelled at all, at the tier most games are played at. It raises the count rather than adding to
  it, so a multiclassed fighter 5 / barbarian 5 still attacks twice — which is the rule — and the
  2024 fighter's ladder to three at 11 and four at 20 comes along. The sheet and the builder now
  read the same number instead of computing it twice.
- **Rage damage is Strength's.** It used to pay out on anything you attacked with, including a
  crossbow, with a note asking you to remember the rule. Each edition now says its own sentence:
  in 2014 a melee attack made with Strength, in 2024 any attack made with Strength including an
  Unarmed Strike. A finesse weapon swung with Dexterity gets nothing, which is what the rule says.
- **Every 2014 caster showed 0 cantrips.** The per-level counts were not shipped at all, so a bard
  read zero cantrips and got the prepared-caster formula instead of its own Spells Known column — a
  2014 bard 1 said 0 where the book says 2 cantrips and 4 spells. All seven casters carry their own
  table now.
- **Magic items with charges track them.** Eyes of Charming, Pipes of Haunting, Gem of Seeing and
  Mace of Terror carry their pool, so charges spend, show as pips, and come back at dawn — 1d3 of
  them, or all of them, as each item says.
- **Your magic items change your numbers.** The +N weapons had none of their bonus: a Sun Blade,
  a Vorpal Sword, a Dragon Slayer or any of the staves rolled exactly like the mundane version. Each
  now raises its OWN to-hit and damage and no other weapon's, armour and shields carry their AC, and
  the Staff of Power pays out on all five stats its text names. 176 more rows across the two
  editions, taking the shipped total from 63 to 239. What an item's text says but the engine cannot express — a damage type your GM picks, a
  bonus set by the item's rarity, a helm that still has a ruby in it — is written on the item as a
  note instead of leaving the row blank.
- **A wand tracks its charges.** Every wand, most staves, several rings and the Trident of Fish
  Command say how many charges they hold and how many come back at dawn, so they spend as pips like
  any other resource. The two that never recharge say so instead of quietly refilling overnight.
- **The 2014 items have their descriptions back.** Eighty-nine magic items in the 5e pack shipped
  with a blank description — the Vorpal Sword, the Rod of Alertness, Dragon Scale Mail and eighty-six
  more — because the importer was throwing away the paragraph the description lives in. They read
  fully now, and that is what let their numbers be filled in at all.
- **An 11th-level rogue stops rolling under 10.** Reliable Talent did nothing at all — the feature
  said its rule and the die kept whatever it landed on. It applies where the rule says it does: on a
  check you add your proficiency bonus to, and not on one you are untrained in.
- **A monk gets faster, and by exactly what its own table says.** Unarmored Movement did nothing at
  all: every monk from level 2 to 20 walked at 30 feet, because the feature's sentence says "+10
  feet" and then points at the Monk table for the rest of the ladder. The whole ladder is in the row
  now — +10 at 2, +15 at 6, +20 at 10, +25 at 14, +30 at 18 — while you wear no armour and hold no
  shield, in both editions.
- **"To a maximum of 20" is a ceiling, not a clamp.** A cap now folds last, after every bonus from
  every source, because that is the order the sentence is written in: "increases by 2, to a maximum
  of 20" is the +2 and *then* the ceiling. So the Belt of Dwarvenkind applies its own rule instead of
  printing a note asking you to apply it — Constitution 14 becomes 16, 19 becomes 20, and 20 stays
  20.
- **A bard is a Jack of All Trades.** Half your proficiency bonus on every check you are not
  trained in — the tier the sheet has been able to draw since August with nothing able to grant it.
  A skill you already train keeps its full bonus, which is the rule.
- **A dragonborn is asked which dragon, and resists its damage.** The 2024 species that ask which
  branch you belong to all offer it now: ten draconic ancestries, six giant ancestries (each a pool
  of uses that comes back on a long rest), and the two gnomish lineages.
- **The features that grant a proficiency grant it.** A 14th-level monk is proficient with every
  saving throw, a 15th-level rogue with Wisdom saves (and Charisma too, in 2024), a Life Domain
  cleric with heavy armour — so plate stops blocking their spells. A dwarf is proficient with the
  battleaxe, handaxe, light hammer and warhammer whatever their class, a high elf with the four
  weapons their training names, and an elf's Keen Senses and a half-orc's Menacing put Perception and
  Intimidation on the sheet. Every one of these used to be a paragraph the app read past.
- **The Heroic Inspiration control is gone.** Spending it did one of two things the roller already
  does to any d20 — reroll it, or re-read it at advantage — so it was a second gesture for the same
  act, plus a flag to remember first. The rules it implements are still there; the extra button is
  not.

### Playing

- **A purse.** Copper through platinum, counted as money rather than as items in your pack.
  Coin weight is a toggle: leave it off and gold is weightless, turn it on and a big haul starts
  counting against what you can carry.
- **A resource says when it comes back and how much of it**, separately — so "one use back on a
  short rest, all of them on a long rest" is finally sayable, and so is a wand that regains
  1d6+1 charges at dawn. A pool that refills at dawn or dusk gets a button for it in the play bar.
- **Casting at a higher level shows the whole ladder first.** The ⇡ next to a spell says what each
  slot you could spend would actually do, before you commit one.
- **A hit at 0 HP costs a death save**, RAW, and a critical hit costs two.
- **An ability you cannot use yet says why, and when you can.** A conditional feature (Persistent
  Rage and its kind) explains its own gate instead of being absent.
- **A feature can react to an event.** A bounded set of play events can run any of the executor's
  verbs, which is how a Champion's Survivor heals you at the start of your turn instead of
  describing that it would.
- **A features panel**, so a character can read what they have; the action pips took Baldur's Gate
  3's shapes; every auto-calculated value explains itself on focus, not only on hover.
- **A bonus can name one thing.** "+2 to two-handed melee damage" is expressible, so a fighting
  style stops paying out on everything you own.

### Content and authoring

- **An item says what it is in one tags column**, which is what lets a magic item that is "any
  melee weapon" ask which weapon you meant — Flame Tongue and its twenty-odd siblings per edition
  now carry the base you chose, armour included.
- **A homebrew subclass can be given its features.** A class, a subclass, a species and a resource
  each keep their real content in a second table, and there was no way in: you could write the
  subclass and then never write a feature for it, because the form asked for an id nobody can guess.
  Those articles now list what belongs to them and offer to add one more, with the joins filled in.
- **The upcast cell is built, not typed**, a resource row can be authored at all, and a file can be
  told its content type from inside the app.
- **The 2014 rules text is whole.** The converter used to cut a class feature at the first
  sub-heading, which is exactly where most of them keep their table: Wild Shape lost its Beast
  Shapes table, Fighting Style listed no styles, Metamagic no options, and twelve rows shipped with
  an empty text cell. All of them read fully now.
- **Passive class features compute instead of reading well.** Unarmored Defense (both classes, with
  the barbarian's shield allowance and the monk's lack of one), Danger Sense, Fast Movement, Roving,
  Feral Instinct, Remarkable Athlete and both draconic scales now move your numbers.
- **Prose is rendered, never mined.** A spell's higher-levels line is parsed as the prose it is, and
  nothing in the app reads a value out of a paragraph.

### Caught by a fresh-eyes pass over this release

- **A magic weapon's bonus is that weapon's.** Filling in the `+1`, `+2` and `+3` weapons this
  release gave them a bonus, and the bonus escaped: it rode every attack you made — the mundane sword
  in your other hand, your bare fists — and landed on the magic weapon itself twice, once on the
  sheet and once more when you rolled. Merely attuning one was enough; a Defender you never drew was
  worth +3 to everything. What the same weapon grants its WIELDER — the Luck Blade's +1 to saves, the
  Staff of Power's +2 to AC — still applies as it should.
- **Healing someone up from 0 clears their death saves**, RAW, and takes the "was it a critical?"
  answer with it. Both used to survive being healed, so old failures were still on the pips the next
  time you went down — and a tick nobody spent on a hit could cost two failures on a later ordinary
  one, from a checkbox that is only on screen at 0 HP.

### Caught by the audit of this release

A second fresh-eyes read, this one subsystem by subsystem, with every finding reproduced before it
was believed. What it turned up, in the order it matters to you:

- **Deleting a character asks first.** The roster's ✕ took the sheet, the portrait, the roll log and
  every automatic backup on one unconfirmed click — the most expensive thing you own was the only
  destructive action in the app with no way out. Discarding an unfinished build asks too.
- **Your automatic snapshots are reachable.** Charnik has always kept a few copies of every character
  — two checkpoints while you play, one per launch — and nothing could read one back. Settings ▸ Data
  ▸ Snapshots lists them and puts one back, and refuses a copy that is itself damaged rather than
  writing it over a working sheet.
- **A portrait you picked and walked away from no longer follows you.** It used to show on the next
  character you opened and overwrite their own face on the next save.
- **A character built at a level can still choose a class.** Setting the level before picking the
  class locked the class picker out at 20, and flipping a level-20 character to the other edition did
  the same thing.
- **Old saves keep their languages.** The one field the id migration forgot, so a save from before it
  came back with its languages silently gone.
- **Unconscious imposes what Prone imposes.** It listed the condition and none of its mechanics.
- **The roller stops losing your place.** Taking a pill out left the caret one token short of the end,
  so the next thing you typed landed mid-formula and a `>10` floor attached to the wrong die; a
  finished formula with no trailing space could not be rolled with the mouse at all, however many
  times you clicked; damage made only of an effect's dice now gets its damage line; and a damage type
  cannot be dragged onto the d20 line, where it did nothing and said nothing.
- **The keyboard reaches the builder's pickers and the combat layout.** Opening a picker puts the
  caret in its search box and closing it hands the caret back to the card you opened — before, the
  pane was 89 Tab stops away. The panel handle is a real button and the arrow keys move a panel the
  way dragging does. Every full-screen dialog carries the language switch, including the five that
  ask something you cannot take back.
- **An edition is called what Settings calls it** — "D&D 5.5e", not `5.5e` — on the roster, the play
  sheet, the builder's switch and the homebrew form.
- **Unfinished edits survive being looked at.** Opening Translate used to delete the drafts the
  "these are being discarded" warning exists to name, one stray file in the drafts folder took the
  whole discard dialog down, and a pack whose source contained `*` could not be drafted at all on
  Windows.
- **Installing a pack cannot land on a folder you put there yourself**, and a CSV you added to a pack
  folder is preserved rather than removed when the pack updates.

### Rename

- **`resist_immune` is `damage_sensitivity`, and it always says which relation.** The old name
  listed two of its three relations, so writing a vulnerability was possible but invisible; the
  relation used to be optional and defaulted to resistance, which meant a one-segment typo silently
  became a resistance nobody wrote. It is now `damage_sensitivity:<resist|immune|vulnerable>:<type>`,
  and a missing relation is a visible inert note. **Homebrew written against the old spelling must be
  updated** — there is no alias.

## 0.6.2

A bugfix release, and the fix that names it: **your resource pools have names now.** Alongside it,
every message the app shows when something goes wrong was rewritten for the person who owns the
data rather than for the parser.

### Resources are named, not guessed

- **A pool is called what the rules call it.** Charnik used to title-case the internal id, which is
  plausible-looking and wrong exactly where it matters: the 2024 monk pool is called **Focus
  Points** (the id is `focus`), and the 2014 one **Ki Points**. Both now come from the shipped
  rules data, which also means they can be translated — a name the app invented never could be.
- **Homebrew can name its own pools.** A `resources` CSV maps a pool id to a name; a pool with no
  row still works exactly as before, so nothing is required of a pack that doesn't care.
- **One name everywhere.** The tracker, the action's cost chip and every toast used to format the
  id three different ways ("rage", "Rage", "rage_uses"); they now read the same name.
- **A misspelled resource is reported instead of vanishing.** An action that spends a pool nothing
  grants used to disappear from the sheet with no explanation anywhere. Content health now names
  the file, the row and the id it couldn't resolve, and suggests the one you probably meant.

### Messages you can act on

- **Every content and rules error was rewritten.** Each one now says what happened, what it means
  for your sheet, and what to change — with the technical detail kept underneath rather than in
  front. `duplicate source:id "spell:SRD 5.1:x"` became a sentence that names the file the surviving
  copy is in; a misspelled content type suggests the right one; a half-translated entry says which
  columns are still empty and where to fill them.
- **A blocked action says what you ran out of.** "Not enough Focus Points for Flurry of Blows —
  2 left · costs 3", rather than an internal id. Spell-slot blocks speak in table language ("No
  3rd-level spell slots left — cast it from a higher slot, or rest").
- **The homebrew form points at the field.** "Level — needs a number" instead of the validator's
  "Invalid input: expected number, received nan".
- **The "Rules update" chip opens the panel that has the update** instead of the top of Settings —
  and does something when you're already in Settings.

### Rolls

- **A flat modifier in the middle of a formula is counted.** `1d8+2+1d4` used to roll `1d8+1d4`,
  silently healing less. A bare `d8` with no count rolled nothing, and a dice-less number rolled 0.
- **Action Surge grants an action instead of refunding one.** Surging before you acted used to burn
  a use for nothing.
- **The roll log survives a reload intact.** Damage, the advantage pair and an upcast's provenance
  note used to be dropped on the way to disk, so a reloaded log was a poorer record than the one you
  had been looking at. Amending a roll's advantage now sticks, too.
- **The dice tray says which half of an attack it is building.** It builds the to-hit and shows the
  damage that rides along, read-only — so dice you add can no longer land silently on the d20. The
  editable version is still to come.

### Magic items

- **35 more shipped magic items change your numbers** (23 in the 2024 rules, 12 in 2014) —
  resistances, unqualified advantage, `+N` weapons, Frost Brand's rider, the Robe of the Archmagi's
  guarded AC. Every value was read off that edition's own text; where the rules can't be expressed
  yet, the item keeps its text rather than folding something approximate.

### Fixed

- Icons come from one icon set rather than being typed into translatable strings, so a translation
  can no longer break one; icon-only buttons have accessible labels.
- On the web build, renaming a folder could write a phantom entry that later reads as a real file.
- A draft file that can no longer be read is reported instead of silently disappearing.

## 0.6.1

*0.6.0 was never published — its tag name got permanently reserved on GitHub before the release
went out, so this identical build ships under the next number.*

The external-content release: rules data now lives in its own repository and reaches you as a
**content pack** — paste a URL, get updates, no app build in between. Alongside it: death and
dying are modelled properly, magic items finally change your numbers, and the roll card was
rebuilt around the swing rather than a run-on line of dice.

### Charnik is now MIT-licensed

- **The code moves from AGPL-3.0-or-later to [MIT](LICENSE).** We don't want to oblige anyone who
  reuses Charnik to publish their own code — sharing it back is welcome, not compulsory. Keep the
  copyright notice and that's the whole obligation. Releases up to 0.5.0 stay available under AGPL.
  Bundled SRD data is unaffected (CC-BY-4.0), and content you write stays yours.

### Content packs — content that updates itself

- **Install content from a URL.** **Settings ▸ Content ▸ Packs** takes a repository link, lists
  the packs it publishes, and installs the ones you pick. A pack is just a folder of CSVs — no
  manifest to write, nothing to register — so anything you drop into `content/` by hand is a pack
  too, and it loads with no configuration.
- **The shipped SRD is now one of those packs.** Rules corrections can ship on their own, without
  waiting for an app release. Updates are found by comparing file fingerprints, so checking costs
  one small request per repository and downloads nothing until you accept.
- **You see what an update would do before it happens.** The preview names the files *and the rows*
  that change, flags any entry a character of yours uses, and lists half-finished homebrew or
  translation drafts that would be left pointing at nothing. Nothing is written unless you accept —
  an update either applies whole or not at all, and the version it replaced is kept so a bad update
  can be rolled back.
- **Per-pack control.** Pin a pack to stop it updating, rename it, uninstall it (which takes its
  permissions with it), and see when an update carries executable plugin code rather than data only.
  Two different repositories can publish a pack with the same name — you're offered a free name and
  can edit it, rather than one quietly overwriting the other. A pack cannot take another pack's
  identity behind your back: an update that re-tags its source is refused before a single byte is
  written.
- **Delete the bundled rules and the app says so.** A missing SRD pack raises a prompt at launch
  with one button to put it back (from the bundle, no network needed) — or "I meant to, stop
  asking". Settings always offers the restore.
- **Plugins ride in packs.** A pack can carry its own plugin code, so an advanced homebrew set is
  one install instead of two, and still asks for your consent before anything runs.
- **The pack panel speaks Ukrainian**, written as Ukrainian rather than translated from the English.

### Playing your character

- **Death is real.** Three failed death saves (including the double failure from a natural 1), the
  overkill rule — damage past 0 equal to your hit-point maximum — and the bottom of the exhaustion
  ladder now actually kill the character, with a screen you can't click away. A long rest removes a
  level of exhaustion, which it never did.
- **Magic items change your numbers.** 28 shipped items across both editions carry their mechanics:
  Cloak/Ring of Protection, Stone of Good Luck, Amulet of Health, Headband of Intellect, Gauntlets
  of Ogre Power (which correctly never *lowers* a score you already have), Bracers of Defense (only
  with no armor or shield), Boots/Cloak of Elvenkind, Eyes of the Eagle, and more. The ones the
  effect vocabulary can't yet express stay as clearly-marked text instead of pretending.
- **Every resource chip runs its ability.** Tapping Second Wind now heals you and spends the Bonus
  Action; Action Surge hands you the action. Previously only Rage did the real thing and the rest
  quietly ticked a counter down.
- **Savage Attacker** (2024): after a weapon hit, one tap rerolls the damage dice and keeps the
  better roll — once per turn, offered on the roll card and in the log.
- **Uncanny Metabolism** (Monk 2024) spends its once-per-long-rest use, restores your Focus and
  heals, in one activation. **Perfect Focus** tops your Focus back up automatically when you roll
  initiative, and says so.
- **Bardic Inspiration is a tracked pool** (Charisma modifier, minimum one), and Font of Inspiration
  correctly upgrades it to recharge on a Short Rest; Superior Inspiration hands uses back at
  initiative.
- **Casting subclasses get their spell list.** An Eldritch Knight or Arcane Trickster — or any
  homebrew subclass that names one — now draws from the list its row points at, instead of having
  slots and a DC but nothing to cast.
- **The combat view was rearranged, so a few blocks have moved and look a little different.** The
  turn/time bar and the last roll now share one row instead of stacking with an empty band between
  them; each action-economy slot (action, bonus action, reaction) is a button you can click, not a
  label around a tiny pip; and the ability cards were restyled to match every other panel.

### Rolling dice

- **A roll card, not a line of text.** Each roll is a card with one row per attack — the dice, the
  to-hit, the damage, and the total in its own column so a stack of them lines up. Damage types read
  as icons (all thirteen), so a second type shares the line instead of starting a new one; a crit's
  doubled dice sit in one pill; colour is reserved for a natural 20 or a natural 1.
- **Retroactive advantage.** Tap the d20 on a roll that already landed and a second die joins it,
  keeping the better one — the way it happens at a table, where "that had advantage" arrives after
  the die is down. The same pill also switches a roll to disadvantage or back to neither, and offers
  a plain reroll.
- **The last-roll strip stays one line**, and a roll that's still waiting on a decision from you no
  longer dismisses itself.
- Unarmed Strike rolled **no damage at all** — flat damage without dice was never rolled. Fixed.

### Fixes & robustness

- **Editing a CSV on disk now actually reloads.** The file watcher had never once run on any
  desktop build (the permission was granted for a command that wasn't compiled in), so "changes are
  picked up in real time" was untrue until this release.
- **Level-up ASI/feat picks stick.** Choices made per slot are persisted, so levelling no longer
  applies them twice or loses them.
- **Content health tells you more.** A file declaring a schema newer than your build is reported
  rather than silently reinterpreted, the "changed since declared" dialog's button does what it
  says, and a file whose header you left blank is no longer rewritten.
- **Security.** Links inside content prose open in your OS browser, never in the app window; the
  dependency audit is clean again; and every dialog traps keyboard focus, not just some.
- Compendium lists sort by displayed name (installing a pack can no longer reorder your compendium);
  a missing spellcasting table reports *unknown* instead of borrowing the other edition's formula;
  an unreadable folder is no longer treated as an empty one.

## 0.5.0

The play-tracking release: the sheet now runs spellcasting at higher levels, concentration, rests,
and activated abilities for you — plus rage, feats that carry their mechanics, custom themes, and a
demo character to explore.

### Playing your character

- **Cast at a higher level, and see the difference.** Upcasting is built in: cast a spell from a
  bigger slot and its damage, healing, extra targets, area, or duration scale automatically (Fireball
  `+1d6`/slot, Magic Missile's darts, Aid's hit points, and so on) — both editions. A slot picker on
  each spell previews exactly what you gain before you commit, and the roll log records where the
  extra dice came from. Cantrips still scale on their own at levels 5/11/17.
- **Concentration is fully tracked.** Casting a concentration spell marks it, with a timer that
  counts down and drops the spell's buff when it ends. Take damage while concentrating and a slim
  banner appears under your HP with the save you owe — a suggested (editable) DC, one-click **Roll**
  that reads any effects that help (Bless, War Caster), and **Drop** if you fail — never forcing the
  roll or auto-dropping the spell. Dropping to 0 HP, becoming incapacitated, or **entering a Rage**
  ends concentration for you; re-casting the same spell refreshes rather than stacking.
- **Rage.** Entering a Rage is now a real state, not just a counter: click it (or the *Enter Rage*
  action) and you gain resistance to bludgeoning/piercing/slashing, advantage on Strength checks and
  saves, and the level-scaled bonus damage — for ten rounds, and you can't hold concentration while
  it's active. It won't stack if you tap it twice.
- **Abilities that actually do their thing.** Data-defined abilities now resolve when you use them,
  not just spend a pool. Second Wind heals `1d10 + level`, Action Surge hands you another action, and
  a Monk's Ki/Focus options each spend their resource *and* the right part of your turn,
  all-or-nothing, greying out when you can't afford it. Persistent Rage's "regain all uses when you
  roll Initiative" appears at the start of combat.
- **Rests that heal.** Spend Hit Dice on a short rest to roll back hit points; a long rest restores
  HP, resources, and Hit Dice (half your total in 2014, all of them in 2024) and ends concentration.
- **Warlock Pact Magic** is tracked as its own pip strip, alongside ordinary slots.
- **Structured multi-type damage.** A weapon or spell that deals more than one damage type (a
  flaming sword's `+1d6 fire`, ice knife's cold burst) rolls and shows each type separately, with the
  ability modifier landing only on the primary part.
- **A refreshed combat sheet.** The HP/exhaustion header, the resources block, and the effects panel
  were redesigned; passive senses mark advantage/disadvantage; damage resistances / immunities /
  vulnerabilities read as coloured pills; and effect chips show their resolved value.

### Building your character

- **Feats that carry their mechanics.** Alert (initiative), the Defense / Archery / Great Weapon
  Fighting fighting styles, Skilled (pick your skill proficiencies), and Epic Boons are wired up as
  data — including feats that grant an ability increase, where you pick which score in the builder.
  In 2024, your **Background grants its Origin Feat** automatically.
- **Expertise, capped correctly.** The number of skills you can double-up on comes from your class
  features (Rogue, Bard, 2024 Ranger…), and the skills panel shows each skill's tier — proficient,
  expertise, or half-proficiency.

### Making it yours

- **Custom colour themes.** A new **Settings ▸ Themes** page lets you author your own theme — every
  colour is a live control — saved to your data folder, with a few bundled presets to start from.
- **A demo character to explore.** First run seeds a showcase multiclass character (Warlock ×
  Barbarian) so the app isn't empty; delete it and it stays gone, or bring it back any time from
  **Settings ▸ Data ▸ Restore demo**.
- **A 2024 languages list** ships so language proficiencies resolve in the newer edition.

### Fixes & robustness

- **Security.** Path-traversal in file access is rejected, and the data-folder grant is owned by the
  app's trusted core rather than exposed to page scripts.
- Multiclass save proficiencies come only from your starting class, and the header lists every class;
  content-load failures are surfaced on every view instead of showing an empty screen; dialogs trap
  keyboard focus; over-large CSVs are guarded before parsing; and a picked entry stays selected even
  when its source is toggled off.
- **Easier bug reports.** A diagnostics log and a one-click "copy a bug-report bundle" capture the
  context needed to fix a problem.

## 0.4.0

- **Conditions actually do things now.** The 15 core conditions carry real mechanics, not just a
  description: Grappled and Restrained set your speed to 0 (and a later speed bonus can't sneak past
  it), Prone and Poisoned give the right disadvantage, Paralyzed and Stunned chain in Incapacitated
  and auto-fail your Strength/Dexterity saves, and so on. The parts a single character sheet can't
  model on its own — "attacks against you have advantage", auto-crits, sense-gated effects — show up
  as clearly-marked reference notes so nothing is silently dropped. Each condition also has an ⓘ with
  its full rules text, and you can apply one from a picker.
- **Wearing armor you're not trained in has consequences.** Weapon and armor proficiency is now real
  data on every class (both editions). Swing a weapon your class isn't proficient with and you lose
  the proficiency bonus on the to-hit (with a note explaining why); put on armor you lack proficiency
  with and the spellcasting panel tells you casting is blocked — the game's rule, surfaced instead of
  quietly ignored. Homebrew classes that don't list proficiencies keep working exactly as before.
- **Spend Ki, Focus, and other resources on what they actually do.** A Monk's Ki (2014) / Focus
  (2024) pool now offers its options — Flurry of Blows, Patient Defense, Step of the Wind — right in
  the actions list, each with a cost chip, greyed out when you can't afford it; tapping spends the
  points. Named pools also spend one-at-a-time like a spell slot, and the whole resource row is the
  click target.
- **Exhaustion is tracked for you.** Set your exhaustion level and the sheet applies the ladder
  automatically — the 2024 −2-per-level penalty to every d20 test and −5-per-level to speed, and the
  2014 cumulative ladder (disadvantage on ability checks, halved speed, halved max HP, speed 0…).
- **Features that grow with you — Rage, Sneak Attack, Martial Arts, Bardic Inspiration.** Rage shows
  its uses per level (including *Unlimited* at Barbarian 20 in the 2014 rules), and scaling dice like
  Sneak Attack (`Nd6`), the Martial Arts die, and the Bardic Inspiration die appear as rollable chips
  that already know the right size for your level — the Martial Arts die correctly starts a step lower
  in the 2014 rules than the 2024 ones.
- **Casting a spell spends a slot.** Casting now reserves the appropriate slot and blocks when you're
  out; ritual casting (for classes that have it) doesn't spend one. Slot pips and the spell list stay
  in sync.
- **Magic weapons hit harder — but only in the right hand.** A +1 weapon's bonus now folds into *that*
  weapon's attack and damage, not every attack you make.
- **Set your max HP by hand.** You can override maximum HP directly (for effects the engine doesn't
  model yet), and bonuses like *Aid* still stack on top of your manual number; current HP is pulled
  down safely when a temporary max expires.
- **Advanced homebrew, safely.** A new opt-in plugin system lets power users script effects the
  built-in formula language can't express, running in a locked-down sandbox you explicitly consent to,
  with a health panel that surfaces load errors and lets you retry.
- **Track your translation progress.** The compendium's translate view now tracks a per-language
  status for each entry (not started / started / machine / reviewed) so you can see what's left.
- **Linux builds.** Releases now include a Linux **AppImage** (self-updating, like the Windows build)
  and a **.deb** package, published alongside the Windows installer.
- **Fixes & polish.** Multiclass save proficiencies now come only from your starting class; a long
  rest always ends concentration; standard actions use the right edition's terms; a duplicate
  `source:id` no longer applies twice; typo'd effect targets get a "did you mean?" suggestion; effect
  info text renders its Markdown/links; armor with a Strength requirement drops your speed and
  stealth-disadvantage armor is applied; a zero modifier reads `0` not `+0`; and desktop updates
  re-seed the shipped SRD content so fixes to it reach you.

## 0.3.0

- **Effects that think for themselves.** Auto-calc now understands *conditional* and *computed*
  effects, not just flat bonuses. A feature can apply only when it should ("+2 AC while below half
  HP", "advantage on attacks while raging", "disadvantage while frightened"), and a value can be a
  formula that scales with you ("Ki equal to your monk level", "Sneak Attack dice = half your rogue
  level", the Martial Arts die that grows as you level). You write these in the effects field with a
  small, safe formula language — no code, no macros — and the sheet keeps every number explainable on
  hover, showing exactly which feature contributed what.
- **Ability scores flow through the same engine.** A Headband of Intellect, a belt that sets your
  Strength, a species bonus — these now fold into your score with a full breakdown on hover, and
  everything downstream (saves, spell DCs, carrying capacity) updates from the effective score.
- **Cantrips scale with level.** Fire Bolt and friends now show *and roll* their extra dice at
  levels 5, 11, and 17 automatically (both editions), instead of being stuck at their level-1 dice.
- **Roll-changing features actually change the roll.** Great Weapon Fighting rerolls low damage dice,
  Reliable Talent floors a check at 10 — the dice tray now applies these when you roll, and the log
  shows both faces (e.g. `d20(3→10)`) so you can see what happened.
- **Death saves.** At 0 HP the hit-points panel shows a death-save roller with success/failure pips.
  Rolling reads any effects that apply (Bless, exhaustion), and the natural 20 → up at 1 HP / natural
  1 → two failures / three successes → stable outcomes are handled for you (pips are also editable by
  hand).
- **More things effects can target.** Fly and swim speed, spell save DC and spell attack bonus are
  now effect targets, so magic items and features that grant them compute correctly.
- **Same buff twice no longer double-counts.** Two castings of Bless, or the same condition applied
  from two sources, now apply once (per the game's "Combining Game Effects" rule) instead of stacking.
- **Faster, more accurate sheets.** The whole effects pipeline was consolidated so every derived
  value is computed from one resolved list — fewer recalculations per change, and conditional effects,
  the roll log, and the action-economy tracker all read the same source of truth.

## 0.2.2

- **Automatic updates (desktop).** Charnik now checks for a new version on launch. When one is
  available, a gold **Update** button appears in the top bar; click it to download and install the
  new version and restart — no need to visit the releases page or reinstall by hand. Updates are
  cryptographically signed, so only genuine Charnik releases can be installed. The check is quiet and
  never blocks you: if you're offline or no update exists, nothing changes.
- **One-time cleanup for older installs.** Because the app's internal identifier changed, a build
  installed before this identifier switch won't be replaced in place — uninstall the old Charnik once
  by hand, then install this version. From here on, updates apply over the top automatically.

## 0.2.1

- **Editor mode.** From **Edit compendium → Editor**, edit every field of a selected entry in a
  two-panel view: the current article on the left, your changes on the right. Editing an entry that
  ships with the app saves a homebrew copy (the original is untouched and your version sorts above it);
  your own entries edit in place.
- **Drafts.** Unfinished translations and new/edited entries now auto-save and can be picked up later
  from **Edit compendium → Drafts**. If a saved draft points at an entry that no longer exists, a
  dialog helps you reassign it to another entry, keep it as new, or delete it. Drafts from an older
  version are flagged before they're discarded.
- **Delete or shelve your homebrew.** A homebrew entry's page has, at the bottom, **Delete entry**
  (with a confirmation) and **Move to drafts** (park a not-yet-ready entry back as a draft).
- **Content management in Settings.** A new Settings page with three tabs: **Content health**
  (problems found while loading your content), **Sources** (turn whole sources or individual files on
  and off — nothing is deleted), and **Collisions** (when the same entry exists in more than one
  source, keep them all or pick one).
- **Compendium language, independent of the app.** A language selector in the compendium shows content
  in any language you've translated to, regardless of the interface language. Your choice is remembered.
- **Better translating.** Pick the "from" and "to" languages freely from searchable dropdowns above each
  panel — full language names, a broad list (incl. minority languages like Crimean Tatar), and an "add a
  language" option to start a new one. The view remembers your settings, with a "back to compendium" button.
- **Clearer authoring form.** Adding or editing an entry now mirrors how the article looks; each field
  has an **(i)** with the format + an example (for the parser-driven damage and effects fields too), the
  spell "available to" is a checklist of spellcaster classes plus a free-add, and a warning appears if a
  spell level above 9 is entered.
- Dropdowns close when you click outside them; various layout fixes.
- **Smoother updates (desktop).** The Windows installer now updates an existing install in place
  instead of asking you to uninstall first. This release also changes the app's internal identifier
  (to `io.github.ferndragonborn.charnik`); if you had an earlier build installed, uninstall it once —
  future versions will update over the top.

## 0.2.0

- **Translate mode.** From the compendium, open **Edit compendium → Translate** to translate any
  entry side by side: the English original on the left, your language on the right. Edit the name,
  description, and prose fields (like a spell's material component); the stats stay read-only. A list
  marker shows what's done, in progress, or untranslated. Switch your language in the top-right.
- **Content now shows in your language.** Names and descriptions display in the active language
  wherever a translation exists, falling back to English otherwise.
- **Choose where new homebrew goes.** The "new entry" form lets you pick a file and shows an id
  example; it warns if you'd write into a file that ships with the app.

## 0.1.1

- First-run prompt to choose where your data folder lives (default: Documents/charnik), with an
  "open folder" button.
- Views refresh live after content changes — no full restart.
- Fixed an empty compendium after install and a couple of packaging issues.

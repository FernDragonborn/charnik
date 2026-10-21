# Changelog

## 0.9.0

- **The log says what happened in a turn, not only what was rolled.** Beside the rolls it now keeps
  a spell slot or a Rage spent and given back, an effect or a condition beginning and ending,
  concentration taken up and dropped, temporary hit points, Exhaustion and experience, every rest,
  and every level you take. What a toast told you — "you can't hold Concentration while raging",
  "no ammunition", "that action is already used" — stays in the log after the toast is gone. The
  lines one action left stand together under one bracket, and the strip under the sheet still shows
  the last thing you did.
- **An item the book prints once is asked about once, when you add it, and can be asked again.**
  A Ring of Resistance asks its damage type and a Belt of Giant Strength which belt it is right in
  the small popover a +1 sword already used, and the row is named for what it is — "Ring of
  Resistance (Fire)", "Belt of Hill Giant Strength". Pressing an item's name, on the play sheet or in
  the builder, asks again with your answers filled in, so a wrong pick is one change rather than a
  removal and a re-add. The builder names a +1 sword "Longsword +1" too, with its damage. A Wand of
  the War Mage +2 is called that, rather than "Wand of the War Mage, +1, +2, or +3 (+2)".
- **A 2014 fighter, paladin, ranger and champion choose a Fighting Style.** The six styles are
  options of the class feature now: Archery and Defense add to the sheet, Two-Weapon Fighting puts
  your modifier back on the second attack, and Great Weapon Fighting rerolls a 1 or 2 on a two-handed
  weapon's damage — a reroll, as 2014 prints it, not 2024's floor of 3. Dueling and Protection stay
  their text: one asks how you hold your weapon, the other is a reaction. A style taken once is not
  offered again, so a champion's second style is a different one.
- **A 2024 fighter chooses a Fighting Style at 1st level**, in a feat slot of its own; a paladin
  and a ranger at 2nd, with Blessed Warrior or Druidic Warrior offered in the same slot instead; a
  Champion a second style at 7th. The first slot that offered a style used to be 4th level, where it
  cost the Ability Score Improvement. A style taken is not offered again by a later level, and a
  character with no Fighting Style feature is no longer offered one at all.
- **A sorcerer chooses Metamagic**: eight options in 2014, ten in 2024, as many as the level
  allows, listed on the sheet as features.
- **A 2024 warlock chooses Eldritch Invocations**: one at 1st level and more down the Invocations
  column, from all 28 — the three Pacts among them. An invocation whose level or Pact you have not
  reached says which. Witch Sight puts Truesight on the sheet, and Gift of the Depths a Swim Speed
  and its one Water Breathing a day. The four marked Repeatable are taken once for now.
- **A 2014 warlock's Agonizing Blast adds the Charisma modifier** to Eldritch Blast's damage.
- **The tables in the shipped rules text are Markdown in the CSV**, so a table opened in a
  spreadsheet reads as rows rather than HTML. They show the same in the app. Four stay HTML for
  now, each a conversion defect of the SRD source.
- **The class pools the rules describe are on the sheet**, in both editions: Lay on Hands,
  Channel Divinity, Sorcery Points, Indomitable, Arcane Recovery and Natural Recovery, each counted
  from its own table and refilled on the rest its text names. Lay on Hands heals you by the number
  you answer, or spends for someone else; each Channel Divinity effect is its own button, Divine
  Spark a roll; Stunning Strike spends its point; Sorcery Points make a spell slot at the table's
  price.
- **A paladin's Aura of Protection adds to their own saving throws** from 6th level — the
  Charisma modifier, at least +1 — in both editions, and stops while the paladin is unconscious
  (2014) or Incapacitated (2024). The sheet did not count it at all.
- **A 2014 tiefling resists fire**, as Hellish Resistance says.
- **Dwarven Toughness adds its hit point per level**: the 2014 Hill Dwarf's and every 2024
  Dwarf's, which the sheet did not count.
- **A draconic sorcerer's Draconic Resilience counts from the level it is gained, in both
  editions.** 2014 gave its 13 + Dexterity Armor Class only from 6th level, under a feature named
  "Draconic Ancestry" that held three of them; it is Dragon Ancestor (with its table and the
  Draconic language), Draconic Resilience at 1st and Elemental Affinity at 6th now. Neither
  edition added the hit points: one per sorcerer level, from 1st in 2014 and 3rd in 2024.
- **A 2024 cleric chooses a Divine Order and Blessed Strikes, and a druid a Primal Order.**
  Protector and Warden bring their weapons and armour, Thaumaturge and Magician their bonus to two
  Intelligence skills, and Divine Strike is a roll on the sheet — 1d8, 2d8 from level 14. The extra
  cantrip each Order's second option teaches, and Potent Spellcasting, are listed as text.
- **The 2024 Figurine of Wondrous Power reads to the end**: the Giant Fly's stat block and the seven
  figurines after it — Golden Lions to Silver Raven — were missing.
- **A +1/+2/+3 item's article no longer trips over its rarity cells**, one per rung, which shared
  one identity in the list that draws them.

## 0.8.1

A handful of fixes found right after 0.8.0, and a little more say over the Actions panel.

- **One action, one toast.** Everything a single press says now arrives on one card — a roll and the
  notice it left, a failed concentration save and the roll that failed it — and the next thing said
  replaces it. Two toasts used to stack, and the older one stood collapsed behind the newer, unread
  unless you hovered it.
- **The concentration chip's ✕ and Skip are visible while you point at the chip.** They used to hang
  under it, exactly where the chip's own tooltip opened, and the tooltip covered them; they now stand
  above it. Skip also stays under the pointer while a long queue of owed saves gets shorter.
- **Enter does what the main button does.** In the owed save's DC field it rolls the save; in the XP
  and custom-modifier menus, the content editor, the metadata dialog, the upcast builder, the
  translation pane and a pack's folder name, it does the panel's own Add, Save, Install or Rename.
- **The Actions panel has presets** — All, Core, Melee, Stealth, Support and Class features — on its
  show/hide menu. Most characters reach for four of the twelve standard actions; a preset sets the
  same eyes you would set by hand, so you can see and undo what it did. Crying is still a free
  action.
- **A +1 sword is a Longsword +1.** Adding a "Weapon, +1, +2, or +3" — or armour, a shield,
  ammunition — asks which weapon and which bonus right there, in a small popover beside the ✓, and
  the inventory names it for what it is. Searching "longsword +1" or "shield +2" offers that very
  item at the top, already answered; before you type anything, the five +N items open the list.
  Taking a plain Longsword, chain mail, a shield or arrows asks the same: plain, or +1, +2, +3.
  Two magic weapons of the same kind are two rows now. The attack row and the Armor Class breakdown use the same name.
- **An item can be taken out of the inventory from the play sheet.** A small bin stands at the end of
  the row under the pointer, the way the drag grip stands at its start.
- **Unarmored Defense keeps your shield and your cloak.** A barbarian with a shield had the
  shield's +2 dropped, and a Cloak of Protection or a Ring of Protection added nothing beside
  Unarmored Defense, Mage Armor, Draconic Resilience or the Robe of the Archmagi. Those now work out
  your BASE Armor Class, as their text says, and every bonus adds on top. The content pack states
  them with a new word, `set_base` — as are a Wood Elf's Speed of 35 (a monk's Unarmored Movement now
  adds to it) and the swim speeds of the Ring of Swimming and the Cloak of the Manta Ray: a pack updated past this release on an older Charnik shows those
  features as text it does not understand rather than counting them, so update the app with it.
- **One suit of armour and one shield at a time.** Putting on a second takes the first off, so two
  shields' bonuses no longer both reach your Armor Class.
- **+1 ammunition is built on arrows and bolts**, not on any weapon in the game.
- **The Armor Class reads in the order it adds up, one part per thing you wear.** Unarmored Defense
  comes before the shield added to it; a Plate +3 is one part, +21, rather than "Armor" and a
  second "+3"; a Shield +2 is +4 rather than two shields; heavy armour no longer lists a DEX of 0;
  and a source called "Cloak of Protection" no longer runs into the one after it.
- **A collapsed panel is as deep below its title as above it.**
- **The rarity band in the item picker cannot be wedged any more.** A handle pushed past the other
  used to stay where it was dragged while the list did not change, and two handles parked at
  Artifact could not be moved off it.
- **A plugin's time limit is counted, not timed.** It was 5 ms on the clock, so an honest plugin
  could fail to a note whenever the computer was busy for a moment; the limit is now a count of
  steps that comes out the same on any machine. A plugin that is slow but keeps working is never
  switched off for it — turn it off in Settings if it stalls your sheet.
- **Updated the desktop shell to Tauri 2.12** with its plugins, alongside the routine dependency
  updates.

### Not in this release

- **A +N item's answer is fixed once given.** A wrong pick is a remove and re-add from the inventory;
  choosing again on the row comes in 0.9.0.
- **Wand of the War Mage keeps the book's name** with the bonus beside it, and a Ring of Resistance
  is still asked its damage type on the row after it is added rather than when it is.
- Everything 0.8.0 listed as not in it still is not.

## 0.8.0

The release the table wrote. Charnik went out to its first outside playtest, and most of what is
here is a player pointing at something: a number that did not move when they equipped a shield, a
roll card they could not read out loud, a panel holding rows in an order that was not theirs. Three
themes came back from it — **the sheet is yours to arrange**, **the rules that were quietly
missing**, and **a card that says which number you read** — and under them, an app that no longer
falls off a phone screen. Beside the playtest, two things of the app's own: magic items that were
sentences became numbers, and a security pass closed what a page inside the window could reach.

### The sheet is yours to arrange

- **Inventory, attacks, the standard actions and your features go in the order you want.** Drag a
  row by its grip, or move it with the arrow keys — the grip is keyboard-reachable everywhere. The
  order is saved per panel and survives a reload. What stays fixed is everything whose order IS its
  grouping: skills by ability, spells by level, features by source.
- **The Features panel hides, pins and filters.** An eye hides a feature you never read; a pin keeps
  one always in view, lifted into its own group. The filter presets — everything, only what your
  newest level granted, or one class's features — WRITE those same eyes rather than layering over
  them, so there is one answer to "is this shown" and undoing a preset is the same click as undoing
  a hand toggle. A pinned feature survives every preset.
- **Hiding an action is remembered, and so is a panel you folded away.** Both used to be forgotten
  on reload, while hiding a spell survived — one question with two answers.
- **On a touch screen, hold a row still and it is yours to move.** A row is a tap target first, so
  a finger that moves is scrolling; a ring fills while you hold, and the drag starts when it
  closes.
- **Auto-calculation is the Effects panel's power switch**, not a button in the bar you press every
  session. It sits on the head of the panel whose layers it turns off, quiet until you hover or tab
  to it, and stays visible and accented while it is OFF.

### Your own words

- **Any description can be rewritten in your own prose, and put back.** The content CSV is never
  touched — a rewrite is a layer over it, so a content update cannot orphan what you wrote. One
  pencil, floated at the top-right of the text it replaces; the editor opens at the height of the
  words already in it, and Escape leaves.
- **Two scopes, never both at once**: this character (so it travels in the character file) or the
  whole install. Promoting moves it, so there is never a second answer to what something says.
- **The command palette finds your words**, not just the shipped ones.
- **And the pencil reaches the Combat screen's Features panel** — where a feature is actually read,
  mid-session. That panel also renders its prose properly now: paragraphs, breaks and emphasis
  instead of one wall of text.
- **A translation survives the rules under it being updated, and says so when it cannot.** A pack
  update or a new app version keeps every cell you translated and marks the ones whose English
  moved. When an update removes an entry you had translated, the pack panel names it before you
  accept, and a new app version tells you at launch how many there were — in both cases the file
  as it was is copied into `content-backups` in your data folder first, and Settings ▸ Content
  updates lists those copies under the pack with a button that puts one back.

### Rules that were missing

- **Experience points, if your table counts them.** The line under your name says how you level —
  `Milestone`, or your XP against what the next level takes — and opens the place to switch between
  the two and add what you earned. Reaching the total marks the level as earned; you take it in the
  builder as always. Off by default, and a milestone table sees one quiet word.
- **A 2014 warlock chooses a Pact Boon and Eldritch Invocations.** The builder asks for them —
  one boon at 3rd level, two invocations at 2nd and more down the Invocations Known column — as
  chips that say what each does. An invocation whose level or boon you have not reached says
  which; Strict holds you to it and Free lets you take it anyway. What you chose is listed with
  your features, and Beguiling Influence's two skills are on the sheet. Not yet chosen in the
  app: 2014's Fighting Styles and Metamagic, and the 2024 invocations.
- **A 2024 druid chooses Elemental Fury at level 7.** Primal Strike is a roll on the sheet — an
  extra 1d8 once on each of your turns, 2d8 from level 15 — and Potent Spellcasting is listed with
  your features; its Wisdom modifier on a cantrip's damage is added by hand.
- **A 2014 druid's own Darkvision goes dark in a form that has none.** "You can't use any of your
  special senses, such as darkvision, unless your new form also has that sense" — a wolf does
  not, a giant badger does, and then the longer range stands. 2024 has no such sentence.
- **Wild Shape.** A druid had a paragraph where the feature should be. Now the uses are a pool —
  two in 2014, the Druid Features ladder in 2024 — and spending one asks which beast, from the ones
  your level allows (2014) or the forms you chose in the builder (2024). The sheet becomes the
  beast's body: its Strength, Dexterity, Constitution, Armor Class, speeds and attacks, with every
  number naming the creature when you ask it why — and a number the beast SETS reads `= 13`, not
  `+13`. Your mind stays yours. In 2014 the hit points
  shown are the beast's and yours wait behind them, with damage the form cannot hold carried over;
  in 2024 you keep your own and gain Temporary Hit Points equal to your druid level. The form has
  its clock, blocks casting until Beast Spells, and ends from its chip as a Bonus Action — or on its
  own when its rules say so: falling unconscious or dying in 2014, Incapacitated or dying in 2024.
- **A form wears what you say it wears.** Both editions leave equipment to you — it falls, merges
  or is worn — and only worn equipment keeps working. In a form each carried item says `Merged`
  until you press it to `Worn by form`, so a ring's bonus no longer rides along on a wolf unasked.
- **A 2024 form sets your species' traits aside**, as its text does: it keeps class features,
  languages and feats, and an elf's Darkvision is not on that list. Many tables keep them anyway,
  so a switch beside the form's chip says which your table plays.
- **What else a use of Wild Shape buys (2024).** Wild Companion, Land's Aid and Nature's Sanctuary
  are actions that spend a use, the last two only for a Circle of the Land druid. Wild Resurgence
  turns a use into a level 1 spell slot once per Long Rest — one more pip than your table gives,
  gone at the next Long Rest. Its other half gives a use back for a spell slot once none is left,
  and asks which slot when you have more than one level to give. An Archdruid's Nature Magician
  asks how many uses to convert and hands back one slot of twice that level, once per Long Rest.
- **Weapon mastery (2024).** Every 2024 weapon has carried its mastery property since the pack was
  written and nothing read it, because the property does nothing until a feature unlocks that kind
  of weapon for you. That feature is here: a capped chip pane off the Attacks card, offered only to
  the classes that grant it, and the attack row prints the mastery exactly when a pick unlocks it. A
  multiclass sums its grants. Graze and Topple print the number their rule works out, and the extra
  attack a property allows — Light's with a second Light weapon, Nick's free one, Cleave's — is a
  row of its own under the weapon, saying what it costs and what it rolls, once a turn.
- **A finesse weapon asks which ability swings it.** The rules give you the choice; the app took
  the bigger modifier and never said one existed — and a raging barbarian's rapier does more
  damage swung with Strength even when Dexterity is higher. The larger modifier is still the
  default; the answer is kept per kind of weapon.
- **Heavy weapons roll with the disadvantage their rule names** — under Strength 13 (or Dexterity
  13 for a ranged one) in 2024, for a Small creature in 2014 — and the attack row says so.
- **Every weapon property says what it does**, in both editions: hover or tab to the word on an
  attack row, or to the Properties and Mastery cells of the item's article, and the SRD's own text
  for Finesse, Heavy, Reach, Thrown and the rest is there.
- **Tool proficiencies, and the check that rides them.** A tool check is the ability check plus your
  proficiency bonus, built ON the folded ability check — so Guidance, exhaustion and every effect
  that touches ability checks reach it for free. 2024 rows name the ability; 5e rows do not, so the
  app asks rather than deciding. Backgrounds grant their tools now: a Criminal has Thieves' Tools
  without picking them.
- **A species can grant a skill choice and a feat.** Neither existed, so a whole shape of species
  was unauthorable even as somebody's own homebrew. The species' skill is counted separately from
  the class cap, which it would otherwise silently cost you.
- **A feat that teaches spells is a caster of its own.** Magic Initiate asked two questions nothing
  could take an answer to, so a character who took it learned nothing. A Fighter with Magic Initiate
  casts now, with the DC read off the ability the feat names — and the free casting the feat gives
  is a pool the cast can be paid from, offered beside the slot levels, instead of a pip you clicked
  down by hand.
- **Ritual casting.** A spell with the Ritual tag carries an `R`, and casting it as a ritual spends
  no slot and takes ten minutes longer. Who may is asked of the class the spell is cast as: a
  wizard rituals from the spellbook without preparing, a cleric or druid only what is prepared,
  and a feat's own spells by the feat's rule. Both packs mark the SRD's 29 ritual spells. A 2014
  warlock rituals through Book of Ancient Secrets — the warlock spells they know that carry the
  tag. The two ritual spells the Book itself holds from any class's list are not chosen in the app
  yet.
- **Known or prepared is the class's to say.** A 2014 bard's spells read as known, not prepared.
- **Skilled takes tools as well as skills**, against the one count of three, and a feat slot from a
  level offers origin feats too — which is the only way Skilled could be taken at all.
- **A Champion's 19 is a critical.** Improved and Superior Critical state the face that crits, in
  both editions, and the roller highlights it. Whether the hit crits is still your call.
- **Half proficiency rounds the way its feature says.** Jack of All Trades rounds down; 2014
  Remarkable Athlete rounds up, and now ships with its own name in the breakdown.
- **Immune to a condition is a fact on the sheet.** Aura of Courage, Mindless Rage and nine more
  rows said it only in their text; the Defences row shows it beside the damage immunities. It
  states the immunity and does not refuse the condition — the ruling is the table's.
- **Senses.** Darkvision, Blindsight, Tremorsense and Truesight are stated with their range; two
  sources give the greater one rather than adding up.
- **A climb speed equal to your Speed** follows your walking speed after everything that changes
  it, and the Speed tile names each mode.
- **Two castings of the same effect do not stack.** The more potent one applies, the most recent
  when they are equal — it used to be the first, and two castings at different strengths both
  counted.
- **The shield's +2 comes from the shield you are holding.** It used to come from a combat toggle
  beside the inventory, so equipping a shield in the builder changed no number at all — and a
  character carrying no shield could switch on a +2 out of nothing. A +1 shield is worth 3.
- **A long rest is eight hours, not forever.** It used to clear every timed effect there was, so a
  night's sleep ended a 24-hour Water Breathing and a 30-day Geas. Both rests now measure against
  their own length.
- **A 2014 long rest asks which Hit Dice come back.** The 2014 rules return half of them and let you
  choose; the app chose for you, largest first. A barbarian 3 / wizard 3 with all six spent now picks
  between its d12s and its d6s, with the old answer already filled in. Asked only when there is a
  choice — a single-class character, and every 2024 one, rests on one press as before.
- **A cast you could not make costs nothing.** Paying for a spell from a pool — "cast it once
  without a slot" — spent the use even when the turn had no action left to cast with. The cast is
  now paid for whole or not at all.
- **Damage that breaks a form carries over even when its stat block is no longer loaded.** With the
  pack that held the beast switched off, the excess used to vanish as the form ended.

### Magic items

- **A `+1, +2 or +3` item asks which one you found, and adds that number.** The SRD prints one
  entry for all three, so ten rows carried a note and changed nothing. Unanswered adds nothing —
  the app does not pick a +1 for you.
- **A Ring of Resistance, Armor of Resistance and Dragon Scale Mail ask which damage type yours
  is**, in both editions, and resist it.
- **2014 magic items carry their tables.** Items said "see the table" over nothing — Wand of
  Wonder, Bag of Beans, Bag of Tricks, both decks, both staffs and the rest; all thirty-four tables
  are in. Six items the 2014 pack never had at all are there too: Belt of Giant Strength, Figurine of
  Wondrous Power, Ioun Stone, Potion of Giant Strength, Potions of Healing and Spell Scroll.
- **An item the book prints once asks which one you found.** A Belt of Giant Strength is five
  belts, each setting Strength to its own score at its own rarity; the inventory row asks which,
  goes by that belt's name, and sets the score — in both editions. The same for an Ioun Stone's
  fourteen stones, a Figurine of Wondrous Power's nine, the Potions of Giant Strength and of
  Healing and a Spell Scroll's ten levels, where the answer names the item and its rarity.
  Unanswered grants nothing.
- **An item found at several rarities is listed under each of them.** A `+1, +2 or +3` weapon
  stood under Very Rare alone, and a Belt of Giant Strength under none; the compendium's rarity
  groups and filter, and the rarity band of the item pickers, show each wherever one of its
  rarities falls.
- **What an item does to your defences is on the play sheet.** "+2 AC against ranged attacks",
  "advantage on saves against spells", "attacks against you have disadvantage" — eleven shipped items
  say one of these, and they said it only in the builder, to whoever was assembling the character. The
  play sheet's Defences row carries them now, grouped by what they move: AC, Saves, and Against you.
- **Magic Weapon enchants the weapon you touch.** Casting it asks which weapon when you carry more
  than one, before anything is spent, and only that weapon's attack and damage go up. It used to
  raise nothing at all: a cast's own additions — Magic Weapon's bonus, the extra hit points an
  upcast Aid grants — were dropped on the way to the sheet. Both now land.

### Safer by default

- **Settings ▸ "open data folder" and "open log folder" open them.** Both buttons did nothing on
  the desktop app.
- **Opening Charnik twice brings the first window forward** instead of starting a second copy. Two
  copies saved over each other's characters without either saying so.
- **An ability whose formula is broken rolls nothing, and says so.** A homebrew `heal:` or `roll:`
  with a misspelt variable used to roll whatever dice it could still read out of the text — a
  number that looked like a result. It now tells you the formula could not be worked out.
- **A character file with two effects under one id loads as two effects.** Edited by hand or put
  together by another tool, such a file made one ✕ in the Effects panel remove both.
- **A description cannot draw a form or restyle the app.** Homebrew and pack prose keeps its
  emphasis, lists, tables and links; a `<form>`, a `<style>` block and inline `style` are dropped —
  nothing in them ran, but they could imitate one of Charnik's own dialogs. One shipped row loses a
  coloured heading with it.
- **The app's own settings folder is out of the page's reach**, so nothing rendered inside the
  window can repoint where your data lives.
- **A dice formula is capped as a whole**, at a thousand dice. A formula built to stall the app —
  from a shared pack — could ask for millions.
- **On Linux, a data folder you chose yourself works in full.** The app keeps a few files of its
  own under dot-prefixed names, and in a folder outside Documents each of them was refused — so
  content was re-seeded on every launch and pack updates had nowhere to stage.
- **First run no longer needs a Documents folder.** A Linux system without one left the app on an
  empty window; it proposes a folder in your home instead.
- **Confirm on first run takes the folder it proposes.** Without opening the picker first, the
  proposed folder was refused and the dialog simply stayed.
- **The app can only READ from GitHub.** Checking and downloading a content pack went through a
  network permission that allowed any kind of request to those addresses; it is two commands that
  fetch and nothing else.
- **Only the newest signed release can be installed, and only by the update chip.** The page used
  to hold the whole updater — including which address to ask and whether an older version counts
  as an update — and could restart or quit the app. It now says "check" and "install" and nothing
  else.
- **Allowing a plugin to run is asked by your system, not by the page.** After the review, a
  native dialog names the plugin and its code fingerprint, in your language, and only a yes there
  is recorded — where nothing running inside the window can write it. Plugins you had enabled
  before ask once more.
- **A character changed by something other than Charnik is never silently overwritten.** A sync
  tool, a text editor or a backup put back by hand: the app notices the file is not the one it
  wrote, stops saving over it, and asks which state to keep — yours, the file's, or both, with
  yours saved as a copy. On desktop it asks the moment the file changes.
- **Levelling up mid-session no longer puts back what the table spent.** The builder saves the
  build and leaves hit points, slots and effects as they are in the file at that moment.

### The roller

- **A roll card that says which number you read out loud.** Each answer — to hit, and each damage
  type — gets a box holding its caption, its sum, and the arithmetic that produced it dimmed
  alongside. Both sums carry the same weight; which one you mean is the caption's job.
- **Each answer takes the width it needs.** The two halves used to split the card evenly, so a
  squeezed sum wrapped between its own digits and an 11 read as 1 and 1. A crit's twenty dice stay
  inside the card in the toast, the tray and the log.
- **The dropped advantage die is collapsed, not struck through** — at formula size a strike turns a
  digit into a blob. It slides out dimmed on hover or focus, and the card does not change size while
  it does.
- **Enter rolls when there is nothing left to finish.** It used to complete the token you were
  typing, and do nothing at all when there was none.
- **The tray's readout no longer sits on the Roll button** in Ukrainian, where «Кинути» reaches 20px
  further in from the panel edge than "Roll" does.

### Playing

- **A character whose file lists one item on two rows opens.** The inventory panel, and the
  attacks beside it, used to vanish whole; each row is now its own, to equip, count and drop.
- **An item is added from play**, with the same picker the builder uses, and what you own is written
  where it belongs — the character's inventory, wherever you happened to notice it. The picker
  opens beside the button that asked for it, with the sheet still readable around it.
- **A price reads in the picker, on the inventory row and in the article**, in your own coin word,
  and a homebrew price the app cannot parse passes through as its author wrote it.
- **The item pickers show a band of rarity, mundane first.** 5e ships 234 magic rows against 149
  mundane ones, so a level-1 character's weapon list was buried under items nobody at that table
  will hold.
- **A press anywhere on a spell row casts it again.** The summary, the tag and the row's background
  had become dead space around the name.
- **A volley says its name once.** Two beams of Eldritch Blast used to print the name twice, with
  the numbers you are comparing pushed apart between them.
- **Every effect that has something to say carries its ⓘ** — a condition's rules text, the spell
  that granted the buff, or the words you typed for a custom one — and it opens in the language the
  panel is already in. It opens where the pointer is, on hover or on keyboard focus; press it and
  the text stays put, so it can be read at length and copied, until you press somewhere else.
- **A passive score explains itself.** All eighteen used to share one sentence about passive
  Perception, which says nothing about passive Athletics.
- **A refused ability bump says why**, with its numbers: the step's cost, the 15 ceiling, the 8
  floor, the lock. Strict and Free now list what actually changes between them instead of naming a
  mood.
- **Saving a character says it saved.** Only the failure had spoken, so an edit that worked and one
  that silently did not looked the same.
- **Languages and tools you type yourself**, as the last chip in the row rather than a standing
  field under a list most characters leave empty.
- **The pass-time bar stops appearing and vanishing on its own**, and the level itself is the
  level-up control.
- **The hit-point block is redrawn, and it is shorter.** A hit is typed the way you say it: the
  amount, then its type — `12 f` and Enter is twelve fire — or the type is picked from the same
  menu the dice tray opens, with the types you have a defense against first. The red minus says
  what your resistance leaves of it before you press, and the roll log keeps how much, of what
  type, and what the defense did. Healing and temporary hit points are one green button with one
  number, already selected when it opens. A hit of two types is two presses.
- **At 0 hit points the block becomes the fight.** Rescue pulls from one side and death from the
  other, a wing or a skull per save, and every one can be pressed as well as rolled — which is how
  you say a critical cost two. The third save ends it on `Stabilized` or on `Dead`, and death no
  longer covers the sheet with a dialog: the block says it, with what killed you and `I was
  revived` under the word. Getting back up — a natural 20, a heal, a
  revival — wipes the face you were on away behind a band of rescue's colour, and the block on
  its feet is under it. Nothing is raised over the block
  while it says all this: a death save rolls without a card — it is still the last roll in the
  strip and a row in the log — and dying, stabilising and being revived raise no notice. A save pressed by mistake can be taken back from either ending.
- **A revival takes one level of Exhaustion, not two.** It returns you with one fewer than you
  died with; a level you had already taken off by hand while dead used to be taken again.
- **You pick how that fight moves.** A pencil beside the block lists eight motions, `No animation`
  among them; the default is Rays & Hellfire. Settings ▸ General has **Reduce motion** — as the
  system, on, or off — which stills everything in the app and keeps each character's own pick.
- **Two hits before you roll owe two concentration saves.** A second hit used to replace the first
  one's save, so 30 damage and then 10 asked for DC 10. Now the chip holds each, oldest first,
  wears their DCs, and one press says "that was one hit" for a blow that dealt two types.
- **The concentration chip rolls the save; its ✕ ends the spell.** Pressing the chip used to end
  concentration outright, with nothing to confirm it. Now the press is the Constitution save —
  against the owed DC after damage, 10 otherwise — a failed save ends the spell without asking you
  to confirm it, and dropping a spell on purpose is one step further away and says so.
- **Conditions and effects are added from one list, and every row is a switch.** Two pickers asked
  you to know a difference the rules do not draw: you are Poisoned, raging or behind cover, or you
  are not. A state a spell is holding says so instead of offering a second copy, and Invisible or
  Rage no longer file under Debuffs.
- **Ammunition can be counted.** Switch it on in the inventory panel's menu and each shot spends one
  from the stack it fires — the right kind in 2024, your pick in 2014, whose weapons never say. Off by
  default, like coin weight: most tables do not count arrows. An action that makes several attacks
  spends one per strike.
- **Sneak Attack marks itself used.** Its rule is "once per turn", so the mark sets when the roll is
  made and clears on your next turn. It never refuses the roll — the same Sneak Attack is yours
  again on someone else's turn — and you can lift the mark by hand.
- **A long duration reads as time, not as a count of rounds.** An effect with eight hours left says
  "8 h", a 7th-level Geas "365 days"; a countdown that no longer divides evenly says "≈8 h" rather
  than "4799 rds". Combat-length durations stay in rounds.
- **An explanation opens where you point, and where you tab.** The hint on a toggle, the reason a row
  is blocked, what a resource recharges on and where it came from, an attack's notes — these waited a
  second and then appeared as a system tooltip a keyboard could never reach. They open at once, under
  the control, on hover and on focus alike.
- **Numbers no longer run into their labels.** A picker's category said "Weapon2", hit points said
  "38/ 73", a boosted ability said "STR+1".
- **A sheet says which plugins it is missing.** A character that counts on a plugin you have not
  installed, reviewed or enabled used to lose those numbers without a word. The sheet and the
  builder now name each one and what stands in the way, with a link to Settings ▸ Plugins.

### On a phone

Charnik is still a desktop app, and a narrow screen is deep alpha — the banner now says that rather
than "no mobile version". But nothing overflows any more. The topbar wraps instead of dragging the
whole page sideways, the three views with a fixed minimum reflow, scroll or re-anchor instead of
overflowing, the build sheet survives 320px, and an anchored menu stays on the screen it is anchored to on both axes — including
in a short desktop window, which hit the same bug.

### Content

- **116 creatures of SRD 5.1's two appendices**, where every ordinary animal lives, plus an
  `attacks` column in both editions. A 2014 druid has forms to take at CR ≤ 1.
- **The 2014 spell lists are read from WotC's own PDF.** The conversion they came from keeps only
  some of each page's columns — the Bard had lost a whole one, and the counts were short by 30%. 211
  class tags gained, none lost.
- **Ammunition rows** in both packs. 5e's own source never states which ammunition a weapon fires,
  so no row there claims one.
- **Dominate Beast, Person and Monster last longer from a higher slot, and Geas lasts a year or for
  good**, in both editions: the upcast durations their own text states. Casting one below its first
  higher rung keeps the base duration.
- **2014 Hold Monster takes one more creature per slot above 5th**, as its text says.
- **Three 2014 spells had half an "At Higher Levels"**, with the rest stuck to the end of their
  description — Moonbeam, Dominate Beast and Create Undead. Moonbeam's 2014 damage now scales with the
  slot, as that sentence says.
- **Casting a buff changes the sheet.** Mage Armor, Shield, Shield of Faith, Barkskin, Bless, Haste,
  Fly, Longstrider, Spider Climb, Invisibility, Blur, Stoneskin, Foresight and a dozen more now
  carry the effect their own text states, in both editions, so the number moves when you cast and
  goes back when the spell ends. In the spell list such a spell says what it does — "AC = 15" for
  your Mage Armor — where it used to say "utility".
- **Advantage on death saving throws works.** Beacon of Hope grants it, and the sheet used to
  discard it.
- **2014 creatures say which conditions they are immune to.** SRD 5.1 prints the line on 89 stat
  blocks and the pack had kept it for six, in prose. And the beasts and NPCs of its appendices no
  longer open their text with the stat block the page already shows above it.
- **The Avatar of Death has a stat block**, in both packs — the one each SRD prints inside the Deck
  of Many Things, which the compendium could show only as that item's prose.
- **Undoing a content update offers that update again.** After "Undo this update" the pack read as
  up to date until its publisher changed something else; the next check now finds it.

### Ukrainian

«Накласти» is the word for casting, in all ~25 strings that had been spreading four words over one
idea. Armour Class is КО; attunement is «прив’язка», not the word the Settings page owns; the saving
throw chip fits; «замовляння» fits the spell row.

### Under the hood

- **A save Windows refuses no longer leaves a temp file in your folder.** When another program holds
  a file open — a sync client, an antivirus scan, an editor — the save fails as it should, and now
  takes its half-written `.tmp-` sibling with it instead of leaving it there for good.
- **The log says where the app talks to something it does not control** — every write to your data
  folder, a pack refused, a plugin that would not load, a save that failed validation — with
  character names kept out of it. It is what a bug report attaches.
- **Writing content: the effects guide is published**, in plain language first and then the whole
  vocabulary, linked from the README. An older homebrew `class_features` file with a `resource`
  column still loads; the column is ignored, since a feature's pool is its `grant_resource` token.
- **Nothing that ships carries a known advisory** as of this release. One is open in a tool that
  runs only when the code is linted, and its fix is not published yet.
- **The dev server follows the content repo.** A CSV edited in the pack reaches the running app and
  reloads it, instead of staying invisible until the next build.
- **The screenshot harness sees a phone**, and a probe fails on anything that overflows at 393 or
  320px, in either locale.
- **What happens to a character at the table no longer depends on which screen is open.** Damage,
  healing, rests, effects, the turn, casting and what you carry are worked out in one place, and the
  rules that follow a change — hit points never above their maximum, concentration ending at 0 hit
  points, a form ending with its effect — hold there rather than in the play screen.
- **A converter re-run no longer loses what the source does not state** — a spell's class list, its
  upcast, a hand-filled healing die.

### Not in this release

Each of these is absent rather than wrong, and is done by hand until it lands.

- **Mystic Arcanum** is not a pool: a warlock's 6th-level and higher spells are neither chosen nor
  tracked in the app.
- **Agonizing Blast** can be chosen (2014) and does not add your Charisma modifier to Eldritch
  Blast's damage.
- **Some spells still only say what they do.** Those that ask a question at the cast — Enhance
  Ability, Protection from Energy, Fire Shield, Enlarge/Reduce — and Haste's doubled Speed and
  Heroism's Temporary Hit Points change no number. A spell cast on an ally shows its effect on your
  own sheet until you switch the effect off.
- **The Defences row's `Saves` group** ships in the form it has and is redrawn for 0.9.0.
- **No table link.** Charnik still talks to your disk and to GitHub for updates, and to nothing
  else.

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

- **The code moves from AGPL-3.0-or-later to [MIT](../LICENSE).** We don't want to oblige anyone who
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

# Changelog

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

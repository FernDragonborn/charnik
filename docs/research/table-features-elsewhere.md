# What a table does in other tools

> Research for TABLE-LINK-SPEC (`../work/release.md`), read in October 2026: which networked features
> D&D Beyond, Foundry VTT, Roll20, Fantasy Grounds, Owlbear Rodeo, Shard, Alchemy, Demiplane, Avrae
> and the in-person tools offer a table, which modules tables install on top, and what their forums
> ask for and complain about — so the spec chooses Charnik's first table knowing what players already
> expect. Read from each tool's own changelog, release notes, help centre and forums; every claim
> carries its date where the source gave one, and what could not be confirmed says so. Who WRITES a
> sheet in Foundry and D&D Beyond is `table-link-design-review.md` ▸ What to research next.

## Tool by tool

**D&D Beyond** moved hardest toward a table in 2026, through its Maps VTT:

- **Conditions sync between a token and its character sheet** (Jul 27, 2026); condition icons on
  tokens, monster AC shown during combat, and players can read a monster's immunities from the
  condition tracker (Sep 28). Bloodied and dead states are drawn on monsters at 50 % and 0 % HP, the
  DM can hide them, and since Oct 19 players see them by default.
- **Initiative updates itself when a player rolls it**, even mid-combat; the DM edits initiative in
  the combat list and the order re-sorts (Jun 29). The order is visible on players' screens (late
  2024, when Maps gained encounters).
- **A roll can apply its hit points**: a fix of Sep 21, 2026 names "HP wasn't applied when 3D
  rendering was disabled", so damage from the dice reaches HP. Shared Dice reached iOS and Android
  (Jun 15); edits on the full character sheet carry into Maps (May 2026).
- **Journals**: a DM journal (Jun 1), a shared Player Journal (Jul 27), players editing entries
  together (Sep 8). Scene Prep inside the play space (Aug 31).
- Older, still standing: the **Game Log** shares a campaign's rolls, the DM's Combat Tracker rolls
  included; **Party Inventory** (2025) is a shared container on every sheet; the **DM can edit** a
  player's character; **content sharing** across a campaign; **Avrae** posts rolls to Discord.
- The **2026 roadmap** (Feb 19): a rebuilt platform for "more responsive character updates", the
  Quickbuilder for level-1 characters (March) growing into a new Character Builder, and DM Prep
  tools — session documentation, embedded rules and tables. Nothing about the Game Log.

**Foundry VTT** reached v14 in 2026: native **multi-level scenes**, region-based templates replacing
measured ones, optional native HTTPS. **dnd5e 6.0** (latest 6.0.6, early October 2026) supports v14
only, reworks Active Effects with **conditional effects and effects attached to regions**, and
automates falling damage. From 3.0 on the system has had **group actors** (Party and Encounter), a
**primary party** that receives **awards** of XP and currency and distributes them, **targets and
their AC shown to the DM** on the attack card, an **effects tray** from which the DM applies an item's
effects to tokens, a GM's **request for a roll from an inline roll** link, and a passive-perception
enricher comparing the party to a DC. Ownership roles gate who sees and edits what.

**Roll20** in 2026 is a sheet platform as much as a map: **manage a game's characters without
entering the VTT** (Oct 5), **item transfers sheet to sheet** from the Shop Sheet (Aug 18), the D&D
2024 sheet and builder, Demiplane's **Cross-Platform Sync** of characters and subscriptions, Demiplane
sheets opening up to 90 % faster in the VTT (May 8). The table itself is unchanged in kind: token
bars and bubbles for HP and AC edited by the GM, a turn tracker, rolls to a chat that can be
**whispered** to the GM, and **damage application left to API scripts**.

**Fantasy Grounds Unity.** The **Combat Tracker** with targets and effects is the hub, and community
extensions build on it rather than replace it: Table Tools resolves attack and damage from one button
with Weapon Mastery follow-ups, area targeting, and **Rolls+ sends a request to chosen PCs and NPCs,
routes each roll to its owner and tracks every response**.

**Owlbear Rodeo.** A light map table whose rules features are extensions: Sheet from Beyond links a
D&D Beyond, Shard, Roll20 or Demiplane sheet to a token; dddice and the Dice extension share rolls;
Game Master's Grimoire tracks health and initiative with SRD stat blocks.

**Shard Tabletop** (5e only). Players' characters appear in the combat tracker when they join;
**players enter their own initiative on their sheet**; treasure goes to a **Shared Treasure** pool.

**Alchemy RPG.** Cinematic — music, backgrounds, overlays, voice and video; mechanics largely
manual by reviewers' accounts. **Demiplane** (now synced with Roll20): a GM views and edits players'
sheets in a campaign; **sheet rolls are not shared** inside Demiplane itself, by staff's own account,
and users keep asking. **Avrae** (Discord): an initiative tracker in a text channel, imported
characters, and one command that resolves an attack or a spell — saves, AC checks and damage.

**In person.** **Lumen VTT** (vendor article updated Oct 20, 2026) is built for a physical table: a DM
laptop, the battlemap on a TV, players acting from their phones, with 5e automation of spells and
features. Smaller phone apps share an initiative order with a "your turn" alert and DM-tracked HP and
conditions (Group RPG Dice Roller), or turn order across devices (Party Initiative Tracker). Roll20's
mobile companion cannot send initiative to the tracker, a known limitation. **Whether any of them
gives each player their own full, rules-aware character sheet, synced to the GM, was not
confirmed** — Lumen's page speaks of "phone player controls".

## The modules tables install

No tool publishes install counts; these are what curated guides, the tools' blogs and forum
"must-have" threads keep naming. FoundryMods, which samples installs, reports Dice Tray in more
than half of the worlds it tracks — a sample, not a census.

- **Foundry — Monk's TokenBar.** The party bar and the canonical **group roll request**: pick tokens,
  ask for a skill or a save, and with a DC set it **says who succeeded**; a roll made outside the
  prompt can be attached afterwards.
- **Foundry — Midi-QOL** (with DAE; v14.6 for dnd5e 6.0.6). The **automation workflow**: attack →
  hit check → damage → saves rolled or prompted → damage applied with immunities → effects →
  concentration. Every step optional; **targeting stays manual**; its changelog keeps fixing the
  interactions between steps.
- **Foundry — Token Action HUD** (acting from the token), **Item Piles** (loot in the scene, **split
  among the party**, merchants; add-ons for shared ledgers and multi-player trading), **Dice So Nice**
  and **Dice Tray**.
- **Roll20 — GroupInitiative, TurnMarker, CombatMaster, TokenMod, ChatSetAttr.** Initiative for the
  selected tokens; whose turn it is, map centred on them; **condition durations counted down by the
  turn order**; macros for the damage step the sheet leaves manual.
- **Fantasy Grounds — Table Tools** (above).
- **Across tools — Beyond20.** A roll button on every D&D Beyond line, sending the roll or the card
  into Roll20, Foundry or Discord: the most-installed answer to "my sheet and my table are different
  apps".

## What players ask for and complain about

Forum threads are vocal users, not a vote. Dates matter: several complaints below predate fixes.

- **D&D Beyond, DM side:** years of requests for **DM tools** (a private area, generators, a DM
  screen announced in 2019) — which the 2026 roadmap now answers with DM Prep and Journals. The **Game
  Log** draws the most specific asks: a **pop-out window**, monster rolls sent to it or kept off it,
  and (July 2025) **reset the log and delete a roll**, because test rolls clutter it and offensive
  character names were used through it to harass. Not shown answered by the 2026 changelog.
- **D&D Beyond, editions:** the 2024 rollout planned to replace 2014 spells and items on existing
  sheets and **reversed after a backlash** (2024); legacy sheets still reported 2024 Grapple and
  Shove, a 2024 Martial Arts die on a 2014 monk, 2024-only spells offered to a 2014 bard. A character
  must stay in its edition — Charnik's own rule — and users notice the moment a tool breaks it.
- **D&D Beyond, sync:** early Maps users reported monster HP not editable and hero HP not refreshing
  (2024); the 2026 changelog still notes "the character sheet sometimes needs a refresh to show
  changed conditions" (Jul 27, 2026).
- **Foundry:** **updates break modules**, a standing complaint since at least 2022 — saved worlds
  damaged, GMs reluctant to recommend it, the argument being whether Foundry should build in what
  modules do. dnd5e 6.0 moved bonus paths that modules read (2026).
- **Roll20:** **performance** — the 2024 sheet's Condition Sync slowing games, Jumpgate struggling
  past a dozen linked tokens, Mac and Firefox worst (late 2025, partly fixed after); **damage
  application left to macros**.
- **Demiplane:** **rolls not visible** to the party or the GM.

## What recurs

1. **A shared roll log is the floor**, with a visibility control — public or to the GM only — and,
   from D&D Beyond's users, moderation: clear it, delete a roll.
2. **The GM sees every sheet**; D&D Beyond and Demiplane let the GM edit.
3. **Initiative is shared, and the player's own roll enters it** (D&D Beyond since June 2026, Shard).
4. **The GM asks for rolls and is told who passed** (Foundry's request link, Monk's TokenBar, Fantasy
   Grounds' Rolls+).
5. **Conditions follow a creature between the map and the sheet** (D&D Beyond, July 2026) — and the
   sync is where the bugs are.
6. **Targets and damage** are the deepest automation and most often a module (Midi-QOL, Table Tools,
   Avrae); D&D Beyond's dice now apply HP.
7. **The party shares things**: inventory, treasure, awards.
8. **Feature dice are spent off someone else's roll** (Bardic Inspiration, Cutting Words from chat).
9. **Bridges exist because tools do not talk** (Beyond20, Avrae, Sheet from Beyond, Roll20 ↔
   Demiplane sync).

## What it suggests for Charnik's first table

Interpretation, for the spec to accept or reject.

- **Confirmed by every tool, already in the proposal:** the GM's live view of each sheet; a roll the
  GM asks for, with the DC announced or hidden; damage that arrives raw and meets the player's own
  defenses.
- **The floor the proposal lacks: the shared roll log**, with GM-only rolls and moderation from day
  one. Charnik's roller already leaves a record per roll (`internals/roller.md`); a table log is that
  record travelling.
- **Initiative entered by the player and broadcast** is now expected; it also gives durations and
  "until your next turn" the table's clock.
- **Tell the GM who passed** a requested save — the most-installed Foundry module exists for it.
- **Conditions the GM lays on a player travel to the player's sheet**, which is the same channel as a
  spell cast on an ally. D&D Beyond shows the sync bug to avoid: one writer (the player's app, as the
  design review chose) rather than two that must converge.
- **Charnik's position.** Lumen and the phone trackers serve the in-person table with a map and
  turns; D&D Beyond and Roll20 serve it with sheets in a browser account. A full, offline, file-owned,
  rules-aware sheet on each player's own device, joined to the GM's at one physical table, was not
  found — which is a claim to recheck before it is used in public.
- **Later, not first:** party inventory and treasure, awards of XP and coin (XP mode exists on the
  sheet), feature dice off another's roll, a shared journal.

## Sources

- D&D Beyond changelog (2026 entries) — <https://www.dndbeyond.com/changelog>
- D&D Beyond 2026 roadmap — <https://www.dndbeyond.com/posts/2132-d-d-beyonds-2026-development-roadmap>; <https://www.wargamer.com/dnd/beyond-roadmap>
- D&D Beyond Journals — <https://www.dndbeyond.com/posts/2241-whats-new-in-maps-player-editing-comes-to-journals>
- D&D Beyond Maps coverage — <https://www.vice.com/en/article/dungeons-and-dragons-players-get-a-big-update-to-dd-beyond-maps/>; <https://www.vice.com/en/article/dungeons-and-dragons-huge-dd-beyond-update-adds-dm-scene-prep-and-theater-of-the-mind-support/>; <https://www.dndbeyond.com/posts/1841-roll-for-initiative-combat-tracking-comes-to-the>
- D&D Beyond Game Log — <https://www.dndbeyond.com/changelog/937-share-your-dice-rolls-digital-dice-open-beta>
- D&D Beyond Party Inventory — <https://dndbeyond-support.wizards.com/hc/en-us/articles/40964522619540-Shared-Party-Inventory-FAQ>
- Foundry v14 — <https://foundryvtt.com/releases/14.369>; <https://foundrymods.com/how-to/foundry-v14-new-features>
- Foundry dnd5e — <https://github.com/foundryvtt/dnd5e/releases/tag/release-6.0.0>; <https://github.com/foundryvtt/dnd5e/releases>; <https://newreleases.io/project/github/foundryvtt/dnd5e/release/release-3.0.0>; <https://github.com/foundryvtt/dnd5e/wiki/Awards>
- Roll20 — <https://blog.roll20.net/posts/>; <https://help.roll20.net/hc/en-us/articles/360037772613-Change-Log>; <https://blog.roll20.net/posts/roll20-x-demiplane-integration-sheets-now-opening-faster/>; <https://www.demiplane.com/blog/demiplane-roll20-integration-update---cross-platform-sync-launches-today-more>; <https://help.roll20.net/hc/articles/29258224833431>
- Fantasy Grounds Table Tools — <https://www.fantasygrounds.com/forums/showthread.php?p=765690>
- Owlbear Rodeo — <https://extensions.owlbear.rodeo/sheet-from-beyond>; <https://docs.dddice.com/docs/integrations/game-master-s-grimoire>
- Shard — <https://www.shardtabletop.com/blog/quickstart-revisited>
- Alchemy — <https://help.alchemyrpg.com/en/articles/9821384-player-orientation>
- Demiplane — <https://www.demiplane.com/blog/campaigns-have-arrived>; <https://forums.demiplane.com/t/how-do-i-see-my-players-dice-rolls-during-sessions/2913>
- Avrae — <https://avrae.io>; <https://github.com/RoahNo/avrae>
- In person — <https://lumenvtt.com/blog/best-vtt-for-in-person-dnd/>; <https://apps.apple.com/us/app/group-rpg-dice-roller/id1496041058>; <https://mwm.ai/apps/party-initiative-tracker/1448298142>; <https://help.roll20.net/hc/en-us/articles/4411213438231-Roll20-Mobile-App-FAQ>
- Modules — <https://foundryvtt.com/packages/monks-tokenbar>; <https://www.foundryvtt-hub.com/package/midi-qol/>; <https://newreleases.io/project/gitlab/tposney/midi-qol/release/v14.6.1>; <https://foundrymods.com/best-modules/dnd5e/quality-of-life>; <https://foundryvtt.com/packages/itempilesdnd5e>; <https://foundryvtt.com/packages/sogrom-table-tools>; <https://wiki.roll20.net/APII>; <https://blog.roll20.net/posts/5-api-scripts-to-power-up-your-roll20-games/>; <https://github.com/PatrickCyr/Beyond20>
- Forums — <https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/226060-request-ability-to-reset-game-log>; <https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/107584-pop-out-game-log>; <https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/28206-feature-requests-dm-based-tools>; <https://www.wargamer.com/dnd/beyond-reverses-2024-decision-backlash>; <https://reddit.rtrace.io/r/FoundryVTT/comments/xfxyk9/will_we_ever_reach_a_point_where_updates_do_not>; <https://app.roll20.net/forum/permalink/12429260>; <https://app.roll20.net/forum/permalink/12530902/>

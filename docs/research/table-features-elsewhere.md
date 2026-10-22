# What a table does in other tools

> Research for TABLE-LINK-SPEC (`../work/release.md`): which networked features D&D Beyond, Foundry
> VTT, Roll20, Fantasy Grounds, Owlbear Rodeo, Shard, Alchemy, Demiplane and Avrae offer a table, so
> the spec chooses Charnik's first table knowing what players already expect. Read from each tool's
> own pages, release notes, help centre and forums; where a claim could not be confirmed at its
> source it says so. Who WRITES a sheet in Foundry and D&D Beyond is already in
> `table-link-design-review.md` ▸ What to research next, and is not repeated here.

## Tool by tool

**D&D Beyond.** A campaign joins characters to a DM. The **Game Log** shares dice rolls with everyone
in the campaign, from each character sheet and the campaign page, and shows the DM's rolls from the
Combat Tracker for encounters linked to the campaign. The launch notes listed "share with the DM
only" and "don't share" as planned; whether they shipped was not confirmed. The **DM can edit** a
player's character once it exists, but cannot create it for them (a staff reply, older). **Party
Inventory** (2025) is a shared container on every sheet: items and pooled coins any member can move,
and the DM can delete from any sheet. **Content sharing** lets a campaign use the books its DM owns,
up to 12 players. **Maps**, its 2D tabletop, gained an encounter tracker in late 2024: initiative
rolled and ordered in the tool, **the order visible on players' screens**, creatures added mid-fight,
difficulty rated from the 2024 DMG; early users reported monster HP and hero HP not refreshing, which
later posts say was partly fixed. **Avrae**, its Discord bot, can post a campaign's rolls to a
channel.

**Foundry VTT (dnd5e system).** Server-authoritative, with ownership roles. Release 3.0 brought
**group actors** split into Party and Encounter; a designated **primary party** receives **awards** —
XP and currency through `/award`, an `[[/award]]` enricher or the group sheet — and distributes them
to members later, a pool capped by what it holds. Players who **target before rolling** have those
targets and their AC shown to the DM on the attack card. Item cards carry an **effects tray** from
which the DM applies an item's Active Effects to tokens. A GM can **request a roll from an inline
roll** link; the `[[/check]]` / `[[/save]]` enrichers live in the system since 2.4. A
**passive-perception enricher** compares the whole party against a DC. Much of the rest a table
expects is MODULES: group checks with the half-succeed rule (Group Roll), roll requests with per-roll
DCs hidden until revealed and **feature dice added from the chat card** — Bardic Inspiration, Cutting
Words (Sogrom Table Tools), several damage buttons per item (Roll Groups), and the deepest automation
of attack → damage → defenses (Midi-QOL). Whether core dnd5e applies damage with resistances from a
chat card was not confirmed in this pass.

**Roll20.** Token **bars and bubbles** carry HP and AC; the GM edits HP by hand. A **turn tracker**
orders initiative. Rolls go to a shared chat and can be **whispered** to the GM. **Applying damage is
not native**: forum answers are API scripts and macros, one skipping saving throws entirely. A
community DM Dashboard adds turn order, public-or-whispered rolls and click-to-edit HP.

**Fantasy Grounds Unity.** The **Combat Tracker** with targets and effects is the hub, and community
extensions build on it rather than replacing it: Table Tools resolves attack and damage from one
button and handles Weapon Mastery follow-ups, adds area targeting, and **Rolls+ sends a roll request
to chosen PCs and NPCs, routes each roll to its owner and tracks every response in one request**. An
effects pop-out keeps per-actor effects in sync with the tracker. The record in Fantasy Grounds stays
the source of truth for every extension.

**Owlbear Rodeo.** A light map table whose rules features are extensions: Sheet from Beyond links a
D&D Beyond, Shard, Roll20 or Demiplane sheet to a token and opens it in a popover; a Dice extension
and dddice give shared rolling; Game Master's Grimoire tracks health and initiative with SRD stat
blocks; a "full suite" bundles initiative, bestiary, character cards and viewport sync.

**Shard Tabletop** (5e only). Players' characters **appear in the combat tracker when they join**;
**players enter their own initiative on their sheet** and the DM sorts the monsters; rolls are built
into the sheet for checks, saves, attacks, damage and features like Sneak Attack; treasure goes to a
**Shared Treasure** pool from the tracker. D&D Beyond imports are supported. How it handles conditions
was not found.

**Alchemy RPG.** Cinematic — music, backgrounds, overlays, voice and video. Players roll and manage
characters; reviewers note the mechanics are largely manual and item stats do not populate. A roll
log was not confirmed.

**Demiplane.** **Campaigns** let a GM view and edit permissioned players' sheets and choose which
content sources character creation may use. **Sheet rolls are not shared** with the group — staff
point to rolling into a Roll20 game instead and say a Groups rework will show them; users still
report it missing. Asked for in 2025: a shared dice roller and a GM's chart of the campaign's
characters.

**Avrae** (Discord). An initiative tracker in a text channel: players join with imported characters
(D&D Beyond, Dicecloud, Google Sheets), the DM adds monsters, combatants sort automatically, and HP,
AC, resistances and status effects are tracked. **One command resolves an attack or a spell —
saves, AC checks and damage.**

## What recurs

1. **A shared roll log is the floor.** Every tool has one (D&D Beyond's Game Log, Foundry's and
   Roll20's chat, Avrae's channel), and the one that lacks it — Demiplane — is where users complain
   most. Visibility is a control: public, or **to the GM only** (Roll20's whisper; D&D Beyond planned
   it).
2. **The GM sees every sheet.** D&D Beyond and Demiplane let the GM edit; Foundry gates it by role.
3. **Initiative is shared, and players enter their own.** Shard and D&D Beyond Maps show the order
   on players' screens; Shard takes the player's roll from their own sheet.
4. **The GM asks for rolls.** Foundry's request link and enrichers, the modules' group checks with
   hidden DCs, Fantasy Grounds' Rolls+ tracking who has answered.
5. **Targets and damage** are where automation is deepest and most often a module: Foundry shows
   targets and AC on the card and applies effects from it, Midi-QOL and Table Tools resolve damage,
   Avrae resolves saves and damage in one command, Roll20 leaves it to the GM's hand.
6. **The party shares things**: Party Inventory (D&D Beyond), Shared Treasure (Shard), the group
   actor and its awards (Foundry).
7. **Feature dice are spent off someone else's roll** — Bardic Inspiration and Cutting Words from
   the chat card.
8. **Bridges exist because tools do not talk**: Beyond20 and Avrae carry D&D Beyond rolls elsewhere,
   Sheet from Beyond puts a sheet on a token.

## What it suggests for Charnik's first table

Interpretation, for the spec to accept or reject — it decides, not this page.

- **Already in the proposal and confirmed by every tool:** the GM's live view of each sheet; a roll
  the GM asks for (an ability check, a save, a skill), with the DC the GM chooses to announce or
  hide (`work/release.md` ▸ TABLE-LINK-SPEC already decides the switch); damage that arrives raw and
  meets the player's own defenses.
- **The floor the proposal lacks: the shared roll log.** Charnik's roller already leaves a record per
  roll (`internals/roller.md`), so a table log is that record travelling, with a GM-only option.
  Without it a table is quieter than D&D Beyond's.
- **Initiative is cheap to share and expected.** The player rolls on their own sheet, the GM's app
  holds the order and broadcasts it; it is also what lets durations and "until your next turn" run
  on the table's clock rather than each app's.
- **Read-only by default, unlike D&D Beyond.** The design review already chose the player's app as
  the one writer; the tools that let the GM edit are also the ones with sync bugs (HP not refreshing
  in Maps).
- **Later, not first:** party inventory and treasure, awards of XP and coin to the party (XP mode
  already exists on the sheet), effects the GM lays on a player (Foundry's effects tray — the same
  channel as a spell cast on an ally), feature dice off another's roll (Cutting Words).

## Sources

- D&D Beyond Game Log launch notes — <https://www.dndbeyond.com/changelog/937-share-your-dice-rolls-digital-dice-open-beta>
- D&D Beyond Maps combat tracking — <https://www.dndbeyond.com/posts/1841-roll-for-initiative-combat-tracking-comes-to-the>; <https://arcaneeye.com/articles/dnd-beyonds-maps-vtt-gets-a-huge-upgrade-encounter-tracking/>
- D&D Beyond Party Inventory — <https://dndbeyond-support.wizards.com/hc/en-us/articles/40964522619540-Shared-Party-Inventory-FAQ>; <https://www.belloflostsouls.net/2025/09/dd-beyonds-party-inventory-will-help-everyone-keep-track-of-that-immovable-rod.html>
- D&D Beyond co-DM and editing — <https://www.dndbeyond.com/forums/dungeons-dragons-discussion/dungeon-masters-only/11883-co-dm-campaigns>
- Foundry dnd5e 3.0.0 release — <https://newreleases.io/project/github/foundryvtt/dnd5e/release/release-3.0.0>; awards — <https://github.com/foundryvtt/dnd5e/wiki/Awards>
- Foundry modules — <https://foundryvtt.com/packages/sogrom-table-tools>; <https://foundryvtt.com/packages/grouproll>; <https://rook.foundryvtt.com/packages/rollgroups>; <https://foundryvtt.com/packages/inline-roll-cmd>; <https://foundryvtt.com/packages/flash-rolls-5e>
- Roll20 — <https://help.roll20.net/hc/articles/29258224833431>; <https://app.roll20.net/forum/permalink/11440383/>
- Fantasy Grounds Table Tools — <https://www.fantasygrounds.com/forums/showthread.php?p=765690>
- Owlbear Rodeo — <https://extensions.owlbear.rodeo/sheet-from-beyond>; <https://docs.dddice.com/docs/integrations/game-master-s-grimoire>; <https://github.com/FullPeople/obr-suite>
- Shard — <https://www.shardtabletop.com/blog/quickstart-revisited>; <https://flash-acrylic-5ca.notion.site/Shard-Tabletop-87f72e772f304a5abeb6569fa889a41e>
- Alchemy — <https://help.alchemyrpg.com/en/articles/9821384-player-orientation>; <https://help.alchemyrpg.com/en/articles/9714185-gamemaster-orientation>
- Demiplane — <https://www.demiplane.com/blog/campaigns-have-arrived>; <https://forums.demiplane.com/t/how-do-i-see-my-players-dice-rolls-during-sessions/2913>; <https://forums.demiplane.com/t/dungeonmaxs-demiplane-feedback-roundup-2025/5796>
- Avrae — <https://avrae.io>; <https://github.com/RoahNo/avrae>

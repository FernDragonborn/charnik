# Where an unknown app loses a table

> The question this answers, in the maintainer's words: Charnik is an app nobody knows, has seen or
> talks about, so it has to be an order of magnitude better and easier before a table considers it.
> Read with that lens, `table-features-elsewhere.md` is less "what others do" than "where a player
> drops us in the first ten minutes, and what would make them stay". Virtual tabletops are out of
> scope; integration with one is asked only as "is it possible". Written October 2026; every
> recommendation here is for the maintainer to take or leave.

## The bar

D&D Beyond is free to start, already has the player's characters, runs in any browser and phone,
and since 2026 syncs conditions, initiative and HP into its own map. A player switches only when
something they do every session is visibly better, and the switch costs them almost nothing. So
each point below is either a **cost of switching** to remove or a **reason to switch** to sharpen.

## Where we lose — the drop-off points, in the order a player meets them

1. **The installer looks like malware.** Release builds carry a minisign signature for the updater
   (`release.yml`, `tauri.conf.json` ▸ `plugins.updater.pubkey`) and **no Authenticode signature**,
   so Windows SmartScreen shows "Windows protected your PC" — and unsigned, its reputation resets
   with every release's new file hash. For an unknown app this is where a share of people simply
   leave. Remedies, by cost: SignPath's free certificate for public open-source projects (eligibility
   to verify); Azure Artifact Signing at about $10 a month (an individual in the US or Canada, or an organisation in a listed dozen countries — neither applies to Charnik's maintainer); an OV
   certificate at $150–300 a year — and since 2024 an EV certificate no longer buys instant
   reputation, by Microsoft's own page. The web demo stays the zero-install first contact.
2. **The player's character already exists elsewhere.** Retyping a level-7 character from D&D Beyond
   is the single largest cost of switching. D&D Beyond has **no public API**; its internal character
   endpoint is unsupported, now behind the signed-in session, and staff have discouraged tools built
   on it; the Terms of Service on scraping were not settled in what was found. An importer would be
   fragile and legally unclear — and the character it brings carries non-SRD content (names and text
   of PHB subclasses, feats, spells) into the user's files, which is the user's business locally but
   not something Charnik should ship as a pipeline. Lower-risk routes: import Foundry's dnd5e actor
   JSON (an open format many players already have), and make building the same character from
   scratch fast (0.8.2's starting equipment, a quick path through the builder).
3. **The player's character uses content Charnik does not ship.** Most real characters use a PHB
   subclass, species or feat outside the SRD. SRD-only is legally right and is also the most likely
   reason a player cannot build their own character at all. Homebrew exists, but "author a subclass
   in the compendium editor" is minutes of form-filling before the first session. What would remove
   the wall: authoring the ONE missing piece from where the builder hits it ("this subclass isn't
   loaded — add it"), with its features as text first and mechanics later; and packs a player can
   share with their table in one file (content-pack sharing is already in the spec).
4. **Every player must adopt it for the table to work.** A table link needs the GM and each player on
   Charnik; one holdout and the GM runs two systems. The table should degrade, not break: a GM can add
   a non-Charnik player as a manual entry (name, AC, HP, initiative), and a roll mirror the whole table
   can see without installing anything (see Integrations ▸ Discord).
5. **At a physical table, players hold phones.** Charnik is a desktop app with a web demo; the planned
   mobile build is not here, PWA is deferred, and whether the web demo can join a table is decision 10
   of `table-link-design-review.md`. A player who brought only a phone cannot sit at Charnik's table.
   This decides whether the in-person table — the one place no tool was found to give every player a
   full, rules-aware sheet of their own (`table-features-elsewhere.md`) — is actually reachable.
6. **The first minutes are a builder.** The builder is a live sheet with an inspector, built for a
   player who knows what they want. ONBOARD is late by design; until then a new player meets every
   choice at once. D&D Beyond answered the same problem with its 2026 Quickbuilder for level 1.
7. **One wrong number and trust is gone.** D&D Beyond's users noticed 2024 Grapple on 2014 sheets the
   week it shipped. Charnik's release gate (no known wrong number) is the right defence; it has to hold
   at every level a table plays, which is what the 0.8.2 and 0.9.0 waves are.
8. **Sync that needs a refresh.** D&D Beyond's own 2026 changelog still says the sheet "sometimes needs
   a refresh to show changed conditions". One writer per character (the design review's choice) is what
   keeps Charnik from shipping the same bug.
9. **A shared log becomes a place to harass.** D&D Beyond users asked to clear the log and delete a roll
   after offensive character names were used through it. Moderation ships with the log, not after.

## Where we can be an order of magnitude better

What the others do not do at all, rather than do slightly worse:

- **Every number explains itself.** No tool found shows the trace of a number on demand; at a table,
  "why is my AC 17?" settles arguments in one tap. This is Charnik's headline, and it should be the
  first thing a new player sees, not a hover they might find.
- **No account, no subscription, no internet.** Open the app and play; at a physical table, a direct
  or local connection works with the venue's Wi-Fi down. Every competitor found needs an account and
  a server.
- **Both editions without breaking either.** A 2014 character stays 2014 — the exact promise D&D
  Beyond broke and walked back.
- **The rules are the user's.** A table that disagrees with a ruling edits a CSV; nobody else lets a
  GM fix a wrong number themselves.
- **Any language.** The UI and content are localisable by the community; the major tools are
  English-first.
- **Suggests, never decides.** Midi-QOL-style automation is the most-installed thing in Foundry and
  its changelog is a list of steps fighting each other; Charnik's "highlight the option, let the player
  click" is calmer and can be argued as the selling point for in-person play.

## Friction to remove, concretely

- **Join a table by QR code**, in the room — no address typed, approval in a native dialog.
- **Roll on your sheet, it lands on the GM's** — the roll log travelling, the floor every tool has.
- **One tap for initiative**, ordered on the GM's app and shown to all, with a "your turn" cue.
- **The GM asks for a save and sees who passed** — what Monk's TokenBar is installed for.
- **Damage arrives and the player's app offers the defenses** — resistance, Uncanny Dodge, Evasion —
  never applying them silently.
- **A level-1 character in two minutes** with the class's starting kit, and the rest asked later.

## Integrations — is it possible?

| target | possible? | how | cost and risk |
| --- | --- | --- | --- |
| **Discord** | yes, simplest | a channel webhook URL the GM pastes; the app posts each roll with its trace | trivial; the URL is a secret (store outside the data folder, rotate) |
| **Foundry VTT** | yes | a small Foundry module in the GM's browser receiving rolls from the Charnik app over a local WebSocket and posting them with `ChatMessage.create` / `Roll#toMessage`; community REST relays exist but route through a third-party server | a module is the thing Foundry users say breaks on every update — maintenance per Foundry and dnd5e major |
| **Foundry, data** | yes | import and export the dnd5e actor JSON | an open format; the cheapest bridge for players arriving from Foundry |
| **Owlbear Rodeo** | yes | an extension (iframe, SDK with broadcast and metadata) talking to the Charnik app on localhost; Owl20 shows the pattern via Beyond20 | moderate; browser-to-desktop bridging and its permissions |
| **Roll20** | only through a browser extension | Roll20's API scripts act only inside the game; Beyond20 works by injecting into the page | high upkeep, fragile to Roll20 changes |
| **D&D Beyond** | technically, not advisably | no public API; internal endpoint unsupported and behind login; ToS unclear; non-SRD content | see Where we lose ▸ 2 |
| **Shared 3D dice** | yes | dddice's API, or `@3d-dice/dice-box` already planned locally | an online dependency for something the local roller already does |

The cheap, safe pair is **Discord webhook + Foundry actor JSON**: one reaches every online group
without asking anyone else to install anything, the other lets a Foundry player arrive with their
character.

## Recommendations, cheapest leverage first

Taken by the maintainer on 2026-10-22: signing goes through SignPath, an OV certificate the
fallback, Azure Artifact Signing ruled out by its eligibility (`work/release.md` ▸
WINDOWS-SIGNING, with its reputation risk); the phone path waits until the engine supports the SRD
through level 20 (`plan.md`).


1. **Sign the Windows installer** (SignPath for open source, or Azure Artifact Signing). Before any
   promotion — it is the first screen a new user sees.
2. **Decide the phone path for players** (web demo joining a table, or the mobile build) as part of
   TABLE-LINK-SPEC; without it the in-person table is unreachable.
3. **Put the trace in front**: the first-run screen and the landing page show "why is this number this
   number", because it is the one thing nobody else does.
4. **Discord roll mirror** — a small feature that makes Charnik useful to an online group where only
   one person has it.
5. **Author the missing piece from the builder** (a subclass, a species, a feat), text first.
6. **Foundry actor import/export.**
7. **Mixed tables**: a manual entry for a player without Charnik, on the GM's side.

## Sources

`table-features-elsewhere.md` for everything about other tools. Additionally:

- Foundry external access — <https://github.com/ThreeHats/foundryvtt-rest-api>; <https://foundryvtt.com/packages/foundry-api-bridge>; <https://github.com/foundry-vtt-community/wiki/blob/main/API-Learning-API.md>; <https://foundryvtt.com/api/classes/foundry.dice.Roll.html>; <https://github.com/therealguy90/foundrytodiscord>
- Owlbear SDK — <https://docs.owlbear.rodeo/extensions/getting-started>; <https://docs.owlbear.rodeo/extensions/reference/metadata>; <https://addons.mozilla.org/en-US/firefox/addon/owl20-beyond20-owlbear-bridge/>
- D&D Beyond data access — <https://www.dndbeyond.com/forums/d-d-beyond-general/general-discussion/192944-api-questions>; <https://www.dndbeyond.com/forums/d-d-beyond-general/general-discussion/49086-d-d-beyond-terms-of-service-api>; <https://wyrmworkspublishing.com/dd-beyond-character-converter-for-free5e/>
- Discord webhooks for rolls — <https://carlzilla.itch.io/desktop-dice>; <https://chromewebstore.google.com/detail/cmljibajgfdpmiclgnnneeoabeiimhki>; <https://app.roll20.net/forum/permalink/10832666/>
- Code signing — <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>; <https://prism-studio.readthedocs.io/en/v1.12.0/GITHUB_SIGNING.html>

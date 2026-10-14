# Roller — open work

> Tracker. What is left on the roller and the surfaces a roll appears on. The design of record is
> [`../internals/roller.md`](../internals/roller.md); the ORDER these are done in is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **LOG-EVENTS · the log says what happened, not only what was rolled — a maintainer-stated
  rework for 0.9.0.** Today a log line is a roll or a bare name: `LOG_KIND` has one member, `roll`,
  and a marker is the action's name with nothing after it. What an action SAID never reaches it — a
  Hex cast in a Rage leaves "Hex cast, but you can't hold Concentration right now · A Rage ends
  Concentration" on a toast that is gone in six seconds, and the log keeps only the name. The log is
  the place a past turn is read again, so it has to hold the rest of the turn:
  - **Every notice a play action leaves** (`PlayOutcome.notices`, and the combat view-models' own
    `toast` calls that are about the character — concentration refused or ended and why, nothing to
    attack, an action already used, no ammunition, a window that opened). ONE feed for both: the
    sentence the toast says and the line the log keeps are the same `Said`, so the two cannot
    disagree. A toast that is about the app rather than the character (a setting saved, a disk
    error) stays out.
  - **The state changes the plan's change-log already names** (`plan.md` ▸ Change-log): damage taken
    and by what type, healing and temp HP, a slot or resource spent and restored, a condition or
    effect put on and taken off, concentration begun and ended, a rest, a level gained. Each is a new
    `LOG_KIND` member — the type is an open enum precisely so a reader's `switch` fails to compile
    until it handles the new kind.
  - **A roll line keeps everything it has now**; the new kinds sit between the rolls in time order,
    so a turn reads top to bottom as it was played.
  Where the log stands on screen is COMBAT-RAIL ▸ 1 (`ui.md`), done together with this: a log worth
  reading is the reason it earns a pinned rail. Not sized yet — size it from
  `combat/roll-journal.svelte.ts`, `character/log-repository.ts` and `combat/play-outcomes.ts`
  before scheduling inside the release.

**Won't-do, recorded so it is not re-opened:** advantage and disadvantage stay ONE cycling button in
the tray. The playtest asked for a switch; the maintainer's call is that the button reads well as it
is, and the state is already said in three places.

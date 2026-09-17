# Roller — open work

> Tracker. What is left on the roller and the surfaces a roll appears on. The design of record is
> [`../internals/roller.md`](../internals/roller.md); the ORDER these are done in is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [x] **UBUG-11 · a class-granted action DOES its mechanical effect.** `attack:<weapon id>[:<count>]`
  is an executor verb (`docs/internals/actions.md` §2), and the shipped rows use it: Flurry of Blows
  is `attack:unarmed_strike:2` in both editions, firing the ordinary attack path so a strike inside an
  action carries exactly what a tap on the Attacks panel does and charges no turn slot of its own.
  **What stays a `note:` on purpose:** Patient Defense and Step of the Wind grant the Dodge, Disengage
  and Dash ACTIONS, and the app models none of the three — a verb for them would be a play-state
  channel invented for one row, not an action that lands on an existing system.

- [ ] **PLAYTEST-TRAY · what the playtest found in the dice tray.**
  - [x] **Enter with nothing pending rolls** instead of doing nothing.
  - [x] **The roll card reads as answers, not as a wall of numbers.** Three rendered variants went to
        the maintainer (`design-preview/toast-readability.png`); the picked one gives each answer a
        labelled box holding the caption, the sum, and the arithmetic that produced it — dimmed, on the
        sum's baseline. To hit and damage carry the same weight, because which one you say is the
        caption's job. The dropped advantage die is no longer struck (a line at formula size turns a
        digit into a blob): it is collapsed inside the bracket and slides out dimmed on hover or focus,
        always out where there is no hover. The design of record is `../internals/roller.md`.
  - [x] **A damage-type pill does not look tappable.** It wears the same chevron every other
        menu-opening control in the app does (the duration select, the base-item chooser) rather than a
        cue invented for one pill — quiet until the pointer is on it. The playtest had been finding the
        type menu by accident.
  - [ ] **Advantage/disadvantage wants a real switch, not a cycling button.** `cycleAdvantage` walks
        three states through one press. The maintainer has no preference yet, so this is picked from
        RENDERED variants (`AGENTS.md` ▸ Screenshots go in design-preview). The harder half is WHERE:
        the state is already said in three places — the line's cycling button, the `advantage-cue` on
        the die, and the roll card's bracket colour — so a proposal has to say which of them becomes
        the control, not add a fourth.
  - [ ] **Autocomplete: clicking a suggestion and Tab do nothing on the web build, and both work on
        the dev server.** DEFERRED by the maintainer. The click path looks right (`RollerLine` uses
        `onmousedown` + `preventDefault`, so blur cannot eat it) and Tab is a different handler
        entirely, so two paths failing together points at something above them — focus, or the combat
        popup's capture-phase `closeOnOutside`. Reproduce on `pnpm build` + `pnpm preview`, not on the
        dev server, or the difference is invisible.

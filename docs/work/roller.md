# Roller — open work

> Tracker. What is left on the roller and the surfaces a roll appears on. The design of record is
> [`../internals/roller.md`](../internals/roller.md); the ORDER these are done in is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **PLAYTEST-TRAY · what the playtest found in the dice tray.**
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

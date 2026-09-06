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

_(Nothing open here. The roller's design of record is `../internals/roller.md`.)_

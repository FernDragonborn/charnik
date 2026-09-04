# Roller — open work

> Tracker. What is left on the roller and the surfaces a roll appears on. The design of record is
> [`../internals/roller.md`](../internals/roller.md); the ORDER these are done in is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **SAVAGE-TAIL · the offer rides the INSTANT attack tap only.** The Shift-click tray path rolls
  its damage later, through the organ, and gets no reroll offer there. The reroll itself is RAW now:
  it rerolls the weapon's own dice and leaves an effect die riding the same part alone.
- [ ] **UBUG-11 · a class-granted action must DO its mechanical effect, not just toast a note.** A
  Monk's Flurry of Blows toasts "Make two Unarmed Strikes" and rolls nothing, which is meaningless
  when the app can roll attacks. **The app half is built:** `attack:<weapon id>[:<count>]` is an
  executor verb (`docs/internals/actions.md` §2), firing the ordinary attack path so a strike inside
  an action carries exactly what a tap on the Attacks panel does and charges no turn slot of its
  own; the weapon is named by bare content id, which is why `Attack` carries an `id`.
  **What is left is CONTENT, in `charnik-content-srd`:** the `resource_options` rows that still say
  `note:` — Flurry of Blows becomes `attack:unarmed_strike:2` — hand-edited in both editions and
  `pnpm restamp`ed, never re-converted.

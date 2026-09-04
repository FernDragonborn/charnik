# Roller — open work

> Tracker. What is left on the roller and the surfaces a roll appears on. The design of record is
> [`../internals/roller.md`](../internals/roller.md); the ORDER these are done in is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **Damage types have no localized names anywhere in the data**, so they match and display in
  English. Rides the same boundary as ARCH-1: the 13 SRD types are a closed rules vocabulary and
  take catalog keys, an invented homebrew type is data and passes through.
- [ ] **SAVAGE-TAIL · two known limits of the `damage_reroll` offer.** It rerolls the WHOLE primary
  damage part, so a Bless die riding that part is rerolled with the weapon dice — arguably "use
  either roll", but not what the feat says. And the offer rides the INSTANT attack tap only: the
  Shift-click tray path rolls damage later and gets no offer there. Both are small and neither is a
  wrong number.
- [ ] **The toast's two tails.** An inert ↻ marker on the toast pill, and no labelled close control —
  an a11y nit, since the card itself IS the dismiss button today.
- [ ] **UBUG-11 · a class-granted action must DO its mechanical effect, not just toast a note.** A
  Monk's Flurry of Blows toasts "Make two Unarmed Strikes" and rolls nothing, which is meaningless
  when the app can roll attacks. **The app half is built:** `attack:<weapon id>[:<count>]` is an
  executor verb (`docs/internals/actions.md` §2), firing the ordinary attack path so a strike inside
  an action carries exactly what a tap on the Attacks panel does and charges no turn slot of its
  own; the weapon is named by bare content id, which is why `Attack` carries an `id`.
  **What is left is CONTENT, in `charnik-content-srd`:** the `resource_options` rows that still say
  `note:` — Flurry of Blows becomes `attack:unarmed_strike:2` — hand-edited in both editions and
  `pnpm restamp`ed, never re-converted.

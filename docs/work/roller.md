# Roller — open work

> Tracker. What is left on the roller and the surfaces a roll appears on. The design of record is
> [`../internals/roller.md`](../internals/roller.md); the ORDER these are done in is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **UBUG-11 · a class-granted action must DO its mechanical effect, not just toast a note.** A
  Monk's Flurry of Blows toasts "Make two Unarmed Strikes" and rolls nothing, which is meaningless
  when the app can roll attacks. **The app half is built:** `attack:<weapon id>[:<count>]` is an
  executor verb (`docs/internals/actions.md` §2), firing the ordinary attack path so a strike inside
  an action carries exactly what a tap on the Attacks panel does and charges no turn slot of its
  own; the weapon is named by bare content id, which is why `Attack` carries an `id`.
  **What is left is CONTENT, in `charnik-content-srd`:** the `resource_options` rows that still say
  `note:` — Flurry of Blows becomes `attack:unarmed_strike:2` — hand-edited in both editions and
  `pnpm restamp`ed, never re-converted.

- [ ] **DICE-TRAY-NAME · the "roller organ" is called a DICE TRAY, everywhere.** The UI already says
  "Dice tray" on the button that opens it (`combat.controls.diceTray`, `menus/DiceTray.svelte`), while
  the code and `internals/roller.md` call the same thing an organ — so the one name per fact rule is
  broken across the seam a maintainer crosses most often. Rename `RollerOrgan` → `DiceTray`, the
  `organ` props and locals with it, `dice/roller.svelte.ts` → the file the class is named after, and
  the doc's "## The organ" section; `/dev/roller`'s heading goes with them. ~60 mentions across
  `src/lib/dice`, `src/lib/components/Roller*`, `src/routes/combat` and the docs. Mechanical, but not
  a blind sed: `roller.ts` and `roller-vocabulary.ts` are the ROLLER (the pure engine + its
  vocabulary), which keeps its name — only the ORGAN is the tray.

- [ ] **INSPIRATION-REROLL · Heroic Inspiration is a flag nothing reads.** The Combat control toggles
  `play.inspiration` and persists it, and that is the whole feature: no roll offers to use it, nothing
  spends it, and the log never mentions it. RAW (5.5e) it lets you reroll ANY d20 and keep the new
  result — which is the shape the roller already has for `SAVAGE-TAIL`'s damage reroll: offer it on
  the toast and in the log for the last d20, spend the flag when taken, and record it as an amendment
  (`{kind, from, to}`) so the line explains itself and reads in the reader's language. 2014 has the
  same rule under "Inspiration" but spends it BEFORE the roll (advantage), so the two editions differ
  in when the choice is made — offer per edition rather than picking one.

# Roller / dice-tray fix list — live testing session, 2026-08-25

Everything reported in the session, in the order it was reported, so nothing is lost. `[x]` only
once the fix is in code AND verified; `[~]` = in code, not yet verified in the running app.
Retire this file into `docs/PLAN.md` when the list is closed (AI-CONVENTIONS §8.7).

The organ in question: `RollerOrgan` (`src/lib/dice/roller.svelte.ts`) + `roller.ts` (pure model),
UI `Roller.svelte` / `RollerLine.svelte`, mounted by `DiceTray.svelte` as `combat.tray.organ`.

## The list

1. `[~]` **A token parses on leaving the line, not only on space/Enter.** Blur commits the draft
   through the same path as Tab/Enter/Roll. — `RollerLine.svelte` `onblur`.
2. `[~]` **Untyped damage says WHY it is underlined.** The wavy underline had only a hover title;
   the non-blocking issue is now shown in the band under the lines, muted and badgeless.
   — `Roller.svelte`.
3. `[~]` **The vocabulary follows the line's ROLE.** Damage types are offered (and resolved) only on
   a damage line, never on the attack line; on a damage line they sort first, effects lead the
   attack line. — `roller.svelte.ts` `vocabularyFor`, `roller-vocabulary.ts` sort.
4. `[~]` **Clicking a damage-type pill opens a menu of damage types** — the same menu as the
   completion, filtered to types, so changing one is a pick. — `roller.svelte.ts` `retype`/`pick`.
5. `[~]` **"RAW" out of every user-facing message.** Seen in: "Hex cast, but you can't hold
   Concentration right nowA Rage (or similar state) ends Concentration — RAW". The missing space /
   sentence break in that string is part of the same fix.
6. `[~]` **The caret cannot move left of the last token.** No way to get back into the middle of a
   line and edit an earlier token.
7. `[~]` **An inherited damage type blocks deleting the die before it.** Backspace unfolds the
   INHERITED pill, `normalizeLine` immediately re-derives it, and the die can never be erased.
8. `[~]` **Ctrl+Z should step back token by token**: the last token becomes text; pressing it again
   re-folds that one and unfolds the next one leftward.
9. `[~]` **A damage type must match its localized name** — typing "силова" does not find `force`.
   (Names added to `en.json` / `uk.json` as `damageType.*`; needs verifying in the app.)
10. `[~]` **Clicking Eldritch Blast shows "make a roll" but rolls nothing.**
11. `[~]` **The "make a roll" message shows even when the tray is open**, where the roll is being
    made.
12. `[~]` **No second attack in the log/toast** — Eldritch Blast should fire two beams and appears
    to roll once.
13. `[~]` **Double-clicking a stepper's `+` must not throw you into editing the pill**
    (numbering continues below — items 14+ came in after the first twelve) — the two
    clicks now stop at the stepper instead of reaching the pill's select/unfold. — `RollerLine.svelte`.

14. `[~]` **Reopening the tray must not reopen onto a type menu that was left open.**
15. `[~]` **Clicking the same damage-type pill a second time closes its menu** (one control, two
    states).
16. `[~]` **After picking a type, the pill must stop looking focused** — the caret goes back into the
    line.
17. `[x]` **ANSWERED: Unarmed Strike is `1 + STR mod`, so 6 means STR 20.** Correct by the book in
    both editions, and effects (a Rage +2) fold in at the ROLL, as they do for every weapon — the row
    shows the base. One real gap found and fixed alongside: the unarmed row skipped
    `scopedAttackBonus`, so a melee-scoped attack bonus reached every weapon except your fists.
18. `[~]` **← next to a token puts the caret INTO that token's text** — the same walk-left as 6 and 8:
    the token under the caret folds back into a pill and the one before it opens for editing.
19. `[~]` **The crit-method switch belongs in Settings, not in the tray** — it is not clicked back and
    forth. (It already exists in Settings ▸ General; the tray's copy comes out.)
20. `[~]` **The active auto-calc marker should read NEUTRAL, not green.**

21. `[~]` **Walking left past the head of a line looped**, folding the token away and jumping the
    caret to the end of the first one. It now stops there instead.
22. `[~]` **Ctrl+arrow jumps a whole TOKEN, not a word** — "Blessing of the Trickster" is one thing
    here, and the browser's word-at-a-time jump stopped three times inside it.
23. `[~]` **The damage-type menu wears the type GLYPHS**, drops the activity dot (a type is never
    "active"), and stands in TWO columns — 13 rows was a scroll.
24. `[~]` **The role stripe stops at the field** instead of running the whole height of an open menu:
    a long coloured rule down a list of damage types is a line that says nothing.
25. `[~]` **← at the head of a line threw the caret to the end of the token it was already in.** A
    step that goes nowhere now leaves the text caret alone.
26. `[~]` **Removing an effect left its concentration running** at the top of the sheet. The carrier
    IS the concentration, so all three ways an effect can leave (the ✕, a rest, the round counter)
    now go through one seam — `endConcentrationCarriedBy`.
27. `[~]` **Too many frames.** The tray and its readout are two CARDS with a gap rather than one
    sheet with a rule across it; the roller keeps its own frame (the Roll tab hangs off that edge, and
    without it the button floated); a line's field draws no box at rest, only on focus.

## Noticed while working, not reported

- `2d6+3` glued into one token parses as a raw fragment (it blocks the roll). Same on space today,
  so it is not a regression — but it is what a person types.

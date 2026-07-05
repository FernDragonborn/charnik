# Manual QA checklist (refactor safety)

Per refactor: what to **click-verify in the running app** (`pnpm dev` / `pnpm tauri dev`), because
unit tests don't cover UI wiring. Each entry: the change, the files, and the exact things to check so
a refactor can't silently kill functionality. Tick when verified in a running build.

Legend: ☐ not verified · ☑ verified in app · ⚠️ behavior intentionally changed (check it's the new behavior)

---

## CH1 · dice roller unified (`rules/dice.ts`) — commit d660047

Files: `rules/dice.ts` (new), `combat/state.svelte.ts` (`doRoll`/`rollDiceNow`/`pushRoll`),
`combat/helpers.ts` (`parseDice`→`parseDicePool`), `components/WikiDetail.svelte` (`rollDice`).

Combat sheet:
- ☐ Tap a **skill / save / attack** → rolls; toast shows total + breakdown (`d20(x) +N`).
- ☐ **Advantage / disadvantage** roll → shows kept d20 and the dropped one (`d20 X (drop Y)`).
- ☐ **Bless / Bane** active → the roll picks up the signed bonus die (`+d4(x)` / `−d4(x)`).
- ☐ **Custom roll tray** (Alt/Ctrl-click a stat) → set dice + mod + adv, roll → same result as a tap.
- ☐ Cast a **damage** spell → rolls damage; cast a **buff/utility** spell → `Cast X` log marker only.
- ☐ Roll **log**: newest first, capped (200).

Compendium / spellbook:
- ⚠️ Monster **HP dice** button (`16d12 + 80`) → now rolls EVERY dice group (old bug: only first). Check total is plausible (~120–170, not ~8+80).
- ☐ Spell/attack **damage roll** button in WikiDetail → rolls, toast shows formula.

---

## Strict typing pass (exactOptionalPropertyTypes + noUncheckedIndexedAccess)

Mostly type-only, but `noUncheckedIndexedAccess` fixes add runtime guards (`?? fallback`, early
returns) that *could* alter behavior if mishandled. Entries added per risky fix below.

### `adv` → `advantage` rename + roll result is now `advantageRoll: {kept, dropped}`

Files: `rules/dice.ts` (`Rolled.advantageRoll`), `combat/state.svelte.ts` (`rollAdvantage`, `pushRoll`),
`combat/helpers.ts` (`rollEffectsFor` returns `advantage`), `combat/CombatMenus.svelte` (log render).
Type-only + render field rename; behavior should be identical.
- ☐ Adv/disadv roll → **tray history** line and the **full roll log** both show `d20 <kept>` with the
  dropped d20 struck through (same as before the rename).
- ☐ The tray's advantage/normal/disadvantage segmented toggle still sets the roll mode.

### exactOptionalPropertyTypes enabled — conditional-field construction

Files: `content/detail.ts` (`availableTo`, ability `save`), `content/homebrew.ts` (`options`),
`character/spellcasting.ts` (`cantrips`/`prepared`), `rules/spellcasting.ts` (`forcedUpcast`),
`rules/pipeline.ts` (`notes`), `character/repository.ts` (roster `error`). These now omit a field when
absent instead of setting it to `undefined`. Verify the consumers still render:
- ☐ Compendium spell detail: **"Available to"** class list shows (spells that have it) / is absent (others).
- ☐ Monster/statblock detail: saving-throw values render only for abilities that have a save.
- ☐ Homebrew add-content form: enum fields (systems, category…) still render their **dropdown options**.
- ☐ A **corrupt character** in the roster still shows with its error message.

<!-- append fixes with a behavioral risk here -->

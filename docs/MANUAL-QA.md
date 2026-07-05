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

### noUncheckedIndexedAccess — guards added at array/record access (81 sites)

Mostly `m?.[1] ?? ''` on regex matches (no behavior change) + `!` in tests. A few added a runtime
guard that drops an item if it were unexpectedly absent — verify nothing legitimate disappears:
- ☐ Combat sheet: **all 18 skills** still render (each row now behind `{#if sk}`), and taps still roll.
- ☐ Combat: **passive senses** (Perception / Investigation / Insight) still show (the passives list now
  filters to skills present in the sheet).
- ☐ Combat: **level-up** still toasts the class + new level (toast now guarded by `if (cls)`).
- ☐ Combat header: **class name + level** still shows (guarded first-class lookup).
- ☐ Compendium: switching **type chips** and **group-by** still works (first-option fallbacks).
- ☐ Build review panel: **Spell DC** stat shows for casters (guarded `classes[0]`).

## CH2 · effect grammar unified (one `parseEffect`)

Files: `effects/index.ts` (parser + `EFFECT_KIND` const + `matchesTarget` export), `rules/dice.ts`
(`parseDiceTerm`), `derive.ts`, `combat/state` (slotMax), `combat/helpers` (rollEffectsFor, effectTag),
`build/state` (speciesFixedAbilities). All token reads route through one parser now — verify every
effect-driven feature still behaves:
- ☐ **Resistance/immunity/vulnerability**: an effect with `resist-immune:immune:poison` shows poison
  under Immunities (and `resist-immune:fire` → Resistances); the defenses panel is correct.
- ☐ **Resource pools**: a feature granting `grant-resource:rage:3:long` shows a 3-pip rage tracker.
- ☐ **Granted proficiency / condition**: `grant-proficiency:stealth` marks stealth proficient; an
  `apply-condition:*` effect applies its condition tokens.
- ☐ **Ability bonuses** (species +2, etc.) still cascade into scores in the builder.
- ☐ **Roll effects**: Bless/Bane add the bonus die; an `advantage:*` effect flips a roll to advantage.
- ☐ **Action economy**: Action Surge / Haste (`flat-bonus:action+1`) still add an action pip.
- ☐ **Effects panel tags**: custom modifiers render readable tags ("AC +2", "DEX save +1").

## CH3 · pip trackers unified (one `pipClick`, available-left/spent-right)

Files: `combat/helpers.ts` (`pipClick`), `combat/state` (usePip/slotClick/resourceClick),
`combat/+page.svelte` (action + resource pip render flipped). Behavior changed intentionally:
- ☐ **Resource pips** (rage/ki/…): clicking the RIGHTMOST available pip spends ONE (was: clicking any
  pip spent the whole pool — the bug). Available pips are on the LEFT, spent fill in from the RIGHT.
- ☐ **Action-economy pips** (action/bonus/reaction): now render available-left/spent-right too (was
  used-from-left). Spending + restoring still works; clicking a spent pip restores it and those left.
- ☐ **Spell-slot pips**: unchanged (they were already this model); confirm spend/restore still works.
- ☐ All three feel identical now: click an available pip → spend from it rightward; click a spent pip
  → restore from it leftward.

<!-- append fixes with a behavioral risk here -->

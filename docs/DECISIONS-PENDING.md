# Decisions pending

Design calls surfaced during autonomous refactoring that need your input before I finish them.
Each entry: what's blocked, why it's a decision (not just mechanical), and the options.

---

## C1 · New design tokens for the last hardcoded colors

The zero-risk hardcoded colors are already tokenized (`#fff` → `--color-accent-text`, overlay
shadows → `--color-overlay`, dropped the pointless `--color-danger` fallbacks). The remaining
sites are gold/teal accents whose **light-theme values I'd be guessing** — picking those is a
visual-design call, so they're parked here:

- **Gold border** `#5a4d28` (dark) — `.recharge-chip` (PanelCard), `SpellHead`, and the resource
  hover tints I added (`rgba(202,162,74,0.08/0.12)`). Needs a `--color-resource-border` token with a
  dark value (`#5a4d28`) and a **light value TBD** (something like `#d8c48f`? your call).
- **Teal border** `#2c4a45` (dark) — PanelCard. Needs `--color-good-border`, light value TBD.
- **Gold-tinted popover surface** `#221c10` (EffectDurationMenu bg) + `#1a1400` (settings text).
  Reuse `--color-resource-soft` (`#2a2415` dark / `#f1e7cf` light) or add dedicated tokens? The
  hues differ slightly from resource-soft.

Once you pick the light values (or say "reuse resource-soft / resource-border derived"), I'll add
the tokens and swap the last ~5 sites, closing C1.

---

## A14 · HP-max semantics: manual override vs `hp_max` effects

`play.hp.max ?? sheet.maxHp.value` means a **manual max override silently disables every `hp_max`
effect** (Aid stacked on a manual max just vanishes), and when max DROPS (Aid expires) `hp.current`
stays above the new max until the next heal. Fixing this needs a decision on the model:

- **Option A**: manual override REPLACES the computed max (current behavior, effects ignored while set).
- **Option B**: effects layer ON TOP of the manual base (`manualBase + Σ hp_max effects`), and
  `hp.current` clamps to the live max on every derive. More correct, but changes what "manual max" means.

Recommend B (clamp current + layer effects). Parking until you confirm the model.

---

## Per-resource USE effects (e.g. Arcane Recovery restores slots) — the big one

You flagged that "using" a resource should run its real mechanic, and each such resource needs its own
system (Arcane Recovery = pick which expended slots to recover within a ⌈level/2⌉ budget, no slot ≥6;
Sorcery Points = convert SP↔slots; Channel Divinity options; …). This is a data-model + UI feature,
not a refactor: a `recover_slots:<budget>:<maxLevel>`-style effect token (or content columns) + a
picker dialog + rules math. Deferred by you to build the system deliberately later.

## Pin (spellbook ⇄ combat) end-to-end — ties D3

Spellbook pin is a local set (effectiveId); combat pin is the `CombatVM.pinned` demo hardcode
(bare id). Making pin persist like hide did (UBUG-10) means one `ui.spellsPinned` field + reconciling
the two key formats + dropping the demo hardcode (**D3**). Small-medium; say go and I'll do it.

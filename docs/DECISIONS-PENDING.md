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

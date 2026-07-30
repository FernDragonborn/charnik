# Effects & Conditions block — implementation spec (MANDATORY, 1:1)

Reference render: `design-preview/effects-final.html` → `effects-final-block.png` (card width **430px**,
deviceScaleFactor **2**). That HTML is the pixel source of truth. This file is the contract I (Claude
Opus 4.8) MUST follow when building it into `src/routes/combat/blocks/PanelCard.svelte` (the `effects`
branch) + a new `EffectDurationMenu` control. Deviations are bugs.

Fonts + tokens are already loaded by the app (Space Grotesk display, JetBrains Mono mono; the
`--color-*` / `--radius-*` tokens). USE THE TOKENS — never hardcode a hex except the 3 literals the mock
uses (`#5a4d28` recharge border, `rgba(59,184,166,.4/.08)` pos tag, `rgba(207,43,64,.45/.08)` neg tag).

## 0. Naming rule (learned the hard way)
The mock's `.r` tag class **collided** with the row `.r` and inherited `padding:7px 0`, making red pills
taller. In the real code use **verbose, non-colliding** class names. NO one-letter classes. Mapping:
- `.r` (row) → `.effect-row`
- `.main` → `.effect-main`
- `.ctrl` → `.effect-ctrl`
- `.tag` / `.tag.g` / `.tag.r` → `.effect-tag` / `.effect-tag--positive` / `.effect-tag--negative`
- `.dsel` → `.duration-select`
- `.ghdr` + `.buff/.debuff/.rsrc` → `.section-head` + `--buff/--debuff/--resource`
- `.rr` → `.resource-row`; `.rname` → `.resource-name`; `.pip` → `.resource-pip`; `.recharge` → `.recharge-chip`
- `.x` → reuse the global `.icon-button` (ghost ✕) with a `.effect-remove` hover accent, like the current panel.

## 1. Structure (top → bottom, inside the existing `.card` + `.panel-head`)
`.panel-head` (global, unchanged): title "Effects & conditions" + `.pill-btn` "＋ Add effect" + drag `.drag-handle`.
Then up to three `<section>`s, each rendered ONLY if it has ≥1 item, in this order:
1. **Buffs**  2. **Debuffs**  3. **Resources**
Each section = a `.section-head` then its rows.

## 2. Grouping logic (pure, from `character.play.effects`)
- An effect is a **resource** iff any of its `effects` tokens starts with `grant_resource:`.
- Else it's a **buff** iff `positive === true`, else a **debuff**.
- Section `· N` count = number of items in that section.
- Buffs/Debuffs render as effect-rows; Resources render as resource-rows.

## 3. Section header (`.section-head`)
- `display:flex; align-items:center; gap:7px; padding:12px 0 5px;`
- `font-family: var(--font-mono); font-size:9px; letter-spacing:.13em; text-transform:uppercase;`
- color: buff → `var(--color-good)`; debuff → `var(--color-accent-bright)`; resource → `var(--color-resource)`
- `· N` count span → `var(--color-text-muted)`
- Leading **icon**, 14px, `flex:none`, `viewBox="0 0 20 20"`, `currentColor` (exact SVG in §7).

## 4. Effect row (buffs + debuffs) — `.effect-row`
- `display:flex; gap:9px; padding:7px 0; border-top:1px solid var(--color-border); align-items:flex-start;`
- The **very first row of the very first section** has `border-top:0`.
- `.effect-main`: `flex:1; min-width:0; display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px;`
  contains the **name** then the **tag(s)**. **Overflow = WRAP** (nothing hidden; row grows). This is the
  decided behaviour — do NOT add "+N" collapse or fade.
- `.effect-name`: `font-family:var(--font-display); font-weight:600; font-size:13px; color:var(--color-text);`
  (ALL names WHITE — buff/debuff/resource alike. Section colour carries the meaning, not the name.)
- `.effect-ctrl`: `display:flex; gap:8px; flex:none;` — holds the `.duration-select` then the remove ✕.

## 5. Tag pill (`.effect-tag`) — MUST be identical height for pos & neg
- Base: `display:inline-flex; align-items:center; line-height:1.35; font-family:var(--font-mono);
  font-size:10px; border:1px solid var(--color-border); background:var(--color-surface-2);
  border-radius:5px; padding:1px 6px; color:var(--color-text-muted); white-space:nowrap; flex:none;`
- `--positive`: `color:var(--color-good); border-color:rgba(59,184,166,.4); background:rgba(59,184,166,.08);`
- `--negative`: `color:var(--color-accent-bright); border-color:rgba(207,43,64,.45); background:rgba(207,43,64,.08);`
- One effect may have MULTIPLE tags (Haste → `AC +2` `speed ×2` `+1 action`). Tag text comes from
  `effectTag(token)`; positive tags on buff rows, negative on debuff rows.
- `effectTag` MUST produce short forms: flat_bonus (`AC +2`, `saves +1d4`, `saves −1d4`), set/override
  (`AC = 13`), resist (`resist · fire`), advantage (`advantage`), condition text (`disadvantage`).

## 6. Duration control (`.duration-select`) + dropdown menu
Closed control:
- `display:inline-flex; align-items:center; gap:5px; font-family:var(--font-mono); font-size:10px;
  color:var(--color-resource); border:1px solid var(--color-border-strong); border-radius:7px;
  padding:3px 7px; cursor:pointer; white-space:nowrap; flex:none;`
- Label: `${durationRounds} rds ▾` when set; `∞ ▾` when `durationRounds == null` (indefinite).

Open menu (anchored dropdown; reuse the combat overlay/anchor mechanism, opens BESIDE, never over the rows):
- `background:var(--color-surface-2); border:1px solid var(--color-border-strong); border-radius:9px;
  box-shadow:0 12px 30px #000a; padding:4px; width:max-content;`
- **Top stepper row**: `display:flex; gap:4px; padding:2px; margin-bottom:3px;
  border-bottom:1px solid var(--color-border);` two buttons `−` and `＋`, each `flex:1;
  font-family:var(--font-mono); font-size:14px; color:var(--color-text); background:var(--color-surface);
  border:1px solid var(--color-border-strong); border-radius:6px; padding:3px 0; cursor:pointer;` hover →
  `border-color:var(--color-resource); color:var(--color-resource);`. `−` = `bumpEffectDuration(-1)`,
  `＋` = `+1`.
- **Preset items** (each `font-family:var(--font-mono); font-size:11px; padding:5px 9px; border-radius:6px;
  color:var(--color-text); white-space:nowrap;`; the active one `.on` → `color:var(--color-resource);
  background:#221c10;`), in this exact order — the COMMON durations, no round/minute duplication:
  1. `1 round` → 1
  2. `1 minute · 10 rds` → 10
  3. `10 minutes · 100 rds` → 100
  4. `1 hour · 600 rds` → 600
  5. `∞ until removed` → indefinite (strip duration)
  6. `Custom…` (muted `var(--color-text-muted)`) → inline number input for an exact round count
- Setting a preset calls `setEffectDuration(iid, n)` (0/indefinite → removes the fields). Highlight the
  preset whose value equals the current `durationRounds` (else none).

## 7. Section ICONS — exact SVG (14px, viewBox 0 0 20 20, currentColor)
Buff = shield+ (stroke 1.6):
`<path d="M10 2.5 L16 5 V10 C16 14 13 16.6 10 18 C7 16.6 4 14 4 10 V5 Z"/><path d="M10 7 V12 M7.5 9.5 H12.5" stroke-linecap="round"/>`
Debuff = cracked shield (stroke 1.7):
`<path d="M10 2.5 L16 5 V10 C16 14 13 16.6 10 18 C7 16.6 4 14 4 10 V5 Z"/><path d="M10.5 4.5 L8.5 9 L11 10.5 L9.2 15.5" stroke-linecap="round"/>`
Resource = battery (stroke 1.8, width 14):
`<rect x="3" y="6" width="12" height="8" rx="2"/><path d="M17 9 V11" stroke-linecap="round"/><path d="M6 10 H9" stroke-linecap="round"/>`
All three: `fill="none" stroke="currentColor" stroke-linejoin="round" flex:none`.

## 8. Resource row (`.resource-row`)
- `display:flex; align-items:center; gap:9px; padding:7px 0; border-top:1px solid var(--color-border);`
- `.resource-name`: `font-weight:600; font-size:13px; color:var(--color-text); flex:1;` (WHITE)
- `.resource-pips` (`inline-flex; gap:4px`) of `.resource-pip`: `11×11; border-radius:50%;
  border:1px solid var(--color-resource); background:var(--color-resource);` — spent pip gets `--off`:
  `background:transparent; border-color:var(--color-border-strong);`. Pip count = the resource `max`;
  filled = remaining (max − spent).
- `.resource-count`: `font-family:var(--font-mono); font-size:10px; color:var(--color-text-muted);
  min-width:26px;` → `${remaining}/${max}`.
- `.recharge-chip`: `font-family:var(--font-mono); font-size:10px; color:var(--color-resource);
  border:1px solid #5a4d28; background:rgba(202,162,74,.08); border-radius:5px; padding:1px 6px;
  white-space:nowrap;` → `long rest` / `short rest` / `dawn` from the token's recharge field.
- then the remove ✕.
- Parse `grant_resource:<id>:<max>:<recharge>` for id/max/recharge. NO duration dropdown on resources
  (they recharge on rests, not rounds) — that is the whole reason they get their own section.

## 9. Remove ✕
- Reuse global `.icon-button` (transparent, `color:var(--color-border-strong)`, cursor pointer, 12px),
  `flex:none`; add a scoped `:hover{ color:var(--color-accent-bright); }`.

## 10. Empty state
If `play.effects` is empty → keep the existing `<p class="trace">No active effects.</p>`.

---

## VERIFICATION (do this, don't eyeball)
1. Feed the SAME demo dataset the mock uses so the compare is fair: 4 buffs (Shield of Faith `AC +2` 100;
   Bless `saves +1d4` 9; War Anthem 8 tags 6; Mage Armor `AC = 13` ∞), 3 debuffs (Bane `saves −1d4` 9;
   Poisoned `disadvantage` ∞; Slowed `speed ÷2` `−2 AC` 10), 3 resources (Arcane Recovery 1/1 long;
   Second Wind 1/1 short; Channel Divinity 1/2 short).
2. Render the built panel, element-screenshot its `.card` at **width 430, deviceScaleFactor 2** (a throwaway
   `_snap.mjs` in the PROJECT ROOT — playwright won't resolve from /tmp), and pixelmatch it against
   `design-preview/effects-final-block.png` (threshold 0.1). Save the diff. Target: only anti-alias noise
   (a few hundred px at most), zero structural diff. Investigate ANY block-shaped diff region.
3. Also run the normal gate: `pnpm check` (0 errors), `pnpm lint`, `pnpm test`, and `tools/visual/shot.mjs`
   for the whole combat route (NB shot clips at viewport height → the effects panel is below the fold, so
   the element-screenshot compare in step 2 is the REAL visual gate here, not the route baseline — see
   [[charnik-repo-tooling]]).
4. Behavioural tests: grouping (buff/debuff/resource split), `effectTag` short forms incl. grant_resource
   parse, duration presets set the right rounds, `∞`/Custom paths.

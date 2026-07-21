# Decisions pending

Master list of every OPEN / PARTIAL item from `AUDIT.md`, migrated here so the audit can be
closed one way or another. Each item is tagged:

- **DECIDE** — a real implementation choice; needs your pick. Options given.
- **CONFIRM** — I have a clear recommendation; just say yes / no / tweak.
- **WORK** — no design choice, just labour. Routed to a `PLAN.md` group; listed so nothing is lost.
- **DEFERRED** — parked by an earlier strategy call (pre-release test pass, docs-gated, low-risk).

Audit IDs are preserved. When an item is decided, tick it in `AUDIT.md` and (if it grew a
design) move the design into `PLAN.md`.

**The questionnaire is the DECIDE + CONFIRM items** (§1–§2). Answer inline: "A9: B", "B26: yes", etc.

**§5 = the EFFECTS-ENGINE MASTER PLAN** — every remaining engine item consolidated in one place,
with per-item implementation plans and ⚠ pitfalls pre-verified against the code (2026-07-21,
at commit `e65f6e9`). Implementer: read §5's checklist FIRST.

---

# §0 · GOVERNING · Strict vs Free mode + the RAW-compliance ledger

**Standing rule** ([[charnik-srd-raw-fidelity]]): Charnik's mechanical output must equal SRD RAW for
the active edition (5e = SRD 5.1, 5.5e = SRD 5.2.1). RAW is often per-effect, not a global rule.

**DECIDE-0 · Strict vs Free mode — PER BLOCK (decided direction, user 2026-07-21).** RAW fidelity is
only enforceable if the manual-override paths are GATED by a strict flag. The mode is **per block
(per modular panel), NOT per character** — a user can be strict on HP but free on custom effects.
- **Precedent already in the builder**: `draft.strict` (stored `char.ui.strict`) drives a segmented
  **Strict ("enforce rules") / Free ("change anything")** toggle (`build/+page.svelte:59`), and each
  build BLOCK reads it to decide enforcement — skills (class cap vs any), spells (access + level caps
  vs everything, `:322`), abilities (3–20 vs 1–30, can't drop a trained skill / known spell in strict).
  Mirror this UI + "each block consults its own strict" pattern on the play/combat side.
- **Gap to close**: build-side `strict` is currently ONE flag governing all build blocks; the decided
  model is per-block storage (each panel its own strict/free), on both build and play. Sub-call: keep
  the builder's single top toggle as a "set all blocks" convenience over per-block state.
- **Strict block** — engine computes/enforces RAW (manual HP-max can't silence `hp_max` effects, slot/
  pact-slot spend enforced, armor-without-proficiency blocks casting, caps enforced).
- **Free block** — manual overrides + custom effects + homebrew relaxations may exceed RAW, visibly flagged.
- Cross-refs: A14 (manual HP-max), custom/temporary effects + manual modifiers, E6 & homebrew schema
  relaxations, the effects-auto global toggle (CLAUDE.md). Confirm: per-block storage + default strict
  + keep a top "all blocks" convenience toggle?

**RAW-compliance ledger** (audited 2026-07-21 against SRD text; RAW-neutral items — CSS/typing/
storage/tooling/tests — omitted).

*Verified RAW-CORRECT (already fixed):* A1, A2, A3, A4, A5, A6, A8, A10, A11, A13, A15, A16,
A17-core, D13.

*RAW VIOLATIONS — strict must fix (all open, tracked at their IDs below/in AUDIT):*
| ID | Breach | SRD basis |
|----|--------|-----------|
| A7 | non-proficient weapon still gets prof bonus | no prof bonus if not proficient — KNOWN GAP (needs proficiency data model) |
| A9 | competing `set` folds by max → grapple loses | grappled = speed 0 + blocks speed bonuses; per-effect direction (re-specced above) |
| A17-rem | pure-warlock cast not slot-gated | Pact Magic must expend a pact slot — CONFIRMED in code (`slotToSpend` returns null when the leveled-pool filter excludes pact pools, `rules/spellcasting.ts:55-57`) |
| A18 | cast + prepared-cap pick `classes[0]`, not the spell's granting class | derive IS per-class-correct (combined caster level + per-class DC verified); breach is `state.svelte.ts:450` (cast heal/attack mod) + `:526` (`preparedCap`) + global `preparedCount` — a Wiz/Cleric casts cleric spells off INT. `accessSpellIds` already maps spell→class |
| B2 | death saves + hit-dice UI/logic unbuilt; exhaustion play-state field absent | core RAW. Exhaustion DESIGN decided (PLAN per-system ladder): **2024 modelable now** (`d20_tests -2*exhaustion` / `speed -5*exhaustion`); **2014 needs G4** below |
| G4 (2014 exhaustion) | ~~no multiply/halve pipeline op~~ ✅ op DONE (EFX-G4, 2026-07-21): `halve:speed` / `halve:hp_max`. 5e-only RAW gap now modelable; awaits exhaustion DATA rows (EFX-EXH) |
| B9 | no armor-no-proficiency casting block; passives miss ±5 | can't cast in armor you lack proficiency; passive ±5 for adv/dis |
| B19 | durations frozen out of combat | duration = elapsed-time RAW, combat-independent |
| B25 | Eldritch Knight / Arcane Trickster get no slots | both third-casters per RAW |
| D9 | magic weapon +X inert | +1 weapon = +1 attack & damage |
| D16 | half-feat / choice content unrepresentable | can't build those characters to RAW |
| E1 | no 5.5e languages file → empty picker | content gap |
| E4 | feature `effects` still sparse; exhaustion excepted | CONDITIONS-1 (2026-07-19, post-audit) wired all 14 mechanical conditions BOTH editions → conditions DONE; remaining = feature rows + exhaustion |

*FREE-MODE-only deviations — allowed, but must be gated by DECIDE-0 so strict enforces RAW:*
A14 (manual HP-max), custom/temporary effects + manual modifiers, E6 + homebrew schema relaxations.

---

# §0.5 · RESOLUTIONS (user, 2026-07-21)

Decided; move each into `PLAN.md` under its group when implemented, tick in AUDIT.

- **DECIDE-0** — strict/free is **per block ONLY** (no top "set-all" convenience toggle). Each modular
  panel carries its own strict/free; default strict. Build-side `ui.strict` (single flag) migrates to
  per-block storage.
- **A9** — RAW per-effect set mode (floor/cap/absolute) + speed-0 condition bonus-block. (token spelling: my call)
- **A14** — Option B (effects layer on the base + clamp current); manual max = a Free-block affordance.
- **B19** — **BACKLOG. Stays FROZEN out of combat for now** (durations don't tick outside combat). Revisit later.
- **B3** — backups = **3 last edits + 3 snapshots taken at the last 3 app starts**. Rationale: a single
  D&D session writes 100+ changes to `character.json` (HP/slots/resources all live there), so per-edit
  rotation alone is too churny — pair it with per-launch snapshots.
- **D16** — **A** (one general player-choice model; unify the existing ASI mechanisms — reuse over new).
- **B17** — **B + baked fallback** (live ref+resolve, fall back to baked for orphaned refs).
- **B18** — **BACKLOG; A (accept EN) for NOW, temporary** — revisit before more consumers bake in.
- **D12** — **A** (honor `eff.layer` for token sets).
- **B24** — **A** (per-file granular reparse; implement the invariant).
- **A7** — **B** (build a weapon/armor-proficiency data model; unblocks B9's weapon half). RAW-correct target.
- **B8** — **A** (real drop-in: load locale JSON from the dataDir via the Storage seam).
- **D-T** — **A** (write T1/T2/T3 now); **T4/T5 → backlog**.
- **E6** — **A** (relax `classes.saves` to 0–6). Homebrew support is a core goal — don't restrict it.
- **RAW ledger → WORK** (no design choice, implement to RAW): A17 warlock slot-gate, A18 spell→granting-class,
  B9 armor-block + passive ±5, B25 subclass casters, D9 magic-weapon +X, E1 5.5e languages, E4 feature/exhaustion
  tokens, 2024 exhaustion, G4 (2014 exhaustion halve-op).
- **D8** — **A** (RollTray implements the `DiceTrayRequest` contract: register on mount + formula↔pool
  adapter + grow the request to carry pool/mods/queued-damage). One roll representation through one seam.
- **E7** — **A** (drop the dead `class_feature.resource` column) — but INSIDE the RESOURCE-MODEL
  COMMITMENT below (user 2026-07-21: "support all SRD + popular homebrew from the start"). Resources are
  co-located in the feature's own `effects` cell; a friendly homebrew sub-form emits the token.

  **RESOURCE-MODEL coverage commitment** (→ PLAN, spellcasting/resources group). Formula maxes already
  work (`grant_resource:ki:class_level.monk:short` is a tested case). To cover the real catalogue, three
  pieces must land:
  1. **Table-max authoring for count pools** — Rage 2→6, Blood Maledict, Infusions-known are step tables,
     not formulas. **PATH DECIDED — LOW effort (~40 lines, half-day):** add ONE whitelisted expression
     function `step(index, t1->v1, t2->v2, …)` (breakpoint lookup: value of the highest threshold ≤
     index; `->` pair syntax decided 2026-07-21 — flat number lists were unreadable) to `FUNCTIONS`
     (expression-parser) + an evaluator arm + tests. The `grant_resource` max slot ALREADY runs
     through the L2 evaluator (`grant_resource:ki:class_level.monk:short` is a passing test), so the
     sugar appears there for free — NO dep-graph / apply.ts changes. Rage becomes
     `grant_resource:rage:step(class_level.barbarian, 1->2, 3->3, 6->4, 12->5, 17->6, 20->inf):long`.
  2. **A scaling-die/value primitive** — Bardic Inspiration d6→d12, Martial Arts die, Sneak Attack Nd6,
     Crimson Rite die (homebrew). **MOSTLY CLOSED BY THE SAME `step()`**: expressions already compose with
     the `d` dice operator, so `1d step(class_level.bard, 1->6, 5->8, 10->10, 15->12)` = scaling die
     SIZE and `step(…) d 6` = scaling die COUNT. One sugar closes pieces 1 AND 2 (language-level; see
     the REVIEW below for the missing roll surface).
  3. **Per-resource USE mechanics** (already logged in §4, deferred) — spend-on-options / conversions.
     **DESIGN SKETCH (2026-07-21):** a resource gains a linked options table `resource_options.csv`
     (keyed `resource_id`): `resource_id, id, name_*, cost, action`. `cost` = an L2 value expression
     (`2`, `spell_level`, `step(...)`) reusing the expression layer; `action` = a bounded vocab —
     mostly the EXISTING effects (`apply_condition` = Stunning Strike, a roll/heal = Lay on Hands,
     `note:` = descriptive). USE flow mirrors the "+" effect menu: tap resource → picker of options+costs
     → afford-check (`cost ≤ remaining`, else disabled) → spend → run action (roll into tray / apply
     effect / heal). Core covers Ki / Channel Divinity / Superiority Dice / Lay-on-Hands. **Deferred hard
     edges:** (a) cross-pool CONVERSION (SP↔slots) — new `spend:<res>:<n>` / `restore:<slot>:<lvl>`
     actions with cost tables; (b) context-dependent cost (Twinned = spell level) — couples to the
     in-flight cast; (c) content-PICK options (Wild Shape) — resolves to a filtered stat-block = its own
     "alternate form" subsystem. Validate the core against Ki / Channel Divinity / Metamagic / Wild Shape.
  Separate follow-ups: E4 (encode tokens — Rage's `effects` is empty today), D17 (homebrew form `kind`
  option list). Coverage matrix lives in this decision; validate any model against Rage / Ki / Bardic
  Inspiration / Channel Divinity + homebrew Blood Hunter / Artificer.

  **REVIEW 2026-07-21 (design check before implementation).** Findings that amend the above:
  - **`step()` semantics pinned (+ pair syntax, user 2026-07-21):** pairs are written `t->v` — a
    flat number list (`1,2, 3,3, …`) was judged unreadable. `->` is a new lexer token; a pair is a
    special arg form legal ONLY inside `step()` args, so arity is simply "index + ≥1 pair" (no
    odd/even parity check needed — a pair is ONE argument) and it contains no `:`/`?`, so token- and
    guard-splitting stay safe. Fold = MAX threshold ≤ index regardless of pair ORDER (robust to
    unsorted authoring) + a lint warn on unsorted/duplicate literal thresholds; no match (index below
    first threshold) → **0**, matching the absent-var→0 degrade. Follow-up: `grant_resource` should
    SKIP a pool whose resolved max ≤ 0 (today `class_level.monk` on a non-monk yields a 0-pip pool,
    `apply.ts:258` only skips `undefined`; step() makes that case common).
  - **Dice-count lexing widened (user 2026-07-21, UX):** `(level) d 6` reads weird → the lexer rule
    becomes "`d` is the dice op after any OPERAND token: a number, `)`, or an identifier that is not
    a word-operator (`and`/`or`/`not`)", so `level d 6` / `class_level.rogue d 6` parse without
    parens. No valid expression breaks (the only idents that legally FOLLOW an operand are
    `and`/`or`, which don't start with `d`); nonsense like `level dex_mod` stays an error (the
    message shifts to unknown-variable). Bonus sugar via the same rule: a bare `d6`/`d20` with NO
    preceding operand desugars to `1d6`/`1d20` (tabletop habit; no whitelisted variable matches
    `d<digits>`, so zero collisions). Plus (user 2026-07-21): an identity function **`var(x)`** in
    the whitelist (~3 lines) for a glued no-space form — `var(class_level.rogue)d6` — since users
    instinctively write around `d` without spaces; `(expr)d6` glued already works (after `)` the
    lexer sees the op), spaces stay supported everywhere. **Fully-glued `leveld6` is NEVER-support
    (user 2026-07-21)** — an indivisible identifier; guessing a split would be worse. ARTICULATE the
    supported forms: in authoring docs (the forms table: `2d6+3` / `d20` / `level d6` /
    `(expr)d6` / `var(x)d6`) AND in-product — the unknown-variable parse error for a name matching
    `<var>d<digits>` gains a "did you mean `<var> d<digits>`?" hint (PLG-9 did-you-mean family).
    `var()` passes dice and `inf` through untouched (identity = terminal-safe).
  - **The examples above carried DATA ERRORS:** Bardic Inspiration die steps at levels 5/10/15
    (d8/d10/d12), NOT 11/17 (those are Martial Arts levels); and it scales by BARD level
    (multiclass-correct), not total `level`. Corrected:
    `1d step(class_level.bard, 1->6, 5->8, 10->10, 15->12)`; Martial Arts (5e) =
    `1d step(class_level.monk, 1->4, 5->6, 11->8, 17->10)`. **Sneak Attack needs NO step():**
    `ceil(class_level.rogue/2) d 6` composes today.
  - **RAW gap → DECIDED v2 (user 2026-07-21): single-token `inf`, as a TERMINAL literal.** (v1 —
    two tokens with a `class_level.barbarian>=20 ?` guard — rejected: splitting one value off is bad
    authoring UX.) 5e Rage at barbarian 20 = **Unlimited** (SRD 5.1 table); 5.5e caps at 6 (no pair).
    Design: `inf` is an expression literal with **terminal-value semantics** — legal to PRODUCE
    (a step() pair value `20->inf`; an if() branch — both return values through untouched), illegal
    to COMPUTE WITH: every arithmetic result still flows through the existing finite-guard
    (`num()`, `expression-evaluator.ts:58`), so `inf+1` / `inf-inf` / `0*inf` stay loud errors and
    NaN can never escape — ZERO new arithmetic guards; the carve-out is one AST node whose eval
    bypasses `num()`. Comparisons work naturally (`inf > x`); `min(inf, x)` = x (finite fold —
    legal AND semantically right); `max(inf, …)` folds to Infinity → errors — compose via step/if. Consumers: the
    `grant_resource` max slot special-cases Infinity through the `MAX_RESOURCE_MAX` clamp → UI
    renders **∞** (a dedicated branch — `Array.from({length: Infinity})` would throw; consistent
    with B10 pips-≤12-else-numeric); every OTHER value slot rejects a non-finite result in
    `resolveEffectValue` ("inf is only valid as a resource max") → standard degrade. No JSON hazard
    (`ResourceDef` is derived, never persisted; only `resourcesSpent` lands in character.json).
  - **Piece 2 is NOT closed by step() alone — the language composes, but no product surface consumes
    a scaling DIE.** `grant_resource` max must resolve to a NUMBER (`apply.ts:255` errors "resource
    max is not a number" on dice), and RollButton formulas go through `rules/dice` parseFormula, not
    the L2 evaluator — `1d step(…)` won't parse there. Missing piece = a roll SURFACE: e.g. a new
    `grant_roll:<id>:<expr>` effect kind → a facts.rolls entry → a rollable chip that resolves
    expr→diceFormula→`DiceTrayRequest`. Sequenced AFTER D8 (tray unification) and aligned with the
    D9/D10 mechanics-to-columns direction. Small DECIDE (token vs feature column) before piece 2
    counts done.
  - **Piece 3 catalogue corrections:** (a) **Stunning Strike is NOT `apply_condition`** — the stun
    lands on the TARGET creature and Charnik has no target model; applying `stunned` to self is a
    bug. It's `note:` + save-DC display. Valid `apply_condition` use = SELF conditions (Rage).
    (b) **Lay on Hands / Preserve Life are VARIABLE-spend** ("spend X, heal X") — a fixed `cost`
    expression can't model them; the cost grammar needs an `x` (player-picked amount, 1..remaining)
    kind whose action can reference the spent amount. (c) The cost-examples line lists `spell_level`
    while edge (b) defers it — contradiction; core cost = L2 expr over EXISTING vars + `x` only.
    (d) `resource_id` links to a grant_resource token id ("ki") — NOT a content row, so it's a FLAT
    namespace (not source-namespaced). Treat as a feature (homebrew extends core ki options,
    B26-style) and document deliberately; option-row identity = `(resource_id, id)` via the existing
    collision UI. Bonus: "largest max wins" (`apply.ts:268`) is RAW-correct for multiclass Channel
    Divinity (uses don't stack). (e) Superiority-die "add after seeing the roll" is context-coupled
    like Twinned — v1 = roll the die into the tray, note the limit. (f) An option whose cost fails to
    evaluate (or resolves to dice) → disabled + content-health issue, the standard degrade.
    (g) **Placement (user 2026-07-21): combat-action options (Flurry of Blows, Stunning Strike —
    anything that IS an attack/action) belong in the ACTIONS/attacks block, NOT under the resource
    pips.** Option rows therefore carry an `action_type` (action / bonus_action / reaction / free) +
    placement; the actions panel lists them with a cost chip (tap = afford-check + spend), resource
    pips stay pure counters. Per-resource nuances expected — design the split when building piece 3.
  - **Implementation order:** 1) `step()` + tests (small, ~half-day holds). 2) the roll-surface
    DECIDE + wiring (medium; after D8). 3) `resource_options.csv` schema/loader/picker-UI (larger,
    days; must respect `isRowActive` — B5/B15 apply to the new table too).
- **S2** — **A** (restrict `allow_data_dir` grants to paths the dialog plugin returned). Non-trivial:
  thread a Rust-side allowlist of dialog-issued paths, reject others. Security-hardening WORK.

# §0.6 · Context for D8 / E7 / S2

## D8 · Two dice-tray stacks — can it be ONE? YES. — ✅ DONE (2026-07-21)

**Landed** (option A): `DiceTrayRequest` grew optional `pool`/`mod`/`advantage`/`mods`/`queuedDamage`
(its documented growth path; `QueuedDamage` type) — a formula-only caller omits them. `CombatVM`
implements the seam: `handleTrayRequest` prefills the rich `RollTray` (formula↔pool adapter =
`parseDamage`, or a pre-split pool) + queues damage + opens the dice menu (`openMenuCentered` for the
anchor-less programmatic case); `registerTray` wires it to `registerDiceTray`, registered via
`onMount` in `+page.svelte` (auto-unregisters on leave → fallback restored). Net: a generic
`openDiceTray({label,formula})` anywhere in combat now opens the REAL tray (pool, advantage,
attack→damage chain), not the instant-roll fallback. Test: the seam carries the rich fields through
unchanged. Unblocks EFX-ROLL.

**Original analysis below (retained):**
- **Contract** (`lib/dice/tray.svelte.ts`): `DiceTrayRequest {label, formula}` + `registerDiceTray` /
  `openDiceTray`. A component registers a handler on mount; with none, the fallback rolls instantly +
  toasts. Used by `RollButton.svelte` (the generic roll affordance — works on compendium, anywhere).
  Formula-STRING based. Its doc explicitly says the impl "can grow richer behind it — adv/dis, flat
  mods, an attack→damage chain — without changing callers".
- **RollTray** (`routes/combat/roll.svelte.ts`): the rich combat roll builder — pool (`Record<sides,count>`),
  mod, advantage, reroll/min_die mods, **attack→damage chaining** (`queueDamage`/`pendingDamage`), a
  200-entry roll log. But it **never registers the contract** — it's a parallel impl inside CombatVM.
- **Consequence**: RollButton anywhere (even in combat) hits the instant-roll FALLBACK, because the rich
  tray isn't exposed through the seam. The features the contract promises already EXIST in RollTray.
- **Verdict — one variant is possible AND sensible (= your instinct)**: pick **A** — RollTray *implements*
  the contract (registers on mount; a formula↔pool adapter bridges the two representations; grow
  `DiceTrayRequest` to optionally carry a pool + mods + a queued damage roll, its documented growth path).
  One representation surfaced through the one seam; every roll button gets the real tray. Work = the
  adapter + the request-shape growth. Confirm **A**.

## E7 · `class_feature.resource` column — drop vs wire
- The column (`schemas.ts:252`) is a bare NAME ("rage"/"ki") with **no max, no recharge, no count** —
  it CANNOT actually grant a working resource. Zero consumers. Real resources come only from a
  `grant_resource:<id>:<max>:<recharge>` token in the feature's `effects` column (max + recharge encoded).
- **A · Drop** — one mechanism (the token) is the real, complete path (matches data-driven-classes:
  mechanics as tokens). The homebrew FORM can render a friendly "resource" sub-form that EMITS the
  token, so non-technical authors never type it. **Recommend A.**
- **B · Wire** — to work it would need to grow `resource_max`/`resource_recharge` columns too —
  duplicating exactly what `grant_resource` already encodes. A bare-name column is a trap (looks like it
  grants a resource, silently does nothing).
- Ties **D17** (the homebrew form's `kind` option list bug). Your pick.

## S2 · `allow_data_dir` accepts ANY path — restrict vs document
- `allow_data_dir(path)` (`src-tauri/src/lib.rs:6`) grants the fs plugin **recursive read/write to any
  path** the renderer passes; invokable from any renderer JS. Purpose = the folder-picker escape hatch
  ("own your data" / move the data dir outside the static scope).
- **Current mitigations (strong)**: CSP + no remote code (SECURITY.md); content is parsed CSV (not eval),
  effects are interpreted data (not eval), plugins run in a QuickJS zero-cap sandbox. So an attacker needs
  arbitrary JS in the renderer FIRST — no such path today.
- **Residual risk**: IF a future content/render XSS ever gives arbitrary renderer JS, `allow_data_dir('C:\\')`
  escalates from "read app data" to recursive read/write of the whole disk — the single widest capability.
- **A · Restrict** to paths the dialog plugin actually returned (defence in depth). Non-trivial: Tauri
  doesn't hand Rust "was this path user-picked" for free — you'd thread a Rust-side set of dialog-issued
  paths and reject others. Real work.
- **B · Document** as accepted risk in SECURITY.md §9, gated by CSP/no-RCE.
- **Recommend B now, A as a hardening backlog item** (do A the moment any content-XSS surface appears).
  Your call — it's a security posture decision.

---

# §1 · DECIDE — real implementation choices

## D-A9 · Competing `set_override` resolution — must reproduce SRD RAW, not a heuristic — A9
Same-layer sets fold by `Math.max` (`pipeline.ts:69`) → grappled `set_override:speed:0` loses to
any other speed set, character keeps moving. **DECIDED framing (user 2026-07-21): Charnik output must
equal SRD RAW for the active edition — there is no invented "potency" model.** RAW gives no single
global rule; each set carries its own comparison semantics, and a blanket `max` OR `min` is wrong:
- **Grappled / Restrained** (SRD 5.1 & 5.2.1): *"speed becomes 0, and it can't benefit from any
  bonus to its speed"* → hard 0 **and blocks all speed bonuses** (the bonus-block is explicit RAW the
  pipeline ignores today — a +10 speed effect wrongly survives a grapple). Two → still 0.
- **Headband of Intellect** (SRD 5.1): *"Intelligence is 19 … no effect if already 19 or higher"* →
  a **floor = `max(current,19)`**, NOT an absolute set. A `min` rule would break it.
- Hypothetical "STR becomes X unless already lower" → a **cap = `min`**.
Same op, opposite directions → the mode must live on the effect.

**Model (matches RAW, no author guesswork):** `set_override` gains a comparison mode —
- **absolute** (default) — plain set / single value.
- **floor** (`≥`, "unless already higher") — Headband; fold = `max`.
- **cap** (`≤`, "unless already lower"); fold = `min`.
Plus a **speed-0 condition rule** for the grappled/restrained/paralyzed/stunned/petrified/unconscious
family: set 0 **and block speed bonuses** (its own RAW clause, not the generic set-fold).
This is the accepted direction; remaining sub-call is only the token spelling for the mode
(e.g. `set_override:int:19:floor`) vs deriving it from the condition/item row. Route to PLAN effects.

## D-A7 · Model weapon/armor proficiency as data? — A7
`computeAttacks` adds proficiency unconditionally — no schema column to check against (deliberate leniency).
- **A** — stay lenient forever (never wrong-downward, sometimes wrong-upward). 
- **B** — add a weapon/armor-proficiency data model (class/species grant lists + item categories) and gate the bonus.
- **Recommend A for now**, revisit if a proficiency data model lands for another reason. → PLAN if B.

## D-B8 · i18n "drop-in a locale without rebuild" — real or reword? — B8
Catalogs are bundled via a Vite template import; the module comment's "drop in a JSON, no rebuild" is fiction. Also ~only 10 files use `$_()`.
- **A** — make it real: load locale JSON from the dataDir at runtime through the Storage seam (matches "own your data").
- **B** — reword the promise to "bundled locales" and drop the claim; keep coverage work (the hardcoded-EN sweep) separate.
- **Recommend A** (it's a stated product promise and cheap via the existing seam). Coverage sweep is WORK either way.

## D-B17 · `play.effects` = baked tokens vs live refs — B17
Active buffs bake tokens+label from the catalog at add-time → fixing a catalog row doesn't propagate, label doesn't re-localize.
- **A** — keep baked (portable, survives catalog deletion; current).
- **B** — store a ref + resolve at derive (propagates fixes, re-localizes) with a baked fallback for orphaned refs.
- **Recommend B with fallback** — pairs with D-B18 (localized provenance) and the refs-not-copies invariant.

## D-B18 · Localizable provenance (structured facts vs baked EN) — B18
`gatherEffects` bakes `name_en`, notes are English strings ("advantage on skill.stealth"), `why()`/roll-log concat them → explainability can't localize. Every new consumer bakes more in.
- **A** — accept EN provenance (explain-in-English only).
- **B** — refactor the `{value,trace,notes}` contract to structured facts (source ref + op + params), localized at render.
- **Recommend B, and soon** — the cost only grows. Big, cross-cutting; route to PLAN effects group. Ties D-B17.

## D-B19 · Out-of-combat duration expiry model — B19
`play.round` advances only via `nextTurn`; outside combat a 10-round Bless never expires (only a rest clears it).
- **A** — real-time wall-clock ticking (rounds = 6s) even out of combat.
- **B** — a manual "advance round" control usable outside combat.
- **C** — keep current (durations frozen out of combat; rest-only expiry) and document it.
- **Recommend B** — deterministic, no background timer, matches tabletop pacing. A is surprising; C is a latent bug.

## D-B24 · Watcher granular reload vs reword — B24
`watcher.ts` debounces into a full `reloadContent()`; CLAUDE.md promises "reparse only the changed file".
- **A** — implement per-file reparse (real perf win, matches the invariant).
- **B** — reword the invariant to "full reload on any change" (perf-only today).
- **Recommend B now** (perf isn't biting), tag A as a PLAN perf item. Your call on ambition.

## D-D8 · Unify the two dice-tray stacks — D8
`lib/dice/tray.svelte.ts` (DiceTrayRequest contract) vs `routes/combat/roll.svelte.ts` RollTray (pool-based, never registers the contract). Two representations, two log paths.
- **A** — RollTray adopts the DiceTrayRequest contract (the seam "every caller talks to").
- **B** — collapse both into the pool-based RollTray, delete the unused contract.
- **Recommend A** if the DiceTray contract is the intended public seam (3D-dice, attack/damage chaining plans lean on it); else B. Depends on the DiceTray/attack-damage direction (see memory `dicetray-attack-damage-concept`).

## D-D12 · `set_override` layer: honor `eff.layer` vs force `override` — D12
`effects/index.ts:178` forces every set to the `override` layer, but the pipeline is designed for layered sets and PLUGINS.md lets plugin contributions set at feature/item layers → token path and plugin path give the same op different semantics.
- **A** — honor `eff.layer` for token sets too (consistent with plugins + pipeline design).
- **B** — keep forcing override, document sets as always-top, forbid layered plugin sets.
- **Recommend A** — the pipeline already supports it; removes a special case.

## D-D16 · Player-choice dimension in the content model — D16
Half-feat "+1 to an ability of your choice", Magic Initiate spell picks, feat-granted expertise are unrepresentable (tokens static, a feat slot holds only a ref). THREE ASI mechanisms already coexist; a fourth ad-hoc one compounds it.
- **A** — a general `choice` model (a token/column that declares a choice-group; the character JSON stores the resolved pick), unifying the existing ASI mechanisms.
- **B** — narrow per-case hacks (a `boost_choice`-style mini-grammar per feature kind).
- **Recommend A**, designed deliberately — big feature. Route to PLAN (N-group / effects). Not now.

## D-E6 · `classes.saves` exactly-2 constraint — E6
`z.array(Ability).length(2)` drops a homebrew class with 1 or 3 saves.
- **A** — relax to `.min(0).max(6)` (homebrew-first).
- **B** — keep strict (SRD classes all have 2).
- **Recommend A** — arbitrary stiffness against the homebrew-first stance; near-zero cost.

## D-E7 · `class_feature.resource` column — wire or drop — E7
Zero consumers; resources come only from `grant_resource` tokens.
- **A** — drop the column (tokens are the one path).
- **B** — wire it as an alternate authoring affordance.
- **Recommend A** — one mechanism (`grant_resource`) is cleaner; deleting a dead column is honest. Ties D-D17.

## D-S2 · `allow_data_dir` accepts ANY path — S2
Any renderer JS can extend the fs scope to an arbitrary dir (recursive+write) — the single widest capability. By design (folder-picker escape hatch), gated by CSP/no-remote-code.
- **A** — restrict grants to paths the dialog plugin actually returned (tighten the capability).
- **B** — document as accepted risk in SECURITY.md §9 and move on.
- **Recommend A if feasible** (defence in depth), else B with an explicit risk note. Security call is yours.

## D-B3 · Rotating-backups policy — B3
Backup half of "autosave + rotating backups" is unbuilt (atomic temp→rename exists).
- Decision is just the policy: **how many** backups + **rotation** (e.g. keep last 5, timestamped) and **when** (every save vs debounced/daily).
- **Recommend**: keep last 5 timestamped copies per character, written on save (debounced). Confirm or set numbers. Then WORK.

## D-T · Pull test-hardening forward? — T1–T5
Full coverage pass is deferred to pre-release. But T1 (`content/store` 5% — the "stuck on Loading…" path), T2 (`storage/fetch` 0% — whole web build), T3 (data-move orchestration) guard real user stories TODAY.
- **A** — write T1/T2/T3 now; keep T4/T5 for the pre-release pass.
- **B** — hold the whole line until pre-release (current strategy).
- **Recommend A** — these three are live-user-story risk, not percentage-chasing.

---

# §2 · CONFIRM — I have a recommendation; just say yes/no

## C-A14 · HP-max: manual override vs `hp_max` effects — A14 — ✅ DONE (2026-07-21, EFX-A14)
`play.hp.max ?? sheet.maxHp.value` → a manual max silently disabled ALL `hp_max` effects. FIXED:
`effectiveHpMax` re-folds effect layers on top of the manual base; `clampCurrentHp()` (reactive,
idempotent) pulls current down when the live max drops. See §5 EFX-A14.

## C-B26 (+D18) · Feature source-pinning blocks homebrew SRD extension — B26, D18
`derive.ts:181` (`f.source !== classRow.source`) means PHB features a user adds for the SRD fighter never match — contradicts "users add their own content".
- **Recommend**: match on `(class_id, edition)` + respect `isRowActive`; treat same `(class_id, level, id)` from two sources as a COLLISION resolved by the existing keep-one/keep-all UI (warn+apply-one default). Fold the unused `graph.featuresForClass` (test-only consumer) in as the one query owner (**D18**). Confirm the direction.

## C-D14 · Character id = GUID, slug as hint — D14
`slugify(name)` → two "Hero"s overwrite each other's save. Violates the GUID-for-shareable-data principle.
- **Recommend**: id = `crypto.randomUUID()`, slug stays as folder/display hint; migrate existing saves (id-add migration). Confirm.

## C-D2 (+G5) · Single source for the editions union — D2, G5
`pipeline.ts System` literal vs `stores/app SystemId`; F7 already made `rules/pipeline` own `SYSTEMS`. D2's remaining ask + the `character.system as System` no-op cast (G5, still at `derive.ts:320`) resolve together.
- **Recommend**: finish routing everything through `pipeline.SYSTEMS`/`System`, delete the cast. Confirm (essentially WORK, but it touches the seam).

## C-W1 · `pnpm-workspace.yaml` `allowBuilds` placeholder — W1
Literal `simple-git-hooks: set this to true or false`.
- **Recommend `false`** (the project's own postinstall runs the CLI). Confirm true/false.

---

# §3 · WORK — no design choice, routed to PLAN (listed so nothing's lost)

These need labour, not a decision. Grouped; each keeps its audit ID. Confirm the routing or
re-tag any you'd rather decide on.

**Conditions & play-state ladder** (PLAN → EXPR / play-state)
- **B2** — build hit-dice spend/restore, death-saves tracker, exhaustion ladder (exhaustion design already DECIDED → data-driven per-system ladder). Ties **D19** (exhaustion `max(6)` hardcoded → data), **L2R-16** (`is_raging` reads hardcoded `RAGE_CONDITION_ID` → dies with the conditions-as-data model).

**Source filtering everywhere** (PLAN → content loading; B6 already decided to move config into dataDir)
- **B5** — apply `isRowActive` in Ctrl+K search, ALL builder pickers, spellbook (currently one call site).
- **B15** — `gatherEffects`/`deriveSheet` must respect disabled files/sources + resolved collisions (derive reads raw graph today).

**Spellcasting gaps** (PLAN → Spellcasting model; core is per-class, the collapse is UI)
- **A18** — cast DC/attack/heal-mod + `preparedCap` + both prepared-togglers use `classes[0]`; wire per-class profiles through the UI.
- **B25** — `deriveSpellcasting` ignores subclass caster columns (Eldritch Knight / Arcane Trickster get no slots); the homebrew form shouldn't offer dead fields until wired.
- **A17 remainder** — warlock PACT slots not rendered as pips (pure-warlock cast isn't slot-gated); ritual SOURCE nuance (L13); manual UPCAST picker (L10 — auto-lowest for now). Upcast picker is a small feature.

**Attack/damage as data, not string round-trips** (PLAN → calculators; ties A7/A9)
- **D9** — `computeAttacks` builds a display string then re-parses it (`parseDamage`); add a magic-weapon bonus path (a +1 sword is inert — item effect tokens don't reach rolls).
- **D10 / D6** — mechanics parsed out of prose: `healDice` regexes `text_en` (UA-only homebrew heals nothing), `durationToRounds` parses duration prose, `castingIcon` regexes casting_time, `effectHint` hardcodes EN spell names. Move mechanics to columns; prose stays display.

**Effects panel completeness** (PLAN → effects)
- **B14** — `collectFlags` has zero production consumers; the panel shows only `play.effects`, so content-borne item/feature buffs (and their unknown tokens) are invisible. Ties the panel raw-tokens note (guarded tokens render as unknown in the "what I added" list) from L2R.

**Units** (PLAN → play-state / sheet)
- **B7** — lb→kg conversion nowhere; `carryingCapacity` computed but never rendered; the optional-capacity toggle doesn't exist.

**Rule-based blocks** (PLAN → effects/rules)
- **B9** — no rule emits a block (e.g. "spellcasting blocked: armor without proficiency", PLAN's own example); passives never take the ±5 adv/dis adjustment in code.

**Cost caps on untrusted content** (PLAN → PLG cost-cap class)
- **B10** — resource-pip render is O(max) (data cap `MAX_RESOURCE_MAX=1000` landed; remaining = O(1) threshold: pips ≤~12, else numeric `spent/max`).
- **B11** — `Storage.read()` has no size cap; add `size` to `FileEntry` (near-free from the same `stat`) and skip over-cap files before reading. Cross-cutting interface change (types + Tauri fs + memory impl + consumers).

**Persistence** (PLAN → storage / logging)
- **B4** — roll log never persisted (`appendLog`/`readLog` test-only; `log.jsonl` never written; `appendLog` is read-all+rewrite — fix when wiring).
- **B3** — rotating backups (policy in §1 D-B3).

**Structure / CSS** (PLAN → refactor / house-pattern splits)
- **D1** — `build/+page.svelte` 1032 lines (next: PanelCard 775, CombatMenus 759, EditContentForm 733) — split per VM+blocks+curated-CSS.
- **C2** — same class name / different styles across components (`.skill-name`, `.spent`, `.used`, …) — fold into the combat-class rename pass.
- **C3** — cross-file CSS duplicate clusters — hoist shared vocabulary into `components.css` (same pass as the jscpd ratchet).
- **D3** — `CombatVM.pinned` demo hardcode → move to `ui`, persist per character (ties the **Pin** entry, §4).

**Homebrew schema correctness** (PLAN → data model)
- **D17** — `ENUM_OPTS.kind = EFFECT_KINDS` in the homebrew form, but `kind` as a `spell_slots` column should be full/half/third/pact — verify + fix the option list. Ties D-E7.

**Typing gaps** (PLAN → typing group G)
- **G1** — 37× `String()`/`Number()` coercions over already-typed rows (worst: `String(row.data.concentration)==='true'`).
- **G2** — `ab as Ability` ×12 in `build/+page.svelte` markup (fix the iterator type once).
- **G3** — `abilityBoosts`/`spellSlotsSpent`/`panelColumns` keys looser than the domain unions.
- **G4** — `effectHint(Record<string,unknown>)` / `detail.localized()` accept untyped bags though callers hold typed rows.
- **G5** — the `character.system as System` no-op cast (dies with C-D2).

**Data content** (convert from CC-BY SRD via converters — NEVER hand-author)
- **E1** — `srd-2024/` has no `languages_srd.csv` → empty 5.5e language picker.
- **E4** — most SRD condition/feature rows carry EMPTY `effects` columns (engine ready, tokens not encoded); the Haste `flat_bonus:action+1` target is now documented (B13).

**Small leftovers**
- **F6** — inline `e instanceof Error ? …` in translate/+page + the updater could adopt the shared `errText`.
- **F8** — focus-trap + backdrop-dismiss half of the dialog shell (Escape half done) → folds into the planned A11Y-1 dialog-shell.
- **D19 remainder** — `RollEffects.flat` carries its "ignore for save/skill keys" contract in a comment, not the type (`helpers.ts:66`).
- **C1** — the last ~5 gold/teal hardcoded colors need light-theme token VALUES (a visual-design call — see §4).

**Working-tree nits** (PLAN → REL/housekeeping)
- **W2** — `translate/+page` + `spellbook/+page` hang on "Loading…" forever on content-load failure; build page renders empty pickers → adopt the `<Loading error>` pattern.
- **W3** — version drift: `Cargo.toml` 0.2.0 vs 0.3.0 in package.json + tauri.conf.json — sync.
- **W4** — `mergeDataDir` comment overclaims "same rollback as migrateDataDir" (merge can't sweep half-copied into a non-empty target); also record that merge+deleteOld intentionally discards the source copy of a collision the target won.
- **W5** — `walkTree` has no symlink-cycle guard (looped symlink → infinite recurse). Edge, low priority.
- **S1** — `TauriStorage.abs` traversal check misses backslashes (`read('..\\x')` passes on Windows); normalize `\`→`/` before splitting. fs-scope is the backstop but the seam's own validation is half-broken → security WORK.
- **B23** — build the `tests/integration/` tier (temp roots, watcher self-write, save/load round-trip) OR stop documenting it as present. Ties D-T.

---

# §4 · Pre-existing entries (kept) + DEFERRED

### C1 · Light-theme values for the last hardcoded colors *(needs your visual call)*
Zero-risk swaps done. Remaining sites need light-theme token VALUES:
- **Gold border** `#5a4d28` (dark) — `.recharge-chip`, `SpellHead`, resource hover tints. Needs `--color-resource-border` (dark `#5a4d28`, light **TBD** — `#d8c48f`?).
- **Teal border** `#2c4a45` (dark) — PanelCard. Needs `--color-good-border`, light **TBD**.
- **Gold-tinted popover surface** `#221c10` (EffectDurationMenu) + `#1a1400` (settings). Reuse `--color-resource-soft`, or dedicated tokens (hues differ slightly)?
Pick the light values (or "reuse resource-soft / resource-border derived") and I close C1.

### Per-resource USE effects (Arcane Recovery, Sorcery Points, Channel Divinity…) *(big feature, deferred by you)*
"Using" a resource should run its real mechanic; each needs its own picker + rules math
(`recover_slots:<budget>:<maxLevel>`-style token/columns + dialog). Data-model + UI feature,
not a refactor. Route to PLAN when you want to build it. Ties **A17** (upcast picker sits in the same family).

### Pin (spellbook ⇄ combat) end-to-end — ties D3
Spellbook pin = local set (effectiveId); combat pin = `CombatVM.pinned` demo hardcode (bare id).
Persist like hide did: one `ui.spellsPinned` field + reconcile the two key formats + drop the
demo hardcode (**D3**). Small-medium; say go.

### DEFERRED by standing strategy (no action asked, recorded for closure)
- **T1–T5** — full test-hardening = pre-release pass (except T1/T2/T3, offered forward in §1 D-T).
- **PLG-4** — plugin aggregate-budget starvation: a token that always sorts late may never memoize. Documented, unlikely (20 ms = many calls); revisit if real content hits it.
- **PLG-6 / PLG-7-D** — deep-LINK a plugin issue to the exact affected sheet/stat + a structured `failCounts` read API (per-token reasons already flow via content-health + a Retry button).
- **PLG-8** — errors carry a doc-section link — BLOCKED on PLUGINS.md being a hostable/linkable target; applies to content/effect authoring errors too.
- **PLG-9 remainder** — "did you mean?" for unknown effect KIND, plugin contribution bad-target-key, the homebrew FORM, and the `plugin:test` CLI (the two B13/A16 issue sites are wired).
- **PLG-T1 / PLG-T2** — plugin-store async-flow + generation-guard race tests; memo LRU eviction at `MEMO_MAX`. Part of the test-hardening pass.
- **W6** — SessionStart surface-hook delivery on Windows (SURFACE.md was stale at one session start) — environment/tooling investigation, not code.

---

# §5 · EFFECTS-ENGINE MASTER PLAN (consolidated 2026-07-21)

Every remaining effects-engine change in ONE place (migrates the scattered pointers: §0.5 RAW
ledger, §1/§3 items, PLAN §EXPR deferred tail). Per item: STATUS · DESIGN · IMPL · ⚠ pitfalls.
File/line refs verified against `main` at `e65f6e9`. Written to be executed by a DIFFERENT model
session — the ⚠ notes are the reviewer's pre-checked traps; do not skip them.

## §5.0 · Implementer checklist (read before ANY item)

- **Naming seam**: a raw string is a "token", `parseToken`'s object is an "effect" (CLAUDE.md).
- **D7 invariant**: consumers read the ONE `EffectFacts` from `collectFacts` — NEVER re-scan or
  re-parse raw tokens in a component or a second derive pass.
- **Core isolation**: `rules/*` never imports `effects/*`; core tests never import the effects module.
- **`deriveSheet` is PURE** — never mutate `character` inside derive (clamps/persists live in VMs).
- Compare kinds via `EFFECT_KIND` consts, never bare strings.
- SPEC4: absent whitelisted var → 0; unknown token → INERT NOTE (never dropped, never a throw).
- **B13 trap**: any NEW kind/target must be added to derive's `isTargetSupported` closed-vocab sets
  AND `effectTag` (panel label) AND `lintEffectTokens` reachability — else tokens fold onto nothing
  or render as raw strings.
- Gates per change: `node tools/surface.mjs`, full `pnpm vitest run`, `pnpm check`, `pnpm lint`
  (knip GREEN + jscpd ratchet). New SRD data only via converters (no hand-authored game data).

**Recommended order**: ~~EFX-A9 + EFX-D12 (one set-semantics pass)~~ ✅ DONE 2026-07-21 → EFX-E4
(~~grapple family~~ ✅ + ~~Rage token~~ ✅; ∞ render validated in a derive test) + EFX-B14 → ~~EFX-A14~~ ✅ →
~~EFX-G4~~ ✅ + ~~EFX-EXH~~ ✅ (both editions) → ~~EFX-D9~~ ✅ (v1) → ~~D8~~ ✅ → ~~EFX-ROLL~~ ✅ → piece 3 (§0.5) →
~~EFX-B17~~ ✅ → ~~EFX-A7/B9~~ ✅ DONE 2026-07-21 (engine + data) → EFX-B18 (last). EFX-TAIL opportunistic.
[Also DONE opportunistically: EFX-B15 ✅, EFX-B14 ✅. EFX-E4 grapple slice ✅ 2026-07-21; Rage/exhaustion/
rollables remain — all blocked on class_features effect-preservation in the class converters.]

## EFX-A9 · `set_override` modes (floor/cap) + speed-bonus block — ✅ DONE (2026-07-21)

**Landed** (commit pending): `Op` gained `floor`/`cap` (`pipeline.ts` fold: set→floor→cap→mult→add,
floor-before-cap, ineffective floor/cap → "already ≥/≤ N" notes). `ParsedEffect.setMode` +
`set_override:tgt:val:floor|cap` grammar (`token-parser.ts`); new `block_bonus:<target>` kind (both
lists in `token-parser` + `content/schemas`). `NumericFact.op` widened + `EffectFacts.blockedBonuses`;
BOTH apply paths patched — `applyEffects` (`apply.ts`) drops effect-borne POSITIVE adds/dice when a
block matches (base trace + negatives survive) AND the ability DAG (`dependency-graph.ts`
`contributionOf`) emits floor/cap for the flagship Headband case. `block_bonus`→NUMERIC_TARGETS in
derive's validator; `effectTag`/`why()` render `≥`/`≤`/`block`. Tests: DAG Headband floor (raise +
"already ≥" no-op), cap, plain-stat floor/cap via `applyEffects`, grapple 0-set + block, penalty
survives block, D12 layering. All 740+ green, `pnpm check` 0 errors, lint green.

**Original plan below (retained for reference):**

**Token spelling (the delegated sub-call)**: optional 4th slot — `set_override:int:19:floor`,
`set_override:str:10:cap`; absent = absolute. New kind `block_bonus:<target>` for the grapple
family's "can't benefit from any bonus to its speed".

**DESIGN.** `ParsedEffect` gains `setMode?: 'floor' | 'cap'`; `NumericFact` carries it. Pipeline
(`rules/pipeline.ts`): `Op` gains `'floor' | 'cap'`; `fold()` per-layer order becomes
**sets → floors → caps → mult → add** (floors: `value = max(value, maxFloor)`; caps:
`value = min(value, minCap)`; floor-before-cap is the pinned rule — a floor+cap conflict is
pathological content). `overriddenSetNotes` extends: a floor that had no effect notes
"already ≥ N" (explainability — nothing silent).
`block_bonus`: a fact list; in `applyEffects`, when a block matches the target, DROP effect-borne
`add` contributions with `amount > 0` + push a note "<source>: bonuses to <target> blocked".

**IMPL.** token-parser (grammar + setMode) → pipeline (`Op`, `fold`, notes) → apply.ts (mode
pass-through at :185-198; block filter in `applyEffects` :353-369) → dependency-graph (see ⚠1) →
derive `isTargetSupported` (+`block_bonus` targets) → effectTag → tests.

**⚠ Pitfalls.**
1. **TWO apply paths, not one.** Abilities (the Headband case that MOTIVATES floor!) resolve via
   the `dependency-graph.ts` writers (:378-385), NOT via `applyEffects`. Patch BOTH or the
   flagship example stays broken while plain-stat tests pass.
2. Blocks drop only POSITIVE effect adds — negative adds (penalties) still apply per RAW; and the
   BASE-layer trace (base speed, ability mod) is untouched — filter only fact-borne contributions.
3. The grapple-family data rows (EFX-E4) need TWO tokens: `set_override:speed:0` +
   `block_bonus:speed` — the 0-set alone does NOT reproduce RAW (a later-layer +10 survives as add).
4. Mode strings are part of the bounded grammar: `set_override:int:19:bogus` → `unknown` (inert),
   never a silent absolute.
5. Tests: floor over the DAG (int 19 vs base 8 → 19; vs 20 → 20 + "already ≥" note); grappled
   speed 0 with an active +10 speed item (→ 0 + blocked note); cap mode; D12 interplay below.

## EFX-D12 · honor `eff.layer` for token sets — ✅ DONE (2026-07-21, with EFX-A9)

**Landed**: both force-sites now honor the carried layer — `apply.ts` (`applyEffects`, was
`f.op === 'set' ? 'override' : f.layer`) and `dependency-graph.ts:381` (`contributionOf`, kept the
`condId → 'condition'` refinement). Net effect verified: a condition-layer `set_override:speed:0`
(grappled) now beats a lower item-layer `set_override:speed:40` (both orderings → 0), which is the
point. No test pinned the old "sets always override" fold — the existing collision tests used
override-layer sets already, so they held. Plugin sets already carried layers → token/plugin set
parity is now real.

**Original plan below (retained for reference):**

**Exactly two force-sites** (the older `effects/index.ts:178` pointer is STALE): `apply.ts:358`
(`layer: f.op === 'set' ? 'override' : f.layer`) and `dependency-graph.ts:381`
(`layer: isSet ? 'override' : …`). Change both to honor the carried layer (the DAG keeps its
`condId → 'condition'` refinement).

**⚠ Pitfalls.** (1) Behaviour change BY DESIGN: an item-layer set stops beating a condition-layer
set — that is the point (grappled 0 must win); do together with EFX-A9, grep tests for
"overridden by" and re-derive expectations rather than pinning the old fold. (2) Verify the layer
`gatherEffects` assigns runtime "+"-added effects (condition layer) and document it. (3) Plugin
contributions already carry layers — after this change token-sets and plugin-sets have IDENTICAL
semantics; add one parity test.

## EFX-G4 · `halve` op for 2014 exhaustion — ✅ DONE (2026-07-21)

**Landed**: new `halve:<target>` kind (`token-parser` + `content/schemas`), targets bounded to
`{speed, hp_max}` in derive's validator (`HALVE_TARGETS`). `collectFacts` emits a `mult`/`0.5`
NumericFact at the effect's layer → the pipeline's existing per-layer `mult` op folds it (one
product, floor once). `effectTag` renders "speed ×½". Tests: 30 base + 10 item → condition halve =
20; hp_max 25 → 12 (floor). **Known edge (accepted, not wired):** `halve:hp_max` folds at the real
`applyEffects('hp_max')` stat but NOT in the DAG's internal `state.hpMax.value`, so an `is_bloodied`
/ `hp_percent` GUARD read while at 2014-exhaustion-4 sees the pre-halve max — negligible, no RAW
interaction specified; revisit only if content needs it. Data (exhaustion rows) lands via EFX-EXH.

**Original plan below (retained for reference):**

**The pipeline `mult` op ALREADY EXISTS** (`pipeline.ts:73-74`, added for plugins; folds one
product then floors once; per-layer order sets → mult → add). The gap is ONLY vocabulary.

**DESIGN**: dedicated kind **`halve:<target>`** (targets: `speed`, `hp_max`) → NumericFact
`op:'mult', amount:0.5`. NOT a generic `multiply:<target>:<factor>`.

**⚠ Why not generic multiply** (both bite silently): (1) token value slots lex INTEGER literals
only — `0.5` is unparseable; (2) writing the factor as an expression (`1/2`) evaluates to 0.5 but
`resolveEffectValue` **Math.floor()s every numeric result → factor 0 → speed 0**. A generic factor
needs a non-flooring value path = bigger change with zero RAW demand (every RAW case is ×½).

**Fold semantics to pin in a test**: a condition-layer halve multiplies the value accumulated from
earlier layers (base + item + feature) — RAW-correct; same-layer adds land AFTER the mult
(accepted; note it). **IMPL**: token-parser kind; apply.ts case; `isTargetSupported` (+2 targets);
effectTag ("speed ×½"); tests (30 base + 10 item → halve → 20; hp_max halve; trace explains).
Data lands via EFX-EXH.

## EFX-A14 · hp_max = manual base + effects layer + clamp current — ✅ DONE (2026-07-21)

**Landed**: pure helper `effectiveHpMax(manualMax, sheetMaxHp)` in `lib/combat/helpers.ts` — manual
null → sheet value; else re-fold `{Manual max, base}` + the sheet trace's item/feature/condition/
override contributions through the pipeline (effect layers read off the TRACE, never re-summed from
facts). Both VM sites route through it (`state.svelte.ts` hpMax getter + hpBar). Current-clamp:
`clampCurrentHp()` (idempotent — no-op once current ≤ max) called from a reactive `$effect` in
combat `+page.svelte`, so an expired Aid / dropped manual max pulls current down WITHOUT looping the
800 ms autosave debounce. Tests (helpers.test): manual 30 + Aid → 35; Aid expires → 30; manual-null
byte-identical. All green, check 0 errors, lint green. (Verified by unit test + idempotency
reasoning; not driven through the live combat UI this pass.)

**Original plan below (retained for reference):**

**Sites**: `routes/combat/state.svelte.ts:152` (hpMax getter) and `:531` (hp bar) — both
`play.hp.max ?? sheet.maxHp.value`.

**DESIGN**: helper `effectiveHpMax(manualMax: number | null, sheetMaxHp: Computed): number` —
manual null → `sheetMaxHp.value`; else re-fold via the EXISTING pipeline:
`computed([{source:'Manual max', layer:'base', op:'set', amount: manual},
...sheetMaxHp.trace.filter(c => c.layer === 'item' || c.layer === 'feature' ||
c.layer === 'condition' || c.layer === 'override')]).value` — hp_max effects (Aid; a future halve)
stack on the manual base with full set/mult semantics preserved.

**⚠ Pitfalls.** (1) `sheet.maxHp.value` ALREADY contains the effect layers — extract them via the
TRACE filter; the base/ability layers are what the manual value replaces; never re-sum from facts
(double-count + D7 violation). (2) **No clamping inside deriveSheet** (purity) — clamp
`hp.current` in CombatVM at every hp write + one reactive check when the effective max drops
(follow the CH14-verified `$effect` patterns; mind the autosave-debounce loop). (3) This is a
Free-block affordance under DECIDE-0 — keep manual-max shallow, don't bury its precedence in
derive. (4) Tests: manual 30 + Aid(+5) → 35; Aid expires → 30 AND current clamps; manual-null
path byte-identical to today.

## EFX-D9 · magic weapon +X reaches attacks — ✅ DONE (2026-07-21, v1 literals)

**Landed**: pure `weaponBonus(tokens)` folds a weapon's OWN `effects` cell (literal
`flat_bonus:attack+N` / `flat_bonus:damage+N`) into THAT attack row's to-hit and damage inside
`computeAttacks` — never through gatherEffects/global facts (the trap: that would grant +N to every
attack; per-weapon isolation is structural, each row reads only its own tokens). A dice / expression
bonus (flaming +1d6) degrades to a VISIBLE `Atk.note` (surfaced as the attack row's hover title in
PanelCard), never a silent drop — it awaits the roll path / a ctx. Tests: literal +1 → attack+damage
+ note; dice → note only; plain weapon byte-identical; non-attack/damage tokens ignored.

**Original plan below (retained for reference):**

**Current**: `computeAttacks` (`lib/combat/helpers.ts:465+`) ignores item effect tokens; global
`flat_bonus:attack` facts DO reach rolls via `rollEffectsFor` — but those are global.

**⚠ THE CORE TRAP**: a +1 weapon's bonus is **per-weapon** — only attacks made WITH that weapon.
Do NOT feed equipped-weapon tokens into `gatherEffects`/facts: that grants +1 to EVERY attack, and
a test that just checks "an attack got +1" still passes. The fix lives INSIDE `computeAttacks`:
per inventory weapon row, `parseToken` its own `effects` cell; fold `flat_bonus:attack+N` into
THAT row's to-hit and `flat_bonus:damage+N`/dice into THAT row's damage (+ a provenance note on
the Atk). v1 may accept literal amounts only (covers +1/+2/+3); expression values need a ctx —
if deferred, degrade to a VISIBLE note, not a silent drop. Mechanics stay out of prose regexes
(D10/D6 direction). Tests: a +1 longsword bumps ONLY itself; other weapons byte-identical.

## EFX-ROLL · roll surface for scaling dice (piece 2 closer) — ✅ DONE (2026-07-21, token path)

**Landed** (the recommended token path): new `grant_roll:<id>:<expr>` kind (`token-parser` +
`content/schemas`). Derive resolves the expr to a dice `formula` string once (`collectFacts` →
`facts.rolls: RollFact[] {id, source, label, formula}`, deduped by `(id, source)` like A11; an
unresolvable expr → a content-health issue, skipped). `sheet.facts.rolls` flows to the combat view;
PanelCard's ACTIONS block renders a rollable chip per roll (label · formula · source) → `rollFeature`
→ `openDiceTray` → the D8 tray. Validated: Sneak Attack `ceil(class_level.rogue/2) d 6` at rogue 6 →
`3d6` (also confirms the prior-session dice-count lexing). Piece 2 (§0.5) now has a product surface.

**Original plan below (retained for reference):**

**Recommendation**: new kind `grant_roll:<id>:<expr>` in a feature's `effects` cell (consistent
with mechanics-as-tokens; zero schema change). Derive: `facts.rolls: {id, label, expr, source}`
(dedupe by `(id, source)` like A11); resolve via `resolveEffectValue` for DISPLAY (dice → formula
string; a plain-number result = flat roll, legal). UI: a rollable chip in the ACTIONS block
(placement per §0.5 piece-3 (g)) → `openDiceTray({label, formula})`.

**⚠ SEQUENCING**: BLOCKED by D8 — until RollTray registers the `DiceTrayRequest` contract
(`lib/dice/tray.svelte.ts`), every chip hits the instant-roll fallback and the feature looks
broken. Do D8 first. Validation: Bardic `1d step(class_level.bard, 1->6, 5->8, 10->10, 15->12)`
(or the dice-valued `step(…, 1->1d6, …)` form), Sneak `ceil(class_level.rogue/2) d 6`.

## EFX-B14 · effects panel completeness — ✅ DONE (2026-07-21)

**Landed**: pure `describeDerivedEffects(facts)` (helpers) reads the ONE typed-facts object (D7,
never re-parses tokens) and returns item/feature NUMERIC contributions grouped by source (formatted
from FACT FIELDS — "AC +1" / "STR ≥ 19" / "hp_max ×½") + the `facts.unknown` tokens. Item/feature
layer filter so it doesn't duplicate the runtime buff/debuff rows or listed conditions. PanelCard's
effects panel gained a read-only "From items & features" section + an "Unrecognized" inert-notes
section, and the whole panel body no longer hides when `play.effects` is empty (a magic item with no
runtime buff now shows). No remove/spend controls on derived rows (they follow equip/feature state).
Bonus: `targetLabel` now renders abilities uppercase (STR/DEX). Tests cover grouping/formatting +
the runtime-exclusion.

**Original plan below (retained for reference):**

`groupEffects` (`lib/combat/helpers.ts:268`) reads ONLY `play.effects`; content-borne item/feature
buffs and `facts.unknown` are invisible. Plan: PanelCard's effects section gains a READ-ONLY
"from items & features" group rendered from `sheet.facts` (numeric / advantage / defenses /
proficiencies grouped by source via `effectTag`) + unknown tokens as distinctly-styled inert notes
(`p.raw` — the §4 raw-tokens note). ⚠ Read facts, never re-parse tokens in the component (D7);
no remove/spend controls on derived rows (they follow equip/feature state, not user CRUD).

## EFX-B17 · `play.effects` live refs + baked fallback — ✅ DONE (2026-07-21)

**Landed — NO schema bump needed** (the plan expected one): `effectInstance` ALREADY carried an
optional `source: ref` + baked `label`/`effects`, so old saves stay valid and just use the fallback.
Wired: `effectCatalog` now carries `ref: effectiveId`; `addEffect(…, ref?)` stores it in `source`
(custom/GM effects omit it → baked-only); the CombatMenus catalog row passes `p.ref`. Derive
(`gatherEffects`) resolves `eff.source` LIVE (respecting `isActive` — B15 sibling) → uses the row's
CURRENT tokens + name (fixes propagate, name re-localizes); an orphaned/disabled ref falls back to
the baked tokens/label AND is flagged in `sheet.missing`. Tests: stale baked `+5` ignored in favour
of the live `+1`; orphan ref → baked `+2` applied + surfaced in missing. **Follow-up (small):** the
buffs/debuffs PANEL still shows the baked `eff.label` (groupEffects reads the instance directly) —
mechanics propagate now; panel-label re-localization is separate UI plumbing.

**Original plan below (retained for reference):**

`EffectInstance` gains optional `ref: {type, source, id}`; keep baked `{label, tokens}` as the
fallback written at add-time. Derive resolves ref → row first (label re-localizes, catalog fixes
propagate); orphan → baked + a panel flag. Schema bump + migration (old saves = baked-only,
valid). ⚠ Resolution must respect `isRowActive` + the character's system/edition (EFX-B15
sibling); when the ref resolves, the RESOLVED name wins (never show the stale baked label).

## EFX-B18 · structured localizable provenance — DECIDED B, deliberately LAST

Today every note is baked EN concat (`apply.ts:360, 371-377`; `gatherEffects` names). Refactor
`{value, trace, notes}` notes into structured facts `{sourceRef, op, params}` + render-time i18n.
**Trigger pinned**: do it BEFORE building any major new note CONSUMER (roll-log rework; EFX-B14
is fine as-is — it renders tags, not notes). ⚠ Every note-producing site must migrate in ONE pass
or the UI mixes string/struct shapes; grep `notes.push` across `effects/` + derive first.

## EFX-A7/B9 · weapon/armor proficiency model — ✅ ENGINE DONE (2026-07-21); data via converters pending

**Landed** (engine): new pure `src/lib/rules/proficiency.ts` — `gatherProfGrants` (union of a
character's class prof columns; blank/no-class → `null` = UNCONSTRAINED, the lenient fallback),
`weaponCategoryOf`/`armorCategoryOf` (normalize `item_type`→category, never string-match prose),
`isWeaponProficient` (category OR specific weapon-id grant), `isArmorProficient`. Schema: `classes`
gained `weapon_profs`/`armor_profs` (optStr comma lists). **A7 gate**: `computeAttacks`
(`combat/helpers.ts`) omits the proficiency bonus from a non-proficient weapon's to-hit + a visible
"Not proficient" note. **B9**: `deriveSheet` sets `spellcasting.armorBlock {source,note}` +
a `deriveIssue` when worn armor's category ∉ the class armor grants; surfaced as a red rule-block
banner on the combat spells panel (`combat.armorBlock` → PanelCard). Passive ±5 (adv/dis) was
ALREADY done (derive `passiveOf`). Lenient throughout — undeclared classes never lose proficiency
downward. Tests: proficiency.test (pure), derive.test (A7 gate omits prof; B9 block + no-block).
772 green, check 0, lint green.

**DATA DONE (2026-07-21)**: both shipped class CSVs now carry RAW-correct prof columns, derived by
the converters (not hand-authored). `convert-classes.mjs` (2024) parses the Core-Traits "Armor
Training"/"Weapon Proficiencies" cells; the conditional "Martial weapons that have the Finesse/Light
property" (Rogue/Monk) resolves to specific weapon ids computed from the ACTUAL item set (data-driven).
`convert-2014.mjs` (5.1) parses the "Armor:/Weapons:" prose; 5.1's explicit weapon lists
(Wizard/Rogue/Druid/…) resolve name→id against the item set by unordered word-set match ("hand
crossbows"→`crossbow_hand`). Verified per class against SRD 5.1 + 5.2.1.

**Converter fixes made along the way (root-cause, prevent recurring churn/data-loss):** (1)
`lib.mjs writeCsv` is now IDEMPOTENT — preserves each file's stable `#content-id` + BOM + `updated-at`
key spelling, and SKIPS the write entirely when the body hash is unchanged; a re-run now dirties only
files whose DATA changed (previously every run regenerated the uuid + date on all ~28 CSVs). (2)
`convert-2014.mjs convertConditions` PRESERVES authored `effects` (the CONDITIONS-1 tokens live in
the CSV, not the HTML source; a raw re-run was silently wiping them) — via `existingEffectsById`.
(3) BOM-strip fixed in the CSV readers (`﻿` before the `#`-filter). **Known latent trap left:**
`convert.mjs` (2024) `convertConditions` has the same authored-effects clobber risk if 2024 condition
effects get authored — apply the same preservation when that lands (EFX-E4).

**Original plan below (retained for reference):**

Schema: `classes` gain `weapon_profs` / `armor_profs` (normalized ENUM categories:
simple/martial + specific weapon ids; light/medium/heavy/shield). Items already carry `item_type`
(`schemas.ts:312`, semi-free text) — ⚠ normalize to categories at parse; don't string-match
prose. Gate `computeAttacks` prof on category ∈ union of class grants; B9: worn armor without
prof → pipeline NOTE + spellcasting block (PLAN's canonical rule-block example) + passives take
±5 when adv/dis facts hit the passive's skill. ⚠ Lenient fallback: rows WITHOUT the new columns
(old homebrew) keep today's always-proficient behavior (never wrong-downward). ⚠ Data via
converters only.

## EFX-EXH · exhaustion ladder + conditions-as-data — 2024 ✅ DONE (2026-07-21); 2014 deferred

**2024 ✅**: `exhaustion` condition authored `flat_bonus:d20_tests-2*exhaustion;flat_bonus:speed-5*exhaustion`
(scales off the `exhaustion` ctx var, which reads `play.exhaustion` 0-6). **Wiring**: `gatherEffects`
now folds the `exhaustion` condition's tokens ONCE when `play.exhaustion > 0` (exhaustion is a LEVEL,
not a manually-applied condition) — a token-less edition (2014, pending) is a no-op. Test derives a
barbarian at exhaustion 3 → −6 on saves/skills (a d20-test) + −15 ft speed. `class_features_content.test`.

**2014 ✅ DONE (2026-07-21)**: added the `ability_checks` group target (fans to `skill.*` in
`matchesTarget` + `SKILL_TARGETS`) and authored the CUMULATIVE ladder as guarded tokens:
`exhaustion>=1 ? disadvantage:ability_checks;exhaustion>=2 ? halve:speed;exhaustion>=3 ? disadvantage:attack;
exhaustion>=3 ? disadvantage:saves;exhaustion>=4 ? halve:hp_max;exhaustion>=5 ? set_override:speed:0;
exhaustion>=6 ? note:Level 6 exhaustion is death`. Test: L1 → passive skill −5 (disadvantage), speed
intact; L2 → speed halved; L5 → speed 0 (set beats halve). EFX-EXH fully closed both editions. Ties: D19
(`max(6)` hardcode → data), L2R-16 (`RAGE_CONDITION_ID` hardcode dies with conditions-as-data). The B2
death-saves/hit-dice UI shares the group but is NOT engine work.

## EFX-B15 · derive respects source filters + collisions — ✅ DONE (2026-07-21)

**Landed**: `deriveSheet` gained an optional `isActive: (row) => boolean` PARAMETER (kept a param,
not a store import, so derive stays framework-agnostic + testable; the 3 VMs — combat/build/spellbook
— pass `isRowActive`, reactive over the source config; tests default to all-active). Applied ONCE at
gather: `gatherEffects.resolve()` treats a disabled/collision-lost row exactly like a missing ref
(flagged in `sheet.missing`, never applied, never a crash), and the class-feature loop skips inactive
rows. Tests: a disabled Hardy species drops its +2 CON and surfaces in `missing`; a disabled
Arcane-Ward feature stops granting its resource.

**Original plan below (retained for reference):**

`gatherEffects`/`deriveSheet` read the raw graph; wire `isRowActive` + resolved collisions into
derive's row lookups. ⚠ Filter once at gather (perf), not per-stat. ⚠ A filtered-out row a
character references = the EXISTING missing-ref path (render + flag), never a crash.

## EFX-E4 · encode SRD effect tokens (content; validates everything above) — PARTIAL

**(1) grapple/restrain family — ✅ DONE (2026-07-21)**: `block_bonus:speed` added to `grappled` +
`restrained` in both editions' `conditions_srd.csv` (they already had `set_override:speed:0` from
CONDITIONS-1; the block completes A9's pairing so a later +10 speed can't survive — RAW "can't
benefit from a bonus to its speed", verbatim in the 5.1 text). `conditions_content.test.ts` pins it.
Also closed the 2024-conditions converter trap: `convert.mjs convertConditions` now preserves
authored effects (mirrors the convert-2014 fix).

**(2) Rage — ✅ DONE (2026-07-21)**: FIRST added authored-feature-effect preservation to
`convert-classes.mjs` + `convert-2014.mjs` (`existingEffectsById` → `authoredFeatures.get(fid)`; the
prerequisite that unblocks all feature authoring — a raw re-run no longer wipes feature tokens).
Then authored `barbarian_rage.effects` in both editions:
`grant_resource:rage:step(class_level.barbarian, 1->2, 3->3, 6->4, 12->5, 17->6):long` (5.2.1, caps
at 6) and `…, 17->6, 20->inf):long` (5.1, Unlimited at 20). `class_features_content.test.ts` derives
a real barbarian and pins the per-level counts incl. the ∞ (5.1 L20) — the first end-to-end
validation of the step()/inf/grant_resource path on shipped data.

**(4) rollables — ✅ DONE (2026-07-21)**: `grant_roll` tokens authored on `rogue_sneak_attack`
(`ceil(class_level.rogue/2) d 6`), `bard_bardic_inspiration` (`1d step(bard, 1->6,5->8,10->10,15->12)`),
`monk_martial_arts` — both editions, with the Martial Arts die correctly a step LOWER in 5.1
(d4-start) than 5.2.1 (d6-start). `class_features_content.test` pins the resolved formulas
(rogue 6→3d6, rogue 20→10d6, monk 11→1d10 vs 1d8 by edition).

**(3) exhaustion — 2024 ✅ (see EFX-EXH below); 2014 ladder deferred** (guarded tokens + an
`ability_checks` target — a small engine add). Feature-authoring is unblocked (preservation is in).

Priority: (1) grapple/restrain family (after EFX-A9), both editions; (2) **Rage**
(`grant_resource:rage:step(class_level.barbarian, 1->2, 3->3, 6->4, 12->5, 17->6, 20->inf):long`
for 5e; **5.5e WITHOUT the `20->inf` pair** — caps at 6 per SRD 5.2.1) — also the first visual
verification of the ∞ render; (3) exhaustion rows (after EFX-G4); (4) Bardic/feature rollables
(after EFX-ROLL). ⚠ Converter scripts only; verify counts/values against SRD tables.

## EFX-TAIL · deferred L2 vocabulary tail (pointer migrated from PLAN §EXPR :1123-1136)

`treat_as` (Reliable-Talent generalization beyond `min_die`), Elven Accuracy (advantage upgrade —
roll 3 keep 1; needs a roll-path flag beyond adv/dis), Extra Attack (`flat_bonus:attacks+N` →
action economy, structural). No design yet; pick up when the roll path is next open.

## Parked (Tier E — no action until real demand)

QuickJS-WASM real sandbox swap; onUse/onEvent executor (docs/ACTIONS.md, lands with N2); PLG-4
budget starvation; PLG-6/7/8/9 diagnostics tail; `plugin:test` CLI polish. Piece 3
(`resource_options.csv`) stays specced in §0.5 — pin its formal v1 schema (columns + action vocab
+ `x` cost) as its OWN design pass when its turn comes.

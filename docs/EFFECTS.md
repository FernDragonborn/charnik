# Charnik — Effects & Modifier Engine (design-of-record)

Normative spec for the auto-calc engine: how a bounded **effect vocabulary** feeds one
**stacking pipeline** to produce every derived stat as `{value, trace, notes}`. This is the
design record for **L1** (the bounded token vocabulary) and **L2** (value expressions); **L3**
(the QuickJS plugin sandbox) has its own normative spec in [`PLUGINS.md`](PLUGINS.md), the
play-state action model lives in [`ACTIONS.md`](ACTIONS.md), and the threat model in
[`SECURITY.md`](SECURITY.md). The build/status history lives in `PLAN.md` and git.

> **Source of truth is the code** (`src/lib/effects/`). Where this doc and the code disagree,
> the code wins and this doc is stale — fix it.

---

## 1 · Architecture invariants (why the engine has this shape)

- **Data, never code.** Auto-calc flows through ONE stacking pipeline
  (`base → ability mod → proficiency → item → feature → condition → override`, clamped to caps)
  fed by a **bounded vocabulary**. Effects are **interpreted data, not `eval`/a DSL** — a
  security property (SECURITY.md). L2 widens the token grammar with a **non-Turing formula
  language** (no loops, recursion, assignment, side effects); L3 is the ONLY layer that runs
  code, and only inside a WASM sandbox.
- **Unknown → inert, never dropped.** An unrecognized kind, an out-of-vocabulary target, a
  malformed expression, a missing/disabled plugin — all degrade to **inert text + an optional
  manual modifier** and surface in content-health. Derive NEVER throws; a bad token never breaks
  the sheet.
- **Explainable.** Every consumer reads a `Computed` = `{value, trace, notes}`; the trace is the
  list of `{source, op, amount}` contributions + rule notes/blocks, so any stat explains itself
  on hover. Notes are structured (`Note[] = {text, key?, params?}`) so they can localize.
- **Removable module, one seam.** The whole engine is `src/lib/effects/`, composed onto the pure
  rules core via the single `applyEffects` seam. The core computes base stats with **no
  dependency** on effects; the `{value, trace, notes}` contract is identical whether effects are
  on, off, or deleted. **Core tests must not import the effects module.**
- **Global toggle.** Effects-auto has an on/off switch; off ⇒ stats are manual/text only.

### Module layout (per expressiveness layer)

| File                                                                                     | Role                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token-parser.ts`                                                                        | **L1** — `parseToken` (string→`ParsedEffect`), `EFFECT_KIND` vocab, `matchesTarget`, `splitGuard`, the `Recharge`/`Defense` types.                             |
| `apply.ts`                                                                               | The fold seam — `collectFacts` (tokens→typed `EffectFacts`), `applyEffects` (fold a stat), `matchesTarget` group fan-out, `mergeFacts`, the `TargetValidator`. |
| `expression-parser.ts`                                                                   | **L2** — formula string → AST.                                                                                                                                 |
| `expression-evaluator.ts`                                                                | **L2** — AST → value (integer OR dice term), over an `EffectCtx`.                                                                                              |
| `dependency-graph.ts`                                                                    | The ONE resolve stage — `resolveActiveEffects` (gather → guards → expand → dedupe → facts), in dependency order.                                               |
| `context.ts`                                                                             | `makeExprContext` / `ctxOf` — the `ctx` a formula reads (build + play vars).                                                                                   |
| `plugin-registry.ts` · `plugin-host.ts` · `plugin-sandbox.ts` · `plugin-store.svelte.ts` | **L3** — see `PLUGINS.md`.                                                                                                                                     |
| `suggest.ts`                                                                             | "did you mean?" fuzzy hints for a typo'd token/target.                                                                                                         |

### Naming rule (token vs effect)

A raw effect **string** is a **token** until `parseToken` turns it into an object, after which it
is an **effect** (`ParsedEffect`). String-form identifiers say *token* (`token`, `tokens:
string[]`, `parseToken`, `splitGuard(raw)`); object-form identifiers say *effect* (`ParsedEffect`,
`applyEffects`, `EFFECT_KIND`). Keep new code on this seam.

---

## 2 · L1 — the bounded token vocabulary

A token is `kind:target[:value]` (`:` is STRUCTURAL — the delimiter and namespacing; an
expression never contains one). `EFFECT_KIND` (`token-parser.ts`) is the closed set of kinds:

| Kind                         | Form                                                    | Meaning                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flat_bonus`                 | `flat_bonus:<target>+<value>`                           | Additive contribution at the effect's layer (value may be an L2 expr or dice term).                                                                                                                     |
| `set_override`               | `set_override:<target>:<value>` (+ `floor`/`cap` modes) | Force a value; same-target sets combine by D&D "most potent wins" (`overriddenSetNotes`), never silent-stomp. `floor` = raise-to-at-least (Headband INT≥19), `cap` = clamp-down.                        |
| `block_bonus`                | `block_bonus:<target>`                                  | RAW "can't benefit from any bonus to its `<target>`" (grappled/restrained block ALL speed bonuses): drops effect-borne positive adds; base + penalties survive.                                         |
| `halve`                      | `halve:<target>`                                        | ×½ multiply (the ONE non-integer RAW factor — 2014 exhaustion speed/hp-max). Dedicated kind, not a generic multiply. Targets: `speed`, `hp_max`.                                                        |
| `advantage` / `disadvantage` | `advantage:<target>`                                    | Roll adv/dis (a fact + a note); `netAdvantage` cancels one-for-one. Passives take ±5.                                                                                                                   |
| `auto_fail` / `auto_succeed` | `auto_fail:<target>`                                    | Force a roll OUTCOME (paralyzed/stunned auto-fail STR & DEX saves) — not a die modifier.                                                                                                                |
| `reroll`                     | `reroll:<target>:<threshold>`                           | Reroll a die landing ≤ threshold once (GWF ≤2).                                                                                                                                                         |
| `min_die`                    | `min_die:<target>:<floor>`                              | Treat a die below floor AS floor (Reliable Talent d20→10).                                                                                                                                              |
| `grant_proficiency`          | `grant_proficiency:[expertise:]<target>`                | Grant proficiency/expertise as ONE ladder level (`none/half/proficient/expertise`).                                                                                                                     |
| `grant_resource`             | `grant_resource:<id>:<max>:<recharge>`                  | Define a resource pool (rage/ki/N-per-day…), `recharge ∈ short/long/other`. `max` is cost-capped (`MAX_RESOURCE_MAX`).                                                                                  |
| `grant_roll`                 | `grant_roll:<id>:<expr>`                                | A named feature-granted rollable (Sneak Attack `Nd6`, Bardic Inspiration die); resolves to a dice formula → the DiceTray seam.                                                                          |
| `resist_immune`              | `resist_immune:<type>` (+ resist/immune/vulnerable)     | Damage defense; applied immune→0 / resist→½ / vulnerable→×2 before temp-HP soak.                                                                                                                        |
| `apply_condition`            | `apply_condition:<id>`                                  | Expand a condition row's own tokens ONE level (the condition's `effects` flow + register `has_condition.<id>`).                                                                                         |
| `hp_max`                     | `flat_bonus:hp_max+<value>`                             | Max-HP contribution (Toughness/Aid), re-folded on a manual base.                                                                                                                                        |
| `note`                       | `note:<free text>`                                      | DISPLAY-ONLY: a mechanic the engine can't model on a single-character sheet (attacks AGAINST you, auto-crit, sense/relational). Never folds, matches no target; shown distinctly. `;` separates a list. |
| `plugin`                     | `plugin:<namespace>:<handlerName>[:<args>]`             | L3 handler REFERENCE (never code). Resolved by the derive pre-pass through the registry (PLUGINS.md).                                                                                                   |

### Targets

`matchesTarget` (`apply.ts`) matches an exact key OR a group that fans out. Specific keys:
`ac`, `initiative`, `speed`, `speed.fly`, `speed.swim`, `hp_max`, `attack`, `damage`,
`spell_dc`, `spell_attack`, `save.<ability>`, `save.death`, `skill.<id>`, `passive.<skill>`,
plus the action-economy targets `action` / `bonus` / `reaction`. **Group targets** (fan out):

- `saves` → every `save.*`
- `skills` / `ability_checks` → every `skill.*` (2014 exhaustion L1 rides `ability_checks`)
- `d20_tests` → every d20-based roll (saves, skills, `attack`, `initiative`) — the 2024
  exhaustion penalty rides this one group.

A known-kind token whose target is outside the vocabulary is kept **inert** and surfaced as a
`unknown target "<t>" for <kind>` content-health issue (with a `suggest.ts` "did you mean?"),
never folded onto nothing.

---

## 3 · L2 — value expressions + condition guards

L2 widens the SAME `effects` cells: a token's **value** (and a conditional **guard** on the
token) may be a bounded expression instead of a literal. It is a formula, not code —
non-Turing-complete, terminating by construction, zero sandbox surface.

- **Value expression** where a literal stood: `flat_bonus:ac+ceil(level/2)`,
  `grant_resource:ki:class_level.monk:short`. Evaluates to EITHER a flat integer OR a **dice
  term** `<amount>d<sides>` where BOTH operands are expressions (so the count scales —
  `ceil(class_level.rogue/2)d6` Sneak Attack — or the die size scales — Martial Arts die).
  Both operands are cost-clamped (`MAX_DICE_PER_TERM`/`MAX_DIE_SIDES`). Dice terms stay dice
  (ride the roll path, never collapsed at parse); flats fold as contribution amounts.
- **Condition guard** `<bool-expr> ? <token>` — **condition-FIRST** ("is raging? → …"):
  `is_raging ? advantage:attack`. No else branch, no `:` (see the colon rule). It gates whether
  the token contributes at all — the conditional-effect mechanism for non-numeric kinds
  (advantage/grant_proficiency/apply_condition have no numeric slot to hold a condition).
  **Conditional VALUES use `if(cond, then, else)`**, never `?:`.

### Grammar (pinned)

Variable and function names are spelled out in full — never abbreviated (a formula is read by
non-technical authors). Ability variables are ALWAYS explicit: **`<ability>_mod`** (modifier) and
**`<ability>_score`** (raw), `<ability> ∈ str/dex/con/int/wis/cha`; a bare `wis` is a parse error.
Class levels: **`class_level.<id>`** (never bare `class.<id>`, which reads as a boolean "has this
class?"). Boolean flags start with `is_`: `is_bloodied`, `is_raging`, `is_concentrating`,
`is_wearing_armor`, `is_wearing_shield`.

**Full var set:**

- **Build/derived numbers:** `level`, `proficiency_bonus`, `<ability>_mod`/`<ability>_score`,
  `class_level.<id>`, `spellcasting_mod` (the active/carrying class's casting stat), `base_speed`
  (species walking speed, pre-effect).
- **Guards (dependency-resolved play-state):** `hp`, `hp_max`, `hp_percent`, `temp_hp`,
  `exhaustion` (0..ladder-max), `size` (ordinal), `armor_type` (`none/light/medium/heavy`), the
  `is_*` flags, `has_condition.<id>`, `resource.<id>` (remaining), `resource_max.<id>`.

**Operators** (precedence high→low): `d` (dice) > unary `-` > `* / %` > binary `+ -` >
comparisons (`< <= > >= == !=`) > `not` > `and` > `or`. Comparisons are **non-associative** —
`5<=level<=10` is a parse error (spell it `5<=level and level<=10`). **No `?:` ternary.**
Whitelisted functions: `if min max floor ceil round abs clamp sign` — nothing else.

**The colon rule:** `:` is STRUCTURAL only (token delimiter + namespacing). An expression NEVER
contains a `:`, so the delimiter is never ambiguous. That is why conditional values use `if()` and
the guard has no else branch.

### Semantics (pinned)

- Lowercase, case-sensitive; whitespace insignificant; **no string type**.
- **No randomness at eval** — a dice term is DATA that rides to the roller, never rolled during
  evaluation, so eval is deterministic (reproducible traces).
- **Rounding:** division keeps an exact intermediate; a non-integer FINAL value fed to a stat is
  **floored** (5e "round down" default); `ceil()`/`round()` are the explicit opt-in.
- **Read boundary (cycle rule):** an expression may read base/build values + dependency-resolved
  play-state, but NEVER the post-effect DERIVED value of the stat it modifies. `base_speed` is the
  deliberate exception (species input, not derived speed).
- **One `ctx`, shared with L3:** the build/play split — build vars read `ctx.build`, guard vars
  read the dependency-resolved `ctx.play` (`makeExprContext` over live getters into the resolve
  state, not a frozen copy).

### Type & resolution rules

- **Ability/derived vars are EFFECTIVE, not base.** `<ability>_mod`, `proficiency_bonus`,
  `spellcasting_mod` read the POST-effect value (a species +2 CON is folded in). Because effects
  can WRITE scores while expressions READ them, score-writers are ordered BEFORE readers in the
  same dependency DAG; a read↔write cycle → content-health, never a loop.
- **Enum vars compare against a per-enum literal whitelist.** No string type, so `armor_type==heavy`
  reads `heavy` as the enum literal (valid only against `armor_type`). An ordered enum (`size`,
  `exhaustion`) also allows `< <= > >=` by ordinal; an unordered enum (`armor_type`) allows only
  `==`/`!=`. A non-whitelisted literal is a parse error → fallback.
- **An absent-but-whitelisted variable resolves to 0/false, never to fallback.** `class_level.rogue`
  on a non-rogue is `0` (Sneak-Attack content degrades to "+0"); `spellcasting_mod` on a true
  non-caster → `0`. Only an UNKNOWN variable name is a parse error.
- **`if()` branch type is decided at eval by the taken branch** (int OR dice term); a mixed-type
  `if` is legal but content-health-warned.
- **ONE resolve stage feeds every consumer** (§4). Guards are evaluated once; every downstream site
  reads that output, never its own re-scan.
- **Derive-time failures ride a per-character issue channel** (`deriveIssues: EffectIssue[]`,
  `{source, token, reason}`) merged into content-health alongside loader `issues`.

### Worked examples

```
armor_type==none ? set_override:ac:10+dex_mod+con_mod          Barbarian Unarmored Defense
flat_bonus:saves+max(1,cha_mod)                                Paladin Aura of Protection
grant_resource:lay_on_hands:class_level.paladin*5:long         pool = 5 × level
flat_bonus:damage+ceil(class_level.rogue/2)d6                  Sneak Attack (count scales)
flat_bonus:ac+if(is_bloodied, 2, 0)                            +2 AC while below half
flat_bonus:d20_tests+(-2*exhaustion)                           2024 exhaustion
is_raging ? advantage:attack                                   advantage while raging
armor_type==heavy ? disadvantage:skill.stealth
has_condition.frightened ? disadvantage:attack
is_raging ? flat_bonus:damage+cha_mod                          Zealot: CHA to damage while raging
```

**Failure = the L1 fallback, never a throw.** A malformed expression / undefined variable /
div-by-zero degrades the token to inert text + optional manual modifier, WITH the parse detail in
content-health (reason + offending token), never a bare "invalid".

**Displaying an expression:** auto-generating prose from a formula is rejected as unreliable. The
player sees the **resolved value + the effect's name** ("+4 · Sneak Attack"); an optional
author-written localized description feeds the tooltip; the raw formula shows only in an
author/dev view. The formula is language-neutral math, so L2 has no i18n gap.

**Dice sides** = any integer ≥ 1 (≤ cap). Non-standard dice (d2/d3/d30) are allowed but
content-health soft-warns (`unusual die dN`) to catch a `d7` typo. Amount clamps ≥ 0, sides ≥ 1.

### Conditions & exhaustion as DATA

Conditions are content rows whose `effects` column carries L1/L2 tokens; applying one expands its
tokens (`apply_condition`) + registers `has_condition.<id>` for guards. Exhaustion is a per-system
ladder in content: 2014 = a distinct effect per level applied CUMULATIVELY (rows level ≤ current);
2024 = ONE row using the `exhaustion` variable (`flat_bonus:d20_tests+(-2*exhaustion)`,
`halve:speed`…). `exhaustion` is play-state (0..ladder-max) AND an L2 variable, always manually
settable (the automatic long-rest −1 is a default convenience, not a lock).

---

## 4 · The authoritative derive pipeline

`deriveSheet` runs exactly these stages, in order. **Every feature references THIS list.**

1. **Seed** — base ability contributions + hp-max-base fn + class levels + species/armor context.
2. **Resolve** (`resolveActiveEffects`, `dependency-graph.ts`) — gather effects (with same-name
   dedupe) → order value nodes (abilities, `hp_max`, conditions, resources) by read/write deps
   (Tarjan SCC; a cycle → inert + issue) → evaluate guards in that order (drop false-guarded
   tokens; an ERRORED guard keeps the token verbatim = inert note + issue) → expand
   `apply_condition:<id>` ONE level per id → emit the guard-stripped `resolvedEffects` + the
   effective ability `Computed`s + the hp-max base. Guard eval precedes condition expansion.
3. **Facts** (`collectFacts`) — parse every resolved token ONCE, resolve L2 values ONCE → the
   typed `EffectFacts` object (numeric / advantage / disadvantage / proficiencies / defenses /
   resources / conditions / rerolls / minDie / unknown). No consumer re-parses the token list.
   - **3½ · Plugin pre-pass** (L3, PLUGINS.md) — runs AFTER the first `collectFacts` over the
     content-only facts; returned `tokens` go through a SECOND `collectFacts` merged via
     `mergeFacts`; `contributions` append as host-stamped numeric facts. Plugin output cannot feed
     the DAG/guards; a returned `apply_condition` expands ONE level, no cascade.
4. **Fold** — every sheet stat = core math `Computed` → `applyEffects(key, base, facts)` (numeric
   facts fold at their layer; `set`/override combine by "most potent"; adv/dis/dice → notes/roll
   path). Cross-effect fold is **order-independent** (`rules/pipeline.ts`), so no tie-break sort is
   needed.
5. **Spellcasting** — AFTER the fold, over the effective scores, with `spell_dc`/`spell_attack`
   facts folded onto every caster class.

The roll path (`rollEffectsFor`) and action economy (`slotMax`) read the SAME `EffectFacts` — one
resolve stage, no split-brain scans.

---

## 5 · L3 — plugins (summary; see PLUGINS.md)

For the true homebrew tail that L2 can't express, a **`plugin:` token** references a handler in
`dataDir/plugins/<namespace>/main.js` (never code in CSV). Handlers run in a **QuickJS-in-WASM
sandbox** (zero-capability context, per-call CPU/memory budgets, JSON-string boundary, host-side
zod revalidation, length-prefixed SHA-256 consent hash stored outside the dataDir, fail-closed
counter). A handler returns declarative output (`contributions` / L1 `tokens`) that rides the
existing fold; it can NEVER break derive (any failure degrades to an inert note). Three state
channels: `passive` (READ state → contributions), `onUse` / `onEvent` (WRITE play-state, core-owned
per ACTIONS.md; deferred to `api: 2`). **Desktop-only** — the web build ships no sandbox. Full
normative contract, ctx/result schemas, budgets, and the security checklist: [`PLUGINS.md`](PLUGINS.md).

---

## 6 · State model & conditional resolution

- **Commutative fold is the order-independent default** (done in `rules/pipeline.ts`).
- A conditional whose condition reads a value another conditional writes resolves in **dependency
  order** (a DAG — for real 5e/5.5e content the graph is nearly empty, so it's a single pass; NO
  iterate-to-fixpoint).
- A genuine **CYCLE** (self-referential effect) is a CONTENT BUG surfaced in content-health, not
  tolerated at runtime. Sticky effects are modeled as an `onEvent` latch, not a derived condition.
- **Bloodied** is a first-class 2024 flag (HP ≤ half max) and a computed convenience under 2014 —
  a per-system seam, not a hardcode.

---

## 7 · See also

- [`PLUGINS.md`](PLUGINS.md) — L3 plugin sandbox, the normative `api: 1` contract.
- [`ACTIONS.md`](ACTIONS.md) — the core play-state action/event model (`onUse`/`onEvent` intent).
- [`SECURITY.md`](SECURITY.md) — the threat model (no `eval`/DSL, sandbox containment, cost caps).
- `PLAN.md` — status/roadmap and the AUDIT SPEC cross-references.

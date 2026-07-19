# L2 expression engine — edge-case test hardening plan

> **STATUS: DONE 2026-07-19.** All of P0/P1/P2 implemented (462 → 518 tests). Two real bugs
> the hardening exposed, both fixed in `expression-evaluator.ts`:
> 1. **Non-finite leak** — uncapped numeric literals let `Infinity`/`NaN` flow into a stat
>    (`ok:true`). Fixed by a finite-guard in the single numeric constructor `num()`.
> 2. **`scaleDice` junk** — a zero/negative scale factor left a `{6:0}` pool entry (serializes
>    to `"0d6"`) and a `-0` flat. Fixed to drop non-positive counts + normalize `-0`, matching
>    `evalDice`.
> Below is the original plan, kept as the record of what each block covers.
>
> **L1 boundary follow-up (2026-07-19, 518 → 543 tests).** The plan above hardened L2 (the
> expression sub-language); a second pass covered the L1 token boundary — the FIRST thing a raw
> CSV cell hits, before L2 runs. It exposed a third bug + one open footgun:
> 3. **`lintEffectTokens` skipped literal dice.** A `+1d7` bonus parses to `p.dice` (fast path),
>    not `valueExpr`, so the unusual-die content-health warning never fired for the most common
>    author-typo form. Fixed in `apply.ts` (lint `p.dice` too).
> - **FIXED footgun — uppercase target silently no-ops.** `flat_bonus:AC+2` parsed fine (target
>    regex is case-insensitive) but `matchesTarget` is case-SENSITIVE, so it folded onto nothing:
>    parsed-but-never-applied, no error, no note. Fixed by normalizing the target to lowercase at
>    the one parse chokepoint (`parseToken` → `classifyToken`); `valueExpr` and `raw` are left as
>    typed. Covers `resist_immune:Fire`, `apply_condition:Frightened`, etc. too.
> New L1 coverage: `set_override` with an expression (Unarmored Defense `10+dex_mod`) + a dice
> override → error; per-kind malformed/empty tokens → `unknown`; `splitGuard` first-`?`/empty-
> guard/trailing-`?` edges; `lintEffectTokens` over guard/value/dice/maxExpr slots.

The L2 value-expression layer (`src/lib/effects/expression-parser.ts`,
`expression-evaluator.ts`, `context.ts`, `dependency-graph.ts`) is the one place we want
near-total coverage: it is a critical, high-blast-radius system fed by **unfiltered user
input** (formulas typed into CSV cells / the effects `+` UI). Edge cases matter more than
happy paths here — a malformed or hostile formula must degrade to a structured error, never
throw, never leak `NaN`/`Infinity` into a character stat, never DoS.

Current coverage (`expression.test.ts`, `context.test.ts`, `effect.test.ts`,
`resolve.test.ts`) is solid on happy-path + basic failures. Below are the gaps, by priority.
Prototype-pollution on dotted ids, chained comparisons, fail-closed enums are ALREADY
covered — not repeated here.

## P0 — hostile input / safety (do first)

1. **Fuzz "never throws" on REAL raw input.** Existing property test only generates valid
   exprs over 4 vars + `+ - * ceil max`. Add: `fc.fullUnicodeString({maxLength:600})` →
   `parseExpression`/`evalExpression` always returns `{ok:boolean}`, never throws. Widen the
   valid generator too (comparisons, and/or/not, dice, `if()`, enum compares, division).
2. **NaN / Infinity leak (likely a real bug — test exposes it).** Numeric literals are
   uncapped: `'9'.repeat(400)` → `Infinity`, `ok:true`; `Inf - Inf` → `NaN` flowing into a
   stat. Property: `ok===true ⇒ Number.isFinite(value)`. Expected to FAIL today → fix in code
   (finite guard in `evaluate()` or a literal cap in the tokenizer) landed WITH the test.
3. **Cap boundaries, exactly on the edge:** depth 32 ok / 33 error via `not not…`, `----5`,
   nested `ceil(ceil(…))` (not only parens); `'('*200 + 1 + ')'*200` → structured error, no
   stack overflow; `MAX_DIE_SIDES` clamp (`1d99999` — untested); dice cap via MULTIPLY
   (`2000*1d6` — only tested via add); length 512/513 boundary.
4. **Parser cache:** >2000 distinct exprs → clear-at-cap → still correct; same AST under
   different ctx yields different correct results (AST not mutated).

## P1 — semantic traps (weigh above happy paths)

5. **Tokenizer `d` disambiguation (trickiest code, barely tested):** `(1+1)d6`→2d6;
   `2dex_mod` → `2 d ex_mod` → error (author trap — pin); `level d6` → error (need
   `(level)d6` — pin); `1d6d8` → error; `1d(1d6)` → error; `(7/2)d6` → 3d6; `(0-2)d6` → empty
   pool.
6. **Dice-typing (where dice is forbidden):** `1d6-1d4` error but `1d6-2` ok and `2-1d6`
   error (asymmetry — pin); `-1d6` error; `1d6*1d6` error; `min(1d6,2)` error; `if(1d6,1,2)`
   error; `1d6*-2` → empty pool; `(1/2)*1d6` → factor 0 → empty pool.
7. **Boolean semantics:** short-circuit `0 and (1/0)`=0, `1 or (1/0)`=1 (untested);
   `2 and 3`=1 (no JS value passthrough); `-1` truthy.
8. **Enum edges:** literal on the LEFT (`none==armor_type`); `armor_type==armor_type` /
   `none==none` → error; ordered enum with a homebrew member outside the list → `ci===-1` →
   0; bare enum as a value (`armor_type+1`) → error.
9. **Numeric quirks (pin behavior):** `1.5` → error (no float literals); `-7%3`=-1 (JS);
   `clamp(5,10,1)` lo>hi = 10 (quirk — pin or fix); a newline in the expr → error (CSV cells
   can be multi-line).

## P2 — L2 surround (context, resolve, utils)

10. **`context.ts`:** play vars (`hp`/`hp_max`/`temp_hp`/`exhaustion`) untested directly;
    `hp_percent` floor + `hpMax:0` → 0 (no div-zero); `withSpellcastingMod` THUNK form (the
    DAG relies on it for a live mid-resolve score) — only number form tested.
11. **`collectExprVariables`:** zero direct tests, the whole DAG order rests on it — name
    dedupe, enum-vars excluded, collect from guard+valueExpr+maxExpr, unparseable → `[]`.
12. **`dependency-graph.ts` edges:** two-node mutual cycle (only self-loop tested) → both
    inert + issues; a non-writer token of the same effect survives when its writer is cyclic;
    a guard returning dice → "not a condition" → inert (uncovered branch); a `con` bonus →
    `hpMaxBase` recompute (con→hp_max structural edge); two `grant_resource` same id → larger
    max wins; `resourcesSpent > max` → remaining 0.
13. **Misc:** `diceToFormula` edges (`{pool:{},flat:5}`→"5", flat 0→"0", negative-only
    flat→"-5"); lint of a nested `if` (dice vs either).

## Order

P0 → P1 → P2. ~55–65 new `it` cases + 3 property tests. P0#2 pulls a code fix (finite
guard). Prototype pollution / chained comparisons / fail-closed enum already covered.

# Charnik Plugin Specification — `api: 1`

> **STATUS: IMPLEMENTED (`api: 1`, passive-only).** This document is the normative spec AND the
> plugin-author documentation. Implementation: `src/lib/effects/plugin-registry.ts` (token
> pre-pass + host-side validation), `plugin-sandbox.ts` (the QuickJS-ng sandbox),
> `plugin-host.ts` (discovery + consent), Settings ▸ Plugins (lifecycle UI). The §9 examples run
> verbatim as integration tests (`plugin-sandbox.test.ts`). Where this document and code
> disagree, THIS document wins — or gets amended first. Security requirements live in the
> PLG-SEC checklist in PLAN.md; this spec restates the author-visible consequences.

Plugins are the third expressiveness layer (L3) of Charnik's effects system: L1 is the bounded
token vocabulary (data), L2 is safe value-expressions inside tokens (planned), L3 is sandboxed
code for the long tail that data can't express — level-scaled homebrew dice, computed resource
pools, conditional bonuses. A plugin is a folder of JavaScript executed inside a
**QuickJS-in-WASM sandbox** with no filesystem, no network, no DOM, no app access: it is a pure
function from JSON to JSON. It cannot DO anything — it RETURNS data that Charnik validates and
applies through its normal pipeline.

## 1. The token: how content refers to a plugin

Content rows (and runtime effects) never contain code. They reference a handler:

```
plugin:<namespace>:<handlerName>[:<args>]
```

| Part   | Grammar                      | Max | Meaning                                           |
| ------ | ---------------------------- | --- | ------------------------------------------------- |
| `namespace`   | `[a-z0-9][a-z0-9-]*`         | 32  | Plugin namespace = its folder name                |
| `handlerName`   | `[a-z0-9][a-z0-9-]*`         | 32  | Handler name inside the plugin                    |
| `args` | any string (may contain `:`) | 256 | Opaque parameters, passed to the handler verbatim |

Example CSV cell (the `effects` column, `;`-separated like any tokens):

```
plugin:my-homebrew:exploit-die;flat_bonus:ac+1
```

A `plugin:` token whose plugin is missing, disabled, over budget, or errored **degrades to an
inert text note** on the effects panel — exactly like any unknown token. A plugin can never
break the sheet.

A plugin token may carry an L2 condition guard like any other token
(`is_raging ? plugin:namespace:handlerName`): the guard is evaluated by the resolve stage BEFORE the plugin
pre-pass, so a guarded-off token never reaches your handler.

**Args are hostile.** Tokens arrive in content CSVs, including packs shared by strangers. Your
handler MUST treat `args` as untrusted text: parse defensively, never assume shape, never use
it as a format string. Malformed args should return `{ notes: ["…what went wrong"] }`.

## 2. Packaging: what a plugin IS on disk

```
<dataDir>/plugins/<namespace>/
├── plugin.json     # manifest (below)
└── main.js         # the code; THE only entry, ≤ 256 KB
```

`plugin.json` (validated strictly; unknown keys rejected):

```json
{
	"api": 1,
	"namespace": "my-homebrew",
	"name": "My Homebrew Helpers",
	"version": "1.0.0",
	"author": "Jane Doe",
	"url": "https://github.com/jane/my-homebrew",
	"description": "Level-scaled dice and computed pools for my table's homebrew."
}
```

| Field         | Required | Constraint                                                |
| ------------- | -------- | --------------------------------------------------------- |
| `api`         | yes      | Must be `1` (the host refuses newer than it supports)     |
| `namespace`          | yes      | Token grammar above; MUST equal the folder name           |
| `name`        | yes      | ≤ 64 chars, rendered as plain text                        |
| `version`     | yes      | semver string, ≤ 32 chars                                 |
| `author`      | no       | ≤ 64 chars                                                |
| `url`         | no       | **https:// only**; opens in the OS browser, never in-app  |
| `description` | no       | ≤ 280 chars                                               |

There is no custom entry point, no multi-file imports, no assets in `api: 1` — one `main.js`,
evaluated once per session per plugin in its own isolated runtime.

## 3. Registration: what `main.js` must define

`main.js` is evaluated as a script. It must leave a global `handlers` object:

```js
globalThis.handlers = {
	'exploit-die': {
		passive(token, ctx) {
			/* … */
		}
	}
};
```

- Keys are handler names (`handlerName` in the token grammar).
- Each handler is an object so future hooks (`onUse`, see §8) slot in without breaking.
- Evaluation must be side-effect-free apart from this assignment; top-level work counts
  against the load budget.

## 4. The `passive` hook (the only hook in `api: 1`)

The two hooks mirror how a character sheet already thinks about features — a **passive** effect
that is always folded into your stats, versus an ability you actively USE (its hook is `onUse`,
§8). `passive` is the `api: 1` hook: a PURE read-only computation. It is called by the derive pre-pass —
**once per distinct token per sheet computation**, NOT once per stat — receives the parsed token and
a read-only context (the **dependency-resolved derive state**, §8.4 — so a passive condition reads a
well-defined value; a self-referential effect is flagged in content-health rather than allowed to
oscillate), and returns what should be folded into the sheet. It can never mutate anything; only
`onUse` (§8) produces state changes, and only on a user click.

```
passive(token, ctx) → result
```

### 4.1 `token` (input)

```json
{
	"namespace": "my-homebrew",
	"handlerName": "exploit-die",
	"args": "d8@5,d10@11",
	"raw": "plugin:my-homebrew:exploit-die:d8@5,d10@11"
}
```

### 4.2 `ctx` (input) — everything a handler may know

`ctx` is **two sub-objects with different lifetimes** (this is the ONE authoritative ctx
definition; L2 and L3 read the SAME split — L2's build/play variable groups map 1:1 onto these):

- **`ctx.build`** — the stable, always-available character definition. Changes only on a
  build edit (level-up, ASI, new item), never during play.
- **`ctx.play`** — the dependency-resolved play-state (§8.4): current HP, active flags and
  conditions, remaining resources. Changes constantly (every HP tick, every condition).

```json
{
	"api": 1,
	"build": {
		"system": "5e",
		"level": 7,
		"classLevels": { "fighter": 5, "rogue": 2 },
		"proficiencyBonus": 3,
		"abilities": {
			"str": { "score": 16, "mod": 3 },
			"dex": { "score": 14, "mod": 2 },
			"con": { "score": 14, "mod": 2 },
			"int": { "score": 10, "mod": 0 },
			"wis": { "score": 12, "mod": 1 },
			"cha": { "score": 8, "mod": -1 }
		}
	},
	"play": {
		"hp": 41, "hpMax": 58, "tempHp": 0,
		"flags": { "isBloodied": false, "isRaging": false, "isConcentrating": false },
		"conditions": ["frightened"],
		"resources": { "grit": 2 }
	}
}
```

Least-data by design: game numbers only — never names, notes, or any free text; nothing worth
stealing crosses the boundary. Anything else your mechanic needs, encode into the token's `args`.
`classLevels` is keyed by bare class ids. Fields may be ADDED to either sub-object within
`api: 1`; none will be removed or change meaning. The `abilities` scores/mods are the
**effective** (post-effect) values, resolved before your handler runs (§8.4).

**One vocabulary with L2 (naming rule).** Every ctx name is the SAME word as its L2 expression
variable, only re-cased to the ctx JSON's camelCase: `hp_max` → `hpMax`, `class_level.<id>` →
`classLevels[<id>]`, `is_bloodied`/`is_raging`/`is_concentrating` → the `flags` keys
`isBloodied`/`isRaging`/`isConcentrating`, `resource.<id>` → `resources[<id>]`. A fact never has
two names across the layers. `play.hpMax` is the PRE-plugin value (a manual play-state max wins;
plugin `hp_max` contributions fold after the ctx is built — a handler can't observe its own
output).

**Memo economics (why the split exists).** Results are memoized on `(token, ctx-hash)`, and the
two sub-objects are **hashed separately**. The host tracks which sub-objects a handler actually
reads: a `passive` that touches only `ctx.build` (an always-on numeric effect — most of them)
is re-run ONLY on a build edit, so it stays cache-hot across every HP tick and satisfies
PLG-SEC 13's "most derives cost zero". A handler that reads `ctx.play` re-runs whenever play-state
changes — the cost you opt into by writing a conditional. Read `ctx.play` only when your mechanic
is genuinely conditional; a build-only handler is free.

### 4.3 `result` (output) — two dialects, both Charnik's own data language

```json
{
	"tokens": ["flat_bonus:attack+1d8"],
	"contributions": {
		"ac": [{ "layer": "feature", "op": "add", "amount": 1, "label": "Defensive stance" }]
	},
	"notes": ["Exploit die: d8 (fighter 5)"]
}
```

All three keys optional; an empty object is a valid "nothing applies" answer.

- **`tokens`** — L1 vocabulary tokens, exactly as they could appear in a CSV cell. They pass
  through the SAME parser and rules as content tokens (unknown → inert note). Use this
  dialect when the vocabulary can express the outcome and only the CHOICE is computed
  (which die at this level, how many charges). This is the preferred dialect: dice riders,
  advantage/disadvantage, resources, proficiency grants all work through it. `plugin:` tokens
  inside `tokens` are IGNORED (no recursion). **Each array element must be exactly ONE token** —
  a `;` or newline inside an element (the CSV token separator) rejects the whole result, so a
  handler can't smuggle 100 tokens past the ≤16 cap in one string. Numeric values inside these
  tokens are host-CLAMPED like any content (a bonus is finite-guarded; a resource/dice count is
  cost-capped) — the same treatment content gets, since these ride the same parser.
  **`api: 1` limit:** the pre-pass runs AFTER the dependency-resolve stage (your handler reads
  the RESOLVED state), so returned tokens cannot feed condition guards or the effects DAG. A
  returned `apply_condition:<id>` registers the condition AND expands its stat tokens **one
  level** (a plugin-granted Poisoned really disadvantages attacks) — but tokens inside that
  expansion don't cascade further, and no guard sees the plugin-granted state until the next
  play-state change re-derives. A mechanic that must drive guards belongs in content tokens, not
  in a plugin result.
- **`contributions`** — pre-folded pipeline entries for computed AMOUNTS the vocabulary can't
  say (`ceil(level/2) + WIS`). Keyed by target key (see §4.4). Constraints: `layer` ∈
  `feature | item | condition` (the core layers `base`/`ability`/`proficiency` and the
  `override` layer are host-reserved in `api: 1`); `op` ∈ `add | set | mult`; `amount` must
  be finite, `|amount| ≤ 1000`; `label` ≤ 48 chars. The host prefixes every label with your
  `namespace` in the provenance trace — a plugin cannot masquerade as core math. An `op: "set"` folds
  exactly like a content `set_override` (at the override stage, most-potent-wins across all
  sets); `add`/`mult` fold at your declared layer.
- **`notes`** — plain-text explanations for the stat tooltip / effects panel. Rendered as
  plain text ONLY (no markdown, no links), ≤ 200 chars each.

Caps (host-enforced; exceeding any → the whole result is rejected → inert note): ≤ 16 tokens,
≤ 20 contribution target keys, ≤ 8 contributions per key, ≤ 8 notes.

### 4.4a Compute-once vs fold-per-occurrence, and how a result is attributed

Two distinct counts, easy to conflate:

- **Compute is memoized** on `(raw token, ctx-hash)` (§4.2, §5). The handler runs at most ONCE
  per distinct token per computation — the "once per distinct token, NOT once per stat" rule
  above is about COMPUTE, not application.
- **Application folds once per CARRYING occurrence.** If two equipped items each carry the SAME
  `plugin:` token, the memoized result is computed once but APPLIED twice — once per item — exactly
  as two identical L1 tokens on two items stack. (Compute is deduped; effect is not. A mechanic that
  must not stack should say so in its own math, like any content.)
- **Attribution.** A result inherits the **carrying effect's `source`** (the item/feature/effect
  that held the token), so provenance reads "Ring of Protection · my-homebrew: …", never a bare
  plugin name. Returned **`contributions`** fold at the handler-declared `layer` (§4.3);
  returned **`tokens`** fold at the **carrying effect's own layer** (an item's token → `item`
  layer, a feature's → `feature`) — identical to how that effect's literal tokens are attributed.

### 4.4 Target keys

`ac` · `initiative` · `speed` · `speed.fly` · `speed.swim` · `hp_max` · `attack` · `damage` ·
`spell_dc` · `spell_attack` · `save.<str|dex|con|int|wis|cha>` · `skill.<skill-id>` (the 18 SRD
ids) · `passive.<skill-id>` (any of the 18 — every check has a passive form, not only the three
senses the strip highlights) · the action-economy keys `action` · `bonus` · `reaction` (a
`flat_bonus:action+1` grants an extra action-economy slot; consumed by `TurnEconomy.slotMax`) ·
the group `d20_tests` (fans out to every d20 roll — saves, checks/skills, attack, initiative).
The group keys `saves` / `skills` are valid in TOKENS (they fan out), not as contribution keys.
A known-kind token whose target is outside this closed set is kept inert AND surfaced in
content-health (`unknown target "<t>" for <kind>`), not silently dropped (AUDIT B13).
`skill.<id>` is validated by GRAMMAR (a snake-case id), not by membership in the 18 — an unknown
id is accepted and folds onto nothing (the same harmless no-op as a typo'd content target);
prototype-pollution keys die on the grammar + the ≤20-key cap, and folding never indexes an
object by these keys.

## 5. Execution model: what your code runs inside

- **Isolation.** One QuickJS-in-WASM runtime per plugin. No `fetch`, no `XMLHttpRequest`, no
  `import`/`require`, no filesystem, no DOM, no timers, no host objects. If you can observe it
  being there, that's a bug — report it. Two precise cases: dynamic `import()` exists
  syntactically but no module loader is registered and its promise can never settle (the job
  queue is never drained) — it loads nothing; the `eval` BINDING is removed (`typeof eval` is
  `undefined`) while the engine's eval intrinsic stays on internally, because the host boundary
  itself is an eval call.
- **The boundary is a single JSON string.** Your handler's return value is `JSON.stringify`-d
  inside the sandbox and the host parses ONE string (size-capped before parse) — the host never
  walks live sandbox objects (no getter runs host-side during extraction). Return plain JSON;
  a `Promise` / async handler is an invalid result (the host never drains the job queue).
- **Determinism is mandatory and enforced.** `Math.random`, `Date`, `performance`, `WeakRef`,
  and `FinalizationRegistry` are removed (entropy, timing side-channels, and GC-observation all
  break reproducibility — and memoization assumes determinism). Same
  `(token, ctx)` MUST produce the same result — results are **memoized**: your handler may be
  called once and its answer reused for hours. Never rely on call counts or hidden state.
- **Budgets.** Per call: ~5 ms CPU (interrupt-based) and 8 MB memory; per sheet computation:
  ~20 ms aggregate across ALL plugin tokens — beyond it, remaining tokens degrade to notes for
  that computation. Stay well under; a handler is arithmetic, not a simulation.
- **Failure is contained and fail-closed.** A throw, a timeout, or an invalid result becomes
  an inert note; 3 consecutive failures disable the plugin for the session (with a notice).
- **Randomness belongs to the host.** You never roll dice — you return dice FORMULAS (in
  tokens, or via `onUse` later). Charnik's single dice path rolls them, so the roll log
  stays honest. This is WHY a roll-dependent outcome ("heal 2d6") is expressed as a formula the
  host rolls, never a number your code rolled.

## 6. Lifecycle: install, consent, enable

1. **Install** = put the folder under `<dataDir>/plugins/`. Discovery is automatic.
2. **Everything is disabled by default.** Enabling happens per plugin in Settings → Plugins,
   behind a consent dialog showing the manifest.
3. **Consent is per-machine and pinned to a CRYPTOGRAPHIC code hash**
   `(namespace, sha256(len(main.js) ‖ main.js ‖ len(plugin.json) ‖ plugin.json))`, stored OUTSIDE the
   data folder — each file **length-prefixed** (8-byte big-endian byte count) so the two files are
   domain-separated. A bare `main.js ‖ plugin.json` concatenation is ambiguous: bytes moved across
   the file boundary (shrink `main.js` by N, grow `plugin.json` by N) yield the SAME digest while
   both files differ — a length prefix makes the boundary part of what's signed, closing that seam.
   The hash is SHA-256
   (`crypto.subtle.digest`), NOT the fast xxh64 used for content-drift detection — consent is an
   adversarial trust gate (an attacker WANTS a collision to smuggle in a pre-enabled malicious
   `main.js`), so a collision-resistant hash is required; xxh64 answers "did this change?", SHA-256
   answers "can I trust this exact bytes?". The manifest is hashed too, so a merged data folder
   can't swap in a phishing `url`/`author` after consent. Consequences: moving/merging a data
   folder carries plugin CODE but never its permission; ANY change to `main.js` OR `plugin.json`
   disables the plugin until re-consented. This is deliberate — a "campaign backup" must not be
   able to arrive pre-enabled.
4. **Kill switch:** a global "disable all plugins" toggle exists and always works.
5. **Desktop only.** Plugins run on the Tauri desktop build. The web demo (GitHub Pages) has no
   plugin discovery and does not bundle the QuickJS runtime — so the "consent outside the dataDir"
   requirement has no web edge case, and the sandbox attack surface never exists on the public URL.

## 7. Compatibility contract (what WE promise)

- `api: 1` is stable once shipped: `ctx` fields and result semantics never change meaning or
  disappear within it; fields may be added.
- Breaking changes bump to `api: 2`; `api: 1` plugins keep working for a support window of at
  least one minor release cycle, with a deprecation notice in Settings.
- The host refuses manifests with an `api` newer than it supports (clear message: update
  Charnik).

## 8. Reserved: the `onUse` hook (`api: 2`, shape pinned now)

> **Ownership note (fresh-eyes #1/#3).** The intent model below is CORE-owned — its normative
> home is [`docs/ACTIONS.md`](ACTIONS.md) (the action/event/state-channel spec the tracking app
> needs with or without plugins). This section restates the PLUGIN-visible surface; the detailed
> schemas are illustrative until the core executor lands, and where the two documents disagree,
> ACTIONS.md wins.

`passive` computes always-on stats; `onUse` is the OTHER half — an ability the player actively
uses (variable-cost powers, on-use heals/rolls). It is a second export on the same handler object.
Not called in `api: 1`; defining it today is harmless and forward-compatible. The SEAM is pinned
NOW so `api: 1` can't paint us into a corner.

```
onUse(token, ctx) → intent
```

`onUse` follows the **declarative-intent** pattern: the plugin still DOES nothing — it RETURNS a
description of what should happen, and the host validates it and executes through its own systems.
A plugin can no more heal you directly than a `passive` handler can change your AC directly.

### 8.1 How `onUse` differs from `passive` (the state model)

| | `passive` | `onUse` |
| --- | --- | --- |
| When | every derive (auto) | one user click, never in derive/render |
| Reads | the dependency-resolved derive state (§8.4) | the LIVE state at the instant of the click |
| Produces | contributions folded into stats | an intent that MUTATES play-state, once |
| Memoized | yes (pure) | no (side-effecting; runs once per gesture) |
| Budget | per-call + the ~20 ms aggregate | per-call only (no aggregate — it's one click) |

`onUse` reads LIVE state on purpose: clicking two abilities in a row must let the second see the
first's result (heal to 54, then a "while below 50%" ability correctly sees you're no longer below
half). Each click applies atomically, then triggers a fresh derive, so the next click's `ctx` is
already up to date. There is no simultaneity to resolve — one click is exactly one `onUse`.

### 8.2 The intent (output) — every field optional; `{}` means "nothing happened"

```json
{
	"rolls":   [{ "label": "Smite", "formula": "2d8" }],
	"spend":   [{ "resource": "grit", "n": 1 }],
	"effects": ["flat_bonus:ac+2", "apply_condition:blessed"],
	"hp":      { "delta": "2d4+2" },
	"tempHp":  { "amount": "cha" },
	"cost":    "bonus",
	"notes":   ["Second Wind"]
}
```

- **`rolls`** — dice to roll. FORMULAS only (host rolls, logs, shows) — the plugin never sees the
  result (see §8.3). Each formula is cost-capped like any dice.
- **`spend`** — resources / spell slots to consume. The host checks each EXISTS and `n ≤ remaining`
  BEFORE applying anything; if any is unaffordable the WHOLE use is rejected with a notice and
  nothing is spent (§8.5). `n` is a finite integer, cost-capped.
- **`effects`** — L1 vocabulary tokens applied as a runtime effect (a buff/condition/resource),
  same parser + host clamps as content; a `plugin:` token here is ignored (no recursion); a
  duration is carried by the token and expired by the existing round counter.
- **`hp`** — `{ delta }` where delta is a signed FORMULA or number the host applies through its
  normal HP path (temp HP absorbs damage first; heal clamps to max; damage floors at 0 → the host's
  death-save flow, never an instant-kill shortcut). A random heal ("heal 2d6") is expressed HERE as
  a formula — the host rolls it — never as a number the plugin rolled.
- **`tempHp`** — grant temporary HP (formula/number); the host applies 5e's "don't stack, take the
  higher" rule — the plugin can't force a lower value over a higher existing one.
- **`cost`** — optional action-economy cost (`action | bonus | reaction | free`); the host deducts
  it from the turn tracker. Absent → the host doesn't touch the economy.
- **`notes`** — plain-text log/tooltip lines (same plain-text-only rule as everywhere).

Caps (host-enforced; exceeding → whole use rejected → notice): ≤ 8 rolls, ≤ 8 spend entries, ≤ 16
effect tokens, ≤ 8 notes; every number finite + clamped.

### 8.3 The single-pass limit (what `onUse` CANNOT do in `api: 2`)

`onUse` returns its intent in ONE shot, BEFORE any dice are rolled — so it cannot branch on a roll
result ("on a 6, also stun"). Roll-dependent OUTCOMES are expressed as formulas the host resolves
(`hp.delta: "2d6"`), but roll-dependent LOGIC (read the die, then decide) needs a host callback and
is deferred to a later API. Design your ability so the math is decided from `ctx`, and randomness
is only in the formulas you hand back.

### 8.4 Resolving conditional effects (the order model — a rules-core concern)

A condition like "+2 attack while below 50% HP" reads a value that usually no effect changes, so a
single derive pass resolves it. The only hard case is a conditional whose CONDITION reads a value
another conditional WRITES — raging grants +10 max HP, and separately "advantage while below half"
reads max HP. RAW gives a clear answer (you ARE raging → max IS 110 → you ARE below half): a
DEPENDENCY order, not an arbitrary one. The host resolves it as:

1. **RAW default, order-independent where RAW is.** Stacking bonuses fold commutatively (sum);
   same-target sets take the most potent (max), per "Combining Game Effects". Order literally can't
   change the number, so no file-scan / namespace-sort luck ever decides a stat.
2. **Dependency order for the rare chain.** Where one conditional's condition depends on another's
   output, effects resolve in dependency order (a DAG). For real 5e/5.5e content this graph is
   almost always empty, so it collapses to the plain single pass — no iteration, no convergence
   loop, no "was iterated" flag.
3. **A genuine cycle is a content bug, not runtime state.** A self-referential effect ("+10 max HP
   while below 50% of max") has no unique answer (two self-consistent fixed points); the host
   DETECTS the cycle and flags it in content-health ("this effect's condition depends on its own
   output") instead of iterating to cope. Sticky / self-referential effects must be modelled as a
   LATCH (an `onEvent` toggle, §8.7), never a pure derived condition.

**Visible, reorderable order + a report loop (the safety net).** The resolution order is shown as a
list and can be reordered per character (play-state; a "reset to default" restores the computed
order). For the commutative majority reordering changes NOTHING (RAW ignores order there) — the UI
marks which effects are actually order-sensitive so the control isn't a false affordance.
Reordering is the escape hatch for the rare case the default resolves a stat in a way the user
believes breaks a rule; doing so prompts a pre-filled GitHub "rules-order" issue so the DEFAULT
gets fixed. The intent: a manual reorder is a temporary patch AND a bug signal — if anyone needs
it, our default was wrong and we correct it, driving the need toward zero.

The `ctx.play` a `passive` handler reads is therefore the dependency-resolved state, including active
flags/conditions (`isBloodied`, `isRaging`, `isConcentrating`) so a "while raging" condition can see it —
which is exactly why reading `ctx.play` costs a re-run per play-state change (§4.2 memo economics)
while a `ctx.build`-only handler stays cache-hot.
Per-system note: 5.5e defines **Bloodied** (HP ≤ half max) as a game term many triggers use; 5e
(2014) has no such core term (features spell out "half its hit points"). So `isBloodied` is a
first-class flag under 5.5e and a computed convenience under 5e — a real per-system seam.

### 8.5 Atomicity, targeting, failure

- **All-or-nothing.** The host validates the ENTIRE intent (affordability, caps, well-formedness)
  first, then applies every part, or rejects the whole thing. Never a partial (a spent resource
  with a failed heal).
- **Self-target only.** An intent affects the active character. Multi-target (heal an ally) is out
  of scope for a single-character app.
- **Self-gating.** If the ability's own condition isn't met, `onUse` returns `{}` (+ a note); the
  button can stay clickable, the handler declines. Availability logic lives in the handler.
- **Fail-closed.** A throw / timeout / invalid intent applies NOTHING and shows a notice; the
  shared "3 failures → disable for the session" counter applies. `onUse` never runs during derive
  or render — only on an explicit user gesture — so a broken handler can't corrupt a recompute.

### 8.6 Example (pinned shape)

```js
globalThis.handlers = {
	'second-wind': {
		onUse(token, ctx) {
			// "spend 1 grit, heal 2d6 + fighter level" — decided from ctx, rolled by the host
			const lvl = ctx.build.classLevels.fighter ?? 0;
			if ((ctx.play.resources?.grit ?? 0) < 1) return { notes: ['Second Wind: no grit left'] };
			return {
				spend: [{ resource: 'grit', n: 1 }],
				hp: { delta: `2d6+${lvl}` },
				cost: 'bonus',
				notes: ['Second Wind']
			};
		}
	}
};
```

### 8.7 Reserved: the `onEvent` hook — the third state channel (`api: 2+`, shape pinned)

The state model has exactly THREE channels, and every state transition maps to one:

| Channel | Fires | Direction | Reads |
| --- | --- | --- | --- |
| `passive` | every derive (auto) | READS state → contributions | dependency-resolved state (§8.4) |
| `onUse` | explicit user click | WRITES state (once) | live state |
| `onEvent` | a game event | WRITES state (once) | live state |

`onEvent` covers transitions that are neither a passive read nor a user click — automatic changes
driven by play events (rage ends if you didn't attack this turn; concentration breaks on damage; a
trigger on GAINING a condition). Same declarative-intent output as `onUse`.

```
onEvent(event, ctx) → intent
```

Event vocabulary (pinned): `turnStart` · `turnEnd` · `attackMade` · `damageTaken` · `rest` ·
`wentUnconscious` · **`effectGained`** · **`effectLost`**. `effectGained`/`effectLost` map onto the
existing `play.effects` add / expire path — a condition is an effect (`apply_condition`), so
"gained the poisoned condition" and "gained rage" are the same event, carrying
`{ effect: { id, source, positive, durationRounds? } }`.

Three guards this hook MUST ship with:

1. **Post-hoc, not veto.** `effectGained` fires AFTER the effect is applied — it can add a
   consequence (a roll, another effect, temp HP) but cannot cancel the arrival. "Save to resist the
   condition" is pre-application interception — a harder hook, not in v1.
2. **No recursive cascade.** An intent applied BY an `onEvent` handler does NOT itself re-fire
   events (one level; or a small depth cap with dedupe) — otherwise `effectGained` → apply effect →
   `effectGained` → … loops.
3. **Deterministic order.** One event may wake several plugins → resolve in `namespace` order; side-effecting, not memoized, once per event.

With all three channels, Rage is fully expressible: `onUse` to start (flag + spend a use),
`passive` for the bonuses while the flag is set, `onEvent('turnEnd')` to end it if you didn't
attack, `effectLost` to clear the bonuses when the flag drops. `onEvent` is deferred (`api: 2+`);
only its vocabulary and shape are pinned now so adding it later stays non-breaking.

## 9. Examples

### 9.1 Level-scaled bonus die (the `tokens` dialect)

Homebrew "exploit die" that grows with fighter level: d6, d8 from level 5, d10 from level 11.

```
content: … ,effects
… ,plugin:my-homebrew:exploit-die:d6@1,d8@5,d10@11
```

```js
// plugins/my-homebrew/main.js
globalThis.handlers = {
	'exploit-die': {
		passive(token, ctx) {
			const lvl = ctx.build.classLevels.fighter ?? 0;
			if (lvl < 1) return { notes: ['Exploit die: requires fighter levels'] };
			// args = "d6@1,d8@5,d10@11" — hostile input: parse defensively
			let die = null;
			for (const part of String(token.args ?? '').split(',')) {
				const m = /^(d\d{1,2})@(\d{1,2})$/.exec(part.trim());
				if (m && lvl >= Number(m[2])) die = m[1];
			}
			if (!die) return {};
			return {
				tokens: [`flat_bonus:attack+1${die}`],
				notes: [`Exploit die: ${die} (fighter ${lvl})`]
			};
		}
	}
};
```

The returned token rides the existing machinery: the attack roll picks up the bonus die, the
effects panel tags it, provenance shows `my-homebrew: …`.

### 9.2 Computed resource pool (token with a computed number)

"Grit points equal to your WIS modifier, back on a short rest":

```
effects: plugin:my-homebrew:grit-pool
```

```js
globalThis.handlers = {
	'grit-pool': {
		passive(token, ctx) {
			const n = Math.max(1, ctx.build.abilities.wis.mod);
			return { tokens: [`grant_resource:grit:${n}:short`] };
		}
	}
};
```

### 9.3 Computed amount (the `contributions` dialect)

"+1 AC per 5 character levels" — a number the vocabulary can't derive:

```js
globalThis.handlers = {
	'scaling-ward': {
		passive(token, ctx) {
			const bonus = Math.floor(ctx.build.level / 5);
			if (bonus === 0) return {};
			return {
				contributions: {
					ac: [{ layer: 'feature', op: 'add', amount: bonus, label: 'Scaling ward' }]
				}
			};
		}
	}
};
```

## 10. Troubleshooting

| Symptom                                    | Cause / fix                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| Token shows as plain text on the panel     | Plugin missing/disabled, `namespace` ≠ folder name, or handler `handlerName` not registered  |
| "disabled — code changed" after an edit    | Hash-pinned consent (§6.3): re-enable in Settings                            |
| "over budget"                              | Handler too slow — precompute in args, simplify; 5 ms is a LOT of arithmetic |
| "invalid result"                           | Violated §4.3 (layer/op/caps/finite numbers) — the whole result is rejected  |
| Different result than expected after edits | Results are memoized (§5) — determinism is assumed; restart the session      |
| Plugin disabled mid-session                | 3 consecutive failures → fail-closed; fix the error, re-enable               |

## 11. Testing your plugin

The fixture-runner CLI runs your handler in the REAL sandbox with the real budgets and the real
host-side validation — the same code path the app's derive uses:

```
pnpm plugin:test <plugin-folder> --token "plugin:<namespace>:<handlerName>[:<args>]" [--ctx fixture.json]
```

It prints the validated result (tokens / contributions / notes) or the exact rejection reason.
The optional `--ctx` fixture is a JSON file with the §4.2 shape (`{ "build": {…}, "play": {…} }`;
either half may be omitted — a default level-7 fighter/rogue fixture fills the gaps). Keep
handlers as pure functions; the contract above is all there is.

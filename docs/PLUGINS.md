# Charnik Plugin Specification — `api: 1`

> **STATUS: SPECIFICATION (normative, not yet implemented).** This document drives the
> PLG-1/PLG-2 implementation (see [PLAN.md](PLAN.md) → "PLG · Plugin sandbox") and doubles as
> the plugin-author documentation once the sandbox ships (PLG-3 polishes it with tested
> examples). Where this document and code disagree during implementation, THIS document wins —
> or gets amended first. Security requirements live in the PLG-SEC checklist in PLAN.md; this
> spec restates the author-visible consequences.

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
plugin:<ns>:<fn>[:<args>]
```

| Part   | Grammar                      | Max | Meaning                                           |
| ------ | ---------------------------- | --- | ------------------------------------------------- |
| `ns`   | `[a-z0-9][a-z0-9-]*`         | 32  | Plugin namespace = its folder name                |
| `fn`   | `[a-z0-9][a-z0-9-]*`         | 32  | Handler name inside the plugin                    |
| `args` | any string (may contain `:`) | 256 | Opaque parameters, passed to the handler verbatim |

Example CSV cell (the `effects` column, `;`-separated like any tokens):

```
plugin:my-homebrew:exploit-die;flat-bonus:ac+1
```

A `plugin:` token whose plugin is missing, disabled, over budget, or errored **degrades to an
inert text note** on the effects panel — exactly like any unknown token. A plugin can never
break the sheet.

**Args are hostile.** Tokens arrive in content CSVs, including packs shared by strangers. Your
handler MUST treat `args` as untrusted text: parse defensively, never assume shape, never use
it as a format string. Malformed args should return `{ notes: ["…what went wrong"] }`.

## 2. Packaging: what a plugin IS on disk

```
<dataDir>/plugins/<ns>/
├── plugin.json     # manifest (below)
└── main.js         # the code; THE only entry, ≤ 256 KB
```

`plugin.json` (validated strictly; unknown keys rejected):

```json
{
	"api": 1,
	"ns": "my-homebrew",
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
| `ns`          | yes      | Token grammar above; MUST equal the folder name           |
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
		apply(token, ctx) {
			/* … */
		}
	}
};
```

- Keys are handler names (`fn` in the token grammar).
- Each handler is an object so future hooks (`activate`, see §8) slot in without breaking.
- Evaluation must be side-effect-free apart from this assignment; top-level work counts
  against the load budget.

## 4. The `apply` hook (the only hook in `api: 1`)

Called by the derive pre-pass — **once per distinct token per sheet computation**, NOT once
per stat. The handler receives the parsed token and a read-only context, and returns what
should be folded into the character sheet.

```
apply(token, ctx) → result
```

### 4.1 `token` (input)

```json
{
	"ns": "my-homebrew",
	"fn": "exploit-die",
	"args": "d8@5,d10@11",
	"raw": "plugin:my-homebrew:exploit-die:d8@5,d10@11"
}
```

### 4.2 `ctx` (input) — everything a handler may know

```json
{
	"api": 1,
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
}
```

That is the WHOLE context, by design (least-data: game numbers only — never names, notes, or
any free text; nothing worth stealing crosses the boundary). Anything else your mechanic
needs, encode into the token's `args` when you author the content row. `classLevels` is keyed
by bare class ids. Fields may be ADDED to `ctx` within `api: 1`; none will be removed or
change meaning.

### 4.3 `result` (output) — two dialects, both Charnik's own data language

```json
{
	"tokens": ["flat-bonus:attack+1d8"],
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
  inside `tokens` are IGNORED (no recursion).
- **`contributions`** — pre-folded pipeline entries for computed AMOUNTS the vocabulary can't
  say (`ceil(level/2) + WIS`). Keyed by target key (see §4.4). Constraints: `layer` ∈
  `feature | item | condition` (the core layers `base`/`ability`/`proficiency` and the
  `override` layer are host-reserved in `api: 1`); `op` ∈ `add | set | mult`; `amount` must
  be finite, `|amount| ≤ 1000`; `label` ≤ 48 chars. The host prefixes every label with your
  `ns` in the provenance trace — a plugin cannot masquerade as core math.
- **`notes`** — plain-text explanations for the stat tooltip / effects panel. Rendered as
  plain text ONLY (no markdown, no links), ≤ 200 chars each.

Caps (host-enforced; exceeding any → the whole result is rejected → inert note): ≤ 16 tokens,
≤ 20 contribution target keys, ≤ 8 contributions per key, ≤ 8 notes.

### 4.4 Target keys

`ac` · `initiative` · `speed` · `hp-max` · `attack` · `damage` · `save.<str|dex|con|int|wis|cha>`
· `skill.<skill-id>` (the 18 SRD ids) · `passive.<perception|investigation|insight>`.
The group keys `saves` / `skills` are valid in TOKENS (they fan out), not as contribution keys.

## 5. Execution model: what your code runs inside

- **Isolation.** One QuickJS-in-WASM runtime per plugin. No `fetch`, no `XMLHttpRequest`, no
  `import`/`require`, no filesystem, no DOM, no timers, no host objects. If you can observe it
  being there, that's a bug — report it.
- **Determinism is mandatory and enforced.** `Math.random` and `Date` are removed. Same
  `(token, ctx)` MUST produce the same result — results are **memoized**: your handler may be
  called once and its answer reused for hours. Never rely on call counts or hidden state.
- **Budgets.** Per call: ~5 ms CPU (interrupt-based) and 8 MB memory; per sheet computation:
  ~20 ms aggregate across ALL plugin tokens — beyond it, remaining tokens degrade to notes for
  that computation. Stay well under; a handler is arithmetic, not a simulation.
- **Failure is contained and fail-closed.** A throw, a timeout, or an invalid result becomes
  an inert note; 3 consecutive failures disable the plugin for the session (with a notice).
- **Randomness belongs to the host.** You never roll dice — you return dice FORMULAS (in
  tokens, or via `activate` later). Charnik's single dice path rolls them, so the roll log
  stays honest.

## 6. Lifecycle: install, consent, enable

1. **Install** = put the folder under `<dataDir>/plugins/`. Discovery is automatic.
2. **Everything is disabled by default.** Enabling happens per plugin in Settings → Plugins,
   behind a consent dialog showing the manifest.
3. **Consent is per-machine and pinned to the code hash** `(ns, xxh64(main.js))`, stored
   OUTSIDE the data folder. Consequences: moving/merging a data folder carries plugin CODE but
   never its permission; ANY change to `main.js` disables the plugin until re-consented. This
   is deliberate — a "campaign backup" must not be able to arrive pre-enabled.
4. **Kill switch:** a global "disable all plugins" toggle exists and always works.

## 7. Compatibility contract (what WE promise)

- `api: 1` is stable once shipped: `ctx` fields and result semantics never change meaning or
  disappear within it; fields may be added.
- Breaking changes bump to `api: 2`; `api: 1` plugins keep working for a support window of at
  least one minor release cycle, with a deprecation notice in Settings.
- The host refuses manifests with an `api` newer than it supports (clear message: update
  Charnik).

## 8. Reserved: the `activate` hook (`api: 2`, shape pinned now)

Action-time logic (variable-cost powers, on-use computations) will be a second export on the
same handler object. It follows the **declarative-intent** pattern — the plugin returns what
should happen; the host validates and executes through its normal systems:

```
activate(token, ctx) → { rolls?: [{ label, formula }], apply?: [tokens], spend?: { resource, n }, notes? }
```

Not called in `api: 1`; defining it today is harmless and forward-compatible.

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
		apply(token, ctx) {
			const lvl = ctx.classLevels.fighter ?? 0;
			if (lvl < 1) return { notes: ['Exploit die: requires fighter levels'] };
			// args = "d6@1,d8@5,d10@11" — hostile input: parse defensively
			let die = null;
			for (const part of String(token.args ?? '').split(',')) {
				const m = /^(d\d{1,2})@(\d{1,2})$/.exec(part.trim());
				if (m && lvl >= Number(m[2])) die = m[1];
			}
			if (!die) return {};
			return {
				tokens: [`flat-bonus:attack+1${die}`],
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
		apply(token, ctx) {
			const n = Math.max(1, ctx.abilities.wis.mod);
			return { tokens: [`grant-resource:grit:${n}:short`] };
		}
	}
};
```

### 9.3 Computed amount (the `contributions` dialect)

"+1 AC per 5 character levels" — a number the vocabulary can't derive:

```js
globalThis.handlers = {
	'scaling-ward': {
		apply(token, ctx) {
			const bonus = Math.floor(ctx.level / 5);
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
| Token shows as plain text on the panel     | Plugin missing/disabled, `ns` ≠ folder name, or handler `fn` not registered  |
| "disabled — code changed" after an edit    | Hash-pinned consent (§6.3): re-enable in Settings                            |
| "over budget"                              | Handler too slow — precompute in args, simplify; 5 ms is a LOT of arithmetic |
| "invalid result"                           | Violated §4.3 (layer/op/caps/finite numbers) — the whole result is rejected  |
| Different result than expected after edits | Results are memoized (§5) — determinism is assumed; restart the session      |
| Plugin disabled mid-session                | 3 consecutive failures → fail-closed; fix the error, re-enable               |

## 11. Testing your plugin (intended flow; tooling lands with PLG-3)

A fixture-runner CLI (`node tools/plugin-test.mjs <ns> --token "plugin:…" --ctx fixture.json`)
will run your handler in the REAL sandbox with the real budgets and print the validated result
or the exact rejection reason. Until it ships: keep handlers as pure functions and unit-test
the logic in plain Node — the contract above is all there is.

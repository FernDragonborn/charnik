# Charnik — Effects & Modifier Engine (design-of-record)

Normative spec for the auto-calc engine: how a bounded **effect vocabulary** feeds one
**stacking pipeline** to produce every derived stat as `{value, trace, notes}`. This is the
design record for **L1** (the bounded token vocabulary) and **L2** (value expressions); **L3**
(the QuickJS plugin sandbox) has its own normative spec in [`plugins.md`](plugins.md), the
play-state action model lives in [`actions.md`](actions.md), and the threat model in
[`security.md`](security.md). The build/status history lives in `plan.md` and git.

> **Source of truth is the code** (`src/lib/effects/`). Where this doc and the code disagree,
> the code wins and this doc is stale — fix it.

---

## 1 · Architecture invariants (why the engine has this shape)

- **Data, never code.** Auto-calc flows through ONE stacking pipeline
  (`base → ability mod → proficiency → item → feature → condition → override`, clamped to caps)
  fed by a **bounded vocabulary**. Effects are **interpreted data, not `eval`/a DSL** — a
  security property (security.md). L2 widens the token grammar with a **non-Turing formula
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
| `token-parser.ts`                                                                        | **L1** — `parseToken` (string→`ParsedEffect`), `EFFECT_KIND` vocab, `matchesTarget`, `splitGuard`, the `RechargePolicy`/`Defense` types (the model itself is `rules/recharge.ts`).                             |
| `apply.ts`                                                                               | The fold seam — `collectFacts` (tokens→typed `EffectFacts`), `applyEffects` (fold a stat), `matchesTarget` group fan-out, `mergeFacts`, the `TargetValidator`. |
| `expression-parser.ts`                                                                   | **L2** — formula string → AST.                                                                                                                                 |
| `expression-evaluator.ts`                                                                | **L2** — AST → value (integer OR dice term), over an `EffectCtx`.                                                                                              |
| `dependency-graph.ts`                                                                    | The ONE resolve stage — `resolveActiveEffects` (gather → guards → expand → dedupe → facts), in dependency order.                                               |
| `context.ts`                                                                             | `makeExprContext` / `ctxOf` — the `ctx` a formula reads (build + play vars).                                                                                   |
| `plugin-registry.ts` · `plugin-host.ts` · `plugin-sandbox.ts` · `plugin-store.svelte.ts` | **L3** — see `plugins.md`.                                                                                                                                     |
| `../util/suggest.ts`                                                                     | "did you mean?" fuzzy hints for a typo'd token/target — OUTSIDE the module, called by `character/derive-targets.ts`. |

### The token DSL is snake_case, with `.` for namespacing

Kinds, targets, variables and ids inside a token are `snake_case` — `flat_bonus`, `grant_resource`,
`hp_max`, `wis_mod`, `class_level.monk`, `acid_splash`. **`-` is banned anywhere it can appear
inside an expression**, because L2 makes it the subtraction operator: `class_level.blood-hunter`
would parse as a subtraction. That is why content ids are snake too, not only the grammar's own
words. Snake also matches the CSV column convention (`hit_die`, `name_en`).

TypeScript identifiers stay camelCase, PascalCase and SCREAMING_CASE — a separate layer, and one
nobody types into a CSV.

### Effects a player adds by hand

Beyond content-defined effects, a player can add an ad-hoc one from the effects panel: a **catalog**
of common ones (Bless, Bane, Haste, cover, Guidance…), which is an ordinary `effects.csv` content
type so it localizes and extends like everything else, plus a **Custom…** entry — a name and one or
more bounded-vocab modifiers, or free text with a manual modifier. These live in **play-state**, not
in the build.

Any active effect may carry an optional duration in rounds (blank = until removed). The round
counter decrements them, an effect that reaches zero **expires with a notice rather than
silently**, rests expire what they should, and manual removal is always available.

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
| `flat_bonus`                 | `flat_bonus:<target>[:<type>]+<value>`                  | Additive contribution at the effect's layer (value may be an L2 expr or dice term). Optional `:<type>` on a `damage` target (D9-tail) types an extra damage part on a weapon — `flat_bonus:damage:fire+1d6` (flaming); the typed part rolls + shows separately and never takes the ability mod. |
| `set_override`               | `set_override:<target>:<value>` (+ `floor`/`cap` modes) | Force a value; same-target sets combine by D&D "most potent wins" (`overriddenSetNotes`), never silent-stomp. `floor` = raise-to-at-least, inside its own layer (Headband INT≥19). `cap` = a CEILING on the finished value: it folds last, across every layer and after every add, because that is what RAW's caps are — "increases by 2, to a maximum of 20" is +2 and THEN a ceiling. |
| `block_bonus`                | `block_bonus:<target>`                                  | RAW "can't benefit from any bonus to its `<target>`" (grappled/restrained block ALL speed bonuses): drops effect-borne positive adds; base + penalties survive.                                         |
| `halve`                      | `halve:<target>`                                        | ×½ multiply (the ONE non-integer RAW factor — 2014 exhaustion speed/hp-max). Dedicated kind, not a generic multiply. Targets: `speed`, `hp_max`.                                                        |
| `advantage` / `disadvantage` | `advantage:<target>`                                    | Roll adv/dis (a fact + a note); `netAdvantage` cancels one-for-one. Passives take ±5. On a `weapon_property` row with the target `attack` it is read per ATTACK, for the weapon that carries the word, and a dotted scope names tags that weapon must also carry — Heavy is `str_score<13 ? disadvantage:attack.melee`.                                                                                                                   |
| `auto_fail` / `auto_succeed` | `auto_fail:<target>`                                    | Force a roll OUTCOME (paralyzed/stunned auto-fail STR & DEX saves) — not a die modifier.                                                                                                                |
| `reroll`                     | `reroll:<target>:<threshold>`                           | Reroll a die landing ≤ threshold once (GWF ≤2).                                                                                                                                                         |
| `min_die`                    | `min_die:<target>:<floor>`                              | Treat a die below floor AS floor (Reliable Talent d20→10).                                                                                                                                              |
| `grant_proficiency`          | `grant_proficiency:[<rung>:]<target>`                   | Grant a rung of the proficiency ladder — `partial` (half, rounded down: Jack of All Trades) · `partial_up` (the same rung rounding up: 2014 Remarkable Athlete) · `proficient` (the default when the word is absent) · `expertise`. Sources combine by MAX, so "expertise without proficiency" is unrepresentable and a rung never lowers one already held. |
| `grant_resource`             | `grant_resource:<id>:<max>:<recharge>`                  | Define a resource pool (rage/ki/N-per-day/an item's charges), `recharge` = a trigger, optionally with an amount: `short` · `long` · `short_one` · `consumable` · `other` · `dawn(1d6+1)` · `long(2)`. `max` is cost-capped (`MAX_RESOURCE_MAX`). See §How a pool comes back below. |
| `grant_roll`                 | `grant_roll:<id>:<expr>[:<limit>]`                      | A named feature-granted rollable (Sneak Attack `Nd6`, Bardic Inspiration die); resolves to a dice formula → the DiceTray seam. The optional limit says how often its rule allows it — `turn` ("once per turn", Sneak Attack), an open enum (`ROLL_LIMIT`). A limited roll is marked used where it LANDS and never refused: the same roll is the player's again on another creature's turn, which the app does not see, so the mark is theirs to lift. On the token rather than in a column, because a row may grant two rolls and limit one. |
| `grant_value`                | `grant_value:<id>[.<qualifier>]:<expr>`                 | A named NUMBER the row states about ONE attack: what a miss still deals (`miss_damage` — Graze), the DC of the save a hit forces (`save_dc.con` — Topple). STATED, never folded — the attack row prints it beside the property's name. Read where a weapon is (its mastery property's `weapon_property` row, `combat/attack-properties.ts`); on the sheet it has no attack to be stated for and goes inert with `attackOnly`. The id is open vocabulary, worded by the `statedValue.<id>` catalog family. |
| `extra_attack`               | `extra_attack:<property>:<word>[,<word>…][:<scope>]`    | One statement about the EXTRA ATTACK a weapon property lets you make, keyed by that property so several rows can speak of one attack. The words are closed (`EXTRA_ATTACK_WORD`): `same` / `other` GRANT it — with this weapon again (Cleave), or with this weapon while another carrying the property is wielded (Light) — `bonus` / `free` say what it costs the turn, `modifier` puts the ability modifier back on its damage, which the attack otherwise leaves off unless negative. Light grants (`light:bonus,other`), Nick re-prices the same attack (`light:free`), Two-Weapon Fighting restores the modifier (`light:modifier`). A grant is read per weapon (`combat/attack-properties.ts`) and offered as a control beside the attack row, once per turn; a statement that only re-prices or adjusts may sit on a feature and reaches `facts.extraAttackRules`. The optional scope is tags the weapon — and its partner — must carry (`:melee`, SRD 5.1). |
| `form`                       | `form:<id>:<word>[:<value>]`                            | One statement about a FORM a feature lets the character assume (Wild Shape), keyed by the form's id so several rows can speak of one form. The words are closed (`FORM_WORD`); see ▸ A form below. |
| `damage_sensitivity`         | `damage_sensitivity:<resist\|immune\|vulnerable>:<type>` | Damage defense; applied immune→0 / resist→½ / vulnerable→×2 before temp-HP soak.                                                                                                                        |
| `condition_immunity`         | `condition_immunity:<id>`                               | A condition this character cannot be given (2024 Aura of Courage → Frightened). The id REFERENCES a state row, so it is free-form like a damage type — which is also what lets 2014's `condition_immunity:disease` say a word no row carries. It states what is true of the body and folds onto the Defenses strip beside the damage defenses; it does not refuse an application, because the ruling at the table is the player's (`characters.md` ▸ A tracker surfaces, it never decides). |
| `apply_condition`            | `apply_condition:<id>`                                  | Expand a condition row's own tokens ONE level (the condition's `effects` flow + register `has_condition.<id>`).                                                                                         |
| `regain_on_initiative`       | `regain_on_initiative:<resource>:<n>`                   | When initiative is rolled, top `<resource>` back up to `<n>` (2024 Perfect Focus, Superior Inspiration). AUTO-applied with a notice, not a player click — RAW gives no choice. Same `kind:target:int` shape as `reroll`/`min_die`. |
| `note`                       | `note:<free text>`                                      | DISPLAY-ONLY: a mechanic the engine can't model on a single-character sheet (attacks AGAINST you, auto-crit, sense/relational). Never folds, matches no target; shown distinctly. `;` separates a list. |
| `blocks_concentration`       | `blocks_concentration`                                  | MARKER, no target: the carrying state forbids Concentration (RAW Rage). A fact the combat layer reads to drop or withhold it. |
| `damage_reroll`              | `damage_reroll`                                         | MARKER, no target: once per turn you may reroll a WEAPON's damage dice and keep either (2024 Savage Attacker). Offered as a post-roll button, never auto-applied. |
| `on_event`                   | `on_event:<event>:<action>`                             | When `<event>` happens to this character, run `<action>` — one of the bounded executor verbs (`actions.md` §2), so the trigger and the effect are two closed vocabularies crossed rather than a token per feature. The event set holds only what the app actually FIRES (`turn_start` today: the Next-turn button and entering combat, whose round 1 is the first turn); an unfired name would parse and then never happen. "Only while Bloodied" is the ordinary L2 guard: `is_bloodied ? on_event:turn_start:heal:5+con_mod`. |
| `plugin`                     | `plugin:<namespace>:<handlerName>[:<args>]`             | L3 handler REFERENCE (never code). Resolved by the derive pre-pass through the registry (plugins.md).                                                                                                   |

### Targets

`matchesTarget` (`apply.ts`) matches an exact key OR a group that fans out. Specific keys:
`ac`, `initiative`, `speed`, `speed.fly`, `speed.swim`, `speed.climb`, `hp_max`, `attack`,
`attacked`, `damage`,
`spell_dc`, `spell_attack`, `crit_threshold`, `save.<ability>`, `save.death`, `skill.<id>`,
`passive.<skill>`,
plus the action-economy targets `action` / `bonus` / `reaction`. **Group targets** (fan out):

- `saves` → every `save.*`
- `skills` / `ability_checks` → every `skill.*` (2014 exhaustion L1 rides `ability_checks`)
- `d20_tests` → every d20-based roll (saves, skills, `attack`, `initiative`) — the 2024
  exhaustion penalty rides this one group.

**`attacks` is how many attacks the Attack action makes**, a folded value like every other: base one
from the rules core, raised by `set_override:attacks:<n>:floor` on the feature row, with its trace. A
SET with a floor and not an add — RAW lists Extra Attack among the features that do not stack across
classes, so a fighter 5 / barbarian 5 attacks twice, and two additive tokens would quietly make it
three. **`crit_threshold` decides a HIGHLIGHT and never an outcome** (`roller.md` ▸ Crits): it takes
`:cap` ("unless already lower"), and it takes no scope, so a row whose own text is weapon-only ships
that limit as a `note:` rather than pretending otherwise.

**`senses.<name>` is a range, and its NAME is open vocabulary.** The SRD says four — darkvision,
truesight, blindsight, tremorsense — and a pack may name its own, so the target is accepted by
GRAMMAR (`derive-targets.ts` ▸ `SENSE_TARGET`) rather than by a membership list, exactly as a damage
type is. Two sources take the greater range, which is what `:floor` already means, so the fold needs
no new op: a 2024 dwarf's `set_override:senses.darkvision:120:floor` beside a Belt of Dwarvenkind's
60 reads 120. The sheet DISCOVERS which senses a character has from the facts — there is no list in
`src/` — so a sense nothing grants is absent rather than present at zero feet.

**What it cannot yet say is an ADDITIVE sense**, and Goggles of Night is the row: "if you already
have Darkvision, wearing the goggles increases its range by 60 feet". `flat_bonus` says that, but
the fold runs the `item` layer BEFORE `feature`, so a dwarf's species floor would land on a value
the goggles had already raised and be noted "already ≥". Making a floor global the way a cap is
would fix it and break abilities, where `set_override:int:19:floor` deliberately floors the running
total at its own layer. So that one row stays prose until the ordering has an answer.

**A SCOPED bonus** applies to one thing rather than everything, and says so in the target namespace:
`flat_bonus:damage.melee+2` (a category), `damage.<weapon_id>` (one weapon), `damage.<spell_id>` (one
spell — Agonizing Blast). The scopable targets are `attack`, `damage`, `attacked`, `saves` and `ac`;
every other dotted target IS a target (`speed.fly`, `save.str`). The older `flat_bonus:attack:<category>` (Archery) means the same
thing and normalizes to the same field. A scope matches when EVERY comma-separated part is one of the
rolling thing's scopes, and what those are depends on what is rolling: a weapon names its tags, its
own id, and the ABILITY the attack resolved from (`str`/`dex`); a cast names the spell's id; a SKILL
CHECK names `proficient` when it adds your proficiency bonus (expertise included, Jack of All Trades'
`partial` rung excluded) — which is how Reliable Talent floors the checks RAW says it floors and no
others. A roll that names nothing (a save) picks up no scoped effect at all. Attack scopes fold once,
in `computeAttacks`, because that is where the weapon is known; damage scopes fold at the roll.
2014 Rage is `damage.melee,str` (both halves) and 2024 Rage is `damage.str` (either weapon or
Unarmed Strike) — the same sentence each edition prints, said in scopes.
`docs/internals/compatibility.md` §4 says why the scope is a target and not a fourth segment.

**`grant_proficiency` has its own target namespace**, because what you can be proficient WITH is not
what a bonus can land on: a bare ability or `save.<ability>` (and the `saves` group — "proficiency in
all saving throws" is one statement in the rules, so it is one token), a skill (`skill.<id>`, which
canonicalizes to the bare id, plus the `skills` group for a rung on every skill at once),
`armor.<light|medium|heavy|shield>`, `weapon.<simple|martial>` or
`weapon.<item_id>` for a feature that names specific weapons (Dwarven Combat Training), and
`tool.<item_id>` for one that names a trade. Equipment and tool
grants are BINARY — there is no expertise in wearing plate — and equipment folds on top of what the
classes declare, so a grant never turns a lenient (undeclared) character into a constrained one. The
`weapon.` and `tool.` namespaces are open vocabulary, like a damage type: `derive-targets.ts` holds no
content graph to check an id against, and a mistyped category is indistinguishable from an id it has
never heard of. Armour has no ids, so it stays closed and spell-checked.
A tool grant is not equipment and not a skill: it lands in `sheet.tools`, and the only number it moves
is the one `toolCheck` builds — the ability check the player picks, plus the proficiency bonus. Which
ability that is comes from the tool row's own `ability:<abl>` tag where the edition states one (5.5e)
and from the player at roll time where it does not (5.1 says tool use is tied to no single ability).

**The ladder does RAW's own de-duplication.** Jack of All Trades is `grant_proficiency:partial:skills`,
one token for "half your proficiency bonus on any check that doesn't already include it" — because the
rungs combine by max, a skill the character is already proficient in keeps proficiency and the partial
rung simply loses. The rule needs no second sentence in the engine. The rung is `partial` and not
`half` for two reasons: a rung sits BEFORE its target, so `half:skills` reads as "proficiency in half
the skills"; and "half" reads as a REDUCTION, while this rung is a gain — a lesser proficiency, never
a cut-down one.

**The rung carries its own ROUNDING and its own NAME**, because two features hold it and they differ
in both. `partial` rounds down, as Jack of All Trades says; `partial_up` rounds up, as 2014 Remarkable
Athlete says. The rounding rides BESIDE the rung rather than being a second one: the two sit at the
same tier, show the same dot, and differ by at most 1, so a ladder member that behaved identically
everywhere but one arithmetic line would be a tier nobody could see. The trace credits the granting
row's own name — which is DATA, already in the player's language, so it carries no catalog key — and
not a hardcoded "Jack of All Trades", which is the wrong number under the wrong name twice over.

**`check.<ability>` is every check that ability makes**, its BARE check and its skills alike, which is
how 2014 Remarkable Athlete's "any Strength, Dexterity, or Constitution check" reads. A bare ability in
this kind's target slot already means the SAVE, so the checks needed a prefix of their own. What reads
the grants is `character/granted-proficiency.ts`, one module because it is one question asked from both
ends: derive folds the rungs, the builder shows what it may not un-pick.

**A QUALIFIER on a defence lives in the target namespace**, beside the scopes that were already
there: `flat_bonus:ac.ranged+2` (Arrow-Catching Shield), `advantage:saves.spell` (Mantle of Spell
Resistance), `saves.magical` where the row says "spells and other magical effects", and
`saves.poisoned` where it says "saves to avoid or end the Poisoned condition" — a condition id, open
the way `condition_immunity`'s is. It costs no token segment, which `compatibility.md` §4 reserves
for a bonus type.

**A qualified fact is STATED, never folded**, and that is the half that matters: "+2 AC against
ranged attacks" is not +2 AC, and "advantage on saving throws against spells" is not advantage on a
Strength save. So `applyEffects` skips a fact carrying a scope, `pushFlagNotes` skips one too (a note
on every save saying the Mantle helps would be a lie in the one place the sheet promises to explain
itself), and `rollEffectsFor` applies one only when the roll names that scope — which a save does
not, because the app cannot tell what a save is against. `deriveQualifiedDefenses` is where they are
read instead, and the defences strip says them. Auto-applying would need the player to say what the
roll is against at roll time; until that control exists, stating the fact is the honest behaviour
(`characters.md` ▸ A tracker surfaces, it never decides).

**`attacked` is the one target that is not YOUR roll.** The engine models the dice this character
throws — `rollEffectsFor` takes the rolling thing's scopes, and an attack aimed at you has none of
them — so "attack rolls against you have disadvantage" (Cloak of Displacement) has nowhere to land on
`attack` without putting the enemy's penalty on your own swing. It is a second, small channel
instead: the sheet STATES it beside the other facts about your body, and the roller never folds it,
because we do not roll the monster's dice. It takes a qualifier like any scopable target —
Spellguard Shield is `disadvantage:attacked.spell`, a SPELL attack aimed at you rather than every
attack — and a flag carries that qualifier the way a numeric fact already did (`FactRef.scope`).
What it deliberately does NOT do is decide anything: a DM rolling the monster's attack reads the
chip and applies it, which is the same bargain every other "you may" in this app makes.

**`item_choice` is a PLACEHOLDER, not a variable.** Where a row asks the player a question whose
answer is a WORD — Ring of Resistance's damage type, Dragon Scale Mail's — the row lists the answers
in `choice_options` (`content.md`) and writes `item_choice` in the slot the word goes in:
`damage_sensitivity:resist:item_choice`. The gather substitutes the carried instance's answer into
the token, one whole segment at a time, BEFORE `parseToken` sees it, so the grammar is unchanged and
the parse cache never holds a template that means two things. `item_bonus` cannot do this job and is
not the same mechanism: it is a NUMBER, so it rides the L2 expression in a value slot, while a target
slot evaluates nothing. Unanswered, the token is DROPPED rather than folded onto the word itself —
the same "the app does not choose on the player's behalf" that makes an unanswered `item_bonus` read
0 — and every other token on the row still applies, so Dragon Scale Mail's own `+1` to AC folds
while its resistance waits.

### A form

**A form is a stat block the character wears, and its rules are the granting feature's own
sentences.** `form:<id>:<word>[:<value>]` says one of them; the facts add them up per form id
(`facts.forms`), so the feature that grants the form and a later one that changes it (Beast Spells)
speak of the same thing, the way `extra_attack` rows do.

| Word | Value | Says |
| --- | --- | --- |
| `creature` | a word | the creature type an eligible stat block has — matched as the type or its first word, so `beast (dinosaur)` is a beast and `swarm of tiny beasts` is not |
| `max_cr` | L2 | the highest Challenge Rating eligible. Read EXACT, the one value that is: `1/4` is a rating, not zero |
| `without` | a word | a movement mode an eligible stat block may not have (`fly`, `swim`); guard it to lift it by level |
| `own_hp` | — | the form has the stat block's hit points, and the character's wait behind them |
| `temp_hp` | L2 | Temporary Hit Points gained on assuming it — the higher stands, never both |
| `known` | L2 | how many forms are chosen ahead of time (`build.forms`); absent means any eligible one |
| `hours` | L2 | how long the form lasts, which becomes its clock |
| `casts` | — | spells can be cast in the form |
| `ends_when` | a word | a state row's id that ends the form the moment the character has it — `unconscious` (SRD 5.1), `incapacitated` (SRD 5.2.1). Death answers for every state named. Applied, not offered: neither text leaves a choice (`characters.md` ▸ A tracker surfaces) |

A rule the feature does not state limits nothing. A value that does not resolve is surfaced
(`unreadableFormValue`) and that one sentence is skipped — an unread limit is not a limit of zero.

**What the stat block does is ordinary tokens.** `character/forms.ts` ▸ `formStatTokens` turns the
monster row into `set_override` on Strength, Dexterity, Constitution, Armor Class and the speeds,
and a `:floor` on each save, skill and sense the stat block lists — both editions' "use the higher
of the two". They ride a carrier effect at the `condition` layer, so every number a form moves
names the creature in its trace, and the effects switch drops them with every other layer.

**Hit points are the one thing a form's tokens do not say.** A form replaces Constitution and
leaves the character's hit points alone, so while one is assumed the hit-point base is worked out
from the Constitution the character has WITHOUT it (one extra derive, only while shaped). A form
with `own_hp` then counts the stat block's instead, as an override-layer set, so neither the
character's own bonuses nor a maximum set by hand reach it. Those hit points reaching 0 END the
form, by damage or by a number typed in — they are what ran out. A form without `own_hp` is not
ended by 0 hit points: SRD 5.2.1 names Incapacitated and death, and no more.

**Assuming one is a verb** — `assume_form:<id>` on a resource option (`actions.md` §2) — and the
play-state is `play.form` plus the carrier (`characters.md` ▸ Play-state modelling).

A known-kind token whose target is outside the vocabulary is kept **inert** and surfaced as a
`unknown target "<t>" for <kind>` content-health issue (with a `util/suggest.ts` "did you mean?",
offered by `character/derive-targets.ts`), never folded onto nothing.

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
- **Movement-mode only:** `speed` — the walking speed AFTER effects, readable in exactly one
  place: the value of a `speed.<mode>` target (`set_override:speed.climb:speed:floor`, "a Climb
  Speed equal to your Speed"). The sheet folds its walking speed after the resolve stage, so the
  assemble re-resolves those facts against it (`derive-assemble.ts` ▸ `movementModeFacts`). A guard,
  or a value aimed at any other target, cannot be given the number: the resolver leaves that token
  inert and raises `misplacedWalkingSpeed` rather than letting it read 0. **Inert means the token
  becomes a `note:` of its own text**: kept verbatim it would still be a kind the fold knows, and
  `set_override:ac:speed` would set AC to the 0 it read.
- **Attack-scoped:** `attack_mod` — the ability modifier ONE attack resolved from (Strength or
  Dexterity, whichever that weapon swings with). Only an attack can answer it, so it is readable
  where a weapon property's tokens are evaluated for the weapon that carries it; a sheet-wide token
  that reads it is left inert with `attackOnly`, for the same reason `speed` is turned away.
- **Item-scoped:** `item_bonus` — the `+N` the PLAYER answered for the carried item whose row this
  token is on, scoped to that effect the way `spellcasting_mod` is scoped to a class. 0 everywhere
  else, including on the same row before it is answered: the SRD prints ONE "Weapon, +1, +2, or +3"
  and lets the rarity set the number, so the number belongs to the item someone found rather than to
  the shared row, and the app does not pick the smallest on their behalf. The row declares the rungs
  it offers in `bonus_choice` (`content.md`); the answer lives on the inventory entry beside `base`.
- **Guards (dependency-resolved play-state):** `hp`, `hp_max`, `hp_percent`, `temp_hp`,
  `exhaustion` (0..ladder-max), `size` (ordinal), `armor_type` (`none/light/medium/heavy`), the
  `is_*` flags, `has_condition.<id>`, `resource.<id>` (remaining), `resource_max.<id>`.

**Operators** (precedence high→low): `d` (dice) > unary `-` > `* / %` > binary `+ -` >
comparisons (`< <= > >= == !=`) > `not` > `and` > `or`. Comparisons are **non-associative** —
`5<=level<=10` is a parse error (spell it `5<=level and level<=10`). **No `?:` ternary.**
Whitelisted functions: `if min max floor ceil round abs clamp sign step var per_slot` — nothing
else. `step(index, a->v, …)` is the level-table primitive (the `->` pair shape is legal ONLY
inside it), `var()` is readability sugar, and `per_slot()` reads the cast-ephemeral slot vars.

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
  deliberate exception (species input, not derived speed), and `speed` is not one: a movement
  mode is a different stat from the walking speed it reads, and nothing else may read it.
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

### How a pool comes back: `{trigger, amount}`

Two axes, and the words on disk are sugar over them (`rules/recharge.ts`). **Trigger** is the
boundary it comes back at — `short` · `long` · `dawn` · `dusk` · `consumable` (used up for good) ·
`other` (the player restores it by hand). **Amount** is `all` or an L2 expression, resolved when the
boundary is crossed so a die is rolled at the moment the charges are regained.

The cell is the trigger, optionally carrying the amount in parentheses: `short` · `long(2)` ·
`dawn(1d6+1)`. Parentheses rather than another `:` because a token's segments are colon-separated
and an amount is an expression with its own punctuation.

`short` = `short(all)`, `long` = `long(all)`, and **`short_one` = `short(1)`** — the third "rest
policy" invented for 2024's regain-one pattern turned out to be an amount, which is what made the
second axis necessary rather than convenient. Nothing on disk changed.

**A long rest fills a SHORT-rest pool in full**: it is the bigger boundary, so `short(1)` regains one
use on a short rest and the whole pool on a long one — exactly what `short_one` did, and RAW's own
sentence for Second Wind. That is a statement about the short-rest pool and about nothing else: a
pool whose OWN boundary is the long rest pays out its authored amount there, because that amount IS
what its author said a long rest gives back, so `long(2)` regains two and not the pool. Reading the
amount for one trigger and ignoring it for the other made the example in the line above unwritable.
**Dawn and dusk are not rests.** RAW ties a wand to the hour, and eight hours from noon is not dawn,
so sleeping never refills one; the player presses **Dawn** (or **Dusk**) in the pass-time bar, which
is shown only when this character HAS such a pool. The app has no clock, and inventing one to decide
when a day turned would be the tracker deciding rather than surfacing.

**Item charges are an ordinary pool, not a second counter.** A charged item says
`grant_resource:<id>:<charges>:<trigger(amount)>` in its own `effects` cell, and an equipped or
attuned item's effects are already gathered — so charges get the pips, the spend path, the chip and
the rest handling that every other resource has. There is deliberately **no `charges` column**: the
same fact spelled in two places is the drift this vocabulary exists to avoid.

Two patterns still living in their own subsystems, on purpose:

1. **Partial-on-long** — SRD 5.1 Hit Dice regain HALF your level on a long rest (5.2.1 regains them
   all). It rides the hit-dice subsystem, not this model: its spend/restore math is its own. WHICH
   dice return is the player's choice wherever the rest cannot return them all and the pool mixes
   sizes — the Long button then opens a picker pre-filled largest-first (`rules/core` ▸
   `hitDiceRecovery`), and a rest nobody chose for (an action's `rest:long`) takes that default.
2. **Event-based regain** — 2024's "when you roll Initiative, regain … until you have N" is an
   EVENT, not a recharge policy. It keeps its own token, `regain_on_initiative:<resource>:<n>`,
   auto-applied on combat-enter with a toast: "top up TO n" is not one of the executor verbs, and
   inventing a verb used nowhere else would be worse than the second token. Anything else an event
   should DO is `on_event` above. The player-CHOICE version (Persistent Rage, Uncanny Metabolism) is
   an onUse resource-option, and arbitrary event-triggered LOGIC is L3 plugin `onEvent` — never a
   wider L1 token.

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

### Two of the same thing

**RAW: the same spell cast twice does not combine.** SRD 5.1 states it under Spellcasting ▸ Casting
a Spell ("Combining Magical Effects") and SRD 5.2.1 restates it under Casting Spells:

> The effects of different spells add together while the durations of those spells overlap. The
> effects of the same spell cast multiple times don't combine, however. Instead, the most potent
> effect — such as the highest bonus — from those castings applies while their durations overlap.

5.2.1 titles it **Combining Spell Effects** and adds a tiebreaker 5.1 has not: where the castings are
equally potent and their durations overlap, the **most recent** applies. The rule's own example is
two Clerics casting Bless — one benefit, not two bonus dice.

**The engine enforces it in one place**, `dedupeRuntimeEffects` (`resolver.ts`), on the `condition`
layer only — build-time layers stay per-instance, because a repeatable feat legitimately applies each
time. A CONDITION needs no such rule: every condition either applies or does not, and the one the SRD
calls cumulative (Exhaustion, both editions) is a LADDER carrying its own `max_level` rather than a
row you hold twice.

**The key is the NAME alone**, and among the instances wearing it the most potent applies. Keying on
the token list as well would let two castings at different potencies both apply, which is the case the
rule exists to stop. At equal potency the MOST RECENT wins — later in `play.effects` is later applied,
because the array is appended to — so topping an effect up before it lapses carries its fresh duration
instead of doing nothing.

**Potency is the sum of the MAGNITUDES of the literal amounts an instance's tokens declare.**
Magnitude rather than the signed value, because the more potent Bane is the one that takes more off.
A value that is not a literal yet — an L2 expression, a die — counts 0 at this stage, since the fold
has not run and there is no ctx to resolve it against; both instances then tie and recency decides,
which is the right answer for the rule's own example (two Clerics casting Bless ARE equally potent).
**The stated limit:** two same-named effects differing only in their DIE (`+1d4` against `+1d6`) tie
where RAW would rank them. No shipped row produces that pair.

**`set` folding by "most potent" is a DIFFERENT question** (`rules/pipeline.ts`) and answers to no
rule quoted above: it is about two sources setting the same TARGET, whatever their names, where RAW
says nothing general. Highest-wins is our reading, and the loser is surfaced as a note rather than
silently stomped. The DMG's broader same-NAME rule ("Combining Game Effects", 2014 DMG) is not SRD
content and is not what either of these implements.

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
   - **3½ · Plugin pre-pass** (L3, plugins.md) — runs AFTER the first `collectFacts` over the
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

**Maintenance traps (learned the hard way):**
- **`deriveSheet` is PURE — it NEVER mutates the `character`.** Clamps and persistence
  (e.g. `clampCurrentHp`) live in the VM `$effect`s, not inside derive. (CLAUDE.md "core is pure"
  made concrete: derive reads state and returns `{value, trace, notes}`; it does not write it back.)
- **A new kind/target must be added in THREE places or the token folds into nowhere / renders raw:**
  (1) the derive `isTargetSupported` closed-vocab set (`effects/apply.ts`), (2) `effectTag` (the panel
  label), and (3) `lintEffectTokens` (reachability). Miss (1) → the token is inert; miss (2)/(3) → it
  works but shows as a raw string / passes lint silently.

---

## 5 · L3 — plugins (summary; see plugins.md)

For the true homebrew tail that L2 can't express, a **`plugin:` token** references a handler in
`dataDir/plugins/<namespace>/main.js` (never code in CSV). Handlers run in a **QuickJS-in-WASM
sandbox** (zero-capability context, per-call CPU/memory budgets, JSON-string boundary, host-side
zod revalidation, length-prefixed SHA-256 consent hash stored outside the dataDir, fail-closed
counter). A handler returns declarative output (`contributions` / L1 `tokens`) that rides the
existing fold; it can NEVER break derive (any failure degrades to an inert note). Three state
channels: `passive` (READ state → contributions), `onUse` / `onEvent` (WRITE play-state, core-owned
per actions.md; deferred to `api: 2`). **Desktop-only** — the web build never loads the sandbox
(it ships the chunk and never fetches it; `plugins.md` ▸ Lifecycle). Full
normative contract, ctx/result schemas, budgets, and the security checklist: [`plugins.md`](plugins.md).

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

- [`plugins.md`](plugins.md) — L3 plugin sandbox, the normative `api: 1` contract.
- [`actions.md`](actions.md) — the core play-state action/event model (`onUse`/`onEvent` intent).
- [`security.md`](security.md) — the threat model (no `eval`/DSL, sandbox containment, cost caps).
- `plan.md` — status/roadmap and the AUDIT SPEC cross-references.

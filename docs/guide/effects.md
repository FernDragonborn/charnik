# Effects — the author's guide

Charnik reads your rules out of CSV files you own. Most columns are plain facts: a name, a weight, a
damage die. One column is different — **`effects`** — and it is the one that makes a number on the
sheet change by itself.

This page is for the person writing that column. It starts from nothing, and by the end it is the
complete specification: every effect Charnik understands, everything you can point one at, and the
small formula language you can write inside one.

You do not need to program. An effect is a sentence in a fixed shape, and Charnik never runs it as
code — it reads it, understands it, or tells you it could not.

> **Looking for the engineering spec instead?** [`../internals/effects.md`](../internals/effects.md)
> is the normative document: the same vocabulary with the reasons, the invariants and the edge cases
> that matter when you are changing Charnik rather than writing content for it.

---

## 1 · Where effects live

Any content row can carry them. Open a pack folder — `content/srd-2014/`, say — and every CSV there
has an `effects` column: classes, class features, species, feats, items, conditions, spells.

One cell holds **one or more effects, separated by `;`**:

```
advantage:save.dex;note:Only against effects you can see
```

Whitespace around an effect is ignored. A blank cell means "this row changes no number", which is
true of most rows — a spell that deals damage says so in its own columns, not here.

Edit the file in any spreadsheet, save it, and Charnik picks it up while it is running. If you
hand-edit a file that shipped with Charnik, run `pnpm restamp <file>` afterwards so it knows the
change is yours and stops replacing it on update.

---

## 2 · Your first three effects

**A flat bonus.** A cloak that makes you harder to hit:

```
flat_bonus:ac+1
```

Read it as three parts: *what kind of thing this is* (`flat_bonus`), *what it lands on* (`ac`), and
*how much* (`+1`). Armor Class goes up by one, and the number explains itself — hover it on the sheet
and the cloak is named in the breakdown.

**A bonus that only sometimes applies.** A barbarian moves faster, but not in heavy armour:

```
armor_type!=heavy ? flat_bonus:speed+10
```

Everything before the `?` is a **guard** — a yes/no question asked about this character right now. No
guard means "always".

**A bonus that depends on the character.** A paladin adds their Charisma to every saving throw, and
at least 1 even with a Charisma penalty:

```
flat_bonus:saves+max(1,cha_mod)
```

The value is a small **formula**. It has no randomness, no loops and no text — it reads numbers about
this character and produces one number.

Those three shapes — a token, an optional guard, an optional formula — are the whole system. The rest
of this page is vocabulary.

---

## 3 · The shape of an effect

```
[ guard ? ] kind : target [ : value ]
[ guard ? ] flat_bonus : target +|- value
```

- **`kind`** — what sort of change this is. There are 21, all listed in §5. You cannot invent a new
  one; Charnik will tell you it has never heard of it.
- **`target`** — what the change lands on: a stat, a roll, a skill. Listed in §6.
- **`value`** — how much, when the kind needs one. A whole number, a dice term like `2d6`, or a
  formula (§7).

**`flat_bonus` is the one that uses a sign**, and the sign is part of the value, not a fixed joint.
A penalty is written the way you would expect:

```
flat_bonus:speed-5
flat_bonus:save.dex-1
```

Both of those are real shipped rows. There is no separate "penalty" effect — a bonus of −5 *is* the
penalty.

**One trap worth knowing:** a `-` in front of a *formula* negates the whole of it, not just its first
term. `flat_bonus:speed-2*exhaustion` means `-(2 × exhaustion)`, which is what you want. But it also
means `flat_bonus:hp_max-2+3` is −5, not +1. When a formula has more than one term, write the sign
inside it and keep the joint a `+`: `flat_bonus:d20_tests+(-2*exhaustion)` is how the shipped 2024
exhaustion rule says it.

**The colon is structure, never arithmetic.** `:` separates the parts of an effect and nothing else —
which is why a formula never contains one, and why a conditional value is written `if(a, b, c)`
rather than with a `?:`.

A few kinds are **markers**: they take no target at all, because the statement is about the whole
character. `blocks_concentration` is one.

---

## 4 · Guards — when an effect applies

Put a question and a `?` in front of any effect:

```
is_raging ? advantage:attack
has_condition.frightened ? disadvantage:attack
not is_wearing_armor and not is_wearing_shield ? set_override:ac:10+dex_mod+wis_mod
```

A guard is condition-**first** — "is this true? → then this" — and has no "otherwise" branch. If you
want a different *number* in the other case, that belongs in the value, with `if()`:

```
flat_bonus:ac+if(is_bloodied, 2, 0)
```

Guards see the character as they are at that moment: hit points, conditions, what they are wearing,
how exhausted they are. The full list of what a guard can ask is in §7.

---

## 5 · Every effect kind

### Changing a number

| Effect | Write it as | What it does |
| --- | --- | --- |
| `flat_bonus` | `flat_bonus:<target>+<value>` | Adds to the target. The everyday one. On a `damage` target you may name a damage type — `flat_bonus:damage:fire+1d6` adds a separate fire part that rolls on its own and never takes your ability modifier. |
| `set_override` | `set_override:<target>:<value>[:floor\|cap]` | Forces a value instead of adding to one. Plain form replaces; `:floor` means "at least this"; `:cap` means "no more than this", applied last of all, after every bonus. When two rows set the same target the stronger one wins, and the other is recorded rather than silently lost. |
| `block_bonus` | `block_bonus:<target>` | "Cannot benefit from any bonus to this." Grappled and restrained use it on speed. Penalties and the base value still apply — only bonuses are refused. |
| `halve` | `halve:<target>` | Halves it. Exists because halving is the one place the rules ask for a fraction. Targets `speed` and `hp_max`. |

### Changing a roll

| Effect | Write it as | What it does |
| --- | --- | --- |
| `advantage` | `advantage:<target>` | Roll with advantage. |
| `disadvantage` | `disadvantage:<target>` | Roll with disadvantage. One of each cancels out, exactly as the rules say. A passive score takes ±5 instead. |
| `auto_fail` | `auto_fail:<target>` | The roll fails whatever the die says — paralyzed and stunned do this to Strength and Dexterity saves. |
| `auto_succeed` | `auto_succeed:<target>` | The roll succeeds whatever the die says. |
| `reroll` | `reroll:<target>:<threshold>` | Reroll any die landing on or below the threshold, once. |
| `min_die` | `min_die:<target>:<floor>` | A die below the floor counts as the floor. The shipped Reliable Talent is `min_die:skills:proficient:10` — the floor applies only to checks that add your proficiency bonus, which is the scope doing the work. |
| `damage_reroll` | `damage_reroll` | Marker. Once per turn you may reroll a weapon's damage dice and keep either result. Charnik offers the button; it never decides for you. |

### Giving the character something

| Effect | Write it as | What it does |
| --- | --- | --- |
| `grant_proficiency` | `grant_proficiency:[<rung>:]<target>` | Proficiency, at one of three rungs: `partial` (half your bonus — Jack of All Trades), `proficient` (the default when you write no rung), `expertise`. Rungs combine by taking the highest, so a grant never demotes what a character already has. |
| `grant_resource` | `grant_resource:<id>:<max>:<recharge>` | A pool with a size and a way back: `short`, `long`, `short_one`, `consumable`, `other`, or one carrying an amount like `long(2)` or `dawn(1d6+1)`. Rage, ki, an item's charges. |
| `grant_roll` | `grant_roll:<id>:<expr>` | A named die the feature lets you roll — Sneak Attack, Bardic Inspiration. It becomes a chip you can tap. |
| `damage_sensitivity` | `damage_sensitivity:<resist\|immune\|vulnerable>:<type>` | How this character meets one damage type. Immunity beats vulnerability beats resistance. The type is free-form, so a pack may name its own. |
| `apply_condition` | `apply_condition:<id>` | Apply a condition row, whose own effects then take hold. Expands one level only, so conditions cannot chain forever. |
| `regain_on_initiative` | `regain_on_initiative:<resource>:<n>` | When you roll initiative, top this resource back up to `n`. Applied automatically, with a notice — the rules give you no choice about it. |

### Saying something the sheet cannot do by itself

| Effect | Write it as | What it does |
| --- | --- | --- |
| `note` | `note:<free text>` | Shown, never folded into any number. For a rule Charnik cannot model on a sheet that knows only one character — anything about attacks *against* you, or about what someone else can see. Keeps your capitalisation; separate several with `;`. |
| `blocks_concentration` | `blocks_concentration` | Marker. While this is on the character they cannot concentrate. Rage does this. |

### The two advanced ones

| Effect | Write it as | What it does |
| --- | --- | --- |
| `on_event` | `on_event:<event>:<action>` | When something happens to this character, do something. Today the event is `turn_start`, and the actions are a small fixed list — see [`../internals/actions.md`](../internals/actions.md). Combine with a guard for "only while bloodied": `is_bloodied ? on_event:turn_start:heal:5+con_mod`. |
| `plugin` | `plugin:<namespace>:<handler>[:<args>]` | Hands off to an installed plugin. It is a *reference* to a handler, never code in your CSV. See [`../internals/plugins.md`](../internals/plugins.md). |

---

## 6 · What you can point an effect at

**Stats and rolls:** `ac` · `hp_max` · `initiative` · `speed` · `speed.fly` · `speed.swim` ·
`attack` · `attacks` (how many you get) · `damage` · `spell_dc` · `spell_attack` · `action` ·
`bonus` · `reaction` · any ability by name (`str` … `cha`).

**Saves:** `save.str` … `save.cha`, plus `save.death`.

**Skills:** `skill.<id>` — `skill.stealth`, `skill.perception`, and so on.

**Passive scores:** `passive.<skill>` — every skill has one, not only the familiar three.

**Groups**, which fan out to many at once:

- `saves` — every saving throw.
- `skills` and `ability_checks` — every skill check.
- `d20_tests` — everything decided by a d20: saves, skills, attacks, initiative. The 2024 exhaustion
  penalty is a single effect on this group.

### Narrowing a bonus to some attacks

`attack` and `damage` — and only those two — accept a **scope** after a dot, so a bonus applies to
some rolls and not others:

```
flat_bonus:damage.melee+2          melee only
flat_bonus:damage.longsword+1      one weapon
flat_bonus:damage.str+2            attacks that used Strength
flat_bonus:damage.melee,str+2      both at once — every part must match
```

What a roll offers as scopes depends on what is rolling. A weapon offers its tags, its own id, and
the ability the attack used. A spell offers its id. A skill check offers `proficient` when it is
adding your proficiency bonus. A saving throw offers nothing, so a scoped effect never touches one.

### Proficiency has its own targets

What you can be proficient *with* is not what a bonus can land on:

- an ability (`str`), a save (`save.str`), or the whole group (`saves`)
- a skill (`skill.stealth`, or just `stealth`), or the group (`skills`)
- armour: `armor.light` · `armor.medium` · `armor.heavy` · `armor.shield`
- weapons: `weapon.simple` · `weapon.martial`, or a specific `weapon.<item_id>`

Equipment proficiency is all-or-nothing — there is no expertise in wearing plate.

---

## 7 · The formula language

Anywhere a number is expected you may write a formula instead. It reads facts about the character and
produces one value. It cannot loop, cannot call out anywhere, and cannot roll dice — a dice term in a
formula is *data* that travels to the roller, so the same formula always reads the same way.

### What a formula can read

**About the build:** `level` · `proficiency_bonus` · `class_level.<id>` · `spellcasting_mod` ·
`base_speed` · `<ability>_mod` and `<ability>_score` for each of `str dex con int wis cha`.

Ability names are always spelled out with what you want from them — `dex_mod`, not `dex`. A bare
ability name is an error on purpose, because "dexterity" alone does not say modifier or score.

**About the character right now:** `hp` · `hp_max` · `hp_percent` · `temp_hp` · `exhaustion` ·
`size` · `armor_type` (`none` / `light` / `medium` / `heavy`) · `resource.<id>` (how much is left) ·
`resource_max.<id>` · `has_condition.<id>`.

**Yes/no facts**, which all start with `is_`: `is_bloodied` · `is_raging` · `is_concentrating` ·
`is_wearing_armor` · `is_wearing_shield`.

A name Charnik knows but this character has nothing for reads as `0` or `false` — `class_level.rogue`
on a fighter is simply `0`, so a Sneak Attack row on the wrong class quietly adds nothing. Only a
name Charnik has *never heard of* is an error.

### Operators

Tightest to loosest: `d` (dice) · unary `-` · `*` `/` `%` · `+` `-` · comparisons
(`<` `<=` `>` `>=` `==` `!=`) · `not` · `and` · `or`.

Comparisons do not chain: write `5<=level and level<=10`, not `5<=level<=10`.

Division keeps its exact value while the formula works, and a final result that is not whole is
**rounded down** — the rules' own default. Ask for anything else explicitly with `ceil()` or
`round()`.

### Functions

| Function | Does |
| --- | --- |
| `if(test, then, else)` | Picks one of two values. |
| `min(…)` / `max(…)` | Smallest / largest of what you give it. |
| `floor(x)` / `ceil(x)` / `round(x)` | Round down / up / to nearest. |
| `abs(x)` / `sign(x)` | Magnitude / −1, 0 or 1. |
| `clamp(x, low, high)` | Keeps x inside a range. |
| `step(index, a->v, b->w, …)` | A level table: the value of the highest threshold at or below the index, `0` if none matches. This is how a feature that grows at levels 5, 11 and 20 is written once. |
| `var(x)` | Nothing at all — readability, so `var(class_level.rogue)d6` reads better than the bare form. |
| `per_slot(amount[, step])` | For upcasting: `amount` once per slot level above the spell's own. `per_slot(1d6)` is the usual "+1d6 per higher level". |

### Dice in a formula

Write `2d6`. Either side may itself be a formula, so both the number of dice and the size of them can
grow:

```
ceil(class_level.rogue/2)d6                             Sneak Attack, more dice as you level
1d step(class_level.bard, 1->6, 5->8, 10->10, 15->12)   Bardic Inspiration, a bigger die
```

---

## 8 · When you get it wrong

Charnik never throws away what it could not read, and never guesses.

- **An effect it does not recognise** stays as text on the sheet, with a manual modifier beside it so
  you can apply the rule by hand, and it is listed in **Settings ▸ Content health**.
- **A target it does not know** leaves the effect inert and says so — with a "did you mean…?" when
  your spelling is close to a real one.
- **A formula that does not parse**, or divides by zero, degrades the same way, and content health
  quotes the exact effect and the reason.

So a typo costs you an effect and a line in a list you can find. It never costs you a wrong number,
which is the thing the whole design is arranged to prevent.

---

## 9 · Worked examples, from the shipped rules

Every one of these is a real cell in the SRD packs.

```
grant_resource:rage:step(class_level.barbarian, 1->2, 3->3, 6->4, 12->5, 17->6, 20->inf):long
        Rage: a pool that grows on a level table and comes back on a long rest.

not is_wearing_armor ? set_override:ac:10+dex_mod+con_mod
        Unarmored Defense: replace AC entirely, but only with no armour on.

not has_condition.blinded and not has_condition.deafened and not has_condition.incapacitated ?
advantage:save.dex;note:Only against effects you can see
        Danger Sense: a guard with three parts, and a note for the half no sheet can check.

set_override:attacks:step(class_level.fighter, 5->2, 11->3, 20->4):floor
        Extra Attack: "at least this many", so another feature granting more still wins.

grant_roll:bardic_inspiration:1d step(class_level.bard, 1->6, 5->8, 10->10, 15->12)
grant_resource:bardic_inspiration:max(1,cha_mod):long
        Bardic Inspiration: the die you roll and the pool it spends, in one cell.

grant_proficiency:partial:skills
        Jack of All Trades: half proficiency on every check that does not already have it.

armor_type==heavy ? disadvantage:skill.stealth
        Heavy armour, said the way the rules say it.

min_die:skills:proficient:10
        Reliable Talent: a floor, but only on checks your proficiency is already in.

min_die:damage:two_handed;min_die:damage:versatile
        Great Weapon Fighting: two scopes, because the rule names two kinds of weapon.
```

---

## 10 · Where to go next

- [`../internals/effects.md`](../internals/effects.md) — the normative specification: the same
  vocabulary with the reasoning, the ordering rules and the invariants.
- [`../internals/actions.md`](../internals/actions.md) — what `on_event` can actually do.
- [`../internals/plugins.md`](../internals/plugins.md) — writing a plugin, for when the vocabulary
  genuinely cannot say it.
- **Settings ▸ Content health**, in the app — everything Charnik could not read in the content you
  have loaded. The fastest way to check your own work.

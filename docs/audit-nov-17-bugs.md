# Audit — bugs since 0.8.2 (2026-11-17)

A bug audit, not a security one: what a player loses, and which number on the sheet is wrong. It
covers what changed between `dc5f4a06` and `HEAD` under `src/lib/effects`, `src/lib/character`,
`src/lib/rules`, `src/lib/content`, `src/lib/play`, `src/routes/build` and `src/routes/combat`, plus
the modules that hold player data whether or not they changed — the character migrations and
repository, the drafts, homebrew, the translation carry and its backups — and `form-shift.ts`,
`spell-cast-rolls.ts`, the inventory and the weapon-mastery picker. The table link is left out; it
has an audit of its own.

The pass is blind: it is made by Fable without reading the earlier audits, the research notes, the
open-work files or the changelog. Each subsystem's `docs/internals` file is read before its code, and
every rule is checked against the text of the row in `charnik-content-srd` (SRD 5.1 for 5e, SRD 5.2.1
for 5.5e) rather than recalled. One rule the pack carries no row for is read from the publisher's free
rules page and says so (R1).

- **CONFIRMED** — a vitest case beside the module (`<module>.audit-repro.test.ts`) fails on the code
  as it stands; the failure is quoted. `pnpm vitest run <path>` runs it.
- **LIKELY** — traced in the code, with the reason stated, and not reproduced.

Nothing in `src/` or in the content is changed by this audit. The fix under each finding is the
smallest one that would close it, not one that was applied.

## D · Player data

### [x] D1 · A pack file that arrives malformed replaces a translated file with no copy kept and no word said — medium · closed · both

A translator's cells live inside the pack file. When an update, the seed or a restore replaces that
file with one that does not parse whole (an unclosed quote, a row with too many cells, a repeated
header), the incoming bytes land as they are — deliberately, so the loader can report the damage —
and every translation in the file being replaced goes with it. No copy is written to
`content-backups/`, `orphanedIn` counts zero, and nothing is said. `content.md` ▸ "The file being
replaced is copied aside first … whenever a translation was at stake" does not hold on this path.
After a pack update the only way back is "undo this update", until the next apply replaces `.prev`.

Held by: `src/lib/content/translation-carry-damaged.test.ts`

```
AssertionError: expected false to be true // Object.is equality
 ❯ src/lib/content/translation-carry.audit-repro.test.ts:24:76
```

Root cause: `src/lib/content/locale-merge.ts:79` hands a damaged incoming file to the merge as a table
with no columns, so `locale-merge.ts:133` returns the unchanged result with an EMPTY report;
`src/lib/content/translation-carry.ts:73` reads an empty report as "no translation at stake" and
`keepLocalTranslations` never reaches its `writeBytes` of the backup.

Fix: in `carryLocaleCells`, where the incoming side has no `id` column to merge into, report
`translatedRowIds(local)` as `orphaned`. `mergeOver` then sees a translation at stake, the copy is set
aside, and both the pack-update preview and the seed's toast name the rows.

### [x] D2 · A second homebrew row with a name already taken cannot be saved — low · closed · both

Adding "My Item" twice: the second save is refused with "Id — id must be a lowercase snake_case slug
(a-z 0-9 _)", about an id field the player left blank. The row stays an unsaved draft; nothing is
lost, and nothing says that renaming it is the way out.

Held by: `src/lib/content/homebrew-duplicate-name.test.ts`

```
AssertionError: expected [ Array(1) ] to deeply equal []
 ❯ src/lib/content/homebrew.audit-repro.test.ts:18:31
```

Root cause: `src/lib/content/homebrew.ts:313-314` de-duplicates the slug as `` `${row.id}-${n}` ``, and
`idField` (`src/lib/content/schema-cells.ts`) allows `a-z 0-9 _` only — `-` is the formula language's
minus.

Fix: `_` in place of `-` on those two lines.

## R · Rules and numbers

### [x] R1 · A 5.5e Paladin or Ranger who multiclasses has too few spell slots — a Paladin 1 / Ranger 1 has none — high · closed · 5.5e

Each of the two classes alone has two level 1 slots at class level 1. Together they have no slot
pool at all, so the sheet shows no pips and every leveled cast is refused or free (R3). A Paladin 1 /
Sorcerer 1 has two level 1 slots where a level 2 spellcaster has three; a Paladin 3 / Sorcerer 1 has
three level 1 slots where a level 3 spellcaster has four and two. Every 5.5e multiclass with an odd
number of Paladin or Ranger levels is one caster level short.

SRD 5.2.1, Multiclassing ▸ Spellcasting ▸ Spell Slots: "Half your levels (round up) in the Paladin
and Ranger classes". The pack ships no row for that chapter; the sentence is read from the
publisher's free rules page. SRD 5.1 rounds down, and the 5e numbers are right.

Held by: `src/lib/play/cast-rules-5-5e.test.ts` (the two multiclass cases)

```
AssertionError: expected 0 to be greater than 0
AssertionError: expected [ 'slot-1×2' ] to deeply equal [ 'slot-1×3' ]
```

Root cause: `srd-2024/classes_srd.csv:16-17` state `caster=half` and no `caster_share`, so
`src/lib/rules/spellcasting.ts:172-173` reads the share as `half`, which `shareContribution`
(`spellcasting.ts:151`) rounds down. The zero-slot case is new since 0.8.2:
`src/lib/rules/spellcasting.ts:192` now answers a combined level of 0 with no slots, where the clamp
used to read the table's first row.

Fix: in `charnik-content-srd`, a `caster_share` column on `srd-2024/classes_srd.csv` with `half_up`
for `paladin` and `ranger` — the value the engine already has for a share that rounds up.

### [x] R2 · A 2014 druid who takes a long rest in Wild Shape wakes with the hit points they had before the form — high · closed · 5e

A druid at 5 of 31 hit points assumes a wolf and takes a long rest. The rest ends the form (it lasts
two hours at level 4) and the sheet shows 5 hit points, not 31. The slots and the Hit Dice are back;
the hit points are not. SRD 5.1, Resting ▸ Long Rest: "a character regains all lost hit points".

Held by: `src/lib/play/form-rest.test.ts`, both cases: the form that ends inside the rest and the one that outlasts it.

```
AssertionError: expected 5 to be 31 // Object.is equality
```

Root cause: `src/lib/play/rests.ts:79` restores hit points while the form still stands, so it fills
the FORM's count; `rests.ts:123-127` then drops the carrier effect the rest outlasts, and the settle
step (`src/lib/play/settle.ts:61` ▸ `endFinishedForm`) leaves the form through
`src/lib/play/form.ts:15`, which puts back `hpBefore` — the number from before the transformation.
5.5e is not affected: its druid keeps their own hit points and `hpBefore` is never set.

Fix: in `rest()`, drop the effects the rest outlasts and leave the form BEFORE the long-rest half
runs, and derive the sheet the hit points are read from after that. For a form that outlasts the
rest (druid 16 and up), set `form.hpBefore` to the druid's own maximum (`withoutForm`).

### [x] R3 · A character with no spell slots casts their Magic Initiate spell any number of times for nothing — medium · closed · 5.5e

A Fighter, Barbarian, Monk or Rogue with Magic Initiate has one "Magic Initiate · Cure Wounds" use
and no slots. The spell row's own button casts the spell, rolls the healing, and spends nothing — the
use is still there after three casts, and after the use is spent through the picker the button goes
on casting. SRD 5.2.1, Magic Initiate ▸ Level 1 Spell: "You can cast it once without a spell slot,
and you regain the ability to cast it in that way when you finish a Long Rest. You can also cast the
spell using any spell slots you have."

Held by: `src/lib/play/cast-rules-5-5e.test.ts` (the Magic Initiate case)

```
AssertionError: expected 0 to be greater than 0
```

Root cause: a cast that names no pool asks `slotToSpend` for a slot, and for a character with no slot
pool at all `src/lib/rules/spellcasting.ts:72` answers `null` — "nothing is consumed", the same
answer a cantrip gets. `src/lib/play/cast.ts:192` then pays nothing. The linked pool is only ever
spent when the picker names it (`cast.ts:183`).

Fix: in `payForCast`, a leveled non-ritual cast that reserved no slot looks for a pool linked to the
spell (`poolAllowsSpell`): one with a use left pays, a spent one refuses with the pool's own "none
left", and a spell no pool is linked to casts as it does today.

### [x] R4 · Rage, Poisoned and Frightened do not reach a plain ability check — medium · closed · both

A tap on the STR tile of the Abilities panel rolls a straight d20 while raging — Athletics and the
Strength save do get advantage. The same tap under Poisoned or Frightened rolls without
disadvantage, while a skill and an attack get it. Both SRDs, Rage: "advantage on Strength checks and
Strength saving throws"; Poisoned: "disadvantage on attack rolls and ability checks"; Frightened:
"disadvantage on ability checks and attack rolls".

Held by: `src/lib/combat/roll-ability-checks.test.ts`. The rows read `advantage:check.str` and `disadvantage:ability_checks`; `check.<ability>` is a roll target that reaches the skills built on it, and both reach initiative.

```
AssertionError: expected 0 to be greater than 0   (Rage, :45)
AssertionError: expected 0 to be less than 0      (Poisoned, :52 · Frightened, :59)
```

Root cause: the rows name a narrower target than their text. `rage` carries
`advantage:skill.athletics` (`srd-2014/conditions_srd.csv:57`, `srd-2024/conditions_srd.csv:73`);
`poisoned` and `frightened` carry `disadvantage:skills` (`srd-2014/conditions_srd.csv:41,22`,
`srd-2024/conditions_srd.csv:53,23`). `matchesTarget` (`src/lib/effects/facts.ts:26`) sends `skills`
to `skill.*` only; the bare check rolls as `check.<ability>`.

Fix: in `charnik-content-srd`, `advantage:check.str` beside the Athletics token on both `rage` rows,
and `disadvantage:ability_checks` in place of `disadvantage:skills` on the four other rows — the
target the 2014 `exhaustion` row already uses. Initiative is a Dexterity check in both SRDs, so
`ability_checks` and `check.dex` reach it as well (`facts.ts` ▸ `matchesTarget`).

### [x] R5 · A 5.5e Ranger is never offered the Expertise of Deft Explorer — medium · closed · 5.5e

A Ranger of level 2 to 8 has no Expertise pick in the builder, so one skill is short by the
proficiency bonus on the sheet. SRD 5.2.1, Ranger ▸ Deft Explorer (level 2): "Expertise. Choose one
of your skill proficiencies with which you lack Expertise. You gain Expertise in that skill." The
grant has no restriction, so the count expresses it honestly.

Held by: `src/lib/build/ranger-expertise.test.ts`

```
AssertionError: expected +0 to be 1 // Object.is equality
```

Root cause: `srd-2024/class_features_srd.csv:390` (`ranger_deft_explorer`) has an empty
`expertise_slots`; only `ranger_expertise` (`2@9`) carries one.

Fix: in `charnik-content-srd`, `expertise_slots` = `1@2` on that row.

### [ ] R6 · A 5.5e Prayer of Healing adds the spellcasting modifier it does not have — medium · CONFIRMED · 5.5e

A cleric with Wisdom 16 rolls 2d8+3. SRD 5.2.1, Prayer of Healing: "…and also regain 2d8 Hit
Points." The 5e spell does add it ("2d8 + your spellcasting ability modifier"), as do Cure Wounds,
Healing Word and their Mass forms in both editions.

Repro: `src/routes/combat/spell-cast-rolls.audit-repro.test.ts`

```
AssertionError: expected 3 to be +0 // Object.is equality
```

Root cause: `src/routes/combat/spell-cast-rolls.ts:201-203` adds the modifier to every healing spell
whose `damage` has dice. That is a rule decided in code from the shape of a cell, and
`srd-2024/spells_srd.csv:267` has no way to say otherwise.

Fix: make it the row's statement — the rows whose text adds the modifier say so in data (a term in
the `damage` cell, or a column), and `spellOutcomeParts` reads that instead of "has dice".

Left open on one maintainer decision. The shape is a spell column `heal_modifier`, an open enum whose
one value today is `spellcasting`, set on the rows whose text adds it (5e: Cure Wounds, Healing Word,
Prayer of Healing and both Mass forms; 5.5e: the same less Prayer of Healing), and read by
`spellOutcomeParts` in place of "has dice" — about thirty lines across the schema, the vocabulary, the
homebrew form, `SpellRow`, the two spell files and `content.md`. The decision is what a homebrew
spell file written before the column means:

- **blank adds nothing.** The column is the only truth, as `content.md` asks; a homebrew healing spell
  that relied on the old guess heals by its dice until its author sets the column.
- **blank keeps the old guess for files without the column.** No homebrew row changes, at the price
  of a rule decided in code from a cell's shape surviving for those files.

### [x] R7 · A 5.5e Rage runs out by itself after one minute — low · closed · 5.5e

Entering Rage puts a 10-round clock on it, and the catalog entry reads "Lasts up to 1 minute". A
fight that passes round 10 loses the resistance and the damage bonus with no word. SRD 5.2.1, Rage ▸
Duration: "You can maintain a Rage for up to 10 minutes." Ten rounds is right for 5e ("Your rage
lasts for 1 minute").

Held by: `src/lib/play/rage-duration.test.ts`

```
AssertionError: expected 10 to be 100 // Object.is equality
```

Root cause: `srd-2024/effects_srd.csv:17` carries the 2014 row's `duration_rounds` (10) and its
sentence; `src/lib/play/options.ts:149` starts the clock from it.

Fix: in `charnik-content-srd`, `duration_rounds` = 100 on that row, and "up to 10 minutes" in its
text.

### [ ] R8 · A 5.5e Barbarian is offered ranged weapons for Weapon Mastery — low · CONFIRMED · 5.5e

The mastery picker lists the blowgun, dart, the three crossbows, longbow, shortbow, sling, musket and
pistol for a Barbarian, in Strict as in Free. SRD 5.2.1, Barbarian ▸ Weapon Mastery: "two kinds of
Simple or Martial Melee weapons of your choice". The Fighter's, Paladin's, Ranger's and Rogue's text
has no such limit.

Repro: `src/routes/build/mastery-picks.audit-repro.test.ts`

```
AssertionError: expected [ 'blowgun', 'dart', …(8) ] to deeply equal []
```

Root cause: `src/routes/build/mastery-picks.svelte.ts:51` asks proficiency and nothing else, and
`srd-2024/class_features_srd.csv:23` has no column to state the limit in.

Fix: the feature row states it (a tag list beside `mastery_slots`, `melee` on this one row), and
`MasteryPicks.options` filters by it.

Left open on one maintainer decision: where the statement lives. Either way the reader is one filter
in `MasteryPicks.options` against the weapon's `melee`/`ranged` tag, with a test per edition.

- **a column on class features** (`mastery_weapons`, a tag list: `melee` on the Barbarian's row,
  blank everywhere else) — one more column on a wide file, readable on its own.
- **a qualifier in `mastery_slots`** (`2@1|melee`) — no new column, at the price of a second grammar
  inside a cell that holds a ladder.

## U · UI state

### [x] U1 · A character whose folder was deleted outside the app stays open after "take the file", and its next edit writes the folder back — medium · closed · both

Desktop: the player deletes `characters/<slug>/` in the file manager while that sheet is open. The
next edit raises the conflict question, as it should. Answering that the file's state wins removes
the character from the roster and closes the dialog — and the sheet stays on screen. The next hit
point pressed saves normally and the folder is back. The way out the player chose is undone by the
app.

Held by: `src/lib/character/store-deleted-folder.test.ts`

```
AssertionError: expected true to be false // Object.is equality
 ❯ src/lib/character/store.audit-repro.test.ts:48:48
```

Root cause: `src/lib/character/store.svelte.ts:235-238` — the `file` answer adopts the file and puts
it into the open character only `if (open && theirs)`. With no file there is nothing to adopt, the
adoption forgets the held text, and `characters.active` is left as it was; the repository then has
neither a held copy nor a deleted mark for the slug, so the next `checked` save is an ordinary first
write (`src/lib/character/repository.ts:313-319`).

Fix: where `theirs` is null because the file is gone, close the character
(`characters.active = null`) — the same end state `removeCharacter` leaves.

### [ ] U2 · A homebrew row saved right after typing comes back as an unsaved draft — low · LIKELY · both

Typing the last field and pressing Enter inside 600 ms: the row is saved and its draft deleted, and
the pending autosave then writes the draft again. The Drafts pane shows a pending entry for content
that is saved, and the next "Add" of that type opens pre-filled with it; saving that is D2.

Not reproduced — it needs the mounted form. The reason: the debounce timer
(`src/lib/components/EditContentForm.svelte:126-135`) is cleared only when the effect runs again.
`save()` deletes the draft and moves `baseline` (`:267-268`) so that it will, and then calls `onsave`
in the same tick, which unmounts the form; a destroyed effect does not run again, the effect has no
teardown, and the timer fires on a form that is gone.

Fix: `clearTimeout(writeTimer)` in `save()` before the draft is deleted. Not in an effect teardown:
a form closed mid-debounce has to keep its last write.

The fix is in (`EditContentForm.svelte` ▸ `save`). The box stays open until a browser test mounts the
form, saves inside the debounce, and finds no draft afterwards.

## Ruled out

- A fork of a shipped row into homebrew changing what it does: every row of both packs goes through
  `rowToDraft` → `upsertHomebrewRow` → `loadContent` with every non-prose column equal; only the line
  endings inside multi-line prose move (LF to CRLF).
- The tighter `grant_resource` grammar (`<max>` may hold no colon) turning a shipped pool into an
  unknown token: no shipped token has a colon there.
- `remove` and `rename` in the IndexedDB and in-memory storages taking a neighbour by prefix
  (`characters/ghost` and `characters/ghost-ab12`): both compare against the path plus `/`.
- A v1–v3 save losing a ref through the migrations: every other ref-holding field entered the schema
  after v3, so no older file can hold one.
- The deleted-slug guard dropping a save the player asked for: a new character has `rev` 0, the demo
  and a snapshot restore are `overwrite`, and there is no import path that reuses a slug.
- A translation-backup restore dropping the files it does not hold: `swapInNewTree` carries the rest
  of the pack over.
- Magic Initiate beyond R3: always prepared, its own save DC and attack from the chosen ability, one
  free cast per Long Rest, a cast from a class slot, two instances with separate uses.
- 5e half-casters: no casting at class level 1, and the multiclass sums round down as SRD 5.1 says.
- Wild Shape's ladders in both rows against their own text — uses, Challenge Rating, the speed
  limits, Temporary Hit Points, known forms, hours — and the 5.5e form keeping the druid's own
  hit-point maximum while Constitution is the beast's.
- Rage's uses and damage ladders in both editions, and resistance applied before vulnerability.
- The weapon-mastery counts of the five 5.5e classes against their feature text, and the picks
  trimmed to the cap before they reach the character.

## Not checked

- Anything on the real desktop app: Windows rename and lock behaviour, the folder watcher, the
  `/dev/` probes. Every repro here runs on the in-memory or fake-IndexedDB storage.
- Mounted components: the builder's spell pane, picker cards and ability pane, the combat panels, and
  whatever needs a drag, a hover or an input method.
- `tools/import-translations.ts` run against a real pull request — read only.
- The builder's draft autosave firing between Create and the page leaving (`build-view-model.svelte.ts:643-646`
  against the 600 ms timer in `routes/build/+page.svelte:84-93`): a new draft of the character just
  created is possible on reading, and needs the page to show.
- A long or short rest taken in a 2014 form by its Hit Dice, and a 2014 form that outlasts the rest.
- A second fork of one shipped row replacing the first fork in the homebrew file.
- `sheet-rolls.svelte.ts`, `+layout.svelte` and the reload keys, the settings pages, starting
  equipment, the plugin sandbox, the iterative Tarjan beyond reading it, and `src-tauri`.
- Spell `upcast` cells, monster stat blocks and magic-item numbers as a whole: rows are checked only
  where a finding or a ruled-out line names them.

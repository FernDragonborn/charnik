# Content

> For maintainers. Content is the rules data Charnik loads: spells, items, classes, features,
> conditions. It is CSV, it belongs to the user, and it ships from its own repository.

## The shape on disk

Content **roots** are the subfolders of `<dataDir>/content/`. One folder is one pack. They are
**discovered by scanning** — no list in any config names them.

A root holds any number of CSVs per type (`species_srd.csv`, `species_phb.csv`, …) and everything of
one type merges into one table. Which type a file is comes from its `#content-type:` directive, or
failing that from its filename.

Every row carries the common columns `id`, `systems` (`5e,5.5e`), and `source`, plus the localization
columns `name_en`, `name_uk`, `text_en`, `text_uk`, and so on — all languages side by side in one
file, a missing cell falling back to English.

Nested data uses **linked tables**, not JSON in a cell: `class_features.csv` is keyed by `class_id`
plus `level`. JSON-in-a-cell appears only where nothing else works.

**A type that has a NAME is listed, even when it is not an article.** `resource` and
`resource_option` are data tables — a pool's name, a spend option — with no prose to read, and the
compendium and translate both list them anyway (`hasProse`), because authoring or translating a row
is only possible where its rows are listed, and "everything is doable from the UI" is a shipped
invariant. The pure lookup tables (slot matrices, join rows) carry no name and stay out of both.
SEARCH is article-only (`isBrowsable`), so the palette never answers a spell query with a spend row.

## Identity

A row's effective identity is **`type:source:id`**, so the same `id` from two different sources
coexists and both remain addressable. An exact clash *within one source* is a real error. The **type**
scopes it because slugs are unique per type and not globally: `shield` is both a spell and an item,
so `source:id` alone would collide. A character → content reference and the loader's `byEffectiveId`
use the full key.

**What scopes the slug is the type, except where two types became one.** The merged STATE type
(conditions and runtime effects — CONDEFF) carries two `kind`s whose slugs were unique per kind and
never globally: `rage` is both a condition holding the mechanics and a catalog entry that applies it,
exactly the way `shield` is both a spell and an item. So the kind scopes it there
(`condition:SRD 5.2.1:rage`), which also keeps every saved reference resolving verbatim — a kind is
spelled the way the type it replaced was. `loader.ts ▸ identityScope` is the one place that decides,
and it reads the merged types off `TYPE_ALIASES` so the two cannot drift.

**A content → content link is a BARE id, on purpose, and that is the extension point.** `class_id`,
`subclass_id` and `species_id` match on the id plus the edition and NEVER on the source
(`character/derive-gather.ts`), and the shipped rows spell them that way — `subclasses_srd.csv` carries
`barbarian`, not `class:SRD 5.2.1:barbarian`. That is what lets a homebrew or third-party pack add a
feature, a subclass or a species option to an SRD class without forking the class row. "Fixing" one of
these into a full-key comparison would break every pack that extends shipped content.

Duplicate-group resolutions (keep one, keep all) live in a separate **`collisions.json`** — never in
`charnik.config.json`, because a decision *between* sources cannot live inside one of them without
making that one authoritative over the others.

**Source filtering is two-dimensional.** A row is active only if its **file** is enabled *and* its
**`source` tag** is enabled. The two toggles are independent and both are managed in the UI.

**Read a row's display name through `rowName(row)`.** On the `LoadedRow` union even `name_en` is
`string | undefined`, because the lookup tables (spell slots, XP thresholds) have no such column at
all — so `String(row.data.name_en)` renders the literal "undefined" for exactly those rows. The
accessor falls back to the id. Narrowed rows, where the column is simply present, read it directly.

**A type that MERGED into another keeps answering to its old name.** `conditions_*.csv` and
`#content-type: condition` both still load — as rows of the merged type, stamped with
`kind: condition`. The merge is ours, and a pack author should not have to re-declare their own file
for it; the aliases live in `schemas.ts ▸ TYPE_ALIASES`, next to the registry they qualify.

**An unrecognised file is never silently dropped.** Type comes from the `#content-type:` directive
first, then the filename, and if neither answers, the file is surfaced in content health for the user
to assign a type once — written into the file's own header, since there is nowhere else for it to
live. Guessing the type from the column set was considered and rejected: localization and custom
columns make the fingerprint unreliable, and schemas overlap.

**Robustness is output, not exceptions.** An invalid row, an unknown file, a malformed locale column
or a duplicate id becomes an entry in `issues` — the loader does not throw. `get()` answers
`undefined` and `resolveRefs()` reports what was missing, so the render layer can show everything
that still works and flag the rest.

**A row that differs between systems is SPLIT, never made to lie about both.** `systems=5e,5.5e`
asserts the mechanics are identical. Where they are not: two rows sharing a base id for a real
divergence, or a per-system override column (`mastery@5.5e`) for a small one.

## A column, or a tag

The rule for every schema change:

> **A column when its emptiness is a hole. A tag when its absence means "does not apply."**

`weight_lb` is blank on most items — a hole, because nothing ever extracted it from the source, and
somebody should. `str_min` is blank on a dagger because daggers have no Strength requirement. The first is a
column with a bug; the second was never column-shaped.

`cost` on a magic item is neither: it is blank because no price EXISTS to transcribe. Neither SRD
prices a magic item or gives a formula for one, and the rarity→value table is the DMG's, so it is
never filled in (`AGENTS.md` ▸ Inventing game data). `rarity` is complete in both editions, which
is why it is the axis the picker filters magic on, with a blank `rarity` meaning mundane.

- **Fold alternatives, never companions.** A tag cell stays short only because the folded facts are
  mutually exclusive by kind — a weapon never carries armour tags. Folding facts that CO-OCCUR
  (`cost`, `weight_lb`, `rarity` all apply to one row) grows every cell without bound, which is
  what "everything in tags" fails at.
- **A compound field stays a column even where it would fit.** `damage` is `1d6 slashing; 1d4
  radiant` — its own internal structure, carrying the separators a tag list uses. Same class as
  `effects`. A fact that has grown a grammar is not a tag, however sparse it is. A monster's
  `attacks` is the same kind: `<name>:<+hit>:<reach or range>:<dice> <type>[, <dice> <type>]`, joined
  by `; `, where a second damage part exists only where the source says "plus" — every other number
  later in the sentence is an alternative (a versatile grip, a swarm at half HP) or a condition.
- **A pack mirrors the lines its SOURCE prints, and the two editions print different ones.** SRD 5.1
  gives a creature a "Damage Immunities" line and a "Condition Immunities" line, and the first
  already separates its own groups with `;` ("acid, poison, psychic; bludgeoning … from nonmagical
  attacks"), so the 2014 pack has `immunities` and `condition_immunities`. SRD 5.2.1 prints ONE
  "Immunities" line — damage, `;`, conditions — and the 2024 pack keeps it whole in `immunities`.
  Splitting the 2024 line, or joining the 2014 two, would be this repo deciding what a source meant.
- **What a tag costs**, worst first: zod stops validating it (`ac: optInt` rejects `"eleven"` by
  column name; `ac:eleven` inside a tag list is just a string), so **a bad tag value must surface in
  content health**, never a silent zero; the header stops advertising that the fact exists (an empty
  `str_min` column says "armour can require Strength", a missing tag says nothing); and there is no
  fill-down, sort or filter in a table processor. Hence the quick test: **if you would ever drag it
  down the whole sheet, it is a column.**
- **Grammar.** A tag is `name` or `name:value`, lowercase snake, comma or semicolon separated, read
  by `splitList`. No nesting, no ordering, no third separator. `-` is banned because it is the L2
  minus operator, and `name:value` is the shape every effect token already uses — so a tag name and
  an effect scope are the same string (`two_handed`).

**An empty cell means "not provided", including where the column has a default.** A CSV has no
missing keys — every column of every row exists — so a bare zod `.default()`, which fires only for a
MISSING key, rejects the blank cell it was given a default for. `boolDefault` and `enumDefault`
(`content/schemas.ts`) are what a defaulted column is declared with, and the reason both exist is the
authoring form: it writes every column of a new row, so a column that cannot take a blank cell is a
row nobody can save.

**A row that the BOOK prints once and the rarity varies asks the player which one they found.**
`bonus_choice` lists the rungs (`1,2,3`, or `uncommon:1,rare:2,very_rare:3` where the source states
a rarity per rung), the row's own tokens read `item_bonus`, and the answer lives on the character's
inventory entry beside `base` — because two Weapons +N in one party are different weapons, and the
content row is shared. Unanswered reads 0, so nothing is granted until the player says.
**Every question a row leaves open is asked when the item is ADDED** — which item, which +N, which
kind (`content/item-instance.ts`, taken through
`build/item-instance-picking.svelte.ts` by the builder's and the play sheet's item picker alike): a
small "which one" popover beside the ✓, and a search that already says it — "longsword +1",
"shield +2" — offers the answered instance as a row of its own. Before anything is typed, the same
top section lists the rows that carry a `bonus_choice`, open from the start. Each instance is its own inventory
row, named for what it is ("Longsword +2", from its base's name; a row with no base keeps its heading
with the bonus beside it; a variety by its own name; a word answer beside the heading, "Ring of
Resistance (Fire)" — `combat/carried-name.ts`, the one name the builder and the play sheet both
give it). The row's own name is where the same popover asks again, holding the answers it has: the
way back from a misclick, rather than a standing dropdown on every row.

**The same question with a WORD for an answer** is `choice_options`: a comma list of the ids a row
offers (Ring of Resistance's ten damage types, Dragon Scale Mail's five), answered on the same
inventory entry and read by the placeholder `item_choice` inside the row's own tokens. It is a
SUBSTITUTION rather than a variable, because a damage type lands in a target slot where no expression
is evaluated — `damage_sensitivity:resist:item_choice` becomes `damage_sensitivity:resist:fire`
before the token is parsed. An unanswered row grants nothing: the token is dropped rather than folded
onto the placeholder, while every other token on the row still applies.

**With a ROW for an answer, the question is the `option` type — one row, several options.** A
Belt of Giant Strength is one entry in the book and five belts at the table, each setting a
different score at a different rarity: a different TOKEN per answer, which neither a number nor a
word can carry. So a variety is a row of its own, naming its parent in `option_of` as
`<type>:<id>` (`item:belt_of_giant_strength`), with its own `effects`, folded beside the parent's
at the parent's layer, and its own `rarity`. The answer is the option's id on the same inventory
field `choice_options` answers (`inventoryEntry.choice`), and the row goes by the variety's name
once it is given.

**A class feature's choice is the same type, answered in the build.** A Pact Boon is three
options of `class_feature:warlock_pact_boon`; the feature row's `choose` column says how many, in
the `level:count` grammar `expertise_slots` uses and read by the same `slotsGrantedAtLevel`; the
answer is `build.options`, feature id → option ids, and `character/features.ts` ▸ `heldOptions`
is the one reading of it — the gather folds those rows, the sheet lists them as features, and a
caster's rituals are read off an option's `ritual_source` before its subclass's or its class's.
An option may state the class `level` it opens at and one other option it `requires`; an unmet
one is refused in Strict and noted in Free. Like every content → content link the parent is
matched by id and edition and never by source, so a homebrew pack adds an option to a shipped
row. An option that points at nothing is listed in content health (`optionJoinIssues`).

`choice_options` stays what it is: a damage type is a word the vocabulary already knows, and a row
per word would be rows that say nothing. `species_option` is not folded into `option` either — it
carries three columns and a `kind` of its own, and merging it is a migration with no
player-visible gain. An option does not make a consumable act: a Potion of Healing's variety gives
the row a name and a rarity, and drinking stays the player's.

**An entry the book prints once is filed under every rarity it is found at** (`options.ts` ▸
`itemRarities`): each rung's where `bonus_choice` states them, each variety's where the varieties
are rows. The compendium's rarity grouping and facet, the item pickers' rarity band and a list's
sub-line all read it, so `weapon_1_2_or_3` is found under Uncommon, Rare and Very Rare.

**A resource pool's NAME is a row of its own**, in the `resource` content type, resolved id → name
once per derive (`character/resource-names.ts`) so a pool and its spend-options cannot disagree. It
never belonged to the grant — `bardic_inspiration` is granted by two features — so it is neither a
token segment nor a column on the granting row. The engine keeps `titleCase(id)` as the fallback: a
name is something content ADDS, and it is translated like any other prose.

**What a weapon property DOES is a row of its own**, in the `weapon_property` content type, keyed by
the word the weapon's tag carries: `mastery:vex` on the item, `vex` on the row. The tag says which
weapon has the property; the row holds its name and the rule's own text, so the words are the pack's
(and translatable) rather than a catalog entry, and a surface that prints the property can explain
it (`content/weapon-properties.ts`). A word with no row still prints as itself. The type holds a
mastery (`vex`) and a plain property (`light`) alike — whatever word a weapon's tags carry — and a
row's `effects` are read per ATTACK for the weapon that carries the word, never gathered onto the
character (`combat/attack-properties.ts`). An item's ARTICLE explains its words from the rows of
the item's own edition, not the browsing one (`weaponPropertyRowsFor`): the cell carries the rows
and the view says them on hover and focus (`describedRules`).

A magic item points at the mundane row it is built from with **`base_item_id`**: the base's tags go
underneath, the item's own win by name, resolved in one place (`content/resolved-item.ts ▸
resolveItem`).

A **template** row names no base because the SRD does not: "Weapon (Any Melee Weapon)" is answered by
whoever finds the thing, so the base lives on the player's inventory entry and merges through the same
function. A row is a template when it carries no category-defining tag — no `simple`/`martial` for a
weapon, no `armor:<weight>`/`ac` for armour (`needsBaseItem`). Do not test this by an EMPTY tag list:
every shipped template carries `attunement`, and a net carries tags while doing no damage.

## Magic items that stay prose

Everything the bounded vocabulary can say about a magic item is folded. What is left carries a
`note:`, so the sheet says the thing and the player applies it by hand.

**The magic items that stay prose, each for a reason the vocabulary cannot fix by growing a word:**
- *Shield of Missile Attraction* wants resistance qualified by the SOURCE of the damage rather than
  its type, and the type slot is deliberately free-form, so a qualifier written there is
  indistinguishable from a pack's own damage type.
- *Belt of Dwarvenkind's* advantage is gated on not being a dwarf, which no guard can ask. Its
  "increases by 2, to a maximum of 20" IS said, as `flat_bonus:con+2;set_override:con:20:cap` —
  a cap is applied last, so 19 becomes 20 — and the six Ioun Stones that raise a score say it the
  same way. The one case it gets wrong is a score already above 20 before the item, which the cap
  pulls down to 20; `min(con_score+2,20)` would be exact and is refused as a dependency cycle.
- *Holy Avenger's* advantage is an aura it grants to others. 2014's *Necklace of Adaptation* says
  "harmful gases and vapours", which is not the Poisoned condition its 2024 text names.
- *Armor of Vulnerability* turns ONE answer into three facts (resist one of
  bludgeoning/piercing/slashing, vulnerable to the other two), which no single substitution says;
  *Ring of Elemental Command's* plane brings resistance, movement and a page of other text with it.
- *Goggles of Night* add 60 feet to a Darkvision you already have, and the `item` layer folds
  BEFORE `feature`, so a species floor would land after the goggles' add
  (`effects.md` ▸ Targets).
- *Robe of Scintillating Colors'* disadvantage is charge-gated and applies only to creatures that
  can see you. 2014's *Armor of Invulnerability* resists "nonmagical damage", which is not a type
  the vocabulary can name; 2014's *Cloak of Elvenkind* needs its hood UP, an action.
- A charged item with a RANDOM starting pool ("1d8 + 1 charges") says no pool: the vocabulary
  takes a literal max.

**What will never fold, and should stop being counted as missing:** consumables (potions, oils —
drinking is not a modelled event), objects with their own stat block (Mirror of Life Trapping,
Instant Fortress, Apparatus of the Crab, Iron Flask), and summon items (Horn of Valhalla, Deck of
Many Things). These are complete as prose.

## One article, two editions

A single content row is an **article**. When the same article exists in both editions — the same base
slug under `SRD 5.1` and `SRD 5.2.1` — the article view and the search results carry a 5e↔5.5e
toggle, and the loader's `articles` index groups them by that base slug. They remain two distinct
rows: `type:source:id` differs, `systems` differs, and neither is a translation of the other.

That toggle is **per-article and local**, unrelated to the global active system, which only sets the
browsing context.

## Locales are discovered, never listed

The loader pulls `name_<code>` / `text_<code>` columns off each CSV and derives the available content
locales from them, unioned with the UI catalogs. English is always present as the fallback.

The suffix must be a validated **BCP-47 code** (`es`, `uk`, `pt-BR`) matching
`^(name|text)_[a-z]{2,3}(-[A-Za-z0-9]+)*$`. A column that fails the grammar is flagged in
content-health and is **never** silently treated as a locale — otherwise `name_spanish`, `name_es`
and `name_es-ES` become three phantom languages. Enumerate once at load and cache.

All prose columns are localized, not just name and text: `material`, `higher_level`, and their
siblings. Read them as `d[base + '_' + locale] ?? d[base + '_en'] ?? d[base]` so a legacy bare column
still works.

## No manifests — describe yourself in-band

A set of things on disk is discovered by **scanning the folder**, and each thing describes **itself**,
in itself. Never add a sidecar that lists, indexes, or versions other files. For content that means
the `#content-*` header block inside each CSV.

A manifest is a second source of truth that starts drifting immediately: rename a file and you edit
two places, delete one and the index lies, hand-edit a row and the version is stale. It also taxes the
*author*, and the premise of this project is that a non-technical person owns their data as plain CSV.

Going in-band proved strictly better, not merely equal. A pack is a folder, so the listing **is** the
file list. Matching by the in-band `#content-id` GUID makes a rename a no-op where a path-keyed
manifest would produce a duplicate. A per-file `#content-hash` answers "did *this* file change",
which is finer-grained than a pack-level version and lines up with the hand-edit drift check.

**These are not manifests. Do not "clean them up":**

- **`plugins/<ns>/plugin.json`** — a plugin is code, not data, and its manifest carries the consent
  hash, which needs a stable non-executable subject (see `security.md`).
- **`collisions.json`** — a decision between several sources, as above.
- **Single-field markers** (`demo-seeded.json`, `content/.seed-version`) — they state one fact about
  the install; they index nothing.
- **`charnik.config.json`** — app configuration, including the `contentPacks` registry section. Each
  owner writes one top-level section through `storage/json-config.ts`. The dev-only pointer at a
  content clone is a separate gitignored file, `charnik.dev.json`.
- **`static/content/manifest.json`** (web build only) — HTTP has no directory listing, so
  `FetchStorage` cannot `list()` without one. It is generated by scanning at build time, gitignored,
  and never hand-authored, so it cannot drift. Desktop ignores it. It holds paths and nothing else;
  do not grow it into a description of the content.

## Hashes and re-stamping

Every shipped CSV carries `#content-hash: xxh64:…` as its first line, computed over the whole file —
header included, because `#content-source` is the identity half of `source:id` — minus its own line
and `#content-updated_at`. `stampWithHash` (`src/lib/content/hash.ts`) is the only supported writer.

The hash is not a health-panel cosmetic. It is also the **overwrite guard**
(`isProtectedFromOverwrite`): a file whose body no longer matches its stamp, or that carries no stamp
at all, is treated as the user's own, so desktop seeding and every pack update skip it **forever**.
A file that PASSES the guard is not thereby replaced blindly — the cells somebody translated are
carried across (▸ A translation survives the file being replaced).

So after any hand-edit, run **`pnpm restamp <file.csv>`**. It is a thin CLI over the app's own
`restampText` — the same function the in-app drift dialog calls, so a file stamped from the terminal
and one stamped from the UI come out byte-identical. It rewrites the hash and `updated_at`, fills in
`id` and `schema` if absent, and preserves BOM and line endings.

**The app re-stamps a file it did not create, and only because the user asked.** The neighbouring
rule — the app writes only files it owns — exists so a hand-edit is never silently clobbered; here
the user has confirmed, and only the stamp lines move. Without it a drifted file could not be fixed
from inside the app at all, in a project built for people who have no terminal. **"Don't ask again"
is content-editing mode** (`app.contentEditingMode`): it adopts a hand-edit instead of asking and
mutes both prompts, and it is reachable again in Settings ▸ Content health, because an answer must
not be a door that locks behind you. Auto-adoption skips a pack mid-swap — an apply re-checks disk
state before its rename, so a stamp landing then would cancel the user's update. The web build
detects both conditions and lists them in content health but does NOT prompt: a dialog whose only
button cannot work is worse than no dialog.

**A file declaring a schema this build has never heard of is a content-health warning, and its rows
still load** — flagged beats silently reinterpreted. `CONTENT_MIGRATIONS` (`content/migrations.ts`)
is the registry that makes the version mean something; the unit is a FILE, the version is declared
once in its header, and absent means current, so a hand-authored CSV is never asked to migrate.

`src/lib/content/content_stamps.test.ts` fails if any shipped CSV is unstamped or drifted.

## A new content TYPE is not a backwards-compatible change

Content ships from its own repo on its own schedule, so a content change lands on app builds that are
**already installed**. Adding rows, fixing values, adding a locale column: safe — an older build reads
what it understands. Adding a new content **type** (a new `CONTENT_TYPES` entry and a `<type>_*.csv`
beside the others): **not** safe. Every older build calls that file an unknown type and skips it,
with a warning the user did nothing to earn.

Two things follow, and both are easy to forget:

1. **Bump `CONTENT_SEED_VERSION`** whenever the shipped set of files changes. A new file is the
   easiest case to miss, because nothing about the existing files looks stale — and without the bump
   a desktop install seeded at the old version never receives it. The bump is no longer a thing to
   remember: `content_stamps.test.ts` pins the shipped set's signature beside the constant, so content
   that moved without it fails there. Paste the new signature in with the bump.
2. **Do not declare `#content-type:` on a file whose type is new.** Left to the filename, an older
   build reports a warning and skips one file; declared explicitly, the same build reports an error.
   Both skip it, so the quieter one is the kinder one.

The failure is silent in the direction that matters — the app is fine, the missing file only removes
something additive — so the message names the real cause ("content newer than the app") precisely
because a typo is no longer the likeliest explanation.

## Writing CSV back

The app writes **only files it created** (homebrew). It never rewrites a hand-edited user file.

**A rewrite keeps the file's own column order.** The header comes from the file when there is one and
from the schema only when the file is being created, so somebody who rearranged their own CSV gets it
back the way they left it — editing one row through the UI is not a reason to restyle their file.
Columns the rows have gained but the header lacks are appended rather than dropped.

Writes are **atomic** (temp then rename) and encoded **UTF-8 with BOM, CRLF line endings**, so Excel
opens Cyrillic correctly. Rows are serialized with `papaparse.unparse` from the same forms the user
fills in — nobody is ever required to open a file by hand.

The file watcher does **not** suppress the app's own writes, and does not need to: `reloadContent()`
only reads, so a homebrew save costs at worst one redundant re-read. The one callback that does write
back, `autoAdoptDrift`, terminates because a re-stamped file no longer drifts. A CSV edited directly
on disk is picked up in real time, and a manual refresh is the fallback. The WHOLE graph reloads —
about 90 ms for both shipped packs — because `articles`, `byEffectiveId`, locale discovery and
`resolveRefs` all span files; a per-file reparse was measured and is not worth building. The watcher
filters on `isPackFile`, the predicate that decides what a pack ships, so an editor's temp files cost
nothing.

Note the asymmetry with the content repo: a shipped pack's files are **LF and no BOM**. BOM and CRLF
are for CSVs the app writes into the user's data folder.

## Authoring from the UI

Every listed type authors through ONE editable-article form (`EditContentForm`): schema-driven fields
→ a validated row → the homebrew write above, into `content/homebrew/<type>_hb.csv`, merged into the
graph as an extra content root. A homebrew file is stamped with the `#content-*` header like any
other (default licence `Custom`), so the app's own files never trip the metadata or drift dialogs.

**A row whose content lives in a second table lists it.** A class, a subclass, a species and a
resource say almost nothing on their own row, so the article shows the rows joined to it and offers
to write one more with the join columns already filled (`LinkedRows`, over the pure
`linked-tables.ts`) — a foreign key is an id nobody can guess, which is why "switch type, click add,
type `subclass_id` by hand" does not count as authoring it. Four links: `class`→`class_feature` (only
the rows no subclass claims), `subclass`→`class_feature` (carrying the parent's `class_id`),
`species`→`species_option`, `resource`→`resource_option`. A fifth is a row in `LINKED_TABLES`. The
list is also how a linked row is REACHED to be edited or deleted.

**Editing a shipped row FORKS it to homebrew** — same id, `source=Homebrew` — and the shipped file is
never touched, so it survives the next pack update and keeps its attribution. The editor is the
current article beside the same form Add uses, so every widget and every validation is shared.
`upsertHomebrewRow` replaces the same-id row and keeps columns beyond the schema, so localized prose
survives an edit. **An override SORTS, it does not hide**: the homebrew row floats above the original
in every group (`homebrewFirst`) and both coexist, which is what source-namespaced identity promises;
choosing one is `collisions.json`.

**An unsaved form is a draft file**, restored when the form reopens for any reason. One
self-contained JSON per draft under `drafts/`, discovered by scanning — no index, by the rule above.
The file carries its own target (`type`, `source`, `id`, a locale for a translation, or a GUID for a
row that does not exist yet), so the filename is only a safe unique name. A draft is ephemeral, so on
a schema-version mismatch it is DISCARDED rather than migrated — and the user is told, because
losing work silently is the surprise. A draft whose target resolves to no row is an ORPHAN, and the
dialog for it offers reassign, keep-as-new and delete. **Reassign re-points and resumes; it writes
nothing** until the user saves, and where the chosen target already has a draft the user picks which
survives after opening either. Every draft, orphans included, is reachable from the Drafts pane. A
draft whose `sourceHash` no longer matches its row is kept and flagged. The web demo cannot save, so
it does not cache.

**A cell with a grammar is BUILT, not typed.** A spell's `upcast` has `UpcastBuilder` under the raw
field: pick what scales, how, and by how much, and the token it will write is shown before it is
added — seeing `damage:per_slot(1d6)` is what teaches the grammar the raw field still accepts. The
composed token is read back through the LOADER's own parser, so the form cannot offer what the app
would refuse. The raw field stays, because a `step()` ladder and a guard are wider than the builder.

**A translation's state is a column**, `loc_status_<locale>`, an open enum
(`not_started|machine|started|outdated|reviewed`) whose members drive the marker and the control —
add one and it appears. A PARTLY filled translation is a loader warning; a row with none is silent,
because the English fallback is the contract. `outdated` is the one member the app sets by itself
(below); a person clears it.

## A translation survives the file being replaced

A translation is saved INTO the pack file and the file is re-stamped, so the overwrite guard reads it
as untouched — correctly, since nobody hand-edited it. Three writers then replace a pack file whole:
a pack update, the bundled seed an app update runs at launch, and the bundled restore. All three go
through `keepLocalTranslations` (`content/translation-carry.ts`), which merges instead of replacing,
by row `id` (`content/locale-merge.ts`):

- **Structure and every source-owned cell come from the incoming file** — a damage die, the English
  text, a new row, a new column.
- **Every non-empty translation cell comes from the file being replaced**: `<prose base>_<locale>`
  for each locale that is not the file's own `#content-source_lang`, and `loc_status_<locale>`.
  **The local cell wins where both sides are filled.** That is the promise the translate view keeps —
  nothing a translator saved is replaced by a file that arrived later — and it holds for ONE author
  per locale per data folder. Two translators of one locale are reconciled where their work is taken
  into the pack, not here.
- **A translation whose source prose moved is marked `outdated`, never dropped.** The merge is the
  only moment both versions of the English are in hand; afterwards the old one is gone.
- **A file with no translation at stake is written as the bytes it arrived as**, so its git blob SHA
  stays the remote's and the pack diff has nothing to say about it.

It is a cell merge because a line merge cannot do it: one translation save re-serialises the file —
its line endings, and a new column on every row — so the two sides differ on every line while
agreeing on every cell but one. That is also why a translator's file is never copied over a pack's.

**A merged file names the upstream it was built from**: `#content-upstream: <git blob SHA>`, written
by the merge and by the first translation saved into a pack file as it shipped. It never has that
upstream's bytes again, and the pack diff compares a tree listing by blob SHA, so without the line
every check re-offers the update that was just applied — and each of those empty applies replaces
`<pack>.prev`, the one real rollback point. Homebrew has no upstream and carries no such line.

**The file being replaced is copied aside first**, into `content-backups/<when>/<pack>/<file>` in
the data folder, whenever a translation was at stake; ten runs are kept. The merge cannot keep a row
the incoming file dropped or re-ided, and a log line cannot hold what the text was — it carries ids,
never prose — so the copy is the only record of it. A file an update DELETES is copied the same way
(`setAsideRemovedTranslations`): it has no incoming side to merge into, so every translated row in
it is one the copy alone keeps, and restoring the copy brings the file back.

**The copies have a way back out** (`content/translation-backups.ts`): Settings ▸ packs lists the
runs under the pack whose files they hold, and putting one back goes through the apply's own swap,
so the pack it replaces becomes `<pack>.prev` and "undo this update" reverses it. It restores the
whole file as it was — the rules text of that day with the translations it held — because a row the
update dropped has no other file to live in. A restored copy is not spent, and a renamed pack takes
its copies to the new folder name.

**A translated row with nowhere to go is said to the user, by whichever writer drops it.** A pack
update runs the merge as a dry pass at its row-removal prompt (`translationsOrphanedBy`) and names
those rows before the click; the translated rows of a file it removes are named from the moment
the update is found, since that needs no downloaded byte. The seed and the restore have no click to stop at, so they leave the
count and the backup folder in `orphanedTranslations` and the layout says it once, in a toast that
stays until dismissed.

**Taking a translator's work into the pack is the same merge with the roles swapped**: the pack's
file is the incoming side, theirs is the local one. `pnpm import-translations` (`tooling.md`) does
that and writes the pack's own byte style, so the commit in the content repo shows the translated
cells — and, the first time a file gains a column (`higher_level_uk`, `loc_status_uk`), that empty
column on every other row of it.

## Where the shipped data comes from

Game data is converted from a real CC-BY source, never authored from memory. That conversion happens
in a producer sibling, not here; what this repository sees is the pack, which checks its own 38 files
against a manifest of row counts (`charnik-content-srd` ▸ `check.mjs`).

- **5.5e = SRD 5.2.1** — `downfallx/dnd-5e-srd-markdown`.
- **5e = SRD 5.1** — `Tabyltop/CC-SRD`.
- **Rejected: `BTMorton/dnd-5e-srd`** — OGL 1.0a, not CC-BY, and SRD 5.0.
- **Avoid open5e** — it mixes non-SRD OGL material.

Tag every row by the SRD it came from; never claim both editions unverified.

**What a pack is missing is typed by hand from the SRD, never parsed out of it.** A row, a table or
a token is written by reading the local source (`tools/srd-src/`) and typing what it says; the
content-repo commit quotes the sentence it stands on, and the app repo pins the result with a test.

**A source's typography is not evidence, and a name becomes an id.** Extracted text splits words
where the layout did — SRD 5.1 prints "See I nvisibility" and "Extra A ttack" — so whatever matches a
name against a source, or derives an id from one, repairs the spacing before it compares. The cost is
not cosmetic: `see_invisibility` re-derived as `see_i_nvisibility` is a different row, and every
character holding the old one points at nothing.

**Shipped translations are English only.** No CC-licensed Ukrainian SRD exists, so the localization
columns ship filled for `en` and empty elsewhere; other locales are community-filled through the
translate flow, which is why that flow has to be good rather than an export to a spreadsheet.

**Ship SRD-only data.** Do not commit non-SRD content — PHB-only material, Beholder, Artificer,
Aasimar. Users add that themselves as homebrew. Keep the CC-BY attribution with the shipped data;
every `source` carries its own `license` and `attribution` columns so SRD and community packs coexist
and the About screen can credit each correctly.

## The words a player puts over ours

A description can be rewritten in the player's own words, and it never touches the CSV. The rewrite is
an OVERRIDE keyed by `type:source:id` and by locale, read at display time through one accessor
(`describedProse` / `describedPlainProse`, `content/overrides.svelte.ts`); `localizedProse` stays the
pure content read underneath it, and deleting the override brings the shipped text straight back. A
pack update therefore cannot orphan a rewrite, and a rewrite cannot survive as a fork nobody knows is
there — which is exactly what separates this from the homebrew editor, where the row itself is copied.

**Two scopes, never both at once.** The open character's own words live in `ui.textOverrides` inside
`character.json`, so the character travels with them; promoted ones live in `overrides.json` in the
data dir and apply wherever no character is open. Promoting moves the row between the two.

**Whatever reads prose reads it through that accessor** — the article, the sheets, and the search
index the command palette is built from. A rewrite the palette cannot find is a rewrite thrown away.

**The control is ONE pencil, floated at the top-right of the prose it rewrites** (`OwnWords`), and the
editor it opens REPLACES that prose rather than standing under it — the same words in a box below the
words they replace is the same thing said twice. At rest the scope pills and the restore live inside
the editor, not standing under every article: a rewrite in force accents the pencil and names its
scope in the title, which is all the standing row ever said. The box opens at the height of the text
already in it (`growToFit`) and Escape leaves it. **Wherever an article is READ, the pencil is
there** — the compendium, the builder's pickers, the spellbook, and the Combat view's Features panel,
which is where a feature is actually looked up, mid-session. What `original` receives is the SHIPPED
prose, never the displayed one: the displayed one is already the override, and seeding the editor
from it would compare a value against itself when deciding whether a save is really a restore.

## Prose is not a data source

**Nothing in `src/` may read a value out of an article's prose.** Every number, die, damage type, or
category the app computes with comes from a declared column. `text`/`text_<locale>` is rendered,
clamped, searched, and translated — never mined.

The failure it prevents is the quiet kind. `text_en.match(/(\d+d\d+)/)` takes the first die in a
paragraph: correct for the row it was written against, wrong for the row where the same rule is
worded differently, and blank for every locale that translated the row away from the English the
regex knew. It is a guess wearing a number's clothes, and the trace cannot explain it because there
is no rule behind it.

A missing column stays missing. Show nothing, or show the prose itself, and let the author fill the
column in — that is a gap a user can see and close. `src/lib/content/prose-is-not-data.test.ts` fails
the build on the shape this mistake is usually written in; it is a tripwire on the cheap path, not a
proof, so the rule is the thing to hold, not the test.

**Whatever PRODUCES the pack is the exception, and it does not live here.** The SRD ships as prose, so
a producer has no other source: `resolution` and `save_ability` come from "… saving throw", a race's
ASI tokens from its Ability Score Increase paragraph. What makes that legitimate is where it lands —
a CSV column, in a diff, that a human reads before it ships. That review is the boundary; downstream
of it, the column is the only truth, and this repository only ever sees the downstream side.

There is **no live exception left in `src/`**. The last one was an item's `item_type`, which held a
category for mundane gear (`martial melee`) and a prose phrase for magic items (`weapon (any sword
that deals slashing damage)`) — three readers sniffed substrings out of it, so a magic weapon had no
properties, no damage dice and no fighting-style scopes. The `tags` column and `base_item_id`
replaced it; the phrase is now read once, upstream, into a column.

## The content repo

The shipped SRD content is a separate repository, `charnik-content-srd`, so rules data can be
corrected and released without an app build. `tools/content-repo.mjs` is the one seam that resolves
where it is; the vendoring step and the content tests both go through it.

**Committing here is ordinary work, under this repo's rules.** A data fix belongs in the content
repo the same way a code fix belongs in this one: commit at a verified checkpoint, straight to
`main`, no feature branch. `git push` is the one action needing explicit permission in the current
turn, in either repo. The content-specific traps are the whole difference: rows come from a real
CC-BY source, never from memory; a hand-edit is followed by `pnpm restamp <file>`; and a change to
shipped rows lands together with an assert in the APP repo pinning the count or the value, so a later
regeneration that drops it fails loudly instead of silently reverting.

**A pack repo must carry `.gitattributes` with `* -text`.** The updater answers "did this file
change?" from the git blob SHA in a tree listing, without downloading anything, and that only holds
while the blob bytes are the disk bytes. Under `core.autocrlf` a Windows checkout rewrites every LF
to CRLF and the vendored copy can never match the blob — every file reports as changed forever,
against a repo where nothing moved. If seeded content ever looks "all changed" against an unchanged
repo, hexdump the bytes before touching the diff logic: `git hash-object` normalises on input and
will lie to you here.

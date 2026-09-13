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

`weight_lb` is blank on most items — a hole, because the converter never extracted it, and somebody
should. `str_min` is blank on a dagger because daggers have no Strength requirement. The first is a
column with a bug; the second was never column-shaped.

- **Fold alternatives, never companions.** A tag cell stays short only because the folded facts are
  mutually exclusive by kind — a weapon never carries armour tags. Folding facts that CO-OCCUR
  (`cost`, `weight_lb`, `rarity` all apply to one row) grows every cell without bound, which is
  what "everything in tags" fails at.
- **A compound field stays a column even where it would fit.** `damage` is `1d6 slashing; 1d4
  radiant` — its own internal structure, carrying the separators a tag list uses. Same class as
  `effects`. A fact that has grown a grammar is not a tag, however sparse it is.
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

A magic item points at the mundane row it is built from with **`base_item_id`**: the base's tags go
underneath, the item's own win by name, resolved in one place (`content/resolved-item.ts ▸
resolveItem`).

A **template** row names no base because the SRD does not: "Weapon (Any Melee Weapon)" is answered by
whoever finds the thing, so the base lives on the player's inventory entry and merges through the same
function. A row is a template when it carries no category-defining tag — no `simple`/`martial` for a
weapon, no `armor:<weight>`/`ac` for armour (`needsBaseItem`). Do not test this by an EMPTY tag list:
every shipped template carries `attunement`, and a net carries tags while doing no damage.

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

So after any hand-edit, run **`pnpm restamp <file.csv>`**. It is a thin CLI over the app's own
`restampText` — the same function the in-app drift dialog calls, so a file stamped from the terminal
and one stamped from the UI come out byte-identical. It rewrites the hash and `updated_at`, fills in
`id` and `schema` if absent, and preserves BOM and line endings.

**Never re-run a converter just to re-stamp.** The row regeneration in `convert.mjs` drops
`conditions_srd.csv`'s `max_level` column. Converters are for real content changes; if one touches a
file you did not mean to change, `git checkout` it. A converter stamps its own output.

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
on disk is picked up in real time; only the changed file is reparsed, and a manual refresh is the
fallback.

Note the asymmetry with the content repo: the converters write **LF and no BOM** on purpose
(`tools/srd/lib.mjs`). BOM and CRLF are for CSVs the app writes into the user's data folder.

## Where the shipped data comes from

Game data is converted from a real CC-BY source, never authored from memory. The converters live in
`tools/srd/` and each asserts its row count against the source.

- **5.5e = SRD 5.2.1** — `downfallx/dnd-5e-srd-markdown`.
- **5e = SRD 5.1** — `Tabyltop/CC-SRD`.
- **Rejected: `BTMorton/dnd-5e-srd`** — OGL 1.0a, not CC-BY, and SRD 5.0.
- **Avoid open5e** — it mixes non-SRD OGL material.

Tag every row by the SRD it came from; never claim both editions unverified.

**Shipped translations are English only.** No CC-licensed Ukrainian SRD exists, so the localization
columns ship filled for `en` and empty elsewhere; other locales are community-filled through the
translate flow, which is why that flow has to be good rather than an export to a spreadsheet.

**Ship SRD-only data.** Do not commit non-SRD content — PHB-only material, Beholder, Artificer,
Aasimar. Users add that themselves as homebrew. Keep the CC-BY attribution with the shipped data;
every `source` carries its own `license` and `attribution` columns so SRD and community packs coexist
and the About screen can credit each correctly.

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

**The converters in `tools/srd/` are the exception, and the only one.** The SRD ships as prose, so
they have no other source: `resolution` and `save_ability` come from "… saving throw", a race's ASI
tokens from its Ability Score Increase paragraph. What makes that legitimate is where it lands —
a CSV column, in a diff, that a human reads before it ships. That review is the boundary; downstream
of it, the column is the only truth.

There is **no live exception left in `src/`**. The last one was an item's `item_type`, which held a
category for mundane gear (`martial melee`) and a prose phrase for magic items (`weapon (any sword
that deals slashing damage)`) — three readers sniffed substrings out of it, so a magic weapon had no
properties, no damage dice and no fighting-style scopes. ITEM-TAGS replaced it with the `tags` column
and `base_item_id` (`docs/plan.md`); the phrase is now read once, in the converter, into a column.

## The content repo

The shipped SRD content is a separate repository, `charnik-content-srd`, so rules data can be
corrected and released without an app build. `tools/content-repo.mjs` is the one seam that resolves
where it is; the vendoring step, the converters, and the content tests all go through it.

**Committing here is ordinary work, under this repo's rules.** A data fix belongs in the content
repo the same way a code fix belongs in this one: commit at a verified checkpoint, straight to
`main`, no feature branch. `git push` is the one action needing explicit permission in the current
turn, in either repo. The content-specific traps are the whole difference: rows come from a real
CC-BY source through `tools/srd/`, never from memory; a hand-edit is followed by `pnpm restamp
<file>`, never by a converter re-run; and a change to shipped rows lands together with an assert in
the APP repo pinning the count or the value, so a later converter run that drops it fails loudly
instead of silently reverting.

**A pack repo must carry `.gitattributes` with `* -text`.** The updater answers "did this file
change?" from the git blob SHA in a tree listing, without downloading anything, and that only holds
while the blob bytes are the disk bytes. Under `core.autocrlf` a Windows checkout rewrites every LF
to CRLF and the vendored copy can never match the blob — every file reports as changed forever,
against a repo where nothing moved. If seeded content ever looks "all changed" against an unchanged
repo, hexdump the bytes before touching the diff logic: `git hash-object` normalises on input and
will lie to you here.

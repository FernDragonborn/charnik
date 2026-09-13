# Characters

> For maintainers. How a saved character is stored, why it is split in three, and what survives a
> rest, a migration, and a missing content pack.

## JSON, not CSV

A character lives at `characters/<slug>/character.json`. A photo is a **sibling file** referenced by
name, never base64 inside the JSON — `photo.<ext>`, one per character, written through `Storage`
alongside the save. It is **downscaled when it is picked** (longest edge 512px, `character/photo.ts`)
and re-encoded, so the extension always matches the bytes and a 12 MB phone photo never lands in a
folder the user is told they own. A build in progress has no folder yet, so the bytes wait in the
build view-model and are written at the first save; picking a second portrait replaces the first,
including one stored under another extension, and removing one deletes the file rather than only the
reference. An optional append-only `log.jsonl` sits beside it, deliberately
**out** of `character.json` so a long campaign cannot bloat the save.

There is no database. Writes are atomic — temp file, then rename — with a debounced autosave and
**rotating backups**: two rings beside the save, `character.bak.save.*` (2 deep, throttled to one
checkpoint per 10 minutes) and `character.bak.launch.*` (3 deep, one per app run), keyed by the
snapshot's epoch-ms in the filename so pruning needs no mtime. **Settings ▸ Data ▸ Snapshots is the
reader**: it lists both rings per character, newest first, and puts one back through the same
parse → migrate → validate the live save gets — so a corrupt snapshot is refused with its reason
rather than written over a working character. Restoring is itself a save, so the state it replaced is
checkpointed on the way out as far as the `save` ring's throttle allows — what makes a wrong restore
recoverable is the other snapshots, not that one.

## The unfinished one is a different kind of file

A build in progress autosaves to `character-drafts/<guid>.json` — debounced by the build page, driven
by `DraftSession` (`routes/build/draft-session.svelte.ts`) over `character/draft-repository.ts`. It is
keyed by a GUID because a draft has no name to be keyed by and may never get one, and it holds the
whole `DraftState` plus the class-picks cache, so resuming restores the choices a player had, not a
reconstruction of them.

**Nothing here validates.** A draft is the user's unfinished work, not data anything computes from, so
an unreadable file is dropped from the roster rather than repaired into something they did not build —
the opposite of `character.json`, which is migrated forward. Two things are never written: a draft
holding no decision yet (opening the builder must not litter the data folder), and any edit of an
existing character, whose own save is already the record. Creating the character deletes the draft.

## Three parts, and the split is load-bearing

`src/lib/character/schema.ts` divides a character into `build`, `play`, and `ui`.

**`build` is who the character is** — chosen at creation and level-up, and untouched by anything that
happens at the table: name, species and its sub-option, background, classes with their levels, the
six ability scores, skills, expertise, feats.

**`play` is what is true right now** — current and temporary HP, hit dice spent, spell slots spent,
resource uses spent, active effects and conditions, what they are concentrating on, and the coins in
their purse. Money is play-state and not an inventory row: a stack of arrows answers "how many do I
carry", a purse answers "what can I afford", and the only thing the two share is weight — which a
character counts only if their table does (`ui.coinWeight`, off by default).

**`ui` is neither** — which panels are shown, in what order, and the per-character build mode. It
survives a reset of play, because resetting the game should not destroy a layout someone arranged.

The split is what makes rests safe. **A long rest only ever edits `play`**, so it has no way to reach
the build; resetting play returns a character to "full HP, nothing spent" without needing to know
anything about their classes. In one flat object, every rest would have to know precisely what not to
touch, and one mistake would erase the build.

It also gives derived values a home for their overrides. `play.hp.max` is optional: absent means
derived from the build (class, hit die, Constitution), and a number appears only when a player sets
one by hand. That distinguishes "computed" from "overridden" without a second flag.

## Versioning and migration

Every save carries a **`schemaVersion`**, and old saves are migrated forward. **Before release
there are no users and therefore no migrations**: the schema may change breaking, and the machinery
exists for afterwards.

The default save holds **id references only**. A **bundle export** additionally embeds the content
rows it references, so a character survives being sent to someone who does not have the packs.

When referenced content is missing, render everything that is still possible and **flag what is
not** — never fail the whole sheet over one absent row.

## Play-state modelling

A play-state column expressing a policy or a kind is an **open enum**, never a boolean. Game rules
grow a third case: resource `recharge` looked binary (`short` / `long`) until 2024's Second Wind
turned out to be "regain one use on a short rest, all on a long rest" — a third policy. Because
`Recharge` was already an enum, that was one member (`short_one`) and one branch in `rest()`, not a
new `partialRecharge` boolean and an exploding combination of flags. The sequel proves the same
point twice: a wand regaining `1d6+1` charges at dawn showed that the enum was two facts in a
trenchcoat, and it became `{trigger, amount}` with every word kept as sugar
(`docs/internals/effects.md` ▸ How a pool comes back) — nothing on disk moved.

The partial maps (`abilityBoosts`, `spellSlotsSpent`, `hitDiceSpent`, `resourcesSpent`,
`panelColumns`) deliberately stay `z.record(z.string())` under `noUncheckedIndexedAccess`, so a read
is `V | undefined`. That is the **honest** type. Branding the key to a finite union would make the
type claim a value is defined when the runtime slot is absent, for a near-zero gain and a migration.
This is a carve-out, not debt to fix later.

**Concentration is a REF, not a clock.** `play.concentration` names a spell, and its timer lives on
an ordinary carrier effect in `play.effects` — so editing that effect's `durationRounds` IS editing
the concentration, and expiry, display and removal are the paths that already exist. A concentration
spell always gets a carrier even when it has no tokens, which is what gives Hold Person and Web a
timer at all. Giving concentration its own clock needs a display proxy and a second expiry path.

## A tracker surfaces, it never decides

When a feature triggers on a game event, the app **highlights** the option, reminds the player, and
pre-fills a smart default — and the **player clicks** to resolve it. It never silently mutates
play-state on their behalf.

Most RAW features are "you *may*", so auto-applying them steals a choice. The tracker also does not
hold full game state — what counts as one *instance* of damage, whether you "attacked an enemy" this
turn — so it cannot decide correctly even when it wants to. And forcing breaks on corrections: a
concentration prompt on every Damage press fires again when someone enters 72, then 71, then +1 to
fix it.

In practice: a conditional ability is always listed and greyed when unavailable, never hidden, so its
existence is never news. Highlighting it the moment its window opens is the other half and is not
built (`plan.md` ▸ RECHARGE-TAIL). A mandatory save — concentration on damage — is an on-demand
button beside its indicator, like the death-save button at 0 HP, carrying a suggested but editable
DC. Prefer *event → reminder* over an auto-mutating event bus.

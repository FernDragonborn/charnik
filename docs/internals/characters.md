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

## One writer per character

Every save of a character takes its turn on **one queue per character** (`repository.ts` ▸
`enqueue`), and so does every append to its roll log: both files are rewritten whole by callers that
fire and forget, so two overlapping writes would each start from the same "before". A save is
validated when its turn comes, not when it was asked for, so the write that lands last is the state
as it is last.

The file states a **`rev`**, one higher on every write, and the copy that was saved is told which
one it now is. That is what tells a copy of an older file from the current one: a play-loop save
whose `rev` is not the file's is **refused**, and nothing is written.

**The builder writes `build` and nothing else** — its build, plus the two authoring choices it folds
into `ui` (`strict`, `shortRestMode`), merged over the file as it is at the moment of the save. A
level-up in the middle of a session is the normal case, and the builder's own copy holds the `play`
it opened with; written whole, it would put back hit points the table has since spent.

**A file the app did not write is never written over without being asked about.** The repository
remembers the text of each file as it was last adopted for editing or written, and a save that finds
other bytes there is refused, as is one whose `rev` does not match. The bytes are compared rather
than an mtime: a hand edit keeps the `rev`, a sync tool touches a date without changing a byte, and
`Storage` reports a date only through a directory listing. On desktop `characters/` is watched the
way `content/` is, so the question is raised when the file changes rather than at the next save.

The question is a dialog a click on the backdrop does not close, with three answers
(`store.svelte.ts` ▸ `resolveConflict`): the state on screen wins, the file's does, or both are kept
— the screen's saved as a new character, which is the one left open. Whichever is taken goes **into
the object the views already hold** (`putIntoActive`), and so does a restored snapshot: a view takes
the open character once, on mount, so a replaced object would leave it saving the superseded one.

**It is not a lock.** Holding the file open would stop a sync tool, a backup and the player's own
editor from reading a file the product says is theirs, and the atomic temp → rename write replaces
the file rather than writing into it.

Three writes are never refused, because each IS the player choosing a state over the file's: a
snapshot restore, "Restore demo", and the dialog's own "keep mine" (`SAVE_MODE.overwrite`). A save
puts its own line into the roster rather than re-reading every character.

## Identities

A character has **three names for three jobs**. `id` is the folder: a slug of the name plus four hex
digits, re-anchored to whichever folder a restore lands in. `rev` counts writes. **`uid` is who the
character IS** — a random UUID v4 minted once and stored in the file, never derived from the name
and never used as a path, so it is the one that survives a rename, a restore and leaving the
machine. A restored snapshot keeps the live file's `uid`; "save mine as a copy" mints a new one,
because that is a second character.

**A row has one too**, for the reason an effect has `iid`: a message or an undo has to name "that
potion", and a position in an array names whatever sits there by the time it arrives. An inventory
row carries `iid`; a class row carries `rowId`, the name it already had as the prefix of its slot
keys (`build.slotPicks`, `<rowId>:<level>`). Rows are made in one place each (`schema.ts` ▸
`inventoryRow`, `classRow`), a row missing its id is given one when the file is read, and two rows
sharing one are told apart on read, the first keeping its own.

**One suit of armour and one shield are worn at a time** (`character/inventory.ts` ▸ `WORN_SLOT`):
putting on a second takes the first off, in the builder and in play alike, because the Armor Class
counts one of each and a second shield's magic bonus would otherwise still reach it.

**An inventory row is spoken of by its `iid` in every action** — equip, attune, count, use, drop,
reorder, and the three answers a row can be asked for (`$lib/play/inventory`). Two rows may hold
the same item: a file edited by hand, or two rings that resist different things. Only a picker
speaks of the ITEM, because "do you carry this" is a question about every row at once
(`ownItem`, `disownItem`). An attack is named for its weapon, so the same weapon on two rows gives
two attacks of one id: the list keys them apart (`combat/row-order.ts` ▸ `uniqueRowKeys`), since
a keyed list handed one key twice does not draw a row short — in a production build as in
development it throws, and the panel is gone.

All of them are random rather than time-ordered: the array holds the order, and an id that sorts by
time would tell every peer when the character was made.

**Nothing tells two folders with one `uid` apart.** A character folder copied by hand is two
characters claiming one identity, and which of them is the copy is not something the files say.

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

## The demo character

**Karroth the Red** (id `karroth`) — Tiefling · Soldier · Warlock 5 (Fiend) × Barbarian 3
(Berserker), SRD-only — seeds first-run on web AND desktop, so it is the first impression of the
system's scope: keep it deriving clean against the shipped 5.2.1 graph. `recreateDemoCharacter()`
restores it, and Settings ▸ Data has the button.

**What the pairing does NOT exercise**, so nobody assumes the demo covers it: `casterLevel` is 0 for
the barbarian half, so pact-pool-beside-shared-slot math is never hit; and none of its five spells
carries the Ritual tag, so the `R` badge does not appear on it — demo a ritual by adding a real
shipped SRD one, never a hand-authored one.

## Three parts, and the split is load-bearing

`src/lib/character/schema.ts` divides a character into `build`, `play`, and `ui`.

**`build` is who the character is** — chosen at creation and level-up, and untouched by anything that
happens at the table: name, species and its sub-option, background, classes with their levels, the
six ability scores, skills, expertise, tools, feats — and the ANSWERS a feat asked back, which are build data
of their own rather than refs: the ability a half-feat raised, the skills a Skilled-shaped one granted,
and the spell list plus casting ability a Magic-Initiate-shaped one draws on (`build.featSpells`, one
entry per instance, because it is repeatable and each instance is its own caster profile). The SPECIES
asks back too, and its answers are their own fields for the same reason: `build.speciesSkills` holds
what a species-granted skill choice was spent on, kept apart from `skills` so no cap counts another's
picks, and the feat a species grants by choice sits in `slotPicks` under the reserved `species` key —
the same maps a level's slot uses, because what a feat asks does not depend on how it arrived.
`build.masteries` is the same kind of answer from the CLASS: the weapon kinds a 2024 character has
drilled, as bare weapon ids, because a weapon's shipped mastery property does nothing until one of
these says it may be used.

**`play` is what is true right now** — current and temporary HP, hit dice spent, spell slots spent,
resource uses spent, active effects and conditions, what they are concentrating on, and the coins in
their purse. Money is play-state and not an inventory row: a stack of arrows answers "how many do I
carry", a purse answers "what can I afford", and the only thing the two share is weight — which a
character counts only if their table does (`ui.coinWeight`, off by default).

**Experience points are play-state too**, for the purse's reason: they are earned at the table,
session by session. `play.xp` is counted only where the character tracks it (`ui.levelingMode`,
`milestone` by default), against the pack's `advancement` rows for the character's own edition
(`rules/advancement.ts`). Reaching a threshold marks the level as earned on the sheet and never
takes it — a tracker surfaces, and a level-up is the builder's.

**`ui` is neither** — which panels are shown, in what order, the per-character build mode, and the
descriptions this character reads in the player's own words (`textOverrides`, one of the two scopes in
[content.md](content.md) ▸ The words a player puts over ours). It survives a reset of play, because
resetting the game should not destroy a layout someone arranged, nor prose they wrote.

**How a character's sheet LOOKS is `ui` too, however small**: the motion its hit-point block plays at
0 hit points is `ui.downMotion`, an open enum read through `downMotionOf` so a save naming a motion
this build does not draw still loads. What may overrule it is the app's own Reduce motion
([ui.md](ui.md) ▸ Reduce motion is one switch), which stands over the choice without writing to it.

**What a player chose to see is `ui`, and all of it is stored the same way**: an array of ids or refs
per panel — `spellsHidden` / `spellsPinned`, `actionsHidden`, `featuresHidden` / `featuresPinned`,
`panelsCollapsed` — plus `rowOrder`, keyed by panel, for the lists that are derived and so have no
array of their own (`combat/row-order.ts`). One shape, because these are one question asked of
several panels; a panel that kept its answer in view-model state instead would forget it on the next
launch, which is exactly what `actionsHidden` and then `panelsCollapsed` each did before they moved
here. `panelsCollapsed` is the one that also holds the two sheet SECTIONS (`abilities`, `combat`),
so it is never reconciled against the panel list the way `panelColumns` is.

**A FILTER writes those arrays rather than layering over them** (the Features panel's presets, the
Actions panel's — `combat/actions.ts ▸ ACTION_PRESET`, sets grouped by how a character fights and
never a rule — and whatever grows one next). So there is one answer to "is this shown", a preset's effect reads back in
the same controls a player toggles by hand, and undoing it is the same click either way. A pin is
exempt from a filter: pinning is the player saying "always this one", and two controls that overrule
each other leave nobody able to say which won. A row a character starts WITHOUT (`ACTION_DEFAULT.hidden` —
the Actions panel's Cry) is the reverse list, `actionsShown`: what the player opened, so a save
written before the row existed never shows it, and no preset reaches it.

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

The partial maps (`abilityBoosts`, `spellSlotsSpent`, `spellSlotsGained`, `hitDiceSpent`,
`resourcesSpent`, `panelColumns`) deliberately stay `z.record(z.string())` under `noUncheckedIndexedAccess`, so a read
is `V | undefined`. That is the **honest** type. Branding the key to a finite union would make the
type claim a value is defined when the runtime slot is absent, for a near-zero gain and a migration.
This is a carve-out, not debt to fix later.

**A map indexed by an id CONTENT names is read through `countAt`** (`util/records.ts`), which asks
whether the key is the map's own. A plain object answers for every name its prototype has, and
`constructor` is a valid content id: read bare, a pool of that name had `Object`'s constructor
spent from it and showed `NaN` uses left. Only `resourcesSpent` is indexed this way — the other
maps are keyed by a closed set, an ability or a slot level.

**Death is one typed fact, `play.death: {cause}`** — an open cause enum rather than a `dead` boolean —
and every lethal rule lands on ONE `die(cause)` seam. Two readings live at that seam: instant death
runs the SRD 5.1 text in BOTH editions, because 5.2.1 omits the chapter carrying it, and a revive
drops one exhaustion level in 2014 too, where RAW is silent, since reviving onto a lethal sixth level
would kill the character again on the spot. The level is one below what the character DIED
with, which `play.death` keeps beside the cause: a level a player already took off by hand while
the character lay dead is that same level, and counting from whatever stands there now took two
for one death. Death takes the hit-point block and
nothing else: the block goes black under `Dead`, with the cause and `I was revived` as the way back,
and the rest of the sheet — the roll log, the effects, the navigation — stays in reach. The save
that ENDED the dying, a third success or the third failure, can be taken back from that face
(`takeBackLastSave`): a track is pressed by hand as well as rolled, and without it a mis-pressed
skull costs a revival, which is a level of exhaustion and a hit point nobody earned.

**What a level-up slot granted is stored per SLOT, not only flattened.** With only the flattened
`abilityBoosts`/`feats` saved, a restored slot re-derived its boost a second time. The same root
decides a re-pick: the reconciliation subtracts what the SAVE's own picks granted
(`EditContext.loaded`), never what the live ones grant — measured against the live picks, moving a
saved ability improvement left the old one with nothing to cancel against.

**Concentration is a REF, not a clock.** `play.concentration` names a spell, and its timer lives on
an ordinary carrier effect in `play.effects` — so editing that effect's `durationRounds` IS editing
the concentration, and expiry, display and removal are the paths that already exist. A concentration
spell always gets a carrier even when it has no tokens, which is what gives Hold Person and Web a
timer at all. Giving concentration its own clock needs a display proxy and a second expiry path.

**A form is a REF too, for the same reason.** `play.form` names a stat block and the form whose
rules granted it; the numbers and the clock live on a carrier effect in `play.effects` whose `source`
is that same monster ref. So a form shows in the Effects panel with its timer, passing time expires
it and its ✕ ends it on the paths that already exist, and `settlePlay` (`$lib/play/settle`) finishes
the leaving for all of them. `hpBefore` is present exactly when the form has hit points of its own (2014 Wild
Shape): the character's own current HP, waiting, while `hp.current` counts the form's — which is
why damage, healing and the bar need no second pool. Damage the form cannot hold ends it and lands
on the character, RAW's own example. The forms a character KNOWS are `build.forms`, by form id.

**A runtime effect's `source` decides where its tokens are read from, by the row's TYPE.** An entry
added from the state catalog (an `effect` row) is read LIVE, so a fix to the catalog reaches effects
already on a character. A cast's carrier also names its spell as the `source`, but its tokens are
what the CAST baked — an upcast's extra `hp_max`, the weapon Magic Weapon touched — none of which is
in the spell row, so a carrier is always read from its own `effects`. A form's carrier names a
`monster` row, and that row IS all the form does, so it is read live like a catalog entry.

## A tracker surfaces, it never decides

When a feature triggers on a game event, the app **highlights** the option, reminds the player, and
pre-fills a smart default — and the **player clicks** to resolve it. It never silently mutates
play-state on their behalf.

Most RAW features are "you *may*", so auto-applying them steals a choice. The tracker also does not
hold full game state — what counts as one *instance* of damage, whether you "attacked an enemy" this
turn — so it cannot decide correctly even when it wants to. And forcing breaks on corrections: a
concentration prompt on every Damage press fires again when someone enters 72, then 71, then +1 to
fix it.

Two play-sheet switches are this rule and nothing else. **Ammunition is counted only if the table
counts it** (`ui.trackAmmunition`, off by default): a shot spends one from the stack it fires, and
only once the turn has paid for it. 5.5e matches the weapon's `ammo:<kind>` to the stack's; SRD 5.1
never says which ammunition a weapon fires, so there any stack qualifies and several ask which. Out
of stock says so and rolls anyway. An action that makes attacks (`attack:<weapon>:<n>`) fires through
the same path, one from the stack per strike. **A granted roll's "used this turn" mark sets itself
only where the row says the roll is once per turn** (`grant_roll:…:turn`, Sneak Attack), at the
moment the roll lands — a tray put away unrolled used nothing. For every other granted roll the mark
is the player's, and it is theirs to lift either way (`play.turn.usedRolls`, cleared by Next turn):
a marked roll still rolls, because "once per turn" is not "once per round" and the app sees only the
character's own turn.

In practice: a conditional ability is always listed and greyed when unavailable, never hidden, so its
existence is never news — and the moment its window opens the sheet says so, in a notice naming it.
A mandatory save — concentration on damage — is an on-demand
button beside its indicator, like the death-save button at 0 HP, carrying a suggested but editable
DC. Prefer *event → reminder* over an auto-mutating event bus.

**What the player presses is the ROLL; what follows it is not a choice.** A failed concentration save
ends the spell — RAW leaves nothing to decide — so the save applies its own result, the way the
death-save track already does. Offering a "Drop" button afterwards asked the player to confirm
arithmetic the app had just shown them. The line this draws: the tracker never decides whether to
fire a rule and never picks between two readings, but once the player has fired one, it applies what
that rule states.

**The concentration chip rolls; its ✕ ends the spell.** Pressing the chip is a save — against the
oldest owed DC after damage, which the chip wears, against the RAW floor of 10 otherwise, which is the check a table calls for
when the app never saw the trigger. Ending concentration deliberately is a separate control that
drops out of the chip on hover or focus, so the common act is one press and the rare, irreversible
one is a step further: the chip's own press used to end the spell outright, which made every stray
click a lost spell. **Ending it by hand says so**, because all that happens on screen is a chip
disappearing and the press one step above it is a save — a spell dropped on purpose and a spell lost
to a bad roll must not look alike. Every other way it ends stays silent: 0 HP, an incapacitating
state, a replacing cast and a rest are all consequences of something the player just watched happen.

**A Damage press is one hit of one type.** It meets its own defense, and temp HP, the concentration
save and instant death are then asked of what is left. A hit of two types — a flame tongue's slashing
and its fire — is two presses: composing it in one press put a second amount, a second type and an
add control on the damage line of every character to serve the few hits that need them. The press
leaves a line in the roll log saying what it was (`combat.log.damageTaken*`: a key and its values,
the type after a separator rather than inside the phrase), which is the only record of what the
damage WAS — the hit points say what was left. A Heal press leaves the same kind of line
(`combat.log.hitPointsRestored`), for what came BACK rather than what was entered: healing past the
maximum is lost, and a press that restored nothing records nothing. Healing reads a number of its
own, never the hit's: one field that means damage on one press and healing on the next is how a
slip heals back what was just taken.

**The concentration saves hits leave owed are a QUEUE, and the player may merge it.** RAW owes one
save per hit, at the DC that hit's damage sets, and the app cannot tell two blows from one hit
entered as two presses. So each press owes its own, oldest first on the concentration chip, and one
control says "that was one hit": the queue becomes one save at the DC of the damage it sums to,
which is why an owed save keeps its `damage` beside its `dc`. The queue is the screen's, not
play-state — it does not survive a reload — and a save is dropped when the concentration it names
ends or is replaced.

**Stable is the death-save track itself.** Three successes with no failures at 0 hit points IS the
record: RAW resets "the number of both" on becoming stable, and what is kept is the three successes
that say so. `isStable` (`$lib/play/hit-points`) reads it, so there is no second field to disagree
with the track. A stable character rolls no death save; any damage — a hit, or a failure pressed by
hand — clears the successes and starts the dying again; any hit point regained clears the track.

**A critical on a body at 0 hit points is two failures, and the second is pressed by hand.** The
Damage press has no attack behind it to read a critical from, so the rule it applies is the plain
one, and the track's own skulls are how the player says the hit cost two.

**Several saves for one lump of equal projectiles is deliberately not built.** Magic Missile's darts
each raise their own save in 2014; the way to say that is to press Damage once per dart, which is the
same path different SOURCES already take. A segmented "how many saves" control would stand on the
damage line of every character in both editions to serve one spell in one of them, and 2024 dropped
the sentence it serves. A rejected shape, not a missing one.

# The table link

> For maintainers. How a GM's app and the players' apps sit at one table: who is trusted, what
> crosses between them, and where each thing is refused. The threat catalog this answers is
> [`research/table-link-threats.md`](../research/table-link-threats.md); the review of what the
> existing code does with a network input is
> [`research/table-link-design-review.md`](../research/table-link-design-review.md).

## What a table is

A GM opens a table and hands out an invitation. A player pastes it, the GM lets them in, and from
then on the GM's app shows that player's sheet live and can ask four things of it: take this
damage, be healed, take this state, make this roll. Nothing the GM asks applies itself — it
arrives, the player sees it and answers.

**A table lives for one session.** Its keys are made when it opens, held in memory and written
nowhere; closing the app ends it. A GM who plays again next week opens a new table and lets each
player in again. There is nothing to remember, list, forget or leak between sessions.

**It is desktop to desktop.** The web demo has no table (`table-link/noop.ts`), and a desktop
build has one only with the `table-link` Cargo feature, which is OFF in a release
(`overview.md` ▸ TableLink is the seam a table stands on).

## Who is trusted

Charnik is free software, so any peer may run a build that sends whatever the wire allows.
**Every peer is taken to be a modified build**, and each side trusts the other with exactly this:

- **The GM is trusted to see the table's view of a sheet** — what a player would say aloud across
  a table (`table-link/wire-schema.ts` ▸ `tableViewSchema`): name, level, hit points, death saves,
  conditions and effect labels, AC, initiative, speed, abilities, saves, skills, passives, and what
  the character resists. No notes, no inventory, no build, no portrait, no character file.
- **The GM is trusted to ASK.** A request is a closed shape of catalog ids and bounded numbers,
  never an effect token or a dice formula, and the player's app shows it and waits for a click.
- **A player is trusted to say what their sheet says.** The player's app derives its own sheet and
  sends the result with its traces; the GM's app renders it and derives nothing from a peer's
  tokens. A player who edits their numbers shows the GM edited numbers — as at a table of paper
  sheets, and as in every other tool (design review ▸ 14).
- **Nobody is trusted with the other's machine.** No peer's bytes become a file, a path, markup,
  or a formula on the other side.

## Going online is a native question, asked each time

No socket exists until a person says so in a dialog the page cannot draw over or press
(`src-tauri/src/table_link/mod.rs`):

| the question | who is asked | what it names |
| --- | --- | --- |
| open this table? | the GM, on `host` | the table's name and the relay it is reached through |
| join this table? | the player, on `join` | the table's name, the name they join under, the relay |
| let this player in? | the GM, per new key | the player's name and their six-digit code |

The words are the UI catalogs' own, compiled into the binary by `build.rs` (`NATIVE_ROOTS`): the
page names a locale and never a sentence. What the page or a peer does supply — a name — is
printed as quoted data with control and reordering characters removed and cut to forty characters
(`wire::plain_text`). So there is no "table link enabled" setting to forge: script in the page can
ask for a table, and the answer is the person's.

**The code** is six digits taken from the key a player's app holds at this table. The player's
screen shows it while they wait; the GM's dialog shows the same digits and says to let the player
in only if they match what the player reads out. It catches the wrong person arriving under the
right name. It is not a secret, and twenty bits do not stop someone who can try keys until one
fits — what stops them is that an invitation gets a stranger no further than this question.

## The transport

[iroh](https://iroh.computer) 1.x: QUIC connections dialled by public key, encrypted end to end,
set up through a relay server and moved to a direct path when the two networks allow it
(`src-tauri/src/table_link/session.rs`).

- **A star.** Every player holds one connection, to the GM, and none to another player. iroh
  authenticates the key at the other end and decides nothing about who may sit; that is `admit`.
- **A key per table.** Each endpoint is bound under a key generated for that table. Nothing links
  a person at one table to the same person at another, and a key that is online says nothing
  about anyone outside that table.
- **An endpoint dials one key or none.** A player's endpoint may dial the GM of its invitation; a
  GM's dials nobody. Anything else is refused before a packet leaves (`DialPolicy`, iroh's
  `before_connect` hook).
- **Nothing is published.** No address lookup is configured — no DNS record, no DHT — so an
  endpoint is found by its invitation and no other way.
- **iroh's defaults are left out** (`Cargo.toml`): `portmapper`, which asks the router to open a
  port; `fast-apple-datapath`, which uses private Apple APIs; `metrics`.
- **Its log lines stay out of the app's log.** iroh logs through `tracing`, and the app's sink
  takes only its own crate's and the page's (`security.md` §2); the module's own lines name no
  key, address or invitation.

### Relays

A relay does two things: it introduces two endpoints so they can find a direct path, and it
carries their traffic when no direct path exists. It sees the network addresses of the apps it
serves, which keys talk to which, when, and how much. It never sees what is sent.

**Which relay a table uses is the GM's setting** (Settings ▸ Table), and the invitation carries it:

| setting | the table is reached through | the invitation carries |
| --- | --- | --- |
| number 0 (default) | n0's public relays | the GM's relay URL |
| custom | one relay URL the GM typed, `https` only | that URL |
| none | nothing: a direct connection or no connection | the GM's own socket addresses |

n0 describes its public relays as free, rate-limited and without an uptime promise, and says not
to rely on them for production (design review ▸ 8). They are the default because a remote table
then works with nothing to set up; the other two settings are how a table stops depending on
them. A table with no relay works where the players can reach the GM's addresses — one local
network, or a forwarded port.

An invitation names the relay OR the GM's addresses, never both: a home network's addresses are
not something to paste into a chat when a relay already finds the table. A player's endpoint uses
the invitation's relay and no other, and the join question names its host before anything dials.

## The invitation and the door

`charnik-table:` followed by base64url JSON (`wire::Invite`): the protocol version, the GM's key
at this table, the relay or the addresses, the table's name, and a 128-bit secret.

**An invitation is an address and a knock, not a seat.** The secret gets a join request as far as
the GM's eyes; the GM's yes is what seats a key. One invitation serves the whole table, because a
GM pastes one line into a group chat.

**The door** is the GM's switch for whether knocking works at all. While it is open the table
holds one secret; shutting it drops the secret, and opening it again makes a new one — so every
invitation handed out before stops working either way. Whoever is seated stays.

What bounds a leaked invitation: a stranger's hello with the right secret raises one native
question at a time, at most four wait behind it and the rest are told the table is full, and the
GM shuts the door once everyone is in. A dial that never says hello holds one of sixteen places
for ten seconds, and a dial past those is refused before its handshake.

## What crosses the wire

One bidirectional stream per connection, opened by the player. Frames are a four-byte length and
JSON (`wire.rs`), each read against a ceiling before a byte of the body is:

| frame | from | ceiling | carries |
| --- | --- | --- | --- |
| `hello` | player | 1 KiB | protocol version, the invitation's secret, the player's name |
| `welcome` · `refused` | GM | 4 KiB | the table's name · why not (`invite`, `declined`, `version`, `full`) |
| `view` | player | 256 KiB | the top-level keys of the view that changed, and the keys that went |
| `request` | GM | 4 KiB | a request id and one `TableRequest` |
| `answer` | player | 256 KiB | the request id, accepted or declined, and the roll if one was made |
| `closed` | GM | 4 KiB | `dismissed` or `table_closed` |

- **Closed shapes.** Every frame is a serde enum that refuses a field it does not name
  (`deny_unknown_fields`), and each side can only parse the frames the OTHER side sends: a player's
  app has no way to say `request`.
- **Bounded values.** An amount is at most 100 000, a DC at most 99, an id is a content slug of at
  most 64 characters, a request id is 64 alphanumerics and hyphens (`TableRequest::is_bounded`).
- **A view travels as changes.** A whole view is about 25 KiB, most of it the traces under skills
  and abilities, which change on a level, an item or an effect; hit points are a few bytes. The
  player's side sends the top-level keys that differ from what it last sent on this connection and
  the GM's side lays them over what it keeps (`view_changes`, `merge_view`). The kept view is
  refused, and the seat ended, once it passes 64 keys or 256 KiB.
- **Paced.** At least 10 ms passes between two frames read from one peer.
- **Live or not delivered.** There is no queue. A call made with no connection answers
  `not_delivered` and is not pending; a player's app publishes its view again when it is seated
  again.
- **A frame is not signed; a record is.** The research asks for signatures and sequence numbers
  where a message is forwarded by peers who are not its author. A request, an answer and a view
  arrive on a QUIC stream from the key that wrote them, in order, so they carry neither; a log
  record is handed on by the GM, so it carries both (The table's log).

### Then the page holds it to a shape

Rust bounds the bytes; the page bounds the meaning. Every event Rust pushes is parsed against
`tableEventSchema` before a listener hears it (`table-link/tauri.ts` ▸ `listenToTableLink`), and
one that does not fit is dropped whole. Those schemas are separate from the character schema,
which validates the user's own file and caps nothing: here every number is finite and within a
million, every string and list has a length, an id is a slug, and a roll is five fields.
`tableViewSchema` is also what a player's app builds its view FROM (`table-link/view.ts`), so the
sheet a GM is shown and the sheet a player sends are one shape with one owner. A player's own
long name or effect label is cut to fit before it leaves rather than costing them the seat.

Peer text is rendered as text. Nothing a peer sent is passed to the Markdown renderer or set as
HTML.

## What a request does on a sheet

A request waits until the player presses, and it is then carried out by the SAME actions a click
on the sheet uses (`routes/table/player-requests.svelte.ts` ▸ `PlayerRequests.accept`):

- **Damage** is `takeDamage` with the amount and the type as sent: the character's own defenses
  apply first, then temporary hit points, a form's own, instant death and the concentration save.
- **Healing** is `heal`.
- **A state** is the row of that id in the character's own picker, switched on with the row's own
  duration — and left alone when the character already has it. An id this app's content does not
  have can only be declined.
- **A roll** is the sheet's own check, save or skill (`combat/sheet-roll-specs.ts`) with the
  effects it picks up, logged like any other, and read back as five facts: the total, the d20 that
  counted, how it was read, the modifier, and a forced outcome. The player rolls it at once, or —
  where the dice tray is mounted, the play screen — builds it in the tray first, to add what the
  sheet does not know (Guidance, a helper's advantage). The tray's next roll is then the answer
  (`SheetRolls.handNextTrayRollTo`); a tray put away unrolled answers nothing and puts the request
  back in front of the player, and the next request waits while the tray is open, because its
  prompt would cover it. A roll a condition decides opens no tray. An announced DC is answered on
  the player's side as a passed-or-failed line; a DC the GM kept stays on the GM's.

The character is saved after each, because the play screen's autosave is not running on every
screen a request can arrive over. At most twelve requests wait at once; one past that is declined
unseen, and a repeated request id is one request.

On the GM's side an answer is believed only from the participant who was asked, and only once.

## The screen

**The table is in the app only where the build has one.** `TableLink.available()` asks the build
without opening anything, and the navigation's Table entry and Settings ▸ Table exist only when
it says yes — so a release build, which has no table link, shows neither.

`/table` is one screen in three states (`routes/table/+page.svelte`):

- **No seat**: open a table (its name, and the relay it will be reached through with a link to
  change it) or join one (the invitation, and the name of the character who will sit). Why the
  last seat was not given or ended is said above both, as a sentence that says what to change.
- **A GM's seat**: the invitation with its copy button and the door's switch; a card per player
  (`TableSeatCard`) — hit points, death saves, AC, initiative, speed, saves, passives, states,
  what they resist, skills folded away — where every number carries the provenance popover the
  player's own sheet does, built from the trace the player's app sent; one composer
  (`AskComposer`) for asking — who, what, and the closed choices "what" is made of; and the list
  of what was asked with what came back. A roll held to a DC reads passed or failed there whether
  or not the players were told the DC, and telling them is a switch that is off until pressed.
  A player whose connection dropped stays on screen, dimmed, until they are back or removed.
- **A player's seat**: where the connection stands, the code to read to the GM until they are let
  in, and one sentence saying what the GM sees and what they do not.

**A request is raised over whatever screen the player is on** (`TableRequestDialog`, mounted by
the layout) as the house dialog, with no way out but Decline and its accept button — Escape and a
click outside answer nothing. It says what is asked in this app's own words, shows what a hit
comes to after the character's defense against its type, and counts the requests waiting behind
it. A request this sheet cannot carry out leaves the accept button blocked with its reason beside
it. The layout also starts `TableVM.keepPublishing`, which tells the table whenever what it sees
of the open character changes.

`/dev/table` mounts the same screen over hand-made state, since a real table needs a second app;
`&tray` mounts the play screen's dice tray beside it, so a roll can be built there too.

## Staying seated

- **A key the GM let in is not asked about twice.** A player whose connection drops dials again
  and is seated without a question, door open or shut. A newer connection of a key replaces its
  older one.
- **A dropped seat is dialled for as long as it is held.** Often at first, since most drops are
  short — 1, 2, 5, 10, 20 seconds — then every 30 (`reconnect_pause`), with no last try: a power
  cut takes a router away for many minutes, and a seat that gave up would cost the player a new
  invitation and the GM a new question. The player's screen says the connection dropped and
  offers "Try now" (`table_link_redial`), which dials at once and starts the frequent pace over;
  leaving the table is what stops it. The GM sees that player as away the whole time.
- **Dismissing takes the seat and the way back.** The key leaves the let-in set, the player is
  told `dismissed`, and their app does not dial again.
- **A GM's leaving closes the table**: every seat is told `table_closed`.
- **A player who never got in is not retried**: the first dial that fails ends as `unreachable`,
  and a refusal ends as its reason.
- **A page that loads again keeps its seat.** The seat is the app's, held in Rust, and a reload —
  Ctrl+Shift+R, a changed data folder — ends the page and not the table: nobody is dropped. The
  page asks for the seat on load (`table_link_resume`, `TableVM.resume`) and is told again what
  the page before it was told and still stands: who is at the table and the last sheet each
  showed, a player's connection, the requests nobody answered. Rust keeps that list as it emits
  (`remember` in `mod.rs`), and a sheet in it is held to `tableViewSchema` again, since it began as
  a peer's bytes. Picking a seat up opens no socket and raises no native question — the person
  said yes when the seat was taken. **The GM's log of asks is the page's own** — the DC a roll is
  held to never crosses the wire, so Rust has no copy to hand back — and the page keeps it in
  sessionStorage under its table (`routes/table/asked-log.ts`), which lasts through a reload and
  not past the app's window. Rust keeps the newest fifty answers in the same list, so one that
  landed while no page was there finds its row. Closing the app is what ends a table.

## The table's log

> TABLE-LINK-LOG is built to this section; TABLE-LINK-REMEMBER, the half below it, is not yet.
> What is still open for the maintainer to rule on is listed in the item (`../work/release.md`).

**One model: every record has one author, and nobody is the master of the table's state.** A GM's
app lags and restarts like anyone's, so nothing waits on it to say what is true:

- **A record is written by one app and never changed.** A player's roll is theirs; a GM's roll and
  a GM's notice are the GM's. No two apps write one record, so nothing is merged or agreed on: the
  log is the union of the records an app holds, shown in the order of their times.
- **A record is signed with its author's key at this table**, so a copy handed on by anyone is the
  author's words or is refused. The signed bytes are the record's own JSON text, carried as text,
  so nobody re-serialises before checking; they are signed under `charnik/table/record/1` and a NUL
  ahead of them, so a signature made for a record cannot be passed off as anything else
  (threats ▸ I5). Inside them are the table's key (a record for another table is refused, I4), the
  author's key, a sequence number that grows by one per author, and the author's clock.
- **Every app that saw a record keeps a copy, and says what it has.** On every connection both
  sides send `have` — the highest sequence number held from each author — and each sends what the
  other lacks. A player who was away for ten minutes is given the rolls they missed, and a GM's app
  that lost a record gets it back from whoever kept it.
- **A star still.** A player's record goes to the GM; the GM keeps it and hands it to every other
  seat with the name the GM let that key in under. The name is the GM's to say — it is not in the
  signed bytes — and the record is the author's.

What a record is:

| record | author | who is handed it |
| --- | --- | --- |
| `roll` — its name, the five facts of a table roll | anyone | the table, or the GM alone |
| `hide` — the author and number of a record | the GM, or a record's own author | the table |

**Who sees a roll is the roller's choice**, said on the roll: a player's rolls go to the table
unless the player turned that off on the Table screen, and then to the GM alone; a GM's rolls go
nowhere unless the GM turned showing them on. A roll kept to the GM is not handed on, and a player
is never given one. Every roll the sheet logs is a roll the log can carry, so nothing new is pressed
to share one.

**Moderation ships with the log** (`../research/adoption-friction.md` ▸ 9). The GM can hide any
record and a player their own; a `hide` is itself a signed record, so every app that holds the
record drops it, and one that comes back later is still hidden. Nothing is deleted from another
app's disk — it cannot be — so the GM's word is what every honest copy shows.

**Bounds.** A record's text is at most 2 KiB and is read against that before it is parsed; a
roll's name is cut like any peer name; a table keeps its newest 500 records and refuses an
author's eleventh in ten seconds. A record whose author is not at the table — not let in, or
dismissed — is not kept.

## Remembering a table

> TABLE-LINK-REMEMBER — specified, not built.

- **A table's key outlives the app, in the OS's own store** (`keyring`), never the data folder,
  which a folder sync or a restored backup carries (design review ▸ 11). An app whose key cannot be
  opened treats the table as gone and says to join again.
- **The rest is a file only Rust writes**, in the app's local data folder, which the page's file
  access is denied (`capabilities/default.json`): the tables this app sits at, each with its name,
  its GM's key and route, this app's role, and — for a GM — the keys let in. The records each app
  holds sit beside it, so the log lasts as long as the table.
- **Coming back asks first.** After a restart nothing dials until the person answers one native
  question per table — return to this table? — as going online always does. A "no" keeps the
  table listed; "forget this table" is the way it goes, key and records with it.
- **A GM key that changes is a new table**, joined from a new invitation, never a warning to click
  past.
- **The GM's log of asks becomes records** — an ask is the GM's, an answer the player's — so a GM's
  app that restarted gets it back from the players' copies. A DC the GM kept is in the GM's own
  copy only, since it never crosses the wire.

## Versions

The ALPN is `charnik/table/1` and the hello says `protocol: 1`. A GM refuses another number with
`version`, and an invitation of another version is not one (`bad_invite`). Two builds that share a
protocol number sit together whatever their app versions; a peer's field this build does not know
is a malformed frame, so a change to a frame's shape is a new protocol number. A view carries its
character's edition, and the GM's app names conditions from its own catalog.

## Where it lives

- `src-tauri/src/table_link/` — `wire.rs` (frames, invitation, the cut of a view), `session.rs`
  (the two endpoints; knows nothing of Tauri, so two sessions sit at one table in a test),
  `mod.rs` (commands, the seat this app holds, the native questions).
- `src/lib/table-link/` — `types.ts` (the seam), `wire-schema.ts` (what a peer is believed to have
  said), `view.ts` (the table's view of a character), `tauri.ts` and `noop.ts` (the two
  implementations), `provider.ts` (the one place one is chosen).
- `src/routes/table/` — `table-view-model.svelte.ts` (`TableVM`: the seat this app holds, who a GM
  has seated and what was asked of them), `player-requests.svelte.ts` (`PlayerRequests`: what a
  player's app does with a request), `requested-roll.ts` (the roll a request asks for, read back)
  and the screen over them, above. `components/settings/TableSettings.svelte` is the relay setting.

## Driving a live table

Three things sit between the transport's test and the screen's preview: the commands, the native
questions, and the events crossing into the webview. They are driven together by one probe and
one ignored test, with **a person answering the two native questions** — a script that pressed
them would be the thing they exist to refuse.

1. Start the dev server (`pnpm dev`) and read its port.
2. Open the desktop app on the probe, built with the feature (`tooling.md` ▸ Verifying on the
   real desktop app): `pnpm tauri dev --features table-link --config <file>`, the file holding
   `{"build":{"devUrl":"http://localhost:<port>/dev/table-live","beforeDevCommand":""}}`.
3. In a second terminal, from `src-tauri/`, with `CHARNIK_LIVE_TABLE` naming `.table-live` in the
   data folder:
   `cargo test --features table-link -- --ignored a_live_player_sits_at_the_apps_table`.
   Build it beforehand (`--no-run`): the probe gives the player two minutes to arrive.
4. Say yes to "open a table?", then to "let Probe player in?".
5. Read `table-live-probe.txt` in the data folder.

The probe (`routes/dev/table-live`) opens a table with NO relay, so nothing leaves the machine,
writes the invitation and a sheet into `.table-live`, and waits. The test is a player in a
process of its own (`session.rs`): it follows that invitation, shows that sheet, answers a roll
with a roll and a hit with a no, and leaves when the table closes. The probe checks that the
sheet arrived whole, that a page loading again — a view-model that knows nothing — is handed the
same table with the player and their sheet, that each answer landed on the ask it answers, that
the door makes a new invitation, and that the table closes; it puts the relay setting back and
deletes nothing it did not write.

`/dev/table-link?expect=on|off` is the smaller probe beside it: it asks the running webview
whether the commands are there and whether each one refuses what it should, and raises no
question at all.

## What is left to a device and a table

Driven so far on one machine with no relay: the transport inside a test, the screen over
hand-made state, and `/dev/table-link` and the live table of `/dev/table-live` on the real desktop
build. Not driven: two real networks through n0's relays and through none; how often a path stays
on the relay; a relay that is unreachable mid-session; two Charnik versions at one table.

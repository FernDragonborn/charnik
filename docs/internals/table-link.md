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

**A table lasts until it is left.** Its key is made when it opens and kept in the OS's own
credential store, so an app that went down — a restart, a power cut — returns to the same table
under the same key instead of coming back a stranger (Remembering a table). Leaving is what ends
it: a GM's leaving closes it for everyone, and either seat's leaving forgets it on that computer.

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

## Going online is a question the page cannot answer

No socket exists until a person says so in **the question window** (`table_link/question.rs`): a
window Rust opens over the app, words, and believes an answer only from. The answer command checks
the label of the webview that calls it — which Tauri sets and a caller cannot — and only that
window's capability (`capabilities/table-link/table-question.json`) allows it at all. The app's
page holds no permission to open, close, hide or move a window (`core:default` grants those read
only), so it cannot press the question, cover it, or open one of its own. The window shows one
static page, `static/table-question.html`, which renders the words as text, starts with the focus
on the refusal so an Enter pressed by habit says no, and navigates nowhere; closing it is a no. It
does not follow the user's theme on purpose: a theme is the page's to set. One question is on
screen at a time. The words come in four parts, each a catalog string of its own: the question
said small (`ask`), the one thing the person must recognise said large (`fact` — the table, or the
player), a code to compare with what is said aloud larger still, where one is asked, and what
follows from the answer (`body`). The refusal stands on one edge and the yes on the other. The
page measures its words and asks to be that tall (`table_question_fit`, the question window's own
command, held between 200 and 640 px), so a longer locale is never cut off.

| the question | who is asked | what it names |
| --- | --- | --- |
| open this table? | the GM, on `host` | the table's name and the relay it is reached through |
| join this table? | the player, on `join` | the table's name, the name they join under, the relay |
| let this player in? | the GM, per new key | the player's name and their six-digit code |
| return to this table? | either seat, on `return` | the table's name and its route |
| open the door again? | the GM, on opening a shut door | the table's name |
| send this player away? | the GM, on dismissing a seat | the player's name and the table's |

Shutting the door, leaving a table and forgetting one ask nothing: each takes the GM's or the
player's own way in away and lets nobody else in, so the worst page script can do with them is end
its own person's seat (`security.md` ▸ the table link's commands).

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
them. The first table opened on a device asks once how players will reach it, with n0 chosen
(`TableRouteDialog`, Settings ▸ Table's own choices): a no-relay table that players cannot reach is
the failure a GM should not meet on the night. A table with no relay works where the players can reach the GM's addresses — one local
network, or a forwarded port. It is opened on IPv4 and IPv6, or on IPv4 alone (Settings ▸ Table ▸
Addresses; `AddressFamilies`): for a network or a driver without IPv6, or to keep an IPv6 address,
which can name a machine for longer than an IPv4 one behind a home router, out of the invitation.
On IPv4 alone only IPv4 sockets are bound and only IPv4 addresses are invited, and the question
before opening says so.

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

What bounds a leaked invitation: a stranger's hello with the right secret raises one question at
a time, at most four wait behind it and the rest are told the table is full, and the GM shuts the
door once everyone is in. Sixty-four connections may be mid-handshake at once, each for ten seconds
at most. Once a key is known, one let in before goes straight to its hello; a stranger at a shut
door is let go at once with a close code its app reads as the invitation no longer working
(`DOOR_SHUT`); a stranger at an open door holds one of sixteen greeting places for ten seconds.

**A stranger's key has to knock before it takes a greeting place** (`wire::knocks`): the BLAKE3
hash of the door's secret, the GM's key and the stranger's key must start with sixteen zero bits.
A joining app tries keys until one does — about 65 000, a second or so of one core, once per table,
since a seat keeps the key it was let in under. A key that does not knock is let go at once under
`DOOR_SHUT`, the same as at a shut door. So silent dials that hold the greeting places cost their
sender a second of work each, and without the invitation's secret no amount of work opens one.

## What crosses the wire

One bidirectional stream per connection, opened by the player. Frames are a four-byte length and
JSON (`wire.rs`), each read against a ceiling before a byte of the body is:

| frame | from | ceiling | carries |
| --- | --- | --- | --- |
| `hello` | player | 1 KiB | protocol version, the invitation's secret, the player's name, the app's Charnik version |
| `welcome` · `refused` | GM | 16 KiB | the table's name · why not (`invite`, `declined`, `version`, `full`), and for `version` the GM's protocol and Charnik version |
| `clock` | both | 16 KiB · 256 KiB | the player's clock as the seat begins and every five minutes · how far it runs behind the GM's |
| `view` | player | 256 KiB | the top-level keys of the view that changed, and the keys that went |
| `request` | GM | 16 KiB | a request id and one `TableRequest` |
| `answer` | player | 256 KiB | the request id, accepted or declined, and the roll if one was made |
| `closed` | GM | 16 KiB | `dismissed` or `table_closed` |
| `record` | both | 16 KiB · 256 KiB | one signed log record; from the GM also the name its author was let in under and its author's clock skew |
| `have` | both | 16 KiB · 256 KiB | the highest record number held from each author, at most 32 |

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
  duration — and left alone when the character already has it. The prompt names it by that same
  row, so the words the player accepts are the state the sheet puts on. An id this app's content does not
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
  Below them, the tables this app remembers, each with Return and a small × to forget it.
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
of the open character changes and writes every roll the sheet makes into the table's log.

**Both seats show the table's log** (`TableLogPanel`): the rolls this app holds, newest first,
each with its time, who rolled it — "you", "GM", or the name the GM let them in under — and a
mark on a roll kept to the GM; a Hide on every roll the GM sees and on a player's own; and the
switch for who this app's own rolls go to, kept in the app's settings per seat.

`/dev/table` mounts the same screen over hand-made state, since a real table needs a second app;
`&tray` mounts the play screen's dice tray beside it, so a roll can be built there too.

## Staying seated

- **A key the GM let in is not asked about twice.** A player whose connection drops dials again
  and is seated without a question, door open or shut, **under the name it was let in by** — a
  hello cannot rename it, and the GM's screen shows that name rather than the one the player's
  sheet claims. A newer connection of a key replaces its older one and closes it.
- **Dismissing a seat closes its connection**, a moment after the goodbye is queued, so a peer that
  stopped reading cannot keep a seat its goodbye never reached.
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
  said yes when the seat was taken. The GM's screen reconstructs the log of asks from
  the signed records; an answer is matched by request id and author. An unannounced DC remains a page-local annotation in sessionStorage
  (`routes/table/asked-log.ts`) and survives a page reload, not an app exit.

## The table's log

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
  sides send `have` — the highest sequence number held from each author. The GM sends a seat every
  record it lacks and may see; the GM's `have` to a seat leaves out an author's newest records that
  seat may not see (`Log::have_for`), so it does not say how many rolls were just kept from it. A
  player who was away for ten minutes is given the rolls they missed.
- **An app hands over only the records it wrote.** Its author holds every record of its own, so a
  copy of another's would only be that author's record again, and a copy handed on would bring back
  a record the GM had evicted, evicting a newer one in its place. A seat sends its
  own from the number after what the GM's `have` says, and the GM takes a record from a seat only
  when the seat is its author. The cost, taken knowingly: a record the GM's app lost before it
  reached the disk stays lost, since nobody else hands it back; records are written one by one as
  they happen, so that window is a fraction of a second.
- **A star still.** A player's record goes to the GM; the GM keeps it and hands it to every other
  seat with the name the GM let that key in under. The name is the GM's to say — it is not in the
  signed bytes — and the record is the author's.

What a record is:

| record | author | who is handed it |
| --- | --- | --- |
| `roll` — one action: every roll one press made (at most 16, written eight to a record so it fits), each its name and the five facts of a table roll; a roll that `reveals` an earlier one of its author's | anyone | the table, or the GM alone |
| `hide` — the author and number of a record | the GM, or a record's own author | the table |
| `ask` — the player, request id and public request | the GM | the addressed player |
| `answer` — the request id and the player's answer | the addressed player | the GM |

**History is not a prompt.** A live `request` frame carries the signed ask. The player holds a
copy and answers by signing a record; only the live frame opens the prompt. The GM's app keeps its
asks and the answers on its own disk, and rebuilds the conversation from them when it opens the
table again. The GM never forwards these records to other players or reissues them as live prompts.
An unannounced DC is not part of the signed request and lives only in the GM's page session.

**Who sees a roll is the roller's choice**, said on the roll: a player's rolls go to the table
unless the player turned that off on the Table screen, and then to the GM alone; a GM's rolls go
nowhere unless the GM turned showing them on. A roll kept to the GM is not handed on, and a player
is never given one. **Its roller can show it the table afterwards**: a new roll that `reveals` the
kept one's number, to the table, which the author's app writes from the kept roll — its lines and
its time — whatever the page sent, so a reveal cannot show numbers the roll did not have, and only
once. Every app shows the reveal where the kept roll stood and drops the kept one. Every roll the sheet logs is a roll the log can carry, so nothing new is pressed
to share one.

**Moderation ships with the log** (`../research/adoption-friction.md` ▸ 9). The GM can hide any
record and a player their own — a whole action, since the action is the record; a `hide` is itself a signed record, so every app that holds the
record drops it, and one that comes back later is still hidden. Nothing is deleted from another
app's disk — it cannot be — so the GM's word is what every honest copy shows.

**Bounds.** A record's text is at most 2 KiB and is read against that before it is parsed; a
roll's name is cut like any peer name, and worded from this app's catalog only under a roll's own
key. **A record's time decides nothing but its place in the list**, and that place is on the GM's
clock: the GM's app measures how far each seat's clock runs behind its own when the seat begins and
every five minutes after (`clock`), keeps that skew beside every record of that author, hands it on
with the record, and tells the seat its own. Every app sorts by the author's time moved by its skew,
so a seat whose clock is wrong by minutes or days writes rolls that land where they were made, with
nothing for any person to do. A seat keeps the skew it was last told across restarts; what it wrote
before any GM's app had measured it is placed again when one does, on its screen and on its disk,
where the later line for a record is the one read back. One dated more than ten minutes ahead on the GM's clock is refused,
and when the 500 a table keeps are full, the record that ARRIVED first goes — never the one the
oldest-looking clock wrote, which would cost a seat with a wrong clock every roll. An author's
numbers go on past what was evicted. A table holds records from at most 32 authors. **The pace
loses nothing:** a seat's app hands its records over twenty at once and one a second after, the rest
waiting in its own log, and the GM's app takes thirty at once and one a second after from each seat
— above the sender's pace, so it refuses only an app that does not keep it. An answer to an ask the
GM made of that seat is not counted, at most one per ask. A record already held costs nothing. A
record whose author is not at the table — not let in, or dismissed — is not kept. The GM's rolls carry a badge and a ground of their own in the log, which no player's name can draw.
**A player's app paces its own disk:** what the GM hands over is held and shown at once, and written
at most sixty records in ten seconds, in the order it came, the rest waiting (`DiskPace`). The GM is
trusted with what the table says, not with how fast this app writes.

## Remembering a table

(`table_link/remember.rs`; the session's half is `Again` and `Keeper` in `session.rs`.)

- **A table's key outlives the app, in the OS's own store** (`keyring-core`), never the data
  folder, which a folder sync or a restored backup carries (design review ▸ 11). An app whose key
  cannot be opened treats the table as gone and says to join again (`forgotten`). The desktop
  stores are Windows Credential Manager, Linux Secret Service over an encrypted D-Bus session,
  and the macOS login Keychain (*to audit* — TABLE-LINK-MACOS-STORE). An unavailable store leaves a table session-only; opening the
  store is retried on the next operation. Other targets have no store.
- **The rest is a file only Rust writes**, in `tables/` under the app's local data folder, which
  the page's file access is denied (`capabilities/default.json`): one `<table>.json` per table —
  a GM's table name, relay setting, bound socket addresses and the keys let in under their names;
  a player's invitation
  and the name they sat under — and one `<table>.records.jsonl` of the records the app holds,
  each with the name it was shown under, rewritten to its newest 500 once it reaches 2 000 lines.
  A file is written whole beside the old one and renamed over it, and a table id is the only file
  name the module makes. The session asks for each line as it happens (`Keep`), so a power cut
  loses at most what was not yet written.
- **Coming back asks first.** The Table screen lists the tables this app sat at and did not leave
  (`table_link_remembered`); Return asks one native question — return to this table? — before any
  socket, as going online always does, and Forget asks first in the page, since it cannot be undone.
- **A table opened again is the same table**: the GM's endpoint binds under the kept key, so the
  invitation players hold still names it, and whoever was let in is seated without being asked
  about. **Its door is shut** until the GM opens it, so invitations handed out before the app went
  down do not still knock. A player's seat that was dialling all along finds it — through a
  relay. A table with no relay binds its saved UDP ports again, so players on the
  same LAN redial the old invitation without another admission, even with the door shut. A busy saved
  port refuses the return instead of silently moving the table. A saved IPv6 port that no longer
  binds — IPv6 switched off since the table was kept — returns the table on its IPv4 port, and the
  GM is told that players who reached it over IPv6 need a new invitation. A changed LAN address still
  needs a new invitation. A saved table with no addresses binds new ports once and keeps them.
  Updating those addresses never replaces or deletes the key; a failed metadata write leaves the old table intact.
- **A GM key that changes is a new table**, joined from a new invitation, never a warning to click
  past.

## Versions

The ALPN is `charnik/table/1` and the hello says `protocol: 5`: the ALPN names the framing and the
number names the frames, so an app of another number is reached and refused with `version` rather
than not reached at all. A hello of another number is read loosely, for what every version's hello
carries, and the `refused` frame keeps one shape for good, so the refusal is understood across any
two versions: it carries the GM's protocol and Charnik version, the player is told whose app is the
older and who has to update, and a GM is told of a knock refused for version from anyone holding
the invitation or let in before — a stranger's hello is not the GM's to read about. The invitation format stays at version 2, so an existing invitation can
still be parsed. An invitation of another format version is not one (`bad_invite`). Two builds that share a
protocol number sit together whatever their app versions; a peer's field this build does not know
is a malformed frame, so a change to a frame's shape is a new protocol number. A view carries its
character's edition, and the GM's app names conditions from its own catalog.

## Where it lives

- `src-tauri/src/table_link/` — `wire.rs` (frames, invitation, the cut of a view), `session.rs`
  (the two endpoints; knows nothing of Tauri, so two sessions sit at one table in a test),
  `records.rs` (a log record: signing, checking, what each side holds and lacks),
  `mod.rs` (commands, the seat this app holds, the questions' words), `question.rs` (the
  question window).
- `src/lib/table-link/` — `types.ts` (the seam), `wire-schema.ts` (what a peer is believed to have
  said), `view.ts` (the table's view of a character), `tauri.ts` and `noop.ts` (the two
  implementations), `provider.ts` (the one place one is chosen).
- `src/routes/table/` — `table-view-model.svelte.ts` (`TableVM`: the seat this app holds, who a GM
  has seated and what was asked of them), `player-requests.svelte.ts` (`PlayerRequests`: what a
  player's app does with a request), `requested-roll.ts` (the roll a request asks for, read back),
  `table-log.svelte.ts` (`TableLog`: the table's log as this app holds it) and the screen over
  them, above. `components/settings/TableSettings.svelte` is the relay setting.

## Driving a live table

Three things sit between the transport's test and the screen's preview: the commands, the native
questions, and the events crossing into the webview. They are driven together by one probe and
one ignored test, with **a person answering the two native questions** — a script that pressed
them would be the thing they exist to refuse.

1. Start the dev server (`pnpm dev`) and read its port.
2. Open the desktop app on the probe, built with the feature (`tooling.md` ▸ Verifying on the
   real desktop app): `pnpm tauri dev --features table-link --config <file>`, the file holding
   `{"build":{"devUrl":"http://localhost:<port>/","beforeDevCommand":""},"app":{"windows":[…]}}`,
   the window being `tauri.conf.json`'s own with `"url":"dev/table-live"`. The question window
   is `table-question.html` beside the app's root, so a `devUrl` that names the probe leaves it
   blank.
3. In a second terminal, from `src-tauri/`, with `CHARNIK_LIVE_TABLE` naming `.table-live` in the
   data folder:
   the test binary `cargo test --features table-link --no-run` names, run directly with
   `--ignored a_live_player_sits_at_the_apps_table`. Not through `cargo test`: its build touches
   `src-tauri/`, `tauri dev` reloads the probe mid-run, and the reloaded probe closes the table
   the player is dialling. Empty `.table-live` first, or the player follows the last run's
   invitation. With `CHARNIK_LIVE_TABLE` set the test build knocks at the real app's strength.
4. Say yes to "open a table?", then to "let Probe player in?".
5. Read `table-live-probe.txt` in the data folder.

The probe (`routes/dev/table-live`) opens a table with NO relay, so nothing leaves the machine,
writes the invitation and a sheet into `.table-live`, and waits. The test is a player in a
process of its own (`session.rs`): it follows that invitation, shows that sheet, answers a roll
with a roll and a hit with a no, writes its roll into the table's log, and leaves when the table
closes. The probe checks that the sheet arrived whole, that a page loading again — a view-model
that knows nothing — is handed the same table with the player and their sheet, that each answer
landed on the ask it answers, that the player's roll reaches the log under their name and the
GM's hide takes it away, that the door makes a new invitation, and that the table closes; it puts the relay setting back and
deletes nothing it did not write.

`/dev/table-link?expect=on|off` is the smaller probe beside it: it asks the running webview
whether the commands are there and whether each one refuses what it should, and raises no
question at all.

## What is left to a device and a table

Driven so far on one machine with no relay: the transport inside a test, the screen over
hand-made state, `/dev/table-link` and the live table of `/dev/table-live` on the real desktop
build, and a remembered table quit and returned to on Windows and on Linux. Not driven: two real
networks through n0's relays and through none; how often a path stays on the relay; a relay that
is unreachable mid-session; two Charnik versions at one table; a player's own app, which one machine cannot hold
beside the GM's (one Charnik per machine); a no-relay table after the Windows firewall's question
was answered Cancel.

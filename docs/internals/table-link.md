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
- **No signatures, no sequence numbers.** The research asks for both under gossip, where a
  message is forwarded by peers who are not its author. In a star each frame arrives on a QUIC
  stream from the key that wrote it, in order.

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
on the sheet uses (`routes/table/table-view-model.svelte.ts` ▸ `TableVM.accept`):

- **Damage** is `takeDamage` with the amount and the type as sent: the character's own defenses
  apply first, then temporary hit points, a form's own, instant death and the concentration save.
- **Healing** is `heal`.
- **A state** is the row of that id in the character's own picker, switched on with the row's own
  duration — and left alone when the character already has it. An id this app's content does not
  have can only be declined.
- **A roll** is the sheet's own check, save or skill (`combat/sheet-roll-specs.ts`), rolled at
  once with the effects it picks up, logged like any other, and read back as five facts: the
  total, the d20 that counted, how it was read, the modifier, and a forced outcome. It is not
  built in the dice tray, which hands no result back to answer the GM with. An announced DC is
  answered on the player's side as a passed-or-failed line; a DC the GM kept stays on the GM's.

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

`/dev/table` mounts the same screen over hand-made state, since a real table needs a second app.

## Staying seated

- **A key the GM let in is not asked about twice.** A player whose connection drops dials again —
  six tries, five seconds apart — and is seated without a question, door open or shut. A newer
  connection of a key replaces its older one.
- **Dismissing takes the seat and the way back.** The key leaves the let-in set, the player is
  told `dismissed`, and their app does not dial again.
- **A GM's leaving closes the table**: every seat is told `table_closed`.
- **A player who never got in is not retried**: the first dial that fails ends as `unreachable`,
  and a refusal ends as its reason.

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
  has seated and what was asked of them, what a player's app does with a request) and the screen
  over it, below. `components/settings/TableSettings.svelte` is the relay setting.

## What is left to a device and a table

Driven so far on one machine with no relay. Not driven: two real networks through n0's relays and
through none; how often a path stays on the relay; a relay that is unreachable mid-session; two
Charnik versions at one table.

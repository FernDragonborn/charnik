//! A table as connections: the GM's endpoint that players dial, and a player's that dials it.
//!
//! A star — every player holds one connection, to the GM, and none to another player. iroh gives
//! an authenticated, encrypted pipe to a key; who is AT the table is decided here, by the GM's
//! approval of each key (`admit`).
//!
//! Nothing in this file knows about Tauri: what a session tells the app is an `Emit`, and what it
//! asks the GM is an `Approve`, so two sessions can sit at one table inside a test.

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use iroh::endpoint::{presets, BeforeConnectOutcome, Connection, EndpointHooks, RecvStream};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, SecretKey, TransportAddr};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::sync::{mpsc, Notify, Semaphore};
use tokio::time::{sleep, timeout};

use super::records::{self, Audience, Body, Bucket, Held, Kept, Log, Record, Signed, SEND_PACE};
use super::wire::{
    self, FrameError, GmFrame, Goodbye, Invite, PlayerFrame, Refusal, TableAnswer, TableRequest,
    ALPN, GM_FRAME_CAP, HELLO_CAP, INVITE_VERSION, PROTOCOL, VIEW_CAP,
};

/// How long a GM's endpoint waits for its relay before saying the table cannot be opened.
const RELAY_WAIT: Duration = Duration::from_secs(15);
/// How long a connection has to say hello.
const HELLO_WAIT: Duration = Duration::from_secs(10);
const CONNECT_WAIT: Duration = Duration::from_secs(20);
/// How long a player waits at the door for the GM to answer.
const APPROVAL_WAIT: Duration = Duration::from_secs(300);
/// A goodbye is written and then the other side is given this long to hang up on it.
const GOODBYE_WAIT: Duration = Duration::from_secs(1);
/// How long a seat that dropped waits before each dial, in seconds: often at first, since most
/// drops are short, then at the last pace for as long as the seat is held. A power cut takes a
/// table away for many minutes, so only the person at the seat gives it up.
const RECONNECT_PAUSES: [u64; 6] = [1, 2, 5, 10, 20, 30];

/// The wait before the dial that follows `failed` dials in a row.
fn reconnect_pause(failed: usize) -> Duration {
    let last = RECONNECT_PAUSES.len() - 1;
    Duration::from_secs(RECONNECT_PAUSES[failed.min(last)])
}
/// The least time between two frames read from one peer — a ceiling on what one seat can make
/// the other app do.
const FRAME_PACE: Duration = Duration::from_millis(10);

const MAX_SEATS: usize = 12;
/// How many strangers may wait for the GM's answer at once; the rest are told the table is full.
const MAX_WAITING: usize = 4;
/// How many connections may be between arriving and saying hello at once. Whoever dials past
/// that is refused before the handshake, so a flood of dials costs the table nothing it keeps.
const MAX_GREETING: usize = 16;
/** How many connections may be mid-handshake at once, before anyone's key is known. A key the GM
 *  let in skips the greeting pool after it, so strangers holding that pool keep nobody out who
 *  was let in before. */
const MAX_HANDSHAKES: usize = 64;
/** The code a GM's app closes a connection with when a key it never let in arrives at a shut
 *  door: the player's app reads it as the invitation no longer working. */
const DOOR_SHUT: u32 = 1;
const OUTBOUND_QUEUE: usize = 32;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Connecting,
    /// The hello is said and the GM has not answered.
    Waiting,
    Connected,
    Reconnecting,
    Closed,
}

/// Why a seat ended, or was never given.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseReason {
    Unreachable,
    Invite,
    Declined,
    Version,
    Full,
    Dismissed,
    TableClosed,
    /// The other app said something the protocol does not.
    Protocol,
}

impl From<Refusal> for CloseReason {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::Invite => Self::Invite,
            Refusal::Declined => Self::Declined,
            Refusal::Version => Self::Version,
            Refusal::Full => Self::Full,
        }
    }
}

impl From<Goodbye> for CloseReason {
    fn from(goodbye: Goodbye) -> Self {
        match goodbye {
            Goodbye::TableClosed => Self::TableClosed,
            Goodbye::Dismissed => Self::Dismissed,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Delivery {
    Delivered,
    NotDelivered,
}

/// Everything a session tells the app about a table.
#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum TableEvent {
    ParticipantJoined {
        table: String,
        participant: Participant,
    },
    ParticipantLeft {
        table: String,
        participant: String,
    },
    View {
        table: String,
        participant: String,
        view: Value,
    },
    Request {
        table: String,
        request_id: String,
        request: TableRequest,
    },
    Answer {
        table: String,
        participant: String,
        request_id: String,
        answer: TableAnswer,
    },
    /// A log record this app holds now, with the name the GM let its author in under — none for
    /// the GM's own records, and for a player's own on their side.
    Record {
        table: String,
        record: Record,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        /// Written by this app.
        mine: bool,
    },
    Connection {
        table: Option<String>,
        state: ConnectionState,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<CloseReason>,
        /// For a seat refused for its version: the GM's Charnik, and whether it is the newer one.
        #[serde(skip_serializing_if = "Option::is_none")]
        gm_version: Option<VersionGap>,
    },
    /// Somebody holding this table's invitation knocked with a Charnik that speaks another table
    /// protocol, and was turned away: the GM is told who, and whose app is the older.
    VersionRefused {
        table: String,
        name: String,
        version: String,
        /// The player's app is the newer one, so it is the GM's to update.
        player_newer: bool,
    },
}

/// Which Charnik the other side runs, and whether it speaks the newer table protocol.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionGap {
    pub version: String,
    pub newer: bool,
}

/// Why no seat was given.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Unavailable {
    /// The person at this app said no to opening the network.
    Cancelled,
    AlreadySeated,
    BadName,
    BadInvite,
    BadRelay,
    RelayUnreachable,
    Network,
    /// The table to return to is not remembered: forgotten, or its key is gone from the store.
    Forgotten,
}

pub type Emit = Arc<dyn Fn(TableEvent) + Send + Sync>;

/// What a session asks the app to keep beyond what it shows, so a table outlives the app
/// (`docs/internals/table-link.md` ▸ Remembering a table).
#[derive(Clone, Debug, PartialEq)]
pub enum Keep {
    /// A record this app now holds, with the name it is shown under and its author's skew.
    Record(Held),
    /// A key the GM let in, under the name it gave.
    LetIn { key: EndpointId, name: String },
    /// A key the GM sent away.
    SentAway { key: EndpointId },
}
pub type Keeper = Arc<dyn Fn(Keep) + Send + Sync>;

/// What an app that sat at this table before brings back to it.
pub struct Again {
    /// The key it sat under: the same key is the same seat, and for a GM the same table.
    pub key: SecretKey,
    /// For a GM, whom it had let in, and under what name.
    pub allowed: Vec<(EndpointId, String)>,
    /// The records it held, each with the name it was shown under.
    pub records: Vec<Held>,
    pub bind_addrs: Vec<SocketAddr>,
}

/// Somebody at the door, as the GM is asked about them.
pub struct JoinRequest {
    pub table: String,
    pub player: String,
    pub code: String,
}

pub type Approve =
    Arc<dyn Fn(JoinRequest) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

/// Which relay servers a table is reached through — the GM's choice, carried by the invitation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum RelaySetting {
    /// number 0's public relays.
    N0,
    Custom {
        url: String,
    },
    /// No relay: the invitation carries this machine's own addresses, of the families chosen.
    None {
        #[serde(default)]
        addresses: AddressFamilies,
    },
}

/// Which address families a table with no relay is opened on. A GM may keep to IPv4: an IPv6
/// address can name the machine for longer than an IPv4 one behind a home router, and some
/// networks or drivers have IPv6 switched off.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AddressFamilies {
    #[default]
    Both,
    Ipv4,
}

/// Where an IPv4-only table binds when it has no saved port: any interface, a port of the system's
/// choosing.
const ANY_IPV4: SocketAddr =
    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 0);

/// A relay is a web address the app will keep a connection to, so it is one over TLS.
pub fn parse_relay(url: &str) -> Option<RelayUrl> {
    let relay: RelayUrl = url.trim().parse().ok()?;
    (relay.scheme() == "https" && relay.host_str().is_some()).then_some(relay)
}

impl RelaySetting {
    fn mode(&self) -> Option<RelayMode> {
        Some(match self {
            Self::N0 => RelayMode::Default,
            Self::Custom { url } => RelayMode::custom([parse_relay(url)?]),
            Self::None { .. } => RelayMode::Disabled,
        })
    }
}

/// The one key an endpoint may dial, if any. A GM's endpoint dials nobody; a player's dials the GM
/// of its invitation. Whatever else asks this endpoint to connect is refused before a packet leaves.
#[derive(Debug)]
struct DialPolicy {
    only: Option<EndpointId>,
}

impl EndpointHooks for DialPolicy {
    fn before_connect<'a>(
        &'a self,
        remote_addr: &'a EndpointAddr,
        alpn: &'a [u8],
    ) -> impl Future<Output = BeforeConnectOutcome> + Send + 'a {
        let allowed = alpn == ALPN && self.only == Some(remote_addr.id);
        async move {
            if allowed {
                BeforeConnectOutcome::Accept
            } else {
                BeforeConnectOutcome::Reject
            }
        }
    }
}

enum EndpointRole {
    Gm,
    Player(EndpointId),
}

/// An endpoint for one table, under a key made for it and kept nowhere. No address lookup is
/// configured: nothing about the endpoint is published, and the invitation is how it is found.
async fn bind(
    key: SecretKey,
    relay: RelayMode,
    role: EndpointRole,
    bind_addrs: &[SocketAddr],
) -> Result<Endpoint, Unavailable> {
    let (alpns, only_dial) = match role {
        EndpointRole::Gm => (vec![ALPN.to_vec()], None),
        EndpointRole::Player(gm) => (vec![], Some(gm)),
    };
    let mut builder = Endpoint::builder(presets::Minimal)
        .secret_key(key)
        .relay_mode(relay)
        .alpns(alpns)
        .hooks(DialPolicy { only: only_dial });
    // the addresses named are the ones bound: iroh's own default sockets would add IPv6 to a table
    // kept to IPv4
    if !bind_addrs.is_empty() {
        builder = builder.clear_ip_transports();
    }
    for addr in bind_addrs {
        builder = builder.bind_addr(*addr).map_err(|_| Unavailable::Network)?;
    }
    builder.bind().await.map_err(|e| {
        log::warn!("table link: the endpoint did not bind: {e}");
        Unavailable::Network
    })
}

/// A lock whose holder panicked still guards a table; the table goes on.
fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Ends its task when it is dropped.
struct TaskGuard(tokio::task::JoinHandle<()>);

impl Drop for TaskGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// The frames of a stream, read by a task of their own: a frame half-read when something else
/// needs attention would leave the stream unreadable, so the reading is never the thing cancelled.
fn read_frames<T>(
    mut stream: RecvStream,
    cap: usize,
) -> (mpsc::Receiver<Result<T, FrameError>>, TaskGuard)
where
    T: for<'de> Deserialize<'de> + Send + 'static,
{
    let (found, frames) = mpsc::channel(1);
    let reading = tokio::spawn(async move {
        loop {
            let frame = wire::read_frame::<T>(&mut stream, cap).await;
            let last = frame.is_err();
            if found.send(frame).await.is_err() || last {
                return;
            }
            sleep(FRAME_PACE).await;
        }
    });
    (frames, TaskGuard(reading))
}

// ---------------------------------------------------------------------------------------------
// The GM's side
// ---------------------------------------------------------------------------------------------

struct SeatHandle {
    /// Which connection of this key the seat is: a player who dials again replaces the old one.
    generation: u64,
    outbound: mpsc::Sender<GmFrame>,
    /// Closed when the seat is taken away or replaced, so a peer that stopped reading cannot keep
    /// a seat its goodbye never reached.
    conn: Connection,
}

struct GmShared {
    table: String,
    name: String,
    gm: EndpointId,
    relay: Option<RelayUrl>,
    addrs: Vec<SocketAddr>,
    /// The secret an invitation must carry while joining is open; None while the door is shut.
    door: Mutex<Option<String>>,
    /// The keys the GM let in. One of them is seated again without being asked about.
    allowed: Mutex<HashSet<EndpointId>>,
    seats: Mutex<HashMap<EndpointId, SeatHandle>>,
    generations: AtomicU64,
    waiting: Semaphore,
    /// One question to the GM at a time.
    asking: tokio::sync::Mutex<()>,
    emit: Emit,
    approve: Approve,
    /// The GM's key at this table, which signs the GM's records.
    key: SecretKey,
    log: Mutex<Log>,
    /// The name each key was let in under: the name its records are handed on with.
    names: Mutex<HashMap<EndpointId, String>>,
    /// How far each seat's clock runs behind the GM's, as last measured.
    skews: Mutex<HashMap<EndpointId, i64>>,
    keep: Keeper,
}

/// A record as the page is told it: its time moved onto the GM's clock, so every app at the table
/// orders it the same whatever its author's clock says. The signed text keeps the author's own.
fn on_table_clock(mut record: Record, skew: i64) -> Record {
    record.at = records::on_gm_clock(record.at, skew);
    record
}

/// How often a seat says its clock again: a clock the system sets mid-session, or a laptop that
/// slept without dropping the connection, would otherwise keep the skew measured when it sat.
const CLOCK_EVERY: Duration = Duration::from_secs(300);

/// This build's Charnik, said in a hello and in a refusal for version.
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// May this seat be handed this record? A roll kept to the GM reaches its roller and nobody else.
fn visible_to(record: &Record, seat: &str) -> bool {
    match &record.body {
        Body::Ask { participant, .. } => participant == seat,
        Body::Answer { .. }
        | Body::Roll {
            to: Audience::Gm, ..
        } => record.author == seat,
        _ => true,
    }
}

impl GmShared {
    fn name_of(&self, author: &str) -> Option<String> {
        let id: EndpointId = author.parse().ok()?;
        locked(&self.names).get(&id).cloned()
    }

    /// Take a record into the log — the GM's own, or one a seat (`from`) handed over — and hand
    /// it on to every other seat that may see it. A record whose author is not at the table, or a
    /// hide its author may not make, is not kept.
    fn offer(&self, signed: Signed, from: Option<EndpointId>) {
        let gm = self.gm.to_string();
        let Some(record) = records::verify(&signed, &gm) else {
            return;
        };
        let at_table = record.author == gm
            || record
                .author
                .parse()
                .is_ok_and(|author: EndpointId| locked(&self.allowed).contains(&author));
        // a seat hands over only what it wrote: its author holds every record of its own, so a copy
        // from anyone else is only that author's record again
        let own = from.is_none_or(|sender| sender.to_string() == record.author);
        let may = match &record.body {
            Body::Hide { author, .. } => records::may_hide(&record.author, &gm, author),
            _ => true,
        };
        let skew = from.map_or(0, |sender| {
            locked(&self.skews).get(&sender).copied().unwrap_or(0)
        });
        let kept = {
            let mut log = locked(&self.log);
            if !at_table || !own || !may || log.holds(&record.author, record.seq) {
                return;
            }
            // an answer to an ask this app made of that seat is at most one per ask, so it is not
            // the flood the pace is for, and dropping it would leave the ask unanswered here
            let answers_an_ask = matches!(&record.body, Body::Answer { request_id, .. }
                if log.can_answer(&record.author, request_id));
            if from.is_some_and(|sender| !answers_an_ask && !log.within_pace(&sender.to_string())) {
                return;
            }
            log.keep(record.clone(), signed.clone(), skew)
        };
        if kept != Kept::New {
            return;
        }
        let name = self.name_of(&record.author);
        (self.keep)(Keep::Record(Held {
            record: signed.clone(),
            name: name.clone(),
            skew,
        }));
        if let Body::Answer { request_id, answer } = &record.body {
            (self.emit)(TableEvent::Answer {
                table: self.table.clone(),
                participant: record.author.clone(),
                request_id: request_id.clone(),
                answer: answer.clone(),
            });
        }
        (self.emit)(TableEvent::Record {
            table: self.table.clone(),
            mine: record.author == gm,
            record: on_table_clock(record.clone(), skew),
            name: name.clone(),
        });
        if record.body.is_history() {
            return;
        }
        let seats: Vec<_> = locked(&self.seats)
            .iter()
            .filter(|(seat, _)| Some(**seat) != from && seat.to_string() != record.author)
            .filter(|(seat, _)| visible_to(&record, &seat.to_string()))
            .map(|(_, handle)| handle.outbound.clone())
            .collect();
        for seat in seats {
            let _ = seat.try_send(GmFrame::Record {
                record: signed.clone(),
                name: name.clone(),
                skew,
            });
        }
    }

    fn invite(&self, secret: String) -> String {
        Invite {
            v: INVITE_VERSION,
            id: self.gm.to_string(),
            relay: self.relay.as_ref().map(ToString::to_string),
            addrs: self.addrs.clone(),
            secret,
            name: self.name.clone(),
        }
        .to_text()
    }

    fn knocks(&self, secret: &str) -> bool {
        locked(&self.door)
            .as_deref()
            .is_some_and(|door| wire::same_secret(door, secret))
    }

    /// May this key sit, and under what name? A key already let in may, under the name the GM
    /// let it in by — a hello cannot rename it. Anyone else needs the open door's secret, a free
    /// seat, and the GM's yes — asked one at a time, in a window the page cannot answer.
    async fn admit(&self, player: EndpointId, hello: &HelloSaid) -> Result<String, Refusal> {
        let HelloSaid {
            protocol,
            secret,
            name,
            version,
        } = hello;
        let (protocol, secret, name) = (*protocol, secret.as_str(), name.as_str());
        if protocol != PROTOCOL {
            // only somebody let in or holding the invitation: a stranger's hello is not the GM's
            // to read about
            if locked(&self.allowed).contains(&player) || self.knocks(secret) {
                let name = self
                    .name_of(&player.to_string())
                    .unwrap_or_else(|| name.to_string());
                (self.emit)(TableEvent::VersionRefused {
                    table: self.table.clone(),
                    name,
                    version: wire::plain_text(version),
                    player_newer: protocol > PROTOCOL,
                });
            }
            return Err(Refusal::Version);
        }
        if locked(&self.allowed).contains(&player) {
            return Ok(self
                .name_of(&player.to_string())
                .unwrap_or_else(|| name.to_string()));
        }
        if name.is_empty() || !self.knocks(secret) {
            return Err(Refusal::Invite);
        }
        if locked(&self.allowed).len() >= MAX_SEATS {
            return Err(Refusal::Full);
        }
        let _waiting = self.waiting.try_acquire().map_err(|_| Refusal::Full)?;
        let _asking = self.asking.lock().await;
        // the door may have shut while this one waited its turn
        if !self.knocks(secret) {
            return Err(Refusal::Invite);
        }
        let asked = JoinRequest {
            table: self.name.clone(),
            player: name.to_string(),
            code: wire::join_code(player.as_bytes()),
        };
        if !(self.approve)(asked).await {
            return Err(Refusal::Declined);
        }
        locked(&self.allowed).insert(player);
        locked(&self.names).insert(player, name.to_string());
        (self.keep)(Keep::LetIn {
            key: player,
            name: name.to_string(),
        });
        Ok(name.to_string())
    }
}

/// What a hello said, as the GM's app reads it.
struct HelloSaid {
    protocol: u32,
    secret: String,
    name: String,
    version: String,
}

/// Write the last frame of a connection and give the other side a moment to read it and hang up.
async fn say_goodbye(mut send: iroh::endpoint::SendStream, conn: &Connection, frame: &GmFrame) {
    if wire::write_frame(&mut send, frame, GM_FRAME_CAP)
        .await
        .is_ok()
    {
        let _ = send.finish();
        let _ = timeout(GOODBYE_WAIT, conn.closed()).await;
    }
}

/// One player's connection, from its hello to its end.
async fn seat_player(
    conn: Connection,
    shared: Arc<GmShared>,
    greeting: Option<tokio::sync::OwnedSemaphorePermit>,
) {
    let player = conn.remote_id();
    let Ok(Ok((mut send, mut recv))) = timeout(HELLO_WAIT, conn.accept_bi()).await else {
        return;
    };
    let hello = timeout(HELLO_WAIT, wire::read_frame::<Value>(&mut recv, HELLO_CAP)).await;
    let Ok(Ok(hello)) = hello else {
        return;
    };
    let said = match serde_json::from_value::<PlayerFrame>(hello.clone()) {
        Ok(PlayerFrame::Hello {
            protocol,
            secret,
            name,
            version,
        }) => HelloSaid {
            protocol,
            secret,
            name,
            version,
        },
        Ok(_) => return,
        // another protocol's hello is read loosely, only to tell it why it is turned away
        Err(_) => match serde_json::from_value::<wire::LooseHello>(hello) {
            Ok(loose) if loose.frame == "hello" && loose.protocol != PROTOCOL => HelloSaid {
                protocol: loose.protocol,
                secret: loose.secret,
                name: loose.name,
                version: loose.version,
            },
            _ => return,
        },
    };
    let said = HelloSaid {
        name: wire::plain_text(&said.name),
        ..said
    };
    // the hello is said: what waits from here is counted by `admit`
    drop(greeting);
    let name = match shared.admit(player, &said).await {
        Ok(name) => name,
        Err(reason) => {
            let refused = GmFrame::Refused {
                reason,
                gm: (reason == Refusal::Version).then(|| wire::GmSpeaks {
                    protocol: PROTOCOL,
                    version: APP_VERSION.to_string(),
                }),
            };
            say_goodbye(send, &conn, &refused).await;
            return;
        }
    };
    let welcome = GmFrame::Welcome {
        table: shared.name.clone(),
    };
    if wire::write_frame(&mut send, &welcome, GM_FRAME_CAP)
        .await
        .is_err()
    {
        return;
    }

    let participant = player.to_string();
    let (outbound, mut outgoing) = mpsc::channel(OUTBOUND_QUEUE);
    // what this app holds, so the player's app hands over what it lacks
    let _ = outbound.try_send(GmFrame::Have {
        have: locked(&shared.log).have_for(|record| visible_to(record, &participant)),
    });
    let generation = shared.generations.fetch_add(1, Ordering::Relaxed);
    let replaced = locked(&shared.seats).insert(
        player,
        SeatHandle {
            generation,
            outbound,
            conn: conn.clone(),
        },
    );
    if let Some(older) = replaced {
        older.conn.close(0u32.into(), b"");
    }
    (shared.emit)(TableEvent::ParticipantJoined {
        table: shared.table.clone(),
        participant: Participant {
            id: participant.clone(),
            name,
        },
    });

    let (mut frames, _reading) = read_frames::<PlayerFrame>(recv, VIEW_CAP);
    let mut view = Map::new();
    let goodbye = loop {
        tokio::select! {
            frame = frames.recv() => match frame {
                Some(Ok(PlayerFrame::View { set, unset })) => {
                    if !wire::merge_view(&mut view, set, &unset) {
                        break None;
                    }
                    (shared.emit)(TableEvent::View {
                        table: shared.table.clone(),
                        participant: participant.clone(),
                        view: Value::Object(view.clone()),
                    });
                }
                Some(Ok(PlayerFrame::Clock { now })) => {
                    let skew = i64::try_from(i128::from(records::now_ms()) - i128::from(now))
                        .unwrap_or(0);
                    locked(&shared.skews).insert(player, skew);
                    if wire::write_frame(&mut send, &GmFrame::Clock { skew }, GM_FRAME_CAP)
                        .await
                        .is_err()
                    {
                        break None;
                    }
                }
                Some(Ok(PlayerFrame::Record { record })) => shared.offer(record, Some(player)),
                Some(Ok(PlayerFrame::Have { have })) if have.len() <= records::AUTHORS_MAX => {
                    let missing = locked(&shared.log)
                        .missing(&have, |record| visible_to(record, &participant));
                    let gm = shared.gm.to_string();
                    let mut failed = false;
                    for (record, skew) in missing {
                        let name = records::verify(&record, &gm)
                            .and_then(|kept| shared.name_of(&kept.author));
                        let frame = GmFrame::Record { record, name, skew };
                        if wire::write_frame(&mut send, &frame, GM_FRAME_CAP).await.is_err() {
                            failed = true;
                            break;
                        }
                    }
                    if failed {
                        break None;
                    }
                }
                // the connection ended, or the peer stopped speaking the protocol
                _ => break None,
            },
            frame = outgoing.recv() => match frame {
                Some(frame @ GmFrame::Closed { .. }) => break Some(frame),
                Some(frame) => {
                    if wire::write_frame(&mut send, &frame, GM_FRAME_CAP).await.is_err() {
                        break None;
                    }
                }
                // a newer connection of the same key took the seat, or the table closed
                None => break None,
            },
        }
    };

    let was_the_seat = {
        let mut seats = locked(&shared.seats);
        let still = seats
            .get(&player)
            .is_some_and(|seat| seat.generation == generation);
        if still {
            seats.remove(&player);
        }
        still
    };
    if was_the_seat {
        (shared.emit)(TableEvent::ParticipantLeft {
            table: shared.table.clone(),
            participant,
        });
    }
    if let Some(frame) = goodbye {
        say_goodbye(send, &conn, &frame).await;
    }
}

/// A table this app hosts.
pub struct GmTable {
    pub id: String,
    /// Opened again on IPv4 alone, its saved IPv6 port no longer binding: players who reached it
    /// over IPv6 need a new invitation.
    pub without_ipv6: bool,
    endpoint: Endpoint,
    shared: Arc<GmShared>,
    _accepting: TaskGuard,
}

/// Open a table: bind an endpoint, wait for its relay if it has one, and start letting people
/// knock. Answers the table and the first invitation to it.
pub async fn host(
    table: String,
    name: &str,
    relay: &RelaySetting,
    emit: Emit,
    approve: Approve,
    keep: Keeper,
    again: Option<Again>,
) -> Result<(GmTable, Option<String>), Unavailable> {
    let name = wire::plain_text(name);
    if name.is_empty() {
        return Err(Unavailable::BadName);
    }
    let mode = relay.mode().ok_or(Unavailable::BadRelay)?;
    let relayed = mode != RelayMode::Disabled;
    let key = again
        .as_ref()
        .map_or_else(SecretKey::generate, |again| again.key.clone());
    let ipv4_only = matches!(
        relay,
        RelaySetting::None {
            addresses: AddressFamilies::Ipv4
        }
    );
    let saved: Vec<SocketAddr> = again
        .as_ref()
        .filter(|_| !relayed)
        .map_or_else(Vec::new, |again| again.bind_addrs.clone());
    let wanted: Vec<SocketAddr> = match (ipv4_only, saved.is_empty()) {
        (true, true) => vec![ANY_IPV4],
        (true, false) => saved.iter().copied().filter(SocketAddr::is_ipv4).collect(),
        (false, _) => saved,
    };
    let (endpoint, without_ipv6) =
        match bind(key.clone(), mode.clone(), EndpointRole::Gm, &wanted).await {
            Ok(endpoint) => (endpoint, false),
            // a saved IPv6 port that no longer binds — IPv6 switched off since — returns the table on
            // its IPv4 port rather than not at all; a busy IPv4 port still refuses, as a busy port does
            Err(_) if wanted.iter().any(SocketAddr::is_ipv6) => {
                let ipv4: Vec<SocketAddr> =
                    wanted.iter().copied().filter(SocketAddr::is_ipv4).collect();
                let ipv4 = if ipv4.is_empty() {
                    vec![ANY_IPV4]
                } else {
                    ipv4
                };
                (
                    bind(key.clone(), mode, EndpointRole::Gm, &ipv4).await?,
                    true,
                )
            }
            Err(unavailable) => return Err(unavailable),
        };
    if relayed && timeout(RELAY_WAIT, endpoint.online()).await.is_err() {
        endpoint.close().await;
        return Err(Unavailable::RelayUnreachable);
    }
    let addr = endpoint.addr();
    let relay = addr.relay_urls().next().cloned();
    // an invitation names the relay OR this machine's addresses, never both: the addresses of a
    // home network are not something to paste into a chat when a relay already finds the table
    let addrs: Vec<SocketAddr> = if relayed {
        vec![]
    } else {
        addr.ip_addrs()
            .copied()
            .filter(|addr| addr.is_ipv4() || !(ipv4_only || without_ipv6))
            .collect()
    };
    let Ok(secret) = wire::new_secret() else {
        endpoint.close().await;
        return Err(Unavailable::Network);
    };
    if relay.is_none() && addrs.is_empty() {
        endpoint.close().await;
        return Err(Unavailable::Network);
    }

    let shared = Arc::new(GmShared {
        table: table.clone(),
        name,
        gm: endpoint.id(),
        relay,
        addrs,
        // a table opened again keeps its door shut until the GM opens it: the invitations handed
        // out before the app went down should not still knock
        door: Mutex::new(again.is_none().then(|| secret.clone())),
        allowed: Mutex::default(),
        seats: Mutex::default(),
        generations: AtomicU64::new(0),
        waiting: Semaphore::new(MAX_WAITING),
        asking: tokio::sync::Mutex::default(),
        emit,
        approve,
        log: Mutex::new(Log::default()),
        names: Mutex::default(),
        skews: Mutex::default(),
        key,
        keep,
    });
    if let Some(again) = again {
        for (player, name) in again.allowed {
            locked(&shared.allowed).insert(player);
            locked(&shared.names).insert(player, name);
        }
        let gm = shared.gm.to_string();
        for Held {
            record: signed,
            name,
            skew,
        } in again.records
        {
            let Some(record) = records::verify(&signed, &gm) else {
                continue;
            };
            if locked(&shared.log).keep(record.clone(), signed, skew) == Kept::New {
                (shared.emit)(TableEvent::Record {
                    table: shared.table.clone(),
                    mine: record.author == gm,
                    record: on_table_clock(record, skew),
                    name,
                });
            }
        }
    }
    let accepting = tokio::spawn({
        let (endpoint, shared) = (endpoint.clone(), shared.clone());
        async move {
            let handshakes = Arc::new(Semaphore::new(MAX_HANDSHAKES));
            let greeting = Arc::new(Semaphore::new(MAX_GREETING));
            while let Some(incoming) = endpoint.accept().await {
                let Ok(handshake) = handshakes.clone().try_acquire_owned() else {
                    incoming.refuse();
                    continue;
                };
                let (shared, greeting) = (shared.clone(), greeting.clone());
                tokio::spawn(async move {
                    let Ok(Ok(conn)) = timeout(HELLO_WAIT, incoming).await else {
                        return;
                    };
                    drop(handshake);
                    let known = locked(&shared.allowed).contains(&conn.remote_id());
                    let knocked = locked(&shared.door).as_deref().is_some_and(|secret| {
                        wire::knocks(secret, shared.gm.as_bytes(), conn.remote_id().as_bytes())
                    });
                    let permit = if known {
                        None
                    } else if !knocked {
                        // a shut door, or a key that did not do the work the open door asks of a
                        // stranger: either way the invitation it came with does not open this door
                        conn.close(DOOR_SHUT.into(), b"");
                        return;
                    } else if let Ok(permit) = greeting.try_acquire_owned() {
                        Some(permit)
                    } else {
                        conn.close(0u32.into(), b"");
                        return;
                    };
                    seat_player(conn, shared, permit).await;
                });
            }
        }
    });
    let invite = locked(&shared.door)
        .is_some()
        .then(|| shared.invite(secret));
    log::info!("table link: a table is open");
    Ok((
        GmTable {
            id: table,
            without_ipv6,
            endpoint,
            shared,
            _accepting: TaskGuard(accepting),
        },
        invite,
    ))
}

impl GmTable {
    /// The key this table is opened under: kept, it opens the same table again.
    pub fn key(&self) -> &SecretKey {
        &self.shared.key
    }

    pub fn bind_addrs(&self) -> Vec<SocketAddr> {
        if self.shared.relay.is_some() {
            vec![]
        } else {
            self.endpoint.bound_sockets()
        }
    }

    fn seat_of(&self, participant: &str) -> Option<mpsc::Sender<GmFrame>> {
        let player: EndpointId = participant.parse().ok()?;
        locked(&self.shared.seats)
            .get(&player)
            .map(|seat| seat.outbound.clone())
    }

    pub fn request(
        &self,
        participant: &str,
        request_id: String,
        request: TableRequest,
    ) -> Delivery {
        if !wire::is_request_id(&request_id) || !request.is_bounded() {
            return Delivery::NotDelivered;
        }
        let Some(seat) = self.seat_of(participant) else {
            return Delivery::NotDelivered;
        };
        let body = Body::Ask {
            participant: participant.to_string(),
            name: self.participant_name(participant),
            request_id,
            request,
        };
        let Some(record) = self.sign_record(body) else {
            return Delivery::NotDelivered;
        };
        if seat
            .try_send(GmFrame::Request {
                record: record.clone(),
            })
            .is_err()
        {
            return Delivery::NotDelivered;
        }
        self.shared.offer(record, None);
        Delivery::Delivered
    }

    /// Write a record as the GM: keep it, and hand it to every seat that may see it.
    pub fn record(&self, body: Body) -> Delivery {
        if body.is_history() {
            return Delivery::NotDelivered;
        }
        let Some(signed) = self.sign_record(body) else {
            return Delivery::NotDelivered;
        };
        self.shared.offer(signed, None);
        Delivery::Delivered
    }

    fn sign_record(&self, body: Body) -> Option<Signed> {
        let shared = &self.shared;
        let gm = shared.gm.to_string();
        let record = {
            let log = locked(&shared.log);
            let (body, at) = log.as_written(&gm, body)?;
            Record {
                table: gm.clone(),
                author: gm.clone(),
                seq: log.next_seq(&gm),
                at,
                body,
            }
        };
        records::sign(&shared.key, &record)
    }

    /// Take a seat away, and the key's right to sit again without being asked about.
    /// A participant as a question names them: the name they were let in under, else their key.
    pub fn participant_name(&self, participant: &str) -> String {
        participant
            .parse::<EndpointId>()
            .ok()
            .and_then(|key| locked(&self.shared.names).get(&key).cloned())
            .unwrap_or_else(|| participant.to_string())
    }

    pub fn dismiss(&self, participant: &str) {
        if let Ok(player) = participant.parse::<EndpointId>() {
            locked(&self.shared.allowed).remove(&player);
            (self.shared.keep)(Keep::SentAway { key: player });
        }
        let Ok(player) = participant.parse::<EndpointId>() else {
            return;
        };
        let Some(conn) = locked(&self.shared.seats).get(&player).map(|seat| {
            let _ = seat.outbound.try_send(GmFrame::Closed {
                reason: Goodbye::Dismissed,
            });
            seat.conn.clone()
        }) else {
            return;
        };
        // the goodbye is given a moment to be read; a peer that is not reading is cut off anyway
        tokio::spawn(async move {
            sleep(GOODBYE_WAIT * 2).await;
            conn.close(0u32.into(), b"");
        });
    }

    /// Open the door under a fresh secret and answer the invitation that carries it, or shut it.
    /// Every invitation handed out before stops working either way.
    pub fn set_door(&self, open: bool) -> Option<String> {
        let secret = if open { wire::new_secret().ok() } else { None };
        *locked(&self.shared.door) = secret.clone();
        secret.map(|secret| self.shared.invite(secret))
    }

    /// End the table: every seat is told, and the endpoint closes.
    pub async fn close(self) {
        let seats: Vec<_> = locked(&self.shared.seats)
            .values()
            .map(|seat| seat.outbound.clone())
            .collect();
        for seat in &seats {
            let _ = seat.try_send(GmFrame::Closed {
                reason: Goodbye::TableClosed,
            });
        }
        if !seats.is_empty() {
            sleep(GOODBYE_WAIT).await;
        }
        self.endpoint.close().await;
        log::info!("table link: the table is closed");
    }
}

// ---------------------------------------------------------------------------------------------
// The player's side
// ---------------------------------------------------------------------------------------------

enum Outgoing {
    View(Map<String, Value>),
    /// One of this app's records was written: the send pace takes it from the log in its turn.
    Written,
    /// An answer to the GM's ask, which does not wait its turn.
    Answer(Signed),
}

struct PlayerShared {
    table: String,
    /// The GM's key: the table a record names.
    gm: String,
    /// This app's key at the table, which signs its records.
    key: SecretKey,
    log: Mutex<Log>,
    keep: Keeper,
    /// The way to the GM while a connection is seated, and None while there is none.
    outbound: Mutex<Option<mpsc::Sender<Outgoing>>>,
    /// The person asked for a dial now, in place of the wait before the next one.
    dial_now: Notify,
    emit: Emit,
    /// How far this app's clock runs behind the GM's, as the GM last measured it.
    skew: AtomicI64,
    /// Whether any GM's app has measured it yet: this app's records written before are placed again
    /// once it has.
    skew_known: AtomicBool,
    /// The numbers of this app's own records written before the skew was known.
    untimed: Mutex<Vec<u64>>,
    /// What the GM handed over is believed for the GM's sake, but this app's disk is its own to
    /// pace: records wait here, in the order they came, until the pace lets them be written.
    disk: Mutex<DiskPace>,
    /// A later write of what is waiting is already on its way.
    disk_later: AtomicBool,
}

/// How many records a player's app writes to disk per `DISK_WINDOW`. What waits past that is shown
/// and held at once, and written as the pace allows; past `records::LOG_MAX` waiting, the oldest
/// is dropped, as the file's own compaction would drop it.
const DISK_MAX: usize = 60;
const DISK_WINDOW: Duration = Duration::from_secs(10);

#[derive(Default)]
struct DiskPace {
    waiting: VecDeque<Held>,
    written: VecDeque<Instant>,
}

impl DiskPace {
    /// The records the pace lets be written now, oldest first.
    fn due(&mut self, now: Instant) -> Vec<Held> {
        while self
            .written
            .front()
            .is_some_and(|at| now.duration_since(*at) > DISK_WINDOW)
        {
            self.written.pop_front();
        }
        let room = DISK_MAX
            .saturating_sub(self.written.len())
            .min(self.waiting.len());
        self.written.extend(std::iter::repeat_n(now, room));
        self.waiting.drain(..room).collect()
    }
}

impl PlayerShared {
    /// Write what the pace allows of what waits, and come back for the rest once it allows more.
    fn write_waiting(self: &Arc<Self>) {
        let (due, more) = {
            let mut disk = locked(&self.disk);
            let due = disk.due(Instant::now());
            (due, !disk.waiting.is_empty())
        };
        for held in due {
            (self.keep)(Keep::Record(held));
        }
        if more && !self.disk_later.swap(true, Ordering::AcqRel) {
            let shared = self.clone();
            tokio::spawn(async move {
                sleep(DISK_WINDOW).await;
                shared.disk_later.store(false, Ordering::Release);
                shared.write_waiting();
            });
        }
    }

    /// Keep a record the GM handed over, if it is this table's and signed by its author, and write
    /// it to disk as the pace allows.
    fn take(self: &Arc<Self>, signed: Signed, name: Option<String>, skew: i64) -> bool {
        let Some(kept) = self.hold(signed, name, skew) else {
            return false;
        };
        {
            let mut disk = locked(&self.disk);
            disk.waiting.push_back(kept);
            if disk.waiting.len() > records::LOG_MAX {
                disk.waiting.pop_front();
            }
        }
        self.write_waiting();
        true
    }

    /// Keep a record in memory and tell the page, handing back what a disk write of it is. None
    /// when it is not this table's, not its author's, or held already.
    fn hold(&self, signed: Signed, name: Option<String>, skew: i64) -> Option<Held> {
        let record = records::verify(&signed, &self.gm)?;
        let me = self.key.public().to_string();
        if record.body.is_history() && !visible_to(&record, &me) {
            return None;
        }
        if locked(&self.log).keep(record.clone(), signed.clone(), skew) != Kept::New {
            return None;
        }
        let name = (record.author != self.gm)
            .then(|| name.map(|name| wire::plain_text(&name)))
            .flatten();
        if !record.body.is_history() {
            (self.emit)(TableEvent::Record {
                table: self.table.clone(),
                mine: record.author == me,
                record: on_table_clock(record, skew),
                name: name.clone(),
            });
        }
        Some(Held {
            record: signed,
            name,
            skew,
        })
    }

    /// The GM's app says how far this app's clock is off: kept for what this app writes next, and
    /// the records it wrote before anyone had measured it are placed on the GM's clock now — on
    /// this screen, and on its disk, where the later line for a record is the one read back.
    fn learn_skew(&self, skew: i64) {
        self.skew.store(skew, Ordering::Relaxed);
        if self.skew_known.swap(true, Ordering::Relaxed) {
            return;
        }
        let me = self.key.public().to_string();
        let untimed = std::mem::take(&mut *locked(&self.untimed));
        for seq in untimed {
            let Some((record, signed)) = locked(&self.log).retime(&me, seq, skew) else {
                continue;
            };
            (self.keep)(Keep::Record(Held {
                record: signed,
                name: None,
                skew,
            }));
            if !record.body.is_history() {
                (self.emit)(TableEvent::Record {
                    table: self.table.clone(),
                    mine: true,
                    record: on_table_clock(record, skew),
                    name: None,
                });
            }
        }
    }

    fn says(&self, state: ConnectionState, reason: Option<CloseReason>) {
        self.says_gap(state, reason, None);
    }

    fn says_gap(
        &self,
        state: ConnectionState,
        reason: Option<CloseReason>,
        gm_version: Option<VersionGap>,
    ) {
        (self.emit)(TableEvent::Connection {
            table: Some(self.table.clone()),
            state,
            reason,
            gm_version,
        });
    }
}

/// How one connection to the GM ended.
enum SeatEnd {
    /// For good: dialling again would be answered the same way.
    Gone(CloseReason),
    /// For good, refused for its version, with the GM's Charnik.
    OtherVersion(VersionGap),
    /// The connection failed or dropped. `seated` says whether the GM had let it in.
    Dropped { seated: bool },
}

struct Hello {
    secret: String,
    name: String,
}

/// A key that knocks at this door (`wire::knocks`): tried until one does. A seat keeps the key it
/// was let in under, so this is paid once per table joined.
fn knocking_key(secret: &str, gm: &EndpointId) -> SecretKey {
    loop {
        let key = SecretKey::generate();
        if wire::knocks(secret, gm.as_bytes(), key.public().as_bytes()) {
            return key;
        }
    }
}

/// One connection: dial, say hello, wait to be let in, then carry views and answers out and
/// requests in until it ends.
async fn sit(
    endpoint: &Endpoint,
    gm: &EndpointAddr,
    hello: &Hello,
    shared: &Arc<PlayerShared>,
) -> SeatEnd {
    let dropped = SeatEnd::Dropped { seated: false };
    let Ok(Ok(conn)) = timeout(CONNECT_WAIT, endpoint.connect(gm.clone(), ALPN)).await else {
        return dropped;
    };
    // a GM that closed this connection at a shut door said so in its close code
    let ended = |conn: &Connection| match conn.close_reason() {
        Some(iroh::endpoint::ConnectionError::ApplicationClosed(close))
            if close.error_code == DOOR_SHUT.into() =>
        {
            SeatEnd::Gone(CloseReason::Invite)
        }
        _ => SeatEnd::Dropped { seated: false },
    };
    let Ok((mut send, recv)) = conn.open_bi().await else {
        return ended(&conn);
    };
    let frame = PlayerFrame::Hello {
        protocol: PROTOCOL,
        secret: hello.secret.clone(),
        name: hello.name.clone(),
        version: APP_VERSION.to_string(),
    };
    if wire::write_frame(&mut send, &frame, HELLO_CAP)
        .await
        .is_err()
    {
        return ended(&conn);
    }
    shared.says(ConnectionState::Waiting, None);

    let (mut frames, _reading) = read_frames::<GmFrame>(recv, GM_FRAME_CAP);
    match timeout(APPROVAL_WAIT, frames.recv()).await {
        Ok(Some(Ok(GmFrame::Welcome { .. }))) => {}
        Ok(Some(Ok(GmFrame::Refused {
            reason: Refusal::Version,
            gm: Some(gm),
        }))) => {
            return SeatEnd::OtherVersion(VersionGap {
                version: wire::plain_text(&gm.version),
                newer: gm.protocol > PROTOCOL,
            })
        }
        Ok(Some(Ok(GmFrame::Refused { reason, .. }))) => return SeatEnd::Gone(reason.into()),
        Ok(Some(Ok(_) | Err(FrameError::Malformed | FrameError::TooLarge))) => {
            return SeatEnd::Gone(CloseReason::Protocol)
        }
        _ => return ended(&conn),
    }

    let (outbound, mut outgoing) = mpsc::channel(OUTBOUND_QUEUE);
    *locked(&shared.outbound) = Some(outbound);
    shared.says(ConnectionState::Connected, None);
    let dropped = SeatEnd::Dropped { seated: true };
    let me = shared.key.public().to_string();
    let clock = PlayerFrame::Clock {
        now: records::now_ms(),
    };
    let have = PlayerFrame::Have {
        have: locked(&shared.log).have(),
    };
    for frame in [clock, have] {
        if wire::write_frame(&mut send, &frame, VIEW_CAP)
            .await
            .is_err()
        {
            return dropped;
        }
    }
    // what the GM's app holds of the view, so only what changed is sent
    let mut sent = Map::new();
    // the number of this app's next own record to hand over: the log is the queue, so a record is
    // handed over once however it came to be due. Unknown until the GM's app says what it holds.
    let mut next_out: Option<u64> = None;
    let mut pace = Bucket::new(SEND_PACE);
    let mut clock_again =
        tokio::time::interval_at(tokio::time::Instant::now() + CLOCK_EVERY, CLOCK_EVERY);
    loop {
        let next_turn = tokio::time::Instant::from_std(pace.next_at(Instant::now()));
        let due = next_out.is_some_and(|next| next < locked(&shared.log).next_seq(&me));
        tokio::select! {
            frame = frames.recv() => match frame {
                Some(Ok(GmFrame::Clock { skew })) => shared.learn_skew(skew),
                Some(Ok(GmFrame::Request { record })) => {
                    let Some(Record { body: Body::Ask { request_id, request, .. }, .. }) =
                        records::verify(&record, &shared.gm) else {
                            return SeatEnd::Gone(CloseReason::Protocol);
                        };
                    if shared.take(record, None, 0) {
                        (shared.emit)(TableEvent::Request {
                            table: shared.table.clone(),
                            request_id,
                            request,
                        });
                    }
                }
                Some(Ok(GmFrame::Record { record, name, skew })) => { shared.take(record, name, skew); }
                Some(Ok(GmFrame::Have { have })) if have.len() <= records::AUTHORS_MAX => {
                    // only this app's own: every author hands over what it wrote, and no other copy
                    let held = have.get(&me).copied().unwrap_or(0);
                    next_out = Some(next_out.unwrap_or(0).max(held + 1));
                }
                Some(Ok(GmFrame::Closed { reason })) => return SeatEnd::Gone(reason.into()),
                Some(Err(FrameError::Closed)) | None => return dropped,
                _ => return SeatEnd::Gone(CloseReason::Protocol),
            },
            out = outgoing.recv() => {
                let frame = match out {
                    Some(Outgoing::View(now)) => {
                        let (set, unset) = wire::view_changes(&sent, &now);
                        if set.is_empty() && unset.is_empty() {
                            continue;
                        }
                        sent = now;
                        PlayerFrame::View { set, unset }
                    }
                    Some(Outgoing::Written) => continue,
                    Some(Outgoing::Answer(record)) => PlayerFrame::Record { record },
                    // nothing holds the other end any more: this connection is no longer the seat
                    None => return dropped,
                };
                if wire::write_frame(&mut send, &frame, VIEW_CAP).await.is_err() {
                    return dropped;
                }
            },
            () = tokio::time::sleep_until(next_turn), if due => {
                while let Some(next) = next_out.filter(|next| *next < locked(&shared.log).next_seq(&me)) {
                    if !pace.take(Instant::now()) {
                        break;
                    }
                    next_out = Some(next + 1);
                    // one this app's own log already let go of is not handed over
                    let Some(record) = locked(&shared.log).signed(&me, next) else { continue };
                    if wire::write_frame(&mut send, &PlayerFrame::Record { record }, VIEW_CAP)
                        .await
                        .is_err()
                    {
                        return dropped;
                    }
                }
            },
            _ = clock_again.tick() => {
                let clock = PlayerFrame::Clock { now: records::now_ms() };
                if wire::write_frame(&mut send, &clock, VIEW_CAP).await.is_err() {
                    return dropped;
                }
            },
        }
    }
}

/// Hold a seat for as long as it can be held: a connection the GM had let in is dialled again
/// when it drops, for as long as the person keeps the seat, and one that never got in is not.
async fn keep_seat(endpoint: Endpoint, gm: EndpointAddr, hello: Hello, shared: Arc<PlayerShared>) {
    let mut seated_before = false;
    let mut failed = 0;
    let reason = loop {
        let state = if seated_before {
            ConnectionState::Reconnecting
        } else {
            ConnectionState::Connecting
        };
        shared.says(state, None);
        let end = sit(&endpoint, &gm, &hello, &shared).await;
        *locked(&shared.outbound) = None;
        match end {
            SeatEnd::Gone(reason) => break (reason, None),
            SeatEnd::OtherVersion(gap) => break (CloseReason::Version, Some(gap)),
            SeatEnd::Dropped { seated } => {
                if seated {
                    seated_before = true;
                    failed = 0;
                }
                if !seated_before {
                    break (CloseReason::Unreachable, None);
                }
                tokio::select! {
                    () = sleep(reconnect_pause(failed)) => failed += 1,
                    // asked for by hand, so the dials after it are frequent again
                    () = shared.dial_now.notified() => failed = 0,
                }
            }
        }
    };
    let (reason, gap) = reason;
    shared.says_gap(ConnectionState::Closed, Some(reason), gap);
    endpoint.close().await;
}

/// A seat this app holds at somebody else's table.
pub struct PlayerSeat {
    pub id: String,
    /// The digits the player reads to the GM.
    pub code: String,
    endpoint: Endpoint,
    shared: Arc<PlayerShared>,
    _sitting: TaskGuard,
}

/// Where an invitation leads, as an address iroh can dial.
fn address_of(invite: &Invite) -> Option<(EndpointAddr, Option<RelayUrl>)> {
    let gm: EndpointId = invite.id.parse().ok()?;
    let relay = match &invite.relay {
        Some(url) => Some(parse_relay(url)?),
        None => None,
    };
    let addrs = relay
        .iter()
        .cloned()
        .map(TransportAddr::Relay)
        .chain(invite.addrs.iter().copied().map(TransportAddr::Ip));
    Some((EndpointAddr::from_parts(gm, addrs), relay))
}

/// Is this an invitation the app could follow? Asked before the person is, so the question they
/// are put is about a table that exists.
pub fn is_followable(invite: &Invite) -> bool {
    address_of(invite).is_some()
}

/// Take a seat: bind an endpoint that may dial this invitation's GM and nobody else, and start
/// dialling. Answers at once — what becomes of the dial is told as `Connection` events.
pub async fn join(
    table: String,
    invite: &Invite,
    name: &str,
    emit: Emit,
    keep: Keeper,
    again: Option<Again>,
) -> Result<PlayerSeat, Unavailable> {
    let name = wire::plain_text(name);
    if name.is_empty() {
        return Err(Unavailable::BadName);
    }
    let (gm, relay) = address_of(invite).ok_or(Unavailable::BadInvite)?;
    let mode = relay.map_or(RelayMode::Disabled, |relay| RelayMode::custom([relay]));
    let key = match &again {
        Some(again) => again.key.clone(),
        None => {
            let (secret, door) = (invite.secret.clone(), gm.id);
            tokio::task::spawn_blocking(move || knocking_key(&secret, &door))
                .await
                .map_err(|_| Unavailable::Network)?
        }
    };
    let endpoint = bind(key.clone(), mode, EndpointRole::Player(gm.id), &[]).await?;
    let shared = Arc::new(PlayerShared {
        table: table.clone(),
        gm: gm.id.to_string(),
        key,
        log: Mutex::new(Log::default()),
        keep,
        outbound: Mutex::default(),
        dial_now: Notify::new(),
        emit,
        skew: AtomicI64::new(0),
        skew_known: AtomicBool::new(false),
        untimed: Mutex::default(),
        disk: Mutex::default(),
        disk_later: AtomicBool::new(false),
    });
    if let Some(again) = again {
        let me = shared.key.public().to_string();
        // read back from this app's own disk, so nothing to write again
        for Held { record, name, skew } in again.records {
            // until the GM measures it again, this app's clock is as far off as when it last wrote
            if records::verify(&record, &shared.gm).is_some_and(|kept| kept.author == me) {
                shared.skew.store(skew, Ordering::Relaxed);
                shared.skew_known.store(true, Ordering::Relaxed);
            }
            shared.hold(record, name, skew);
        }
    }
    let hello = Hello {
        secret: invite.secret.clone(),
        name,
    };
    let sitting = tokio::spawn(keep_seat(endpoint.clone(), gm, hello, shared.clone()));
    Ok(PlayerSeat {
        id: table,
        code: wire::join_code(endpoint.id().as_bytes()),
        endpoint,
        shared,
        _sitting: TaskGuard(sitting),
    })
}

impl PlayerSeat {
    /// The key this seat sits under: kept, it is the same seat at the table again.
    pub fn key(&self) -> &SecretKey {
        &self.shared.key
    }

    fn send(&self, out: Outgoing) -> Delivery {
        match locked(&self.shared.outbound).as_ref() {
            Some(outbound) if outbound.try_send(out).is_ok() => Delivery::Delivered,
            _ => Delivery::NotDelivered,
        }
    }

    /// Say what is true of the character now. A view too large to be one is not sent.
    pub fn publish(&self, view: Map<String, Value>) -> Delivery {
        let fits = serde_json::to_vec(&view).is_ok_and(|bytes| bytes.len() <= VIEW_CAP);
        if !fits {
            return Delivery::NotDelivered;
        }
        self.send(Outgoing::View(view))
    }

    pub fn respond(&self, request_id: String, answer: TableAnswer) -> Delivery {
        self.write_record(Body::Answer { request_id, answer })
    }

    /// Write a record as this player: keep it and show it here, and send it to the GM — now, or
    /// when the GM's app next says what it lacks.
    pub fn record(&self, body: Body) -> Delivery {
        if body.is_history() {
            return Delivery::NotDelivered;
        }
        self.write_record(body)
    }

    fn write_record(&self, body: Body) -> Delivery {
        let shared = &self.shared;
        let me = self.endpoint.id().to_string();
        let is_answer = matches!(body, Body::Answer { .. });
        let skew = shared.skew.load(Ordering::Relaxed);
        if let Body::Hide { author, .. } = &body {
            if !records::may_hide(&me, &shared.gm, author) {
                return Delivery::NotDelivered;
            }
        }
        let signed = {
            let mut log = locked(&shared.log);
            if let Body::Answer { request_id, .. } = &body {
                if !log.can_answer(&me, request_id) {
                    return Delivery::NotDelivered;
                }
            }
            let Some((body, at)) = log.as_written(&me, body) else {
                return Delivery::NotDelivered;
            };
            let record = Record {
                table: shared.gm.clone(),
                author: me.clone(),
                seq: log.next_seq(&me),
                at,
                body,
            };
            let Some(signed) = records::sign(&shared.key, &record) else {
                return Delivery::NotDelivered;
            };
            if log.keep(record.clone(), signed.clone(), skew) != Kept::New {
                return Delivery::NotDelivered;
            }
            if !shared.skew_known.load(Ordering::Relaxed) {
                locked(&shared.untimed).push(record.seq);
            }
            (shared.keep)(Keep::Record(Held {
                record: signed.clone(),
                name: None,
                skew,
            }));
            if !record.body.is_history() {
                (shared.emit)(TableEvent::Record {
                    table: shared.table.clone(),
                    record: on_table_clock(record, skew),
                    name: None,
                    mine: true,
                });
            }
            signed
        };
        self.send(if is_answer {
            Outgoing::Answer(signed)
        } else {
            Outgoing::Written
        })
    }

    /// Dial the table now instead of waiting out the pause. While a connection is up, or a dial
    /// is already on its way, the next pause is skipped instead.
    pub fn redial(&self) {
        self.shared.dial_now.notify_one();
    }

    /// Get up. The task holding the seat ends first, so the close is not taken for a drop and
    /// dialled again.
    pub async fn leave(self) {
        let Self {
            endpoint, _sitting, ..
        } = self;
        drop(_sitting);
        endpoint.close().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

    const EVENT_WAIT: Duration = Duration::from_secs(20);

    #[test]
    fn a_flood_from_the_gm_reaches_the_disk_at_its_pace_and_in_its_order() {
        let mut disk = DiskPace::default();
        for n in 0..DISK_MAX + 5 {
            let record = Signed {
                text: n.to_string(),
                sig: String::new(),
            };
            disk.waiting.push_back(Held {
                record,
                name: None,
                skew: 0,
            });
        }
        let now = Instant::now();
        let first = disk.due(now);
        assert_eq!(first.len(), DISK_MAX);
        assert_eq!(first[0].record.text, "0");
        assert!(disk.due(now).is_empty(), "nothing more inside the window");
        let later = disk.due(now + DISK_WINDOW + Duration::from_millis(1));
        assert_eq!(later.len(), 5);
        assert_eq!(later[0].record.text, DISK_MAX.to_string());
    }

    fn listening() -> (Emit, UnboundedReceiver<TableEvent>) {
        let (heard, events) = unbounded_channel();
        let emit: Emit = Arc::new(move |event| {
            let _ = heard.send(event);
        });
        (emit, events)
    }

    /// Who the GM was asked about: each player's name and code.
    type Asked = Arc<Mutex<Vec<(String, String)>>>;

    fn answering(answer: bool) -> (Approve, Asked) {
        let asked = Arc::new(Mutex::new(Vec::new()));
        let approve: Approve = Arc::new({
            let asked = asked.clone();
            move |request| {
                locked(&asked).push((request.player, request.code));
                Box::pin(async move { answer })
            }
        });
        (approve, asked)
    }

    /// The next event that is not about a connection changing state on the way to being seated.
    async fn next(events: &mut UnboundedReceiver<TableEvent>) -> TableEvent {
        loop {
            let event = timeout(EVENT_WAIT, events.recv())
                .await
                .expect("an event in time")
                .expect("the session is still there");
            let passing = matches!(
                event,
                TableEvent::Connection {
                    state: ConnectionState::Connecting | ConnectionState::Waiting,
                    ..
                }
            );
            if !passing {
                return event;
            }
        }
    }

    fn fresh_id() -> String {
        wire::new_local_id().expect("an id")
    }

    /// A keeper that keeps nothing: a table that is not to outlive the test.
    fn forgetting() -> Keeper {
        Arc::new(|_| {})
    }

    fn view(value: Value) -> Map<String, Value> {
        value.as_object().cloned().expect("an object")
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_player_the_gm_lets_in_is_seen_asked_and_answers() {
        let (gm_emit, mut gm_events) = listening();
        let (approve, asked) = answering(true);
        let (table, invite) = host(
            fresh_id(),
            "Thursday",
            &RelaySetting::None {
                addresses: AddressFamilies::Both,
            },
            gm_emit,
            approve,
            forgetting(),
            None,
        )
        .await
        .expect("a table");
        let invite = Invite::from_text(&invite.expect("an open door")).expect("its invitation");
        assert_eq!(invite.name, "Thursday");
        assert!(invite.relay.is_none() && !invite.addrs.is_empty());

        let (player_emit, mut player_events) = listening();
        let seat = join(fresh_id(), &invite, "Lira", player_emit, forgetting(), None)
            .await
            .expect("a seat");

        // the GM was asked about this player, by the name and the code the player's app shows
        assert!(matches!(
            next(&mut player_events).await,
            TableEvent::Connection {
                state: ConnectionState::Connected,
                ..
            }
        ));
        assert_eq!(
            *locked(&asked),
            vec![("Lira".to_string(), seat.code.clone())]
        );
        let TableEvent::ParticipantJoined { participant, .. } = next(&mut gm_events).await else {
            panic!("the GM hears the player join");
        };
        assert_eq!(participant.name, "Lira");

        // a view arrives whole, and a change to it arrives as the view it makes
        let first =
            view(json!({ "name": "Lira", "hp": { "current": 9 }, "skills": { "stealth": 5 } }));
        assert_eq!(seat.publish(first.clone()), Delivery::Delivered);
        let TableEvent::View { view: seen, .. } = next(&mut gm_events).await else {
            panic!("the GM sees the view");
        };
        assert_eq!(seen, Value::Object(first));
        let second = view(json!({ "name": "Lira", "hp": { "current": 4 } }));
        assert_eq!(seat.publish(second.clone()), Delivery::Delivered);
        let TableEvent::View { view: seen, .. } = next(&mut gm_events).await else {
            panic!("the GM sees the change");
        };
        assert_eq!(seen, Value::Object(second));

        // a request reaches the player and its answer the GM
        let request = TableRequest::Roll {
            roll: wire::RequestedRoll::SavingThrow,
            id: "dex".into(),
            dc: Some(15),
        };
        assert_eq!(
            table.request(&participant.id, "r-1".into(), request.clone()),
            Delivery::Delivered
        );
        let TableEvent::Request {
            request_id,
            request: got,
            ..
        } = next(&mut player_events).await
        else {
            panic!("the player is asked");
        };
        assert_eq!((request_id.as_str(), &got), ("r-1", &request));
        let answer = TableAnswer {
            outcome: wire::AnswerOutcome::Accepted,
            roll: Some(json!({ "total": 17 })),
        };
        assert_eq!(
            seat.respond(request_id, answer.clone()),
            Delivery::Delivered
        );
        let (request_id, got, from) = loop {
            if let TableEvent::Answer {
                request_id,
                answer,
                participant,
                ..
            } = next(&mut gm_events).await
            {
                break (request_id, answer, participant);
            }
        };
        assert_eq!(
            (request_id.as_str(), got, from),
            ("r-1", answer, participant.id.clone())
        );
        assert!(matches!(
            next_record(&mut gm_events).await.0.body,
            Body::Answer { .. }
        ));

        // nobody but a seated key is asked anything
        assert_eq!(
            table.request("nobody", "r-2".into(), request.clone()),
            Delivery::NotDelivered
        );
        // and a request that is not ids and bounded numbers does not leave
        let unbounded = TableRequest::Heal { amount: u32::MAX };
        assert_eq!(
            table.request(&participant.id, "r-3".into(), unbounded),
            Delivery::NotDelivered
        );

        // dismissed: the player is told why, and the GM hears them go
        table.dismiss(&participant.id);
        assert!(matches!(
            next(&mut player_events).await,
            TableEvent::Connection {
                state: ConnectionState::Closed,
                reason: Some(CloseReason::Dismissed),
                ..
            }
        ));
        assert!(matches!(
            next(&mut gm_events).await,
            TableEvent::ParticipantLeft { .. }
        ));
        assert_eq!(
            seat.publish(view(json!({ "name": "Lira" }))),
            Delivery::NotDelivered
        );

        seat.leave().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn nobody_sits_without_the_door_secret_and_the_gms_yes() {
        let (gm_emit, _gm_events) = listening();
        let (approve, asked) = answering(false);
        let (table, invite) = host(
            fresh_id(),
            "Thursday",
            &RelaySetting::None {
                addresses: AddressFamilies::Both,
            },
            gm_emit,
            approve,
            forgetting(),
            None,
        )
        .await
        .expect("a table");
        let invite = Invite::from_text(&invite.expect("an open door")).expect("its invitation");
        let closed_for = |event: TableEvent| match event {
            TableEvent::Connection {
                state: ConnectionState::Closed,
                reason,
                ..
            } => reason,
            other => panic!("expected the seat to close, heard {other:?}"),
        };

        // the right secret, and the GM says no
        let (emit, mut events) = listening();
        let declined = join(fresh_id(), &invite, "Lira", emit, forgetting(), None)
            .await
            .expect("an endpoint");
        assert_eq!(
            closed_for(next(&mut events).await),
            Some(CloseReason::Declined)
        );
        assert_eq!(locked(&asked).len(), 1);
        declined.leave().await;

        // a wrong secret never reaches the GM's eyes
        let forged = Invite {
            secret: wire::new_secret().expect("a secret"),
            ..invite.clone()
        };
        let (emit, mut events) = listening();
        let stranger = join(fresh_id(), &forged, "Mallory", emit, forgetting(), None)
            .await
            .expect("an endpoint");
        assert_eq!(
            closed_for(next(&mut events).await),
            Some(CloseReason::Invite)
        );
        assert_eq!(locked(&asked).len(), 1);
        stranger.leave().await;

        // a shut door answers the old invitation the same way, and opening it makes a new one
        assert_eq!(table.set_door(false), None);
        let (emit, mut events) = listening();
        let late = join(fresh_id(), &invite, "Lira", emit, forgetting(), None)
            .await
            .expect("an endpoint");
        assert_eq!(
            closed_for(next(&mut events).await),
            Some(CloseReason::Invite)
        );
        late.leave().await;
        let reopened = table.set_door(true).expect("a new invitation");
        assert_ne!(
            Invite::from_text(&reopened).expect("an invitation").secret,
            invite.secret
        );

        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn closing_the_table_tells_every_seat() {
        let (gm_emit, mut gm_events) = listening();
        let (approve, _asked) = answering(true);
        let (table, invite) = host(
            fresh_id(),
            "Thursday",
            &RelaySetting::None {
                addresses: AddressFamilies::Both,
            },
            gm_emit,
            approve,
            forgetting(),
            None,
        )
        .await
        .expect("a table");
        let invite = Invite::from_text(&invite.expect("an open door")).expect("its invitation");
        let (emit, mut events) = listening();
        let seat = join(fresh_id(), &invite, "Lira", emit, forgetting(), None)
            .await
            .expect("a seat");
        assert!(matches!(
            next(&mut gm_events).await,
            TableEvent::ParticipantJoined { .. }
        ));
        assert!(matches!(
            next(&mut events).await,
            TableEvent::Connection {
                state: ConnectionState::Connected,
                ..
            }
        ));

        table.close().await;
        assert!(matches!(
            next(&mut events).await,
            TableEvent::Connection {
                state: ConnectionState::Closed,
                reason: Some(CloseReason::TableClosed),
                ..
            }
        ));
        seat.leave().await;
    }

    #[test]
    fn a_table_is_not_opened_on_a_name_or_a_relay_that_is_not_one() {
        assert_eq!(
            parse_relay("https://relay.example.org"),
            "https://relay.example.org".parse().ok()
        );
        assert_eq!(parse_relay("http://relay.example.org"), None);
        assert_eq!(parse_relay("not a url"), None);
        assert!(RelaySetting::Custom {
            url: "ftp://x".into()
        }
        .mode()
        .is_none());
        let setting: RelaySetting =
            serde_json::from_value(json!({ "mode": "n0" })).expect("a setting");
        assert_eq!(setting, RelaySetting::N0);
    }

    #[test]
    fn an_invitation_that_leads_nowhere_cannot_be_followed() {
        let invite = Invite {
            v: INVITE_VERSION,
            id: "not a key".into(),
            relay: Some("https://relay.example.org".into()),
            addrs: vec![],
            secret: "s".into(),
            name: "t".into(),
        };
        assert!(!is_followable(&invite));
        let key = SecretKey::generate().public().to_string();
        assert!(is_followable(&Invite {
            id: key.clone(),
            ..invite.clone()
        }));
        let plain = Invite {
            id: key,
            relay: Some("http://relay.example.org".into()),
            ..invite
        };
        assert!(!is_followable(&plain));
    }

    #[test]
    fn a_dropped_seat_dials_often_at_first_and_then_keeps_one_pace() {
        let pauses: Vec<u64> = (0..9)
            .map(|failed| reconnect_pause(failed).as_secs())
            .collect();
        assert_eq!(pauses, [1, 2, 5, 10, 20, 30, 30, 30, 30]);
        // and never stops: ten minutes of dials that all fail is still followed by one
        assert_eq!(reconnect_pause(usize::MAX), Duration::from_secs(30));
    }

    /// The other end of `/dev/table-live`: a player in a process of its own, sitting at a table the
    /// running desktop app hosts. It follows the invitation the probe wrote, shows the sheet the
    /// probe wrote beside it, answers a roll with a roll and anything else with a no, and leaves
    /// when the table closes. `CHARNIK_LIVE_TABLE` names the probe's folder.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs the desktop app on /dev/table-live (table-link.md ▸ Driving a live table)"]
    async fn a_live_player_sits_at_the_apps_table() {
        const LIVE_WAIT: Duration = Duration::from_secs(180);
        let folder = std::path::PathBuf::from(
            std::env::var("CHARNIK_LIVE_TABLE")
                .expect("CHARNIK_LIVE_TABLE names the probe's folder"),
        );
        let invite = timeout(LIVE_WAIT, async {
            loop {
                let written = std::fs::read_to_string(folder.join("invite.txt"));
                if let Some(invite) = written.ok().as_deref().and_then(Invite::from_text) {
                    break invite;
                }
                sleep(Duration::from_millis(500)).await;
            }
        })
        .await
        .expect("the app wrote an invitation");
        let sheet = std::fs::read_to_string(folder.join("view.json")).expect("the probe's sheet");
        let sheet: Value = serde_json::from_str(&sheet).expect("the sheet is JSON");

        let (emit, mut events) = listening();
        let seat = join(
            fresh_id(),
            &invite,
            "Probe player",
            emit,
            forgetting(),
            None,
        )
        .await
        .expect("a seat");
        let mut answered = 0;
        let mut saw_the_reveal = false;
        let mut showed_ours = false;
        loop {
            let event = timeout(LIVE_WAIT, events.recv())
                .await
                .expect("the table said something in time")
                .expect("the session is still there");
            match event {
                TableEvent::Connection {
                    state: ConnectionState::Connected,
                    ..
                } => assert_eq!(seat.publish(view(sheet.clone())), Delivery::Delivered),
                TableEvent::Request {
                    request_id,
                    request,
                    ..
                } => {
                    let answer = if matches!(request, TableRequest::Roll { .. }) {
                        TableAnswer {
                            outcome: wire::AnswerOutcome::Accepted,
                            roll: Some(json!({
                                "total": 17, "natural": 15, "advantage": "neither", "mod": 2,
                            })),
                        }
                    } else {
                        TableAnswer {
                            outcome: wire::AnswerOutcome::Declined,
                            roll: None,
                        }
                    };
                    let rolled = matches!(request, TableRequest::Roll { .. });
                    assert_eq!(seat.respond(request_id, answer), Delivery::Delivered);
                    // and the roll goes into the table's log too, as a sheet's roll does
                    if rolled {
                        assert_eq!(
                            seat.record(roll_to(Audience::Table, 17)),
                            Delivery::Delivered
                        );
                    }
                    // after the hit, a roll kept to the GM, shown the table once it is ours
                    if !rolled {
                        assert_eq!(seat.record(roll_to(Audience::Gm, 12)), Delivery::Delivered);
                    }
                    answered += 1;
                }
                TableEvent::Record { record, mine, .. } => match record.body {
                    Body::Roll {
                        to: Audience::Gm,
                        reveals: None,
                        ..
                    } if mine && !showed_ours => {
                        showed_ours = true;
                        let reveal = Body::Roll {
                            lines: Vec::new(),
                            to: Audience::Gm,
                            reveals: Some(record.seq),
                        };
                        assert_eq!(seat.record(reveal), Delivery::Delivered);
                    }
                    Body::Roll {
                        to: Audience::Gm, ..
                    } if !mine => panic!("a roll the GM kept to themselves reached a player"),
                    Body::Roll {
                        reveals: Some(_), ..
                    } if !mine && !saw_the_reveal => {
                        saw_the_reveal = true;
                        // the probe reads this roll as "handed the shown roll, never the kept one"
                        assert_eq!(
                            seat.record(roll_to(Audience::Table, 20)),
                            Delivery::Delivered
                        );
                    }
                    _ => {}
                },
                TableEvent::Connection {
                    state: ConnectionState::Closed,
                    reason,
                    ..
                } => {
                    assert_eq!(reason, Some(CloseReason::TableClosed));
                    break;
                }
                _ => {}
            }
        }
        assert_eq!(answered, 2, "a roll and a hit were asked for");
        assert!(
            saw_the_reveal,
            "the GM's roll shown the table reached this seat"
        );
        seat.leave().await;
    }

    fn roll_to(to: Audience, total: u32) -> Body {
        Body::Roll {
            lines: vec![records::RollLine {
                name: records::RollName {
                    text: "DEX save".into(),
                    key: Some("combat.roll.save.dex".into()),
                },
                // the whole roll the page holds a record to, so the live drive's page shows it too
                roll: json!({ "total": total, "natural": total, "advantage": "neither", "mod": 0 }),
            }],
            to,
            reveals: None,
        }
    }

    /// The same record, whatever clock it is shown on.
    fn same(shown: &Record, kept: &Record) -> bool {
        (&shown.author, shown.seq, &shown.body) == (&kept.author, kept.seq, &kept.body)
    }

    /// The next log record an app holds, and the name it is shown under.
    async fn next_record(events: &mut UnboundedReceiver<TableEvent>) -> (Record, Option<String>) {
        loop {
            if let TableEvent::Record { record, name, .. } = next(events).await {
                return (record, name);
            }
        }
    }

    /// A record as every seat agrees on it. Each seat shows a record on the table's clock, moved by
    /// the skew it measured for the author — and two seats on one machine measure it a millisecond
    /// apart (macOS CI), so the time is the one field that is not the same record everywhere.
    fn untimed(record: &Record) -> Record {
        Record {
            at: 0,
            ..record.clone()
        }
    }

    async fn seated(invite: &Invite, name: &str) -> (PlayerSeat, UnboundedReceiver<TableEvent>) {
        let (emit, mut events) = listening();
        let seat = join(fresh_id(), invite, name, emit, forgetting(), None)
            .await
            .expect("a seat");
        loop {
            if let TableEvent::Connection {
                state: ConnectionState::Connected,
                ..
            } = next(&mut events).await
            {
                return (seat, events);
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_log_reaches_every_seat_that_may_see_it_and_a_hide_takes_a_record_away() {
        let (gm_emit, mut gm_events) = listening();
        let (approve, _) = answering(true);
        let (table, invite) = host(
            fresh_id(),
            "Thursday",
            &RelaySetting::None {
                addresses: AddressFamilies::Both,
            },
            gm_emit,
            approve,
            forgetting(),
            None,
        )
        .await
        .expect("a table");
        let invite = Invite::from_text(&invite.expect("an open door")).expect("its invitation");
        let gm = invite.id.clone();
        let (lira, mut lira_events) = seated(&invite, "Lira").await;
        let (bevan, mut bevan_events) = seated(&invite, "Bevan").await;

        // a roll to the table: shown at once to its roller, and handed on under the GM's name for them
        assert_eq!(
            lira.record(roll_to(Audience::Table, 12)),
            Delivery::Delivered
        );
        let (own, own_name) = next_record(&mut lira_events).await;
        assert_eq!((own.seq, own_name), (1, None));
        let (at_gm, name) = next_record(&mut gm_events).await;
        assert_eq!(
            (untimed(&at_gm), name.as_deref()),
            (untimed(&own), Some("Lira"))
        );
        let (at_bevan, name) = next_record(&mut bevan_events).await;
        assert_eq!(
            (untimed(&at_bevan), name.as_deref()),
            (untimed(&own), Some("Lira"))
        );

        // a roll kept to the GM reaches the GM and nobody else: Bevan's next record is the GM's
        lira.record(roll_to(Audience::Gm, 3));
        let (private, _) = next_record(&mut gm_events).await;
        assert!(matches!(
            private.body,
            Body::Roll {
                to: Audience::Gm,
                ..
            }
        ));
        table.record(roll_to(Audience::Table, 20));
        let (from_gm, name) = next_record(&mut bevan_events).await;
        assert_eq!((from_gm.author.as_str(), name), (gm.as_str(), None));

        // shown the table afterwards, it reaches every seat as a roll of its own, the kept one's lines
        let reveal = Body::Roll {
            lines: Vec::new(),
            to: Audience::Gm,
            reveals: Some(private.seq),
        };
        assert_eq!(lira.record(reveal.clone()), Delivery::Delivered);
        let (shown, name) = next_record(&mut bevan_events).await;
        let (Body::Roll { lines: kept, .. }, Body::Roll { lines, to, reveals }) =
            (&private.body, &shown.body)
        else {
            panic!("a reveal is a roll");
        };
        assert_eq!(
            (lines, *to, *reveals, name.as_deref()),
            (kept, Audience::Table, Some(private.seq), Some("Lira"))
        );
        assert_eq!(
            lira.record(reveal),
            Delivery::NotDelivered,
            "a roll is shown once"
        );

        // a player hides only their own; the GM hides anyone's, and every seat hears it
        let hide_lira = Body::Hide {
            author: own.author.clone(),
            seq: own.seq,
        };
        assert_eq!(bevan.record(hide_lira.clone()), Delivery::NotDelivered);
        assert_eq!(table.record(hide_lira.clone()), Delivery::Delivered);
        for events in [&mut lira_events, &mut bevan_events] {
            loop {
                let (record, _) = next_record(events).await;
                if record.body == hide_lira {
                    break;
                }
            }
        }

        // somebody who sits down later is handed what they may see, the private roll excepted
        let (_late, mut late_events) = seated(&invite, "Newcomer").await;
        let mut handed = Vec::new();
        while handed.len() < 4 {
            handed.push(next_record(&mut late_events).await.0);
        }
        let handed: Vec<Record> = handed.iter().map(untimed).collect();
        assert!(
            handed.contains(&untimed(&own))
                && handed.contains(&untimed(&from_gm))
                && handed.contains(&untimed(&shown))
        );
        assert!(handed.iter().all(|record| *record != untimed(&private)));
        assert!(handed.iter().any(|record| record.body == hide_lira));

        lira.leave().await;
        bevan.leave().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_record_written_before_the_seat_was_let_in_arrives_once_it_is() {
        let (gm_emit, mut gm_events) = listening();
        let (approve, _) = answering(true);
        let (table, invite) = host(
            fresh_id(),
            "Thursday",
            &RelaySetting::None {
                addresses: AddressFamilies::Both,
            },
            gm_emit,
            approve,
            forgetting(),
            None,
        )
        .await
        .expect("a table");
        let invite = Invite::from_text(&invite.expect("an open door")).expect("its invitation");
        let (emit, mut lira_events) = listening();
        let lira = join(fresh_id(), &invite, "Lira", emit, forgetting(), None)
            .await
            .expect("a seat");
        // written while the dial is still on its way: kept here, and handed over on the GM's have
        lira.record(roll_to(Audience::Table, 9));
        let (kept, _) = next_record(&mut lira_events).await;
        let (arrived, name) = next_record(&mut gm_events).await;
        assert!(same(&arrived, &kept));
        assert_eq!(name.as_deref(), Some("Lira"));
        // and written before anyone measured Lira's clock, it is placed again once the GM's app has
        let (placed, _) = next_record(&mut lira_events).await;
        assert!(same(&placed, &kept));
        lira.leave().await;
        table.close().await;
    }

    /// A keeper that keeps everything, for a table that is to come back.
    fn keeping() -> (Keeper, Arc<Mutex<Vec<Keep>>>) {
        let kept = Arc::new(Mutex::new(Vec::new()));
        let keeper: Keeper = Arc::new({
            let kept = kept.clone();
            move |keep| locked(&kept).push(keep)
        });
        (keeper, kept)
    }

    fn records_of(kept: &Arc<Mutex<Vec<Keep>>>) -> Vec<Held> {
        locked(kept)
            .iter()
            .filter_map(|keep| match keep {
                Keep::Record(held) => Some(held.clone()),
                _ => None,
            })
            .collect()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_table_opened_again_under_its_key_seats_whom_it_let_in_and_holds_its_log() {
        let (gm_keeper, gm_kept) = keeping();
        let (gm_emit, mut first_events) = listening();
        let (approve, _) = answering(true);
        let (first, invite) = host(
            fresh_id(),
            "Thursday",
            &RelaySetting::None {
                addresses: AddressFamilies::Both,
            },
            gm_emit,
            approve,
            gm_keeper,
            None,
        )
        .await
        .expect("a table");
        let invite = Invite::from_text(&invite.expect("an open door")).expect("its invitation");
        let (player_keeper, player_kept) = keeping();
        let (emit, mut events) = listening();
        let lira = join(fresh_id(), &invite, "Lira", emit, player_keeper, None)
            .await
            .expect("a seat");
        loop {
            if let TableEvent::Connection {
                state: ConnectionState::Connected,
                ..
            } = next(&mut events).await
            {
                break;
            }
        }
        lira.record(roll_to(Audience::Table, 14));
        let roll = loop {
            let kept = records_of(&gm_kept);
            if let Some(first) = kept.first() {
                break first.clone();
            }
            sleep(Duration::from_millis(50)).await;
        };
        assert_eq!(roll.name.as_deref(), Some("Lira"));

        let player = lira.key().public().to_string();
        let request = TableRequest::Roll {
            roll: wire::RequestedRoll::Skill,
            id: "stealth".into(),
            dc: None,
        };
        assert_eq!(
            first.request(&player, "roll-1".into(), request),
            Delivery::Delivered
        );
        let request_id = loop {
            if let TableEvent::Request { request_id, .. } = next(&mut events).await {
                break request_id;
            }
        };
        let answer = TableAnswer {
            outcome: wire::AnswerOutcome::Declined,
            roll: None,
        };
        assert_eq!(
            lira.respond(request_id.clone(), answer.clone()),
            Delivery::Delivered
        );
        assert_eq!(lira.respond(request_id, answer), Delivery::NotDelivered);
        let (sent, replied) = timeout(EVENT_WAIT, async {
            let mut ask = None;
            loop {
                let (record, _) = next_record(&mut first_events).await;
                match record.body {
                    Body::Ask { .. } => ask = Some(record),
                    Body::Answer { .. } => break (ask.expect("the ask was recorded"), record),
                    _ => {}
                }
            }
        })
        .await
        .expect("the GM keeps the conversation");
        assert!(visible_to(&sent, &player) && visible_to(&replied, &player));
        let other = SecretKey::generate().public().to_string();
        assert!(!visible_to(&sent, &other) && !visible_to(&replied, &other));
        lira.record(roll_to(Audience::Table, 15));
        let (newer, _) = next_record(&mut first_events).await;
        assert!(newer.seq > replied.seq);

        // the GM's app goes down without a word to anyone
        let gm_key = first.key().clone();
        let bind_addrs = first.bind_addrs();
        let allowed: Vec<(EndpointId, String)> = locked(&gm_kept)
            .iter()
            .filter_map(|keep| match keep {
                Keep::LetIn { key, name } => Some((*key, name.clone())),
                _ => None,
            })
            .collect();
        first.endpoint.close().await;
        drop(first);
        timeout(EVENT_WAIT, async {
            loop {
                if bind_addrs
                    .iter()
                    .all(|addr| std::net::UdpSocket::bind(addr).is_ok())
                {
                    break;
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the exited app releases its sockets");
        let lira_key = lira.key().clone();

        // ...and opens again under its key: the same table, its log from its own disk — the asks and
        // answers with it — and nobody asked about again
        let (gm_emit, mut gm_events) = listening();
        let (refuse, asked) = answering(false);
        let again = Again {
            key: gm_key,
            allowed,
            records: records_of(&gm_kept),
            bind_addrs,
        };
        let (table, shut) = host(
            fresh_id(),
            "Thursday",
            &RelaySetting::None {
                addresses: AddressFamilies::Both,
            },
            gm_emit,
            refuse,
            forgetting(),
            Some(again),
        )
        .await
        .expect("the table again");
        assert_eq!(shut, None, "a table opened again keeps its door shut");
        let first_roll = records::verify(&roll.record, &invite.id).expect("Lira's roll");
        for kept in [&first_roll, &sent, &replied, &newer] {
            assert!(same(&next_record(&mut gm_events).await.0, kept));
        }
        assert_eq!(joined_name(&mut gm_events).await, "Lira");
        // Lira hands over nothing the GM's disk already held, so nothing more is kept
        sleep(Duration::from_millis(300)).await;
        while let Ok(event) = gm_events.try_recv() {
            assert!(
                !matches!(event, TableEvent::Record { .. }),
                "nothing is handed back"
            );
        }
        lira.leave().await;

        let (emit, mut events) = listening();
        let back = Again {
            key: lira_key,
            allowed: vec![],
            records: records_of(&player_kept),
            bind_addrs: vec![],
        };
        let lira = join(fresh_id(), &invite, "Lira", emit, forgetting(), Some(back))
            .await
            .expect("a seat");
        let (own, _) = next_record(&mut events).await;
        assert!(same(&own, &first_roll));
        loop {
            match next(&mut events).await {
                TableEvent::Connection {
                    state: ConnectionState::Connected,
                    ..
                } => break,
                TableEvent::Request { .. } => panic!("history is not a live prompt"),
                _ => {}
            }
        }
        assert!(
            locked(&asked).is_empty(),
            "a key let in before is not asked about"
        );
        lira.leave().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_ipv4_only_table_binds_and_invites_on_ipv4_alone() {
        let (emit, _) = listening();
        let (approve, _) = answering(true);
        let ipv4_only = RelaySetting::None {
            addresses: AddressFamilies::Ipv4,
        };
        let (table, invite) = host(
            fresh_id(),
            "Thursday",
            &ipv4_only,
            emit,
            approve,
            forgetting(),
            None,
        )
        .await
        .expect("a table");
        let invite = Invite::from_text(&invite.expect("an open door")).expect("its invitation");
        assert!(!invite.addrs.is_empty());
        assert!(
            invite.addrs.iter().all(SocketAddr::is_ipv4),
            "{:?}",
            invite.addrs
        );
        assert!(table.bind_addrs().iter().all(SocketAddr::is_ipv4));
        assert!(!table.without_ipv6);
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_saved_ipv6_port_that_no_longer_binds_returns_the_table_on_ipv4() {
        // a port of the system's choosing: one picked and let go could be taken by a test beside it
        let free: SocketAddr = "0.0.0.0:0".parse().unwrap();
        // an address this machine does not have stands for IPv6 switched off since the table was kept
        let gone: SocketAddr = "[2001:db8::1]:0".parse().unwrap();
        let again = Again {
            key: SecretKey::generate(),
            allowed: vec![],
            records: vec![],
            bind_addrs: vec![free, gone],
        };
        let (emit, _) = listening();
        let (approve, _) = answering(false);
        let (table, _) = host(
            fresh_id(),
            "Thursday",
            &RelaySetting::None {
                addresses: AddressFamilies::Both,
            },
            emit,
            approve,
            forgetting(),
            Some(again),
        )
        .await
        .expect("the table again, on IPv4");
        assert!(table.without_ipv6);
        let bound = table.bind_addrs();
        assert!(
            bound.len() == 1 && bound.iter().all(SocketAddr::is_ipv4),
            "{bound:?}"
        );
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_remembered_direct_table_refuses_an_occupied_port_instead_of_moving() {
        let (first, _, _) = open_table().await;
        let again = Again {
            key: first.key().clone(),
            allowed: vec![],
            records: vec![],
            bind_addrs: first.bind_addrs(),
        };
        let (emit, _) = listening();
        let (approve, _) = answering(false);
        assert!(matches!(
            host(
                fresh_id(),
                "Thursday",
                &RelaySetting::None {
                    addresses: AddressFamilies::Both,
                },
                emit,
                approve,
                forgetting(),
                Some(again),
            )
            .await,
            Err(Unavailable::Network)
        ));
        first.close().await;
    }

    // --- attacks a peer at the table tried, and what holds them -----------------------------

    async fn open_table() -> (GmTable, Invite, UnboundedReceiver<TableEvent>) {
        let (emit, events) = listening();
        let (approve, _) = answering(true);
        let (table, invite) = host(
            fresh_id(),
            "Thursday",
            &RelaySetting::None {
                addresses: AddressFamilies::Both,
            },
            emit,
            approve,
            forgetting(),
            None,
        )
        .await
        .expect("a table");
        let invite = Invite::from_text(&invite.expect("an open door")).expect("its invitation");
        (table, invite, events)
    }

    /// A bare endpoint that may dial this table's GM: a modified build, speaking frames by hand.
    async fn by_hand(invite: &Invite) -> (Endpoint, Connection) {
        let (gm, _) = address_of(invite).expect("an address");
        let endpoint = bind(
            knocking_key(&invite.secret, &gm.id),
            RelayMode::Disabled,
            EndpointRole::Player(gm.id),
            &[],
        )
        .await
        .expect("an endpoint");
        let conn = timeout(EVENT_WAIT, endpoint.connect(gm, ALPN))
            .await
            .expect("in time")
            .expect("a connection");
        (endpoint, conn)
    }

    async fn joined_name(events: &mut UnboundedReceiver<TableEvent>) -> String {
        loop {
            if let TableEvent::ParticipantJoined { participant, .. } = next(events).await {
                return participant.name;
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_older_protocol_is_refused_before_admission() {
        let (table, invite, mut events) = open_table().await;
        let (endpoint, conn) = by_hand(&invite).await;
        let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
        // protocol 3's hello, which said no version
        let hello =
            json!({ "frame": "hello", "protocol": 3, "secret": invite.secret, "name": "Lira" });
        wire::write_frame(&mut send, &hello, HELLO_CAP)
            .await
            .expect("a hello");
        let reply = timeout(
            EVENT_WAIT,
            wire::read_frame::<GmFrame>(&mut recv, GM_FRAME_CAP),
        )
        .await
        .expect("a version reply")
        .expect("a frame");
        let GmFrame::Refused {
            reason: Refusal::Version,
            gm: Some(gm),
        } = reply
        else {
            panic!("refused for version, saying the GM's: {reply:?}");
        };
        assert_eq!((gm.protocol, gm.version.as_str()), (PROTOCOL, APP_VERSION));
        // the GM is told who knocked with an older app, and that it is the player's to update
        let TableEvent::VersionRefused {
            name, player_newer, ..
        } = next(&mut events).await
        else {
            panic!("the GM is told");
        };
        assert_eq!((name.as_str(), player_newer), ("Lira", false));
        endpoint.close().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_newer_protocol_is_refused_and_told_the_gm_is_older() {
        let (table, invite, mut events) = open_table().await;
        let (endpoint, conn) = by_hand(&invite).await;
        let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
        // a later protocol's hello, carrying what this build does not know of
        let hello = json!({
            "frame": "hello", "protocol": PROTOCOL + 1, "secret": invite.secret,
            "name": "Lira", "version": "9.9.9", "somethingNew": true
        });
        wire::write_frame(&mut send, &hello, HELLO_CAP)
            .await
            .expect("a hello");
        let reply = timeout(
            EVENT_WAIT,
            wire::read_frame::<GmFrame>(&mut recv, GM_FRAME_CAP),
        )
        .await
        .expect("a version reply")
        .expect("a frame");
        assert!(matches!(
            reply,
            GmFrame::Refused {
                reason: Refusal::Version,
                gm: Some(_)
            }
        ));
        let TableEvent::VersionRefused {
            version,
            player_newer,
            ..
        } = next(&mut events).await
        else {
            panic!("the GM is told");
        };
        assert_eq!((version.as_str(), player_newer), ("9.9.9", true));
        endpoint.close().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_seat_let_in_sits_again_under_the_name_it_was_let_in_by() {
        let (table, invite, mut gm_events) = open_table().await;
        let (mallory, _) = seated(&invite, "Mallory").await;
        assert_eq!(joined_name(&mut gm_events).await, "Mallory");
        let key = mallory.key().clone();
        mallory.leave().await;
        let again = Again {
            key,
            allowed: vec![],
            records: vec![],
            bind_addrs: vec![],
        };
        let (emit, _events) = listening();
        let back = join(fresh_id(), &invite, "Bo", emit, forgetting(), Some(again))
            .await
            .expect("a seat");
        assert_eq!(joined_name(&mut gm_events).await, "Mallory");
        back.leave().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_seat_hands_over_only_its_own_records() {
        let (table, invite, _gm_events) = open_table().await;
        let (ann, _) = seated(&invite, "Ann").await;
        let (bevan, _) = seated(&invite, "Bevan").await;
        let gm = invite.id.clone();
        let ann_id = ann.key().public().to_string();
        let bevan_id = bevan.key().public();
        let as_ann = |seq: u64| {
            let record = Record {
                table: gm.clone(),
                author: ann_id.clone(),
                seq,
                at: records::now_ms(),
                body: roll_to(Audience::Table, 3),
            };
            records::sign(ann.key(), &record).expect("signs")
        };
        // Bevan hands over Ann's rolls: Ann holds every one of her own, so a copy from Bevan is
        // not taken
        for seq in 100..120 {
            table.shared.offer(as_ann(seq), Some(bevan_id));
        }
        assert!(!(100..120).any(|seq| locked(&table.shared.log).holds(&ann_id, seq)));
        // Ann's own roll is
        table.shared.offer(as_ann(500), Some(ann.key().public()));
        assert!(locked(&table.shared.log).holds(&ann_id, 500));
        ann.leave().await;
        bevan.leave().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_burst_past_the_send_pace_waits_its_turn_and_none_of_it_is_lost() {
        let (table, invite, _gm_events) = open_table().await;
        let (lira, _) = seated(&invite, "Lira").await;
        let me = lira.key().public().to_string();
        let burst = 25;
        for total in 0..burst {
            lira.record(roll_to(Audience::Table, total));
        }
        // twenty go at once and the rest one a second: all of them, and in their order
        timeout(Duration::from_secs(15), async {
            while !(1..=u64::from(burst)).all(|seq| locked(&table.shared.log).holds(&me, seq)) {
                sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .expect("every record of the burst arrives");
        lira.leave().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_answer_is_taken_past_the_pace_its_seat_used_up() {
        let (table, invite, _gm_events) = open_table().await;
        let (lira, mut events) = seated(&invite, "Lira").await;
        let player = lira.key();
        let me = player.public().to_string();
        let request = TableRequest::Heal { amount: 3 };
        assert_eq!(
            table.request(&me, "heal-1".into(), request),
            Delivery::Delivered
        );
        while !matches!(next(&mut events).await, TableEvent::Request { .. }) {}
        let by_lira = |seq: u64, body: Body| {
            let record = Record {
                table: invite.id.clone(),
                author: me.clone(),
                seq,
                at: records::now_ms(),
                body,
            };
            records::sign(player, &record).expect("signs")
        };
        // a seat that used up its pace: the next roll is refused, its answer is not
        let mut seq = 1_000;
        while locked(&table.shared.log).within_pace(&me) {}
        seq += 1;
        table.shared.offer(
            by_lira(seq, roll_to(Audience::Table, 1)),
            Some(player.public()),
        );
        assert!(!locked(&table.shared.log).holds(&me, seq));
        let answer = Body::Answer {
            request_id: "heal-1".into(),
            answer: TableAnswer {
                outcome: wire::AnswerOutcome::Accepted,
                roll: None,
            },
        };
        seq += 1;
        table
            .shared
            .offer(by_lira(seq, answer), Some(player.public()));
        assert!(locked(&table.shared.log).holds(&me, seq));
        lira.leave().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_seat_whose_clock_is_an_hour_slow_is_shown_on_the_gms() {
        let (table, invite, mut gm_events) = open_table().await;
        let (endpoint, conn) = by_hand(&invite).await;
        let me = endpoint.id().to_string();
        let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
        let hello = PlayerFrame::Hello {
            protocol: PROTOCOL,
            secret: invite.secret.clone(),
            name: "Mal".into(),
            version: APP_VERSION.into(),
        };
        wire::write_frame(&mut send, &hello, HELLO_CAP)
            .await
            .expect("hello");
        let mut frames = Vec::new();
        let hour = 3_600_000;
        let slow = records::now_ms() - hour;
        let clock = PlayerFrame::Clock { now: slow };
        let welcome: GmFrame = timeout(EVENT_WAIT, wire::read_frame(&mut recv, GM_FRAME_CAP))
            .await
            .expect("in time")
            .expect("a frame");
        assert!(matches!(welcome, GmFrame::Welcome { .. }));
        wire::write_frame(&mut send, &clock, VIEW_CAP)
            .await
            .expect("the clock");
        // the GM's app says how far off it found this clock
        let skew = timeout(EVENT_WAIT, async {
            loop {
                match wire::read_frame::<GmFrame>(&mut recv, GM_FRAME_CAP).await {
                    Ok(GmFrame::Clock { skew }) => break skew,
                    Ok(frame) => frames.push(frame),
                    Err(_) => panic!("the stream ended"),
                }
            }
        })
        .await
        .expect("a clock reply");
        assert!(
            (skew - i64::try_from(hour).unwrap()).abs() < 5_000,
            "{skew}"
        );
        let record = Record {
            table: invite.id.clone(),
            author: me.clone(),
            seq: 1,
            at: slow,
            body: roll_to(Audience::Table, 7),
        };
        let signed = records::sign(endpoint.secret_key(), &record).expect("signs");
        wire::write_frame(&mut send, &PlayerFrame::Record { record: signed }, VIEW_CAP)
            .await
            .expect("the record");
        let (shown, _) = next_record(&mut gm_events).await;
        assert!(
            shown.at.abs_diff(records::now_ms()) < 5_000,
            "shown an hour off: {}",
            shown.at
        );
        endpoint.close().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_stranger_whose_key_did_not_knock_takes_no_greeting_place() {
        let (table, invite, _gm_events) = open_table().await;
        let (gm, _) = address_of(&invite).expect("an address");
        let lazy = std::iter::repeat_with(SecretKey::generate)
            .find(|key| !wire::knocks(&invite.secret, gm.id.as_bytes(), key.public().as_bytes()))
            .expect("a key that does not knock");
        let endpoint = bind(lazy, RelayMode::Disabled, EndpointRole::Player(gm.id), &[])
            .await
            .expect("an endpoint");
        let conn = timeout(EVENT_WAIT, endpoint.connect(gm, ALPN))
            .await
            .expect("in time")
            .expect("a connection");
        let closed = timeout(EVENT_WAIT, conn.closed())
            .await
            .expect("let go in time");
        assert!(matches!(
            closed,
            iroh::endpoint::ConnectionError::ApplicationClosed(close)
                if close.error_code == DOOR_SHUT.into()
        ));
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn strangers_who_never_say_hello_keep_out_nobody_already_let_in() {
        let (table, invite, _gm_events) = open_table().await;
        let (lira, _) = seated(&invite, "Lira").await;
        let key = lira.key().clone();
        lira.leave().await;
        // more silent dials than there are places to greet in
        let mut silent = vec![];
        for _ in 0..MAX_GREETING + 4 {
            silent.push(by_hand(&invite).await);
        }
        let again = Again {
            key,
            allowed: vec![],
            records: vec![],
            bind_addrs: vec![],
        };
        let (emit, mut events) = listening();
        let back = join(fresh_id(), &invite, "Lira", emit, forgetting(), Some(again))
            .await
            .expect("a seat");
        loop {
            match next(&mut events).await {
                TableEvent::Connection {
                    state: ConnectionState::Connected,
                    ..
                } => break,
                TableEvent::Connection {
                    state: ConnectionState::Closed,
                    reason,
                    ..
                } => panic!("a seat let in before was kept out: {reason:?}"),
                _ => {}
            }
        }
        // and with the door shut a stranger is let go at once, told why
        table.set_door(false);
        let (_endpoint, conn) = by_hand(&invite).await;
        let closed = timeout(EVENT_WAIT, conn.closed())
            .await
            .expect("let go in time");
        assert!(matches!(
            closed,
            iroh::endpoint::ConnectionError::ApplicationClosed(close)
                if close.error_code == DOOR_SHUT.into()
        ));
        drop(silent);
        back.leave().await;
        table.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_dismissed_seat_that_stopped_reading_is_cut_off() {
        let (table, invite, _gm_events) = open_table().await;
        let fat = |text: &str| Body::Roll {
            lines: vec![records::RollLine {
                name: records::RollName {
                    text: text.into(),
                    key: None,
                },
                roll: json!({ "pad": "y".repeat(1500) }),
            }],
            to: Audience::Table,
            reveals: None,
        };
        for _ in 0..300 {
            table.record(fat("filler"));
        }
        let (endpoint, conn) = by_hand(&invite).await;
        let me = endpoint.id().to_string();
        let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
        let hello = PlayerFrame::Hello {
            protocol: PROTOCOL,
            secret: invite.secret.clone(),
            name: "Mal".into(),
            version: APP_VERSION.into(),
        };
        wire::write_frame(&mut send, &hello, HELLO_CAP)
            .await
            .expect("hello");
        let welcome: GmFrame = timeout(EVENT_WAIT, wire::read_frame(&mut recv, GM_FRAME_CAP))
            .await
            .expect("in time")
            .expect("a frame");
        assert!(matches!(welcome, GmFrame::Welcome { .. }));
        // ask for the whole log again and again, and read none of it
        for _ in 0..40 {
            let have = PlayerFrame::Have {
                have: std::collections::BTreeMap::new(),
            };
            if wire::write_frame(&mut send, &have, VIEW_CAP).await.is_err() {
                break;
            }
            sleep(Duration::from_millis(15)).await;
        }
        sleep(Duration::from_secs(1)).await;
        table.dismiss(&me);
        sleep(GOODBYE_WAIT * 3).await;
        table.record(fat("after dismissal"));
        // what it can still read ends, and never reaches a roll made after it was sent away
        let read = timeout(EVENT_WAIT * 3, async {
            loop {
                match wire::read_frame::<GmFrame>(&mut recv, GM_FRAME_CAP).await {
                    Ok(GmFrame::Record { record, .. })
                        if record.text.contains("after dismissal") =>
                    {
                        break false
                    }
                    Ok(_) => {}
                    Err(_) => break true,
                }
            }
        })
        .await
        .expect("the stream ends in time");
        assert!(read, "a seat sent away was handed a roll made after");
        table.close().await;
    }
}

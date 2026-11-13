//! A table as connections: the GM's endpoint that players dial, and a player's that dials it.
//!
//! A star — every player holds one connection, to the GM, and none to another player. iroh gives
//! an authenticated, encrypted pipe to a key; who is AT the table is decided here, by the GM's
//! approval of each key (`admit`).
//!
//! Nothing in this file knows about Tauri: what a session tells the app is an `Emit`, and what it
//! asks the GM is an `Approve`, so two sessions can sit at one table inside a test.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use iroh::endpoint::{presets, BeforeConnectOutcome, Connection, EndpointHooks, RecvStream};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, SecretKey, TransportAddr};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::sync::{mpsc, Semaphore};
use tokio::time::{sleep, timeout};

use super::wire::{
    self, FrameError, GmFrame, Goodbye, Invite, PlayerFrame, Refusal, TableAnswer, TableRequest,
    ALPN, GM_FRAME_CAP, HELLO_CAP, PROTOCOL, VIEW_CAP,
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
/// A seat that drops is dialled again this many times, this far apart, before it is lost.
const RECONNECT_TRIES: u32 = 6;
const RECONNECT_PAUSE: Duration = Duration::from_secs(5);
/// The least time between two frames read from one peer — a ceiling on what one seat can make
/// the other app do.
const FRAME_PACE: Duration = Duration::from_millis(10);

const MAX_SEATS: usize = 12;
/// How many strangers may wait for the GM's answer at once; the rest are told the table is full.
const MAX_WAITING: usize = 4;
/// How many connections may be between arriving and saying hello at once. Whoever dials past
/// that is refused before the handshake, so a flood of dials costs the table nothing it keeps.
const MAX_GREETING: usize = 16;
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
    /// The connection dropped and dialling again did not bring it back.
    Lost,
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
    Connection {
        table: Option<String>,
        state: ConnectionState,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<CloseReason>,
    },
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
}

pub type Emit = Arc<dyn Fn(TableEvent) + Send + Sync>;

/// Somebody at the door, as the GM is asked about them.
pub struct JoinRequest {
    pub table: String,
    pub player: String,
    pub code: String,
}

pub type Approve =
    Arc<dyn Fn(JoinRequest) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

/// Which relay servers a table is reached through — the GM's choice, carried by the invitation.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum RelaySetting {
    /// number 0's public relays.
    N0,
    Custom {
        url: String,
    },
    /// No relay: the invitation carries this machine's own addresses.
    None,
}

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
            Self::None => RelayMode::Disabled,
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

/// An endpoint for one table, under a key made for it and kept nowhere. No address lookup is
/// configured: nothing about the endpoint is published, and the invitation is how it is found.
async fn bind(
    relay: RelayMode,
    accepts: bool,
    only_dial: Option<EndpointId>,
) -> Result<Endpoint, Unavailable> {
    Endpoint::builder(presets::Minimal)
        .secret_key(SecretKey::generate())
        .relay_mode(relay)
        .alpns(if accepts { vec![ALPN.to_vec()] } else { vec![] })
        .hooks(DialPolicy { only: only_dial })
        .bind()
        .await
        .map_err(|e| {
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
}

impl GmShared {
    fn invite(&self, secret: String) -> String {
        Invite {
            v: PROTOCOL,
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

    /// May this key sit? A key already let in may. Anyone else needs the open door's secret, a
    /// free seat, and the GM's yes — asked one at a time, in a dialog the page cannot press.
    async fn admit(
        &self,
        player: EndpointId,
        protocol: u32,
        secret: &str,
        name: &str,
    ) -> Result<(), Refusal> {
        if protocol != PROTOCOL {
            return Err(Refusal::Version);
        }
        if locked(&self.allowed).contains(&player) {
            return Ok(());
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
        Ok(())
    }
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
    greeting: tokio::sync::OwnedSemaphorePermit,
) {
    let player = conn.remote_id();
    let Ok(Ok((mut send, mut recv))) = timeout(HELLO_WAIT, conn.accept_bi()).await else {
        return;
    };
    let hello = timeout(HELLO_WAIT, wire::read_frame(&mut recv, HELLO_CAP)).await;
    let Ok(Ok(PlayerFrame::Hello {
        protocol,
        secret,
        name,
    })) = hello
    else {
        return;
    };
    // the hello is said: what waits from here is counted by `admit`
    drop(greeting);
    let name = wire::plain_text(&name);
    if let Err(reason) = shared.admit(player, protocol, &secret, &name).await {
        say_goodbye(send, &conn, &GmFrame::Refused { reason }).await;
        return;
    }
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
    let generation = shared.generations.fetch_add(1, Ordering::Relaxed);
    locked(&shared.seats).insert(
        player,
        SeatHandle {
            generation,
            outbound,
        },
    );
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
                Some(Ok(PlayerFrame::Answer { request_id, answer }))
                    if wire::is_request_id(&request_id) =>
                {
                    (shared.emit)(TableEvent::Answer {
                        table: shared.table.clone(),
                        participant: participant.clone(),
                        request_id,
                        answer,
                    });
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
    endpoint: Endpoint,
    shared: Arc<GmShared>,
    _accepting: TaskGuard,
}

/// Open a table: bind an endpoint, wait for its relay if it has one, and start letting people
/// knock. Answers the table and the first invitation to it.
pub async fn host(
    name: &str,
    relay: &RelaySetting,
    emit: Emit,
    approve: Approve,
) -> Result<(GmTable, String), Unavailable> {
    let name = wire::plain_text(name);
    if name.is_empty() {
        return Err(Unavailable::BadName);
    }
    let mode = relay.mode().ok_or(Unavailable::BadRelay)?;
    let relayed = mode != RelayMode::Disabled;
    let endpoint = bind(mode, true, None).await?;
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
        addr.ip_addrs().copied().collect()
    };
    let (Ok(table), Ok(secret)) = (wire::new_local_id(), wire::new_secret()) else {
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
        door: Mutex::new(Some(secret.clone())),
        allowed: Mutex::default(),
        seats: Mutex::default(),
        generations: AtomicU64::new(0),
        waiting: Semaphore::new(MAX_WAITING),
        asking: tokio::sync::Mutex::default(),
        emit,
        approve,
    });
    let accepting = tokio::spawn({
        let (endpoint, shared) = (endpoint.clone(), shared.clone());
        async move {
            let greeting = Arc::new(Semaphore::new(MAX_GREETING));
            while let Some(incoming) = endpoint.accept().await {
                let Ok(permit) = greeting.clone().try_acquire_owned() else {
                    incoming.refuse();
                    continue;
                };
                let shared = shared.clone();
                tokio::spawn(async move {
                    if let Ok(conn) = incoming.await {
                        seat_player(conn, shared, permit).await;
                    }
                });
            }
        }
    });
    let invite = shared.invite(secret);
    log::info!("table link: a table is open");
    Ok((
        GmTable {
            id: table,
            endpoint,
            shared,
            _accepting: TaskGuard(accepting),
        },
        invite,
    ))
}

impl GmTable {
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
        let frame = GmFrame::Request {
            request_id,
            request,
        };
        match self.seat_of(participant) {
            Some(seat) if seat.try_send(frame).is_ok() => Delivery::Delivered,
            _ => Delivery::NotDelivered,
        }
    }

    /// Take a seat away, and the key's right to sit again without being asked about.
    pub fn dismiss(&self, participant: &str) {
        if let Ok(player) = participant.parse::<EndpointId>() {
            locked(&self.shared.allowed).remove(&player);
        }
        if let Some(seat) = self.seat_of(participant) {
            let _ = seat.try_send(GmFrame::Closed {
                reason: Goodbye::Dismissed,
            });
        }
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
    Answer {
        request_id: String,
        answer: TableAnswer,
    },
}

struct PlayerShared {
    table: String,
    /// The way to the GM while a connection is seated, and None while there is none.
    outbound: Mutex<Option<mpsc::Sender<Outgoing>>>,
    emit: Emit,
}

impl PlayerShared {
    fn says(&self, state: ConnectionState, reason: Option<CloseReason>) {
        (self.emit)(TableEvent::Connection {
            table: Some(self.table.clone()),
            state,
            reason,
        });
    }
}

/// How one connection to the GM ended.
enum SeatEnd {
    /// For good: dialling again would be answered the same way.
    Gone(CloseReason),
    /// The connection failed or dropped. `seated` says whether the GM had let it in.
    Dropped { seated: bool },
}

struct Hello {
    secret: String,
    name: String,
}

/// One connection: dial, say hello, wait to be let in, then carry views and answers out and
/// requests in until it ends.
async fn sit(
    endpoint: &Endpoint,
    gm: &EndpointAddr,
    hello: &Hello,
    shared: &PlayerShared,
) -> SeatEnd {
    let dropped = SeatEnd::Dropped { seated: false };
    let Ok(Ok(conn)) = timeout(CONNECT_WAIT, endpoint.connect(gm.clone(), ALPN)).await else {
        return dropped;
    };
    let Ok((mut send, recv)) = conn.open_bi().await else {
        return dropped;
    };
    let frame = PlayerFrame::Hello {
        protocol: PROTOCOL,
        secret: hello.secret.clone(),
        name: hello.name.clone(),
    };
    if wire::write_frame(&mut send, &frame, HELLO_CAP)
        .await
        .is_err()
    {
        return dropped;
    }
    shared.says(ConnectionState::Waiting, None);

    let (mut frames, _reading) = read_frames::<GmFrame>(recv, GM_FRAME_CAP);
    match timeout(APPROVAL_WAIT, frames.recv()).await {
        Ok(Some(Ok(GmFrame::Welcome { .. }))) => {}
        Ok(Some(Ok(GmFrame::Refused { reason }))) => return SeatEnd::Gone(reason.into()),
        Ok(Some(Ok(_) | Err(FrameError::Malformed | FrameError::TooLarge))) => {
            return SeatEnd::Gone(CloseReason::Protocol)
        }
        _ => return dropped,
    }

    let (outbound, mut outgoing) = mpsc::channel(OUTBOUND_QUEUE);
    *locked(&shared.outbound) = Some(outbound);
    shared.says(ConnectionState::Connected, None);
    let dropped = SeatEnd::Dropped { seated: true };
    // what the GM's app holds of the view, so only what changed is sent
    let mut sent = Map::new();
    loop {
        tokio::select! {
            frame = frames.recv() => match frame {
                Some(Ok(GmFrame::Request { request_id, request }))
                    if wire::is_request_id(&request_id) && request.is_bounded() =>
                {
                    (shared.emit)(TableEvent::Request {
                        table: shared.table.clone(),
                        request_id,
                        request,
                    });
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
                    Some(Outgoing::Answer { request_id, answer }) => {
                        PlayerFrame::Answer { request_id, answer }
                    }
                    // nothing holds the other end any more: this connection is no longer the seat
                    None => return dropped,
                };
                if wire::write_frame(&mut send, &frame, VIEW_CAP).await.is_err() {
                    return dropped;
                }
            },
        }
    }
}

/// Hold a seat for as long as it can be held: a connection the GM had let in is dialled again
/// when it drops, and one that never got in is not.
async fn keep_seat(endpoint: Endpoint, gm: EndpointAddr, hello: Hello, shared: Arc<PlayerShared>) {
    let mut seated_before = false;
    let mut tries_left = RECONNECT_TRIES;
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
            SeatEnd::Gone(reason) => break reason,
            SeatEnd::Dropped { seated } => {
                if seated {
                    seated_before = true;
                    tries_left = RECONNECT_TRIES;
                }
                if !seated_before {
                    break CloseReason::Unreachable;
                }
                if tries_left == 0 {
                    break CloseReason::Lost;
                }
                tries_left -= 1;
                sleep(RECONNECT_PAUSE).await;
            }
        }
    };
    shared.says(ConnectionState::Closed, Some(reason));
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
pub async fn join(invite: &Invite, name: &str, emit: Emit) -> Result<PlayerSeat, Unavailable> {
    let name = wire::plain_text(name);
    if name.is_empty() {
        return Err(Unavailable::BadName);
    }
    let (gm, relay) = address_of(invite).ok_or(Unavailable::BadInvite)?;
    let mode = relay.map_or(RelayMode::Disabled, |relay| RelayMode::custom([relay]));
    let endpoint = bind(mode, false, Some(gm.id)).await?;
    let table = wire::new_local_id().map_err(|_| Unavailable::Network)?;
    let shared = Arc::new(PlayerShared {
        table: table.clone(),
        outbound: Mutex::default(),
        emit,
    });
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
        if !wire::is_request_id(&request_id) {
            return Delivery::NotDelivered;
        }
        self.send(Outgoing::Answer { request_id, answer })
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

    fn view(value: Value) -> Map<String, Value> {
        value.as_object().cloned().expect("an object")
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_player_the_gm_lets_in_is_seen_asked_and_answers() {
        let (gm_emit, mut gm_events) = listening();
        let (approve, asked) = answering(true);
        let (table, invite) = host("Thursday", &RelaySetting::None, gm_emit, approve)
            .await
            .expect("a table");
        let invite = Invite::from_text(&invite).expect("its invitation");
        assert_eq!(invite.name, "Thursday");
        assert!(invite.relay.is_none() && !invite.addrs.is_empty());

        let (player_emit, mut player_events) = listening();
        let seat = join(&invite, "Lira", player_emit).await.expect("a seat");

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
        let TableEvent::Answer {
            request_id,
            answer: got,
            participant: from,
            ..
        } = next(&mut gm_events).await
        else {
            panic!("the GM is answered");
        };
        assert_eq!(
            (request_id.as_str(), got, from),
            ("r-1", answer, participant.id.clone())
        );

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
        let (table, invite) = host("Thursday", &RelaySetting::None, gm_emit, approve)
            .await
            .expect("a table");
        let invite = Invite::from_text(&invite).expect("its invitation");
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
        let declined = join(&invite, "Lira", emit).await.expect("an endpoint");
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
        let stranger = join(&forged, "Mallory", emit).await.expect("an endpoint");
        assert_eq!(
            closed_for(next(&mut events).await),
            Some(CloseReason::Invite)
        );
        assert_eq!(locked(&asked).len(), 1);
        stranger.leave().await;

        // a shut door answers the old invitation the same way, and opening it makes a new one
        assert_eq!(table.set_door(false), None);
        let (emit, mut events) = listening();
        let late = join(&invite, "Lira", emit).await.expect("an endpoint");
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
        let (table, invite) = host("Thursday", &RelaySetting::None, gm_emit, approve)
            .await
            .expect("a table");
        let invite = Invite::from_text(&invite).expect("its invitation");
        let (emit, mut events) = listening();
        let seat = join(&invite, "Lira", emit).await.expect("a seat");
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
            v: PROTOCOL,
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
}

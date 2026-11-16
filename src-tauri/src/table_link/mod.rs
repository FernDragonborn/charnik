//! The table link's side of the IPC: the commands a seat calls and the one channel Rust pushes
//! events down. The connections themselves are `session.rs`; what crosses them is `wire.rs`.
//!
//! **No socket exists until a person says so in a native dialog.** Opening a table and joining one
//! each ask first, in a dialog the page cannot draw over or press, and so does letting a player in.
//! The page may name the language those are asked in and never the sentence (`build.rs` ▸
//! `NATIVE_ROOTS`); what it does supply — a table's name, a player's — is printed as quoted data,
//! stripped of anything that could reword the question (`wire::plain_text`).
//!
//! One seat at a time, held in memory: a table lives for a session, under a key made for it and
//! written nowhere.
//!
//! **The seat is the app's, not the page's.** A page that loads again finds the seat still held
//! and picks it up (`table_link_resume`): it is told again what the page before it was told and
//! still stands — who is at the table and the sheets they showed, the connection, the requests
//! nobody answered, the newest answers. That opens no socket and asks nobody, because the person
//! already said yes.
//!
//! The whole module sits behind the `table-link` Cargo feature, with its capability file
//! (`capabilities/table-link/`) and its entries in `build.rs`. A build without the feature has none
//! of the three, and the page learns that by calling: a command that is not there is refused.

pub mod question;
mod records;
mod remember;
mod session;
mod wire;

use std::sync::Arc;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{Emitter, Manager};

use crate::native_strings::native_string;
use records::Body;
use session::{
    Approve, Delivery, Emit, GmTable, PlayerSeat, RelaySetting, TableEvent, Unavailable,
};
use wire::{Invite, TableAnswer, TableRequest};

/// The one channel every table event travels on, told apart by its `kind`.
const TABLE_EVENT: &str = "table-link-event";
const MAIN_WINDOW: &str = "main";
/// Where the native dialogs' words sit in a catalog.
const NATIVE_KEY: &str = "table.native";

/// How many unanswered requests are kept for a page that is not there to answer them.
const TOLD_REQUESTS_MAX: usize = 12;
/// How many answers are kept for a GM's page that was not there to hear them: as many as the
/// asks it keeps on screen.
const TOLD_ANSWERS_MAX: usize = 50;

enum Seat {
    Gm {
        table: GmTable,
        /// The table's name, as the GM typed it.
        name: String,
        /// The invitation in force, or None while the door is shut.
        invite: Option<String>,
    },
    Player(PlayerSeat),
}

impl Seat {
    fn table(&self) -> &str {
        match self {
            Self::Gm { table, .. } => &table.id,
            Self::Player(seat) => &seat.id,
        }
    }
}

/// What the page has been told that still stands, in the order a page must hear it.
type Told = Arc<std::sync::Mutex<Vec<TableEvent>>>;

/// A seat, and what its page has been told.
struct Held {
    seat: Seat,
    told: Told,
}

/// The seat this app holds, if it holds one.
#[derive(Default)]
pub struct TableLinkState(tokio::sync::Mutex<Option<Held>>);

fn is_left(event: &TableEvent, id: &str) -> bool {
    matches!(event, TableEvent::ParticipantLeft { participant, .. } if participant == id)
}

fn is_joined(event: &TableEvent, id: &str) -> bool {
    matches!(event, TableEvent::ParticipantJoined { participant, .. } if participant.id == id)
}

fn is_view(event: &TableEvent, id: &str) -> bool {
    matches!(event, TableEvent::View { participant, .. } if participant == id)
}

fn is_request(event: &TableEvent) -> bool {
    matches!(event, TableEvent::Request { .. })
}

fn is_answer(event: &TableEvent) -> bool {
    matches!(event, TableEvent::Answer { .. })
}

fn is_record(event: &TableEvent) -> bool {
    matches!(event, TableEvent::Record { .. })
}

/// Keep an event for a page that loads again, in place of whatever it makes untrue. The newest
/// answers are kept as they came: the GM's page keeps its own log of asks, and one that was not
/// there when an answer landed finds it here.
fn remember(told: &mut Vec<TableEvent>, event: &TableEvent) {
    match event {
        TableEvent::ParticipantJoined { participant, .. } => {
            told.retain(|kept| !is_left(kept, &participant.id));
            // in place, so the sheet they showed still comes after them
            if let Some(seated) = told
                .iter_mut()
                .find(|kept| is_joined(kept, &participant.id))
            {
                *seated = event.clone();
                return;
            }
        }
        TableEvent::ParticipantLeft { participant, .. } => {
            told.retain(|kept| !is_left(kept, participant));
        }
        TableEvent::View { participant, .. } => told.retain(|kept| !is_view(kept, participant)),
        TableEvent::Connection { .. } => {
            told.retain(|kept| !matches!(kept, TableEvent::Connection { .. }));
        }
        TableEvent::Request { .. } => {
            if told.iter().filter(|kept| is_request(kept)).count() >= TOLD_REQUESTS_MAX {
                return;
            }
        }
        TableEvent::Answer { .. } => {
            if told.iter().filter(|kept| is_answer(kept)).count() >= TOLD_ANSWERS_MAX {
                if let Some(oldest) = told.iter().position(is_answer) {
                    told.remove(oldest);
                }
            }
        }
        // the log the session holds, as the page was told it: the same bound, the oldest first out
        TableEvent::Record { .. } => {
            if told.iter().filter(|kept| is_record(kept)).count() >= records::LOG_MAX {
                if let Some(oldest) = told.iter().position(is_record) {
                    told.remove(oldest);
                }
            }
        }
    }
    told.push(event.clone());
}

/// A participant the GM sent away is nobody a page should hear of again.
fn forget_participant(told: &mut Vec<TableEvent>, id: &str) {
    told.retain(|kept| {
        let answered = matches!(kept, TableEvent::Answer { participant, .. } if participant == id);
        !is_joined(kept, id) && !is_left(kept, id) && !is_view(kept, id) && !answered
    });
}

/// A request that was answered waits for nobody.
fn forget_request(told: &mut Vec<TableEvent>, id: &str) {
    told.retain(|kept| !matches!(kept, TableEvent::Request { request_id, .. } if request_id == id));
}

/// A lock a panicking holder left behind still guards a list that is only ever whole.
fn told_of(told: &Told) -> std::sync::MutexGuard<'_, Vec<TableEvent>> {
    told.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// What `resume` answers: the seat still held, and what to tell its page again.
#[derive(Serialize)]
#[serde(
    tag = "role",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Resumed {
    Gm {
        table: String,
        name: String,
        invite: Option<String>,
        told: Vec<TableEvent>,
    },
    Player {
        table: String,
        code: String,
        told: Vec<TableEvent>,
    },
}

/// What `host` and `join` answer.
#[derive(Serialize)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Seating {
    Seated {
        table: String,
        /// A GM's seat: what to hand a player.
        invite: Option<String>,
        /// A player's seat: the digits to read to the GM.
        code: Option<String>,
    },
    Unavailable {
        reason: Unavailable,
    },
}

/// One native question, with its words taken from the catalog compiled into the binary.
struct Question {
    /// The dialog's key under `NATIVE_KEY`.
    dialog: &'static str,
    locale: String,
    /// What the body's `{placeholders}` are filled with.
    values: Vec<(&'static str, String)>,
}

impl Question {
    fn said(&self, field: &str) -> &'static str {
        native_string(
            &self.locale,
            &format!("{NATIVE_KEY}.{}.{field}", self.dialog),
        )
    }

    /// The body with its `{placeholders}` filled in one pass over the catalog's words, so a value
    /// that itself reads `{code}` is printed as it is and never filled in again.
    fn body(&self) -> String {
        let template = self.said("body");
        let mut out = String::with_capacity(template.len());
        let mut rest = template;
        while let Some(open) = rest.find('{') {
            out.push_str(&rest[..open]);
            let after = &rest[open + 1..];
            let filled = after.find('}').and_then(|close| {
                let (_, value) = self
                    .values
                    .iter()
                    .find(|(key, _)| *key == &after[..close])?;
                Some((value.as_str(), close))
            });
            match filled {
                Some((value, close)) => {
                    out.push_str(value);
                    rest = &after[close + 1..];
                }
                None => {
                    out.push('{');
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        out
    }

    /// Ask it in the question window and wait for the answer. A window that could not be shown,
    /// or was closed unanswered, is a no.
    async fn ask(self, app: tauri::AppHandle) -> bool {
        let words = question::Words {
            title: self.said("title").to_string(),
            body: self.body(),
            allow: self.said("allow").to_string(),
            deny: self.said("deny").to_string(),
            locale: self.locale.clone(),
        };
        question::ask(&app, words).await
    }
}

/// A sentence of a dialog that is itself chosen by the situation: which route the table takes.
fn route_sentence(locale: &str, key: &str, relay: Option<&str>) -> String {
    native_string(locale, &format!("{NATIVE_KEY}.{key}")).replace("{relay}", relay.unwrap_or(""))
}

/// A relay as the dialogs name it: its host, which is what a person can recognise.
fn relay_host(url: &str) -> Option<String> {
    Some(session::parse_relay(url)?.host_str()?.to_string())
}

fn emitter(app: &tauri::AppHandle, told: &Told) -> Emit {
    let (app, told) = (app.clone(), told.clone());
    Arc::new(move |event| {
        remember(&mut told_of(&told), &event);
        // best-effort: a window that is not listening has no table screen to be wrong
        let _ = app.emit_to(MAIN_WINDOW, TABLE_EVENT, event);
    })
}

/// The shelf of remembered tables, where this build can remember one. One for the app, so every
/// writer to it holds the same lock.
fn shelf(app: &tauri::AppHandle) -> Option<remember::Shelf> {
    static SHELF: std::sync::OnceLock<Option<remember::Shelf>> = std::sync::OnceLock::new();
    SHELF
        .get_or_init(|| {
            let folder = app.path().app_local_data_dir().ok()?.join("tables");
            Some(remember::Shelf::new(folder, remember::os_vault()?))
        })
        .clone()
}

/// What a session asks to keep goes onto the shelf, or nowhere where there is none.
fn keeper(shelf: Option<&remember::Shelf>, id: &str) -> session::Keeper {
    shelf.map_or_else(
        || Arc::new(|_| {}) as session::Keeper,
        |shelf| shelf.keeper(id),
    )
}

/// The GM's yes or no to somebody at the door, asked natively.
fn approver(app: &tauri::AppHandle, locale: &str) -> Approve {
    let (app, locale) = (app.clone(), locale.to_string());
    Arc::new(move |request| {
        let question = Question {
            dialog: "approve",
            locale: locale.clone(),
            values: vec![
                ("player", request.player),
                ("table", request.table),
                ("code", request.code),
            ],
        };
        Box::pin(question.ask(app.clone()))
    })
}

/// Open a table as its GM.
#[tauri::command]
pub async fn table_link_host(
    app: tauri::AppHandle,
    name: String,
    relay: RelaySetting,
    locale: String,
) -> Seating {
    let unavailable = |reason| Seating::Unavailable { reason };
    let state = app.state::<TableLinkState>();
    let mut seat = state.0.lock().await;
    if seat.is_some() {
        return unavailable(Unavailable::AlreadySeated);
    }
    let name = wire::plain_text(&name);
    if name.is_empty() {
        return unavailable(Unavailable::BadName);
    }
    let route = match &relay {
        RelaySetting::N0 => route_sentence(&locale, "hostRoute.n0", None),
        RelaySetting::None => route_sentence(&locale, "hostRoute.none", None),
        RelaySetting::Custom { url } => match relay_host(url) {
            Some(host) => route_sentence(&locale, "hostRoute.custom", Some(&host)),
            None => return unavailable(Unavailable::BadRelay),
        },
    };
    let question = Question {
        dialog: "host",
        locale: locale.clone(),
        values: vec![("table", name.clone()), ("route", route)],
    };
    if !question.ask(app.clone()).await {
        return unavailable(Unavailable::Cancelled);
    }
    let told = Told::default();
    let emit = emitter(&app, &told);
    let Ok(id) = wire::new_local_id() else {
        return unavailable(Unavailable::Network);
    };
    let shelf = shelf(&app);
    let keep = keeper(shelf.as_ref(), &id);
    match session::host(
        id.clone(),
        &name,
        &relay,
        emit,
        approver(&app, &locale),
        keep,
        None,
    )
    .await
    {
        Ok((table, invite)) => {
            if let Some(shelf) = &shelf {
                let kept = remember::KeptSeat::Gm {
                    name: name.clone(),
                    relay: relay.clone(),
                    allowed: vec![],
                };
                shelf.put(&id, &kept, table.key());
            }
            *seat = Some(Held {
                seat: Seat::Gm {
                    table,
                    name,
                    invite: invite.clone(),
                },
                told,
            });
            Seating::Seated {
                table: id,
                invite,
                code: None,
            }
        }
        Err(reason) => unavailable(reason),
    }
}

/// Sit at a table as a player.
#[tauri::command]
pub async fn table_link_join(
    app: tauri::AppHandle,
    invite: String,
    name: String,
    locale: String,
) -> Seating {
    let unavailable = |reason| Seating::Unavailable { reason };
    let state = app.state::<TableLinkState>();
    let mut seat = state.0.lock().await;
    if seat.is_some() {
        return unavailable(Unavailable::AlreadySeated);
    }
    let name = wire::plain_text(&name);
    if name.is_empty() {
        return unavailable(Unavailable::BadName);
    }
    let Some(invite) = Invite::from_text(&invite).filter(session::is_followable) else {
        return unavailable(Unavailable::BadInvite);
    };
    let route = match invite.relay.as_deref().and_then(relay_host) {
        Some(host) => route_sentence(&locale, "joinRoute.relay", Some(&host)),
        None => route_sentence(&locale, "joinRoute.direct", None),
    };
    let question = Question {
        dialog: "join",
        locale,
        values: vec![
            ("table", invite.name.clone()),
            ("player", name.clone()),
            ("route", route),
        ],
    };
    if !question.ask(app.clone()).await {
        return unavailable(Unavailable::Cancelled);
    }
    let told = Told::default();
    let Ok(id) = wire::new_local_id() else {
        return unavailable(Unavailable::Network);
    };
    let shelf = shelf(&app);
    match session::join(
        id.clone(),
        &invite,
        &name,
        emitter(&app, &told),
        keeper(shelf.as_ref(), &id),
        None,
    )
    .await
    {
        Ok(player) => {
            if let Some(shelf) = &shelf {
                let kept = remember::KeptSeat::Player {
                    invite: invite.to_text(),
                    name: name.clone(),
                };
                shelf.put(&id, &kept, player.key());
            }
            let (table, code) = (player.id.clone(), player.code.clone());
            *seat = Some(Held {
                seat: Seat::Player(player),
                told,
            });
            Seating::Seated {
                table,
                invite: None,
                code: Some(code),
            }
        }
        Err(reason) => unavailable(reason),
    }
}

/// Give the seat up: a GM's table closes for everyone at it, a player's seat is left.
#[tauri::command]
pub async fn table_link_leave(app: tauri::AppHandle, table: String) {
    let state = app.state::<TableLinkState>();
    let mut held = state.0.lock().await;
    if held.as_ref().is_some_and(|held| held.seat.table() == table) {
        // leaving is for good: the table is not offered back next time
        if let Some(shelf) = shelf(&app) {
            shelf.forget(&table);
        }
        match held.take().map(|held| held.seat) {
            Some(Seat::Gm { table, .. }) => table.close().await,
            Some(Seat::Player(player)) => player.leave().await,
            None => {}
        }
    }
}

/// The tables this app sat at and did not leave: what it can return to after a restart.
#[tauri::command]
pub async fn table_link_remembered(app: tauri::AppHandle) -> Vec<remember::Shelved> {
    shelf(&app).map(|shelf| shelf.list()).unwrap_or_default()
}

/// Take a table off the shelf, key and records with it.
#[tauri::command]
pub async fn table_link_forget(app: tauri::AppHandle, table: String) {
    let held = app.state::<TableLinkState>();
    // the table this app is seated at is left, not forgotten from under it
    if held
        .0
        .lock()
        .await
        .as_ref()
        .is_some_and(|held| held.seat.table() == table)
    {
        return;
    }
    if let Some(shelf) = shelf(&app) {
        shelf.forget(&table);
    }
}

/// Go back to a table this app sat at before it went down, under the key it sat under. Nothing
/// dials until the person says yes, as going online always asks.
#[tauri::command]
pub async fn table_link_return(app: tauri::AppHandle, table: String, locale: String) -> Seating {
    let unavailable = |reason| Seating::Unavailable { reason };
    let state = app.state::<TableLinkState>();
    let mut seat = state.0.lock().await;
    if seat.is_some() {
        return unavailable(Unavailable::AlreadySeated);
    }
    let Some(shelf) = shelf(&app) else {
        return unavailable(Unavailable::Forgotten);
    };
    let Some((kept, again)) = shelf.take(&table) else {
        return unavailable(Unavailable::Forgotten);
    };
    let (name, route) = match &kept {
        remember::KeptSeat::Gm { name, relay, .. } => {
            let route = match relay {
                RelaySetting::N0 => route_sentence(&locale, "hostRoute.n0", None),
                RelaySetting::None => route_sentence(&locale, "hostRoute.none", None),
                RelaySetting::Custom { url } => {
                    route_sentence(&locale, "hostRoute.custom", relay_host(url).as_deref())
                }
            };
            (name.clone(), route)
        }
        remember::KeptSeat::Player { invite, .. } => {
            let Some(invite) = Invite::from_text(invite) else {
                return unavailable(Unavailable::BadInvite);
            };
            let route = match invite.relay.as_deref().and_then(relay_host) {
                Some(host) => route_sentence(&locale, "joinRoute.relay", Some(&host)),
                None => route_sentence(&locale, "joinRoute.direct", None),
            };
            (invite.name, route)
        }
    };
    let question = Question {
        dialog: "return",
        locale: locale.clone(),
        values: vec![("table", name.clone()), ("route", route)],
    };
    if !question.ask(app.clone()).await {
        return unavailable(Unavailable::Cancelled);
    }
    let told = Told::default();
    let keep = shelf.keeper(&table);
    match kept {
        remember::KeptSeat::Gm { relay, .. } => {
            let emit = emitter(&app, &told);
            let approve = approver(&app, &locale);
            match session::host(table, &name, &relay, emit, approve, keep, Some(again)).await {
                Ok((gm, invite)) => {
                    let id = gm.id.clone();
                    *seat = Some(Held {
                        seat: Seat::Gm {
                            table: gm,
                            name,
                            invite: invite.clone(),
                        },
                        told,
                    });
                    Seating::Seated {
                        table: id,
                        invite,
                        code: None,
                    }
                }
                Err(reason) => unavailable(reason),
            }
        }
        remember::KeptSeat::Player { invite, name } => {
            let Some(invite) = Invite::from_text(&invite) else {
                return unavailable(Unavailable::BadInvite);
            };
            let emit = emitter(&app, &told);
            match session::join(table, &invite, &name, emit, keep, Some(again)).await {
                Ok(player) => {
                    let (id, code) = (player.id.clone(), player.code.clone());
                    *seat = Some(Held {
                        seat: Seat::Player(player),
                        told,
                    });
                    Seating::Seated {
                        table: id,
                        invite: None,
                        code: Some(code),
                    }
                }
                Err(reason) => unavailable(reason),
            }
        }
    }
}

/// The seat this app still holds, for a page that has loaded again and knows of none.
#[tauri::command]
pub async fn table_link_resume(app: tauri::AppHandle) -> Option<Resumed> {
    let state = app.state::<TableLinkState>();
    let held = state.0.lock().await;
    let held = held.as_ref()?;
    let told = told_of(&held.told).clone();
    Some(match &held.seat {
        Seat::Gm {
            table,
            name,
            invite,
        } => Resumed::Gm {
            table: table.id.clone(),
            name: name.clone(),
            invite: invite.clone(),
            told,
        },
        Seat::Player(seat) => Resumed::Player {
            table: seat.id.clone(),
            code: seat.code.clone(),
            told,
        },
    })
}

/// A player says what is true of their character now.
#[tauri::command]
pub async fn table_link_publish(
    app: tauri::AppHandle,
    table: String,
    view: Map<String, Value>,
) -> Delivery {
    match &*app.state::<TableLinkState>().0.lock().await {
        Some(Held {
            seat: Seat::Player(seat),
            ..
        }) if seat.id == table => seat.publish(view),
        _ => Delivery::NotDelivered,
    }
}

/// A player whose connection dropped asks for a dial now, in place of the wait before the next.
#[tauri::command]
pub async fn table_link_redial(app: tauri::AppHandle, table: String) {
    if let Some(Held {
        seat: Seat::Player(seat),
        ..
    }) = &*app.state::<TableLinkState>().0.lock().await
    {
        if seat.id == table {
            seat.redial();
        }
    }
}

/// A player answers a request.
#[tauri::command]
pub async fn table_link_respond(
    app: tauri::AppHandle,
    table: String,
    request_id: String,
    answer: TableAnswer,
) -> Delivery {
    match &*app.state::<TableLinkState>().0.lock().await {
        Some(Held {
            seat: Seat::Player(seat),
            told,
        }) if seat.id == table => {
            forget_request(&mut told_of(told), &request_id);
            seat.respond(request_id, answer)
        }
        _ => Delivery::NotDelivered,
    }
}

/// A GM asks something of one participant.
#[tauri::command]
pub async fn table_link_request(
    app: tauri::AppHandle,
    table: String,
    participant: String,
    request_id: String,
    request: TableRequest,
) -> Delivery {
    match &*app.state::<TableLinkState>().0.lock().await {
        Some(Held {
            seat: Seat::Gm { table: gm, .. },
            ..
        }) if gm.id == table => gm.request(&participant, request_id, request),
        _ => Delivery::NotDelivered,
    }
}

/// Write a record into the table's log as this app's seat: a roll, or a hide.
#[tauri::command]
pub async fn table_link_record(app: tauri::AppHandle, table: String, body: Body) -> Delivery {
    match &*app.state::<TableLinkState>().0.lock().await {
        Some(Held {
            seat: Seat::Gm { table: gm, .. },
            ..
        }) if gm.id == table => gm.record(body),
        Some(Held {
            seat: Seat::Player(seat),
            ..
        }) if seat.id == table => seat.record(body),
        _ => Delivery::NotDelivered,
    }
}

/// A GM takes a participant's seat away.
#[tauri::command]
pub async fn table_link_dismiss(app: tauri::AppHandle, table: String, participant: String) {
    if let Some(Held {
        seat: Seat::Gm { table: gm, .. },
        told,
    }) = &*app.state::<TableLinkState>().0.lock().await
    {
        if gm.id == table {
            gm.dismiss(&participant);
            forget_participant(&mut told_of(told), &participant);
        }
    }
}

/// A GM opens the door — answering the new invitation — or shuts it.
#[tauri::command]
pub async fn table_link_door(app: tauri::AppHandle, table: String, open: bool) -> Option<String> {
    match &mut *app.state::<TableLinkState>().0.lock().await {
        Some(Held {
            seat: Seat::Gm {
                table: gm, invite, ..
            },
            ..
        }) if gm.id == table => {
            *invite = gm.set_door(open);
            invite.clone()
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_strings::NATIVE_LOCALES;

    #[test]
    fn every_bundled_locale_words_every_native_question() {
        let placeholders: [(&str, &[&str]); 4] = [
            ("host", &["{table}", "{route}"]),
            ("join", &["{table}", "{player}", "{route}"]),
            ("approve", &["{table}", "{player}", "{code}"]),
            ("return", &["{table}", "{route}"]),
        ];
        for locale in NATIVE_LOCALES {
            for (dialog, names) in placeholders {
                let question = Question {
                    dialog,
                    locale: (*locale).to_string(),
                    values: vec![],
                };
                for field in ["title", "allow", "deny"] {
                    assert!(
                        !question.said(field).is_empty(),
                        "{locale} {dialog}.{field}"
                    );
                }
                for name in names {
                    assert!(
                        question.said("body").contains(name),
                        "{locale} {dialog} {name}"
                    );
                }
            }
            for route in ["hostRoute.n0", "hostRoute.none", "joinRoute.direct"] {
                assert!(
                    !route_sentence(locale, route, None).is_empty(),
                    "{locale} {route}"
                );
            }
            for route in ["hostRoute.custom", "joinRoute.relay"] {
                let said = route_sentence(locale, route, Some("relay.example.org"));
                assert!(said.contains("relay.example.org"), "{locale} {route}");
            }
        }
    }

    fn joined(id: &str, name: &str) -> TableEvent {
        TableEvent::ParticipantJoined {
            table: "t".into(),
            participant: session::Participant {
                id: id.into(),
                name: name.into(),
            },
        }
    }

    fn left(id: &str) -> TableEvent {
        TableEvent::ParticipantLeft {
            table: "t".into(),
            participant: id.into(),
        }
    }

    fn showed(id: &str, hp: u32) -> TableEvent {
        TableEvent::View {
            table: "t".into(),
            participant: id.into(),
            view: serde_json::json!({ "hp": hp }),
        }
    }

    fn asked(request_id: &str) -> TableEvent {
        TableEvent::Request {
            table: "t".into(),
            request_id: request_id.into(),
            request: TableRequest::Heal { amount: 3 },
        }
    }

    fn connection(state: session::ConnectionState) -> TableEvent {
        TableEvent::Connection {
            table: Some("t".into()),
            state,
            reason: None,
        }
    }

    /// Events as the JSON a page receives: `TableEvent` has no equality of its own.
    fn as_json(events: &[TableEvent]) -> Vec<Value> {
        events
            .iter()
            .map(|event| serde_json::to_value(event).expect("an event is JSON"))
            .collect()
    }

    fn answered(participant: &str, request_id: &str) -> TableEvent {
        TableEvent::Answer {
            table: "t".into(),
            participant: participant.into(),
            request_id: request_id.into(),
            answer: TableAnswer {
                outcome: wire::AnswerOutcome::Declined,
                roll: None,
            },
        }
    }

    /// What a page that loads again is told after these.
    fn retold(events: &[TableEvent]) -> Vec<Value> {
        let mut told = Vec::new();
        for event in events {
            remember(&mut told, event);
        }
        as_json(&told)
    }

    #[test]
    fn a_page_that_loads_again_hears_the_table_as_it_stands() {
        // a player who came, showed two sheets, dropped and came back under a new name is one
        // player with their last sheet, heard of before it
        assert_eq!(
            retold(&[
                joined("a", "Ann"),
                showed("a", 7),
                joined("b", "Bo"),
                left("a"),
                showed("a", 5),
                joined("a", "Anna"),
            ]),
            as_json(&[joined("a", "Anna"), joined("b", "Bo"), showed("a", 5)]),
        );
        // one who is away is still at the table, and said to be away once
        assert_eq!(
            retold(&[joined("a", "Ann"), left("a"), left("a")]),
            as_json(&[joined("a", "Ann"), left("a")]),
        );
        // the connection is the last one said; an answer is kept for a page that missed it
        assert_eq!(
            retold(&[
                connection(session::ConnectionState::Connecting),
                answered("a", "r"),
                connection(session::ConnectionState::Connected),
            ]),
            as_json(&[
                answered("a", "r"),
                connection(session::ConnectionState::Connected)
            ]),
        );
    }

    #[test]
    fn the_newest_answers_are_kept_and_no_more_than_a_page_shows() {
        let mut told = Vec::new();
        remember(&mut told, &joined("a", "Ann"));
        for n in 0..TOLD_ANSWERS_MAX + 3 {
            remember(&mut told, &answered("a", &format!("r{n}")));
        }
        let kept: Vec<Value> = as_json(&told).into_iter().skip(1).collect();
        assert_eq!(kept.len(), TOLD_ANSWERS_MAX);
        assert_eq!(kept[0]["requestId"], "r3");
        assert_eq!(
            kept[TOLD_ANSWERS_MAX - 1]["requestId"],
            format!("r{}", TOLD_ANSWERS_MAX + 2)
        );

        // what somebody who was sent away answered goes with them
        remember(&mut told, &answered("b", "other"));
        forget_participant(&mut told, "a");
        assert_eq!(as_json(&told), as_json(&[answered("b", "other")]));
    }

    #[test]
    fn what_is_over_is_not_told_again() {
        let mut told = Vec::new();
        for event in [
            joined("a", "Ann"),
            showed("a", 7),
            joined("b", "Bo"),
            asked("r1"),
            asked("r2"),
        ] {
            remember(&mut told, &event);
        }
        forget_participant(&mut told, "a");
        forget_request(&mut told, "r1");
        assert_eq!(as_json(&told), as_json(&[joined("b", "Bo"), asked("r2")]));

        // a GM's app cannot fill the memory of a player whose page is not there to answer
        for n in 0..TOLD_REQUESTS_MAX * 2 {
            remember(&mut told, &asked(&format!("more-{n}")));
        }
        assert_eq!(
            told.iter().filter(|kept| is_request(kept)).count(),
            TOLD_REQUESTS_MAX
        );
    }

    #[test]
    fn a_question_prints_what_it_was_given_as_data() {
        let question = Question {
            dialog: "approve",
            locale: "en".into(),
            values: vec![
                ("player", "Lira".into()),
                ("table", "Thursday".into()),
                ("code", "123-456".into()),
            ],
        };
        let body = question.body();
        assert!(
            body.contains("\"Lira\"") && body.contains("\"Thursday\"") && body.contains("123-456")
        );
        assert!(!body.contains('{'));

        // a name that reads like a placeholder is printed as it is, not filled in again
        let sly = Question {
            dialog: "approve",
            locale: "en".into(),
            values: vec![
                ("player", "{code}".into()),
                ("table", "Thursday".into()),
                ("code", "123-456".into()),
            ],
        };
        assert!(sly.body().contains("\"{code}\" wants to join"));
    }
}

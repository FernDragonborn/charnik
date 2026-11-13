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
//! The whole module sits behind the `table-link` Cargo feature, with its capability file
//! (`capabilities/table-link/`) and its entries in `build.rs`. A build without the feature has none
//! of the three, and the page learns that by calling: a command that is not there is refused.

mod session;
mod wire;

use std::sync::Arc;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::native_strings::native_string;
use session::{Approve, Delivery, Emit, GmTable, PlayerSeat, RelaySetting, Unavailable};
use wire::{Invite, TableAnswer, TableRequest};

/// The one channel every table event travels on, told apart by its `kind`.
const TABLE_EVENT: &str = "table-link-event";
const MAIN_WINDOW: &str = "main";
/// Where the native dialogs' words sit in a catalog.
const NATIVE_KEY: &str = "table.native";

enum Seat {
    Gm(GmTable),
    Player(PlayerSeat),
}

impl Seat {
    fn table(&self) -> &str {
        match self {
            Self::Gm(table) => &table.id,
            Self::Player(seat) => &seat.id,
        }
    }
}

/// The seat this app holds, if it holds one.
#[derive(Default)]
pub struct TableLinkState(tokio::sync::Mutex<Option<Seat>>);

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

    fn body(&self) -> String {
        self.values
            .iter()
            .fold(self.said("body").to_string(), |body, (name, value)| {
                body.replace(&format!("{{{name}}}"), value)
            })
    }

    /// Ask it and wait for the answer. A dialog that could not be shown is a no.
    async fn ask(self, app: tauri::AppHandle) -> bool {
        let asking = tauri::async_runtime::spawn_blocking(move || {
            let mut dialog = app
                .dialog()
                .message(self.body())
                .title(self.said("title"))
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    self.said("allow").into(),
                    self.said("deny").into(),
                ));
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                dialog = dialog.parent(&window);
            }
            dialog.blocking_show()
        });
        asking.await.unwrap_or(false)
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

fn emitter(app: &tauri::AppHandle) -> Emit {
    let app = app.clone();
    Arc::new(move |event| {
        // best-effort: a window that is not listening has no table screen to be wrong
        let _ = app.emit_to(MAIN_WINDOW, TABLE_EVENT, event);
    })
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
        return unavailable(Unavailable::Declined);
    }
    match session::host(&name, &relay, emitter(&app), approver(&app, &locale)).await {
        Ok((table, invite)) => {
            let id = table.id.clone();
            *seat = Some(Seat::Gm(table));
            Seating::Seated {
                table: id,
                invite: Some(invite),
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
        return unavailable(Unavailable::Declined);
    }
    match session::join(&invite, &name, emitter(&app)).await {
        Ok(player) => {
            let (table, code) = (player.id.clone(), player.code.clone());
            *seat = Some(Seat::Player(player));
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
    let mut seat = state.0.lock().await;
    if seat.as_ref().is_some_and(|seat| seat.table() == table) {
        match seat.take() {
            Some(Seat::Gm(table)) => table.close().await,
            Some(Seat::Player(player)) => player.leave().await,
            None => {}
        }
    }
}

/// A player says what is true of their character now.
#[tauri::command]
pub async fn table_link_publish(
    app: tauri::AppHandle,
    table: String,
    view: Map<String, Value>,
) -> Delivery {
    match &*app.state::<TableLinkState>().0.lock().await {
        Some(Seat::Player(seat)) if seat.id == table => seat.publish(view),
        _ => Delivery::NotDelivered,
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
        Some(Seat::Player(seat)) if seat.id == table => seat.respond(request_id, answer),
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
        Some(Seat::Gm(gm)) if gm.id == table => gm.request(&participant, request_id, request),
        _ => Delivery::NotDelivered,
    }
}

/// A GM takes a participant's seat away.
#[tauri::command]
pub async fn table_link_dismiss(app: tauri::AppHandle, table: String, participant: String) {
    if let Some(Seat::Gm(gm)) = &*app.state::<TableLinkState>().0.lock().await {
        if gm.id == table {
            gm.dismiss(&participant);
        }
    }
}

/// A GM opens the door — answering the new invitation — or shuts it.
#[tauri::command]
pub async fn table_link_door(app: tauri::AppHandle, table: String, open: bool) -> Option<String> {
    match &*app.state::<TableLinkState>().0.lock().await {
        Some(Seat::Gm(gm)) if gm.id == table => gm.set_door(open),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_strings::NATIVE_LOCALES;

    #[test]
    fn every_bundled_locale_words_every_native_question() {
        let placeholders: [(&str, &[&str]); 3] = [
            ("host", &["{table}", "{route}"]),
            ("join", &["{table}", "{player}", "{route}"]),
            ("approve", &["{table}", "{player}", "{code}"]),
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
    }
}

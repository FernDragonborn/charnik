//! The table link's side of the IPC: the commands a seat calls and the one channel Rust pushes
//! events down. There is no transport, so no call reaches anyone — a seat is never given and every
//! delivery answers that it was not made.
//!
//! The whole module sits behind the `table-link` Cargo feature, with its capability file
//! (`capabilities/table-link/`) and its entries in `build.rs`. A build without the feature has none
//! of the three, and the page learns that by calling: a command that is not there is refused.

// the arguments are the contract a transport will read; nothing reads them until one exists
#![allow(unused_variables)]

use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// The one channel every table event travels on, told apart by its `kind`.
const TABLE_EVENT: &str = "table-link-event";
const MAIN_WINDOW: &str = "main";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    id: String,
    name: String,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Unavailable,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Delivery {
    NotDelivered,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestedRoll {
    AbilityCheck,
    SavingThrow,
    Skill,
}

/// What a GM may ask of a player. Catalog ids and numbers only — never an effect token or a dice
/// formula, which would be a program handed to somebody else's sheet.
#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TableRequest {
    Damage {
        amount: u32,
        #[serde(rename = "type")]
        damage_type: Option<String>,
    },
    Heal {
        amount: u32,
    },
    Effect {
        id: String,
    },
    Roll {
        roll: RequestedRoll,
        id: String,
        dc: Option<u32>,
    },
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnswerOutcome {
    Accepted,
    Declined,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableAnswer {
    outcome: AnswerOutcome,
    /// The roll that was made, as the player's roller recorded it.
    roll: Option<serde_json::Value>,
}

/// Everything Rust tells the page about a table.
// only `Connection` is ever sent: the other five wait on a transport to have something to say
#[allow(dead_code)]
#[derive(Clone, Serialize)]
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
        character: serde_json::Value,
        view: serde_json::Value,
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
    },
}

/// Say that no table can be reached, on the channel a transport's own news will use.
fn announce_unavailable(app: &tauri::AppHandle) {
    // best-effort: a window that is not listening still gets the answer the call returns
    let _ = app.emit_to(
        MAIN_WINDOW,
        TABLE_EVENT,
        TableEvent::Connection {
            table: None,
            state: ConnectionState::Unavailable,
        },
    );
}

/// Open a table as its GM; the table's id, or None when no table can be opened.
#[tauri::command]
pub fn table_link_host(app: tauri::AppHandle, name: String) -> Option<String> {
    announce_unavailable(&app);
    None
}

/// Sit at a table as a player; the table's id, or None when it cannot be reached.
#[tauri::command]
pub fn table_link_join(app: tauri::AppHandle, invite: String) -> Option<String> {
    announce_unavailable(&app);
    None
}

#[tauri::command]
pub fn table_link_leave(table: String) {}

/// A player says what is true of their character now.
#[tauri::command]
pub fn table_link_publish(
    table: String,
    character: serde_json::Value,
    view: serde_json::Value,
) -> Delivery {
    Delivery::NotDelivered
}

/// A player answers a request.
#[tauri::command]
pub fn table_link_respond(table: String, request_id: String, answer: TableAnswer) -> Delivery {
    Delivery::NotDelivered
}

/// A GM asks something of one participant.
#[tauri::command]
pub fn table_link_request(table: String, participant: String, request: TableRequest) -> Delivery {
    Delivery::NotDelivered
}

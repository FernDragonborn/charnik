//! What crosses between two apps at a table, and what is refused before it is believed: the frames
//! of the one stream a player opens, the invitation a GM hands out, and the cut of a view into the
//! keys that changed.
//!
//! Every peer is taken to be a modified build (`docs/internals/table-link.md` ▸ Who is trusted).
//! So a frame is bounded before it is read, parsed into closed types that refuse a field they do
//! not name, and bounded again in its values.

use std::collections::BTreeMap;

use data_encoding::BASE64URL_NOPAD;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::records::Signed;

/// The protocol's name on a connection. A peer speaking another is refused by the handshake.
pub const ALPN: &[u8] = b"charnik/table/1";
/// Said in the hello; a GM refuses a number it does not speak.
pub const PROTOCOL: u32 = 4;
pub const INVITE_VERSION: u32 = 2;

/// The hello is a name and a secret.
pub const HELLO_CAP: usize = 1024;
/// A GM says small things: a welcome, a request of ids and numbers, a goodbye — and hands on a
/// log record, whose 2 KiB of text can grow under escaping inside the frame.
pub const GM_FRAME_CAP: usize = 16 * 1024;
/// A whole view is about 25 KiB; this is the ceiling of one frame and of the view a GM keeps.
pub const VIEW_CAP: usize = 256 * 1024;

const NAME_MAX_CHARS: usize = 40;
const ID_MAX_CHARS: usize = 64;
const VIEW_MAX_KEYS: usize = 64;
const AMOUNT_MAX: u32 = 100_000;
const DC_MAX: u32 = 99;
const SECRET_BYTES: usize = 16;
const INVITE_PREFIX: &str = "charnik-table:";
const INVITE_MAX_CHARS: usize = 2048;
const INVITE_MAX_ADDRS: usize = 16;

/// A name as a person typed it, made safe to print in a question and on another screen: no
/// control characters, no line or paragraph separators, none of the invisible marks that reorder
/// or hide the text around them, no quotation mark to close the quotes a question prints it in,
/// and short.
pub fn plain_text(text: &str) -> String {
    let unprintable = |c: char| {
        matches!(
            c,
            '\u{00AD}'
                | '\u{061C}'
                | '\u{180E}'
                | '\u{200B}'..='\u{200F}'
                | '\u{2028}'..='\u{202E}'
                | '\u{2060}'..='\u{206F}'
                | '\u{FEFF}'
                | '"'
                | '«'
                | '»'
                | '“'
                | '”'
                | '„'
        )
    };
    text.chars()
        .filter(|c| !c.is_control() && !unprintable(*c))
        .take(NAME_MAX_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

/// A content id as the app writes one (`slug` in `character/schema.ts`).
fn is_slug(text: &str) -> bool {
    let lower_or_digit = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    let mut chars = text.chars();
    chars.next().is_some_and(lower_or_digit)
        && text.len() <= ID_MAX_CHARS
        && chars.all(|c| lower_or_digit(c) || c == '-' || c == '_')
}

/// A catalog key the page names a roll by (`combat.roll.save.dex`, `skillName.athletics`).
pub fn is_catalog_key(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= ID_MAX_CHARS
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// A request's id: minted by the GM's app, echoed by the player's.
pub fn is_request_id(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= ID_MAX_CHARS
        && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestedRoll {
    AbilityCheck,
    SavingThrow,
    Skill,
}

/// What a GM may ask of a player. Catalog ids and numbers only — never an effect token or a dice
/// formula, which would be a program handed to somebody else's sheet.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
        /// There when the GM announced it. Absent, never null: the page reads an absent field.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dc: Option<u32>,
    },
}

impl TableRequest {
    /// The values a closed shape still leaves open, held to what a table can mean.
    pub fn is_bounded(&self) -> bool {
        match self {
            Self::Damage {
                amount,
                damage_type,
            } => *amount <= AMOUNT_MAX && damage_type.as_deref().is_none_or(is_slug),
            Self::Heal { amount } => *amount <= AMOUNT_MAX,
            Self::Effect { id } => is_slug(id),
            Self::Roll { id, dc, .. } => is_slug(id) && dc.is_none_or(|dc| dc <= DC_MAX),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnswerOutcome {
    Accepted,
    Declined,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableAnswer {
    pub outcome: AnswerOutcome,
    /// The roll that was made, as the player's roller recorded it. Its shape is the page's to hold
    /// it to (`table-link/wire-schema.ts`); here it is bounded by its frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roll: Option<Value>,
}

/// Why a GM's app turned a player away.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Refusal {
    /// The invitation's secret is not the open door's, or the door is shut.
    Invite,
    /// The GM said no.
    Declined,
    Version,
    /// Every seat is taken, or too many are waiting to be let in.
    Full,
}

/// What a GM's app speaks, told to a seat refused for its version.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GmSpeaks {
    pub protocol: u32,
    pub version: String,
}

/// A hello from an app of another protocol, read for what every version's hello carries — a
/// strict read would fail on what that version added and leave its seat unanswered.
#[derive(Debug, Deserialize)]
pub struct LooseHello {
    pub frame: String,
    pub protocol: u32,
    #[serde(default)]
    pub secret: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
}

fn is_zero(skew: &i64) -> bool {
    *skew == 0
}

/// Why a GM's app ended a seat that was given.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Goodbye {
    TableClosed,
    Dismissed,
}

/// What a player's app sends, in the order a seat lives: one hello, then views and answers.
#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "frame",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PlayerFrame {
    Hello {
        protocol: u32,
        secret: String,
        name: String,
        /// The app's Charnik version, so a refusal for protocol can say whose app is older.
        version: String,
    },
    /// The top-level keys of the view that changed since the last one sent on this connection.
    View {
        set: Map<String, Value>,
        unset: Vec<String>,
    },
    /// This app's clock as the seat begins, so the GM's app knows how far it is off its own.
    Clock { now: u64 },
    /// One of this app's own log records.
    Record { record: Signed },
    /// The highest record number this app holds from each author.
    Have { have: BTreeMap<String, u64> },
}

/// What a GM's app sends.
#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "frame",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GmFrame {
    Welcome {
        table: String,
    },
    /// Its shape never changes, so a seat of any version reads why it was turned away.
    Refused {
        reason: Refusal,
        /// For a refusal for version: what the GM's app speaks.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        gm: Option<GmSpeaks>,
    },
    Request {
        record: Signed,
    },
    /// How far this seat's clock runs behind the GM's, in milliseconds.
    Clock {
        skew: i64,
    },
    /// A log record, with the name the GM let its author in under — none for the GM's own — and
    /// how far its author's clock runs behind the GM's.
    Record {
        record: Signed,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "is_zero")]
        skew: i64,
    },
    Have {
        have: BTreeMap<String, u64>,
    },
    Closed {
        reason: Goodbye,
    },
}

#[derive(Debug)]
pub enum FrameError {
    TooLarge,
    Malformed,
    /// The stream ended or the connection did.
    Closed,
}

/// One frame as bytes: its length, then its JSON.
pub fn encode<T: Serialize>(frame: &T, cap: usize) -> Result<Vec<u8>, FrameError> {
    let body = serde_json::to_vec(frame).map_err(|_| FrameError::Malformed)?;
    if body.len() > cap {
        return Err(FrameError::TooLarge);
    }
    let length = u32::try_from(body.len()).map_err(|_| FrameError::TooLarge)?;
    let mut bytes = length.to_be_bytes().to_vec();
    bytes.extend(body);
    Ok(bytes)
}

pub async fn write_frame<T: Serialize>(
    stream: &mut iroh::endpoint::SendStream,
    frame: &T,
    cap: usize,
) -> Result<(), FrameError> {
    let bytes = encode(frame, cap)?;
    stream
        .write_all(&bytes)
        .await
        .map_err(|_| FrameError::Closed)
}

/// Read one frame, refusing a length over `cap` before a byte of the body is read.
pub async fn read_frame<T: for<'de> Deserialize<'de>>(
    stream: &mut iroh::endpoint::RecvStream,
    cap: usize,
) -> Result<T, FrameError> {
    let mut length = [0u8; 4];
    stream
        .read_exact(&mut length)
        .await
        .map_err(|_| FrameError::Closed)?;
    let length = u32::from_be_bytes(length) as usize;
    if length > cap {
        return Err(FrameError::TooLarge);
    }
    let mut body = vec![0u8; length];
    stream
        .read_exact(&mut body)
        .await
        .map_err(|_| FrameError::Closed)?;
    serde_json::from_slice(&body).map_err(|_| FrameError::Malformed)
}

/// The keys of `now` that differ from `sent`, and the keys `sent` had that `now` lacks.
pub fn view_changes(
    sent: &Map<String, Value>,
    now: &Map<String, Value>,
) -> (Map<String, Value>, Vec<String>) {
    let set = now
        .iter()
        .filter(|(key, value)| sent.get(*key) != Some(value))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let unset = sent
        .keys()
        .filter(|key| !now.contains_key(*key))
        .cloned()
        .collect();
    (set, unset)
}

/// Lay a peer's changes over the view kept for them. False when what results is more than a view
/// may be — the peer is then no longer speaking the protocol.
pub fn merge_view(
    kept: &mut Map<String, Value>,
    set: Map<String, Value>,
    unset: &[String],
) -> bool {
    for key in unset {
        kept.remove(key);
    }
    kept.extend(set);
    kept.len() <= VIEW_MAX_KEYS
        && kept.keys().all(|key| key.len() <= ID_MAX_CHARS)
        && serde_json::to_vec(kept).is_ok_and(|bytes| bytes.len() <= VIEW_CAP)
}

/// A fresh join secret: 128 bits from the OS.
pub fn new_secret() -> Result<String, getrandom::Error> {
    let mut bytes = [0u8; SECRET_BYTES];
    getrandom::fill(&mut bytes)?;
    Ok(BASE64URL_NOPAD.encode(&bytes))
}

/// A short random id for a table or a seat, local to this app.
pub fn new_local_id() -> Result<String, getrandom::Error> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes)?;
    Ok(data_encoding::HEXLOWER.encode(&bytes))
}

/// How many leading zero bits a stranger's key must show against the open door before it may take
/// a greeting place: about 65 000 keys tried, a second or so of one core, once per table joined.
/// Strangers holding the greeting places with dials that never say hello each pay that, and one
/// without the invitation's secret cannot pay it at all.
const KNOCK_BITS_RELEASE: u32 = 16;
#[cfg(not(test))]
fn knock_bits() -> u32 {
    KNOCK_BITS_RELEASE
}
/// Small in a test build: an unoptimised key generation is slow, and the rule is the same. The
/// live drive's player is a test build knocking at the real app's door, so it pays the real price.
#[cfg(test)]
fn knock_bits() -> u32 {
    if std::env::var_os("CHARNIK_LIVE_TABLE").is_some() {
        KNOCK_BITS_RELEASE
    } else {
        4
    }
}
const KNOCK_DOMAIN: &[u8] = b"charnik/table/knock/1";

/// Does this key knock at this door: does the hash of the door's secret, the GM's key and the
/// joiner's key start with `knock_bits()` zero bits?
pub fn knocks(secret: &str, gm: &[u8; 32], joiner: &[u8; 32]) -> bool {
    let mut hasher = blake3::Hasher::new();
    hasher.update(KNOCK_DOMAIN);
    hasher.update(&(secret.len() as u64).to_le_bytes());
    hasher.update(secret.as_bytes());
    hasher.update(gm);
    hasher.update(joiner);
    leading_zero_bits(hasher.finalize().as_bytes()) >= knock_bits()
}

fn leading_zero_bits(bytes: &[u8]) -> u32 {
    let mut bits = 0;
    for byte in bytes {
        bits += byte.leading_zeros();
        if *byte != 0 {
            break;
        }
    }
    bits
}

/// Compare two secrets in time that does not depend on where they first differ.
pub fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |differing, (x, y)| differing | (x ^ y))
            == 0
}

/// The digits a player reads to the GM so the GM lets in the right person: six of them, from the
/// key the player's app holds at this table. A check against a mistaken identity, not a secret.
pub fn join_code(player_key: &[u8; 32]) -> String {
    let [a, b, c, d, ..] = *player_key;
    let digits = u32::from_be_bytes([a, b, c, d]) % 1_000_000;
    format!("{:03}-{:03}", digits / 1000, digits % 1000)
}

/// What a GM hands a player: where the table is, the key it must answer with, and the secret that
/// gets a join request as far as the GM's eyes. An address and a knock — not a seat.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Invite {
    pub v: u32,
    /// The GM's key at this table.
    pub id: String,
    /// The relay the table is reached through; absent at a table with none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay: Option<String>,
    /// The GM's own addresses, carried only by a table with no relay.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub addrs: Vec<std::net::SocketAddr>,
    pub secret: String,
    pub name: String,
}

impl Invite {
    pub fn to_text(&self) -> String {
        // a struct of strings and numbers always serialises
        let json = serde_json::to_vec(self).unwrap_or_default();
        format!("{INVITE_PREFIX}{}", BASE64URL_NOPAD.encode(&json))
    }

    /// The invitation a person pasted, or None when it is not one this app can follow.
    pub fn from_text(text: &str) -> Option<Self> {
        let text = text.trim();
        if text.len() > INVITE_MAX_CHARS {
            return None;
        }
        let json = BASE64URL_NOPAD
            .decode(text.strip_prefix(INVITE_PREFIX)?.as_bytes())
            .ok()?;
        let invite: Self = serde_json::from_slice(&json).ok()?;
        // a relay OR addresses, never both: the question names the route, and only one is named
        let reachable = invite.relay.is_some() == invite.addrs.is_empty();
        (invite.v == INVITE_VERSION && reachable && invite.addrs.len() <= INVITE_MAX_ADDRS).then(
            || Self {
                name: plain_text(&invite.name),
                ..invite
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn object(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap_or_default()
    }

    #[test]
    fn a_request_carrying_anything_but_ids_and_numbers_is_not_a_request() {
        let parse = |value: Value| serde_json::from_value::<TableRequest>(value);
        assert!(parse(json!({ "kind": "effect", "id": "poisoned" })).is_ok());
        assert!(parse(json!({ "kind": "effect", "id": "poisoned", "tokens": ["ac+5"] })).is_err());
        assert!(parse(json!({ "kind": "formula", "formula": "100d100" })).is_err());
        assert!(parse(json!({ "kind": "damage", "amount": -1, "type": null })).is_err());
    }

    #[test]
    fn a_request_is_held_to_what_a_table_can_mean() {
        let roll = |id: &str, dc| TableRequest::Roll {
            roll: RequestedRoll::Skill,
            id: id.into(),
            dc,
        };
        assert!(roll("stealth", Some(15)).is_bounded());
        assert!(!roll("stealth", Some(1000)).is_bounded());
        assert!(!roll("Not A Slug", None).is_bounded());
        assert!(!TableRequest::Heal { amount: u32::MAX }.is_bounded());
        let damage = |damage_type: Option<&str>| TableRequest::Damage {
            amount: 7,
            damage_type: damage_type.map(Into::into),
        };
        assert!(damage(None).is_bounded());
        assert!(damage(Some("fire")).is_bounded());
        assert!(!damage(Some("<b>fire</b>")).is_bounded());
    }

    #[test]
    fn a_frame_with_a_field_nobody_named_is_malformed() {
        let hello =
            json!({ "frame": "hello", "protocol": 1, "secret": "s", "name": "n", "version": "0" });
        assert!(serde_json::from_value::<PlayerFrame>(hello).is_ok());
        let extra = json!({ "frame": "hello", "protocol": 1, "secret": "s", "name": "n", "version": "0", "x": 1 });
        assert!(serde_json::from_value::<PlayerFrame>(extra).is_err());
        // a player's app cannot say what only a GM's says
        let request = json!({ "frame": "request", "requestId": "r", "request": { "kind": "heal", "amount": 1 } });
        assert!(serde_json::from_value::<PlayerFrame>(request).is_err());
    }

    #[test]
    fn a_frame_over_its_cap_is_not_encoded() {
        let frame = GmFrame::Welcome {
            table: "x".repeat(GM_FRAME_CAP),
        };
        assert!(matches!(
            encode(&frame, GM_FRAME_CAP),
            Err(FrameError::TooLarge)
        ));
        let bytes = encode(&GmFrame::Welcome { table: "t".into() }, GM_FRAME_CAP).unwrap();
        assert_eq!(
            u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize,
            bytes.len() - 4
        );
    }

    #[test]
    fn a_view_travels_as_the_keys_that_changed() {
        let sent = object(json!({ "hp": { "current": 9 }, "ac": 15, "gone": true }));
        let now = object(json!({ "hp": { "current": 4 }, "ac": 15, "new": 1 }));
        let (set, unset) = view_changes(&sent, &now);
        assert_eq!(
            Value::Object(set.clone()),
            json!({ "hp": { "current": 4 }, "new": 1 })
        );
        assert_eq!(unset, vec!["gone".to_string()]);

        let mut kept = sent;
        assert!(merge_view(&mut kept, set, &unset));
        assert_eq!(kept, now);
    }

    #[test]
    fn a_view_that_outgrows_a_view_is_refused() {
        let mut kept = Map::new();
        let many = (0..=VIEW_MAX_KEYS)
            .map(|i| (format!("k{i}"), json!(1)))
            .collect();
        assert!(!merge_view(&mut kept, many, &[]));

        let mut kept = Map::new();
        let heavy = object(json!({ "notes": "x".repeat(VIEW_CAP) }));
        assert!(!merge_view(&mut kept, heavy, &[]));
    }

    #[test]
    fn an_invitation_survives_being_pasted_and_nothing_else_is_one() {
        let invite = Invite {
            v: INVITE_VERSION,
            id: "k".repeat(64),
            relay: Some("https://relay.example./".into()),
            addrs: vec![],
            secret: new_secret().unwrap(),
            name: "Thursday".into(),
        };
        let text = invite.to_text();
        assert_eq!(
            Invite::from_text(&format!("  {text}\n")),
            Some(invite.clone())
        );
        assert_eq!(Invite::from_text("hello"), None);
        assert_eq!(Invite::from_text(&text.replace("charnik-table:", "")), None);
        // an address that leads nowhere is not an invitation
        let nowhere = Invite {
            relay: None,
            ..invite.clone()
        };
        assert_eq!(Invite::from_text(&nowhere.to_text()), None);
        // nor one that leads two ways, of which the question would name only the relay
        let both = Invite {
            addrs: vec!["192.0.2.1:7777".parse().unwrap()],
            ..invite.clone()
        };
        assert_eq!(Invite::from_text(&both.to_text()), None);
        // nor is one from a protocol this build does not speak
        let later = Invite {
            v: INVITE_VERSION + 1,
            ..invite
        };
        assert_eq!(Invite::from_text(&later.to_text()), None);
    }

    #[test]
    fn a_name_is_printed_without_what_could_reword_a_dialog() {
        assert_eq!(plain_text("  Lira\n\u{202E}evil\u{0007} "), "Liraevil");
        assert_eq!(plain_text(&"a".repeat(100)).chars().count(), NAME_MAX_CHARS);
        // a quote that closes the question's own, a line separator, and the invisible marks
        assert_eq!(
            plain_text("Bo\". Their code is\u{2028}1\u{200B}2\u{FEFF}3«»"),
            "Bo. Their code is123"
        );
    }

    #[test]
    fn secrets_are_fresh_and_compared_whole() {
        let (a, b) = (new_secret().unwrap(), new_secret().unwrap());
        assert_ne!(a, b);
        assert!(same_secret(&a, &a.clone()));
        assert!(!same_secret(&a, &b));
        assert!(!same_secret(&a, &a[1..]));
    }

    #[test]
    fn a_join_code_is_six_digits_of_the_key() {
        assert_eq!(join_code(&[0; 32]), "000-000");
        let code = join_code(&[0xFF; 32]);
        assert_eq!(code.len(), 7);
        assert!(code.chars().all(|c| c.is_ascii_digit() || c == '-'));
    }
}

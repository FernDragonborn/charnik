//! The table's log: records with one author each, signed with that author's key at the table, kept
//! by every app that saw them and exchanged by what each side says it has
//! (`docs/internals/table-link.md` ▸ The table's log).
//!
//! A record travels as the JSON text that was signed and the signature beside it, so nobody
//! re-serialises before checking; it is believed only once the signature holds, the text parses
//! into the closed shape below, and it names this table.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::str::FromStr;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use data_encoding::BASE64URL_NOPAD;
use iroh::{EndpointId, SecretKey, Signature};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::wire;

/// What a signature is made over, ahead of the record's text: a record's signature cannot be
/// passed off as one for anything else (threats ▸ I5).
const DOMAIN: &[u8] = b"charnik/table/record/1\0";
/// A record's text is read against this before it is parsed.
pub const RECORD_CAP: usize = 2048;
/// The newest this many records are kept at a table.
pub const LOG_MAX: usize = 500;
/// The most authors a table's log holds records from: the GM, every seat, and those who left or were
/// dismissed. It bounds what `have` can say, so the frame that carries it stays small.
pub const AUTHORS_MAX: usize = 32;
/// An author's records past this many in `RATE_WINDOW` are refused.
const RATE_MAX: usize = 10;
const RATE_WINDOW: Duration = Duration::from_secs(10);

/// A record as it crosses the wire.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signed {
    pub text: String,
    pub sig: String,
}

/// Who a roll is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Audience {
    Table,
    Gm,
}

/// A roll's name as the sheet says it: the words, and the catalog key they came from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RollName {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Body {
    /// The roll's five facts are held to their shape by the page, as an answer's are.
    Roll {
        name: RollName,
        roll: Value,
        to: Audience,
    },
    Hide {
        author: String,
        seq: u64,
    },
    Ask {
        participant: String,
        name: String,
        request_id: String,
        request: wire::TableRequest,
    },
    Answer {
        request_id: String,
        answer: wire::TableAnswer,
    },
}

impl Body {
    fn is_bounded(&self, is_gm: bool) -> bool {
        match self {
            Body::Roll { name, .. } => {
                wire::plain_text(&name.text) == name.text
                    && !name.text.is_empty()
                    && name.key.as_deref().is_none_or(wire::is_catalog_key)
            }
            Body::Hide { author, .. } => EndpointId::from_str(author).is_ok(),
            Body::Ask {
                participant,
                name,
                request_id,
                request,
            } => {
                is_gm
                    && EndpointId::from_str(participant).is_ok()
                    && !name.is_empty()
                    && wire::plain_text(name) == *name
                    && wire::is_request_id(request_id)
                    && request.is_bounded()
            }
            Body::Answer { request_id, .. } => !is_gm && wire::is_request_id(request_id),
        }
    }

    pub fn is_history(&self) -> bool {
        matches!(self, Self::Ask { .. } | Self::Answer { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    /// The GM's key: the table the record belongs to.
    pub table: String,
    pub author: String,
    /// One more than the author's last record at this table.
    pub seq: u64,
    /// The author's clock, in milliseconds since the epoch.
    pub at: u64,
    pub body: Body,
}

fn signed_bytes(text: &str) -> Vec<u8> {
    [DOMAIN, text.as_bytes()].concat()
}

/// Sign a record as its author.
pub fn sign(key: &SecretKey, record: &Record) -> Option<Signed> {
    let text = serde_json::to_string(record).ok()?;
    if text.len() > RECORD_CAP {
        return None;
    }
    let sig = BASE64URL_NOPAD.encode(&key.sign(&signed_bytes(&text)).to_bytes());
    Some(Signed { text, sig })
}

/// The record a signed text says, if its author signed it, it fits, and it is this table's.
pub fn verify(signed: &Signed, table: &str) -> Option<Record> {
    if signed.text.len() > RECORD_CAP {
        return None;
    }
    let bytes = BASE64URL_NOPAD.decode(signed.sig.as_bytes()).ok()?;
    let sig = Signature::from_bytes(&<[u8; Signature::LENGTH]>::try_from(bytes).ok()?);
    // the author is read before the text is believed, then held to what the text says
    let record: Record = serde_json::from_str(&signed.text).ok()?;
    let author = EndpointId::from_str(&record.author).ok()?;
    author.verify(&signed_bytes(&signed.text), &sig).ok()?;
    (record.table == table && record.seq > 0 && record.body.is_bounded(record.author == table))
        .then_some(record)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

/// The records one app holds at one table.
#[derive(Default)]
pub struct Log {
    /// Each record with the order it arrived in: the oldest ARRIVAL is what goes when the log is
    /// full, since the author's clock is the author's to set.
    records: BTreeMap<(String, u64), (Record, Signed, u64)>,
    arrivals: u64,
    /// The highest number ever held from each author, kept past eviction: an author's numbers go
    /// on from it, and what a peer is told it lacks is measured against it.
    highest: HashMap<String, u64>,
    recent: HashMap<String, VecDeque<Instant>>,
}

/// How far ahead of this app's clock a record's time may be: clocks differ by minutes, and a time
/// further ahead would sit at the top of every log until then.
const AHEAD_MAX_MS: u64 = 10 * 60 * 1000;

/// What became of a record offered to the log.
#[derive(Debug, PartialEq, Eq)]
pub enum Kept {
    New,
    /// Held already, or refused: nothing to tell anyone.
    Not,
}

impl Log {
    /// The highest number held from each author.
    pub fn have(&self) -> BTreeMap<String, u64> {
        self.highest
            .iter()
            .map(|(author, seq)| (author.clone(), *seq))
            .collect()
    }

    /// `have` as one seat may be told it: an author's newest records that seat may not see are left
    /// out of the count, so the GM's answer does not say how many rolls were just kept from it.
    /// A hidden record with a visible one above it shows as a gap in the numbers either way.
    pub fn have_for(&self, may_see: impl Fn(&Record) -> bool) -> BTreeMap<String, u64> {
        self.highest
            .iter()
            .map(|(author, top)| {
                let mut seq = *top;
                while let Some((record, _, _)) = self.records.get(&(author.clone(), seq)) {
                    if seq == 0 || may_see(record) {
                        break;
                    }
                    seq -= 1;
                }
                (author.clone(), seq)
            })
            .collect()
    }

    /// The next number for a record this app writes as `author`.
    pub fn next_seq(&self, author: &str) -> u64 {
        self.highest.get(author).map_or(1, |seq| seq + 1)
    }

    /// Is this record held already?
    pub fn holds(&self, author: &str, seq: u64) -> bool {
        self.records.contains_key(&(author.to_string(), seq))
    }

    /// The records past what `have` says, oldest first, that `may_see` allows.
    pub fn missing(
        &self,
        have: &BTreeMap<String, u64>,
        may_see: impl Fn(&Record) -> bool,
    ) -> Vec<Signed> {
        let mut out: Vec<&(Record, Signed, u64)> = self
            .records
            .iter()
            .filter(|((author, seq), (record, _, _))| {
                (record.body.is_history() || have.get(author).is_none_or(|held| seq > held))
                    && may_see(record)
            })
            .map(|(_, kept)| kept)
            .collect();
        out.sort_by_key(|(_, _, arrived)| *arrived);
        out.into_iter()
            .map(|(_, signed, _)| signed.clone())
            .collect()
    }

    pub fn can_answer(&self, player: &str, id: &str) -> bool {
        self.records.values().any(|(record, _, _)| {
            matches!(&record.body, Body::Ask { participant, request_id, .. }
                if participant == player && request_id == id)
        }) && !self.records.values().any(|(record, _, _)| {
            record.author == player
                && matches!(&record.body, Body::Answer { request_id, .. }
                if request_id == id)
        })
    }

    /// Keep a record already checked by `verify`. One dated further ahead than clocks differ is
    /// refused, and the record that arrived first goes once the log is full.
    pub fn keep(&mut self, record: Record, signed: Signed) -> Kept {
        let id = (record.author.clone(), record.seq);
        let new_author = !self.highest.contains_key(&record.author);
        if self.records.contains_key(&id)
            || (new_author && self.highest.len() >= AUTHORS_MAX)
            || record.at > now_ms().saturating_add(AHEAD_MAX_MS)
        {
            return Kept::Not;
        }
        let highest = self.highest.entry(record.author.clone()).or_default();
        *highest = (*highest).max(record.seq);
        self.arrivals += 1;
        self.records.insert(id, (record, signed, self.arrivals));
        if self.records.len() > LOG_MAX {
            if let Some(first) = self
                .records
                .iter()
                .min_by_key(|(_, (_, _, arrived))| *arrived)
                .map(|(id, _)| id.clone())
            {
                self.records.remove(&first);
            }
        }
        Kept::New
    }

    /// May a peer hand on one more of this author's records now? Counted per author, so a peer
    /// flooding the table is slowed and nobody else is.
    pub fn within_pace(&mut self, author: &str) -> bool {
        let now = Instant::now();
        let times = self.recent.entry(author.to_string()).or_default();
        while times
            .front()
            .is_some_and(|at| now.duration_since(*at) > RATE_WINDOW)
        {
            times.pop_front();
        }
        if times.len() >= RATE_MAX {
            return false;
        }
        times.push_back(now);
        true
    }
}

/// May `author` hide the record it names? The GM any, a player their own.
pub fn may_hide(author: &str, gm: &str, hidden_author: &str) -> bool {
    author == gm || author == hidden_author
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roll(table: &str, author: &SecretKey, seq: u64, to: Audience) -> Record {
        Record {
            table: table.to_string(),
            author: author.public().to_string(),
            seq,
            at: 1_000 + seq,
            body: Body::Roll {
                name: RollName {
                    text: "DEX save".into(),
                    key: Some("combat.roll.save.dex".into()),
                },
                roll: serde_json::json!({ "total": 14, "advantage": "neither", "mod": 2 }),
                to,
            },
        }
    }

    #[test]
    fn a_record_is_believed_only_as_its_author_signed_it_and_only_at_its_table() {
        let author = SecretKey::generate();
        let record = roll("t", &author, 1, Audience::Table);
        let signed = sign(&author, &record).expect("signs");
        assert_eq!(verify(&signed, "t"), Some(record.clone()));
        assert_eq!(verify(&signed, "another table"), None);

        let tampered = Signed {
            text: signed.text.replace("14", "20"),
            sig: signed.sig.clone(),
        };
        assert_eq!(verify(&tampered, "t"), None);

        // signed by somebody else under the author's name
        let forger = SecretKey::generate();
        assert_eq!(verify(&sign(&forger, &record).expect("signs"), "t"), None);

        // a signature over the bare text, with no domain ahead of it, is not a record's
        let bare = Signed {
            text: signed.text.clone(),
            sig: BASE64URL_NOPAD.encode(&author.sign(signed.text.as_bytes()).to_bytes()),
        };
        assert_eq!(verify(&bare, "t"), None);
    }

    #[test]
    fn a_seat_is_not_told_how_many_rolls_were_just_kept_from_it() {
        let gm = SecretKey::generate();
        let mut log = Log::default();
        for (seq, to) in [(1, Audience::Table), (2, Audience::Gm), (3, Audience::Gm)] {
            let record = roll("t", &gm, seq, to);
            let signed = sign(&gm, &record).expect("signs");
            log.keep(record, signed);
        }
        let table_only = |r: &Record| {
            matches!(
                r.body,
                Body::Roll {
                    to: Audience::Table,
                    ..
                }
            )
        };
        let gm_key = gm.public().to_string();
        assert_eq!(log.have_for(table_only).get(&gm_key), Some(&1));
        assert_eq!(log.have_for(|_| true).get(&gm_key), Some(&3));
    }

    #[test]
    fn a_record_that_does_not_fit_is_refused() {
        let author = SecretKey::generate();
        let mut long = roll("t", &author, 1, Audience::Table);
        if let Body::Roll { name, .. } = &mut long.body {
            name.text = "\u{202E}reversed".into();
        }
        assert_eq!(verify(&sign(&author, &long).expect("signs"), "t"), None);

        let unknown_field = Signed {
            text: r#"{"table":"t","author":"x","seq":1,"at":1,"body":{"kind":"hide","author":"x","seq":1},"extra":1}"#.into(),
            sig: String::new(),
        };
        assert_eq!(verify(&unknown_field, "t"), None);

        let huge = Signed {
            text: "x".repeat(RECORD_CAP + 1),
            sig: String::new(),
        };
        assert_eq!(verify(&huge, "t"), None);
    }

    #[test]
    fn each_side_is_given_what_it_lacks_and_may_see() {
        let gm = SecretKey::generate();
        let player = SecretKey::generate();
        let mut log = Log::default();
        for (key, seq, to) in [
            (&gm, 1, Audience::Gm),
            (&gm, 2, Audience::Table),
            (&player, 1, Audience::Table),
        ] {
            let record = roll("t", key, seq, to);
            let signed = sign(key, &record).expect("signs");
            assert_eq!(log.keep(record, signed), Kept::New);
        }
        let player_key = player.public().to_string();
        let have = BTreeMap::from([(player_key.clone(), 1)]);
        let table_only = |r: &Record| {
            matches!(
                r.body,
                Body::Roll {
                    to: Audience::Table,
                    ..
                }
            )
        };
        let given = log.missing(&have, table_only);
        assert_eq!(
            given.len(),
            1,
            "the GM's table roll, not their own nor the GM's private one"
        );
        assert_eq!(log.next_seq(&player_key), 2);
    }

    #[test]
    fn a_record_held_is_not_new_and_an_author_past_their_pace_is_refused() {
        let author = SecretKey::generate();
        let mut log = Log::default();
        let first = roll("t", &author, 1, Audience::Table);
        let signed = sign(&author, &first).expect("signs");
        assert_eq!(log.keep(first.clone(), signed.clone()), Kept::New);
        assert_eq!(log.keep(first, signed), Kept::Not);
        let key = author.public().to_string();
        for _ in 0..RATE_MAX {
            assert!(log.within_pace(&key));
        }
        assert!(!log.within_pace(&key));
        assert!(log.within_pace("somebody else"));
    }

    #[test]
    fn a_log_holds_records_from_a_bounded_number_of_authors() {
        let mut log = Log::default();
        for _ in 0..AUTHORS_MAX {
            let author = SecretKey::generate();
            let record = roll("t", &author, 1, Audience::Table);
            let signed = sign(&author, &record).expect("signs");
            assert_eq!(log.keep(record, signed), Kept::New);
        }
        let one_more = SecretKey::generate();
        let record = roll("t", &one_more, 1, Audience::Table);
        let signed = sign(&one_more, &record).expect("signs");
        assert_eq!(log.keep(record, signed), Kept::Not);
        assert_eq!(log.have().len(), AUTHORS_MAX);
    }

    #[test]
    fn a_far_future_time_neither_pins_the_log_nor_pushes_anyone_out() {
        let honest = SecretKey::generate();
        let flooder = SecretKey::generate();
        let mut log = Log::default();
        let mut ahead = roll("t", &flooder, 1, Audience::Table);
        ahead.at = now_ms() + AHEAD_MAX_MS + 60_000;
        let signed = sign(&flooder, &ahead).expect("signs");
        assert_eq!(log.keep(ahead, signed), Kept::Not);

        // a full log of the flooder's records, then the honest author's: the first ARRIVED goes
        for seq in 1..=LOG_MAX as u64 {
            let mut record = roll("t", &flooder, seq, Audience::Table);
            record.at = now_ms() + AHEAD_MAX_MS - 1_000;
            let signed = sign(&flooder, &record).expect("signs");
            assert_eq!(log.keep(record, signed), Kept::New);
        }
        let first = roll("t", &honest, 1, Audience::Table);
        let signed = sign(&honest, &first).expect("signs");
        assert_eq!(log.keep(first, signed), Kept::New);
        assert!(log.holds(&honest.public().to_string(), 1));
        assert!(!log.holds(&flooder.public().to_string(), 1));
        // and an author's numbers go on past what was evicted
        assert_eq!(
            log.next_seq(&flooder.public().to_string()),
            LOG_MAX as u64 + 1
        );
    }

    #[test]
    fn only_the_gm_or_the_records_author_may_hide_it() {
        assert!(may_hide("gm", "gm", "p"));
        assert!(may_hide("p", "gm", "p"));
        assert!(!may_hide("q", "gm", "p"));
    }
}

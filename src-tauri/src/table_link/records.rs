//! The table's log: records with one author each, signed with that author's key at the table, kept
//! by every app that saw them and exchanged by what each side says it has
//! (`docs/internals/table-link.md` ▸ The table's log).
//!
//! A record travels as the JSON text that was signed and the signature beside it, so nobody
//! re-serialises before checking; it is believed only once the signature holds, the text parses
//! into the closed shape below, and it names this table.

use std::collections::{BTreeMap, HashMap};
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
/// The most roll lines one action's record carries: Extra Attack with Action Surge is sixteen.
pub const ACTION_LINES_MAX: usize = 16;
/// How fast a seat's app hands its own records over: a burst of this many, then one a second.
pub const SEND_PACE: Pace = Pace::new(20, Duration::from_secs(1));
/// What the GM's app takes from a seat before it refuses: above the pace an honest app keeps, so it
/// guards only against an app that does not keep it.
const TAKE_PACE: Pace = Pace::new(30, Duration::from_secs(1));

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

/// A record as an app holds it: the signed text, the name its author is shown under, and how far
/// the author's clock runs behind the GM's (`at + skew` is the record's time on the GM's clock).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Held {
    pub record: Signed,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub skew: i64,
}

fn is_zero(skew: &i64) -> bool {
    *skew == 0
}

/// A record's time on the GM's clock: its author's, moved by how far that clock is off.
pub fn on_gm_clock(at: u64, skew: i64) -> u64 {
    u64::try_from(i128::from(at) + i128::from(skew)).unwrap_or(if skew < 0 { 0 } else { u64::MAX })
}

/// A roll's name as the sheet says it: the words, and the catalog key they came from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RollName {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

/// One roll of an action. Its five facts are held to their shape by the page, as an answer's are.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RollLine {
    pub name: RollName,
    pub roll: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Body {
    /// One action's rolls — every line one press made — so the log and its pace count actions.
    Roll {
        lines: Vec<RollLine>,
        to: Audience,
        /// The number of the author's own roll kept to the GM that this one shows the table: the
        /// same lines at the same time, so the hidden one gives way to it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reveals: Option<u64>,
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
            Body::Roll { lines, .. } => {
                !lines.is_empty()
                    && lines.len() <= ACTION_LINES_MAX
                    && lines.iter().all(|RollLine { name, .. }| {
                        wire::plain_text(&name.text) == name.text
                            && !name.text.is_empty()
                            && name.key.as_deref().is_none_or(wire::is_catalog_key)
                    })
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
    let reveals_an_earlier_roll = match record.body {
        Body::Roll {
            reveals: Some(shown),
            to,
            ..
        } => shown > 0 && shown < record.seq && to == Audience::Table,
        _ => true,
    };
    (record.table == table
        && record.seq > 0
        && reveals_an_earlier_roll
        && record.body.is_bounded(record.author == table))
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
    /// Each record with the order it arrived in and its author's skew: the oldest ARRIVAL is what
    /// goes when the log is full, since the author's clock is the author's to set.
    records: BTreeMap<(String, u64), Entry>,
    arrivals: u64,
    /// The highest number ever held from each author, kept past eviction: an author's numbers go
    /// on from it, and what a peer is told it lacks is measured against it.
    highest: HashMap<String, u64>,
    paces: HashMap<String, Bucket>,
}

struct Entry {
    record: Record,
    signed: Signed,
    arrived: u64,
    skew: i64,
}

/// A rate as a bucket: `burst` at once, then one more each `every`.
#[derive(Clone, Copy)]
pub struct Pace {
    burst: u32,
    every: Duration,
}

impl Pace {
    pub const fn new(burst: u32, every: Duration) -> Self {
        Self { burst, every }
    }
}

/// One sender's bucket under a pace.
pub struct Bucket {
    pace: Pace,
    tokens: f64,
    at: Instant,
}

impl Bucket {
    pub fn new(pace: Pace) -> Self {
        Self {
            pace,
            tokens: f64::from(pace.burst),
            at: Instant::now(),
        }
    }

    fn refill(&mut self, now: Instant) {
        let gained = now.duration_since(self.at).as_secs_f64() / self.pace.every.as_secs_f64();
        self.tokens = (self.tokens + gained).min(f64::from(self.pace.burst));
        self.at = now;
    }

    /// Take one if there is one.
    pub fn take(&mut self, now: Instant) -> bool {
        self.refill(now);
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }

    /// When the next one is there to take.
    pub fn next_at(&mut self, now: Instant) -> Instant {
        self.refill(now);
        if self.tokens >= 1.0 {
            return now;
        }
        now + self.pace.every.mul_f64(1.0 - self.tokens)
    }
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
                while let Some(Entry { record, .. }) = self.records.get(&(author.clone(), seq)) {
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

    /// A record held, as it was signed.
    pub fn signed(&self, author: &str, seq: u64) -> Option<Signed> {
        self.records
            .get(&(author.to_string(), seq))
            .map(|entry| entry.signed.clone())
    }

    /// Give a held record its author's skew, once it is known: a record written before the GM's app
    /// measured this app's clock is placed again. The record as it is held, or None if it is not.
    pub fn retime(&mut self, author: &str, seq: u64, skew: i64) -> Option<(Record, Signed)> {
        let entry = self.records.get_mut(&(author.to_string(), seq))?;
        entry.skew = skew;
        Some((entry.record.clone(), entry.signed.clone()))
    }

    /// What showing the table `author`'s roll `seq` writes: that roll's lines, to the table, at its
    /// time. None when it is not a roll of theirs kept to the GM, or is shown already.
    pub fn reveal(&self, author: &str, seq: u64) -> Option<(Body, u64)> {
        let shown_already = self.records.values().any(|Entry { record, .. }| {
            record.author == author
                && matches!(record.body, Body::Roll { reveals: Some(shown), .. } if shown == seq)
        });
        let Entry { record, .. } = self.records.get(&(author.to_string(), seq))?;
        match &record.body {
            Body::Roll {
                lines,
                to: Audience::Gm,
                reveals: None,
            } if !shown_already => Some((
                Body::Roll {
                    lines: lines.clone(),
                    to: Audience::Table,
                    reveals: Some(seq),
                },
                record.at,
            )),
            _ => None,
        }
    }

    /// The body and time a record this app writes as `author` is signed with: a reveal takes the
    /// roll it shows and its time, so the page cannot show the table numbers the roll did not have.
    pub fn as_written(&self, author: &str, body: Body) -> Option<(Body, u64)> {
        match body {
            Body::Roll {
                reveals: Some(seq), ..
            } => self.reveal(author, seq),
            body => Some((body, now_ms())),
        }
    }

    /// Is this record held already?
    pub fn holds(&self, author: &str, seq: u64) -> bool {
        self.records.contains_key(&(author.to_string(), seq))
    }

    /// The records past what `have` says, oldest first, that `may_see` allows, each with its
    /// author's skew.
    pub fn missing(
        &self,
        have: &BTreeMap<String, u64>,
        may_see: impl Fn(&Record) -> bool,
    ) -> Vec<(Signed, i64)> {
        let mut out: Vec<&Entry> = self
            .records
            .iter()
            .filter(|((author, seq), entry)| {
                have.get(author).is_none_or(|held| seq > held) && may_see(&entry.record)
            })
            .map(|(_, entry)| entry)
            .collect();
        out.sort_by_key(|entry| entry.arrived);
        out.into_iter()
            .map(|entry| (entry.signed.clone(), entry.skew))
            .collect()
    }

    pub fn can_answer(&self, player: &str, id: &str) -> bool {
        self.records.values().any(|Entry { record, .. }| {
            matches!(&record.body, Body::Ask { participant, request_id, .. }
                if participant == player && request_id == id)
        }) && !self.records.values().any(|Entry { record, .. }| {
            record.author == player
                && matches!(&record.body, Body::Answer { request_id, .. }
                if request_id == id)
        })
    }

    /// Keep a record already checked by `verify`, its author's clock `skew` behind the GM's. One
    /// dated further ahead than that on the GM's clock is refused, and the record that arrived
    /// first goes once the log is full.
    pub fn keep(&mut self, record: Record, signed: Signed, skew: i64) -> Kept {
        let id = (record.author.clone(), record.seq);
        let new_author = !self.highest.contains_key(&record.author);
        if self.records.contains_key(&id)
            || (new_author && self.highest.len() >= AUTHORS_MAX)
            || on_gm_clock(record.at, skew) > now_ms().saturating_add(AHEAD_MAX_MS)
        {
            return Kept::Not;
        }
        let highest = self.highest.entry(record.author.clone()).or_default();
        *highest = (*highest).max(record.seq);
        self.arrivals += 1;
        self.records.insert(
            id,
            Entry {
                record,
                signed,
                arrived: self.arrivals,
                skew,
            },
        );
        if self.records.len() > LOG_MAX {
            if let Some(first) = self
                .records
                .iter()
                .min_by_key(|(_, entry)| entry.arrived)
                .map(|(id, _)| id.clone())
            {
                self.records.remove(&first);
            }
        }
        Kept::New
    }

    /// May this seat hand over one more record now? Counted per seat, so a seat flooding the
    /// table is slowed and nobody else is.
    pub fn within_pace(&mut self, seat: &str) -> bool {
        self.paces
            .entry(seat.to_string())
            .or_insert_with(|| Bucket::new(TAKE_PACE))
            .take(Instant::now())
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
                lines: vec![RollLine {
                    name: RollName {
                        text: "DEX save".into(),
                        key: Some("combat.roll.save.dex".into()),
                    },
                    roll: serde_json::json!({ "total": 14, "advantage": "neither", "mod": 2 }),
                }],
                to,
                reveals: None,
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
            log.keep(record, signed, 0);
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
        if let Body::Roll { lines, .. } = &mut long.body {
            lines[0].name.text = "\u{202E}reversed".into();
        }
        assert_eq!(verify(&sign(&author, &long).expect("signs"), "t"), None);

        // an action of no rolls, or of more than one press can make, is no action
        let mut empty = roll("t", &author, 1, Audience::Table);
        if let Body::Roll { lines, .. } = &mut empty.body {
            lines.clear();
        }
        assert_eq!(verify(&sign(&author, &empty).expect("signs"), "t"), None);
        let mut crowded = roll("t", &author, 1, Audience::Table);
        if let Body::Roll { lines, .. } = &mut crowded.body {
            *lines = vec![lines[0].clone(); ACTION_LINES_MAX + 1];
        }
        assert!(sign(&author, &crowded).is_none_or(|signed| verify(&signed, "t").is_none()));

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
            assert_eq!(log.keep(record, signed, 0), Kept::New);
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
        assert_eq!(log.keep(first.clone(), signed.clone(), 0), Kept::New);
        assert_eq!(log.keep(first, signed, 0), Kept::Not);
        let key = author.public().to_string();
        let burst = TAKE_PACE.burst;
        for _ in 0..burst {
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
            assert_eq!(log.keep(record, signed, 0), Kept::New);
        }
        let one_more = SecretKey::generate();
        let record = roll("t", &one_more, 1, Audience::Table);
        let signed = sign(&one_more, &record).expect("signs");
        assert_eq!(log.keep(record, signed, 0), Kept::Not);
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
        assert_eq!(log.keep(ahead.clone(), signed.clone(), 0), Kept::Not);
        // the same time from an author whose clock is known to run an hour fast is no time ahead
        assert_eq!(log.keep(ahead, signed, -3_600_000), Kept::New);

        // a full log of the flooder's records, then the honest author's: the first ARRIVED goes
        for seq in 2..=LOG_MAX as u64 {
            let mut record = roll("t", &flooder, seq, Audience::Table);
            record.at = now_ms() + AHEAD_MAX_MS - 1_000;
            let signed = sign(&flooder, &record).expect("signs");
            assert_eq!(log.keep(record, signed, 0), Kept::New);
        }
        let first = roll("t", &honest, 1, Audience::Table);
        let signed = sign(&honest, &first).expect("signs");
        assert_eq!(log.keep(first, signed, 0), Kept::New);
        assert!(log.holds(&honest.public().to_string(), 1));
        assert!(!log.holds(&flooder.public().to_string(), 1));
        // and an author's numbers go on past what was evicted
        assert_eq!(
            log.next_seq(&flooder.public().to_string()),
            LOG_MAX as u64 + 1
        );
    }

    #[test]
    fn a_bucket_lets_a_burst_through_and_then_one_each_interval() {
        let start = Instant::now();
        let mut bucket = Bucket::new(Pace::new(3, Duration::from_secs(1)));
        assert!((0..3).all(|_| bucket.take(start)));
        assert!(!bucket.take(start));
        let next = bucket.next_at(start);
        assert_eq!(next.duration_since(start), Duration::from_secs(1));
        assert!(bucket.take(next));
        assert!(!bucket.take(next));
    }

    #[test]
    fn a_time_on_the_gm_clock_is_the_authors_moved_by_its_skew() {
        assert_eq!(on_gm_clock(10_000, 2_500), 12_500);
        assert_eq!(on_gm_clock(10_000, -2_500), 7_500);
        assert_eq!(on_gm_clock(1_000, -5_000), 0);
    }

    #[test]
    fn a_roll_kept_to_the_gm_is_shown_the_table_once_as_it_was_rolled() {
        let author = SecretKey::generate();
        let me = author.public().to_string();
        let mut log = Log::default();
        for (seq, to) in [(1, Audience::Gm), (2, Audience::Table)] {
            let record = roll("t", &author, seq, to);
            let signed = sign(&author, &record).expect("signs");
            log.keep(record, signed, 0);
        }
        let asked = Body::Roll {
            lines: Vec::new(),
            to: Audience::Gm,
            reveals: Some(1),
        };
        let (body, at) = log.as_written(&me, asked).expect("a roll kept to the GM can be shown");
        let Body::Roll { lines, to, reveals } = &body else {
            panic!("a reveal is a roll");
        };
        // the lines and time are the kept roll's, whatever the page sent
        assert_eq!((lines.len(), *to, *reveals, at), (1, Audience::Table, Some(1), 1_001));
        assert!(log.reveal(&me, 2).is_none(), "a roll the table saw has nothing to show");
        assert!(log.reveal("someone else", 1).is_none());
        assert!(log.reveal(&me, 9).is_none(), "a roll not held cannot be shown");

        let shown = Record { table: "t".into(), author: me.clone(), seq: 3, at, body };
        let signed = sign(&author, &shown).expect("signs");
        assert!(verify(&signed, "t").is_some());
        log.keep(shown, signed, 0);
        assert!(log.reveal(&me, 1).is_none(), "a roll is shown once");
    }

    #[test]
    fn a_reveal_names_an_earlier_roll_and_goes_to_the_table() {
        let author = SecretKey::generate();
        let reveal = |seq, shown, to| {
            let mut record = roll("t", &author, seq, to);
            if let Body::Roll { reveals, .. } = &mut record.body {
                *reveals = Some(shown);
            }
            verify(&sign(&author, &record).expect("signs"), "t")
        };
        assert!(reveal(2, 1, Audience::Table).is_some());
        assert!(reveal(2, 2, Audience::Table).is_none(), "not itself");
        assert!(reveal(2, 3, Audience::Table).is_none(), "not a later one");
        assert!(reveal(2, 0, Audience::Table).is_none());
        assert!(reveal(2, 1, Audience::Gm).is_none(), "a reveal kept to the GM shows nobody");
    }

    #[test]
    fn only_the_gm_or_the_records_author_may_hide_it() {
        assert!(may_hide("gm", "gm", "p"));
        assert!(may_hide("p", "gm", "p"));
        assert!(!may_hide("q", "gm", "p"));
    }
}

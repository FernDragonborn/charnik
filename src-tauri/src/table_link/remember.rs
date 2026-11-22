//! A table that outlives the app (`docs/internals/table-link.md` ▸ Remembering a table).
//!
//! The key a seat sits under is kept in the OS's own credential store, never in a file: the data
//! folder is what a folder sync or a restored backup carries, and the app's local data folder is
//! a file anyone with the user's account can copy. Everything else — which tables, under what
//! names, who the GM let in, and the records each app held — is a file only Rust writes, in the
//! app's local data folder, which the page's file access is denied (`capabilities/default.json`).
//!
//! Where the OS offers no store this build can reach, nothing is remembered: a table there lives
//! for one session, as it did before.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use iroh::{EndpointId, SecretKey};
use serde::{Deserialize, Serialize};

use super::records::{self, Held, LOG_MAX};
use super::session::{Again, Keep, Keeper, RelaySetting};

#[cfg(target_os = "macos")]
use apple_native_keyring_store::keychain::Store as NativeStore;
#[cfg(target_os = "linux")]
use dbus_secret_service_keyring_store::Store as NativeStore;
#[cfg(windows)]
use windows_native_keyring_store::Store as NativeStore;

/// The credential store's service name; the user is the table's id.
const VAULT_SERVICE: &str = "charnik-table";
const TABLE_SUFFIX: &str = ".json";
const RECORDS_SUFFIX: &str = ".records.jsonl";
/// A records file is rewritten to its newest `LOG_MAX` lines once it holds this many.
const RECORDS_COMPACT_AT: usize = 4 * LOG_MAX;
/// A line longer than a record could be, escaped, with its name, is not one.
const RECORD_LINE_MAX: usize = 4 * records::RECORD_CAP;
/// No table description this app writes comes near this.
const TABLE_FILE_MAX: u64 = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LetIn {
    pub key: String,
    pub name: String,
}

/// What a seat was, so it can be taken again.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "role",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum KeptSeat {
    Gm {
        name: String,
        relay: RelaySetting,
        allowed: Vec<LetIn>,
        #[serde(default)]
        bind_addrs: Vec<SocketAddr>,
    },
    Player {
        /// The invitation it followed: the GM's key, the route to it, and the table's name.
        invite: String,
        name: String,
    },
}

/// A table id as `wire::new_local_id` writes one, and so the only file name this module makes.
fn is_table_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// The OS's credential store for a table's key, or None where this build has none.
pub trait Vault: Send + Sync {
    fn put(&self, table: &str, key: &SecretKey) -> bool;
    fn get(&self, table: &str) -> Option<SecretKey>;
    fn forget(&self, table: &str);
}

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
struct OsVault;

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
impl OsVault {
    fn entry(table: &str) -> Option<keyring_core::Entry> {
        static STORE: std::sync::OnceLock<Arc<keyring_core::CredentialStore>> =
            std::sync::OnceLock::new();
        if STORE.get().is_none() {
            match NativeStore::new() {
                Ok(store) => {
                    let _ = STORE.set(store);
                }
                Err(e) => {
                    log::warn!("table link: the credential store did not open: {e}");
                    return None;
                }
            }
        }
        STORE.get()?.build(VAULT_SERVICE, table, None).ok()
    }
}

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
impl Vault for OsVault {
    fn put(&self, table: &str, key: &SecretKey) -> bool {
        Self::entry(table).is_some_and(|entry| entry.set_secret(&key.to_bytes()).is_ok())
    }

    fn get(&self, table: &str) -> Option<SecretKey> {
        let secret = Self::entry(table)?.get_secret().ok()?;
        Some(SecretKey::from_bytes(&<[u8; 32]>::try_from(secret).ok()?))
    }

    fn forget(&self, table: &str) {
        if let Some(entry) = Self::entry(table) {
            // best-effort: a key that is not there is already forgotten
            let _ = entry.delete_credential();
        }
    }
}

/// The store this build reaches, if any.
pub fn os_vault() -> Option<Arc<dyn Vault>> {
    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    {
        Some(Arc::new(OsVault))
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        None
    }
}

/// The tables this app sits at, in one folder.
#[derive(Clone)]
pub struct Shelf {
    folder: PathBuf,
    vault: Arc<dyn Vault>,
    /// One writer at a time for every file on the shelf, and the lines each records file holds,
    /// counted once and then kept count of.
    writing: Arc<Mutex<HashMap<String, usize>>>,
}

/// A table on the shelf, as the page lists it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelved {
    pub table: String,
    pub role: &'static str,
    pub name: String,
}

impl Shelf {
    pub fn new(folder: PathBuf, vault: Arc<dyn Vault>) -> Self {
        Self {
            folder,
            vault,
            writing: Arc::default(),
        }
    }

    fn table_path(&self, id: &str) -> PathBuf {
        self.folder.join(format!("{id}{TABLE_SUFFIX}"))
    }

    fn records_path(&self, id: &str) -> PathBuf {
        self.folder.join(format!("{id}{RECORDS_SUFFIX}"))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, usize>> {
        self.writing
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Keep a seat and its key. False when the key could not be kept, and then nothing is.
    pub fn put(&self, id: &str, seat: &KeptSeat, key: &SecretKey) -> bool {
        if !is_table_id(id) || !self.vault.put(id, key) {
            return false;
        }
        if self.write_seat(id, seat) {
            return true;
        }
        self.vault.forget(id);
        false
    }

    fn write_seat(&self, id: &str, seat: &KeptSeat) -> bool {
        let _writing = self.lock();
        self.write_seat_held(id, seat)
    }

    /// Write a seat's file while the shelf's lock is already held.
    fn write_seat_held(&self, id: &str, seat: &KeptSeat) -> bool {
        let Ok(text) = serde_json::to_string_pretty(seat) else {
            return false;
        };
        fs::create_dir_all(&self.folder).is_ok() && write_whole(&self.table_path(id), &text)
    }

    fn read_seat(&self, id: &str) -> Option<KeptSeat> {
        let path = self.table_path(id);
        if fs::metadata(&path).ok()?.len() > TABLE_FILE_MAX {
            return None;
        }
        serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
    }

    pub fn update_bind_addrs(&self, id: &str, bind_addrs: Vec<SocketAddr>) -> bool {
        if !is_table_id(id) {
            return false;
        }
        let _writing = self.lock();
        let Some(mut seat) = self.read_seat(id) else {
            return false;
        };
        let KeptSeat::Gm {
            bind_addrs: kept, ..
        } = &mut seat
        else {
            return false;
        };
        if *kept == bind_addrs {
            return true;
        }
        *kept = bind_addrs;
        self.write_seat_held(id, &seat)
    }

    /// Every table on the shelf whose key is still in the store.
    pub fn list(&self) -> Vec<Shelved> {
        let Ok(entries) = fs::read_dir(&self.folder) else {
            return vec![];
        };
        let mut shelved: Vec<Shelved> = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let file = entry.file_name().into_string().ok()?;
                let id = file.strip_suffix(TABLE_SUFFIX)?;
                if !is_table_id(id) {
                    return None;
                }
                let (role, name) = match self.read_seat(id)? {
                    KeptSeat::Gm { name, .. } => ("gm", name),
                    KeptSeat::Player { invite, .. } => {
                        ("player", super::wire::Invite::from_text(&invite)?.name)
                    }
                };
                Some(Shelved {
                    table: id.to_string(),
                    role,
                    name,
                })
            })
            .collect();
        shelved.sort_by(|a, b| a.name.cmp(&b.name));
        shelved
    }

    /// What to bring back to a table: its seat, and its key with the records this app held.
    pub fn take(&self, id: &str) -> Option<(KeptSeat, Again)> {
        if !is_table_id(id) {
            return None;
        }
        let seat = self.read_seat(id)?;
        let key = self.vault.get(id)?;
        let allowed = match &seat {
            KeptSeat::Gm { allowed, .. } => allowed
                .iter()
                .filter_map(|let_in| {
                    Some((EndpointId::from_str(&let_in.key).ok()?, let_in.name.clone()))
                })
                .collect(),
            KeptSeat::Player { .. } => vec![],
        };
        let records = self.read_records(id);
        let bind_addrs = match &seat {
            KeptSeat::Gm { bind_addrs, .. } => bind_addrs.clone(),
            KeptSeat::Player { .. } => vec![],
        };
        Some((
            seat,
            Again {
                key,
                allowed,
                records,
                bind_addrs,
            },
        ))
    }

    fn read_records(&self, id: &str) -> Vec<Held> {
        let Ok(text) = fs::read_to_string(self.records_path(id)) else {
            return vec![];
        };
        let lines: Vec<&str> = text.lines().collect();
        let mut held: Vec<Held> = Vec::new();
        for line in lines[lines.len().saturating_sub(LOG_MAX)..]
            .iter()
            .filter(|line| line.len() <= RECORD_LINE_MAX)
            .filter_map(|line| serde_json::from_str::<Held>(line).ok())
        {
            // a record written again later — placed on the GM's clock once it was known — is read
            // as its later line, where its first stood
            match held.iter_mut().find(|kept| kept.record == line.record) {
                Some(kept) => *kept = line,
                None => held.push(line),
            }
        }
        held
    }

    /// Take a table off the shelf, key and records with it.
    pub fn forget(&self, id: &str) {
        if !is_table_id(id) {
            return;
        }
        let mut writing = self.lock();
        writing.remove(id);
        self.vault.forget(id);
        // best-effort: a file that is not there is already gone
        let _ = fs::remove_file(self.table_path(id));
        let _ = fs::remove_file(self.records_path(id));
    }

    /// What a session asks to keep, written as it is asked.
    pub fn keeper(&self, id: &str) -> Keeper {
        let (shelf, id) = (self.clone(), id.to_string());
        Arc::new(move |keep| shelf.keep(&id, keep))
    }

    fn keep(&self, id: &str, keep: Keep) {
        match keep {
            Keep::Record(held) => self.append_record(id, held),
            Keep::LetIn { key, name } => self.change_allowed(id, |allowed| {
                let key = key.to_string();
                allowed.retain(|let_in| let_in.key != key);
                allowed.push(LetIn { key, name });
            }),
            Keep::SentAway { key } => self.change_allowed(id, |allowed| {
                let key = key.to_string();
                allowed.retain(|let_in| let_in.key != key);
            }),
        }
    }

    fn change_allowed(&self, id: &str, change: impl FnOnce(&mut Vec<LetIn>)) {
        // read and written under one hold, so two keys let in at once are both kept
        let _writing = self.lock();
        let Some(KeptSeat::Gm {
            name,
            relay,
            mut allowed,
            bind_addrs,
        }) = self.read_seat(id)
        else {
            return;
        };
        change(&mut allowed);
        self.write_seat_held(
            id,
            &KeptSeat::Gm {
                name,
                relay,
                allowed,
                bind_addrs,
            },
        );
    }

    fn append_record(&self, id: &str, line: Held) {
        let Ok(text) = serde_json::to_string(&line) else {
            return;
        };
        let mut writing = self.lock();
        let path = self.records_path(id);
        // a table forgotten meanwhile is not written back into being
        if !self.table_path(id).exists() {
            return;
        }
        let lines = writing
            .entry(id.to_string())
            .or_insert_with(|| fs::read_to_string(&path).map_or(0, |text| text.lines().count()));
        let appended = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut file| writeln!(file, "{text}"));
        if let Err(e) = appended {
            log::warn!("table link: a record was not kept: {e}");
            return;
        }
        *lines += 1;
        if *lines >= RECORDS_COMPACT_AT && compact(&path) {
            *lines = LOG_MAX;
        }
    }
}

/// Rewrite a records file to its newest lines.
fn compact(path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    let lines: Vec<&str> = text.lines().collect();
    let kept = lines[lines.len().saturating_sub(LOG_MAX)..].join("\n") + "\n";
    write_whole(path, &kept)
}

/// Write a file whole: to a sibling first, then over the old one, so a crash leaves one or the
/// other and never half of either.
fn write_whole(path: &Path, text: &str) -> bool {
    let written = crate::durable::write_durable(path, text.as_bytes());
    if let Err(e) = &written {
        log::warn!("table link: a table was not kept: {e}");
    }
    written.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table_link::records::Signed;
    use std::collections::HashMap;

    /// A store in memory, standing in for the OS's.
    #[derive(Default)]
    struct MemoryVault(Mutex<HashMap<String, [u8; 32]>>);

    impl Vault for MemoryVault {
        fn put(&self, table: &str, key: &SecretKey) -> bool {
            self.0.lock().unwrap().insert(table.into(), key.to_bytes());
            true
        }
        fn get(&self, table: &str) -> Option<SecretKey> {
            self.0.lock().unwrap().get(table).map(SecretKey::from_bytes)
        }
        fn forget(&self, table: &str) {
            self.0.lock().unwrap().remove(table);
        }
    }

    fn shelf() -> (Shelf, PathBuf) {
        let folder = std::env::temp_dir().join(format!(
            "charnik-shelf-{}",
            super::super::wire::new_local_id().unwrap()
        ));
        (
            Shelf::new(folder.clone(), Arc::new(MemoryVault::default())),
            folder,
        )
    }

    fn signed_roll(key: &SecretKey, table: &str, seq: u64) -> Signed {
        let record = records::Record {
            table: table.into(),
            author: key.public().to_string(),
            seq,
            at: seq,
            body: records::Body::Hide {
                author: key.public().to_string(),
                seq: 1,
            },
        };
        records::sign(key, &record).unwrap()
    }

    #[test]
    fn a_table_put_on_the_shelf_comes_back_with_its_key_the_keys_let_in_and_its_records() {
        let (shelf, folder) = shelf();
        let key = SecretKey::generate();
        let id = "00ff";
        let seat = KeptSeat::Gm {
            name: "Thursday".into(),
            relay: RelaySetting::N0,
            allowed: vec![],
            bind_addrs: vec!["0.0.0.0:31415".parse().unwrap()],
        };
        assert!(shelf.put(id, &seat, &key));
        let keep = shelf.keeper(id);
        let player = SecretKey::generate().public();
        keep(Keep::LetIn {
            key: player,
            name: "Lira".into(),
        });
        let record = signed_roll(&key, &key.public().to_string(), 1);
        keep(Keep::Record(Held {
            record: record.clone(),
            name: None,
            skew: 0,
        }));

        assert_eq!(shelf.list().len(), 1);
        let (_, again) = shelf.take(id).expect("the table comes back");
        assert_eq!(again.key.to_bytes(), key.to_bytes());
        assert_eq!(again.allowed, vec![(player, "Lira".to_string())]);
        assert_eq!(
            again.records,
            vec![Held {
                record,
                name: None,
                skew: 0,
            }]
        );
        assert_eq!(
            again.bind_addrs,
            vec!["0.0.0.0:31415".parse::<SocketAddr>().unwrap()]
        );

        keep(Keep::SentAway { key: player });
        assert!(shelf.take(id).expect("still there").1.allowed.is_empty());
        assert_eq!(shelf.take(id).unwrap().0, seat);

        shelf.forget(id);
        assert!(shelf.list().is_empty() && shelf.take(id).is_none());
        // a record that arrives after the table is forgotten does not bring it back
        keep(Keep::Record(Held {
            record: signed_roll(&key, "t", 2),
            name: None,
            skew: 0,
        }));
        assert!(!shelf.records_path(id).exists());
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn a_failed_port_update_keeps_the_key_and_the_old_table() {
        let (shelf, folder) = shelf();
        let key = SecretKey::generate();
        let id = "00ff";
        let seat = KeptSeat::Gm {
            name: "Thursday".into(),
            relay: RelaySetting::None {
                addresses: crate::table_link::session::AddressFamilies::Both,
            },
            allowed: vec![],
            bind_addrs: vec![],
        };
        assert!(shelf.put(id, &seat, &key));
        let blocker = folder.join(format!("{id}.json.tmp"));
        fs::create_dir(&blocker).unwrap();
        let addrs = vec!["0.0.0.0:31415".parse().unwrap()];
        assert!(!shelf.update_bind_addrs(id, addrs.clone()));
        let (kept, again) = shelf.take(id).expect("the table is still remembered");
        assert_eq!(kept, seat);
        assert_eq!(again.key.to_bytes(), key.to_bytes());
        fs::remove_dir(blocker).unwrap();
        assert!(shelf.update_bind_addrs(id, addrs.clone()));
        assert_eq!(shelf.take(id).unwrap().1.bind_addrs, addrs);
        shelf.forget(id);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn an_older_table_without_bind_addresses_still_returns() {
        let (shelf, folder) = shelf();
        let key = SecretKey::generate();
        assert!(shelf.vault.put("00ff", &key));
        fs::create_dir_all(&folder).unwrap();
        fs::write(
            shelf.table_path("00ff"),
            r#"{"role":"gm","name":"Thursday","relay":{"mode":"none"},"allowed":[]}"#,
        )
        .unwrap();
        let (_, again) = shelf.take("00ff").expect("an older table returns");
        assert!(again.bind_addrs.is_empty());
        shelf.forget("00ff");
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_record_written_again_is_read_back_as_its_later_line() {
        let (shelf, folder) = shelf();
        let key = SecretKey::generate();
        let id = "00ff";
        let seat = KeptSeat::Gm {
            name: "Thursday".into(),
            relay: RelaySetting::N0,
            allowed: vec![],
            bind_addrs: vec![],
        };
        assert!(shelf.put(id, &seat, &key));
        let keep = shelf.keeper(id);
        let record = signed_roll(&key, "t", 1);
        for skew in [0, 3_600_000] {
            keep(Keep::Record(Held {
                record: record.clone(),
                name: None,
                skew,
            }));
        }
        let read = shelf.read_records(id);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].skew, 3_600_000);
        shelf.forget(id);
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn nothing_but_a_table_id_is_a_name_on_the_shelf() {
        let (shelf, folder) = shelf();
        let key = SecretKey::generate();
        let seat = KeptSeat::Player {
            invite: String::new(),
            name: "Lira".into(),
        };
        for id in ["../escape", "", "a/b", "zz"] {
            assert!(!shelf.put(id, &seat, &key), "{id}");
            assert!(shelf.take(id).is_none());
        }
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn a_records_file_past_its_bound_keeps_its_newest_lines() {
        let (shelf, folder) = shelf();
        let key = SecretKey::generate();
        let seat = KeptSeat::Player {
            invite: String::new(),
            name: "Lira".into(),
        };
        assert!(shelf.put("0a", &seat, &key));
        let keep = shelf.keeper("0a");
        for seq in 1..=RECORDS_COMPACT_AT as u64 {
            keep(Keep::Record(Held {
                record: signed_roll(&key, "t", seq),
                name: None,
                skew: 0,
            }));
        }
        let kept = shelf.read_records("0a");
        assert_eq!(kept.len(), LOG_MAX);
        assert_eq!(
            kept.last().map(|held| held.record.clone()),
            Some(signed_roll(&key, "t", RECORDS_COMPACT_AT as u64))
        );
        let _ = fs::remove_dir_all(folder);
    }

    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    #[cfg_attr(not(windows), ignore = "requires an unlocked native credential store")]
    #[test]
    fn the_os_store_keeps_a_key_and_lets_it_go() {
        let vault = OsVault;
        let id = format!("test{}", super::super::wire::new_local_id().unwrap());
        let key = SecretKey::generate();
        assert!(vault.put(&id, &key));
        assert_eq!(vault.get(&id).map(|k| k.to_bytes()), Some(key.to_bytes()));
        vault.forget(&id);
        assert!(vault.get(&id).is_none());
    }
}

//! Which plugins may run: the consent record, and the one way to add to it.
//!
//! The record lives in `<appConfig>/plugins.json`, a directory the capability denies to the webview,
//! and only these commands write it. Consent is granted by a NATIVE dialog, because a modal drawn by
//! the page can be clicked by the page: script running in the webview could otherwise write a plugin
//! folder and the permission to run it in one go.
//!
//! The dialog's words are not the page's either. `build.rs` reads them out of the UI's own locale
//! catalogs at compile time, so the page names a LOCALE and never a sentence — it can choose which
//! language the question is asked in, and nothing about what is asked.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

// `ConsentStrings` and `consent_strings(locale)`, generated from `src/lib/i18n/locales/*.json`.
include!(concat!(env!("OUT_DIR"), "/consent_strings.rs"));

/// The record, in the shape the page reads it (`PluginPrefs` in `effects/plugin-host.ts`).
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PluginPrefs {
    /// namespace → the hash of the exact bytes the user allowed.
    consent: BTreeMap<String, String>,
    /// namespace → switched on by the user. Means nothing without a matching consent.
    enabled: BTreeMap<String, bool>,
    /// Every plugin off, whatever the two maps say.
    kill_switch: bool,
}

/// Serialises read-modify-write of the record: two commands may run on different threads.
#[derive(Default)]
pub struct PluginRecord(Mutex<()>);

fn record_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("plugins.json"))
}

/// The record as it stands. A missing or unreadable one is an EMPTY one: nothing is allowed to run.
fn read(app: &tauri::AppHandle) -> PluginPrefs {
    record_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Change the record under the lock and answer what it then holds.
fn update(
    app: &tauri::AppHandle,
    change: impl FnOnce(&mut PluginPrefs),
) -> Result<PluginPrefs, String> {
    let record = app.state::<PluginRecord>();
    let _held = record.0.lock().map_err(|e| e.to_string())?;
    let mut prefs = read(app);
    change(&mut prefs);
    let path = record_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(prefs)
}

/// The manifest's own rule for a namespace (`NAMESPACE_RE` in `effects/plugin-host.ts`). Checked
/// here as well because it is printed inside the dialog, and what the page hands over is not
/// believed: 32 characters of `[a-z0-9-]` cannot word a sentence.
fn is_namespace(s: &str) -> bool {
    let mut chars = s.chars();
    let lower_or_digit = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    chars.next().is_some_and(lower_or_digit)
        && s.len() <= 32
        && chars.all(|c| lower_or_digit(c) || c == '-')
}

/// A SHA-256 in hex — the only shape a consent hash has.
fn is_hash(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// How much of the hash the dialog prints. The same sixteen the page's own review dialog shows, so
/// the two can be compared by eye.
const FINGERPRINT_CHARS: usize = 16;

/// The record, for the page to render. Reading it grants nothing.
#[tauri::command]
pub fn plugin_prefs(app: tauri::AppHandle) -> PluginPrefs {
    read(&app)
}

/// Ask the user, in a native dialog, whether `namespace` may run the code that hashes to `hash`,
/// and record it — switched on — only if they say yes. Answers the record as it then stands, so a
/// refusal reads as "nothing changed" rather than as an error.
///
/// `async` so it runs off the main thread: the dialog blocks until it is answered.
#[tauri::command]
pub async fn grant_plugin_consent(
    app: tauri::AppHandle,
    namespace: String,
    hash: String,
    locale: String,
) -> Result<PluginPrefs, String> {
    if !is_namespace(&namespace) || !is_hash(&hash) {
        return Err("not a plugin namespace and code hash".into());
    }
    let strings = consent_strings(&locale);
    let body = strings
        .body
        .replace("{namespace}", &namespace)
        .replace("{fingerprint}", &hash[..FINGERPRINT_CHARS]);
    let mut dialog = app
        .dialog()
        .message(body)
        .title(strings.title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            strings.allow.into(),
            strings.deny.into(),
        ));
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.parent(&window);
    }
    if !dialog.blocking_show() {
        return Ok(read(&app));
    }
    update(&app, |prefs| {
        prefs.consent.insert(namespace.clone(), hash);
        prefs.enabled.insert(namespace, true);
    })
}

/// Take consent and enablement away from these namespaces. Never asks: less permission is always
/// the user's to have, and the page may only ever shrink the record without them.
#[tauri::command]
pub fn forget_plugins(
    app: tauri::AppHandle,
    namespaces: Vec<String>,
) -> Result<PluginPrefs, String> {
    update(&app, |prefs| {
        for namespace in &namespaces {
            prefs.consent.remove(namespace);
            prefs.enabled.remove(namespace);
        }
    })
}

/// Switch one plugin on or off. On is honoured only where a consent already stands — the switch
/// chooses among what the user allowed, and cannot stand in for allowing it.
#[tauri::command]
pub fn set_plugin_enabled(
    app: tauri::AppHandle,
    namespace: String,
    enabled: bool,
) -> Result<PluginPrefs, String> {
    update(&app, |prefs| {
        if !enabled || prefs.consent.contains_key(&namespace) {
            prefs.enabled.insert(namespace, enabled);
        }
    })
}

/// The global "disable all plugins" switch.
#[tauri::command]
pub fn set_plugin_kill_switch(app: tauri::AppHandle, on: bool) -> Result<PluginPrefs, String> {
    update(&app, |prefs| prefs.kill_switch = on)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_namespace_is_the_manifests_own_shape_and_nothing_wider() {
        assert!(is_namespace("exploit-dice"));
        assert!(is_namespace("a"));
        assert!(!is_namespace(""));
        assert!(!is_namespace("-leading"));
        assert!(!is_namespace("Has Space"));
        assert!(!is_namespace(&"a".repeat(33)));
    }

    #[test]
    fn a_hash_is_sixty_four_hex_digits() {
        assert!(is_hash(&"b".repeat(64)));
        assert!(!is_hash(&"b".repeat(63)));
        assert!(!is_hash(&"z".repeat(64)));
    }

    #[test]
    fn every_bundled_locale_asks_about_the_plugin_and_its_fingerprint() {
        for locale in CONSENT_LOCALES {
            let strings = consent_strings(locale);
            assert!(strings.body.contains("{namespace}"), "{locale}");
            assert!(strings.body.contains("{fingerprint}"), "{locale}");
        }
        // a locale nobody bundled is asked in English, never in the page's words
        assert_eq!(consent_strings("xx").title, consent_strings("en").title);
    }
}

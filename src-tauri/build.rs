use std::fmt::Write as _;
use std::path::Path;

/// The commands `lib.rs` hands to `invoke_handler`. Declaring them is what puts them under the ACL:
/// each gets an `allow-<command>` permission, and a webview whose capability does not list it is
/// refused. Left undeclared, every one of them is callable from any local webview, whatever the
/// capability's `windows` list says.
const APP_COMMANDS: &[&str] = &[
    "pick_data_dir",
    "set_data_dir",
    "saved_data_dir",
    "apply_saved_data_dir",
    "open_app_dir",
    "proposed_data_dir",
    "fetch_pack_text",
    "fetch_pack_bytes",
    "plugin_prefs",
    "grant_plugin_consent",
    "forget_plugins",
    "set_plugin_enabled",
    "set_plugin_kill_switch",
    "check_app_update",
    "install_app_update",
];

/// The table link's commands, declared only in a build that compiles them (`src/table_link.rs`).
const TABLE_LINK_COMMANDS: &[&str] = &[
    "table_link_host",
    "table_link_join",
    "table_link_leave",
    "table_link_resume",
    "table_link_publish",
    "table_link_respond",
    "table_link_request",
    "table_link_dismiss",
    "table_link_door",
];
/// The capability files of every build, and with them the ones a feature brings in its own folder.
/// A capability naming a permission the build does not declare fails it, so a feature's file is
/// read only when the feature is on.
const CORE_CAPABILITIES: &str = "./capabilities/*.json";
const ALL_CAPABILITIES: &str = "./capabilities/**/*.json";

/// The UI's own catalogs — the one place a string is translated.
const LOCALES_DIR: &str = "../src/lib/i18n/locales";
/// Where the words of the NATIVE dialogs sit in a catalog: every string under these keys is
/// compiled into the binary. A native dialog asks a security question, so the page may name the
/// language it is asked in and never the sentence.
const NATIVE_ROOTS: [&[&str]; 2] = [
    &["settings", "plugins", "nativeConsent"],
    &["table", "native"],
];
const FALLBACK_LOCALE: &str = "en";

fn main() {
    write_native_strings();
    let table_link = std::env::var_os("CARGO_FEATURE_TABLE_LINK").is_some();
    let commands: Vec<&str> = APP_COMMANDS
        .iter()
        .chain(if table_link { TABLE_LINK_COMMANDS } else { &[] })
        .copied()
        .collect();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .capabilities_path_pattern(if table_link {
                ALL_CAPABILITIES
            } else {
                CORE_CAPABILITIES
            })
            .app_manifest(tauri_build::AppManifest::new().commands(commands.leak())),
    )
    .expect("failed to run tauri-build");
}

/// Every string under `at`, as `dotted.key → words`.
fn collect_strings(at: &serde_json::Value, key: &str, found: &mut Vec<(String, String)>) {
    match at {
        serde_json::Value::String(words) => found.push((key.to_string(), words.clone())),
        serde_json::Value::Object(children) => {
            for (name, child) in children {
                collect_strings(child, &format!("{key}.{name}"), found);
            }
        }
        _ => {}
    }
}

/// One catalog's native-dialog strings.
fn native_strings_of(catalog: &Path) -> Vec<(String, String)> {
    let text = std::fs::read_to_string(catalog)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", catalog.display()));
    let json: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("{} is not JSON: {e}", catalog.display()));
    let mut found = Vec::new();
    for root in NATIVE_ROOTS {
        if let Some(section) = root.iter().try_fold(&json, |at, key| at.get(key)) {
            collect_strings(section, &root.join("."), &mut found);
        }
    }
    found
}

/// Compile the native dialogs' words into the binary, one arm per string of every catalog found
/// by scanning the folder. Rust has no catalogs at runtime, and the page must not be the one to
/// supply the sentence a security question is asked in — so the page names a locale and the words
/// come from here. A string a catalog lacks is said in English; English lacking a whole root
/// fails the build.
fn write_native_strings() {
    println!("cargo:rerun-if-changed={LOCALES_DIR}");
    let english =
        native_strings_of(&Path::new(LOCALES_DIR).join(format!("{FALLBACK_LOCALE}.json")));
    for root in NATIVE_ROOTS {
        let prefix = format!("{}.", root.join("."));
        assert!(
            english.iter().any(|(key, _)| key.starts_with(&prefix)),
            "en.json has no strings under {prefix}"
        );
    }

    let mut catalogs: Vec<_> = std::fs::read_dir(LOCALES_DIR)
        .expect("the UI locale catalogs are missing")
        .filter_map(|entry| Some(entry.ok()?.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    catalogs.sort();

    let mut arms = String::new();
    let mut ids = Vec::new();
    for catalog in &catalogs {
        let id = catalog.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        for (key, words) in native_strings_of(catalog) {
            writeln!(arms, "        ({id:?}, {key:?}) => {words:?},").unwrap();
        }
        ids.push(format!("{id:?}"));
    }

    let source = format!(
        "#[allow(dead_code)]
pub const NATIVE_LOCALES: &[&str] = &[{}];

         /// The words of a native dialog in a locale, in English where the locale lacks them, and
         /// empty where English does too.
         pub fn native_string(locale: &str, key: &str) -> &'static str {{
    match (locale, key) {{
{arms}                 ({FALLBACK_LOCALE:?}, _) => \"\",
        (_, key) => native_string({FALLBACK_LOCALE:?}, key),
    }}
}}
",
        ids.join(", "),
    );
    let out = Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("native_strings.rs");
    std::fs::write(out, source).expect("cannot write native_strings.rs");
}

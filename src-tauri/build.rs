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
    "table_link_publish",
    "table_link_respond",
    "table_link_request",
];
/// The capability files of every build, and with them the ones a feature brings in its own folder.
/// A capability naming a permission the build does not declare fails it, so a feature's file is
/// read only when the feature is on.
const CORE_CAPABILITIES: &str = "./capabilities/*.json";
const ALL_CAPABILITIES: &str = "./capabilities/**/*.json";

/// The UI's own catalogs — the one place a string is translated.
const LOCALES_DIR: &str = "../src/lib/i18n/locales";
/// Where the native consent dialog's words sit in a catalog, and the fields it needs.
const CONSENT_KEY: [&str; 3] = ["settings", "plugins", "nativeConsent"];
const CONSENT_FIELDS: [&str; 4] = ["title", "body", "allow", "deny"];
const FALLBACK_LOCALE: &str = "en";

fn main() {
    write_consent_strings();
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

/// One catalog's consent strings, in `CONSENT_FIELDS` order; a field the catalog lacks is absent.
fn consent_fields(catalog: &Path) -> [Option<String>; 4] {
    let text = std::fs::read_to_string(catalog)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", catalog.display()));
    let json: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("{} is not JSON: {e}", catalog.display()));
    let section = CONSENT_KEY.iter().fold(Some(&json), |at, key| at?.get(key));
    CONSENT_FIELDS.map(|field| Some(section?.get(field)?.as_str()?.to_string()))
}

/// Compile the consent dialog's words into the binary, one arm per catalog found by scanning the
/// folder. Rust has no catalogs at runtime, and the page must not be the one to supply the sentence
/// a security question is asked in — so the page names a locale and the words come from here. A
/// field a catalog lacks falls back to English; English lacking one fails the build.
fn write_consent_strings() {
    println!("cargo:rerun-if-changed={LOCALES_DIR}");
    let english = consent_fields(&Path::new(LOCALES_DIR).join(format!("{FALLBACK_LOCALE}.json")))
        .map(|field| field.expect("en.json is missing a settings.plugins.nativeConsent string"));
    let literal = |fields: &[String; 4]| {
        format!(
            "ConsentStrings {{ title: {:?}, body: {:?}, allow: {:?}, deny: {:?} }}",
            fields[0], fields[1], fields[2], fields[3]
        )
    };

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
        let mut fields = consent_fields(catalog).into_iter().zip(&english);
        let fields: [String; 4] = std::array::from_fn(|_| {
            fields
                .next()
                .map(|(own, en)| own.unwrap_or(en.clone()))
                .unwrap()
        });
        writeln!(arms, "        {id:?} => {},", literal(&fields)).unwrap();
        ids.push(format!("{id:?}"));
    }

    let source = format!(
        "pub struct ConsentStrings {{\n    pub title: &'static str,\n    pub body: &'static str,\n    \
         pub allow: &'static str,\n    pub deny: &'static str,\n}}\n\n\
         #[allow(dead_code)]\npub const CONSENT_LOCALES: &[&str] = &[{}];\n\n\
         pub fn consent_strings(locale: &str) -> ConsentStrings {{\n    match locale {{\n{arms}        \
         _ => {},\n    }}\n}}\n",
        ids.join(", "),
        literal(&english),
    );
    let out = Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("consent_strings.rs");
    std::fs::write(out, source).expect("cannot write consent_strings.rs");
}

use std::collections::HashSet;
use std::path::{Component, PathBuf};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;

mod plugin_consent;
mod remote;
#[cfg(desktop)]
mod self_update;

/// The set of directories the USER has chosen this session (via the native folder picker) or that we
/// re-granted from our own persisted pointer at startup — the ONLY paths the fs scope may be extended
/// to. The renderer never hands us a path to grant directly (audit S2): granting flows only from a
/// real OS dialog pick (`pick_data_dir`) or our Rust-owned pointer (`apply_saved_data_dir`), and
/// `set_data_dir` refuses to persist anything not already in this set. So malicious page JS can no
/// longer widen the sandbox to an arbitrary directory.
#[derive(Default)]
struct GrantedDirs(Mutex<HashSet<PathBuf>>);

/// Let a granted folder hold dot-prefixed files on Unix, where the grant above does not reach them.
///
/// `fs_scope().allow_directory` writes into the fs plugin's RUNTIME scope, which tauri always builds
/// with the Unix default — a `**` that does not match a name starting with a dot — and which the
/// plugin's own `requireLiteralLeadingDot` setting never reaches. The app keeps files of its own
/// under such names (`content/.seed-version`, `.pack-cache`), so in a folder the user picked every
/// one of them was refused. A capability's scope DOES honour the setting, so the same folder is
/// also granted as one: the same paths, to the same window, under the same static denies.
#[cfg(unix)]
fn allow_dot_paths(app: &tauri::AppHandle, dir: &std::path::Path) -> Result<(), String> {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    dir.hash(&mut hasher);
    // a path is not a pattern: `[`, `*` and `?` in a folder's name mean themselves
    let folder = glob::Pattern::escape(&dir.to_string_lossy());
    let capability = serde_json::json!({
        "identifier": format!("granted-data-dir-{:x}", hasher.finish()),
        "windows": ["main"],
        "permissions": [{
            "identifier": "fs:scope",
            "allow": [{ "path": folder }, { "path": format!("{folder}/**") }],
        }],
    });
    app.add_capability(capability.to_string())
        .map_err(|e| e.to_string())
}

/// Grant the fs plugin recursive access to `dir` and remember it as a trusted root.
fn grant_and_record(app: &tauri::AppHandle, dir: PathBuf) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    allow_dot_paths(app, &dir)?;
    app.state::<GrantedDirs>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(dir);
    Ok(())
}

/// Our app-managed pointer file (`<appConfig>/config.json`) recording the chosen data dir. Written
/// and read ONLY by Rust now, so page JS can't forge it (the renderer's appConfig WRITE capability is
/// dropped) — closing the poisoned-pointer-across-relaunch path that a JS-owned pointer would leave.
fn pointer_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("config.json"))
}

/// The persisted data-dir choice, or None if unset / unreadable.
fn read_saved(app: &tauri::AppHandle) -> Option<String> {
    let txt = std::fs::read_to_string(pointer_path(app).ok()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    v.get("dataDir")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// The folder proposed on first run: `<Documents>/charnik`. A Linux system need not HAVE a Documents
/// folder — it is declared by `xdg-user-dirs`, which a minimal install or a bare window manager never
/// ran, and then the lookup fails outright — so there it is `<home>/charnik`, which always resolves.
fn default_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path();
    path.document_dir()
        .or_else(|_| path.home_dir())
        .map(|parent| parent.join("charnik"))
        .map_err(|e| e.to_string())
}

/// The first-run proposal, for the page to show. Rust owns it so that the folder the page proposes
/// and the folder `set_data_dir` will accept unpicked are one answer.
#[tauri::command]
fn proposed_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(default_data_dir(&app)?.to_string_lossy().into_owned())
}

/// Open the native folder picker; on a pick, grant + record it and return its path (None on cancel).
/// The dialog runs in Rust so the returned path is a genuine user choice, not renderer-supplied.
#[tauri::command]
fn pick_data_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    grant_and_record(&app, dir.clone())?;
    Ok(Some(dir.to_string_lossy().into_owned()))
}

/// Persist a data dir to the pointer — but ONLY if it (or a parent of it) was chosen via the picker
/// this session, or it is the app's own first-run proposal, so JS can't persist an arbitrary path
/// for a silent startup grant next launch. The proposal is trusted because Rust computes it: the
/// page can ask for that one folder and no other, and pressing Confirm on first run without opening
/// the picker is asking for exactly it. The exact path (which may be a `<picked>/charnik` child) is
/// also scoped now.
#[tauri::command]
fn set_data_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    // `Path::starts_with` compares whole components and `..` is an ordinary component, so
    // `<picked>/../../Windows` passes the trust test below as a descent from the picked folder. The
    // grant it then records is inert (tauri stores the pattern un-normalised and canonicalises every
    // request), so the escape does not happen — it just bricks the install: every read and write is
    // refused against a pointer only Rust can rewrite. Reject the shape here instead of relying on
    // an asymmetry two crates down.
    if dir.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("data dir must not contain `..`".into());
    }
    let trusted = app
        .state::<GrantedDirs>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .any(|g| dir == *g || dir.starts_with(g))
        || default_data_dir(&app).is_ok_and(|proposed| dir == proposed);
    if !trusted {
        return Err("data dir was not chosen via the folder picker".into());
    }
    grant_and_record(&app, dir)?;
    let ptr = pointer_path(&app)?;
    if let Some(parent) = ptr.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_vec_pretty(&serde_json::json!({ "dataDir": path }))
        .map_err(|e| e.to_string())?;
    std::fs::write(&ptr, body).map_err(|e| e.to_string())
}

/// The saved data-dir choice for display / first-run detection (read-only, no grant).
#[tauri::command]
fn saved_data_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(read_saved(&app))
}

/// May a path read back from the pointer be granted? The pointer is ours, but a grant is recursive
/// and silent, so what it names is checked rather than believed: an absolute path, with no `..`, that
/// is a folder INSIDE a drive or filesystem root and never the root itself. A pointer that fails is
/// treated as absent, which lands the app on first run instead of on somebody's whole disk.
fn is_grantable(dir: &std::path::Path) -> bool {
    dir.is_absolute()
        && !dir.components().any(|c| matches!(c, Component::ParentDir))
        && dir.components().any(|c| matches!(c, Component::Normal(_)))
}

/// Startup: re-grant the saved data dir (read from our own pointer) and return it, or None on first
/// run. The path comes from Rust-read state, never from the renderer.
#[tauri::command]
fn apply_saved_data_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match read_saved(&app) {
        Some(saved) if is_grantable(&PathBuf::from(&saved)) => {
            grant_and_record(&app, PathBuf::from(&saved))?;
            Ok(Some(saved))
        }
        _ => Ok(None),
    }
}

/// Show one of the app's OWN folders in the OS file manager: `data` (the saved data dir, else the
/// default `<Documents>/charnik`) or `logs`. The renderer names which, never where — an `open_path`
/// that took a path from page script would hand any file on disk to its default program.
#[tauri::command]
fn open_app_dir(app: tauri::AppHandle, which: String) -> Result<(), String> {
    let dir = match which.as_str() {
        "data" => match read_saved(&app) {
            Some(saved) => PathBuf::from(saved),
            None => default_data_dir(&app)?,
        },
        "logs" => app.path().app_log_dir().map_err(|e| e.to_string())?,
        _ => return Err("unknown app folder".into()),
    };
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMABUF renderer (webkit2gtk ≥ 2.42) crashes at startup on a range of GPU/driver
    // combos — notably Nvidia proprietary drivers — taking the whole window down before it paints
    // (an unsymbolicated ELF backtrace deep in libwebkit2gtk). Forcing the older, universally-stable
    // renderer avoids it. Must be set BEFORE any webview is created; honour a user-set value.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // On a Wayland session, EGL platform auto-detection walks the Nvidia Wayland path
    // (eplWlGetPlatformDisplay in libnvidia-egl-wayland2) which segfaults at startup on the
    // proprietary driver, killing the app before it paints. Forcing the X11 EGL platform routes
    // GL through the stable X11/XWayland path instead. Only touch Wayland sessions (X11 sessions
    // are unaffected by the bug) and honour a user-set value.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("EGL_PLATFORM").is_none() {
        std::env::set_var("EGL_PLATFORM", "x11");
    }

    let builder = tauri::Builder::default();

    // One process per data folder. Every save writes a whole `character.json` from memory, so a second
    // window is a second writer that overwrites the first without either knowing; the second launch
    // hands over to the window that is already open instead. Registered FIRST, as the plugin asks, so
    // nothing else has started by the time it decides.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // Self-update only exists on desktop (no mobile/web target). The plugin is initialised for its
    // Rust API alone: the capability grants none of its commands, and the page reaches the updater
    // through `self_update`'s two.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(self_update::FoundUpdate::default());

    builder
        .manage(GrantedDirs::default())
        .manage(plugin_consent::PluginRecord::default())
        .invoke_handler(tauri::generate_handler![
            pick_data_dir,
            set_data_dir,
            saved_data_dir,
            apply_saved_data_dir,
            open_app_dir,
            proposed_data_dir,
            remote::fetch_pack_text,
            remote::fetch_pack_bytes,
            plugin_consent::plugin_prefs,
            plugin_consent::grant_plugin_consent,
            plugin_consent::forget_plugins,
            plugin_consent::set_plugin_enabled,
            plugin_consent::set_plugin_kill_switch,
            #[cfg(desktop)]
            self_update::check_app_update,
            #[cfg(desktop)]
            self_update::install_app_update
        ])
        .setup(|app| {
            // Diagnostics logging (audit DIAG-1): a rotating file in the OS app-log dir (Win
            // %LOCALAPPDATA%\{bundleId}\logs) plus Stdout and the Webview devtools. Verbose in dev
            // (Debug), quiet in release (Info+). The JS `$lib/diag` facade forwards through this;
            // `attachConsole()` on the JS side also routes third-party console here.
            app.handle().plugin(
                tauri_plugin_log::Builder::new()
                    .level(if cfg!(debug_assertions) {
                        log::LevelFilter::Debug
                    } else {
                        log::LevelFilter::Info
                    })
                    // Only what the app itself says: the page's lines arrive under `webview`, and
                    // Rust's own under this crate's name. The plugin installs the process-global
                    // logger, so unfiltered it also takes every dependency's output — the updater's
                    // release notes, the HTTP client's connections — into the file, and through the
                    // Webview target hands it to page script.
                    .filter(|metadata| {
                        let target = metadata.target();
                        target.starts_with("webview")
                            || target.starts_with(env!("CARGO_CRATE_NAME"))
                    })
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Stdout,
                    ))
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Webview,
                    ))
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir { file_name: None },
                    ))
                    .max_file_size(5_000_000 /* 5 MB per file before rotating */)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                    .build(),
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

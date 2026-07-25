use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

/// The set of directories the USER has chosen this session (via the native folder picker) or that we
/// re-granted from our own persisted pointer at startup — the ONLY paths the fs scope may be extended
/// to. The renderer never hands us a path to grant directly (audit S2): granting flows only from a
/// real OS dialog pick (`pick_data_dir`) or our Rust-owned pointer (`apply_saved_data_dir`), and
/// `set_data_dir` refuses to persist anything not already in this set. So malicious page JS can no
/// longer widen the sandbox to an arbitrary directory.
#[derive(Default)]
struct GrantedDirs(Mutex<HashSet<PathBuf>>);

/// Grant the fs plugin recursive access to `dir` and remember it as a trusted root.
fn grant_and_record(app: &tauri::AppHandle, dir: PathBuf) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;
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
/// this session, so JS can't persist an arbitrary path for a silent startup grant next launch. The
/// exact path (which may be a `<picked>/charnik` child) is also scoped now.
#[tauri::command]
fn set_data_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    let trusted = app
        .state::<GrantedDirs>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .any(|g| dir == *g || dir.starts_with(g));
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

/// Startup: re-grant the saved data dir (read from our own pointer) and return it, or None on first
/// run. The path comes from Rust-read state, never from the renderer.
#[tauri::command]
fn apply_saved_data_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match read_saved(&app) {
        Some(saved) => {
            grant_and_record(&app, PathBuf::from(&saved))?;
            Ok(Some(saved))
        }
        None => Ok(None),
    }
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

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // Self-update + relaunch only exist on desktop (no mobile/web target).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .manage(GrantedDirs::default())
        .invoke_handler(tauri::generate_handler![
            pick_data_dir,
            set_data_dir,
            saved_data_dir,
            apply_saved_data_dir
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

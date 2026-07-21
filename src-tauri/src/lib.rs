use tauri_plugin_fs::FsExt;

/// Grant the fs plugin runtime read/write access to a user-chosen data directory (recursive), so the
/// app can use a folder outside the statically-scoped defaults — see docs/PLAN.md "Data directory".
#[tauri::command]
fn allow_data_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&path, true)
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
        .invoke_handler(tauri::generate_handler![allow_data_dir])
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

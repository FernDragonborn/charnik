//! Self-update as two commands that take nothing from the page.
//!
//! The updater plugin's own `check` takes its proxy, its headers, its target and whether a downgrade
//! counts from the caller, and the process plugin restarts on request — so with either permission in
//! the capability, script in the page chooses which signed release the user is moved to. Here the
//! page says "check" and "install" and nothing else: the endpoint, the key and the version
//! comparison are the ones compiled in, and the restart is the one that follows an install.

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The release the last check found. Held here so an install takes that one, and the page never
/// names a version.
#[derive(Default)]
pub struct FoundUpdate(Mutex<Option<Update>>);

/// Download progress, 0–100, as the chip shows it.
const PROGRESS_EVENT: &str = "app-update-progress";
/// The download is complete and the installer has the file.
const INSTALLING_EVENT: &str = "app-update-installing";
const MAIN_WINDOW: &str = "main";

/// Ask the release endpoint whether a newer signed build exists; its version, or None.
#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let found = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let version = found.as_ref().map(|update| update.version.clone());
    *app.state::<FoundUpdate>()
        .0
        .lock()
        .map_err(|e| e.to_string())? = found;
    Ok(version)
}

/// Download and install the release the last check found, then restart into it.
#[tauri::command]
pub async fn install_app_update(app: tauri::AppHandle) -> Result<(), String> {
    let update = app
        .state::<FoundUpdate>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("no update has been found to install")?;
    let mut received: u64 = 0;
    let (progress, installing) = (app.clone(), app.clone());
    update
        .download_and_install(
            move |chunk, total| {
                received += chunk as u64;
                let percent = total
                    .filter(|total| *total > 0)
                    .map_or(0, |total| (received * 100 / total).min(100));
                // best-effort: a window that is not listening costs the chip its number, not the update
                let _ = progress.emit_to(MAIN_WINDOW, PROGRESS_EVENT, percent);
            },
            move || {
                let _ = installing.emit_to(MAIN_WINDOW, INSTALLING_EVENT, ());
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}

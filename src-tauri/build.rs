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
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to run tauri-build");
}

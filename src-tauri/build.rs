/// Commands that only the trusted shell may call.
///
/// Listing them here makes Tauri generate an `allow-*` permission for each one,
/// so the shell capability has to grant them explicitly. A hosted service page
/// then cannot reach them through the IPC bridge even if a runtime guard were
/// ever forgotten — the request is rejected before it reaches Rust code.
///
/// `service_notification` is deliberately **absent**: it is the one command a
/// service webview may invoke, and it authenticates the caller by webview label
/// plus a per-session token before doing anything.
const SHELL_COMMANDS: &[&str] = &[
    "bootstrap",
    "app_ready",
    "update_settings",
    "reset_preferences",
    "window_minimize",
    "window_toggle_maximize",
    "window_is_maximized",
    "window_close",
    "quit_app",
    "open_external",
    "open_folder",
    "send_test_notification",
    "log_frontend",
    "security_status",
    "enable_lock",
    "disable_lock",
    "lock_app",
    "unlock_app",
    "change_pin",
    "reset_pin_with_recovery",
    "regenerate_recovery",
    "add_service",
    "remove_service",
    "set_active_service",
    "reorder_services",
    "set_service_muted",
    "set_service_zoom",
    "sync_workspace",
    "service_navigate",
    "clear_service_data",
    "check_for_update",
    "install_update",
    "export_diagnostics",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(SHELL_COMMANDS)),
    )
    .expect("failed to run tauri-build");
}

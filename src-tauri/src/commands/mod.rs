pub mod app;
pub mod diagnostics;
pub mod guard;
pub mod security;
pub mod services;
pub mod updates;

use crate::settings::Settings;
use tauri::{AppHandle, Emitter};

/// Broadcasts settings to the trusted shell so multiple UI surfaces stay in sync.
pub fn emit_settings(app: &AppHandle, settings: &Settings) {
    let _ = app.emit("mesvee:settings-changed", settings);
}

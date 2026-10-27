use super::guard::ensure_shell;
use crate::error::{CommandError, CommandResult};
use crate::infra::atomic_json::write_json_atomic;
use crate::state::AppState;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Webview};

/// Human-readable export result for the settings UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsResult {
    pub path: String,
    pub log_files: usize,
}

/// Creates a folder containing a redacted report and recent logs.
///
/// Never included: PIN hashes, recovery hashes, keychain entries, cookies or
/// service notification tokens. Service URLs and titles may appear in logs, so
/// the UI explains that this folder is intended for support.
#[tauri::command(rename_all = "camelCase")]
pub async fn export_diagnostics(
    app: AppHandle,
    webview: Webview,
) -> CommandResult<DiagnosticsResult> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|error| CommandError::internal("path_error", "Could not locate the Downloads folder.", error))?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let folder = download_dir.join(format!("Mesvee-Diagnostics-{stamp}"));
    fs::create_dir_all(&folder)
        .map_err(|error| CommandError::internal("diagnostics_error", "Could not create the diagnostics folder.", error))?;

    let settings = state.settings.snapshot();
    let security = state.security.status(&settings);
    let report = serde_json::json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "app": {
            "version": app.package_info().version.to_string(),
            "identifier": app.config().identifier,
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "dev": cfg!(debug_assertions),
        },
        "paths": {
            "config": state.paths.config_dir.to_string_lossy(),
            "data": state.paths.data_dir.to_string_lossy(),
            "logs": state.paths.log_dir.to_string_lossy(),
        },
        "security": security,
        "settings": settings,
        "services": settings.services.iter().map(|service| {
            serde_json::json!({
                "label": service.label,
                "kind": service.kind,
                "muted": service.muted,
                "zoom": service.zoom,
                "createdAt": service.created_at,
                "runtime": state.views.state_for(&service.id),
            })
        }).collect::<Vec<_>>(),
    });

    write_json_atomic(&folder.join("report.json"), &report)
        .map_err(|error| CommandError::internal("diagnostics_error", "Could not write the diagnostics report.", error))?;

    let mut copied_logs = 0usize;
    if let Ok(entries) = fs::read_dir(&state.paths.log_dir) {
        let mut logs: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "log"))
            .collect();
        logs.sort();
        let logs_dir = folder.join("logs");
        let _ = fs::create_dir_all(&logs_dir);
        for path in logs.into_iter().rev().take(5) {
            // Cap each log at 3 MiB so support exports stay lightweight.
            if fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) <= 3 * 1024 * 1024 {
                if fs::copy(&path, logs_dir.join(path.file_name().unwrap_or_default())).is_ok() {
                    copied_logs += 1;
                }
            }
        }
    }

    let readme = "Mesvee diagnostics\n==================\n\n\
This folder helps support reproduce an issue. It contains app settings, service\n\
labels and recent logs. It never contains PINs, recovery codes or keychain data.\n\n\
Logs may include service URLs and page titles. Remove anything sensitive before\n\
sharing the folder publicly.\n\n\
Generated locally by Mesvee.\n";
    let _ = fs::write(folder.join("README.txt"), readme);

    tracing::info!(path = %folder.display(), "diagnostics exported");
    Ok(DiagnosticsResult {
        path: folder.to_string_lossy().to_string(),
        log_files: copied_logs,
    })
}

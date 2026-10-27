use super::guard::ensure_shell;
use crate::error::{CommandError, CommandResult};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tauri_plugin_updater::UpdaterExt;

/// Release information exposed to the update UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Checks the signed release feed. The updater verifies signatures before any
/// package can be installed, so a compromised CDN cannot execute code.
#[tauri::command(rename_all = "camelCase")]
pub async fn check_for_update(
    app: AppHandle,
    webview: Webview,
) -> CommandResult<Option<UpdateInfo>> {
    ensure_shell(&webview)?;
    let updater = app.updater().map_err(|error| {
        CommandError::internal(
            "updater_unavailable",
            "The update channel is not configured for this build.",
            error,
        )
    })?;
    let update = updater.check().await.map_err(|error| {
        tracing::warn!(error = %error, "update check failed");
        CommandError::internal(
            "update_check_failed",
            "Could not reach the update server. Check your connection and try again.",
            error,
        )
    })?;
    Ok(update.map(|release| UpdateInfo {
        version: release.version.clone(),
        current_version: release.current_version.clone(),
        notes: release.body.clone(),
        date: release.date.map(|date| date.to_string()),
    }))
}

/// Downloads, verifies and installs the latest release, then relaunches.
#[tauri::command(rename_all = "camelCase")]
pub async fn install_update(app: AppHandle, webview: Webview) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let updater = app.updater().map_err(|error| {
        CommandError::internal(
            "updater_unavailable",
            "The update channel is not configured for this build.",
            error,
        )
    })?;
    let Some(update) = updater.check().await.map_err(|error| {
        CommandError::internal("update_check_failed", "Could not reach the update server.", error)
    })? else {
        return Err(CommandError::new(
            "no_update",
            "Mesvee is already up to date.",
        ));
    };

    let app_for_progress = app.clone();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    update
        .download_and_install(
            move |chunk_length, content_length| {
                downloaded = downloaded.saturating_add(chunk_length as u64);
                if last_emit.elapsed() >= Duration::from_millis(120) {
                    last_emit = Instant::now();
                    let _ = app_for_progress.emit(
                        "mesvee:update-progress",
                        serde_json::json!({
                            "downloaded": downloaded,
                            "total": content_length,
                        }),
                    );
                }
            },
            || {},
        )
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "update download/install failed");
            CommandError::internal(
                "update_install_failed",
                "The update could not be installed. Your current version is unchanged.",
                error,
            )
        })?;

    tracing::info!("update installed; relaunching");
    let _ = app.emit(
        "mesvee:update-installed",
        serde_json::json!({ "version": update.version }),
    );
    let app_for_restart = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(900));
        app_for_restart.restart();
    });
    Ok(())
}

/// Best-effort automatic update polling. Runs only in packaged builds and only
/// when the user opted into automatic checks. Errors never interrupt startup.
pub fn spawn_auto_updates(app: AppHandle) {
    std::thread::Builder::new()
        .name("mesvee-updates".into())
        .spawn(move || {
            std::thread::sleep(Duration::from_secs(35));
            loop {
                let should_check = app
                    .try_state::<crate::state::AppState>()
                    .map(|state| {
                        let settings = state.settings.snapshot();
                        settings.updates.auto_check && !cfg!(debug_assertions)
                    })
                    .unwrap_or(false);

                if should_check {
                    match tauri::async_runtime::block_on(async {
                        let updater = app.updater()?;
                        updater.check().await
                    }) {
                        Ok(Some(update)) => {
                            tracing::info!(version = %update.version, "update available");
                            let _ = app.emit(
                                "mesvee:update-available",
                                UpdateInfo {
                                    version: update.version.clone(),
                                    current_version: update.current_version.clone(),
                                    notes: update.body.clone(),
                                    date: update.date.map(|date| date.to_string()),
                                },
                            );
                        }
                        Ok(None) => tracing::debug!("no update available"),
                        Err(error) => tracing::debug!(error = %error, "automatic update check failed"),
                    }
                }
                std::thread::sleep(Duration::from_secs(6 * 60 * 60));
            }
        })
        .expect("failed to start updater thread");
}

use super::guard::ensure_shell;
use super::emit_settings;
use crate::error::{CommandError, CommandResult};
use crate::security::SecurityStatus;
use crate::services::catalog::{self, CatalogEntry};
use crate::services::views::ServiceRuntimeState;
use crate::settings::{Settings, SettingsPatch};
use crate::state::AppState;
use crate::system;
use serde::Serialize;
use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

/// Read-only application metadata shown in Settings → About and diagnostics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub identifier: String,
    pub platform: String,
    pub arch: String,
    pub is_dev: bool,
}

/// Everything the React shell needs for its first paint.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub app: AppInfo,
    pub settings: Settings,
    pub catalog: Vec<CatalogEntry>,
    pub security: SecurityStatus,
    pub services: Vec<ServiceRuntimeState>,
    pub startup_warning: Option<String>,
}

/// Loads the initial state. This is a trusted-shell-only command.
#[tauri::command(rename_all = "camelCase")]
pub async fn bootstrap(app: AppHandle, webview: Webview) -> CommandResult<Bootstrap> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let settings = state.settings.snapshot();
    let security = state.security.status(&settings);
    let services = settings
        .services
        .iter()
        .map(|service| state.views.state_for(&service.id))
        .collect();

    Ok(Bootstrap {
        app: AppInfo {
            version: app.package_info().version.to_string(),
            identifier: app.config().identifier.clone(),
            platform: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            is_dev: cfg!(debug_assertions),
        },
        settings,
        catalog: catalog::CATALOG.to_vec(),
        security,
        services,
        startup_warning: state.take_warning(),
    })
}

/// Called by the renderer after its first successful paint. Showing only now
/// prevents a white flash and keeps first-run onboarding visible.
#[tauri::command(rename_all = "camelCase")]
pub async fn app_ready(app: AppHandle, webview: Webview) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let settings = state.settings.snapshot();
    let should_hide = settings.general.start_minimized
        && settings.general.show_tray_icon
        && settings.onboarded;
    if should_hide {
        tracing::info!("starting minimized to tray");
    } else {
        system::show_main_window(&app);
    }
    Ok(())
}

/// Minimizes the native window.
#[tauri::command(rename_all = "camelCase")]
pub async fn window_minimize(webview: Webview) -> CommandResult<()> {
    ensure_shell(&webview)?;
    webview
        .window()
        .minimize()
        .map_err(|error| CommandError::internal("window_error", "Could not minimize the window.", error))
}

/// Toggles maximize/restore.
#[tauri::command(rename_all = "camelCase")]
pub async fn window_toggle_maximize(webview: Webview) -> CommandResult<bool> {
    ensure_shell(&webview)?;
    let window = webview.window();
    let maximized = window
        .is_maximized()
        .map_err(|error| CommandError::internal("window_error", "Could not read window state.", error))?;
    if maximized {
        window
            .unmaximize()
            .map_err(|error| CommandError::internal("window_error", "Could not restore the window.", error))?;
    } else {
        window
            .maximize()
            .map_err(|error| CommandError::internal("window_error", "Could not maximize the window.", error))?;
    }
    Ok(!maximized)
}

/// Reports whether the native window is currently maximized.
#[tauri::command(rename_all = "camelCase")]
pub async fn window_is_maximized(webview: Webview) -> CommandResult<bool> {
    ensure_shell(&webview)?;
    webview
        .window()
        .is_maximized()
        .map_err(|error| CommandError::internal("window_error", "Could not read window state.", error))
}

/// Closes according to the user's close-to-tray preference.
#[tauri::command(rename_all = "camelCase")]
pub async fn window_close(app: AppHandle, webview: Webview) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let settings = state.settings.snapshot();
    if settings.general.close_to_tray && settings.general.show_tray_icon {
        if let Some(window) = app.get_window("main") {
            window
                .hide()
                .map_err(|error| CommandError::internal("window_error", "Could not hide to tray.", error))?;
        }
        return Ok(());
    }
    state
        .quitting
        .store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

/// Quits the application intentionally, bypassing hide-to-tray.
#[tauri::command(rename_all = "camelCase")]
pub async fn quit_app(app: AppHandle, webview: Webview) -> CommandResult<()> {
    ensure_shell(&webview)?;
    app.state::<AppState>()
        .quitting
        .store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

/// Applies a settings patch, validates it in Rust, then runs side effects.
#[tauri::command(rename_all = "camelCase")]
pub async fn update_settings(
    app: AppHandle,
    webview: Webview,
    patch: SettingsPatch,
) -> CommandResult<Settings> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let previous = state.settings.snapshot();
    let updated = state
        .settings
        .update(|settings| {
            settings.apply_patch(patch);
            Ok(())
        })
        .map_err(|error| {
            tracing::warn!(error = %error, "settings update rejected");
            CommandError::validation("Some settings values are not valid.")
        })?;

    system::apply_theme(&app, &updated);
    system::sync_autostart(&app, &updated);
    let tray_changed = previous.general.show_tray_icon != updated.general.show_tray_icon
        || previous.appearance.language != updated.appearance.language;
    if tray_changed {
        if let Err(error) = system::create_tray(&app) {
            tracing::warn!(error = %error, "failed to refresh tray");
        }
    }
    state
        .views
        .broadcast_notification_permission(updated.notifications.enabled);
    state.views.refresh_badge(&app, &updated);
    emit_settings(&app, &updated);
    tracing::info!(
        language = ?updated.appearance.language,
        theme = ?updated.appearance.theme,
        "settings updated"
    );
    Ok(updated)
}

/// Resets preferences while deliberately preserving accounts and the lock flag.
#[tauri::command(rename_all = "camelCase")]
pub async fn reset_preferences(app: AppHandle, webview: Webview) -> CommandResult<Settings> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let current = state.settings.snapshot();
    let mut next = Settings::default();
    next.onboarded = current.onboarded;
    next.services = current.services.clone();
    next.active_service_id = current.active_service_id.clone();
    next.security.lock_enabled = current.security.lock_enabled;
    let updated = state
        .settings
        .replace(next)
        .map_err(|error| CommandError::internal("settings_error", "Could not reset preferences.", error))?;

    system::apply_theme(&app, &updated);
    system::sync_autostart(&app, &updated);
    let _ = system::create_tray(&app);
    state
        .views
        .broadcast_notification_permission(updated.notifications.enabled);
    state.views.refresh_badge(&app, &updated);
    emit_settings(&app, &updated);
    Ok(updated)
}

/// Opens an HTTPS/HTTP link in the user's default browser.
#[tauri::command(rename_all = "camelCase")]
pub async fn open_external(app: AppHandle, webview: Webview, url: String) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let parsed = url::Url::parse(&url)
        .map_err(|_| CommandError::validation("That link is not valid."))?;
    if !catalog::is_safe_web_url(&parsed) {
        return Err(CommandError::validation("Only secure web links can be opened."));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| CommandError::internal("open_error", "Could not open the link.", error))?;
    Ok(())
}

/// Opens a known local folder (logs, config or data) in the system file manager.
#[tauri::command(rename_all = "camelCase")]
pub async fn open_folder(app: AppHandle, webview: Webview, target: String) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let path = match target.as_str() {
        "logs" => &state.paths.log_dir,
        "config" => &state.paths.config_dir,
        "data" => &state.paths.data_dir,
        _ => return Err(CommandError::validation("Unknown folder target.")),
    };
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| CommandError::internal("open_error", "Could not open the folder.", error))?;
    Ok(())
}

/// Sends a native test notification in the active language.
#[tauri::command(rename_all = "camelCase")]
pub async fn send_test_notification(app: AppHandle, webview: Webview) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let language = app.state::<AppState>().settings.snapshot().appearance.language;
    let (title, body) = match language {
        crate::settings::Language::Id => (
            "Mesvee",
            "Notifikasi sudah aktif. Anda akan tetap terhubung meski jendela utama disembunyikan.",
        ),
        crate::settings::Language::En => (
            "Mesvee",
            "Notifications are working. You can stay connected even when Mesvee is hidden.",
        ),
    };
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| {
            tracing::warn!(error = %error, "test notification failed");
            CommandError::new(
                "notification_unavailable",
                "Notifications are blocked by the operating system. Check system settings.",
            )
        })?;
    Ok(())
}

/// Structured frontend logging. Bodies are clamped and control characters are
/// stripped so a renderer bug cannot corrupt the log file.
#[tauri::command(rename_all = "camelCase")]
pub async fn log_frontend(
    webview: Webview,
    level: String,
    message: String,
    context: Option<String>,
) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let message = sanitize_log(&message, 4_000);
    let context = context.map(|value| sanitize_log(&value, 8_000)).unwrap_or_default();
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", context, "{message}"),
        "warn" => tracing::warn!(target: "frontend", context, "{message}"),
        "debug" => tracing::debug!(target: "frontend", context, "{message}"),
        _ => tracing::info!(target: "frontend", context, "{message}"),
    }
    Ok(())
}

/// Removes control characters (except newlines) and clamps a log payload.
fn sanitize_log(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|character| *character == '\n' || *character == '\t' || !character.is_control())
        .take(limit)
        .collect()
}



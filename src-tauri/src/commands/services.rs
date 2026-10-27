use super::emit_settings;
use super::guard::ensure_shell;
use crate::error::{CommandError, CommandResult};
use crate::services::catalog;
use crate::services::views::{remove_session_directory, settle_for_session_release, WorkspaceBounds};
use crate::settings::{clean_label, ServiceInstance, Settings, MAX_SERVICES};
use crate::state::AppState;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Webview};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

/// Returned when a new service is added so the UI can switch to it immediately.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddServiceResult {
    pub service: ServiceInstance,
    pub settings: Settings,
}

/// Adds a catalog service with its own isolated, persistent data store.
#[tauri::command(rename_all = "camelCase")]
pub async fn add_service(
    app: AppHandle,
    webview: Webview,
    kind: String,
    label: Option<String>,
) -> CommandResult<AddServiceResult> {
    ensure_shell(&webview)?;
    let definition = catalog::find(&kind)
        .ok_or_else(|| CommandError::validation("That service is not supported."))?;
    let state = app.state::<AppState>();
    let current = state.settings.snapshot();
    if current.services.len() >= MAX_SERVICES {
        return Err(CommandError::new(
            "service_limit",
            "You have reached the maximum number of services.",
        ));
    }

    let requested_label = label.unwrap_or_default();
    let cleaned = clean_label(&requested_label);
    let instance = ServiceInstance {
        id: Uuid::new_v4().to_string(),
        kind: definition.kind.to_string(),
        label: if cleaned.is_empty() {
            definition.name.to_string()
        } else {
            cleaned
        },
        muted: false,
        zoom: 1.0,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    let updated = state
        .settings
        .update(|settings| {
            settings.services.push(instance.clone());
            settings.active_service_id = Some(instance.id.clone());
            Ok(())
        })
        .map_err(|error| CommandError::validation(format!("Could not add service: {error}")))?;

    emit_settings(&app, &updated);
    tracing::info!(kind = definition.kind, label = instance.label, "service added");
    Ok(AddServiceResult {
        service: instance,
        settings: updated,
    })
}

/// Removes a service and optionally erases its isolated session data.
#[tauri::command(rename_all = "camelCase")]
pub async fn remove_service(
    app: AppHandle,
    webview: Webview,
    service_id: String,
    clear_data: bool,
) -> CommandResult<Settings> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    if !state
        .settings
        .snapshot()
        .services
        .iter()
        .any(|service| service.id == service_id)
    {
        return Err(CommandError::new("not_found", "That service no longer exists."));
    }

    if clear_data {
        clear_service_browsing_data(&app, &service_id);
    }
    state.views.close_view(&service_id);
    if clear_data {
        // Let the platform release profile handles without blocking a worker.
        settle_for_session_release().await;
        remove_session_directory(&state.views.session_dir(&service_id));
    }

    let updated = state
        .settings
        .update(|settings| {
            settings.services.retain(|service| service.id != service_id);
            if settings.active_service_id.as_deref() == Some(service_id.as_str()) {
                settings.active_service_id = None;
            }
            Ok(())
        })
        .map_err(|error| CommandError::internal("settings_error", "Could not remove the service.", error))?;

    state.views.refresh_badge(&app, &updated);
    emit_settings(&app, &updated);
    let _ = app.emit(
        "mesvee:service-removed",
        serde_json::json!({ "serviceId": service_id }),
    );
    Ok(updated)
}

/// Persists the selected account.
#[tauri::command(rename_all = "camelCase")]
pub async fn set_active_service(
    app: AppHandle,
    webview: Webview,
    service_id: Option<String>,
) -> CommandResult<Settings> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    if let Some(id) = &service_id {
        if !state
            .settings
            .snapshot()
            .services
            .iter()
            .any(|service| &service.id == id)
        {
            return Err(CommandError::new("not_found", "That service is not configured."));
        }
    }
    let updated = state
        .settings
        .update(|settings| {
            settings.active_service_id = service_id;
            Ok(())
        })
        .map_err(|error| CommandError::internal("settings_error", "Could not save the active service.", error))?;
    emit_settings(&app, &updated);
    Ok(updated)
}

/// Reorders services and verifies the caller sent an exact permutation.
#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_services(
    app: AppHandle,
    webview: Webview,
    service_ids: Vec<String>,
) -> CommandResult<Settings> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let current = state.settings.snapshot();
    let mut expected: Vec<String> = current.services.iter().map(|service| service.id.clone()).collect();
    let mut requested = service_ids.clone();
    expected.sort();
    requested.sort();
    if expected != requested {
        return Err(CommandError::validation("Service order did not match the configured services."));
    }

    let updated = state
        .settings
        .update(|settings| {
            settings.services.sort_by_key(|service| {
                service_ids
                    .iter()
                    .position(|id| id == &service.id)
                    .unwrap_or(usize::MAX)
            });
            Ok(())
        })
        .map_err(|error| CommandError::internal("settings_error", "Could not reorder services.", error))?;
    emit_settings(&app, &updated);
    Ok(updated)
}

/// Mutes/unmutes one account and immediately updates the dock badge.
#[tauri::command(rename_all = "camelCase")]
pub async fn set_service_muted(
    app: AppHandle,
    webview: Webview,
    service_id: String,
    muted: bool,
) -> CommandResult<Settings> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let updated = state
        .settings
        .update(|settings| {
            let service = settings
                .services
                .iter_mut()
                .find(|service| service.id == service_id)
                .ok_or_else(|| anyhow::anyhow!("service not found"))?;
            service.muted = muted;
            Ok(())
        })
        .map_err(|error| CommandError::internal("settings_error", "Could not update the service.", error))?;
    state.views.refresh_badge(&app, &updated);
    emit_settings(&app, &updated);
    Ok(updated)
}

/// Stores a per-service zoom level and applies it to the live webview.
#[tauri::command(rename_all = "camelCase")]
pub async fn set_service_zoom(
    app: AppHandle,
    webview: Webview,
    service_id: String,
    zoom: f64,
) -> CommandResult<Settings> {
    ensure_shell(&webview)?;
    if !(0.75..=1.5).contains(&zoom) {
        return Err(CommandError::validation("Zoom must be between 75% and 150%."));
    }
    let state = app.state::<AppState>();
    let updated = state
        .settings
        .update(|settings| {
            let service = settings
                .services
                .iter_mut()
                .find(|service| service.id == service_id)
                .ok_or_else(|| anyhow::anyhow!("service not found"))?;
            service.zoom = zoom;
            Ok(())
        })
        .map_err(|error| CommandError::internal("settings_error", "Could not update zoom.", error))?;
    emit_settings(&app, &updated);
    if let Some(view) = state.views.active_view() {
        let _ = view.set_zoom(zoom);
    }
    Ok(updated)
}

/// Places the active native webview over the React placeholder.
#[tauri::command(rename_all = "camelCase")]
pub async fn sync_workspace(
    app: AppHandle,
    webview: Webview,
    active_id: Option<String>,
    visible: bool,
    bounds: WorkspaceBounds,
) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let settings = state.settings.snapshot();
    let visible = visible && !state.security.is_locked();
    if let Err(error) = state
        .views
        .sync_workspace(&app, &settings, active_id.clone(), visible, bounds)
    {
        if let Some(id) = active_id {
            state.views.mark_error(&app, &id, error.clone());
        }
        return Err(CommandError::internal(
            "webview_error",
            "The service could not be displayed. Try again or reload it.",
            error,
        ));
    }
    Ok(())
}

/// Navigation actions available from the service toolbar.
#[tauri::command(rename_all = "camelCase")]
pub async fn service_navigate(
    app: AppHandle,
    webview: Webview,
    action: String,
) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let view = state
        .views
        .active_view()
        .ok_or_else(|| CommandError::new("no_service", "Open a service first."))?;

    match action.as_str() {
        "back" => view.eval("history.back()").map_err(webview_error)?,
        "forward" => view.eval("history.forward()").map_err(webview_error)?,
        "reload" => {
            state.views.clear_error(
                state
                    .settings
                    .snapshot()
                    .active_service_id
                    .as_deref()
                    .unwrap_or_default(),
            );
            view.reload().map_err(webview_error)?;
        }
        "stop" => view.eval("window.stop()").map_err(webview_error)?,
        "home" => {
            let settings = state.settings.snapshot();
            let Some(active_id) = settings.active_service_id.as_deref() else {
                return Err(CommandError::new("no_service", "Open a service first."));
            };
            let Some(service) = settings.services.iter().find(|service| service.id == active_id) else {
                return Err(CommandError::new("not_found", "That service is not configured."));
            };
            let Some(definition) = catalog::find(&service.kind) else {
                return Err(CommandError::new("not_found", "That service is not supported."));
            };
            let url = url::Url::parse(definition.url).map_err(|_| CommandError::validation("Invalid service URL."))?;
            view.navigate(url).map_err(webview_error)?;
        }
        "external" => {
            let url = view.url().map_err(webview_error)?;
            if !catalog::is_safe_web_url(&url) {
                return Err(CommandError::validation("This page cannot be opened externally."));
            }
            app.opener()
                .open_url(url.as_str(), None::<&str>)
                .map_err(|error| CommandError::internal("open_error", "Could not open the page.", error))?;
        }
        "devtools" => {
            #[cfg(debug_assertions)]
            view.open_devtools();
            #[cfg(not(debug_assertions))]
            return Err(CommandError::new("forbidden", "Developer tools are disabled in production."));
        }
        other => return Err(CommandError::validation(format!("Unknown navigation action: {other}"))),
    }
    Ok(())
}

/// Erases one service's cookies, local storage and cache without deleting the account.
#[tauri::command(rename_all = "camelCase")]
pub async fn clear_service_data(
    app: AppHandle,
    webview: Webview,
    service_id: String,
) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    if !state
        .settings
        .snapshot()
        .services
        .iter()
        .any(|service| service.id == service_id)
    {
        return Err(CommandError::new("not_found", "That service no longer exists."));
    }
    clear_service_browsing_data(&app, &service_id);
    state.views.close_view(&service_id);
    let _ = app.emit("mesvee:service-state", state.views.state_for(&service_id));
    // The renderer may recreate the view as soon as this returns, so the wait
    // still has to finish before the directory is removed.
    settle_for_session_release().await;
    remove_session_directory(&state.views.session_dir(&service_id));
    Ok(())
}

/// Notification bridge target. Only service webviews can call this, and each call
/// must carry the per-instance token minted in Rust at webview creation.
#[tauri::command(rename_all = "camelCase")]
pub async fn service_notification(
    app: AppHandle,
    webview: Webview,
    token: String,
    title: String,
    body: Option<String>,
    tag: Option<String>,
) -> CommandResult<bool> {
    let state = app.state::<AppState>();
    let settings = state.settings.snapshot();
    let Some(window) = app.get_window("main") else {
        return Ok(false);
    };
    let focused = window.is_focused().unwrap_or(false);
    let service_id = match state
        .views
        .authorize_notification(webview.label(), &token, &settings, focused)
    {
        Ok(id) => id,
        Err(reason) => {
            tracing::debug!(reason, "service notification dropped");
            return Ok(false);
        }
    };

    let title = clean_notification_text(&title, 160);
    let body = clean_notification_text(body.as_deref().unwrap_or_default(), 800);
    if title.is_empty() {
        return Ok(false);
    }
    let instance = settings.services.iter().find(|service| service.id == service_id);
    let group = instance.map(|service| service.kind.clone());

    let mut builder = app
        .notification()
        .builder()
        .title(title)
        .body(body);
    if let Some(group) = group {
        builder = builder.group(group);
    }
    if let Some(tag) = tag.filter(|tag| !tag.trim().is_empty()) {
        // The notification plugin treats the id as a stable replacement key.
        let hashed = tag
            .bytes()
            .fold(0_i32, |accumulator, byte| accumulator.wrapping_mul(31).wrapping_add(i32::from(byte)));
        builder = builder.id(hashed.unsigned_abs() as i32);
    }

    match builder.show() {
        Ok(()) => Ok(true),
        Err(error) => {
            tracing::warn!(error = %error, "native service notification failed");
            Ok(false)
        }
    }
}

/// Removes control characters and clamps untrusted notification text.
fn clean_notification_text(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control() || *character == '\n')
        .take(limit)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Clears a live webview's site data, then leaves closing to the caller.
fn clear_service_browsing_data(app: &AppHandle, service_id: &str) {
    let state = app.state::<AppState>();
    let Some(view) = state.views.state_for(service_id).created.then(|| {
        app.get_webview(&crate::services::views::ServiceViews::label_for(service_id))
    }).flatten() else {
        return;
    };
    let _ = view.hide();
    if let Err(error) = view.clear_all_browsing_data() {
        tracing::warn!(error = %error, service_id, "failed to clear browsing data");
    }
}

/// Maps webview API failures to a user-safe command error.
fn webview_error(error: tauri::Error) -> CommandError {
    CommandError::internal("webview_error", "The service did not respond. Try again.", error)
}

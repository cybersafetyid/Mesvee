use super::emit_settings;
use super::guard::ensure_shell;
use crate::error::{CommandError, CommandResult};
use crate::security::{SecurityError, SecurityStatus};
use crate::state::AppState;
use crate::system;
use serde::Serialize;
use tauri::{AppHandle, Manager, Webview};

/// Result of enabling the lock or rotating a recovery code.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub recovery_code: String,
    pub status: SecurityStatus,
}

/// Reads the current security state from Rust (never from renderer memory).
#[tauri::command(rename_all = "camelCase")]
pub async fn security_status(app: AppHandle, webview: Webview) -> CommandResult<SecurityStatus> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let settings = state.settings.snapshot();
    Ok(state.security.status(&settings))
}

/// Enables the PIN lock and returns the one-time recovery code.
#[tauri::command(rename_all = "camelCase")]
pub async fn enable_lock(
    app: AppHandle,
    webview: Webview,
    pin: String,
) -> CommandResult<RecoveryResult> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let recovery_code = state.security.enable(&pin).map_err(map_security)?;

    if let Err(error) = state.settings.update(|settings| {
        settings.security.lock_enabled = true;
        Ok(())
    }) {
        // Roll back the keychain entry if settings could not be persisted.
        let _ = state.security.disable(&pin);
        return Err(CommandError::internal(
            "settings_error",
            "Could not save the lock configuration.",
            error,
        ));
    }

    let settings = state.settings.snapshot();
    emit_settings(&app, &settings);
    Ok(RecoveryResult {
        recovery_code,
        status: state.security.status(&settings),
    })
}

/// Disables the lock after verifying the current PIN.
#[tauri::command(rename_all = "camelCase")]
pub async fn disable_lock(
    app: AppHandle,
    webview: Webview,
    pin: String,
) -> CommandResult<SecurityStatus> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    state.security.disable(&pin).map_err(map_security)?;
    let settings = state
        .settings
        .update(|settings| {
            settings.security.lock_enabled = false;
            Ok(())
        })
        .map_err(|error| CommandError::internal("settings_error", "Could not disable the lock.", error))?;
    system::unlock_workspace(&app);
    emit_settings(&app, &settings);
    Ok(state.security.status(&settings))
}

/// Locks immediately when a PIN has been configured.
#[tauri::command(rename_all = "camelCase")]
pub async fn lock_app(app: AppHandle, webview: Webview) -> CommandResult<()> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    if !state.security.status(&state.settings.snapshot()).configured {
        return Err(CommandError::new(
            "lock_not_configured",
            "Set up an app PIN before locking.",
        ));
    }
    system::lock_workspace(&app, "manual");
    Ok(())
}

/// Verifies a PIN and unlocks the workspace on success.
#[tauri::command(rename_all = "camelCase")]
pub async fn unlock_app(
    app: AppHandle,
    webview: Webview,
    pin: String,
) -> CommandResult<SecurityStatus> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    state.security.unlock(&pin).map_err(map_security)?;
    let settings = state.settings.snapshot();
    system::unlock_workspace(&app);
    Ok(state.security.status(&settings))
}

/// Changes the PIN after verifying the current one.
#[tauri::command(rename_all = "camelCase")]
pub async fn change_pin(
    app: AppHandle,
    webview: Webview,
    current_pin: String,
    new_pin: String,
) -> CommandResult<SecurityStatus> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    state
        .security
        .change_pin(&current_pin, &new_pin)
        .map_err(map_security)?;
    Ok(state.security.status(&state.settings.snapshot()))
}

/// Resets the PIN using a valid recovery code and rotates the recovery code.
#[tauri::command(rename_all = "camelCase")]
pub async fn reset_pin_with_recovery(
    app: AppHandle,
    webview: Webview,
    recovery_code: String,
    new_pin: String,
) -> CommandResult<RecoveryResult> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let recovery_code = state
        .security
        .reset_with_recovery(&recovery_code, &new_pin)
        .map_err(map_security)?;
    let settings = state.settings.snapshot();
    system::unlock_workspace(&app);
    Ok(RecoveryResult {
        recovery_code,
        status: state.security.status(&settings),
    })
}

/// Rotates the recovery code after PIN verification.
#[tauri::command(rename_all = "camelCase")]
pub async fn regenerate_recovery(
    app: AppHandle,
    webview: Webview,
    pin: String,
) -> CommandResult<RecoveryResult> {
    ensure_shell(&webview)?;
    let state = app.state::<AppState>();
    let recovery_code = state.security.regenerate_recovery(&pin).map_err(map_security)?;
    Ok(RecoveryResult {
        recovery_code,
        status: state.security.status(&state.settings.snapshot()),
    })
}

/// Maps security failures to stable codes without leaking keychain internals.
fn map_security(error: SecurityError) -> CommandError {
    let details = error.details();
    let code = error.code();
    let message = match &error {
        SecurityError::PinPolicy(_) => "Use 4–8 digits for your PIN.",
        SecurityError::IncorrectPin { .. } => "That PIN is not correct.",
        SecurityError::LockedOut { .. } => "Too many attempts. Please wait before trying again.",
        SecurityError::Keychain(_) | SecurityError::Storage(_) => {
            tracing::error!(error = %error, "security storage failure");
            "Secure storage is unavailable right now."
        }
        SecurityError::AlreadyEnabled => "App lock is already enabled.",
        SecurityError::NotEnabled => "App lock is not enabled.",
        SecurityError::NotConfigured => "Set up an app PIN first.",
    };
    let error = CommandError::new(code, message);
    if let Some(details) = details {
        error.with_details(details)
    } else {
        error
    }
}

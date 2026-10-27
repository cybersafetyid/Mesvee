mod commands;
mod error;
mod infra;
mod logging;
mod security;
mod services;
mod settings;
mod state;
mod system;

use crate::commands::app::{
    app_ready, bootstrap, log_frontend, open_external, open_folder, quit_app, reset_preferences,
    send_test_notification, update_settings, window_close, window_is_maximized, window_minimize,
    window_toggle_maximize,
};
use crate::commands::diagnostics::export_diagnostics;
use crate::commands::security::{
    change_pin, disable_lock, enable_lock, lock_app, regenerate_recovery, reset_pin_with_recovery,
    security_status, unlock_app,
};
use crate::commands::services::{
    add_service, clear_service_data, remove_service, reorder_services, service_navigate,
    service_notification, set_active_service, set_service_muted, set_service_zoom, sync_workspace,
};
use crate::commands::updates::{check_for_update, install_update};
use crate::security::SecurityService;
use crate::services::views::ServiceViews;
use crate::settings::{LogLevel, SettingsStore};
use crate::state::{AppPaths, AppState};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

/// Native application entrypoint used by both platforms.
pub fn run() {
    let builder = tauri::Builder::default()
        // Single instance must be registered before all other plugins.
        .plugin(tauri_plugin_single_instance::init(|app, _arguments, _cwd| {
            tracing::info!("second instance detected; showing the existing window");
            system::show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        // Size/position survive restarts, decorations never do: the window is
        // frameless by design, and restoring a stale `decorated: true` (written
        // while a macOS override existed) re-added the native titlebar — and with
        // it a second set of traffic lights on top of the custom titlebar.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            app_ready,
            update_settings,
            reset_preferences,
            window_minimize,
            window_toggle_maximize,
            window_is_maximized,
            window_close,
            quit_app,
            open_external,
            open_folder,
            send_test_notification,
            log_frontend,
            security_status,
            enable_lock,
            disable_lock,
            lock_app,
            unlock_app,
            change_pin,
            reset_pin_with_recovery,
            regenerate_recovery,
            add_service,
            remove_service,
            set_active_service,
            reorder_services,
            set_service_muted,
            set_service_zoom,
            sync_workspace,
            service_navigate,
            clear_service_data,
            service_notification,
            check_for_update,
            install_update,
            export_diagnostics,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Resolve all user-scoped paths before anything can write to disk.
            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|error| format!("failed to resolve config directory: {error}"))?;
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("failed to resolve data directory: {error}"))?;
            let log_dir = app
                .path()
                .app_log_dir()
                .map_err(|error| format!("failed to resolve log directory: {error}"))?;
            for directory in [&config_dir, &data_dir, &log_dir] {
                std::fs::create_dir_all(directory)
                    .map_err(|error| format!("failed to create {}: {error}", directory.display()))?;
            }

            let (settings_store, mut startup_warning) =
                SettingsStore::load(config_dir.join("settings.json"));
            let initial_settings = settings_store.snapshot();

            let log_guard = logging::init(&log_dir, initial_settings.advanced.log_level)?;
            logging::install_panic_hook();
            tracing::info!(
                version = %app.package_info().version,
                platform = std::env::consts::OS,
                arch = std::env::consts::ARCH,
                "Mesvee starting"
            );

            // Initialize secure storage and repair an inconsistent lock flag.
            let security = SecurityService::new(config_dir.join("security-state.json"));
            let status = match security.initialize(&initial_settings) {
                Ok(status) => status,
                Err(error) => {
                    tracing::error!(error = %error, "failed to initialize secure storage");
                    startup_warning = Some("secure-storage-unavailable".into());
                    if initial_settings.security.lock_enabled {
                        let _ = settings_store.update(|settings| {
                            settings.security.lock_enabled = false;
                            Ok(())
                        });
                    }
                    security
                        .status(&settings_store.snapshot())
                }
            };
            if initial_settings.security.lock_enabled && !status.configured {
                tracing::warn!("lock flag had no keychain entry; disabling app lock");
                let _ = settings_store.update(|settings| {
                    settings.security.lock_enabled = false;
                    Ok(())
                });
                startup_warning = Some("lock-unconfigured".into());
            }

            let views = ServiceViews::new(data_dir.join("sessions"));
            let paths = AppPaths {
                config_dir,
                data_dir,
                log_dir,
            };
            app.manage(AppState::new(
                settings_store,
                security,
                views,
                paths,
                log_guard,
                startup_warning,
            ));

            let settings = app.state::<AppState>().settings.snapshot();

            system::apply_theme(&handle, &settings);
            system::sync_autostart(&handle, &settings);
            if let Err(error) = system::create_tray(&handle) {
                tracing::warn!(error = %error, "failed to create tray icon");
            }
            system::apply_startup_lock(&handle);
            security::watcher::spawn_idle_watcher(handle.clone());
            commands::updates::spawn_auto_updates(handle.clone());

            // Safety net: never leave the app invisible if the renderer fails to
            // report readiness. Respect an explicit start-minimized preference.
            if !settings.general.start_minimized || !settings.onboarded {
                let fallback = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(9));
                    if let Some(window) = fallback.get_window("main") {
                        if !window.is_visible().unwrap_or(true) {
                            tracing::warn!("frontend did not report ready; showing fallback window");
                            system::show_main_window(&fallback);
                        }
                    }
                });
            }

            tracing::info!("startup complete");
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle().clone();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    let Some(state) = app.try_state::<AppState>() else {
                        return;
                    };
                    if state.quitting.load(Ordering::SeqCst) {
                        return;
                    }
                    let settings = state.settings.snapshot();
                    if settings.general.close_to_tray && settings.general.show_tray_icon {
                        api.prevent_close();
                        let _ = window.hide();
                        tracing::debug!("window hidden to tray");
                    } else {
                        api.prevent_close();
                        state.quitting.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                }
                WindowEvent::Focused(false) => {
                    let Some(state) = app.try_state::<AppState>() else {
                        return;
                    };
                    let settings = state.settings.snapshot();
                    if !settings.security.lock_enabled
                        || !settings.security.lock_on_focus_loss
                        || state.security.is_locked()
                    {
                        return;
                    }
                    // Grace period avoids locking for transient focus changes
                    // caused by permission sheets or the menu bar.
                    let app_for_check = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(1_500));
                        if let Some(window) = app_for_check.get_window("main") {
                            if !window.is_focused().unwrap_or(false) {
                                system::lock_workspace(&app_for_check, "focus-lost");
                            }
                        }
                    });
                }
                _ => {}
            }
        });

    match builder.build(tauri::generate_context!()) {
        Ok(app) => {
            app.run(|app_handle, event| {
                // macOS dock click after closing to tray brings the app back.
                if let RunEvent::Reopen { .. } = event {
                    system::show_main_window(app_handle);
                }
            });
        }
        Err(error) => {
            tracing::error!(error = %error, "failed to build Mesvee");
            eprintln!("Mesvee failed to start: {error}");
        }
    }
}

/// Ensures the log level enum is available to the frontend-facing About screen.
pub fn log_level_label(level: LogLevel) -> &'static str {
    level.as_filter()
}

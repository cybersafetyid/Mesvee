use crate::settings::{Language, Settings, Theme};
use crate::state::AppState;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuEvent};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Theme as NativeTheme};

/// Localized labels for the tray menu.
struct TrayLabels {
    show: &'static str,
    settings: &'static str,
    lock: &'static str,
    updates: &'static str,
    quit: &'static str,
}

/// Resolves the user's language once instead of hardcoding English in native UI.
fn tray_labels(language: Language) -> TrayLabels {
    match language {
        Language::Id => TrayLabels {
            show: "Tampilkan Mesvee",
            settings: "Pengaturan…",
            lock: "Kunci aplikasi",
            updates: "Periksa pembaruan…",
            quit: "Keluar dari Mesvee",
        },
        Language::En => TrayLabels {
            show: "Show Mesvee",
            settings: "Settings…",
            lock: "Lock Mesvee",
            updates: "Check for updates…",
            quit: "Quit Mesvee",
        },
    }
}

/// Shows, restores and focuses the main window from the tray or a second launch.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn is_main_thread() -> bool {
    unsafe extern "C" {
        fn pthread_main_np() -> i32;
    }
    unsafe { pthread_main_np() != 0 }
}

#[cfg(not(target_os = "macos"))]
fn is_main_thread() -> bool {
    true
}

/// Builds (or rebuilds) the native tray icon and menu from current settings.
pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    if !is_main_thread() {
        let handle = app.clone();
        app.run_on_main_thread(move || {
            if let Err(error) = create_tray(&handle) {
                tracing::warn!(error = %error, "failed to create tray on main thread");
            }
        })?;
        return Ok(());
    }

    let Some(state) = app.try_state::<AppState>() else {
        return Ok(());
    };
    let settings = state.settings.snapshot();

    // If the tray icon already exists, update its menu and visibility in-place.
    // This avoids removing and recreating the NSStatusItem, which causes race
    // conditions with concurrent badge/tooltip updates and AppKit assertions.
    if let Some(tray) = app.tray_by_id("mesvee-tray") {
        let _ = tray.set_visible(settings.general.show_tray_icon);
        let labels = tray_labels(settings.appearance.language);
        let menu = MenuBuilder::new(app)
            .text("show", labels.show)
            .text("settings", labels.settings)
            .separator()
            .text("lock", labels.lock)
            .text("updates", labels.updates)
            .separator()
            .text("quit", labels.quit)
            .build()?;
        let _ = tray.set_menu(Some(menu));
        return Ok(());
    }

    if !settings.general.show_tray_icon {
        return Ok(());
    }

    let labels = tray_labels(settings.appearance.language);
    let menu = MenuBuilder::new(app)
        .text("show", labels.show)
        .text("settings", labels.settings)
        .separator()
        .text("lock", labels.lock)
        .text("updates", labels.updates)
        .separator()
        .text("quit", labels.quit)
        .build()?;

    #[cfg(target_os = "macos")]
    let icon = Image::from_bytes(include_bytes!("../icons/trayTemplate.png"))?;
    #[cfg(not(target_os = "macos"))]
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::with_id("mesvee-tray")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_tray_menu(app, event))
        .on_tray_icon_event(|tray, event| {
            // Left click is reserved for showing the app; right click opens the menu.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Handles the static tray commands. All state mutations go through the same
/// Rust services used by the renderer.
fn handle_tray_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "show" => show_main_window(app),
        "settings" => {
            show_main_window(app);
            let _ = app.emit("mesvee:navigate", serde_json::json!({ "route": "settings" }));
        }
        "lock" => lock_workspace(app, "manual"),
        "updates" => {
            show_main_window(app);
            let _ = app.emit(
                "mesvee:navigate",
                serde_json::json!({ "route": "settings", "section": "updates" }),
            );
        }
        "quit" => {
            if let Some(state) = app.try_state::<AppState>() {
                state
                    .quitting
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            }
            app.exit(0);
        }
        other => tracing::debug!(id = other, "unhandled tray menu item"),
    }
}

/// Applies the persisted theme to native window chrome.
pub fn apply_theme(app: &AppHandle, settings: &Settings) {
    let native = match settings.appearance.theme {
        Theme::System => None,
        Theme::Dark => Some(NativeTheme::Dark),
        Theme::Light => Some(NativeTheme::Light),
    };
    if let Some(window) = app.get_window("main") {
        if let Err(error) = window.set_theme(native) {
            tracing::debug!(error = %error, "native theme update is unsupported");
        }
    }
}

/// Reconciles the operating system login item with the saved preference.
pub fn sync_autostart(app: &AppHandle, settings: &Settings) {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    match settings.general.launch_at_login {
        true => {
            if manager.is_enabled().unwrap_or(false) {
                return;
            }
            if let Err(error) = manager.enable() {
                tracing::warn!(error = %error, "failed to enable launch at login");
            }
        }
        false => {
            if !manager.is_enabled().unwrap_or(false) {
                return;
            }
            if let Err(error) = manager.disable() {
                tracing::warn!(error = %error, "failed to disable launch at login");
            }
        }
    }
}

/// Locks the workspace, hides native service views and enables screen-capture
/// protection when configured. Emits a single event for the React lock screen.
pub fn lock_workspace(app: &AppHandle, reason: &str) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if !state.security.lock() {
        // Lock was requested before any PIN was configured.
        let _ = app.emit(
            "mesvee:navigate",
            serde_json::json!({ "route": "settings", "section": "security" }),
        );
        return;
    }
    let settings = state.settings.snapshot();
    state.views.suspend_for_lock();
    if settings.security.protect_screen_capture {
        if let Some(window) = app.get_window("main") {
            if let Err(error) = window.set_content_protected(true) {
                tracing::debug!(error = %error, "content protection is unavailable");
            }
        }
    }
    tracing::info!(reason, "workspace locked");
    let _ = app.emit(
        "mesvee:locked",
        serde_json::json!({ "reason": reason, "at": chrono::Utc::now().to_rfc3339() }),
    );
}

/// Reverses lock visuals. The renderer re-syncs the workspace after this event.
pub fn unlock_workspace(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.set_content_protected(false);
    }
    tracing::info!("workspace unlocked");
    let _ = app.emit("mesvee:unlocked", serde_json::json!({}));
}

/// Applies lock visuals at startup without re-emitting a lock transition.
pub fn apply_startup_lock(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if !state.security.is_locked() {
        return;
    }
    let settings = state.settings.snapshot();
    state.views.suspend_for_lock();
    if settings.security.protect_screen_capture {
        if let Some(window) = app.get_window("main") {
            let _ = window.set_content_protected(true);
        }
    }
}

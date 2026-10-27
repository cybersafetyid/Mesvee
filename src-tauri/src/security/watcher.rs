use crate::state::AppState;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Polls OS-level idle time on a dedicated low-frequency thread.
///
/// This works even while Mesvee is in the background and messaging webviews are
/// receiving messages, which a renderer timer could not guarantee. The thread
/// exits when the process exits; polling every 15 seconds is negligible.
pub fn spawn_idle_watcher(app: AppHandle) {
    thread::Builder::new()
        .name("mesvee-idle-watcher".into())
        .spawn(move || {
            thread::sleep(Duration::from_secs(20));
            loop {
                if let Some(state) = app.try_state::<AppState>() {
                    let settings = state.settings.snapshot();
                    let timeout = settings.security.auto_lock_minutes;
                    if settings.security.lock_enabled
                        && timeout > 0
                        && !state.security.is_locked()
                    {
                        match user_idle::UserIdle::get_time() {
                            Ok(idle) if idle.as_seconds() >= u64::from(timeout) * 60 => {
                                tracing::info!(
                                    idle_seconds = idle.as_seconds(),
                                    timeout_minutes = timeout,
                                    "auto-locking after inactivity"
                                );
                                crate::system::lock_workspace(&app, "idle");
                            }
                            Ok(_) => {}
                            Err(error) => {
                                tracing::debug!(error = %error, "idle time unavailable");
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_secs(15));
            }
        })
        .expect("failed to start idle watcher");
}

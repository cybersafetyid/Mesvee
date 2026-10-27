use crate::security::SecurityService;
use crate::services::views::ServiceViews;
use crate::settings::SettingsStore;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use tracing_appender::non_blocking::WorkerGuard;

/// Filesystem locations resolved once during startup.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
}

/// State shared by every Tauri command and system callback.
pub struct AppState {
    pub settings: SettingsStore,
    pub security: SecurityService,
    pub views: ServiceViews,
    pub paths: AppPaths,
    /// Set before an intentional exit so hide-to-tray does not intercept quit.
    pub quitting: AtomicBool,
    /// Non-fatal startup recovery message surfaced in bootstrap.
    pub startup_warning: Mutex<Option<String>>,
    /// Kept alive so tracing's non-blocking writer flushes on exit.
    #[allow(dead_code)]
    pub log_guard: Mutex<Option<WorkerGuard>>,
}

impl AppState {
    /// Creates state after paths and settings have been loaded.
    pub fn new(
        settings: SettingsStore,
        security: SecurityService,
        views: ServiceViews,
        paths: AppPaths,
        log_guard: WorkerGuard,
        startup_warning: Option<String>,
    ) -> Self {
        Self {
            settings,
            security,
            views,
            paths,
            quitting: AtomicBool::new(false),
            startup_warning: Mutex::new(startup_warning),
            log_guard: Mutex::new(Some(log_guard)),
        }
    }

    /// Reads and clears the one-time startup warning.
    pub fn take_warning(&self) -> Option<String> {
        self.startup_warning.lock().take()
    }
}

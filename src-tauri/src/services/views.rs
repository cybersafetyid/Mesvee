use crate::services::{catalog, notifications, unread};
use crate::settings::{ServiceInstance, Settings};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::{
    DownloadEvent, NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse,
    WebviewBuilder,
};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

/// Event emitted whenever a service title/unread/loading state changes.
pub const SERVICE_STATE_EVENT: &str = "mesvee:service-state";
/// Event emitted when a service download finishes or fails.
pub const DOWNLOAD_EVENT: &str = "mesvee:download";

/// Logical window-space rectangle reported by the React layout.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Default for WorkspaceBounds {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 100.0,
            width: 1000.0,
            height: 700.0,
        }
    }
}

impl WorkspaceBounds {
    /// Rejects NaN, negative sizes and absurd coordinates before touching native APIs.
    pub fn is_valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.x.abs() <= 20_000.0
            && self.y.abs() <= 20_000.0
            && (1.0..=20_000.0).contains(&self.width)
            && (1.0..=20_000.0).contains(&self.height)
    }
}

/// Serializable runtime state consumed by the shell.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRuntimeState {
    pub service_id: String,
    pub unread: u32,
    pub loading: bool,
    pub title: String,
    pub error: Option<String>,
    pub url: Option<String>,
    pub created: bool,
}

#[derive(Default)]
struct ViewRuntime {
    views: HashMap<String, Webview>,
    tokens: HashMap<String, String>,
    unread: HashMap<String, u32>,
    titles: HashMap<String, String>,
    loading: HashSet<String>,
    errors: HashMap<String, String>,
    active: Option<String>,
    bounds: WorkspaceBounds,
    visible: bool,
    /// Recent notification timestamps per service, used for flood protection.
    notification_hits: HashMap<String, Vec<Instant>>,
}

/// Owns every service webview. All methods are thread-safe; native webview calls
/// are made without holding the manager lock.
pub struct ServiceViews {
    sessions_root: PathBuf,
    runtime: Mutex<ViewRuntime>,
    creation_lock: Mutex<()>,
}

impl ServiceViews {
    /// Creates an empty manager rooted at the per-user session directory.
    pub fn new(sessions_root: PathBuf) -> Self {
        Self {
            sessions_root,
            runtime: Mutex::new(ViewRuntime::default()),
            creation_lock: Mutex::new(()),
        }
    }

    /// Deterministic webview label. Kept separate from the user-facing title.
    pub fn label_for(service_id: &str) -> String {
        format!("service-{service_id}")
    }

    /// Full session directory for one service instance.
    pub fn session_dir(&self, service_id: &str) -> PathBuf {
        self.sessions_root.join(service_id)
    }

    /// Hides every hosted webview without destroying its session.
    pub fn hide_all(&self) {
        let views: Vec<Webview> = self.runtime.lock().views.values().cloned().collect();
        for view in views {
            if let Err(error) = view.hide() {
                tracing::warn!(error = %error, "failed to hide service webview");
            }
        }
    }

    /// On lock we additionally stop page audio inside service webviews.
    pub fn suspend_for_lock(&self) {
        let views: Vec<Webview> = self.runtime.lock().views.values().cloned().collect();
        for view in views {
            let _ = view.eval(
                "document.querySelectorAll('audio,video').forEach((media) => { try { media.pause(); } catch (_) {} });",
            );
            if let Err(error) = view.hide() {
                tracing::warn!(error = %error, "failed to hide service webview while locking");
            }
        }
    }

    /// Returns a snapshot for one service, including its current URL when loaded.
    pub fn state_for(&self, service_id: &str) -> ServiceRuntimeState {
        let runtime = self.runtime.lock();
        let view = runtime.views.get(service_id);
        let url = view
            .and_then(|view| view.url().ok())
            .map(|url| url.to_string());
        ServiceRuntimeState {
            service_id: service_id.to_string(),
            unread: runtime.unread.get(service_id).copied().unwrap_or(0),
            loading: runtime.loading.contains(service_id),
            title: runtime.titles.get(service_id).cloned().unwrap_or_default(),
            error: runtime.errors.get(service_id).cloned(),
            url,
            created: view.is_some(),
        }
    }

    /// All known runtime states.
    #[allow(dead_code)]
    pub fn runtime_states(&self) -> Vec<ServiceRuntimeState> {
        let ids: Vec<String> = self.runtime.lock().views.keys().cloned().collect();
        ids.into_iter().map(|id| self.state_for(&id)).collect()
    }

    /// Total unread count that should appear on the dock/taskbar badge.
    pub fn total_unread(&self, settings: &Settings) -> u32 {
        let runtime = self.runtime.lock();
        settings
            .services
            .iter()
            .filter(|service| !service.muted)
            .map(|service| runtime.unread.get(&service.id).copied().unwrap_or(0))
            .sum()
    }

    /// Applies the native dock/taskbar badge and tray tooltip.
    pub fn refresh_badge(&self, app: &AppHandle, settings: &Settings) {
        let total = if settings.notifications.enabled
            && !settings.notifications.focus_mode
            && settings.notifications.show_badge
        {
            self.total_unread(settings)
        } else {
            0
        };

        if let Some(window) = app.get_window("main") {
            // `None` clears the badge entirely: passing `Some(0)` makes macOS and
            // several Linux shells draw a literal "0" on the app icon.
            let badge = (total > 0).then(|| i64::from(total));
            if let Err(error) = window.set_badge_count(badge) {
                tracing::debug!(error = %error, "badge count is not supported on this platform");
            }
        }
        if let Some(tray) = app.tray_by_id("mesvee-tray") {
            let tooltip = if total > 0 {
                format!("Mesvee — {total} unread")
            } else {
                "Mesvee".to_string()
            };
            let _ = tray.set_tooltip(Some(tooltip));
        }
    }

    /// Pushes the current notification permission into every live page so a
    /// settings change takes effect without reloading the service.
    pub fn broadcast_notification_permission(&self, views_are_enabled: bool) {
        let script = notifications::permission_script(views_are_enabled);
        let views: Vec<Webview> = self.runtime.lock().views.values().cloned().collect();
        for view in views {
            let _ = view.eval(&script);
        }
    }

    /// Hides old views, creates the active view on demand and positions it over
    /// the React layout's placeholder rectangle.
    pub fn sync_workspace(
        &self,
        app: &AppHandle,
        settings: &Settings,
        active_id: Option<String>,
        visible: bool,
        bounds: WorkspaceBounds,
    ) -> Result<(), String> {
        if !bounds.is_valid() {
            return Err("workspace bounds are invalid".into());
        }

        {
            let mut runtime = self.runtime.lock();
            runtime.active = active_id.clone();
            runtime.bounds = bounds;
            runtime.visible = visible;
        }

        self.hide_all();

        if !visible {
            self.focus_shell(app);
            return Ok(());
        }

        let Some(service_id) = active_id else {
            self.focus_shell(app);
            return Ok(());
        };
        let Some(instance) = settings
            .services
            .iter()
            .find(|service| service.id == service_id)
            .cloned()
        else {
            return Err("active service is not configured".into());
        };

        let label = Self::label_for(&service_id);
        let _creation_guard = self.creation_lock.lock();

        let existing = self
            .runtime
            .lock()
            .views
            .get(&service_id)
            .cloned()
            .or_else(|| app.get_webview(&label));

        let view = match existing {
            Some(view) => {
                self.runtime
                    .lock()
                    .views
                    .insert(service_id.clone(), view.clone());
                view
            }
            None => self.create_view(app, settings, &instance, bounds)?,
        };

        view.set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|error| format!("failed to position service webview: {error}"))?;
        view.set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|error| format!("failed to size service webview: {error}"))?;
        view.show()
            .map_err(|error| format!("failed to show service webview: {error}"))?;
        view.set_focus()
            .map_err(|error| format!("failed to focus service webview: {error}"))?;
        Ok(())
    }

    /// Removes a view from management and closes it. The caller decides whether
    /// to clear its persistent session afterwards.
    pub fn close_view(&self, service_id: &str) -> Option<Webview> {
        let _creation_guard = self.creation_lock.lock();
        let view = {
            let mut runtime = self.runtime.lock();
            runtime.tokens.remove(service_id);
            runtime.unread.remove(service_id);
            runtime.titles.remove(service_id);
            runtime.loading.remove(service_id);
            runtime.errors.remove(service_id);
            runtime.notification_hits.remove(service_id);
            if runtime.active.as_deref() == Some(service_id) {
                runtime.active = None;
            }
            runtime.views.remove(service_id)
        };
        if let Some(view) = &view {
            let _ = view.hide();
            if let Err(error) = view.close() {
                tracing::warn!(error = %error, service_id, "failed to close service webview");
            }
        }
        view
    }

    /// Returns the currently active webview if it exists.
    pub fn active_view(&self) -> Option<Webview> {
        let runtime = self.runtime.lock();
        runtime
            .active
            .as_ref()
            .and_then(|id| runtime.views.get(id).cloned())
    }

    /// Marks an error so the shell can show a retry state instead of a blank area.
    pub fn mark_error(&self, app: &AppHandle, service_id: &str, error: impl Into<String>) {
        let message = error.into();
        {
            let mut runtime = self.runtime.lock();
            runtime.errors.insert(service_id.to_string(), message.clone());
            runtime.loading.remove(service_id);
        }
        tracing::error!(service_id, error = %message, "service failed to load");
        let _ = app.emit(
            SERVICE_STATE_EVENT,
            self.state_for(service_id),
        );
    }

    /// Clears a previous error before a navigation attempt.
    pub fn clear_error(&self, service_id: &str) {
        self.runtime.lock().errors.remove(service_id);
    }

    /// Verifies a notification bridge call. Returns the authenticated service ID
    /// or a short reason suitable for logs.
    pub fn authorize_notification(
        &self,
        webview_label: &str,
        token: &str,
        settings: &Settings,
        window_focused: bool,
    ) -> Result<String, &'static str> {
        let service_id = webview_label
            .strip_prefix("service-")
            .ok_or("notification call did not originate from a service webview")?;

        let instance = settings
            .services
            .iter()
            .find(|service| service.id == service_id)
            .ok_or("notification service is no longer configured")?;
        if instance.muted {
            return Err("service is muted");
        }
        if !settings.notifications.enabled || settings.notifications.focus_mode {
            return Err("notifications are paused");
        }
        if settings.notifications.only_when_unfocused && window_focused {
            return Err("app is focused");
        }

        let mut runtime = self.runtime.lock();
        let expected = runtime
            .tokens
            .get(service_id)
            .ok_or("service notification token is missing")?;
        if expected != token {
            return Err("notification token mismatch");
        }

        let now = Instant::now();
        let window = Duration::from_secs(30);
        let hits = runtime
            .notification_hits
            .entry(service_id.to_string())
            .or_default();
        hits.retain(|instant| now.duration_since(*instant) <= window);
        if hits.len() >= 8 {
            return Err("notification rate limit reached");
        }
        hits.push(now);
        Ok(service_id.to_string())
    }

    /// Updates title-derived unread count, emits state and refreshes the badge.
    pub fn handle_title(&self, app: &AppHandle, service_id: &str, title: String) {
        let title = title.trim().to_string();
        let count = unread::parse_unread(&title);
        {
            let mut runtime = self.runtime.lock();
            runtime.titles.insert(service_id.to_string(), title);
            runtime.unread.insert(service_id.to_string(), count);
        }
        let _ = app.emit(SERVICE_STATE_EVENT, self.state_for(service_id));
        if let Some(state) = app.try_state::<AppState>() {
            let settings = state.settings.snapshot();
            self.refresh_badge(app, &settings);
        }
    }

    /// Updates loading state and emits it to the shell.
    pub fn set_loading(&self, app: &AppHandle, service_id: &str, loading: bool) {
        {
            let mut runtime = self.runtime.lock();
            if loading {
                runtime.loading.insert(service_id.to_string());
                runtime.errors.remove(service_id);
            } else {
                runtime.loading.remove(service_id);
            }
        }
        let _ = app.emit(SERVICE_STATE_EVENT, self.state_for(service_id));
    }

    /// Sends focus back to the trusted shell when a native view is hidden.
    fn focus_shell(&self, app: &AppHandle) {
        if let Some(window) = app.get_window("main") {
            if window.is_focused().unwrap_or(false) {
                if let Some(shell) = app.get_webview("main") {
                    let _ = shell.set_focus();
                }
            }
        }
    }

    /// Creates one child webview with an isolated data store and hardened policy.
    fn create_view(
        &self,
        app: &AppHandle,
        settings: &Settings,
        instance: &ServiceInstance,
        bounds: WorkspaceBounds,
    ) -> Result<Webview, String> {
        let definition = catalog::find(&instance.kind)
            .ok_or_else(|| format!("unknown service kind {}", instance.kind))?;
        let url = url::Url::parse(definition.url).map_err(|error| error.to_string())?;
        let window = app
            .get_window("main")
            .ok_or_else(|| "main window is unavailable".to_string())?;
        let label = Self::label_for(&instance.id);
        if let Some(existing_view) = app.get_webview(&label) {
            self.runtime
                .lock()
                .views
                .insert(instance.id.clone(), existing_view.clone());
            return Ok(existing_view);
        }
        let uuid = Uuid::parse_str(&instance.id)
            .map_err(|_| "service identifier is not a valid UUID".to_string())?;

        let token = {
            let mut runtime = self.runtime.lock();
            runtime
                .tokens
                .entry(instance.id.clone())
                .or_insert_with(|| format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()))
                .clone()
        };

        let session_dir = self.session_dir(&instance.id);
        std::fs::create_dir_all(&session_dir)
            .map_err(|error| format!("failed to create session directory: {error}"))?;

        let init_script = notifications::initialization_script(
            &instance.id,
            &token,
            settings.notifications.enabled,
        );

        let app_for_title = app.clone();
        let id_for_title = instance.id.clone();
        let app_for_load = app.clone();
        let id_for_load = instance.id.clone();
        let app_for_permissions = app.clone();
        let app_for_popups = app.clone();
        let app_for_downloads = app.clone();
        // Maps a download URL to the destination chosen when it was requested;
        // macOS reports an empty path when the download finishes.
        let download_paths: Arc<Mutex<HashMap<String, PathBuf>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let downloads_for_request = download_paths.clone();

        let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
            // WKWebView's stock UA omits the `Version/… Safari/…` token, so sites
            // such as WhatsApp classify it as an unsupported browser and render
            // their "update Safari" page. The engine is the system WebKit, so a
            // current Safari UA describes it accurately and unlocks the app.
            .user_agent(catalog::SERVICE_USER_AGENT)
            // WKWebView ignores data_directory; the identifier provides a stable
            // per-account WKWebsiteDataStore on macOS 14+.
            .data_directory(session_dir)
            .data_store_identifier(*uuid.as_bytes())
            .initialization_script(init_script)
            .background_throttling(BackgroundThrottlingPolicy::Disabled)
            .zoom_hotkeys_enabled(true)
            .devtools(cfg!(debug_assertions))
            // HTTPS-only: plaintext hops are refused so an on-path attacker can
            // never rewrite a page that already holds the user's session.
            .on_navigation(|target| catalog::is_navigation_allowed(target))
            .on_new_window(move |target, _features| {
                if catalog::is_safe_web_url(&target) {
                    if let Err(error) = app_for_popups.opener().open_url(target.as_str(), None::<&str>) {
                        tracing::warn!(error = %error, "failed to open popup in the system browser");
                    }
                }
                // Popups without a shared session are a security and login hazard.
                NewWindowResponse::Deny
            })
            .on_permission_request(move |_webview, kind| {
                let Some(state) = app_for_permissions.try_state::<AppState>() else {
                    return PermissionResponse::Deny;
                };
                let settings = state.settings.snapshot();
                match kind {
                    PermissionKind::Microphone if settings.media.microphone => {
                        PermissionResponse::Allow
                    }
                    PermissionKind::Camera if settings.media.camera => PermissionResponse::Allow,
                    PermissionKind::Notifications => PermissionResponse::Allow,
                    PermissionKind::Autoplay => PermissionResponse::Allow,
                    _ => PermissionResponse::Deny,
                }
            })
            .on_document_title_changed(move |_webview, title| {
                if let Some(state) = app_for_title.try_state::<AppState>() {
                    state.views.handle_title(&app_for_title, &id_for_title, title);
                }
            })
            .on_page_load(move |_webview, payload| {
                if let Some(state) = app_for_load.try_state::<AppState>() {
                    match payload.event() {
                        PageLoadEvent::Started => {
                            state.views.set_loading(&app_for_load, &id_for_load, true);
                        }
                        PageLoadEvent::Finished => {
                            state.views.set_loading(&app_for_load, &id_for_load, false);
                            // Re-assert the current notification policy after in-page navigation.
                            let settings = state.settings.snapshot();
                            state
                                .views
                                .broadcast_notification_permission(settings.notifications.enabled);
                        }
                    }
                }
            })
            .on_download(move |_webview, event| {
                match event {
                    DownloadEvent::Requested { url, destination } => {
                        // Downloads land in the user's Downloads folder with a
                        // collision-free name instead of an opaque temp path.
                        if let Some(path) = resolve_download_path(&app_for_downloads, &url) {
                            tracing::info!(url = %url, path = %path.display(), "service download started");
                            downloads_for_request.lock().insert(url.to_string(), path.clone());
                            *destination = path;
                        } else {
                            tracing::warn!(url = %url, "could not resolve a download destination");
                        }
                    }
                    DownloadEvent::Finished { url, path, success } => {
                        let key = url.to_string();
                        // Fall back to the destination we chose: macOS reports none.
                        let tracked = download_paths.lock().remove(&key);
                        let final_path = path.or(tracked);
                        let payload = serde_json::json!({
                            "url": key,
                            "path": final_path.map(|path| path.to_string_lossy().to_string()),
                            "success": success,
                        });
                        let _ = app_for_downloads.emit(DOWNLOAD_EVENT, payload);
                    }
                    _ => {}
                }
                true
            });

        let view = window
            .add_child(
                builder,
                LogicalPosition::new(bounds.x, bounds.y),
                LogicalSize::new(bounds.width, bounds.height),
            )
            .map_err(|error| format!("failed to create isolated webview: {error}"))?;

        // A child webview is a plain rectangle, so its square corners would
        // cover the card's rounded frame and the page would read as sitting on
        // top of the card instead of inside it.
        #[cfg(target_os = "macos")]
        round_page_corners(&view);

        // Re-apply the per-service zoom: a rebuilt webview starts at 100% and
        // would otherwise silently disagree with the saved preference.
        let zoom = instance.zoom.clamp(0.75, 1.5);
        if (zoom - 1.0).abs() > f64::EPSILON {
            if let Err(error) = view.set_zoom(zoom) {
                tracing::warn!(error = %error, service_id = instance.id, "failed to restore service zoom");
            }
        }

        self.runtime
            .lock()
            .views
            .insert(instance.id.clone(), view.clone());

        tracing::info!(
            service_kind = instance.kind,
            service_id = instance.id,
            "service webview created"
        );
        let _ = app.emit(SERVICE_STATE_EVENT, self.state_for(&instance.id));
        Ok(view)
    }
}

/// Corner radius applied to the hosted page so it matches the service card.
#[cfg(target_os = "macos")]
const PAGE_CORNER_RADIUS: f64 = 19.0;

/// Rounds the native page view so it fits inside the card's frame.
///
/// WKWebView is layer-backed, so one corner radius plus clipping is enough. Bounds,
/// hit testing and the rect the renderer measures stay untouched, which keeps the
/// page flush with the card while its corners follow the card's radius.
#[cfg(target_os = "macos")]
fn round_page_corners(view: &Webview) {
    let result = view.with_webview(|platform| unsafe {
        let ns_view = platform.inner() as *mut objc2::runtime::AnyObject;
        if ns_view.is_null() {
            return;
        }
        let ns_view = &*ns_view;
        let _: () = objc2::msg_send![ns_view, setWantsLayer: true];
        let layer: *mut objc2::runtime::AnyObject = objc2::msg_send![ns_view, layer];
        if layer.is_null() {
            return;
        }
        let layer = &*layer;
        let _: () = objc2::msg_send![layer, setCornerRadius: PAGE_CORNER_RADIUS];
        let _: () = objc2::msg_send![layer, setMasksToBounds: true];
    });
    if let Err(error) = result {
        tracing::debug!(error = %error, "failed to round the service page corners");
    }
}

/// Waits briefly for the platform to release a webview's profile files.
///
/// Called from async commands, so the wait happens on a blocking thread instead
/// of parking a runtime worker for half a second.
pub async fn settle_for_session_release() {
    let _ = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(Duration::from_millis(550));
    })
    .await;
}

/// Derives a safe, human-recognisable file name from a download URL.
///
/// The last path segment is used, every character outside a conservative set is
/// replaced, and an empty or path-like result falls back to a generic name.
pub fn download_file_name(url: &url::Url) -> String {
    let raw = url
        .path_segments()
        .and_then(|segments| segments.rev().find(|segment| !segment.is_empty()))
        .map(percent_decode)
        .unwrap_or_else(|| "mesvee-download".to_string());
    let sanitized: String = raw
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let sanitized = sanitized.trim_matches(['.', ' ']).to_string();
    if sanitized.is_empty() {
        "mesvee-download".to_string()
    } else {
        sanitized
    }
}

/// Decodes `%XX` escapes so a download keeps its real file name.
///
/// Writing a tiny decoder avoids another dependency for the only place the app
/// needs percent-decoding; invalid escapes are kept verbatim and the result is
/// lossily converted, which is fine for a file label.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex_value(bytes[index + 1]), hex_value(bytes[index + 2])) {
                decoded.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

/// Value of one hexadecimal digit, or `None` for anything else.
fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Picks a collision-free path inside the user's Downloads folder.
fn resolve_download_path(app: &AppHandle, url: &url::Url) -> Option<PathBuf> {
    let directory = app.path().download_dir().ok()?;
    std::fs::create_dir_all(&directory).ok()?;
    let name = download_file_name(url);
    let candidate = directory.join(&name);
    if !candidate.exists() {
        return Some(candidate);
    }
    let stem = Path::new(&name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "mesvee-download".to_string());
    let extension = Path::new(&name)
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..1000 {
        let candidate = directory.join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// Clears the session directory for a service after its webview has been closed.
/// Failures are logged; privacy cleanup is best-effort on platforms that keep
/// dedicated profile files open briefly.
pub fn remove_session_directory(path: &Path) {
    if !path.exists() {
        return;
    }
    match std::fs::remove_dir_all(path) {
        Ok(()) => tracing::info!(path = %path.display(), "service session directory removed"),
        Err(error) => tracing::warn!(
            path = %path.display(),
            error = %error,
            "could not fully remove service session directory"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Layout rectangles must reject NaN and collapsed sizes.
    #[test]
    fn bounds_validation() {
        assert!(WorkspaceBounds::default().is_valid());
        assert!(!WorkspaceBounds { width: 0.0, ..Default::default() }.is_valid());
        assert!(!WorkspaceBounds { height: f64::NAN, ..Default::default() }.is_valid());
        assert!(!WorkspaceBounds { x: 1e9, ..Default::default() }.is_valid());
    }

    /// Webview labels must be deterministic and clearly separated from the shell.
    #[test]
    fn labels_are_namespaced() {
        let id = "48d3ee8a-65e5-4c66-bd0f-2e4b70e19a2a";
        assert_eq!(ServiceViews::label_for(id), format!("service-{id}"));
    }

    /// Download names stay local, readable and free of path separators.
    #[test]
    fn download_names_are_safe() {
        let url = url::Url::parse("https://cdn.example.com/files/report%20final.pdf").unwrap();
        assert_eq!(download_file_name(&url), "report final.pdf");

        let traversal = url::Url::parse("https://cdn.example.com/..%2F..%2Fetc%2Fpasswd").unwrap();
        let name = download_file_name(&traversal);
        assert!(!name.contains('/') && !name.contains('\\'), "unexpected name {name}");

        let trailing = url::Url::parse("https://cdn.example.com/files/").unwrap();
        assert_eq!(download_file_name(&trailing), "files");

        let root = url::Url::parse("https://cdn.example.com").unwrap();
        assert_eq!(download_file_name(&root), "mesvee-download");
    }
}

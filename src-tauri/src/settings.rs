use crate::infra::atomic_json::{backup_corrupt, read_json, write_json_atomic};
use crate::services::catalog;
use anyhow::{Context, Result};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Bump this when the persisted shape changes in a way that needs migration.
pub const SETTINGS_SCHEMA_VERSION: u32 = 1;
/// A hard product limit that keeps memory usage predictable.
pub const MAX_SERVICES: usize = 16;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    Id,
    En,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum MotionPreference {
    #[default]
    System,
    Reduce,
    Full,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    #[default]
    Comfortable,
    Compact,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    #[default]
    Info,
    Debug,
}

impl LogLevel {
    /// Maps the persisted level to a `tracing` filter directive.
    pub fn as_filter(self) -> &'static str {
        match self {
            Self::Error => "error,tao=error,wry=error",
            Self::Warn => "warn,tao=warn,wry=warn",
            Self::Info => "info,tao=warn,wry=warn",
            Self::Debug => "debug,tao=info,wry=info",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralSettings {
    pub launch_at_login: bool,
    pub start_minimized: bool,
    pub close_to_tray: bool,
    pub show_tray_icon: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            start_minimized: false,
            close_to_tray: true,
            show_tray_icon: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    pub language: Language,
    pub theme: Theme,
    pub motion: MotionPreference,
    pub density: Density,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            language: Language::Id,
            theme: Theme::System,
            motion: MotionPreference::System,
            density: Density::Comfortable,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub show_badge: bool,
    pub only_when_unfocused: bool,
    pub focus_mode: bool,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            show_badge: true,
            only_when_unfocused: true,
            focus_mode: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SecuritySettings {
    /// Owned by the Rust lock service, never patched directly by the renderer.
    pub lock_enabled: bool,
    pub auto_lock_minutes: u32,
    pub lock_on_focus_loss: bool,
    pub protect_screen_capture: bool,
}

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            lock_enabled: false,
            auto_lock_minutes: 5,
            lock_on_focus_loss: false,
            protect_screen_capture: true,
        }
    }
}

/// Subset of security preferences the renderer may patch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SecurityPreferences {
    pub auto_lock_minutes: u32,
    pub lock_on_focus_loss: bool,
    pub protect_screen_capture: bool,
}

impl Default for SecurityPreferences {
    fn default() -> Self {
        Self {
            auto_lock_minutes: 5,
            lock_on_focus_loss: false,
            protect_screen_capture: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaPermissions {
    pub microphone: bool,
    pub camera: bool,
}

impl Default for MediaPermissions {
    fn default() -> Self {
        Self {
            microphone: false,
            camera: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePreferences {
    pub auto_check: bool,
}

impl Default for UpdatePreferences {
    fn default() -> Self {
        Self { auto_check: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AdvancedSettings {
    pub log_level: LogLevel,
}

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self {
            log_level: LogLevel::Info,
        }
    }
}

/// One configured account/instance of a service. The `id` also names the
/// persistent webview data store, so it must never be reused after deletion.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInstance {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub muted: bool,
    pub zoom: f64,
    pub created_at: String,
}

/// Complete application settings persisted under the app config directory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub onboarded: bool,
    pub active_service_id: Option<String>,
    pub general: GeneralSettings,
    pub appearance: AppearanceSettings,
    pub notifications: NotificationSettings,
    pub security: SecuritySettings,
    pub media: MediaPermissions,
    pub updates: UpdatePreferences,
    pub advanced: AdvancedSettings,
    pub services: Vec<ServiceInstance>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            onboarded: false,
            active_service_id: None,
            general: GeneralSettings::default(),
            appearance: AppearanceSettings::default(),
            notifications: NotificationSettings::default(),
            security: SecuritySettings::default(),
            media: MediaPermissions::default(),
            updates: UpdatePreferences::default(),
            advanced: AdvancedSettings::default(),
            services: Vec::new(),
        }
    }
}

/// Partial settings update sent by the trusted shell. Every nested object is
/// complete, which keeps validation and side effects deterministic.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub onboarded: Option<bool>,
    pub general: Option<GeneralSettings>,
    pub appearance: Option<AppearanceSettings>,
    pub notifications: Option<NotificationSettings>,
    pub security: Option<SecurityPreferences>,
    pub media: Option<MediaPermissions>,
    pub updates: Option<UpdatePreferences>,
    pub advanced: Option<AdvancedSettings>,
}

impl Settings {
    /// Applies a trusted patch while leaving secrets and service ownership to
    /// their dedicated commands.
    pub fn apply_patch(&mut self, patch: SettingsPatch) {
        if let Some(value) = patch.onboarded {
            self.onboarded = value;
        }
        if let Some(value) = patch.general {
            self.general = value;
        }
        if let Some(value) = patch.appearance {
            self.appearance = value;
        }
        if let Some(value) = patch.notifications {
            self.notifications = value;
        }
        if let Some(value) = patch.security {
            self.security.auto_lock_minutes = value.auto_lock_minutes;
            self.security.lock_on_focus_loss = value.lock_on_focus_loss;
            self.security.protect_screen_capture = value.protect_screen_capture;
        }
        if let Some(value) = patch.media {
            self.media = value;
        }
        if let Some(value) = patch.updates {
            self.updates = value;
        }
        if let Some(value) = patch.advanced {
            self.advanced = value;
        }
    }

    /// Normalizes recoverable input and enforces invariants before persistence.
    pub fn normalize(&mut self) {
        self.schema_version = SETTINGS_SCHEMA_VERSION;
        if self.general.show_tray_icon == false {
            // Without a tray icon there would be no way back into a hidden window.
            self.general.close_to_tray = false;
        }
        if self.security.auto_lock_minutes > 240 {
            self.security.auto_lock_minutes = 240;
        }
        for service in &mut self.services {
            service.label = clean_label(&service.label);
            service.zoom = service.zoom.clamp(0.75, 1.5);
        }
        if let Some(active) = &self.active_service_id {
            if !self.services.iter().any(|service| &service.id == active) {
                self.active_service_id = None;
            }
        }
    }

    /// Strict validation for values that cannot safely be normalized silently.
    pub fn validate(&self) -> Result<()> {
        if self.services.len() > MAX_SERVICES {
            anyhow::bail!("too many services configured");
        }
        let mut ids = std::collections::HashSet::new();
        for service in &self.services {
            if service.id.trim().is_empty() || !ids.insert(service.id.clone()) {
                anyhow::bail!("service ids must be non-empty and unique");
            }
            if catalog::find(&service.kind).is_none() {
                anyhow::bail!("unknown service kind: {}", service.kind);
            }
            let label = service.label.trim();
            if label.is_empty() || label.chars().count() > 40 {
                anyhow::bail!("service label must be between 1 and 40 characters");
            }
            if service.label.chars().any(char::is_control) {
                anyhow::bail!("service label contains control characters");
            }
            if !(0.75..=1.5).contains(&service.zoom) || service.zoom.is_nan() {
                anyhow::bail!("service zoom is out of range");
            }
        }
        if let Some(active) = &self.active_service_id {
            if !self.services.iter().any(|service| &service.id == active) {
                anyhow::bail!("active service is not configured");
            }
        }
        if self.security.auto_lock_minutes > 240 {
            anyhow::bail!("auto-lock timeout is out of range");
        }
        Ok(())
    }

    /// First-run friendly migration point for future schema revisions.
    pub fn migrate(&mut self) {
        if self.schema_version < SETTINGS_SCHEMA_VERSION {
            tracing::info!(from = self.schema_version, to = SETTINGS_SCHEMA_VERSION, "migrating settings");
            self.schema_version = SETTINGS_SCHEMA_VERSION;
        }
    }
}

/// Removes control characters and clamps a display label to 40 characters.
pub fn clean_label(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    cleaned.chars().take(40).collect()
}

/// Thread-safe settings owner. The in-memory copy is replaced only after a
/// successful atomic disk write.
pub struct SettingsStore {
    path: PathBuf,
    inner: RwLock<Settings>,
}

impl SettingsStore {
    /// Loads settings, recovering from corruption with a visible log warning.
    pub fn load(path: PathBuf) -> (Self, Option<String>) {
        let mut warning = None;
        let mut settings = match read_json::<Settings>(&path) {
            Ok(Some(value)) => value,
            Ok(None) => Settings::default(),
            Err(error) => {
                tracing::error!(error = %error, "settings file is unreadable; restoring defaults");
                warning = Some("settings-corrupt".to_string());
                if let Err(backup_error) = backup_corrupt(&path) {
                    tracing::error!(error = %backup_error, "failed to back up corrupt settings");
                }
                Settings::default()
            }
        };
        let before_repair = settings.clone();

        settings.migrate();
        settings.normalize();
        if let Err(error) = settings.validate() {
            tracing::warn!(error = %error, "settings validation failed; using safe defaults");
            warning = Some("settings-invalid".to_string());
            let _ = backup_corrupt(&path);
            settings = Settings::default();
        }

        if !path.exists() || warning.is_some() || settings != before_repair {
            if let Err(error) = write_json_atomic(&path, &settings) {
                tracing::error!(error = %error, "failed to persist initial settings");
            }
        }

        (
            Self {
                path,
                inner: RwLock::new(settings),
            },
            warning,
        )
    }

    /// Returns a cloned snapshot so callers never hold the lock across await points.
    pub fn snapshot(&self) -> Settings {
        self.inner.read().clone()
    }

    /// Absolute settings path, used by diagnostics.
    #[allow(dead_code)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Validates and atomically persists an update, returning the new snapshot.
    pub fn update<F>(&self, mutate: F) -> Result<Settings>
    where
        F: FnOnce(&mut Settings) -> Result<()>,
    {
        let mut guard = self.inner.write();
        let mut next = guard.clone();
        mutate(&mut next)?;
        next.normalize();
        next.validate().context("settings validation failed")?;
        write_json_atomic(&self.path, &next).context("failed to persist settings")?;
        *guard = next.clone();
        Ok(next)
    }

    /// Replaces settings wholesale after validation. Used by recovery/reset flows.
    pub fn replace(&self, mut next: Settings) -> Result<Settings> {
        next.normalize();
        next.validate().context("settings validation failed")?;
        write_json_atomic(&self.path, &next).context("failed to persist settings")?;
        *self.inner.write() = next.clone();
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instance(id: &str, kind: &str) -> ServiceInstance {
        ServiceInstance {
            id: id.into(),
            kind: kind.into(),
            label: "Personal".into(),
            muted: false,
            zoom: 1.0,
            created_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    /// Defaults must represent a valid, immediately persistable document.
    #[test]
    fn defaults_are_valid() {
        let mut settings = Settings::default();
        settings.normalize();
        assert!(settings.validate().is_ok());
        assert_eq!(settings.appearance.language, Language::Id);
        assert_eq!(settings.appearance.theme, Theme::System);
    }

    /// Unknown service kinds are rejected before a webview can be created.
    #[test]
    fn rejects_unknown_services() {
        let mut settings = Settings::default();
        settings.services.push(instance("a", "aol"));
        assert!(settings.validate().is_err());
    }

    /// Disabling the tray cannot strand a hidden window.
    #[test]
    fn normalizes_tray_invariant() {
        let mut settings = Settings::default();
        settings.general.show_tray_icon = false;
        settings.general.close_to_tray = true;
        settings.normalize();
        assert!(!settings.general.close_to_tray);
    }

    /// A dangling active selection is repaired on load/normalization.
    #[test]
    fn clears_dangling_active_service() {
        let mut settings = Settings::default();
        settings.active_service_id = Some("missing".into());
        settings.normalize();
        assert!(settings.active_service_id.is_none());
    }

    /// Settings updates are atomic and readable by a fresh store instance.
    #[test]
    fn persists_updates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let (store, warning) = SettingsStore::load(path.clone());
        assert!(warning.is_none());
        let updated = store
            .update(|settings| {
                settings.appearance.theme = Theme::Light;
                settings.services.push(instance("s1", "telegram"));
                settings.active_service_id = Some("s1".into());
                Ok(())
            })
            .expect("update");
        assert_eq!(updated.appearance.theme, Theme::Light);

        let (reloaded, warning) = SettingsStore::load(path);
        assert!(warning.is_none());
        assert_eq!(reloaded.snapshot(), updated);
    }

    /// Corrupt settings are backed up and replaced with safe defaults.
    #[test]
    fn recovers_corrupt_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "not-json").unwrap();
        let (store, warning) = SettingsStore::load(path.clone());
        assert_eq!(warning.as_deref(), Some("settings-corrupt"));
        assert_eq!(store.snapshot(), Settings::default());
        assert!(path.exists());
    }
}

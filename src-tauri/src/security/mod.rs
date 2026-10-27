pub mod pin;
pub mod secrets;
pub mod watcher;

use crate::settings::Settings;
use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;

use self::pin::{hash_secret, validate_pin, verify_secret};
use self::secrets::{SecretStore, StoredSecrets};

/// After five failed attempts the app enforces an exponential cooldown.
const MAX_ATTEMPTS: u32 = 5;
const BASE_COOLDOWN_SECONDS: i64 = 30;
const MAX_COOLDOWN_SECONDS: i64 = 900;

/// Lock errors are mapped to stable frontend codes by the command layer.
#[derive(Debug, thiserror::Error)]
pub enum SecurityError {
    #[error("app lock is already enabled")]
    AlreadyEnabled,
    #[error("app lock is not enabled")]
    NotEnabled,
    #[error("app lock is not fully configured")]
    NotConfigured,
    #[error("PIN does not meet the security policy: {0}")]
    PinPolicy(String),
    #[error("incorrect PIN")]
    IncorrectPin { attempts_remaining: u32 },
    #[error("too many attempts; try again shortly")]
    LockedOut {
        seconds_remaining: i64,
        lockout_until: String,
    },
    #[error("OS keychain is unavailable: {0}")]
    Keychain(String),
    #[error("security state could not be read or written: {0}")]
    Storage(String),
}

impl SecurityError {
    /// Stable machine code consumed by the renderer's localized error map.
    pub fn code(&self) -> &'static str {
        match self {
            Self::AlreadyEnabled => "lock_already_enabled",
            Self::NotEnabled => "lock_not_enabled",
            Self::NotConfigured => "lock_not_configured",
            Self::PinPolicy(_) => "pin_policy",
            Self::IncorrectPin { .. } => "incorrect_pin",
            Self::LockedOut { .. } => "locked_out",
            Self::Keychain(_) => "keychain_unavailable",
            Self::Storage(_) => "security_storage_error",
        }
    }

    /// Extra context the unlock UI needs for its countdown and attempt counter.
    pub fn details(&self) -> Option<serde_json::Value> {
        match self {
            Self::IncorrectPin {
                attempts_remaining,
            } => Some(serde_json::json!({ "attemptsRemaining": attempts_remaining })),
            Self::LockedOut {
                seconds_remaining,
                lockout_until,
            } => Some(serde_json::json!({
                "secondsRemaining": seconds_remaining,
                "lockoutUntil": lockout_until,
            })),
            _ => None,
        }
    }
}

/// Public security state used by bootstrap and settings screens.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    pub lock_enabled: bool,
    pub configured: bool,
    pub is_locked: bool,
    pub auto_lock_minutes: u32,
    pub protect_screen_capture: bool,
    pub attempts_remaining: u32,
    pub lockout_until: Option<String>,
    pub recovery_configured: bool,
}

/// Minimal lockout state persisted separately from the keychain.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PersistedSecurityState {
    failed_attempts: u32,
    lockout_until: Option<DateTime<Utc>>,
}

struct RuntimeState {
    configured: bool,
    locked: bool,
    recovery_configured: bool,
    failed_attempts: u32,
    lockout_until: Option<DateTime<Utc>>,
}

/// Owns all lock decisions. The renderer can request an unlock, but only Rust
/// verifies the PIN and decides whether the workspace may become visible.
pub struct SecurityService {
    secrets: Arc<dyn SecretStore>,
    state_path: PathBuf,
    runtime: Mutex<RuntimeState>,
}

impl SecurityService {
    /// Creates a lock service backed by the OS keychain.
    pub fn new(state_path: PathBuf) -> Self {
        Self::with_store(Arc::new(secrets::KeyringSecretStore::new()), state_path)
    }

    /// Constructor with an injected secret store for testing.
    pub fn with_store(secrets: Arc<dyn SecretStore>, state_path: PathBuf) -> Self {
        let persisted = load_persisted(&state_path);
        Self {
            secrets,
            state_path,
            runtime: Mutex::new(RuntimeState {
                configured: false,
                locked: false,
                recovery_configured: false,
                failed_attempts: persisted.failed_attempts,
                lockout_until: persisted.lockout_until,
            }),
        }
    }

    /// Reads secure storage and decides whether the app must start locked.
    pub fn initialize(&self, settings: &Settings) -> Result<SecurityStatus> {
        let parsed = self.read_secrets()?;
        let configured = parsed.is_some();
        let recovery_configured = parsed
            .as_ref()
            .map(|secrets| !secrets.recovery_phc.is_empty())
            .unwrap_or(false);

        {
            let mut runtime = self.runtime.lock();
            runtime.configured = configured;
            runtime.recovery_configured = recovery_configured;
            runtime.locked = settings.security.lock_enabled && configured;
            // Expired cooldowns are cleared on launch.
            if runtime
                .lockout_until
                .is_some_and(|until| until <= Utc::now())
            {
                runtime.lockout_until = None;
                runtime.failed_attempts = 0;
            }
        }

        if settings.security.lock_enabled && !configured {
            tracing::warn!("lock is enabled but keychain secrets are missing");
        }

        Ok(self.status(settings))
    }

    /// Snapshot for IPC; lockout countdowns are clipped to non-negative values.
    pub fn status(&self, settings: &Settings) -> SecurityStatus {
        let runtime = self.runtime.lock();
        let seconds_left = runtime
            .lockout_until
            .map(|until| (until - Utc::now()).num_seconds().max(0))
            .filter(|seconds| *seconds > 0);
        SecurityStatus {
            lock_enabled: settings.security.lock_enabled,
            configured: runtime.configured,
            is_locked: runtime.locked,
            auto_lock_minutes: settings.security.auto_lock_minutes,
            protect_screen_capture: settings.security.protect_screen_capture,
            attempts_remaining: MAX_ATTEMPTS.saturating_sub(runtime.failed_attempts),
            lockout_until: runtime
                .lockout_until
                .filter(|_| seconds_left.is_some())
                .map(|until| until.to_rfc3339()),
            recovery_configured: runtime.recovery_configured,
        }
    }

    /// True when the workspace must stay hidden.
    pub fn is_locked(&self) -> bool {
        self.runtime.lock().locked
    }

    /// Enables the lock, returning the one-time recovery code.
    ///
    /// The caller is responsible for persisting `lockEnabled = true` only after
    /// this method succeeds.
    pub fn enable(&self, pin: &str) -> Result<String, SecurityError> {
        validate_pin(pin).map_err(|error| SecurityError::PinPolicy(error.to_string()))?;
        let mut runtime = self.runtime.lock();
        if runtime.configured {
            return Err(SecurityError::AlreadyEnabled);
        }

        let recovery_code = pin::generate_recovery_code();
        let stored = StoredSecrets {
            version: 1,
            pin_phc: hash_secret(pin)
                .map_err(|error| SecurityError::Storage(error.to_string()))?,
            recovery_phc: hash_secret(&pin::normalize_recovery_code(&recovery_code))
                .map_err(|error| SecurityError::Storage(error.to_string()))?,
        };
        self.write_secrets(&stored)?;
        runtime.configured = true;
        runtime.recovery_configured = true;
        runtime.locked = false;
        runtime.failed_attempts = 0;
        runtime.lockout_until = None;
        self.persist(&runtime)?;
        tracing::info!("app lock enabled");
        Ok(recovery_code)
    }

    /// Disables the lock after verifying the current PIN.
    pub fn disable(&self, pin: &str) -> Result<(), SecurityError> {
        {
            let mut runtime = self.runtime.lock();
            if !runtime.configured {
                return Err(SecurityError::NotEnabled);
            }
            self.verify_pin_locked(&mut runtime, pin)?;
        }
        self.secrets
            .delete()
            .map_err(|error| SecurityError::Keychain(error.to_string()))?;
        let mut runtime = self.runtime.lock();
        runtime.configured = false;
        runtime.recovery_configured = false;
        runtime.locked = false;
        runtime.failed_attempts = 0;
        runtime.lockout_until = None;
        self.persist(&runtime)?;
        tracing::info!("app lock disabled");
        Ok(())
    }

    /// Changes the PIN after verifying the current one; recovery stays valid.
    pub fn change_pin(&self, current_pin: &str, new_pin: &str) -> Result<(), SecurityError> {
        validate_pin(new_pin).map_err(|error| SecurityError::PinPolicy(error.to_string()))?;
        let mut runtime = self.runtime.lock();
        if !runtime.configured {
            return Err(SecurityError::NotEnabled);
        }
        self.verify_pin_locked(&mut runtime, current_pin)?;
        let mut stored = self.read_secrets_required()?;
        stored.pin_phc =
            hash_secret(new_pin).map_err(|error| SecurityError::Storage(error.to_string()))?;
        self.write_secrets(&stored)?;
        runtime.failed_attempts = 0;
        runtime.lockout_until = None;
        self.persist(&runtime)?;
        tracing::info!("app PIN changed");
        Ok(())
    }

    /// Locks immediately. No-op when the lock has never been configured.
    pub fn lock(&self) -> bool {
        let mut runtime = self.runtime.lock();
        if !runtime.configured {
            return false;
        }
        runtime.locked = true;
        true
    }

    /// Verifies a PIN with persistent exponential backoff.
    pub fn unlock(&self, pin: &str) -> Result<(), SecurityError> {
        let mut runtime = self.runtime.lock();
        if !runtime.configured {
            return Err(SecurityError::NotConfigured);
        }
        self.verify_pin_locked(&mut runtime, pin)?;
        runtime.locked = false;
        runtime.failed_attempts = 0;
        runtime.lockout_until = None;
        self.persist(&runtime)?;
        tracing::info!("app unlocked");
        Ok(())
    }

    /// Replaces both PIN and recovery code using the one-time recovery code.
    /// Returns the newly generated recovery code so it can be stored by the user.
    pub fn reset_with_recovery(
        &self,
        recovery_code: &str,
        new_pin: &str,
    ) -> Result<String, SecurityError> {
        validate_pin(new_pin).map_err(|error| SecurityError::PinPolicy(error.to_string()))?;
        let mut runtime = self.runtime.lock();
        if !runtime.configured {
            return Err(SecurityError::NotConfigured);
        }
        self.check_lockout(&mut runtime)?;

        let stored = self.read_secrets_required()?;
        if !pin::verify_recovery_code(recovery_code, &stored.recovery_phc) {
            let error = self.record_failure(&mut runtime)?;
            return Err(error);
        }

        let new_recovery = pin::generate_recovery_code();
        let replacement = StoredSecrets {
            version: 1,
            pin_phc: hash_secret(new_pin)
                .map_err(|error| SecurityError::Storage(error.to_string()))?,
            recovery_phc: hash_secret(&pin::normalize_recovery_code(&new_recovery))
                .map_err(|error| SecurityError::Storage(error.to_string()))?,
        };
        self.write_secrets(&replacement)?;
        runtime.locked = false;
        runtime.recovery_configured = true;
        runtime.failed_attempts = 0;
        runtime.lockout_until = None;
        self.persist(&runtime)?;
        tracing::info!("app PIN reset with recovery code");
        Ok(new_recovery)
    }

    /// Regenerates a recovery code after PIN verification.
    pub fn regenerate_recovery(&self, pin: &str) -> Result<String, SecurityError> {
        let mut runtime = self.runtime.lock();
        if !runtime.configured {
            return Err(SecurityError::NotEnabled);
        }
        self.verify_pin_locked(&mut runtime, pin)?;
        let mut stored = self.read_secrets_required()?;
        let recovery = pin::generate_recovery_code();
        stored.recovery_phc = hash_secret(&pin::normalize_recovery_code(&recovery))
            .map_err(|error| SecurityError::Storage(error.to_string()))?;
        self.write_secrets(&stored)?;
        runtime.recovery_configured = true;
        runtime.failed_attempts = 0;
        runtime.lockout_until = None;
        self.persist(&runtime)?;
        tracing::info!("recovery code regenerated");
        Ok(recovery)
    }

    /// Verifies a PIN while enforcing lockout. Must be called with the runtime lock held.
    fn verify_pin_locked(
        &self,
        runtime: &mut RuntimeState,
        pin: &str,
    ) -> Result<(), SecurityError> {
        self.check_lockout(runtime)?;
        let stored = self.read_secrets_required()?;
        if !verify_secret(pin, &stored.pin_phc) {
            return Err(self.record_failure(runtime)?);
        }
        runtime.failed_attempts = 0;
        runtime.lockout_until = None;
        self.persist(runtime)?;
        Ok(())
    }

    /// Clears an expired cooldown and rejects verification during an active one.
    fn check_lockout(&self, runtime: &mut RuntimeState) -> Result<(), SecurityError> {
        if let Some(until) = runtime.lockout_until {
            let remaining = (until - Utc::now()).num_seconds();
            if remaining > 0 {
                return Err(SecurityError::LockedOut {
                    seconds_remaining: remaining,
                    lockout_until: until.to_rfc3339(),
                });
            }
            runtime.lockout_until = None;
            runtime.failed_attempts = 0;
            self.persist(runtime)?;
        }
        Ok(())
    }

    /// Increments the failure counter and starts a cooldown once the threshold
    /// is reached. The cooldown survives app restarts.
    fn record_failure(&self, runtime: &mut RuntimeState) -> Result<SecurityError, SecurityError> {
        runtime.failed_attempts = runtime.failed_attempts.saturating_add(1);
        let attempts_remaining = MAX_ATTEMPTS.saturating_sub(runtime.failed_attempts);
        if runtime.failed_attempts >= MAX_ATTEMPTS {
            let exponent = (runtime.failed_attempts - MAX_ATTEMPTS).min(5) as i64;
            let cooldown = (BASE_COOLDOWN_SECONDS * (1_i64 << exponent)).min(MAX_COOLDOWN_SECONDS);
            let until = Utc::now() + Duration::seconds(cooldown);
            runtime.lockout_until = Some(until);
            self.persist(runtime)?;
            tracing::warn!(
                attempts = runtime.failed_attempts,
                cooldown_seconds = cooldown,
                "lock verification temporarily blocked"
            );
            return Ok(SecurityError::LockedOut {
                seconds_remaining: cooldown,
                lockout_until: until.to_rfc3339(),
            });
        }
        self.persist(runtime)?;
        tracing::warn!(
            attempts_remaining,
            "incorrect app lock credential"
        );
        Ok(SecurityError::IncorrectPin { attempts_remaining })
    }

    /// Reads and validates the keychain bundle. A missing entry is not an error.
    fn read_secrets(&self) -> Result<Option<StoredSecrets>, SecurityError> {
        let raw = self
            .secrets
            .read()
            .map_err(|error| SecurityError::Keychain(error.to_string()))?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        let parsed: StoredSecrets = serde_json::from_str(&raw).map_err(|error| {
            tracing::error!(error = %error, "keychain lock payload is invalid");
            SecurityError::Storage("stored lock payload is invalid".into())
        })?;
        if parsed.version != 1 || parsed.pin_phc.is_empty() {
            return Err(SecurityError::Storage(
                "stored lock payload has an unsupported version".into(),
            ));
        }
        Ok(Some(parsed))
    }

    /// Reads secrets that must exist for an operation.
    fn read_secrets_required(&self) -> Result<StoredSecrets, SecurityError> {
        self.read_secrets()?
            .ok_or(SecurityError::NotConfigured)
    }

    /// Serializes the keychain bundle and refuses to continue if the OS store fails.
    fn write_secrets(&self, secrets: &StoredSecrets) -> Result<(), SecurityError> {
        let encoded = serde_json::to_string(secrets)
            .map_err(|error| SecurityError::Storage(error.to_string()))?;
        self.secrets
            .write(&encoded)
            .map_err(|error| SecurityError::Keychain(error.to_string()))
    }

    /// Persists only non-secret lockout state; PIN material never leaves the keychain.
    fn persist(&self, runtime: &RuntimeState) -> Result<(), SecurityError> {
        let persisted = PersistedSecurityState {
            failed_attempts: runtime.failed_attempts,
            lockout_until: runtime.lockout_until,
        };
        crate::infra::atomic_json::write_json_atomic(&self.state_path, &persisted)
            .context("failed to persist security state")
            .map_err(|error| {
                tracing::error!(error = %error, "failed to persist security state");
                SecurityError::Storage("could not persist security state".into())
            })
    }
}

/// Loads persisted lockout state. Corruption is safe: it resets the counters.
fn load_persisted(path: &PathBuf) -> PersistedSecurityState {
    match crate::infra::atomic_json::read_json::<PersistedSecurityState>(path) {
        Ok(Some(state)) => state,
        Ok(None) => PersistedSecurityState::default(),
        Err(error) => {
            tracing::error!(error = %error, "security state is corrupt; resetting counters");
            PersistedSecurityState::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct MemorySecretStore {
        value: StdMutex<Option<String>>,
    }

    impl SecretStore for MemorySecretStore {
        fn read(&self) -> Result<Option<String>> {
            Ok(self.value.lock().unwrap().clone())
        }
        fn write(&self, value: &str) -> Result<()> {
            *self.value.lock().unwrap() = Some(value.to_string());
            Ok(())
        }
        fn delete(&self) -> Result<()> {
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    fn service() -> (Arc<MemorySecretStore>, SecurityService, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemorySecretStore::default());
        let service = SecurityService::with_store(store.clone(), dir.path().join("security.json"));
        (store, service, dir)
    }

    /// Enabling stores hashes (not the PIN) and returns a usable recovery code.
    #[test]
    fn enable_and_unlock() {
        let (store, service, _dir) = service();
        let recovery = service.enable("1234").expect("enable");
        assert_eq!(recovery.len(), 19);
        let raw = store.read().unwrap().unwrap();
        assert!(raw.contains("$argon2id$"));
        assert!(!raw.contains("1234"));

        let settings = Settings {
            security: crate::settings::SecuritySettings {
                lock_enabled: true,
                ..Default::default()
            },
            ..Default::default()
        };
        service.initialize(&settings).unwrap();
        assert!(service.is_locked());
        service.unlock("1234").expect("unlock");
        assert!(!service.is_locked());
        assert!(service.unlock("0000").is_err());
    }

    /// Recovery rotates both credentials and returns a new recovery code.
    #[test]
    fn recovery_rotation_works() {
        let (_store, service, _dir) = service();
        let recovery = service.enable("1234").unwrap();
        service.lock();
        let new_recovery = service.reset_with_recovery(&recovery, "9876").unwrap();
        assert_ne!(recovery, new_recovery);
        service.unlock("9876").expect("new pin works");
        assert!(!service.is_locked());
    }

    /// Four mistakes leave one attempt; the fifth starts a cooldown.
    #[test]
    fn lockout_after_failed_attempts() {
        let (_store, service, _dir) = service();
        service.enable("1234").unwrap();
        for _ in 0..4 {
            let error = service.unlock("0000").unwrap_err();
            assert!(matches!(error, SecurityError::IncorrectPin { .. }));
        }
        let error = service.unlock("0000").unwrap_err();
        assert!(matches!(error, SecurityError::LockedOut { .. }));
    }

    /// Secrets never appear in persisted security state.
    #[test]
    fn state_file_has_no_pin_material() {
        let (_store, service, dir) = service();
        service.enable("1234").unwrap();
        let raw = std::fs::read_to_string(dir.path().join("security.json")).unwrap();
        assert!(!raw.contains("argon2"));
        assert!(!raw.contains("1234"));
    }
}

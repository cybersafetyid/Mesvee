use anyhow::{Context, Result};
use keyring::Entry;
use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "app.mesvee.desktop";
const KEYCHAIN_ACCOUNT: &str = "lock-v1";

/// Secrets bundle kept in the operating system credential store, never in JSON
/// settings and never in frontend memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSecrets {
    pub version: u32,
    pub pin_phc: String,
    pub recovery_phc: String,
}

/// Abstraction that lets security logic be tested without touching a real keychain.
pub trait SecretStore: Send + Sync {
    fn read(&self) -> Result<Option<String>>;
    fn write(&self, value: &str) -> Result<()>;
    fn delete(&self) -> Result<()>;
}

/// macOS Keychain, Windows Credential Manager and Linux Secret Service adapter.
pub struct KeyringSecretStore;

impl KeyringSecretStore {
    /// Creates the platform keychain adapter.
    pub fn new() -> Self {
        Self
    }

    /// Opens the single Mesvee lock entry.
    fn entry(&self) -> Result<Entry> {
        Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).context("failed to open OS keychain")
    }
}

impl SecretStore for KeyringSecretStore {
    fn read(&self) -> Result<Option<String>> {
        match self.entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(anyhow::anyhow!("keychain read failed: {error}")),
        }
    }

    fn write(&self, value: &str) -> Result<()> {
        self.entry()?
            .set_password(value)
            .context("keychain write failed")
    }

    fn delete(&self) -> Result<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(anyhow::anyhow!("keychain delete failed: {error}")),
        }
    }
}

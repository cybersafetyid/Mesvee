use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Reads JSON from disk. A missing file is a normal first-run state, not an error.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    let value = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(Some(value))
}

/// Writes JSON atomically by syncing a temporary sibling and renaming it over the
/// target. A crash can therefore leave either the old file or the new one, never
/// a truncated mixture of both.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let payload = serde_json::to_vec_pretty(value).context("failed to serialize JSON")?;
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_nanos())
        .unwrap_or_default();
    let temp_path = path.with_extension(format!("tmp-{}-{unique}", std::process::id()));

    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .with_context(|| format!("failed to create {}", temp_path.display()))?;
        file.write_all(&payload)
            .context("failed to write temporary settings file")?;
        file.sync_all().context("failed to sync temporary settings file")?;
    }

    // Rename is atomic on the same filesystem, which the sibling temp guarantees.
    fs::rename(&temp_path, path)
        .with_context(|| format!("failed to replace {}", path.display()))?;

    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }

    Ok(())
}

/// Moves a corrupt file aside so the next launch can recover with defaults while
/// preserving the user's data for inspection.
pub fn backup_corrupt(path: &Path) -> Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_secs())
        .unwrap_or_default();
    let backup = path.with_extension(format!("corrupt-{stamp}.json"));
    fs::rename(path, &backup)
        .with_context(|| format!("failed to back up corrupt file {}", path.display()))?;
    Ok(Some(backup))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct Sample {
        name: String,
        count: u32,
    }

    /// Verifies the full write/read cycle and that no temporary files leak.
    #[test]
    fn round_trip_is_atomic_and_clean() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("nested").join("settings.json");
        let value = Sample {
            name: "Mesvee".into(),
            count: 7,
        };

        write_json_atomic(&path, &value).expect("write");
        let loaded: Sample = read_json(&path).expect("read").expect("present");
        assert_eq!(loaded, value);

        let leftovers: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files must be cleaned up");
    }

    /// Missing files are treated as a normal first-run condition.
    #[test]
    fn missing_file_returns_none() {
        let dir = tempfile::tempdir().expect("tempdir");
        let loaded: Option<Sample> = read_json(&dir.path().join("absent.json")).expect("read");
        assert!(loaded.is_none());
    }

    /// Corrupt files are moved aside instead of blocking startup.
    #[test]
    fn corrupt_file_is_backed_up() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("settings.json");
        fs::write(&path, "{not json").unwrap();

        assert!(read_json::<Sample>(&path).is_err());
        let backup = backup_corrupt(&path).expect("backup").expect("path");
        assert!(backup.exists());
        assert!(!path.exists());
    }
}

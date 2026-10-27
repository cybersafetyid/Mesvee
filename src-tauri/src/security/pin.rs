use anyhow::Result;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};
use rand_core::{OsRng, RngCore};

/// PIN policy: digits only, 4–8 characters. This is intentionally short enough
/// for quick desktop unlock while Argon2id and lockout make guessing infeasible.
pub const PIN_MIN_LENGTH: usize = 4;
pub const PIN_MAX_LENGTH: usize = 8;

/// Human-readable but unambiguous alphabet (no 0/O, 1/I/L) for recovery codes.
const RECOVERY_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_GROUPS: usize = 4;
const RECOVERY_GROUP_LEN: usize = 4;

/// Validates PIN shape. Trimming is deliberately not applied: a PIN is exact.
pub fn validate_pin(pin: &str) -> Result<()> {
    let length = pin.chars().count();
    if !(PIN_MIN_LENGTH..=PIN_MAX_LENGTH).contains(&length) {
        anyhow::bail!("PIN must contain {PIN_MIN_LENGTH}-{PIN_MAX_LENGTH} digits");
    }
    if !pin.chars().all(|character| character.is_ascii_digit()) {
        anyhow::bail!("PIN must contain digits only");
    }
    Ok(())
}

/// Builds the Argon2id configuration used for both PINs and recovery codes.
/// 32 MiB / 3 passes keeps unlocks responsive (~100–250 ms) while resisting
/// offline cracking far better than a plain hash.
fn hasher() -> Result<Argon2<'static>> {
    let params = Params::new(32 * 1024, 3, 1, Some(32))
        .map_err(|error| anyhow::anyhow!("invalid Argon2 parameters: {error}"))?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

/// Hashes a secret into a self-describing PHC string including a random salt.
pub fn hash_secret(secret: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    hasher()?
        .hash_password(secret.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| anyhow::anyhow!("failed to hash secret: {error}"))
}

/// Constant-time verification of a secret against a stored PHC string.
pub fn verify_secret(secret: &str, phc: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(phc) else {
        return false;
    };
    hasher()
        .map(|argon| argon.verify_password(secret.as_bytes(), &parsed).is_ok())
        .unwrap_or(false)
}

/// Generates a 16-character, hyphen-grouped recovery code with ~78 bits of entropy.
pub fn generate_recovery_code() -> String {
    let mut random = [0u8; RECOVERY_GROUPS * RECOVERY_GROUP_LEN];
    let mut rng = OsRng;
    rng.fill_bytes(&mut random);
    let groups: Vec<String> = random
        .chunks(RECOVERY_GROUP_LEN)
        .map(|chunk| {
            chunk
                .iter()
                .map(|byte| RECOVERY_ALPHABET[*byte as usize % RECOVERY_ALPHABET.len()] as char)
                .collect()
        })
        .collect();
    groups.join("-")
}

/// Normalizes user-entered recovery codes for verification.
pub fn normalize_recovery_code(input: &str) -> String {
    input
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_uppercase())
        .collect()
}

/// Parses a stored recovery PHC and verifies a normalized user code.
pub fn verify_recovery_code(input: &str, phc: &str) -> bool {
    verify_secret(&normalize_recovery_code(input), phc)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Argon2 must round-trip only the correct secret.
    #[test]
    fn hash_and_verify_round_trip() {
        let phc = hash_secret("123456").expect("hash");
        assert!(phc.starts_with("$argon2id$"));
        assert!(verify_secret("123456", &phc));
        assert!(!verify_secret("123457", &phc));
    }

    /// PIN validation enforces digits and length.
    #[test]
    fn validates_pin_shape() {
        assert!(validate_pin("1234").is_ok());
        assert!(validate_pin("12345678").is_ok());
        assert!(validate_pin("123").is_err());
        assert!(validate_pin("123456789").is_err());
        assert!(validate_pin("12a4").is_err());
        assert!(validate_pin(" 1234 ").is_err());
    }

    /// Recovery codes are grouped, unambiguous and verifiable after normalization.
    #[test]
    fn recovery_codes_are_usable() {
        let code = generate_recovery_code();
        assert_eq!(code.len(), 19);
        assert_eq!(code.matches('-').count(), 3);
        let phc = hash_secret(&normalize_recovery_code(&code)).expect("hash");
        assert!(verify_recovery_code(&code.to_lowercase().replace('-', " "), &phc));
        assert!(!verify_recovery_code("AAAA-BBBB-CCCC-DDDD", &phc));
    }

    /// Each code should be unique in practice.
    #[test]
    fn recovery_codes_are_random() {
        assert_ne!(generate_recovery_code(), generate_recovery_code());
    }
}

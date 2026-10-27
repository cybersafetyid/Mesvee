use serde::Serialize;

/// Error returned across the Tauri IPC boundary.
/// Codes are stable, machine-readable identifiers; messages are safe for the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    /// Optional structured context for rate limits and lockout countdowns.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl CommandError {
    /// Creates a command error with a stable code and a user-facing message.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    /// Attaches structured, non-sensitive details to an error.
    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }

    /// Logs the underlying error (which may contain sensitive diagnostics) and
    /// returns a deliberately generic message to the renderer.
    pub fn internal(code: &str, context: &str, error: impl std::fmt::Display) -> Self {
        tracing::error!(error = %error, context = context, "command failed");
        Self::new(code, context)
    }

    /// Convenience constructor for validation failures.
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new("validation", message)
    }
}

/// Commands use this alias so the frontend always receives the same error shape.
pub type CommandResult<T> = Result<T, CommandError>;

use crate::error::{CommandError, CommandResult};
use tauri::Webview;

/// The single trusted shell webview label.
const SHELL_LABEL: &str = "main";

/// Rejects every command that did not originate from the trusted application
/// shell. Tauri can expose the IPC bridge to hosted remote webviews, so this
/// guard — not the capability file alone — is the security boundary for commands.
pub fn ensure_shell(webview: &Webview) -> CommandResult<()> {
    if webview.label() != SHELL_LABEL {
        tracing::warn!(
            caller = webview.label(),
            "blocked privileged command from an untrusted webview"
        );
        return Err(CommandError::new(
            "forbidden",
            "This action is only available from the Mesvee shell.",
        ));
    }
    Ok(())
}

use crate::settings::LogLevel;
use anyhow::{Context, Result};
use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

/// Creates a daily-rotated log file and a console layer. The returned guard must
/// be kept alive for the process lifetime so buffered events are flushed.
pub fn init(log_dir: &Path, level: LogLevel) -> Result<WorkerGuard> {
    std::fs::create_dir_all(log_dir)
        .with_context(|| format!("failed to create log directory {}", log_dir.display()))?;

    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("mesvee")
        .filename_suffix("log")
        .max_log_files(14)
        .build(log_dir)
        .context("failed to build rotating log appender")?;
    let (writer, guard) = tracing_appender::non_blocking(appender);

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(level.as_filter()));

    let file_layer = fmt::layer()
        .with_writer(writer)
        .with_ansi(false)
        .with_target(true)
        .with_thread_names(true)
        .with_file(true)
        .with_line_number(true);

    let console_layer = fmt::layer()
        .with_writer(std::io::stdout)
        .with_ansi(cfg!(debug_assertions))
        .with_target(true)
        .with_file(true)
        .with_line_number(true);

    tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(console_layer)
        .try_init()
        .context("failed to install tracing subscriber")?;

    Ok(guard)
}

/// Installs a panic hook before the default hook runs, so fatal renderer/main
/// failures leave a complete stack trace on disk for diagnostics.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|location| format!("{}:{}:{}", location.file(), location.line(), location.column()))
            .unwrap_or_else(|| "unknown".into());
        let message = if let Some(value) = info.payload().downcast_ref::<&str>() {
            (*value).to_string()
        } else if let Some(value) = info.payload().downcast_ref::<String>() {
            value.clone()
        } else {
            "non-string panic payload".into()
        };
        let backtrace = std::backtrace::Backtrace::force_capture();
        tracing::error!(
            location = %location,
            message = %message,
            backtrace = %backtrace,
            "fatal panic"
        );
        default_hook(info);
    }));
}

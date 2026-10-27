/// Builds the document-start script installed in every service webview.
///
/// System webviews (particularly WKWebView on macOS) do not expose the Web
/// Notification API. This bridge presents a standard Notification interface to
/// the service and forwards notifications to Rust, where they are validated,
/// rate-limited, muted and finally shown through the native notification centre.
///
/// The token is scoped to one service instance. The page can invoke the bridge
/// but cannot call trusted shell commands because every command validates the
/// calling webview label and token in Rust.
pub fn initialization_script(service_id: &str, token: &str, notifications_enabled: bool) -> String {
    let service_id = serde_json::to_string(service_id).unwrap_or_else(|_| "\"\"".into());
    let token = serde_json::to_string(token).unwrap_or_else(|_| "\"\"".into());
    let permission = if notifications_enabled {
        "granted"
    } else {
        "denied"
    };

    let template = r#"
(function () {
  'use strict';
  const SERVICE_ID = __SERVICE_ID__;
  const TOKEN = __TOKEN__;
  const bridge = window.__TAURI_INTERNALS__;
  if (!bridge || typeof bridge.invoke !== 'function') return;

  // Tauri is only used for this one scoped notification command.
  const invoke = bridge.invoke.bind(bridge);
  window.__MESVEE_NOTIFY_PERMISSION__ = '__PERMISSION__';

  function send(title, options) {
    try {
      if (window.__MESVEE_NOTIFY_PERMISSION__ === 'denied') return;
      const text = String(title == null ? '' : title).slice(0, 160);
      const body = String(options && options.body != null ? options.body : '').slice(0, 800);
      const tag = String(options && options.tag != null ? options.tag : '').slice(0, 80);
      // Fire-and-forget: a service must never observe or depend on app internals.
      Promise.resolve(invoke('service_notification', { token: TOKEN, title: text, body, tag }))
        .catch(function () {});
    } catch (_) {
      // Notifications are best-effort and must never break the hosted service.
    }
  }

  class MesveeNotification extends EventTarget {
    static get permission() {
      return window.__MESVEE_NOTIFY_PERMISSION__ || '__PERMISSION__';
    }

    static requestPermission(callback) {
      const result = Promise.resolve(MesveeNotification.permission);
      if (typeof callback === 'function') result.then(callback);
      return result;
    }

    constructor(title, options) {
      super();
      const settings = options || {};
      this.title = String(title == null ? '' : title);
      this.body = String(settings.body == null ? '' : settings.body);
      this.tag = String(settings.tag == null ? '' : settings.tag);
      this.icon = settings.icon || '';
      this.data = settings.data;
      this.silent = Boolean(settings.silent);
      this.timestamp = Date.now();
      send(this.title, settings);
      queueMicrotask(() => {
        try { this.dispatchEvent(new Event('show')); } catch (_) {}
      });
    }

    close() {
      try { this.dispatchEvent(new Event('close')); } catch (_) {}
    }
  }

  MesveeNotification.maxActions = 2;
  try {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: MesveeNotification,
    });
  } catch (_) {}

  // Web push commonly routes through a service worker. Patch the registration
  // method too so background/closed-page notifications follow the same policy.
  try {
    if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype) {
      ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
        send(title, options || {});
        return Promise.resolve();
      };
    }
  } catch (_) {}

  // Keep the bridge token opaque to casual inspection.
  Object.defineProperty(window, '__MESVEE_SERVICE__', {
    configurable: false,
    enumerable: false,
    value: SERVICE_ID,
  });
})();
"#;

    template
        .replace("__SERVICE_ID__", &service_id)
        .replace("__TOKEN__", &token)
        .replace("__PERMISSION__", permission)
}

/// Script used when the user enables/disables notifications or focus mode.
pub fn permission_script(enabled: bool) -> String {
    format!(
        "window.__MESVEE_NOTIFY_PERMISSION__ = '{}';",
        if enabled { "granted" } else { "denied" }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The injected script must not accidentally interpolate raw user input.
    #[test]
    fn escapes_service_values() {
        let script = initialization_script("../../../etc", "\"quoted\"", true);
        assert!(script.contains("\\\"quoted\\\""));
        assert!(!script.contains("__TOKEN__"));
        assert!(script.contains("granted"));
    }

    /// Disabled notifications must expose a denied permission immediately.
    #[test]
    fn permission_script_toggles() {
        assert!(permission_script(true).contains("granted"));
        assert!(permission_script(false).contains("denied"));
    }
}

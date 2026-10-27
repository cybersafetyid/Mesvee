use serde::Serialize;

/// User agent used by every hosted service webview.
///
/// WKWebView's stock UA is `AppleWebKit/605.1.15 … Safari/605.1.15` with no
/// `Version/…` token. Several web apps (WhatsApp, Instagram) treat that as an
/// outdated browser and serve an "update Safari" interstitial even though the
/// engine is the current system WebKit. Advertising the version Safari itself
/// would send describes the engine accurately and lets those apps boot.
/// Windows/Linux run WebView2/WebKitGTK, so they keep a current Chromium UA.
#[cfg(target_os = "macos")]
pub const SERVICE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
     AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";

/// Chromium-based UA for the WebView2/WebKitGTK hosts.
#[cfg(not(target_os = "macos"))]
pub const SERVICE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
     AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/// Grouping used by the add-service UI.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceCategory {
    Messaging,
    Social,
    Work,
}

/// A service Mesvee can host in an isolated native webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub kind: &'static str,
    pub name: &'static str,
    pub url: &'static str,
    pub category: ServiceCategory,
    /// Whether the web app is primarily a conversation product.
    pub supports_unread: bool,
}

/// The catalog is intentionally explicit: the frontend cannot submit arbitrary
/// URLs, and the Rust core remains the single source of truth for navigation.
pub const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        kind: "whatsapp",
        name: "WhatsApp",
        url: "https://web.whatsapp.com",
        category: ServiceCategory::Messaging,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "telegram",
        name: "Telegram",
        url: "https://web.telegram.org/a/",
        category: ServiceCategory::Messaging,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "messenger",
        name: "Messenger",
        url: "https://www.messenger.com",
        category: ServiceCategory::Messaging,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "instagram",
        name: "Instagram",
        url: "https://www.instagram.com/direct/inbox/",
        category: ServiceCategory::Social,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "x",
        name: "X",
        url: "https://x.com/messages",
        category: ServiceCategory::Social,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "discord",
        name: "Discord",
        url: "https://discord.com/app",
        category: ServiceCategory::Messaging,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "slack",
        name: "Slack",
        url: "https://app.slack.com/client",
        category: ServiceCategory::Work,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "linkedin",
        name: "LinkedIn",
        url: "https://www.linkedin.com/messaging/",
        category: ServiceCategory::Work,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "teams",
        name: "Microsoft Teams",
        url: "https://teams.microsoft.com/v2/",
        category: ServiceCategory::Work,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "element",
        name: "Element",
        url: "https://app.element.io",
        category: ServiceCategory::Messaging,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "googleChat",
        name: "Google Chat",
        url: "https://chat.google.com",
        category: ServiceCategory::Work,
        supports_unread: true,
    },
    CatalogEntry {
        kind: "facebook",
        name: "Facebook",
        url: "https://www.facebook.com",
        category: ServiceCategory::Social,
        supports_unread: false,
    },
    CatalogEntry {
        kind: "threads",
        name: "Threads",
        url: "https://www.threads.net",
        category: ServiceCategory::Social,
        supports_unread: false,
    },
    CatalogEntry {
        kind: "bluesky",
        name: "Bluesky",
        url: "https://bsky.app",
        category: ServiceCategory::Social,
        supports_unread: false,
    },
    CatalogEntry {
        kind: "tiktok",
        name: "TikTok",
        url: "https://www.tiktok.com/messages",
        category: ServiceCategory::Social,
        supports_unread: true,
    },
];

/// Finds a catalog entry by its stable kind slug.
pub fn find(kind: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|entry| entry.kind == kind)
}

/// Validates that a URL may be handed to the operating system or a popup.
/// Only web transport is accepted; every other scheme is rejected.
pub fn is_safe_web_url(url: &url::Url) -> bool {
    matches!(url.scheme(), "https" | "http")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

/// Navigation policy for hosted webviews.
///
/// Service pages are pinned to encrypted transport. A plaintext `http` hop could
/// be rewritten in transit and then read the freshly authenticated session, so
/// those URLs are refused inside the webview (they still open in the browser).
pub fn is_navigation_allowed(url: &url::Url) -> bool {
    url.scheme() == "https" && is_safe_web_url(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every catalog URL must parse and pass the navigation policy.
    #[test]
    fn catalog_urls_are_safe() {
        for entry in CATALOG {
            let url = url::Url::parse(entry.url).expect("valid catalog URL");
            assert!(is_safe_web_url(&url), "unsafe URL for {}", entry.kind);
        }
    }

    /// Unknown kinds must never create a webview.
    #[test]
    fn unknown_service_is_rejected() {
        assert!(find("unknown-service").is_none());
    }

    /// Hosted services may navigate over HTTPS only; plaintext is refused.
    #[test]
    fn navigation_requires_https() {
        let secure = url::Url::parse("https://web.whatsapp.com/").unwrap();
        let plaintext = url::Url::parse("http://web.whatsapp.com/").unwrap();
        let credentials = url::Url::parse("https://user:secret@web.whatsapp.com/").unwrap();
        assert!(is_navigation_allowed(&secure));
        assert!(!is_navigation_allowed(&plaintext));
        assert!(!is_navigation_allowed(&credentials));
    }

    /// Non-web schemes are rejected by the policy.
    #[test]
    fn non_web_schemes_are_rejected() {
        for candidate in ["javascript:alert(1)", "file:///etc/passwd", "tauri://localhost"] {
            let url = url::Url::parse(candidate).unwrap();
            assert!(!is_safe_web_url(&url), "{candidate} should be rejected");
        }
    }

    /// Duplicate kind slugs would make settings ambiguous.
    #[test]
    fn kinds_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for entry in CATALOG {
            assert!(seen.insert(entry.kind), "duplicate kind {}", entry.kind);
        }
    }
}

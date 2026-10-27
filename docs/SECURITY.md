# Mesvee Security Model

Mesvee renders **other people's web applications** inside a desktop shell while holding
messaging sessions, notification rights and a PIN that guards them. The design assumes the
hosted page is hostile, the renderer can be compromised by a web bug, and the update channel
could be tampered with. Each of those assumptions has an explicit counter-measure.

Defence in depth, from outermost to innermost:

| # | Layer | Owner |
| --- | --- | --- |
| 1 | Shell-only command guard | `commands/guard.rs` |
| 2 | Capability/CSP lockdown | `tauri.conf.json`, `capabilities/main.json` |
| 3 | Catalog + URL/navigation policy | `services/catalog.rs`, `services/views.rs` |
| 4 | Per-account session isolation | `services/views.rs` |
| 5 | Deny-by-default page permissions | `services/views.rs` |
| 6 | Authenticated notification bridge | `services/notifications.rs` |
| 7 | App lock (Argon2id + OS keychain + backoff) | `security/` |
| 8 | Signed, verified updates | `commands/updates.rs` + updater plugin |
| 9 | Crash/log hygiene and diagnostics redaction | `logging.rs`, `commands/diagnostics.rs` |

---

## 1. Shell-only command guard

Tauri injects the IPC bridge into webviews, including hosted remote pages. Two independent
defences apply:

* Every shell command is declared in `build.rs` via `AppManifest::commands`, which generates an
  `allow-*` permission. Only `capabilities/main.json` grants them, and it targets the `main`
  webview — so a hosted page's IPC call is rejected by the ACL before Rust code runs. The single
  exception is `service_notification`, which service pages *must* reach; it authenticates the
  caller by webview label plus per-session token (§6).
* The runtime guard is the second layer: every command calls `ensure_shell(&webview)` and
  rejects any caller whose label is not
  `main`, logging the offending label.
* Service webviews therefore cannot call `update_settings`, `sync_workspace`,
  `enable_lock`, `open_external`, `export_diagnostics`, … even if a page escapes its own
  JavaScript sandbox, because Rust checks the *native* caller identity, not a JS token.

## 2. Renderer lockdown

* CSP: `default-src 'self'`, `script-src 'self'` (production), `base-uri 'none'`,
  `form-action 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, and a connection list
  limited to the IPC origin. Dev relaxes scripts/connect to the local Vite origin only.
* `withGlobalTauri: false` — no global IPC object for injected script to discover.
* No remote code is ever loaded into the shell renderer; all assets are bundled and hashed.

## 3. Navigation and link policy

* The frontend cannot supply URLs for service pages: `add_service` accepts a **kind** that
  must exist in the Rust catalog (a fixed allowlist with audited `https` endpoints).
* In-webview navigation is **HTTPS-only** (`catalog::is_navigation_allowed`). A plaintext
  `http` hop is refused because an on-path attacker could rewrite the very page that just
  received the session cookies.
* `catalog::is_safe_web_url` requires `https`/`http`, a host, and **no embedded
  credentials**; it governs links handed to the operating system (popups and
  `open_external`), where the browser owns the transport decision.
* `javascript:`, `file:`, `tauri://` and similar schemes are rejected — covered by unit tests.
* New windows/popups are always denied and handed to the OS browser instead: a popup sharing
  the wrong session profile is a credential hazard.

## 4. Session isolation

* Each account gets its own data store: `data_store_identifier` (per-UUID `WKWebsiteDataStore`
  on macOS) or `data_directory` (Windows/Linux) under the per-user data folder.
* **macOS 11–13 limitation:** `WKWebsiteDataStore(forIdentifier:)` ships with macOS 14, while
  the bundle declares 11.0 as its minimum for local toolchain compatibility. On 11–13 WebKit
  cannot open a store per identifier, so two accounts of the same service may share cookies.
  Treat macOS 14+ as the isolation floor, or raise `bundle.macOS.minimumSystemVersion` to 14.0
  for release builds (`docs/AUDIT-SERVICE-WEBVIEW.md` records the trade-off).
* Cookies, local storage, IndexedDB and cache never cross accounts — you can sign into two
  accounts of the same service side by side.
* Removing an account closes the webview and, on request, deletes its directory after the
  view has shut down.
* Data stays on disk under the OS user profile, protected by filesystem permissions.

## 5. Deny-by-default page permissions

`on_permission_request` answers `Deny` for everything except:

* Microphone / Camera — only when the user enabled them in Settings → General.
* Notifications — only when notifications are enabled.
* Autoplay — allowed (voice messages).

Any other capability request from a hosted page is refused by the Rust side.

## 6. Authenticated notification bridge

* The initialization script gives a page a `postMessage`-style function, but Rust
  `authorize_notification` re-derives the account from the **native webview label**
  (`service-<uuid>`), compares the presented token with the per-session token, and rejects
  mismatched, muted, disabled, focus-paused or "app is focused" calls.
* Flood protection: per-account timestamps prevent a page from spamming native notifications.
* Counts are parsed from document titles on the Rust side and capped (`MAX_BADGE`), so a
  hostile page cannot overflow the UI with a huge title.

## 7. App lock

| Property | Value |
| --- | --- |
| PIN policy | 4–8 ASCII digits, validated in Rust |
| Hashing | **Argon2id**, 32 MiB memory, 3 passes, 1 lane, 32-byte tag, random salt (PHC string) |
| Secret storage | macOS Keychain, Windows Credential Manager, Linux Secret Service (`keyring`) |
| Wrong-PIN backoff | 5 attempts, then a cooldown starting at **30 s**, doubling per extra failure, capped at **15 min**; the cooldown **survives restarts** |
| Recovery | A one-time recovery code (also Argon2id-hashed) can reset the PIN; rotating the PIN rotates the code |
| Lock triggers | Manual, OS idle timeout (0 = off), window focus loss, app start |
| While locked | Every service webview is suspended (hidden), the shell overlay takes over, and `set_content_protected(true)` hides the window from screen recording/capture when the protection setting is on |

`security.lock_enabled` cannot be set through `update_settings`; only `enable_lock` /
`disable_lock` may flip it, and both round-trip through the keychain first (with rollback if
settings cannot be persisted).

The PIN itself is **never** stored or logged — only the Argon2id hash. Backend error messages
are generic (`"That PIN is not correct."`) and never leak keychain internals.

## 8. Signed updates

* `tauri-plugin-updater` verifies a **minisign signature** against the pinned public key in
  `tauri.conf.json` before any package is executed; a compromised mirror/CDN cannot run code.
* Download progress is throttled to the UI; failures leave the installed version untouched.
* Automatic checks run only in packaged builds and only with the user's opt-in.

## 9. Logging, crashes, diagnostics

* A Rust panic hook writes a report to the log directory before aborting; the renderer has a
  React `ErrorBoundary` that logs the component stack through `log_frontend`.
* Logs rotate with size caps and are written per-level from the configured log level.
* `export_diagnostics` produces a **redacted** bundle (log files + environment report) in a
  user-chosen folder — nothing is uploaded, and no telemetry exists in the app.

---

## Threat → mitigation quick reference

| Threat | Mitigation |
| --- | --- |
| Hostile page escapes JS sandbox | Caller-label command guard; no privileged IPC reachable |
| Page reads another account's cookies | Per-account native data store |
| `javascript:` / `file:` scheme abuse | URL policy + catalog allowlist + tests |
| Notification spam | Token auth, mute/focus gates, flood protection |
| Brute-forcing the PIN | Argon2id + exponential cooldown surviving restarts |
| Screenshots of a locked app | `set_content_protected(true)` while locked |
| Tampered update binary | Minisign verification before install |
| Secrets in support tickets | Redacted diagnostics export, generic backend errors |

---

## Responsible disclosure

Security issues in Mesvee should be reported privately to the maintainers before public
disclosure. Please include the version, platform and reproduction steps.

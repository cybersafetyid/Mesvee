# Mesvee Architecture

Mesvee separates **authoritative native state** from a **presentational renderer**. The Rust
core owns everything that must be true (settings, secrets, sessions, windows); React owns
everything that must be beautiful (layout, motion, copy). One typed bridge crosses between
them, and nothing else does.

---

## 1. Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  React renderer (src/)                                               │
│                                                                      │
│  features/  screens: home · service · settings · lock · palette      │
│  ui/        primitives: Button · Controls · Form · Modal · Toasts    │
│  core/      store (Zustand) → bridge (interface) → adapters          │
└───────────────┬──────────────────────────────────────────────────────┘
                │  invoke("…") / listen("mesvee:*")   — the only seam
┌───────────────▼──────────────────────────────────────────────────────┐
│  Rust core (src-tauri/src/)                                          │
│                                                                      │
│  commands/   IPC surface, every entry guarded by webview label       │
│  services/   catalog · isolated webviews · unread · notifications    │
│  security/   Argon2id PIN · OS keychain · idle watcher               │
│  settings.rs validated, atomically persisted preferences             │
│  state.rs    AppState managed by Tauri (shared, thread-safe)         │
│  logging.rs  rotating files + panic hook                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Rules of ownership

| State | Owner | Renderer's role |
| --- | --- | --- |
| Preferences, onboarding flag | Rust `SettingsStore` (atomic JSON) | issues patches, mirrors the result |
| PIN hash, lockout counters, recovery code | Rust `SecurityService` + OS keychain | never sees secrets; renders status |
| Service sessions/cookies | OS webview data stores on disk | never touches them |
| Unread counts, page titles, load state | Rust `ServiceViews` runtime | subscribes to `mesvee:service-state` |
| Route, dialogs, toasts, focus rows | Zustand store | sole owner |
| Theme/motion/density/language | Rust settings | projected onto `<html>` as data attributes |

---

## 2. The bridge seam

`src/core/bridge/types.ts` defines `MesveeBridge`, the complete IPC vocabulary.

* **`native.ts`** — thin `invoke`/`listen` wrappers. No logic, no state.
* **`mock.ts`** — a browser-only simulator (persisted to `localStorage`) used by `pnpm run
  dev:web`, Playwright and design review. It deliberately does *not* fake webviews or keychain
  calls: those remain native responsibilities.

Because components import `bridge` (selected once in `bridge/index.ts`), swapping adapters is
a one-line change and screens stay testable without a native runtime.

### Event channels

| Event | Meaning |
| --- | --- |
| `mesvee:settings-changed` | settings persisted (including lock flag changes) |
| `mesvee:service-state` | unread/title/loading/error/created for one account |
| `mesvee:locked` / `mesvee:unlocked` | lock transitions triggered by Rust (idle, focus, manual) |
| `mesvee:navigate` | Rust → shell routing (e.g. tray "Settings → Security") |
| `mesvee:download` | download finished/failed with a path |
| `mesvee:update-available/-progress/-installed` | updater lifecycle |
| `mesvee:service-removed` | account removed; drop its runtime state |

---

## 3. Startup lifecycle

```
main() → tauri::Builder
  ├─ single-instance, autostart, notification, opener, window-state, updater plugins
  ├─ setup():
  │    resolve config/data/log dirs → create
  │    SettingsStore::load (atomic; migration + validation)
  │    logging::init (rotating files) + install_panic_hook
  │    SecurityService::initialize (repair lock flag if keychain entry is gone)
  │    ServiceViews::new(sessions dir)
  │    apply_theme / sync_autostart / create_tray / apply_startup_lock
  │    spawn idle watcher + auto-update poller
  │    9 s fallback: if the renderer never reports ready → show the window anyway
  └─ renderer:
       bootstrap() → first paint → app_ready() → window.show()
```

`visible: false` at window creation plus `app_ready()` means the user never sees a blank or
half-styled window. `start_minimized` is honoured only after onboarding, so a first run can
never strand itself in the tray.

---

## 4. Service hosting model

Each configured account becomes one **child webview** of the main window:

* **Label** `service-<uuid>` — deterministic, and the basis of the shell-only command guard.
* **Isolation** — `data_store_identifier` (macOS `WKWebsiteDataStore`) or `data_directory`
  (Windows/Linux) per account: cookies and storage never cross accounts.
* **User agent** — each view advertises a current Safari UA on macOS (Chromium on Windows/Linux).
  WKWebView's stock string has no `Version/… Safari/…` token, which makes WhatsApp and
  Instagram serve an "update Safari" interstitial even though the engine is current.
* **Policy** — navigation restricted to `https`/`http` with a host, no embedded credentials;
  `window.open` is denied and forwarded to the OS browser (a popup sharing the wrong session
  is a login hazard); permission requests are denied unless enabled in Settings
  (microphone, camera, notifications, autoplay).
* **Bridge** — an initialization script exposes a *token-authenticated* notification function;
  Rust verifies the token belongs to that webview label before emitting a native notification.
* **Lifetime** — views are created lazily on first display, hidden (not destroyed) when you
  switch away, and closed (optionally with their data directory removed) on removal.

### Workspace bounds sync

The renderer measures the placeholder it wants covered and calls
`sync_workspace(activeId, visible, bounds)` with **logical window coordinates**:

* Rust refuses invalid bounds, suspends every view, re-focuses the shell when hiding.
* The placeholder covers the card edge to edge (inset by the card's 1px border only), so the
  page fills the surface and all padding lives on the card itself.
* The active view is positioned, sized, shown and focused.
* `visible` is forced to `false` while locked, so a lock can never leave a page on screen.
* The shell re-syncs on `ResizeObserver`, window resize, route change, and whenever an overlay
  (palette, dialog, menu) would otherwise be covered by the native page.

---

## 5. Settings pipeline

```
UI control → store.saveSettings(patch) → invoke update_settings
  → Settings::apply_patch → normalize() → validate()   (all in Rust)
  → atomic write (tmp file + fsync + rename)
  → side effects: theme, autostart, tray, notification permission, badge, event
  → renderer receives the authoritative snapshot and re-renders
```

Validation failures reject the command; the renderer keeps the previous state and shows an
error toast. Patches are **complete nested objects** so side effects stay deterministic, and
`security.lock_enabled` is deliberately *not* patchable — only the dedicated lock commands
may change it (with a keychain round-trip and rollback on failure).

---

## 6. Renderer composition

```
App
 ├─ boot state        → spinner / boot-error card with retry
 ├─ !onboarded        → Onboarding (full window, owns its own drag strip)
 ├─ Titlebar          → drag region, breadcrumb, palette trigger, focus/update, window controls
 ├─ Rail              → home, accounts + unread, add, theme, settings, lock
 ├─ main              → HomeScreen | ServiceScreen | SettingsScreen (keyed, fade transition)
 ├─ CommandPalette    → ⌘K, grouped, keyboard-first
 ├─ AddServiceDialog  → catalog picker
 ├─ ToastViewport     → polite live region
 └─ LockScreen        → full overlay whenever Rust says isLocked
```

Screens read state with narrow Zustand selectors; mutations always go through store actions
that call the bridge, so error handling and toast copy stay in one place.

The window is created frameless from `tauri.conf.json` (`decorations: false`). There is deliberately
no `tauri.macos.conf.json` override: a decorated macOS window paints its own traffic lights and
tao's traffic-light inset panics once those native buttons disappear, which is exactly the
"doubled buttons + hard crash" pair this layout used to hit.

Every workspace column is a floating glass card on one inset grid: 12px above and beside,
8px below. The rail, the service toolbar plus its webview surface, and both settings columns
therefore end on the same baseline instead of one panel bleeding to the window edge.

Unread counts only exist above zero. The rail dot, the home medallion and the dock/taskbar
badge each render nothing at 0 — `refresh_badge` passes `None`, never `Some(0)`, because both
macOS and Windows draw a literal "0" bubble for a zero count.

---

## 7. Performance notes

* No Chromium is bundled — the OS webview is shared by all accounts.
* Background throttling is disabled for service pages (keeps badges live when hidden).
* Panels are plain CSS; only keyframed transforms animate (compositor-friendly), and every
  animation collapses under `prefers-reduced-motion` or the explicit "reduce" setting.
* Fonts are self-hosted variable subsets loaded through the bundler — no third-party requests.
* Unread polling is title-driven (the web app itself updates the title), not a JS timer.

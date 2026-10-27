# Development guide

Everything you need to work on Mesvee day-to-day: conventions, the two extension
points you will actually touch (a service, an IPC command), the translation
workflow, and how to debug a running app.

Prerequisites: **Node ≥ 22.12**, **pnpm ≥ 10**, **Rust stable (1.94+)**, platform build tools
(Xcode CLT on macOS, MSVC on Windows, `webkit2gtk-4.1` + `libayatana-appindicator3`
on Linux). One `pnpm install` installs the JS side; Cargo resolves the Rust side
on first build.

**pnpm is the only package manager.** `pnpm-lock.yaml` is committed and
`package.json` pins the exact pnpm version in `packageManager`, so `corepack
enable` reproduces the same tree everywhere. There is no `package-lock.json`:
npm and yarn would resolve a different dependency graph and bypass the pins.

---

## 1. Commands at a glance

```bash
pnpm run dev          # native app: Vite HMR + Rust rebuild on change
pnpm run dev:web      # browser only, mock bridge (no native APIs)
pnpm run check        # typecheck + Vitest + cargo test — the gate before any commit
pnpm run build        # production bundle (icons, .app/.exe/deb, updater artifacts)
```

`pnpm run dev` uses `beforeDevCommand` → `devUrl http://127.0.0.1:1420`. If port
1420 is already in use, kill the stale Vite process first; `--strictPort` makes
the failure loud instead of silently drifting to another port.

---

## 2. Architecture in one paragraph

The React renderer **never imports `@tauri-apps/api` directly**. It talks to a
`MesveeBridge` interface ([src/core/bridge/types.ts](../src/core/bridge/types.ts))
with two implementations: `native.ts` (thin `invoke` wrappers, the only file that
knows Tauri exists) and `mock.ts` (pure in-memory fake for browser work and
tests). Rust owns all real state: settings, security, service webviews, the
updater. The Zustand store in [src/core/store.ts](../src/core/store.ts) is a
*projection* of Rust state — bootstrap once, then every mutating command returns
the fresh `Settings` and the store replaces its slice. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the full picture.

**Layer rules**

| Layer | May import from | Must not import |
| --- | --- | --- |
| `src/features/*` | `core`, `ui`, `lib` | `core/bridge/native` |
| `src/app/*` | `core`, `ui`, `lib`, `features` | — |
| `src/ui/*` | `lib` | `core`, `features` |
| `src/core/bridge/native` | `@tauri-apps/api` | `features`, `ui` |

Any component needing native behaviour receives it through the store or a hook,
so the shell stays renderable in a plain browser (`pnpm run dev:web`).

---

## 3. Code conventions

1. **Comment the why, not the what.** Every module opens with a doc comment
   saying what problem it owns; every exported function and every non-obvious
   block carries `/** … */` (TS) or `///`/`//` (Rust). Security-relevant code
   always explains the threat it mitigates.
2. **Strict TypeScript.** `pnpm run typecheck` is `tsc --noEmit` with `strict`,
   `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
   `verbatimModuleSyntax`. No `any`, no `@ts-ignore` — if a type is wrong, the
   contract is wrong.
3. **Errors are typed.** Rust returns `CommandResult<T>` whose failures carry a
   stable `code` + `message` (+ optional `details`); the frontend normalises any
   rejection through `toCommandError()` in
   [src/core/types.ts](../src/core/types.ts) before it reaches a toast or the
   log. Never surface a raw `String`.
4. **Comments in English**, user-facing copy in the locale files.
5. **Formatting.** Rust follows `cargo fmt`; TS is formatted by hand in the
   existing style (single quotes, semicolons, 2-space indent, named exports).

---

## 4. Adding a service

The catalog is a **Rust constant** on purpose: the renderer cannot make the app
navigate to an arbitrary URL.

1. **Catalog entry** — append a `CatalogEntry` in
   [src-tauri/src/services/catalog.rs](../src-tauri/src/services/catalog.rs):
   `kind` (stable, lowercase, never reuse), `name`, `url`, `category`
   (`Messaging` | `Social` | `Work`), `supports_unread`.
2. **Glyph** — add the kind → simple-icons name mapping in
   `scripts/generate-service-icons.mjs` and run `node scripts/generate-service-icons.mjs`
   to regenerate `src/ui/service-icons.generated.ts`. Kinds simple-icons no
   longer ships get a hand-drawn fallback in `src/ui/ServiceIcon.tsx`.
3. **Unread parsing** (only if the site's title format differs) — extend
   `src-tauri/src/services/unread.rs` and add a test next to it.
4. **Verify** — `pnpm run check`, then `pnpm run dev`, add the service, confirm it
   loads in its own webview and the badge counts up.

Accounts are **not** part of the catalog: `add_service` creates an isolated
webview with its own data directory, so adding WhatsApp twice gives two fully
separate logins.

---

## 5. Adding an IPC command

The IPC surface is deliberately small and fully guarded.

1. Write the function in the right module under `src-tauri/src/commands/`
   (`app`, `security`, `services`, `updates`, `diagnostics`) and make it return
   `CommandResult<T>`.
2. **Call `commands::guard::ensure_shell(&webview)?` first.** Tauri injects the
   invoke bridge into hosted service pages too — the guard is what stops a
   compromised web page from calling privileged commands.
3. Register it in the `invoke_handler!` list in `src-tauri/src/lib.rs`.
4. Declare the parameter types on the TS side in
   `src/core/bridge/types.ts`, implement it in `native.ts` **and** in
   `mock.ts` so the browser build keeps working.
5. Use it from the store/features only — never call `invoke` from a component.
6. Add a capability permission in `src-tauri/capabilities/main.json` only if the
   command needs a core plugin permission beyond `core:default`.

---

## 6. i18n workflow (id default, en)

* Strings live in two mirrored trees: `src/core/i18n/locales/id.ts` and `en.ts`.
  `id` is the default and the fallback language.
* Adding a string = adding the **same key with the same interpolation slots** to
  both files. `tests/unit/i18n.test.ts` fails the build if the trees diverge, so
  run `pnpm run test` after any copy change.
* Consume with `useTranslation()`; never hardcode user-visible text.
* Language switches at runtime through `setLanguage()` — no reload. The choice
  persists through `updateSettings({ language })` and is applied on boot before
  first paint.
* RTL is not shipped today; if it ever is, the CSS tokens in `src/index.css`
  already avoid logical-property mistakes.

---

## 7. Theming and motion

* Design tokens are CSS custom properties in `src/index.css`, split into a
  `dark` and a `light` root block (glass surfaces, hairlines, accent ramp).
  Components only ever consume the semantic tokens — no raw hex in features.
* The theme setting is `dark` | `light` | `system`. `src/lib/appearance.ts`
  resolves `system` against `prefers-color-scheme` and `prefers-reduced-motion`,
  and writes the resolved mode to `<html data-theme>` **before React mounts**
  (see `src/main.tsx`) so there is no flash of the wrong theme.
* Animations live in `src/index.css` (`--motion-*` durations/easings) plus the
  `motion` package for choreographed sequences. Every animation is wrapped in a
  `prefers-reduced-motion` guard.

---

## 8. Debugging

**Renderer first.** `pnpm run dev:web` gives you a normal browser console with the
mock bridge; React DevTools works as usual.

**Native.** Rust writes a daily-rotated plain-text log into Tauri's `app_log_dir`
for the identifier `app.mesvee.desktop` — on macOS that is
`~/Library/Logs/app.mesvee.desktop/`. The quickest way to the right folder on any
platform is *Settings → System → Open log folder* (`bridge.openFolder('logs')`),
as is *Open config folder* / *Open data folder*.

The file is `mesvee.<YYYY-MM-DD>.log` (prefix `mesvee`, suffix `log`, 14 days
kept). It contains everything: Rust `tracing` events at the level selected in
*Settings → Advanced → Log level*, renderer messages forwarded through
`bridge.log(level, message, context)` (target `frontend`, payload sanitised and
capped at 4 KB), file/line and thread names. `RUST_LOG=debug mesvee` overrides
the configured level for a session.

**Crash handling.** `logging::install_panic_hook()` runs before anything else:
a panic is logged as `fatal panic` with the exact location, message and a forced
backtrace into the same rotating file, then the default hook runs. A crash there
fore leaves evidence on disk.

When reporting a bug, attach the recent `.log` files, or use *Settings →
System → Export diagnostics* (`bridge.exportDiagnostics()`), which creates
`~/Downloads/Mesvee-Diagnostics-<timestamp>/` containing a redacted
`report.json` (version, paths, settings, service labels — **never** PINs,
recovery codes or keychain material), the five newest logs under 3 MiB each,
and a `README.txt`.

**Rust attach.** `lldb -- target/debug/mesvee` (macOS/Linux) or
`rust-lldb` from the VS Code C++/Rust extension. For a debug build with the
frontend attached, `pnpm run dev` is usually enough.

**Common failures**

| Symptom | Cause / fix |
| --- | --- |
| `address already in use` on 1420 | Stale Vite from a previous run — kill it, retry |
| `can't find crate for …_derive` during a release build | Stale artefacts from an interrupted build: `cargo clean -p <crate> --manifest-path src-tauri/Cargo.toml`, rebuild |
| `dlopen(…): mis-aligned LINKEDIT string pool` | Xcode 27.1's `ld` emits proc-macro dylibs dyld refuses to load when the deployment target is ≥ 12.0. Tauri exports that target from `bundle.macOS.minimumSystemVersion`, so keep it at `11.0` (or lower Xcode) until the linker is fixed. Debug builds are unaffected. |
| White window on first launch | Renderer crashed before `app_ready` — check `frontend.log` |
| Service webview blank | Navigation policy rejected the URL; check `mesvee.log` for the `navigation` entry |
| Invoke returns `forbidden` | The command is being called from a non-shell webview — you forgot `ensure_shell` |

---

## 9. Tests

```bash
pnpm run test        # Vitest: error normalisation, locale parity, theme projection
pnpm run test:rust   # cargo test: PIN policy, keychain, lockout, navigation,
                    #              catalog integrity, unread parsing, settings validation
pnpm run test:e2e    # Playwright: onboarding → home → palette → settings → lock → add service
```

Rules of engagement:

* A bug fix ships with a regression test at the layer that failed.
* Security logic (PIN, lockout, navigation, guard) is **always** covered by a Rust
  unit test before it changes.
* `pnpm run check` is the minimum gate; CI runs the same command plus the e2e
  suite on every push.

---

## 10. Project map

```
src/
├── main.tsx            entry: theme pre-paint, i18n, mount
├── App.tsx             boot, routing, appearance, global overlays (lock, toasts, palette)
├── index.css           design tokens: glass, motion, density
├── app/                shell — Titlebar, Rail, ErrorBoundary
├── core/               types, store, bridge (native/mock), i18n
├── features/           screens — home, service, services, settings, lock, palette, onboarding
├── ui/                 primitives — Button, Controls, Form, Modal, Toasts, Logo, ServiceIcon
└── lib/                appearance, clipboard, errors, platform, cn
src-tauri/src/
├── lib.rs              builder, plugins, setup, lifecycle
├── commands/           the entire IPC surface (guard, app, security, services, updates, diagnostics)
├── services/           catalog, webviews, unread, notifications
├── security/           Argon2id PIN, keychain, idle watcher
├── settings.rs         validated, atomically persisted settings
├── logging.rs          rotating logs + panic hook
└── state.rs, system.rs, error.rs, infra/
scripts/                icons, service glyphs, version bump
tests/                  Vitest units + Playwright e2e
docs/                   architecture, security, development, release
```
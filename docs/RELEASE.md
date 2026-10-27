# Release guide

How Mesvee goes from a commit to a signed, self-updating installable — and the
checklist that gates every release.

---

## 1. Versioning

One version, five manifests (plus `CHANGELOG.md`), changed atomically:

| File | Field |
| --- | --- |
| `package.json` | `version` |
| `package-lock.json` | `version` (×2) — only if the file exists (the repo uses pnpm) |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | the `mesvee` package entry |

```bash
pnpm run bump:patch        # 0.1.0 → 0.1.1  (bug fixes)
pnpm run bump:minor        # 0.1.0 → 0.2.0  (new features, backwards compatible)
pnpm run bump:major        # 0.1.0 → 1.0.0  (breaking changes)
node scripts/bump-version.mjs patch --dry-run   # preview version + changelog entry, write nothing
```

Besides the manifests, a bump **generates the changelog, commits, tags and
pushes**:

1. `CHANGELOG.md` gets a new entry built from the Conventional Commits since the
   previous `v*` tag (`feat` → Features, `fix` → Bug fixes, `feat!` / `!:` →
   Breaking changes, anything unconventional → Other changes). `chore(release)`
   and merge commits are skipped.
2. Commit `chore(release): vX.Y.Z`, annotated tag `vX.Y.Z`.
3. `git push origin HEAD vX.Y.Z` — the tag starts the release workflow (§4).

The working tree must be clean (otherwise changes would be missing from the
changelog). Flags: `--no-push` commits and tags locally only; `--no-git` edits
files only; `--dry-run` previews. Outside a git repo the git steps are skipped.

Write commits as `type(scope): description` so the changelog reads well.

The script validates the current value as semver before touching anything and
fails loudly if a manifest lacks a version field, so a half-bumped tree cannot
happen. **Semver discipline:** the updater only installs when the published
version is greater than the installed one, so a wrongly-bumped build is
unpublishable — bump, then never edit by hand.

---

## 2. Signing keys

The updater refuses unsigned artifacts, and Mesvee ships a pinned public key in
[`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) under
`plugins.updater.pubkey`.

```bash
# Once per machine (already done for this project):
pnpm run tauri signer generate -- -w ~/.tauri/mesvee.key
```

* `~/.tauri/mesvee.key` — **private key**. Never commit it, never share it,
  never paste it into a chat or an issue. Whoever holds it can sign updates that
  every installed copy will trust. Store a backup in a password manager.
* `~/.tauri/mesvee.key.pub` — public key. Must match `plugins.updater.pubkey`
  byte-for-byte (base64 body), or installed apps will reject the update.
* **Losing the private key means no more updates** for existing users; they must
  reinstall manually.

Builds that publish updater artifacts need the key in the environment — Tauri
does **not** read `.env` files for this:

```bash
# The variable holds the key *contents*, not a path: Tauri reads it verbatim.
# Passing a path here fails late, after the .app and .dmg are already bundled,
# with "A public key has been found, but no private key".
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/mesvee.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""   # leave empty if the key has none
pnpm run build
```

Without them the build still produces the installers but fails at the final
step with *“A public key has been found, but no private key.”*

---

## 3. Building

```bash
pnpm run check                     # typecheck + unit + Rust tests
pnpm run build                     # icons → vite → cargo --release → bundles
```

Artifacts land in `src-tauri/target/release/bundle/`:

| Platform | Installers | Updater artifact |
| --- | --- | --- |
| macOS (`.app`, `.dmg`) | `macos/Mesvee.app`, `dmg/Mesvee_<v>_aarch64.dmg` | `macos/Mesvee.app.tar.gz` + `.sig` |
| Windows (NSIS, MSI) | `nsis/Mesvee_<v>_x64-setup.exe`, `msi/Mesvee_<v>_x64_en-US.msi` | same files + `.sig` |
| Linux (deb, AppImage) | `deb/…`, `appimage/…` | `appimage/Mesvee_<v>_amd64.AppImage` + `.sig` |

Release profile: `lto = true`, `codegen-units = 1`, `opt-level = "s"`,
`panic = "abort"`, `strip = true` — a small, fast binary with no debug symbols.

> **macOS deployment target.** `bundle.macOS.minimumSystemVersion` must stay at
> `11.0`. Xcode 27's `ld` emits proc-macro dylibs dyld refuses to load when the
> target is ≥ 12.0, which breaks every release build with
> `mis-aligned LINKEDIT string pool`. See
> [DEVELOPMENT.md](DEVELOPMENT.md#8-debugging) before changing it.

Build on each target OS (or use CI): the produced bundle is native to the
machine that compiled it.

---

## 4. Publishing an update

The updater polls the endpoint configured in `tauri.conf.json`:

```
https://github.com/mesvee-app/mesvee/releases/latest/download/latest.json
```

Releases are automated by [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. `pnpm run bump:minor` (§1) pushes the commit and the `vX.Y.Z` tag.
2. The workflow verifies the tag equals `package.json` / `tauri.conf.json`, and
   creates a **draft** release whose notes are that version's `CHANGELOG.md`
   section.
3. It builds in parallel on macOS (Apple Silicon and Intel), Windows and Linux,
   signs the updater artifacts and uploads installers, `.sig` files and a merged
   `latest.json` (via `tauri-apps/tauri-action`). The release notes become the
   `notes` field the in-app update prompt shows.
4. Only when every platform succeeded is the draft published — the moment
   `releases/latest/download/latest.json` starts serving the new version.

**One-time setup** — repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/mesvee.key` (§2) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | key password, empty if none |

Installers are not code-signed/notarized (macOS Gatekeeper and Windows
SmartScreen will warn); add the Apple/Windows certificate secrets documented by
tauri-action when you have them. Pre-release versions (`1.0.0-beta.1`) publish as
GitHub pre-releases. A failed build leaves the draft in place — fix, delete the
draft and tag, and bump again.

Manual fallback — build locally (§3), upload the installers, `.sig` files and a
hand-written `latest.json` to a release.

`latest.json` schema, generated by the workflow (only `version` and the current platform's `url` +
`signature` are required):

```json
{
  "version": "0.2.0",
  "notes": "Fixes startup flash, adds Bluesky.",
  "pub_date": "2026-10-26T08:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of Mesvee.app.tar.gz.sig>",
      "url": "https://github.com/mesvee-app/mesvee/releases/download/v0.2.0/Mesvee_0.2.0_aarch64.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "<contents of Mesvee_0.2.0_x64-setup.exe.sig>",
      "url": "https://github.com/mesvee-app/mesvee/releases/download/v0.2.0/Mesvee_0.2.0_x64-setup.exe"
    },
    "linux-x86_64": {
      "signature": "<contents of Mesvee_0.2.0_amd64.AppImage.sig>",
      "url": "https://github.com/mesvee-app/mesvee/releases/download/v0.2.0/Mesvee_0.2.0_amd64.AppImage"
    }
  }
}
```

Rules that bite if ignored:

* Platform keys are `OS-ARCH` (`darwin-aarch64`, `windows-x86_64`,
  `linux-x86_64`). A key that does not match the running machine is skipped.
* `signature` is the **file content**, not a path or URL.
* `pub_date` must be RFC 3339 (`2026-10-26T08:00:00Z`); it is how the client
  decides a build is newer than the one it runs.
* Production endpoints are **HTTPS-only** (Tauri enforces TLS).

### What the app does with it

1. Settings → Pembaruan → *Periksa pembaruan* (or the palette's
   *Periksa pembaruan* action) calls `check_for_update`.
2. `spawn_auto_updates` also checks automatically at startup when
   *autoCheck* is on.
3. When a newer version is found the shell shows a toast, tracks download
   progress (`updateProgress`) and, on `install_update`, hands the verified
   artifact to Tauri — the signature is checked against the pinned pubkey
   **before** anything is installed, and the app restarts into the new version.
4. A reachable-but-broken endpoint is logged as
   `update endpoint did not respond with a successful status code` and the app
   carries on; updating is never on the critical path of startup.

---

## 5. Pre-release checklist

```bash
pnpm run check          # typecheck + Vitest + cargo test
pnpm run test:e2e       # Playwright: onboarding → palette → settings → lock → add service
pnpm run build          # with TAURI_SIGNING_PRIVATE_KEY exported
```

Then, by hand:

- [ ] Version bumped in **all five** manifests and the `CHANGELOG.md` entry generated.
- [ ] Fresh install from the built `.dmg` / `.exe` / `.AppImage` opens, onboards
      and shows no `WARN`/`ERROR` lines in the log folder.
- [ ] Upgrade path: install the *previous* release, publish this one, confirm
      the in-app prompt appears and installs it.
- [ ] Lock flow works after the upgrade (PIN set in the old version still
      unlocks).
- [ ] `latest.json` `version`, `pub_date` and `signature` match the artifacts
      actually uploaded.
- [ ] Public key in `tauri.conf.json` is unchanged (changing it bricks updates).
- [ ] No secrets in the bundle: `git grep -iE "api[_-]?key|secret"` over the
      build output, and the app runs offline with networking disabled.
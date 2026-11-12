# SchoolBridge Windows desktop installer — Task 1.11 / D2

## Current engineering status

The Tauri Windows bundle now targets an NSIS installer and declares the backend and CPython runtime as packaged resources. The Windows bundle is configured to embed the offline Microsoft WebView2 installer so first installation does not require internet access.

The CI preparation flow builds the existing native backend package, stages a self-contained CPython 3.12 runtime with its complete offline wheelhouse dependencies, places the backend and runtime in the Tauri resource tree, and builds the NSIS installer.

This is the D2 packaging implementation. It is not yet the final school acceptance sign-off: CI must pass, and a clean physical Windows 10/11 installation and upgrade/data-preservation test remain required.

## Installed file and data boundaries

- The desktop executable and immutable backend/Python resources are installed by Tauri under the selected Windows application installation directory.
- Tauri resolves the bundled resources through its resource directory; the application does not assume that the executable's parent directory is also the resource directory.
- Per-user configuration is stored at `%LOCALAPPDATA%\\SchoolBridge\\config\\.env`.
- The SQLite database is stored at `%LOCALAPPDATA%\\SchoolBridge\\data\\schoolbridge.sqlite3`.
- Backend diagnostics are stored at `%LOCALAPPDATA%\\SchoolBridge\\logs`.
- The generated application secret is created once by the bundled Python runtime and saved in the per-user configuration. It is not written into Program Files or the installer resources.
- Reinstalling or upgrading application files must not remove or overwrite the per-user configuration, database, or logs.

The backend receives `SCHOOLBRIDGE_CONFIG_FILE` explicitly, loads that configuration before importing the database module, and receives the per-user data directory. This keeps mutable configuration and school data outside the read-only application installation.

## First-run activation configuration

The initial desktop configuration is generated with a new application secret and an empty `SCHOOLBRIDGE_LICENSE_PUBLIC_KEY`. Before owner activation can be completed, the school's approved public verification key must be configured in `%LOCALAPPDATA%\\SchoolBridge\\config\\.env`. The private signing key must never be placed on the school computer or in the installer.

A guided, administrator-friendly first-run public-key configuration flow is still outstanding. Do not treat a healthy backend startup as proof that owner activation and school setup are complete.

## Build and CI

On the Windows CI runner, the workflow:

1. Downloads the official CPython 3.12 embeddable distribution and `get-pip.py`.
2. Builds the complete native backend package and Windows wheelhouse.
3. Stages the backend and fully provisioned Python runtime into `frontend/desktop-resources`.
4. Builds the NSIS installer with the offline WebView2 installer included.
5. Runs the desktop Rust lifecycle tests and verifies that the installer artifact is present and includes the offline WebView2 payload.

The generated `frontend/desktop-resources` directory is intentionally ignored by Git. It is build output, not source-controlled runtime content.

## Remaining acceptance gates

- Confirm the new GitHub Actions installer-bundle job passes.
- Install on a clean physical Windows 10 22H2 and Windows 11 23H2-or-newer machine with internet disconnected.
- Confirm first-run resource resolution, backend health, frontend loading, and SQLite creation.
- Configure the public verification key and complete owner activation and first-school setup.
- Create records, close/reopen the app, and confirm persistence.
- Upgrade over an existing installation and prove that the database, configuration, and logs are preserved.
- Test repair and uninstall; uninstall must not silently delete school data.
- Verify a backup and restore before school handover.
- Keep Windows 8/8.1 marked blocked and not certified under the current Tauri/WebView2 architecture.
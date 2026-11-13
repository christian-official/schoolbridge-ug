# Windows desktop runtime feasibility — Task 1.11 / D1

**Assessment date:** 2026-11-13  
**Status:** D1 REOPENED. The existing Tauri 2/WebView2 architecture is rejected for Windows 8.0/8.1, but the product requirement remains active. Windows 8.0 is the first acceptance target, followed by Windows 8.1. This is an engineering decision record, not a compatibility certification.

## Product requirement (unchanged)

SchoolBridge must be a directly installable, standalone desktop application that runs on Windows 8.0 first, then Windows 8.1 and newer Windows releases. The delivered USB package must include the application and required runtimes, install and run without internet access, and preserve authentication, data integrity, backups and school data. Docker, WSL2, and a separately installed browser are not acceptable substitutes for the desktop application.

## Existing implementation inspected

- The desktop shell is Tauri 2 (frontend/src-tauri/Cargo.toml).
- The Windows renderer is Microsoft Edge WebView2.
- The desktop process starts and supervises the local Python/FastAPI backend.
- The native backend package currently bundles CPython 3.12 and SQLite.
- The current NSIS pre-install hook allows 64-bit Windows 10 22H2 (build 19045+) and Windows 11 23H2+ (build 22631+); it rejects Windows 8, Windows 8.1, and other unlisted Windows versions.
- GitHub Actions uses a Windows Server 2022 runner to compile and validate the installer, but it does not execute the installer on that runner; the runner is not an accepted installation target.
- The Tauri bundle is active in frontend/src-tauri/tauri.conf.json and CI builds an NSIS installer with the offline WebView2 installer included. This current bundle remains unsuitable for Windows 8/8.1 because its WebView2 runtime is no longer maintained on those systems.

## Compatibility findings for the current stack

| Component | Windows 8.0 | Windows 8.1 | Assessment |
|---|---|---|---|
| CPython 3.12 | Not supported by its Windows support policy | Python 3.12 documentation lists 8.1 and newer | Cannot keep the current backend runtime unchanged for 8.0 |
| Microsoft WebView2 | No maintained runtime; version 109 was the final release for Windows 8/8.1 | No maintained runtime; version 109 was the final release for Windows 8/8.1 | Not an acceptable maintained renderer |
| Current Tauri 2 + WebView2 shell | Not an acceptable maintained target | Not an acceptable maintained target | Do not certify this stack on legacy Windows |
| Existing SchoolBridge native installer | Explicitly rejects | Explicitly rejects | Interim fail-closed guard only |

Sources:
- CPython 3.12 Windows support: https://docs.python.org/3.12/using/windows.html
- Microsoft WebView2 supported Windows versions: https://learn.microsoft.com/en-us/microsoft-edge/webview2
- WebView2 109 final release for Windows 8/8.1: https://github.com/MicrosoftEdge/WebView2Announcements/issues/53

## Candidate investigation: native wxWidgets shell

**Candidate status: INVESTIGATE / PROTOTYPE — NOT SELECTED OR CERTIFIED.**

The current wxWidgets project documentation lists Windows 8 among its supported Windows platforms, and the Windows installation documentation says Windows 7 or later (up to Windows 11). The project lists stable wxWidgets 3.2.12 released 2026-10-10. This makes wxWidgets 3.2.x a credible native-shell candidate that does not depend on an embedded browser engine.

Sources:
- Windows platform FAQ: https://wxwidgets.org/docs/faq/windows/
- Windows build/install target: https://github.com/wxWidgets/wxWidgets/blob/master/docs/msw/install.md
- Current releases and stable version: https://wxwidgets.org/downloads/
- Project platform and compiler list: https://github.com/wxWidgets/wxWidgets

Important limits:
- The platform statements establish a candidate worth testing, not proof that every API used by SchoolBridge or every compiler/runtime combination works on Windows 8.0.
- The wxWidgets release cadence is active, but the project does not promise a commercial support SLA. We must check security-relevant dependencies and keep the selected stable branch updated.
- A native shell alone does not solve the backend, TLS, cryptography, packaging, local API, database migration or offline lifecycle requirements.
- Do not introduce wxPython or another interpreter dependency without proving its exact Windows 8.0 support and maintenance status.

## Required architecture spike — Windows 8.0 first

The next engineering task is a small, isolated proof of concept. Do not replace the production desktop architecture until the spike passes.

1. **Native shell:** Build a minimal wxWidgets 3.2.x C++ application using a compiler/toolset whose generated binary is demonstrably compatible with Windows 8.0. Confirm it opens, handles DPI/display scaling and closes cleanly on a real Windows 8.0 x64 machine. Record exact compiler, SDK, CRT and dependency versions.
2. **Backend decision:** Compare (a) a native C++ service using maintained libraries, and (b) a separately compiled backend executable. CPython 3.12 is not valid for Windows 8.0. Any alternate language/runtime must have a documented maintained toolchain and tested Windows 8.0 support. Do not choose an EOL runtime simply to pass the OS check.
3. **Database:** Prove SQLite reads/writes, schema migration, backup and restore on Windows 8.0 using the exact library build shipped.
4. **Security:** Verify TLS protocol/cipher availability, certificate validation, cryptographic library support, password hashing, signed updates and package integrity on the target OS. No downgrade of authentication, encryption, hashing or signature checks is permitted.
5. **Offline package:** Bundle the shell, backend, database engine and all dependencies into a USB installer. Install and launch with network disconnected; no runtime download, Docker, WSL2 or external browser.
6. **Data lifecycle:** Verify per-school data isolation, upgrade preservation, repair and uninstall behaviour without deleting school data.
7. **Repeat on Windows 8.1:** Only after the Windows 8.0 spike passes; maintain separate results because 8.0 and 8.1 are distinct targets.

## Decision about the CURRENT STACK (not the product objective)

1. Do not ship or certify the current Tauri 2/WebView2 desktop shell on Windows 8 or 8.1. Pinning WebView2 109 would embed a browser engine that no longer receives security updates.
2. Do not use an end-of-life Python runtime on Windows 8.0 to make the current FastAPI backend appear compatible.
3. Do not weaken TLS, cryptography, password hashing, authentication, or package-integrity checks.
4. Keep the existing installer guard until a replacement architecture has passed the Windows 8.0 proof. The guard is temporary protection for the current package, not a product compatibility solution.
5. Preserve the current Tauri path as a separate implementation for its eligible Windows targets, without allowing that work to displace the Windows 8-first product objective.

## D1 exit criteria

D1 is **not complete**. It may close only when a selected architecture has evidence for all of the following on Windows 8.0: maintained native renderer/toolchain, supported backend/runtime, SQLite, TLS and cryptography, x64 packaging, fully offline install and launch, secure activation, data persistence and backup/restore. Windows 8.1 must then pass its own independent test matrix. CI on Windows Server or Windows 10/11 is not a substitute for real Windows 8.0/8.1 testing.

## Explicit non-goals

- No Base44 integration.
- No Docker or WSL2 desktop deliverable.
- No browser opened separately and presented as a desktop app.
- No obsolete WebView2 pinning.
- No weakening of security controls to force installation.
- No merge to main or production deployment as part of this feasibility work.

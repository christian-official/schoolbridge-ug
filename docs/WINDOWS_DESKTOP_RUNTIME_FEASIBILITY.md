# Windows 10/11 desktop runtime feasibility — D1

**Assessment date:** 2026-11-13  
**Status:** Windows 10/11 direction adopted; minimum-version acceptance remains open.

## Product decision

Retire Windows 8.0 and 8.1 as SchoolBridge desktop targets. Preserve the existing Tauri 2 + React + WebView2 shell and bundled CPython 3.12/FastAPI backend. Focus compatibility work on Windows 10 and Windows 11 rather than undertaking a native UI/backend rewrite for unsupported legacy operating systems.

The product remains a standalone desktop application delivered through an offline USB installer. It must not require Docker, WSL2, an external browser or internet access at install/run time. Authentication, owner activation, cryptography, package integrity, SQLite safety, backups and data preservation remain mandatory.

## Minimum documented platform candidate

| Component | Documented requirement | Consequence |
|---|---|---|
| Microsoft WebView2 | Windows 10 SAC 1709 and later; Windows 11 | Windows 10 1507, 1511 and 1607 are below the renderer floor |
| Current Rust MSVC target | Windows 10 or newer client installs | Windows 10 is the lowest supported OS family |
| Bundled CPython 3.12 backend | Supported on Windows 10 | No backend rewrite is required solely for the Windows 10 baseline |
| Tauri desktop package | Uses WebView2 on Windows | Complete package must be validated on the minimum Windows 10 build |

**Provisional technical floor:** Windows 10 version 1709, OS build 16299, x64; Windows 11 version 21H2, build 22000, x64. The installer gate enforces these floors, but neither is claimed to have passed clean-machine SchoolBridge acceptance.

Sources:
- https://learn.microsoft.com/en-us/microsoft-edge/webview2
- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-supported-operating-systems
- https://github.com/rust-lang/rust/blob/main/src/doc/rustc/src/platform-support/windows-msvc.md
- https://docs.python.org/3.12/using/windows.html

## Why Windows 10 1507 is not the minimum

Microsoft's current WebView2 documentation lists Windows 10 SAC 1709 and later. Windows 10 versions 1507, 1511 and 1607 are below that documented floor. Current Rust MSVC targets also require Windows 10 or newer. Supporting 1507–1607 would require a different renderer/toolchain strategy; it is not a simple installer setting. Do not pin an obsolete browser runtime to bypass upstream platform requirements.

## Installer and package requirements

The NSIS pre-install hook targets Windows 10 build 16299+ and Windows 11 build 22000+, x64 only. The installer embeds the offline WebView2 runtime installer. Verify that the bundled runtime installs and launches without a network connection on the minimum Windows 10 candidate.

The backend remains CPython 3.12 + FastAPI + SQLite. Preserve per-user configuration/data separation, child-process lifecycle ownership, secure owner activation and existing API contracts.

## Required validation

1. Build the Tauri/NSIS package in CI and verify the offline WebView2 payload.
2. Install on a clean Windows 10 1709 x64 VM without network; record missing OS updates or runtime prerequisites rather than bypassing them.
3. Verify frontend rendering, backend startup, authentication, activation, SQLite creation and persistence.
4. Exercise student, staff, attendance, examination, fees and reporting workflows.
5. Verify printing, file dialogs, uploads, display scaling, keyboard navigation and shutdown.
6. Test upgrade, repair, backup/restore and uninstall without deleting school data.
7. Repeat on a currently serviced Windows 10 edition and a currently supported Windows 11 release.

Windows Server CI is not evidence that the app runs on Windows 10 1709. Minimum-build VM testing is mandatory before a certified compatibility claim.

## Security and servicing boundary

Windows 10 version 1709 is out of normal OS support. Microsoft's Edge/WebView2 support on out-of-support Windows 10 releases is a temporary bridge, not a substitute for OS security servicing. Windows 10 Home/Pro 22H2 also reached end of support on 2025-10-14; some LTSC editions and ESU-enrolled systems have separate timelines. Prefer Windows 11 for new school deployments.

Do not weaken TLS, cryptography, password hashing, authentication, activation signatures or package-integrity checks. If a required security primitive cannot operate safely on a target, document the blocker rather than downgrading.

## Explicit non-goals

- Windows 8.0 or 8.1 compatibility.
- A wxWidgets native rewrite for Windows 8.
- Docker or WSL2 as a desktop runtime requirement.
- A separate-browser/localhost-server substitute.
- Obsolete WebView2/Edge pinning.
- Base44 integration.
- Merge to main or production deployment during compatibility work.

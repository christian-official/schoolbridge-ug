# SchoolBridge Windows desktop compatibility

**Decision date:** 2026-11-13  
**Status:** Windows 10/11 compatibility target adopted; minimum-version runtime acceptance remains required.

## Compatibility target

The current desktop package uses Tauri 2, Microsoft WebView2, React and a bundled CPython 3.12 backend. Based on upstream platform requirements, the broadest defensible baseline for this architecture is:

| Host | Minimum documented platform candidate | Architecture | Installer policy |
|---|---|---|---|
| Windows 10 | Version 1709, build 16299 or newer | x64 | Allow |
| Windows 11 | Version 21H2, build 22000 or newer | x64 | Allow |
| Windows 10 versions 1507, 1511, 1607 | Below documented WebView2 support floor | x64 | Reject |
| Windows 8 / 8.1 | Retired product targets | Any | Reject |
| 32-bit Windows | Not included in current packaged runtime | x86 | Reject |
| Other Windows / unknown OS | Not validated | Any | Reject |

This is a technical compatibility floor, not proof that every build above it has passed real-machine acceptance. Microsoft lists Windows 10 SAC 1709 and later for WebView2. Current Rust MSVC targets require Windows 10 or newer. Windows 10 versions 1507–1607 are below the documented renderer floor.

Official references:
- WebView2 supported Windows versions: https://learn.microsoft.com/en-us/microsoft-edge/webview2
- Edge supported operating systems: https://learn.microsoft.com/en-us/deployedge/microsoft-edge-supported-operating-systems
- Rust Windows MSVC target requirements: https://github.com/rust-lang/rust/blob/main/src/doc/rustc/src/platform-support/windows-msvc.md
- Windows 10 release/build reference: https://learn.microsoft.com/en-us/windows/release-health/release-information

## Installer enforcement

The NSIS pre-install hook requires 64-bit Windows, allows Windows 10 build 16299 or newer and Windows 11 build 22000 or newer, and rejects earlier/unknown operating systems before installation. It checks the declared version floor only; it does not prove a machine has required updates, certificates, drivers or runtime prerequisites.

## Operating-system security is separate

Windows 10 version 1709 is out of normal servicing. Windows 10 Home/Pro 22H2 also reached end of support on 2025-10-14. Some Enterprise/LTSC editions and ESU-enrolled devices have separate lifecycle dates; verify the exact edition and servicing channel.

Microsoft says Edge and WebView2 remain supported on Windows 10 SAC 1709 and later, but explicitly describes support on out-of-support Windows 10 releases as a temporary bridge to upgrading. Edge/WebView2 updates on Windows 10 22H2 continue until at least October 2028; that does not mean Windows 10 itself is receiving OS security updates.

For school deployments containing student/staff data, prefer a currently serviced Windows 11 release. Use Windows 10 only where the exact edition/device has a valid security-update path. Keep the OS patched, use encrypted tested backups, and disclose unsupported-host risks.

Lifecycle references:
- https://learn.microsoft.com/en-us/windows/release-health/release-information
- https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro
- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-supported-operating-systems

## Acceptance still required

Test the actual packaged app on clean x64 machines/VMs representing:
1. Windows 10 version 1709 (build 16299), minimum technical candidate;
2. a currently serviced Windows 10 edition;
3. a currently supported Windows 11 release.

For each, verify disconnected USB install, offline WebView2, launch, owner activation, authentication, backend health, SQLite persistence, printing, file dialogs, uploads, restart, upgrade, backup/restore, repair and uninstall/data preservation. Record exact edition, build, architecture and WebView2 version.

Modern-runner CI is build evidence only. Until minimum-build testing passes, call 1709 the documented minimum candidate, not certified compatibility.

## Product decision

Windows 8.0/8.1 are no longer product targets. The wxWidgets native Windows 8 prototype and its dedicated CI job are retired. Keep Tauri/React/Python and focus on Windows 10 1709+ and Windows 11.

No change authorizes weakening TLS, cryptography, password hashing, authentication, activation signatures, package integrity or offline installation. No Base44 integration, merge to main or production deployment.

# Interim Windows installer safety gate — NOT Windows 8 compatibility completion

## Scope and current status

This document records an interim safety gate for the existing Tauri/NSIS package only. It is **not completion of the SchoolBridge Windows compatibility objective**. The current installer check runs before installer files, registry values or shortcuts are written. It prevents installation on systems the current package cannot safely support; it does not satisfy the product requirement.

The current Tauri/WebView2 desktop package has this **technical compatibility floor**:

| Host | Minimum technical version | Architecture | Installer decision |
|---|---|---|---|
| Windows 10 | 22H2, build 19045 | x64 | Allow |
| Windows 11 | 23H2, build 22631 or newer | x64 | Allow |
| Windows 8 / 8.1 | Not supported by current Tauri 2/WebView2 stack | Any | Reject |
| Other Windows versions / unknown OS | Not validated | Any | Reject |
| 32-bit Windows | Not supported by bundled desktop build | x86 | Reject |

The NSIS pre-install hook reads the Windows product name and build from the Windows NT CurrentVersion registry key, checks the 64-bit host, and aborts with an explanatory message when the package is not eligible. The CI validation job checks that the hook is configured and that its supported-version gates remain present. The actual NSIS bundle build compiles the hook.

## Important distinction: app compatibility is not OS security support

The minimum versions above describe the installer/runtime compatibility contract only. They do not mean that Microsoft still provides security updates for every edition at those version floors.

As of 2026-11-13:
- Windows 10 22H2 reached general end of support on 2025-10-14. Extended Security Updates are a separate enrolment programme; do not assume a school PC is enrolled.
- Windows 11 23H2 reached end of updates on 2026-11-10.
- Prefer a currently serviced Windows 11 release and keep the host fully patched. Check the exact edition and servicing channel against Microsoft's current lifecycle information before school deployment.

Official lifecycle references:
- https://learn.microsoft.com/en-us/windows/release-health/release-information
- https://learn.microsoft.com/en-us/windows/release-health/supported-versions-windows-client
- https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information

## Primary product objective — Windows 8.0 first

The primary compatibility objective is a directly installable, standalone SchoolBridge desktop application for **Windows 8.0 first**, followed by Windows 8.1 and newer Windows releases. The current Tauri/WebView2 package does not meet this objective. Task 1.13 is therefore **not complete as a product compatibility task**; its OS rejection check is only a temporary fail-closed safeguard for this specific package.

The next engineering milestone is a renewed architecture feasibility investigation (D1), not final audit or release-readiness sign-off. Keep the current guard until a tested alternative package exists; do not silently allow unsupported installation, pin obsolete browser engines, or weaken security.

## Legacy Windows requirement remains open

Windows 8.0 and Windows 8.1 remain explicit product compatibility requirements, but the current Tauri 2/WebView2 renderer is not an acceptable maintained runtime for either OS. The legacy track must find a maintained alternative renderer and backend strategy; it must not pin obsolete WebView2/Edge, use an end-of-life Python runtime, or weaken authentication, TLS, cryptography or password hashing to force installation.

See [Legacy Windows deployment track](LEGACY_WINDOWS_SUPPORT.md) and [Windows desktop runtime feasibility](WINDOWS_DESKTOP_RUNTIME_FEASIBILITY.md). The current installer rejecting Windows 8/8.1 is an interim safety guard only. It is not compatibility, delivery, or completion of the primary product requirement.

## Evidence and remaining acceptance

Automated evidence:
- NSIS hook is wired into `tauri.conf.json`.
- CI validates the OS/architecture gate is present.
- The desktop CI build compiles the NSIS installer and packages the offline WebView2 runtime.
- Windows Server CI is a build/test environment only; it is not evidence of clean-machine Windows 10/11 acceptance.

Still required before production:
- Install and launch on clean physical Windows machines representing each supported, currently serviced edition.
- Repeat installation with internet disconnected.
- Verify first-run owner activation, local backend health, frontend rendering, SQLite creation and persistence after restart.
- Test display scaling, keyboard navigation, printing, file dialogs, uploads and normal school workflows.
- Test repair/uninstall behaviour and confirm school data is preserved.
- Record exact OS edition, version, build, architecture, WebView2 runtime version and test results.

Do not claim Windows 8/8.1 support or production certification from this CI gate.

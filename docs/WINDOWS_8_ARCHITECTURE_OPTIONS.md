# Windows 8.0-first architecture options — preliminary D1 research

**Research date:** 2026-11-13  
**Priority:** Windows 8.0 first, then Windows 8.1 and newer  
**Status:** D1 remains OPEN. No candidate is approved or certified.

This is a decision-support record, not proof that SchoolBridge currently runs on Windows 8. The product requirement is a directly installed desktop application that carries its own UI/runtime, local API and database, and works offline from a USB-installed package. A separate browser, Docker or WSL2 does not meet the requirement.

## Findings from current upstream platform documentation

| Option | Upstream platform evidence | D1 assessment |
|---|---|---|
| Current Tauri 2 + WebView2 | WebView2 109 was the final WebView2/Edge line for Windows 8/8.1; it is no longer maintained. | Reject for Windows 8/8.1. Do not bundle the frozen engine. |
| Qt 6.12 | Qt's current Windows configuration lists Windows 10 1809+ and Windows 11. | Reject as the Windows 8 UI foundation. |
| Qt 5.15 | Historical Qt 5 platform tables list Windows 8.1, not Windows 8.0. Qt 5 is not the current Qt major. | Does not meet Windows 8.0-first and maintained-runtime requirements. |
| Current Rust MSVC target | Rust's current target requirements say Windows 10+ for client installs. | Do not assume current Rust desktop/runtime binaries can target Windows 8. |
| Current Go releases | Go's current minimum-requirements page says Go 1.21+ requires Windows 10+. | Reject current Go as a Windows 8 runtime. Earlier Go releases are not an acceptable maintained security baseline. |
| Current .NET | Microsoft's current support matrix excludes Windows 8.1 from supported .NET 8/9/10; .NET 6 was the last supported release for Windows 8.1 and reached end of support in 2024. | Reject modern .NET as the Windows 8/8.1 backend or UI runtime. |
| wxWidgets 3.2.x native UI | wxWidgets' Windows FAQ explicitly lists Windows 8 as a platform on which it can be used. The project publishes an active 3.2 stable line (3.2.12 released 2026-10-10). | **Promising UI candidate only.** The FAQ does not by itself prove every current compiler/configuration is tested on Windows 8.0, nor does wxWidgets provide the SchoolBridge backend, TLS, cryptography or database lifecycle. Must build and test a minimal native proof on Windows 8.0. |

## What this means

The first credible direction to prototype is a **native C++ desktop shell**, with wxWidgets 3.2.x evaluated as the UI toolkit and the Windows API as the compatibility baseline. This avoids depending on a browser engine for rendering. It is a candidate, not yet a selected architecture.

A native shell alone does not make the existing React/FastAPI application compatible. The current frontend is browser-based and the current backend is Python/FastAPI. A native UI would require either:
- a deliberate UI rewrite/reimplementation of SchoolBridge workflows, retaining and testing the existing API contracts where practical; or
- a separately validated embedded renderer, which must not rely on obsolete Edge/WebView2 or Electron.

The backend is a separate blocker. Current maintained Go, Rust and modern .NET release lines no longer target Windows 8. The existing CPython 3.12 Windows support path does not cover Windows 8.0. Therefore, do not simply wrap the existing Python backend in a new native window and call the full product compatible. A viable backend/runtime strategy must be proven, including maintained TLS and cryptography, password hashing, SQLite, migrations, package integrity and offline dependency availability.

## Required prototype gates

### P0 — Windows 8.0 native UI proof
- Build a tiny wxWidgets 3.2.x application with a native window, menu, text input, table/list, file dialog and printing test.
- Build with a toolchain whose produced binary and runtime dependencies are documented for Windows 8.0.
- Run it on a clean Windows 8.0 x64 machine/VM with no internet and no preinstalled browser.
- Record compiler, SDK, wxWidgets version, architecture, required OS updates, DLLs and exact OS build.
- Repeat on Windows 8.1 separately. Do not infer one from the other.

### P1 — backend/runtime proof
- Audit every direct and transitive dependency currently used by SchoolBridge.
- Prototype a maintained native backend strategy on Windows 8.0; verify SQLite transactions, migrations, backup/restore, authentication, authorization, session expiry, audit logging, TLS and cryptographic operations.
- Reject any approach that depends on an end-of-life language runtime or cryptography/TLS library.
- Do not weaken existing authentication, password hashing, encryption, activation-signature verification or integrity checks to make a build run.

### P2 — representative application proof
- Display a representative student list and student profile in the native window.
- Read/write a disposable local SQLite database through the selected backend.
- Verify application startup, shutdown, crash recovery, offline launch and local data persistence.
- Confirm no external browser, Docker, WSL2 or runtime internet download is required.

### P3 — product architecture decision
Only after P0–P2 pass may the team select the architecture and estimate the staged migration of SchoolBridge screens and services. Preserve the current modern-Windows path until the new architecture can demonstrate parity; do not let a prototype silently replace or regress it.

## Security and support boundary

Windows 8.0 and 8.1 are out of Microsoft support. Even a technically compatible application cannot restore operating-system security updates. The product must disclose that limitation, use network isolation and protected backups as compensating controls, and must never claim security equivalence with a currently supported OS. This risk does not authorise shipping obsolete browser engines, runtimes or cryptographic libraries.

## Upstream references

- wxWidgets current stable releases: https://wxwidgets.org/downloads/
- wxWidgets Windows platform FAQ: https://wxwidgets.org/docs/faq/windows/
- Qt 6.12 Windows configurations: https://doc.qt.io/qt-6/windows.html
- Rust current Windows MSVC target requirements: https://github.com/rust-lang/rust/blob/main/src/doc/rustc/src/platform-support/windows-msvc.md
- Go current minimum requirements: https://go.dev/wiki/MinimumRequirements
- Microsoft current .NET Windows support matrix: https://learn.microsoft.com/en-us/dotnet/core/install/windows
- Microsoft WebView2 platform support: https://learn.microsoft.com/en-us/microsoft-edge/webview2
- CPython 3.12 Windows support: https://docs.python.org/3.12/using/windows.html

## Decision

**D1 stays open.** wxWidgets is the first native UI candidate to prototype, not a confirmed solution. The next engineering action is P0 on Windows 8.0, while in parallel mapping the backend dependencies and their support status. No Windows 8 installer compatibility claim is allowed until the real target-machine gates pass.

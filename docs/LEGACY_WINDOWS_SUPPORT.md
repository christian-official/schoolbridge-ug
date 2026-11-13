# Windows 8-first native desktop delivery track

**Status: IN DEVELOPMENT — NOT CERTIFIED.**  
**Priority: Windows 8.0 first, then Windows 8.1.**

This document supersedes earlier exploratory proposals for a local web server plus separate browser, an embedded legacy browser, or a Python-only compatibility package. Those are not the agreed product deliverable.

## Binding product requirement

SchoolBridge must be a directly installable, standalone desktop application for Windows 8.0 first, then Windows 8.1 and newer Windows releases.

The USB package must contain the application and all required runtimes, install and launch without internet access, and preserve authentication, school data, backups, updates and integrity checks. Docker, WSL2, a separately installed browser, or a localhost server opened in an external browser do not satisfy this requirement.

The live SQLite database belongs on the host computer's local disk, never on the USB drive or a shared network folder. Other school devices may connect through a deliberately secured LAN service; they must not access the SQLite file directly.

## Existing implementation and blockers

- The current desktop shell is Tauri 2 using Microsoft WebView2. WebView2 109 was the final release for Windows 8/8.1 and is no longer maintained there. This is not an acceptable renderer for the legacy deliverable.
- The current backend bundles CPython 3.12. Its documented Windows support does not include Windows 8.0. Python 3.12's Windows 8.1 capability does not make Windows 8.1 itself security-supported.
- The existing backend is FastAPI with modern dependency ranges, SQLAlchemy, Alembic, password hashing, JWT and cryptography dependencies. It cannot be declared compatible with an old interpreter without a complete dependency and security review.
- The Docker/WSL2 prototype is not the required deliverable.
- The current installer rejection is an interim fail-closed safety check for the Tauri/WebView2 package. It is not compatibility completion and must remain until a replacement package is actually proven.

## Native desktop shell candidate

An isolated proof of concept now exists under `desktop-legacy-native/`.

Candidate: wxWidgets 3.2.x with native controls and no embedded browser. Upstream documentation currently lists Windows 8 among its supported platforms and documents its Windows port for Windows 7 or later:
- https://github.com/wxWidgets/wxWidgets
- https://github.com/wxWidgets/wxWidgets/blob/master/docs/msw/install.md
- https://wxwidgets.org/news/2026/10/wxwidgets-3.2.12-and-3.3.4-released/

This is a candidate, not a selected production architecture. The initial source only creates a minimal native window. The CI job builds it on a modern Windows runner; that is compile evidence only, not Windows 8 runtime evidence.

The native shell means the existing React UI cannot simply be assumed to render inside it. A native UI migration or a separately proven maintained renderer is required. Do not use the old Internet Explorer WebBrowser control or pin an obsolete Chromium/WebView runtime.

## Backend strategy — unresolved

Windows 8.0 has no currently supported CPython 3.12 runtime. Do not ship an end-of-life Python runtime and describe it as secure or maintained.

Investigate a maintained native backend/service implementation and a portability boundary around the existing API and data model. Any candidate must preserve the existing security model and prove:
- TLS protocol and certificate validation behaviour on Windows 8.0;
- maintained cryptographic primitives and password hashing;
- signed owner activation and package/update integrity;
- SQLite transaction safety, migrations, integrity checks, backup and restore;
- role/tenant isolation, audit events and session expiry;
- a reproducible, fully offline dependency bundle.

If no safe maintained backend stack can meet Windows 8.0, report the exact blocker rather than weakening security. Windows 8.1 must be evaluated independently; do not assume the same runtime result.

## Required engineering sequence

1. **D1 — Native shell feasibility (Windows 8.0 first):** compile the wxWidgets prototype with an explicitly recorded toolchain, CRT and Windows API baseline. Test launch, display scaling, keyboard input, file dialogs and shutdown on a clean Windows 8.0 x64 machine. Repeat separately on Windows 8.1.
2. **D2 — Backend feasibility:** select and test a maintained runtime/service strategy. Prove SQLite, migrations, authentication, TLS, cryptography, activation and backup/restore on each OS. No EOL runtime or weakened security.
3. **D3 — SchoolBridge UI migration:** implement the actual school workflows in the selected native UI/renderer. Preserve accessibility, role-based navigation, printing, uploads and existing API/data contracts.
4. **D4 — Desktop lifecycle:** implement single-instance behaviour, startup/shutdown, child/service ownership, logs, health checks, crash recovery and safe configuration storage.
5. **D5 — Offline USB installer:** package the native UI, backend, SQLite, migrations and all dependencies. Verify hashes/signatures, disconnected installation, repair, upgrade, rollback and uninstall without deleting school data.
6. **D6 — Acceptance:** pass the complete workflow and security matrix independently on Windows 8.0 and Windows 8.1. Modern Windows CI is not a substitute for those machines.

## Acceptance matrix for each operating system

- Clean install from USB with internet disconnected.
- Application opens as a desktop app without external browser, Docker or WSL2.
- Owner activation and administrator/teacher authentication work.
- Student/staff records, attendance, examinations, fees, reports, printing and file uploads work.
- Role permissions, tenant isolation, audit logging, session expiry and password handling pass.
- SQLite migrations, integrity checks, backup, restore and rollback pass.
- Restart, reboot, crash recovery and data persistence pass.
- LAN access, if enabled, uses authenticated HTTPS and does not expose the database file.
- Upgrade preserves existing school data; repair and uninstall do not silently delete it.
- Exact OS edition/build, architecture, toolchain, runtime and dependency versions are recorded.

## Security and support warning

Windows 8.0 and Windows 8.1 are out of Microsoft support and do not receive normal OS security updates. A compatible application cannot restore missing operating-system security fixes. Any deployment must clearly disclose this risk and should be isolated to a trusted local network with controlled access and encrypted backups. Never describe these hosts as security-equivalent to currently supported Windows.

## Explicit non-goals

- No Base44 integration.
- No Docker or WSL2 requirement for the Windows 8 deliverable.
- No separate-browser or localhost-browser workaround.
- No obsolete WebView2, Edge, Electron or embedded browser pinning.
- No end-of-life Python/runtime presented as maintained.
- No weakening of TLS, cryptography, password hashing, authentication or package integrity.
- No merge to main or production deployment as part of feasibility work.

Until D1–D6 pass, both legacy operating systems remain **in development / not certified**.

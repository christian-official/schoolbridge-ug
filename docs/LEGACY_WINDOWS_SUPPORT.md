# Legacy Windows deployment track (Windows 8 and 8.1)

## Goal

Provide a separately packaged, USB-installable SchoolBridge host for schools whose computers cannot run the current Docker Desktop + WSL 2 deployment. The target operating systems are **Windows 8 and Windows 8.1**. This track must not change or weaken the existing Windows 10/11 installer.

This document records the engineering plan; it is not a compatibility certification. Do not advertise either legacy OS as supported until the clean-machine acceptance matrix below passes.

## Existing architecture findings

- The current school USB package is Linux-container based: PostgreSQL, a FastAPI backend, and an Nginx-served React frontend. It requires Docker Desktop and WSL 2.
- The backend already has a substantial SQLite path: SQLite connection safety settings, migrations, consistent backups, integrity checks, restore validation and rollback are implemented. The health endpoint identifies SQLite as single-host mode.
- SQLite is therefore the strongest starting point for a single-computer legacy deployment. A SQLite database must remain on the host's local disk; it must never be shared directly over a network drive. Other devices connect to the host application over the school's LAN.
- The frontend is built into static files, but today Nginx serves those files and proxies /api/ to the backend. A legacy package needs a supported local static-file/API serving arrangement without Docker or Nginx.
- The current backend dependency ranges are intentionally modern and unpinned. They cannot simply be installed on an old Python runtime and called compatible.

## Deployment design to validate

Build a distinct SchoolBridge-Legacy-Windows package with these boundaries:

1. **Local database:** SQLite on the host computer's local disk, with the existing migration, backup, restore and integrity safeguards retained.
2. **Application runtime:** a separately bundled, version-pinned Windows Python runtime and a frozen set of dependencies. Select the oldest runtime only after checking every direct and transitive dependency, wheel availability, TLS behaviour and security implications on both OS versions.
3. **Frontend delivery:** serve the production-built frontend and /api/ from one local origin. Preserve SPA deep links, service-worker behaviour, upload limits and the existing API paths. Do not rely on a modern browser being preinstalled; define and test a browser baseline.
4. **Background operation:** choose a Windows 8-compatible, maintainable way to start, stop, restart and recover the backend after reboot and unexpected process exit. Do not assume modern Windows service tooling works on Windows 8.
5. **Installer and updates:** provide an offline USB installer, package integrity verification, safe upgrade/rollback, and clear operator instructions. Never include production secrets or the owner's private signing key.
6. **Network access:** bind the service deliberately for single-computer and optional LAN use. Preserve authentication, role permissions, owner activation, audit trails and backup protections. Do not expose the database port or allow direct network access to the SQLite file.

## Compatibility gates

The target matrix is Windows 8 and Windows 8.1, tested separately on clean, fully patched virtual machines or physical PCs. CPU architecture (x86/x64) is a separate explicit gate: do not claim 32-bit support unless every runtime and dependency is available and tested for it.

Before selecting the runtime, record evidence for:
- supported Python/runtime versions on Windows 8 and 8.1;
- compatible builds/wheels for FastAPI, Pydantic, SQLAlchemy, Alembic, Uvicorn, password hashing and cryptography dependencies;
- a reproducible, offline dependency bundle with hashes and no runtime internet requirement;
- supported features of the eventual embedded desktop rendering engine, including service worker, IndexedDB, Web Crypto, file uploads and printing;
- code signing / installer behaviour and OS-level TLS limitations;
- security patch status and the operational risk of running unsupported Windows.

If a required security dependency has no safe compatible build, stop and report the blocker. Do not downgrade cryptography, password hashing, authentication, TLS, or integrity checks merely to force installation.

## Required acceptance tests for each OS

- Install from USB while disconnected from the internet.
- Verify all package hashes and reject a modified or incomplete package.
- Start automatically after reboot and recover from an application restart.
- Complete owner activation, first-time school setup, admin and teacher login.
- Exercise student/staff records, attendance, marks, fees, reports, printing and file uploads.
- Verify permissions, audit logging, session expiry and password handling.
- Verify SQLite migrations, concurrent staff use, backup, restore, integrity checks and rollback.
- Verify browser access on the host and a second device over a local LAN.
- Verify offline-supported workflows and confirm unsupported modules are not represented as fully offline.
- Upgrade an existing installation without losing data; test rollback after an interrupted/failed upgrade.
- Repeat critical checks after a clean reboot with internet disconnected.

A CI script-parse or package-build job is not a substitute for these real-machine tests.

## Security and support statement

Windows 8 and Windows 8.1 are out of Microsoft support. A legacy installer can improve deployment reach, but it cannot restore OS security updates. The installer must display this risk, require an authorised operator to acknowledge it, recommend an isolated local network and encrypted external backups, and never describe the host as security-equivalent to a currently supported Windows release.

## Delivery sequence

- **L0 — Runtime feasibility:** dependency/runtime/browser audit for both OS versions and architectures; select or reject a viable runtime.
- **L1 — Single-host application:** serve the built frontend and API from one local origin and run against local SQLite without containers.
- **L2 — Windows lifecycle:** reliable startup, shutdown, logs, health checks, backup scheduling and safe update/rollback.
- **L3 — USB installer:** offline bundle, integrity manifest, preflight checks and operator documentation.
- **L4 — Acceptance:** automated tests plus separate clean-machine Windows 8 and Windows 8.1 acceptance evidence.

Keep this track separate from the current Docker/WSL2 package. The existing Windows 10/11 path remains unchanged.

## Verified legacy platform facts (checked 2026-11-11)

These facts narrow the feasible deployment options and supersede any assumption that Windows 8 and 8.1 can share one supported Python host runtime:

- **Windows 8.0** left Microsoft support on 2016-01-13. **Windows 8.1** left Microsoft support on 2023-01-10. Neither receives Windows security updates.
- Current Python documentation states Python 3.12 supports Windows 8.1 and newer; Python 3.11 also supports Windows 8.1 and newer. This does not include Windows 8.0.
- Python 3.8 is end-of-life (2024-10-07) and receives no security updates. Therefore, the existing Python/FastAPI backend has no currently supported CPython runtime documented for a native Windows 8.0 host. Do not ship an EOL Python runtime to bridge that gap.
- Windows 8.1 can technically run a currently security-maintained CPython 3.12 runtime, but that does not make the Windows 8.1 operating system secure or supported. A native host prototype still requires an explicit risk decision and real-machine validation.
- Microsoft Edge 109 was the final Edge release for Windows 8/8.1 and is no longer maintained. No external browser is accepted as the SchoolBridge desktop shell. The eventual desktop package must provide its own supported rendering/runtime layer (or a fully native UI) and prove compatibility on each target OS; an ordinary browser smoke test is not desktop acceptance.

## D1 runtime feasibility decision

See [Windows desktop runtime feasibility](WINDOWS_DESKTOP_RUNTIME_FEASIBILITY.md). The current Tauri 2/WebView2 stack is a no-go for Windows 8.0 and 8.1 because the available WebView2 runtime for those systems is frozen at version 109 and no longer receives security updates. Windows 8.0 also has no supported CPython 3.12 runtime. Keep both legacy OS targets blocked / not certified; do not bypass OS checks or ship obsolete browser/runtime components. Continue supported-Windows desktop packaging separately without treating it as completion of the legacy requirement.

## Confirmed product requirement: native installation on both legacy systems

The product owner has explicitly confirmed that **Windows 8.0 and Windows 8.1 must each receive a directly installable SchoolBridge package**. Browser-only access through another computer is not an acceptable completion of this requirement.

This is a delivery requirement, not a claim that the current stack already supports either OS. The engineering track must continue until each OS has a tested local installation, local database, application startup/recovery, offline operation, upgrade and restore path.

### Native-install architecture work

- Keep the Windows 10/11 Docker-free installer as a separate target; do not regress it.
- Build a single-computer package that starts SchoolBridge locally and stores its SQLite database on that computer's local disk.
- For Windows 8.1, validate a pinned maintained Python 3.12 runtime against every direct and transitive dependency, then package the application and frontend without requiring preinstalled Python or Node.js.
- For Windows 8.0, do not label an EOL CPython runtime as secure or supported. Evaluate a maintained alternative runtime or a deliberately isolated compatibility backend. If that requires a backend portability layer, implement it as a separate workstream rather than silently dropping Windows 8.0.
- The installer must detect OS version and architecture before making changes, refuse unsupported package combinations, and explain legacy-OS security risk.
- A Windows 8/8.1 deliverable is not complete merely because its installer opens. Each system must pass the full acceptance matrix on a clean machine, including disconnected installation and operation.

### Delivery gates

1. **Runtime proof:** produce a reproducible runtime/dependency matrix for Windows 8.0 and 8.1, including cryptography, TLS, password hashing, database drivers and offline wheels. No EOL runtime may be presented as security-maintained.
2. **Local app proof:** run the API, built frontend and SQLite database on the target computer with no Docker, WSL2, external server or internet dependency.
3. **Lifecycle proof:** demonstrate startup after reboot, process recovery, logs, backup scheduling, safe upgrade and rollback.
4. **Installer proof:** generate OS-aware offline installers with checksums and preflight checks.
5. **Machine acceptance:** pass the full clean-machine test suite independently on Windows 8.0 and Windows 8.1 before advertising either as supported.

Until those gates pass, report each OS as **in development / not yet certified**, not as supported. Do not replace this native-install requirement with browser-only access.


## Binding product delivery requirements

The following requirements take precedence over earlier exploratory rollout suggestions in this document:

- Windows 8.0 is the starting compatibility target. Windows 8.1 and newer Windows versions must follow; Windows 10/11 must not become the minimum product requirement.
- The deliverable is an installed desktop application. A local web server that asks staff to open a separate browser is not completion. An embedded rendering component is acceptable only if it is part of the installed desktop application and passes the OS-specific compatibility and security gates.
- The full installer travels on USB. The USB must contain the application, desktop runtime, backend/runtime dependencies, database setup, migrations, configuration templates, install/uninstall/repair/upgrade tools, integrity manifest and operator documentation. Installation and ordinary operation must not download anything.
- Offline means usable, not merely cached. The app must launch, authenticate, access the school's local database and perform supported workflows with internet disconnected. The USB is for installation and recovery; the live database belongs on the computer's local disk, not on the removable drive.
- No Docker Desktop or WSL2 prerequisite for the Windows 8 starting target.
- No weakening security to force compatibility. Do not silently pin an obsolete browser/runtime, downgrade cryptography or password hashing, or claim an unsupported OS is secure.
- Preserve newer Windows support. A compatibility implementation for Windows 8 must not regress Windows 10/11 and newer targets.

## Current engineering blockers — explicitly not complete

1. The existing prepare-usb.ps1 packages Docker Desktop + WSL2 images and installers. Its host preparation script rejects Windows 8/8.1.
2. The current Docker-free package bundles CPython 3.12, FastAPI and SQLite, but the launcher starts Uvicorn and instructs the operator to open a localhost URL in a separate browser. It is not a desktop application.
3. Python's currently maintained Windows runtime path does not cover Windows 8.0. Python 3.12 supports Windows 8.1, but the OS itself is out of support. A complete dependency and security review is still required.
4. Electron 22 was the last Electron major to support Windows 8/8.1, and its support ended in 2023. Pinning it is not an acceptable long-term secure desktop-shell solution.
5. No clean-machine Windows 8 or Windows 8.1 acceptance evidence exists. Hosted Windows Server CI does not prove either target.

## Required next engineering sequence

- D1 — Runtime and desktop-shell feasibility: evaluate a maintained, genuinely Windows 8-compatible desktop UI/runtime and backend strategy. Record exact versions, security-support status, architecture (x86/x64), required OS APIs and dependency compatibility. Reject options that depend on obsolete browser engines or unsupported runtimes.
- D2 — Desktop application foundation: create the actual desktop window, secure local API/database lifecycle, startup/shutdown, logs, crash recovery and single-instance behaviour. Do not launch an external browser.
- D3 — Offline USB build: produce a reproducible USB package containing all required verified components and no online installation dependency. Include install, repair, upgrade, rollback and uninstall paths.
- D4 — Offline operations: verify first-run setup, authentication, school workflows, persistence, restart, backup and restore with internet disconnected. Keep permission-scoped sync and conflict controls.
- D5 — OS acceptance: test Windows 8.0, Windows 8.1 and newer Windows versions independently on clean machines. Do not mark an OS supported from static analysis or modern hosted CI alone.

Until D1–D5 pass, the Windows 8 desktop USB product is in development, not certified. Do not substitute browser access, a Docker/WSL2 package or a Windows 10-only installer and call the requirement complete.

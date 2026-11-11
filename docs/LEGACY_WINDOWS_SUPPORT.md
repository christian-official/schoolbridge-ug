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
- supported frontend browser features, including service worker, IndexedDB, Web Crypto, file uploads and printing;
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
- Microsoft Edge 109 was the final Edge release for Windows 8/8.1 and is no longer maintained. Mozilla currently states Firefox ESR 115 is the final Firefox line for these systems and will receive security updates through March 2027, subject to re-evaluation. Browser security updates do not replace missing OS security updates, and the SchoolBridge frontend feature baseline still needs testing on that browser.

## Feasibility decision and practical rollout

1. **Primary no-WSL host:** prioritise a Docker-free native Windows 10/11 package using a supported Python runtime and local SQLite. This directly removes the WSL2 requirement without introducing an unsupported operating system or EOL runtime.
2. **Windows 8.1 host:** keep as a separately gated experimental compatibility target. Python 3.12 is a technically supported runtime for Windows 8.1, but the OS is EOL. Do not advertise production support until security review, dependency audit, and clean-machine acceptance are complete.
3. **Windows 8.0 host:** blocked for the current Python backend because the documented compatible Python path requires an EOL runtime. Do not claim native host support unless the backend is deliberately ported to a runtime with maintained Windows 8.0 support and that entire stack is audited and tested. A runtime downgrade is not an acceptable shortcut.
4. **Older Windows PCs as clients:** investigate LAN browser access from Firefox ESR 115 while Mozilla security updates remain available. Treat this as a temporary compatibility path, not an OS security guarantee. Validate login, role permissions, service worker/offline behaviour, IndexedDB, Web Crypto, uploads and printing on the actual browser build.
5. **Schools with no supported host PC:** offer a supported, low-cost dedicated host device on the school LAN, with existing older PCs connecting as clients where browser tests pass. The database remains on the host's local disk and is never shared as a network file.

The acceptance matrix must report host OS and client OS/browser independently. A passing Windows installer script or a browser smoke test does not certify a legacy host.

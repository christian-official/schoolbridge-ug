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

## Feasibility decision and practical rollout

1. **Primary no-WSL host:** prioritise a Docker-free native Windows 10/11 package using a supported Python runtime and local SQLite. This directly removes the WSL2 requirement without introducing an unsupported operating system or EOL runtime.
2. **Windows 8.1 host:** keep as a separately gated experimental compatibility target. Python 3.12 is a technically supported runtime for Windows 8.1, but the OS is EOL. Do not advertise production support until security review, dependency audit, and clean-machine acceptance are complete.
3. **Windows 8.0 host:** blocked for the current Python backend because the documented compatible Python path requires an EOL runtime. Do not claim native host support unless the backend is deliberately ported to a runtime with maintained Windows 8.0 support and that entire stack is audited and tested. A runtime downgrade is not an acceptable shortcut.
4. **Older Windows PCs as clients:** investigate LAN browser access from Firefox ESR 115 while Mozilla security updates remain available. Treat this as a temporary compatibility path, not an OS security guarantee. Validate login, role permissions, service worker/offline behaviour, IndexedDB, Web Crypto, uploads and printing on the actual browser build.
5. **Schools with no supported host PC:** offer a supported, low-cost dedicated host device on the school LAN, with existing older PCs connecting as clients where browser tests pass. The database remains on the host's local disk and is never shared as a network file.

The acceptance matrix must report host OS and client OS/browser independently. A passing Windows installer script or a browser smoke test does not certify a legacy host.

## User-facing Windows compatibility policy

The product goal is broad access, not an arbitrary minimum of Windows 10. SchoolBridge should aim to be usable from **Windows 8 through the latest supported Windows release**, with the installation role and browser clearly distinguished:

- **Windows 8 and 8.1 client access:** a supported-browser compatibility target, initially Firefox ESR 115. The current Vite 8 production build baseline is Firefox 114, so its declared JavaScript baseline is compatible on paper with Firefox 115. This is not yet an end-to-end certification: test authentication, all major workspaces, IndexedDB, service worker/offline flows, Web Crypto, uploads, printing and LAN connectivity on actual Windows 8 and 8.1 machines.
- **Windows 8.1 as a native host:** experimental only. Python 3.12 supports Windows 8.1, but the operating system itself is out of support. A complete dependency, cryptography, TLS and lifecycle audit plus clean-machine acceptance is required before any production claim.
- **Windows 8.0 as a native host:** not currently supported by the Python runtime path. Do not bundle an end-of-life runtime. Keep investigating a maintainable host option, or use a supported dedicated host on the school LAN while testing Windows 8 as a client.
- **Windows 10/11 and later supported Windows releases:** retain the existing deployment path and develop a Docker-free host installer as the preferred route for schools without WSL2. The legacy compatibility work must not break this path.

This means we are **not intentionally limiting SchoolBridge to Windows 10+**. The target is Windows 8 client access where browser validation passes, plus native hosting across supported Windows releases. The exact limitation today is native hosting on Windows 8.0; Windows 8.1 hosting remains gated. Never advertise a Windows version as supported until its corresponding host/client acceptance matrix passes.

### Current frontend baseline evidence

The repository uses Vite 8. Its documented default production browser target includes Firefox 114. Mozilla's Firefox ESR 115 is the final line for Windows 7/8/8.1 and currently has security updates scheduled through March 2027, subject to Mozilla's re-evaluation. This makes Firefox ESR 115 a credible *temporary client test target*, not a guarantee that every SchoolBridge feature works there. The build's browser baseline and real browser feature tests are separate requirements.

### Repository audit update (2026-11-11)

A review of the current frontend manifest and CI workflow found these concrete validation gaps:

- The frontend currently uses React 19.3, Vite 8.3 and TypeScript 7. The project does not currently declare a dedicated legacy-browser build target in its Vite configuration.
- The frontend now has a separate `build:legacy-client` output targeting Firefox 115, without changing the modern production bundle. CI boots that dedicated output in Playwright Firefox for a legacy-client API smoke test. The CI browser is the Playwright-pinned Firefox build, not Mozilla Firefox ESR 115; the Windows 8/8.1 ESR 115 machine acceptance remains outstanding.
- Therefore, the Firefox 114 Vite default target is only a build/transpilation baseline. It is not evidence that SchoolBridge's React application, browser APIs, service worker, IndexedDB, Web Crypto, file uploads or printing work on Firefox ESR 115 on Windows 8/8.1.
- Do not lower the global build target or replace current browser dependencies just to obtain a nominal legacy-browser build. First add a separate compatibility build/test lane and identify unsupported APIs. Any polyfill must be narrowly scoped, maintained and covered by tests.

#### Next implementation sequence

1. Add a dedicated legacy-client build target and static compatibility audit without changing the modern production bundle.
2. Add Firefox-based browser coverage for the legacy target, including login, role permissions, navigation, offline storage/service-worker behaviour, Web Crypto, uploads and print flows. Pin a reproducible browser build; distinguish modern Firefox CI from the actual ESR 115 acceptance run.
3. Run the client acceptance matrix independently on Windows 8.0 and Windows 8.1 with Firefox ESR 115 while it remains maintained. A Linux Firefox test is useful but does not certify Windows 8 browser integration.
4. For Windows 8.1 hosting, audit every pinned Python dependency and native wheel, TLS/certificate behaviour, startup/recovery and backup/restore before producing an installer prototype.
5. For Windows 8.0 hosting, complete a runtime feasibility decision first. If no maintained compatible runtime exists, keep native hosting blocked and do not substitute an end-of-life runtime.

**Current evidence status:** Windows 8.0 native host — blocked; Windows 8.1 native host — experimental/unverified; Windows 8.0 and 8.1 browser clients — unverified; Windows 10/11 native package — CI-verified on Windows Server 2022, with physical-machine acceptance still outstanding.

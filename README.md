# SchoolBridge

**Local-first school management for primary and secondary schools.**

SchoolBridge is designed to run on each school's own computer. The local school database is the primary source of truth. Render is for preview/development, not a school production dependency. A school can operate on one computer without internet or LAN; a local Wi-Fi/router or wired network is optional when additional staff devices need access.

## Planned capabilities

- Student admission, profiles, guardians and class allocation
- Staff, classes and subject management
- Attendance recording
- Examinations, mark entry, grading and report cards
- Fees, receipts, balances and finance reports
- Timetables, announcements and school reports
- Role-based access, audit logs and data backups
- Data export and restore tools

## Platform and installation status

| Windows version | Native host status | Client status |
|---|---|---|
| Windows 8.0 | Blocked with the current maintained desktop runtime; not certified | Not certified |
| Windows 8.1 | Blocked with the current Tauri/WebView2 desktop stack; not certified | Client compatibility is unverified; a separate browser does not satisfy the desktop requirement |
| Windows 10 22H2 / Windows 11 23H2+ (64-bit) | Docker-free native package built; real-machine acceptance still required | Intended host and client platforms |
| Newer supported Windows | Targeted; validate each release | Targeted; validate each release |

Windows 8.0 is the starting compatibility target, followed by Windows 8.1 and newer Windows releases. Windows 8.0 and 8.1 remain explicit product requirements, but both are blocked pending a maintained desktop runtime and independent clean-machine acceptance. A browser opened separately is not the SchoolBridge desktop application. See [legacy Windows installation engineering](docs/LEGACY_WINDOWS_SUPPORT.md).

## Current development and release status

Phase 5 — Database & Offline Architecture includes database-safety, local deployment, device registration, change-journal, checkpoint and role-scoped snapshot foundations. Teacher mark drafts and selected attendance workflows have offline foundations, and Device Management supports explicit encrypted read-only snapshots. This does **not** mean every module supports offline records and writes.

### Current local package proof — not the final desktop application

The existing Docker-free package bundles CPython, FastAPI, the React build and SQLite, and CI checks installation and backend startup on a Windows Server 2022 runner. It then serves the frontend over localhost and requires a separate browser. It is therefore **not yet the agreed standalone desktop application**, and it does not establish Windows 8 or Windows 8.1 compatibility. Keep it as an engineering proof only; do not treat its artifact as the final USB release.

The required deliverable is a USB-carried, fully offline installer that installs and launches SchoolBridge as desktop software on Windows 8 first, then Windows 8.1 and newer Windows releases. The package must include all required application/runtime components, local database setup, integrity verification, lifecycle handling, backup/restore and offline operator instructions. It must not require Docker Desktop, WSL2, an internet download, or a separately installed browser on the school computer.

### Existing Docker/WSL2 USB prototype

The existing prepare-usb.ps1 produces a Docker Desktop/WSL2 package and opens the app through a browser. It requires a Windows 10/11-class host and is **not** the required Windows 8-starting desktop USB deliverable. Retain it only as a separate prototype until the unified desktop installer is implemented. See [USB installation](docs/USB_INSTALLATION.md).

The service worker caches the app shell only. Full offline record access and writes across all modules remain unfinished. Do not advertise SchoolBridge as fully offline across every module or as a certified turnkey installer until the corresponding acceptance gates pass.

## Development

Backend: Python, FastAPI and SQLAlchemy. Single-host SQLite and multi-user local PostgreSQL are supported deployment paths. The native Windows package uses SQLite; the local Compose stack uses PostgreSQL.

## Principles

- Local database is the school's primary source of truth.
- No cloud account or internet required for ordinary local operations.
- A LAN is optional for multi-device access, not installation.
- Least-privilege roles, audit history, reliable backup and restore.
- Never use real student data in development or testing.

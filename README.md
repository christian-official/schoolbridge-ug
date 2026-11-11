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
| Windows 8.0 | Not supported by the current maintained Python runtime path; native work remains blocked | Compatibility testing remains outstanding |
| Windows 8.1 | Experimental engineering only; not certified for school hosting | Firefox ESR 115 is a test target, not yet certified |
| Windows 10 22H2 / Windows 11 23H2+ (64-bit) | Docker-free native package built; real-machine acceptance still required | Intended host and client platforms |
| Newer supported Windows | Targeted; validate each release | Targeted; validate each release |

Windows 8.0 and 8.1 are separate compatibility tracks. Browser-only access from an older computer does not count as native installation on that computer. See [legacy Windows installation engineering](docs/LEGACY_WINDOWS_SUPPORT.md).

## Current development and release status

Phase 5 — Database & Offline Architecture includes database-safety, local deployment, device registration, change-journal, checkpoint and role-scoped snapshot foundations. Teacher mark drafts and selected attendance workflows have offline foundations, and Device Management supports explicit encrypted read-only snapshots. This does **not** mean every module supports offline records and writes.

### Docker-free native Windows package

A native 64-bit Windows package is now built in GitHub Actions. CI run [#937](https://github.com/christian-official/schoolbridge-ug/actions/runs/43000294374) passed all seven jobs, including offline package installation, application boot, frontend serving and local SQLite health on a Windows Server 2022 runner. The package is intended for Windows 10 22H2 and Windows 11 23H2 or later.

**Important acceptance limit:** Windows Server 2022 CI is not a substitute for installing and testing on a clean physical Windows 10/11 school computer. Do not call the native package fully accepted for school deployment until that test covers owner activation, first-school setup, login, real workflows, restart persistence, backup and restore.

The first native package is a **single-computer, loopback-only** host. It does not provide LAN access, automatic upgrades, unattended service recovery or a signed installer. Back up the data directory before replacing or moving an installation. See [native Windows installation](scripts/NATIVE_WINDOWS_INSTALLATION.md).

### Docker/WSL2 USB package

The separate Docker/WSL2 USB workflow packages PostgreSQL, the backend and frontend with Docker Desktop and WSL installers. It remains a distinct installation route and still requires clean-machine acceptance. It is not a prerequisite for the Docker-free native package. See [USB installation](docs/USB_INSTALLATION.md).

The service worker caches the app shell only. Full offline record access and writes across all modules remain unfinished. Do not advertise SchoolBridge as fully offline across every module or as a certified turnkey installer until the corresponding acceptance gates pass.

## Development

Backend: Python, FastAPI and SQLAlchemy. Single-host SQLite and multi-user local PostgreSQL are supported deployment paths. The native Windows package uses SQLite; the local Compose stack uses PostgreSQL.

## Principles

- Local database is the school's primary source of truth.
- No cloud account or internet required for ordinary local operations.
- A LAN is optional for multi-device access, not installation.
- Least-privilege roles, audit history, reliable backup and restore.
- Never use real student data in development or testing.

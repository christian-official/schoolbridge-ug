# SchoolBridge

**Local-first school management for primary and secondary schools.**

SchoolBridge is being developed for installation on each school's own computer. The local school database is the primary source of truth. Internet and Render are not dependencies for ordinary school operations. A school can operate on one computer without LAN; a local Wi-Fi/router or wired network is optional for connecting additional staff devices.

## Planned capabilities

- Student admission, profiles, guardians and class allocation
- Staff, classes and subject management
- Attendance recording
- Examinations, mark entry, grading and report cards
- Fees, receipts, balances and finance reports
- Timetables, announcements and school reports
- Role-based access, audit logs and data backups
- Data export and restore tools

## Current development status

Phase 5 — Database & Offline Architecture includes database-safety, local deployment, device registration, change-journal, checkpoint and role-scoped snapshot foundations. Teacher mark drafts and selected attendance workflows have offline foundations, and Device Management supports explicit encrypted read-only snapshots. These do not mean all modules are fully offline.

The local Docker Compose stack runs PostgreSQL, backend, frontend and a backup scheduler. USB scripts now prepare and import prebuilt application images without downloading those images at the school. **The USB package still requires Docker Engine/Compose to be pre-installed, and the service worker currently caches the app shell only. Full offline record access/writes across all modules and clean-machine disconnected installation tests remain unfinished.** Do not call the USB package a finished turnkey offline installer yet.

See [USB installation status and instructions](docs/USB_INSTALLATION.md), [school readiness](docs/SCHOOL_READINESS_AND_INSTALLATION.md), and [architecture notes](docs/architecture.md).

## Development

Backend: Python, FastAPI and SQLAlchemy. Single-host SQLite and multi-user local PostgreSQL are supported deployment paths. The local Compose stack uses PostgreSQL. Render services are preview/development only, not school production dependencies.

## Principles

- Local database is the school's primary source of truth.
- No cloud account or internet required for ordinary local operations.
- A LAN is optional for multi-device access, not installation.
- Least-privilege roles, audit history, reliable backup and restore.
- Never use real student data in development or testing.

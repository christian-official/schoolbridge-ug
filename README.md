# SchoolBridge

**Local-first school management for primary and secondary schools.**

SchoolBridge provides school administration workflows through a Progressive Web App (PWA). The same installable web application is the current client on Windows, Android and supported iPhones/iPads.

## Planned capabilities

- Student admission, profiles, guardians and class allocation
- Staff, classes and subject management
- Attendance recording
- Examinations, mark entry, grading and report cards
- Fees, receipts, balances and finance reports
- Timetables, announcements and school reports
- Role-based access, audit logs and data backups
- Data export and restore tools

## Current access model

| User | Access |
|---|---|
| Administrators and essential staff | Open the school's SchoolBridge link in a supported browser, install the PWA, then sign in inside the installed app |
| Teachers | Scan the teacher QR code, install the PWA, then complete verification inside the installed app |
| Parents | Scan the parent QR code, install the PWA, then complete verification inside the installed app |

Windows users do **not** need a QR scanner or a separate Windows executable. They use the ordinary school access link and the browser's Install app / Add to taskbar option. Parent and teacher QR routes remain role-specific and registration is gated to the installed PWA context.

A native Windows desktop installer and USB installer are **deferred**. Earlier Task 1.11–1.13 desktop/USB engineering work is retained as deferred work; it is not the current installation or release path. CI validates the PWA, frontend, backend and Windows-hosted backend tests, but does not publish Windows desktop installers.

## Development and offline status

Phase 5 — Database & Offline Architecture includes database-safety, device registration, change-journal, checkpoint and role-scoped snapshot foundations. Teacher mark drafts and selected attendance workflows have offline foundations, and Device Management supports explicit encrypted read-only snapshots. This does **not** mean every module supports offline records and writes.

The service worker caches the app shell only. Full offline record access and writes across all modules remain unfinished. Do not advertise SchoolBridge as fully offline across every module or as a certified turnkey local installer until the corresponding acceptance gates pass.

## Development

Backend: Python, FastAPI and SQLAlchemy. Single-host SQLite and multi-user local PostgreSQL are supported deployment paths.

## Principles

- Local database is the school's primary source of truth.
- No cloud account or internet required for ordinary local operations where the configured deployment supports local access.
- A LAN is optional for multi-device access, not installation.
- Least-privilege roles, audit history, reliable backup and restore.
- Never use real student data in development or testing.

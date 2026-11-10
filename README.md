# SchoolBridge

**Offline-first school management for primary and secondary schools.**

SchoolBridge is being developed as a locally installed Windows application for schools. Its core workflows are designed to work without internet access. A school can run it on one computer or allow authorised staff to connect from phones and computers over the school's local Wi-Fi network.

## Planned capabilities

- Student admission, profiles, guardians and class allocation
- Staff, classes and subject management
- Attendance recording
- Examinations, mark entry, grading and report cards
- Fees, receipts, balances and finance reports
- Timetables, announcements and school reports
- Role-based access, audit logs and data backups
- Data export and restore tools

## Operating modes

1. **Single computer:** all core work is performed on one Windows computer.
2. **School local network:** the school computer hosts the application; authorised phones and computers connect over local Wi-Fi without internet.
3. **Larger school network:** multiple authorised users work concurrently through a central school server.

Each school's installation and data must remain isolated. Internet access may be used for optional updates, but must not be required for ordinary school operations.

## Development status

Phase 5 — Database & Offline Architecture includes verified database-safety, school-LAN deployment, device registration, change-journal, checkpoint and role-scoped snapshot foundations. Teacher mark drafts are encrypted locally and valid submissions are automatically applied after server-side permission, assignment, device, student, result-lock and conflict checks. Device Management supports an explicit, 24-hour AES-GCM encrypted snapshot of authorised students, classes, attendance, examinations, marks and fees; it is invalidated after detected permission or record changes on reconnect. Generic offline writes beyond the validated teacher-marks workflow remain disabled until entity-specific validation and conflict handling are implemented. PostgreSQL LAN installs run a dedicated daily verified backup service; SQLite single-host installs can run the same scheduler through Windows Task Scheduler.

See [the local-network installation guide](docs/LOCAL_NETWORK_INSTALLATION.md) for setup and [the architecture notes](docs/architecture.md) for the current design direction.

## Development

The backend uses Python, FastAPI and SQLAlchemy. SQLite is intended for a single-host installation; PostgreSQL is used for multi-user school networks. The production Windows installer and the remaining permission-aware offline record synchronisation work are separate milestones.

## Important principles

- Offline-first; no cloud account required for daily school operations.
- Secure access with least-privilege roles.
- Reliable backup, restore and data export.
- Clear audit history for important changes.
- Simple workflows suitable for school staff.
- Never use real student data in development or testing.

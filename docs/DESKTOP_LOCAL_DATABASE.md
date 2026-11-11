# Desktop local database integration

The desktop launcher stores the active SQLite database in the signed-in Windows
user's local application data directory:

`%LOCALAPPDATA%\SchoolBridge\data\schoolbridge.sqlite3`

The location is independent of the USB drive and installation directory. The
desktop process passes this directory to the backend as
`SCHOOLBRIDGE_DATA_DIR`; backend startup resolves it before importing
`app.database`, because that module creates its SQLAlchemy engine at import
time. The desktop configuration takes precedence over an install-relative
`SCHOOLBRIDGE_DATABASE_URL` in the USB template.

SQLite WAL, FULL synchronous commits, foreign-key enforcement, and the existing
migration pre-backup and staged-restore validation remain enabled. Migration
snapshots and restore safety copies are created alongside the active database,
so they remain on the computer's local disk.

This task establishes durable local placement and startup configuration. It does
not yet claim encryption at rest, automatic backup scheduling, or successful
real-machine restore drills; those remain separate security and recovery work.

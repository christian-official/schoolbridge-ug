import os
import sqlite3

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv(
    "SCHOOLBRIDGE_DATABASE_URL",
    "sqlite:///./schoolbridge.db"
)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)


def create_sqlite_backup(source_path: str, backup_path: str) -> None:
    """Create and verify a consistent SQLite snapshot, including WAL data."""
    if not source_path or not os.path.isfile(source_path):
        raise FileNotFoundError("The configured SQLite database file does not exist.")

    source = sqlite3.connect(source_path)
    destination = sqlite3.connect(backup_path)
    try:
        source.backup(destination)
        integrity = destination.execute("PRAGMA integrity_check").fetchone()
        foreign_key_errors = destination.execute("PRAGMA foreign_key_check").fetchall()
        if not integrity or integrity[0] != "ok" or foreign_key_errors:
            raise sqlite3.DatabaseError("The generated database backup failed integrity validation.")
    finally:
        destination.close()
        source.close()


def configure_sqlite_connection(connection, persistent_database: bool = True) -> None:
    """Apply safe connection settings for SchoolBridge's local SQLite database."""
    cursor = connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=10000")
        if persistent_database:
            # WAL allows readers to continue while a write transaction is active.
            # FULL synchronous mode keeps committed transactions durable.
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=FULL")
            cursor.execute("PRAGMA wal_autocheckpoint=1000")
    finally:
        cursor.close()


if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def enable_sqlite_safety(connection, _):
        database_name = engine.url.database
        persistent_database = database_name not in (None, "", ":memory:")
        configure_sqlite_connection(connection, persistent_database)


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def validate_sqlite_database(database_path: str) -> None:
    """Reject incomplete or structurally invalid SQLite database files."""
    if not database_path or not os.path.isfile(database_path):
        raise FileNotFoundError("The SQLite database file does not exist.")
    connection = sqlite3.connect(database_path)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if not integrity or integrity[0] != "ok" or foreign_key_errors:
            raise sqlite3.DatabaseError("The SQLite database failed integrity validation.")
    finally:
        connection.close()


def apply_sqlite_restore(database_path: str, pending_path: str, safety_path: str) -> bool:
    """Safely replace a SQLite database with a validated staged restore.

    The current database is backed up (including committed WAL data) before its
    WAL is checkpointed and sidecars are removed. The staged file is validated
    again immediately before the atomic replacement.
    """
    if not pending_path or not os.path.isfile(pending_path):
        return False

    validate_sqlite_database(pending_path)

    if os.path.isfile(database_path):
        create_sqlite_backup(database_path, safety_path)

        current = sqlite3.connect(database_path)
        try:
            result = current.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if result and result[0] != 0:
                raise sqlite3.OperationalError("Could not checkpoint the current database WAL.")
        finally:
            current.close()

    # No application connections may remain open when this helper is called.
    # Removing old sidecars before replacement prevents them being replayed
    # against the restored database after the new main file is installed.
    for suffix in ("-wal", "-shm"):
        sidecar = database_path + suffix
        if os.path.exists(sidecar):
            os.unlink(sidecar)

    os.replace(pending_path, database_path)
    validate_sqlite_database(database_path)
    return True

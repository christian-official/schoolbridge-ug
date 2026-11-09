import os
import shutil
import sqlite3

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv(
    "SCHOOLBRIDGE_DATABASE_URL",
    "sqlite:///./schoolbridge.db"
)

SQLITE_BUSY_TIMEOUT_MS = 30000
is_sqlite = DATABASE_URL.startswith("sqlite")
sqlite_database_name = DATABASE_URL.removeprefix("sqlite:///") if is_sqlite else None
is_sqlite_memory = is_sqlite and sqlite_database_name in (None, "", ":memory:")
connect_args = (
    {"check_same_thread": False, "timeout": SQLITE_BUSY_TIMEOUT_MS / 1000}
    if is_sqlite else {}
)
engine_options = {"connect_args": connect_args, "pool_pre_ping": True}
if not is_sqlite_memory:
    # A bounded pool prevents unbounded connection growth under concurrent staff use.
    engine_options.update(pool_size=5, max_overflow=10, pool_timeout=30)
engine = create_engine(DATABASE_URL, **engine_options)


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
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
        if persistent_database:
            # WAL allows readers to continue while a write transaction is active.
            # FULL synchronous mode keeps committed transactions durable.
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=FULL")
            cursor.execute("PRAGMA wal_autocheckpoint=1000")
    finally:
        cursor.close()


def sqlite_connection_diagnostics(connection) -> dict:
    """Return safe, non-sensitive SQLite runtime settings for health checks."""
    def read_pragma(statement):
        if hasattr(connection, "exec_driver_sql"):
            result = connection.exec_driver_sql(statement)
            return result.scalar()
        return connection.execute(statement).fetchone()[0]

    return {
        "journal_mode": str(read_pragma("PRAGMA journal_mode")).lower(),
        "foreign_keys": bool(read_pragma("PRAGMA foreign_keys")),
        "busy_timeout_ms": int(read_pragma("PRAGMA busy_timeout")),
        "synchronous": int(read_pragma("PRAGMA synchronous")),
    }


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
    """Replace a SQLite database and roll back if the installed file fails validation.

    A verified snapshot is made before touching the active database. WAL data is
    checkpointed before sidecars are removed so the safety copy and rollback
    remain complete even if the atomic replacement or final validation fails.
    """
    if not pending_path or not os.path.isfile(pending_path):
        return False

    validate_sqlite_database(pending_path)
    had_database = os.path.isfile(database_path)

    if had_database:
        create_sqlite_backup(database_path, safety_path)
        current = sqlite3.connect(database_path)
        try:
            result = current.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if result and result[0] != 0:
                raise sqlite3.OperationalError("Could not checkpoint the current database WAL.")
        finally:
            current.close()

    # No application connections may remain open when this helper is called.
    for suffix in ("-wal", "-shm"):
        sidecar = database_path + suffix
        if os.path.exists(sidecar):
            os.unlink(sidecar)

    try:
        os.replace(pending_path, database_path)
        validate_sqlite_database(database_path)
    except Exception as restore_error:
        try:
            if had_database:
                rollback_path = database_path + ".restore_rollback"
                shutil.copy2(safety_path, rollback_path)
                os.replace(rollback_path, database_path)
                validate_sqlite_database(database_path)
            elif os.path.exists(database_path):
                os.unlink(database_path)
        except Exception as rollback_error:
            raise RuntimeError(
                "Database restore failed and automatic rollback could not be completed; "
                "the verified safety backup must be preserved for recovery."
            ) from rollback_error
        raise restore_error

    return True

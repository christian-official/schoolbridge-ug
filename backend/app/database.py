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

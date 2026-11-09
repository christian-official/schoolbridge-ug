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

import sqlite3

from app.database import configure_sqlite_connection


def test_persistent_sqlite_connection_uses_safe_local_database_pragmas(tmp_path):
    database_path = tmp_path / "schoolbridge.sqlite3"
    connection = sqlite3.connect(database_path)
    try:
        configure_sqlite_connection(connection, persistent_database=True)
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 10000
        assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert connection.execute("PRAGMA synchronous").fetchone()[0] == 2
        assert connection.execute("PRAGMA wal_autocheckpoint").fetchone()[0] == 1000
    finally:
        connection.close()


def test_in_memory_sqlite_keeps_memory_journal_mode():
    connection = sqlite3.connect(":memory:")
    try:
        configure_sqlite_connection(connection, persistent_database=False)
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 10000
        assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "memory"
    finally:
        connection.close()

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


from app.database import apply_sqlite_restore, create_sqlite_backup


def _make_database(path, value):
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE records (value TEXT NOT NULL)")
        connection.execute("INSERT INTO records(value) VALUES (?)", (value,))
        connection.commit()
    finally:
        connection.close()


def test_restore_checkpoints_old_wal_and_preserves_safety_backup(tmp_path):
    database = tmp_path / "schoolbridge.sqlite3"
    pending = tmp_path / "schoolbridge.sqlite3.restore_pending"
    safety = tmp_path / "schoolbridge.before_restore.bak"
    _make_database(database, "old-record")
    _make_database(pending, "restored-record")

    # Leave committed data in the old database's WAL before restoration.
    old_connection = sqlite3.connect(database)
    try:
        old_connection.execute("PRAGMA journal_mode=WAL")
        old_connection.execute("INSERT INTO records(value) VALUES ('wal-record')")
        old_connection.commit()
    finally:
        old_connection.close()

    assert apply_sqlite_restore(str(database), str(pending), str(safety)) is True

    restored = sqlite3.connect(database)
    try:
        assert restored.execute("SELECT value FROM records").fetchall() == [("restored-record",)]
    finally:
        restored.close()

    backup = sqlite3.connect(safety)
    try:
        assert set(backup.execute("SELECT value FROM records").fetchall()) == {
            ("old-record",), ("wal-record",)
        }
    finally:
        backup.close()
    assert not pending.exists()
    assert not (tmp_path / "schoolbridge.sqlite3-wal").exists()
    assert not (tmp_path / "schoolbridge.sqlite3-shm").exists()


def test_restore_without_existing_database_does_not_require_safety_backup(tmp_path):
    database = tmp_path / "new-school.sqlite3"
    pending = tmp_path / "new-school.sqlite3.restore_pending"
    _make_database(pending, "restored")

    assert apply_sqlite_restore(str(database), str(pending), str(tmp_path / "unused.bak")) is True
    connection = sqlite3.connect(database)
    try:
        assert connection.execute("SELECT value FROM records").fetchone() == ("restored",)
    finally:
        connection.close()

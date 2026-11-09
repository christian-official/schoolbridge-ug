import sqlite3

from app.database import SQLITE_BUSY_TIMEOUT_MS, configure_sqlite_connection


def test_persistent_sqlite_connection_uses_safe_local_database_pragmas(tmp_path):
    database_path = tmp_path / "schoolbridge.sqlite3"
    connection = sqlite3.connect(database_path)
    try:
        configure_sqlite_connection(connection, persistent_database=True)
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 30000
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
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == SQLITE_BUSY_TIMEOUT_MS
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



def test_restore_rolls_back_to_verified_safety_copy_when_installed_file_fails_validation(tmp_path, monkeypatch):
    import app.database as database_module

    database = tmp_path / "schoolbridge.sqlite3"
    pending = tmp_path / "schoolbridge.sqlite3.restore_pending"
    safety = tmp_path / "schoolbridge.before_restore.bak"
    _make_database(database, "original")
    _make_database(pending, "replacement")

    real_validate = database_module.validate_sqlite_database
    calls = {"count": 0}

    def fail_after_replacement(path):
        calls["count"] += 1
        if calls["count"] == 2:
            raise sqlite3.DatabaseError("simulated post-replacement validation failure")
        return real_validate(path)

    monkeypatch.setattr(database_module, "validate_sqlite_database", fail_after_replacement)

    import pytest
    with pytest.raises(sqlite3.DatabaseError, match="simulated"):
        apply_sqlite_restore(str(database), str(pending), str(safety))

    restored = sqlite3.connect(database)
    try:
        assert restored.execute("SELECT value FROM records").fetchall() == [("original",)]
    finally:
        restored.close()
    assert safety.exists()


def test_sqlite_concurrent_connections_preserve_committed_writes(tmp_path):
    database_path = tmp_path / "concurrent.sqlite3"
    first = sqlite3.connect(database_path, timeout=SQLITE_BUSY_TIMEOUT_MS / 1000)
    second = sqlite3.connect(database_path, timeout=SQLITE_BUSY_TIMEOUT_MS / 1000)
    try:
        configure_sqlite_connection(first, persistent_database=True)
        configure_sqlite_connection(second, persistent_database=True)
        first.execute("CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
        first.commit()
        first.execute("INSERT INTO entries(value) VALUES ('first')")
        first.commit()
        second.execute("INSERT INTO entries(value) VALUES ('second')")
        second.commit()
        assert second.execute("SELECT value FROM entries ORDER BY id").fetchall() == [
            ("first",), ("second",)
        ]
    finally:
        second.close()
        first.close()


def test_sqlite_diagnostics_report_active_safety_settings(tmp_path):
    from app.database import sqlite_connection_diagnostics

    connection = sqlite3.connect(tmp_path / "diagnostics.sqlite3")
    try:
        configure_sqlite_connection(connection, persistent_database=True)
        details = sqlite_connection_diagnostics(connection)
        assert details == {
            "journal_mode": "wal",
            "foreign_keys": True,
            "busy_timeout_ms": SQLITE_BUSY_TIMEOUT_MS,
            "synchronous": 2,
        }
    finally:
        connection.close()

import sqlite3

import pytest

from app.database import apply_sqlite_restore, create_sqlite_backup, validate_sqlite_database


def test_sqlite_backup_contains_consistent_data_and_relationships(tmp_path):
    source_path = tmp_path / "schoolbridge.sqlite3"
    backup_path = tmp_path / "schoolbridge-backup.sqlite3"
    source = sqlite3.connect(source_path)
    try:
        source.execute("PRAGMA journal_mode=WAL")
        source.execute("PRAGMA foreign_keys=ON")
        source.execute("CREATE TABLE classes (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
        source.execute(
            "CREATE TABLE students (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL "
            "REFERENCES classes(id), name TEXT NOT NULL)"
        )
        source.execute("INSERT INTO classes (id, name) VALUES (1, 'S1')")
        source.execute("INSERT INTO students (id, class_id, name) VALUES (1, 1, 'Student One')")
        source.commit()
    finally:
        source.close()

    create_sqlite_backup(str(source_path), str(backup_path))

    backup = sqlite3.connect(backup_path)
    try:
        assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert backup.execute("PRAGMA foreign_key_check").fetchall() == []
        assert backup.execute("SELECT name FROM students").fetchone()[0] == "Student One"
    finally:
        backup.close()


def test_sqlite_backup_rejects_missing_source(tmp_path):
    with pytest.raises(FileNotFoundError):
        create_sqlite_backup(str(tmp_path / "missing.sqlite3"), str(tmp_path / "backup.sqlite3"))



def _write_database(path, student_name):
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
        connection.execute("INSERT INTO students (id, name) VALUES (1, ?)", (student_name,))
        connection.commit()
    finally:
        connection.close()


def test_sqlite_restore_replaces_database_and_keeps_verified_safety_copy(tmp_path):
    active_path = tmp_path / "schoolbridge.sqlite3"
    pending_path = tmp_path / "restore-pending.sqlite3"
    safety_path = tmp_path / "schoolbridge-safety.sqlite3"
    _write_database(active_path, "Current Student")
    _write_database(pending_path, "Restored Student")

    assert apply_sqlite_restore(str(active_path), str(pending_path), str(safety_path)) is True
    validate_sqlite_database(str(active_path))

    active = sqlite3.connect(active_path)
    safety = sqlite3.connect(safety_path)
    try:
        assert active.execute("SELECT name FROM students").fetchone()[0] == "Restored Student"
        assert safety.execute("SELECT name FROM students").fetchone()[0] == "Current Student"
    finally:
        active.close()
        safety.close()
    assert not pending_path.exists()


def test_sqlite_restore_rejects_invalid_pending_database_without_touching_active(tmp_path):
    active_path = tmp_path / "schoolbridge.sqlite3"
    pending_path = tmp_path / "restore-pending.sqlite3"
    safety_path = tmp_path / "schoolbridge-safety.sqlite3"
    _write_database(active_path, "Current Student")
    pending_path.write_bytes(b"not a sqlite database")

    with pytest.raises(sqlite3.DatabaseError):
        apply_sqlite_restore(str(active_path), str(pending_path), str(safety_path))

    active = sqlite3.connect(active_path)
    try:
        assert active.execute("SELECT name FROM students").fetchone()[0] == "Current Student"
    finally:
        active.close()
    assert not safety_path.exists()


def test_sqlite_restore_rolls_back_when_installed_database_fails_validation(tmp_path, monkeypatch):
    import app.database as database_module

    active_path = tmp_path / "schoolbridge.sqlite3"
    pending_path = tmp_path / "restore-pending.sqlite3"
    safety_path = tmp_path / "schoolbridge-safety.sqlite3"
    _write_database(active_path, "Current Student")
    _write_database(pending_path, "Restored Student")

    original_validate = database_module.validate_sqlite_database
    active_validation_calls = 0

    def fail_first_installed_validation(path):
        nonlocal active_validation_calls
        if path == str(active_path):
            active_validation_calls += 1
            if active_validation_calls == 1:
                raise sqlite3.DatabaseError("simulated post-replacement validation failure")
        return original_validate(path)

    monkeypatch.setattr(database_module, "validate_sqlite_database", fail_first_installed_validation)

    with pytest.raises(sqlite3.DatabaseError, match="simulated post-replacement"):
        database_module.apply_sqlite_restore(str(active_path), str(pending_path), str(safety_path))

    active = sqlite3.connect(active_path)
    try:
        assert active.execute("SELECT name FROM students").fetchone()[0] == "Current Student"
    finally:
        active.close()
    assert safety_path.exists()
    assert active_validation_calls == 2

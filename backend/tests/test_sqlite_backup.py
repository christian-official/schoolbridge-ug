import sqlite3

import pytest

from app.database import create_sqlite_backup


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

from pathlib import Path
from unittest.mock import Mock

import pytest

from restore_postgres import restore_postgres_backup


def test_postgres_restore_uses_new_database_and_validates_tables(tmp_path):
    archive = tmp_path / "school.dump"
    archive.write_bytes(b"verified archive")
    calls = []
    def runner(command, **kwargs):
        calls.append(command)
        if command[0] == "psql":
            return Mock(stdout="true\n")
        return Mock(stdout="")
    result = restore_postgres_backup(
        archive, "schoolbridge_restore_test",
        "postgresql://school:secret@db.example:5432/school",
        runner=runner,
    )
    assert result["validated"] is True
    assert calls[0][:2] == ["pg_restore", "--list"]
    assert calls[1][0] == "createdb"
    assert calls[2][0] == "pg_restore"
    assert calls[3][0] == "psql"
    assert all("schoolbridge_restore_test" in call for call in calls[1:])


def test_postgres_restore_never_targets_active_database(tmp_path):
    archive = tmp_path / "school.dump"
    archive.write_bytes(b"archive")
    with pytest.raises(ValueError, match="new database"):
        restore_postgres_backup(archive, "school", "postgresql://school:secret@db.example/school", runner=Mock())


def test_postgres_restore_drops_failed_staging_database(tmp_path):
    archive = tmp_path / "school.dump"
    archive.write_bytes(b"archive")
    calls = []
    def runner(command, **kwargs):
        calls.append(command)
        if command[0] == "pg_restore" and "--list" not in command:
            raise RuntimeError("restore failed")
        return Mock(stdout="")
    with pytest.raises(RuntimeError, match="restore failed"):
        restore_postgres_backup(
            archive, "schoolbridge_restore_failed",
            "postgresql://school:secret@db.example/school",
            runner=runner,
        )
    assert calls[-1][0] == "dropdb"

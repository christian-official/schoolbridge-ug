from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest

from backup_postgres import create_postgres_backup, prune_old_backups
from restore_postgres import restore_postgres_backup


def test_postgres_backup_is_verified_before_being_published(tmp_path):
    calls = []

    def fake_runner(command, **kwargs):
        calls.append(command)
        if command[0] == "pg_dump":
            Path(command[command.index("--file") + 1]).write_bytes(b"custom archive")
        return Mock(returncode=0)

    result = create_postgres_backup(
        "postgresql+psycopg://school:secret@db.example:5432/school",
        tmp_path,
        runner=fake_runner,
    )

    backup = Path(result["path"])
    assert backup.exists()
    assert backup.read_bytes() == b"custom archive"
    assert backup.stat().st_mode & 0o777 == 0o600
    assert calls[0][0] == "pg_dump"
    assert calls[1][:2] == ["pg_restore", "--list"]
    assert not list(tmp_path.glob("*.partial"))


def test_failed_archive_validation_does_not_publish_backup(tmp_path):
    def fake_runner(command, **kwargs):
        if command[0] == "pg_dump":
            Path(command[command.index("--file") + 1]).write_bytes(b"invalid")
        else:
            raise RuntimeError("archive validation failed")

    with pytest.raises(RuntimeError, match="archive validation failed"):
        create_postgres_backup(
            "postgresql://school:secret@db.example/school",
            tmp_path,
            runner=fake_runner,
        )

    assert not list(tmp_path.glob("*.dump"))
    assert not list(tmp_path.glob("*.partial"))


def test_backup_rejects_sqlite_database(tmp_path):
    with pytest.raises(ValueError, match="requires a PostgreSQL"):
        create_postgres_backup("sqlite:///school.db", tmp_path, runner=Mock())


def test_backup_retention_must_be_positive(tmp_path):
    with pytest.raises(ValueError, match="at least one day"):
        create_postgres_backup(
            "postgresql://school:secret@db.example/school",
            tmp_path,
            retention_days=0,
            runner=Mock(),
        )


def test_retention_removes_only_expired_schoolbridge_archives(tmp_path):
    now = datetime(2026, 11, 9, tzinfo=timezone.utc)
    old = tmp_path / "schoolbridge-postgres-20260901T000000Z.dump"
    recent = tmp_path / "schoolbridge-postgres-20261101T000000Z.dump"
    unrelated = tmp_path / "other-backup.dump"
    for path in (old, recent, unrelated):
        path.write_bytes(b"archive")

    removed = prune_old_backups(tmp_path, retention_days=30, now=now)

    assert removed == [old]
    assert not old.exists()
    assert recent.exists()
    assert unrelated.exists()



def test_postgres_restore_validates_archive_and_restores_to_separate_database(tmp_path):
    archive = tmp_path / "schoolbridge-postgres-test.dump"
    archive.write_bytes(b"custom archive")
    calls = []

    def fake_runner(command, **kwargs):
        calls.append(command)
        if command[0] == "psql":
            return Mock(stdout="true")
        return Mock(stdout="")

    result = restore_postgres_backup(
        archive,
        "schoolbridge_restore_test",
        database_url="postgresql://school:secret@db.example:5432/school",
        runner=fake_runner,
    )

    assert result == {
        "database": "schoolbridge_restore_test",
        "validated": True,
        "source_archive": archive.name,
    }
    assert calls[0][:2] == ["pg_restore", "--list"]
    assert calls[1][0] == "createdb"
    assert calls[2][0] == "pg_restore"
    assert "--dbname" in calls[2] and "schoolbridge_restore_test" in calls[2]
    assert calls[3][0] == "psql"
    assert not any(command[0] == "dropdb" for command in calls)


def test_postgres_restore_drops_staging_database_when_validation_fails(tmp_path):
    archive = tmp_path / "schoolbridge-postgres-invalid.dump"
    archive.write_bytes(b"custom archive")
    calls = []

    def fake_runner(command, **kwargs):
        calls.append(command)
        if command[0] == "psql":
            return Mock(stdout="false")
        return Mock(stdout="")

    with pytest.raises(RuntimeError, match="missing required SchoolBridge tables"):
        restore_postgres_backup(
            archive,
            "schoolbridge_restore_failed",
            database_url="postgresql://school:secret@db.example:5432/school",
            runner=fake_runner,
        )

    assert any(command[0] == "dropdb" and command[-1] == "schoolbridge_restore_failed" for command in calls)


def test_postgres_restore_refuses_to_target_active_database(tmp_path):
    archive = tmp_path / "schoolbridge-postgres-active.dump"
    archive.write_bytes(b"custom archive")
    runner = Mock()

    with pytest.raises(ValueError, match="new database"):
        restore_postgres_backup(
            archive,
            "school",
            database_url="postgresql://school:secret@db.example:5432/school",
            runner=runner,
        )

    runner.assert_not_called()

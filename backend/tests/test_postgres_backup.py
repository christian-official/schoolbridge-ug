from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest

from backup_postgres import create_postgres_backup, prune_old_backups


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

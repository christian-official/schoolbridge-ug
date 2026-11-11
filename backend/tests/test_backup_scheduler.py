from datetime import datetime, timezone
from pathlib import Path
import os
import sqlite3

from backup_scheduler import create_scheduled_backup, prune_sqlite_backups


def test_sqlite_scheduled_backup_is_verified_and_private(tmp_path):
    source = tmp_path / "school.db"
    connection = sqlite3.connect(source)
    connection.execute("CREATE TABLE school_settings (id INTEGER PRIMARY KEY, name TEXT)")
    connection.execute("INSERT INTO school_settings(name) VALUES ('Test School')")
    connection.commit()
    connection.close()
    backups = tmp_path / "backups"
    result = create_scheduled_backup(
        f"sqlite:///{source}", backups,
        now=datetime(2026, 11, 10, tzinfo=timezone.utc),
    )
    archive = Path(result["path"])
    assert archive.exists() and archive.stat().st_size > 0
    if os.name == "nt":
        import shutil
        import subprocess
        icacls = shutil.which("icacls.exe") or shutil.which("icacls")
        assert icacls
        permissions = subprocess.run([icacls, str(archive)], check=True, capture_output=True, text=True).stdout
        assert "Successfully processed 1 files" in permissions
        assert "Failed processing 0 files" in permissions
        assert "Everyone" not in permissions
        assert "BUILTIN\\Users" not in permissions
    else:
        assert archive.stat().st_mode & 0o777 == 0o600
    check = sqlite3.connect(archive)
    try:
        assert check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert check.execute("SELECT name FROM school_settings").fetchone()[0] == "Test School"
    finally:
        check.close()


def test_sqlite_backup_retention_only_removes_expired_schoolbridge_files(tmp_path):
    now = datetime(2026, 11, 10, tzinfo=timezone.utc)
    old = tmp_path / "schoolbridge-sqlite-20260901T000000Z.sqlite3"
    recent = tmp_path / "schoolbridge-sqlite-20261101T000000Z.sqlite3"
    unrelated = tmp_path / "other.sqlite3"
    for path in (old, recent, unrelated):
        path.write_bytes(b"test")
    assert prune_sqlite_backups(tmp_path, 30, now) == [old]
    assert not old.exists() and recent.exists() and unrelated.exists()

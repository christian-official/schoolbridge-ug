"""Daily verified backups for SQLite single-host and PostgreSQL LAN installs."""
import argparse
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote

from sqlalchemy.engine import make_url

SQLITE_PATTERN = re.compile(r"^schoolbridge-sqlite-\d{8}T\d{6}Z\.sqlite3$")
logger = logging.getLogger("schoolbridge.backups")


def prune_sqlite_backups(directory, retention_days=30, now=None):
    if retention_days < 1:
        raise ValueError("Backup retention must be at least one day.")
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days)
    removed = []
    for path in Path(directory).iterdir():
        if not path.is_file() or not SQLITE_PATTERN.fullmatch(path.name):
            continue
        stamp = datetime.strptime(path.stem.removeprefix("schoolbridge-sqlite-"), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        if stamp < cutoff:
            path.unlink()
            removed.append(path)
    return removed


def create_scheduled_backup(database_url=None, backup_directory=None, retention_days=None, now=None):
    from app.database import create_sqlite_backup
    from backup_postgres import create_postgres_backup

    from app.database import DATABASE_URL
    url = make_url(database_url or DATABASE_URL)
    directory = Path(backup_directory or os.getenv("SCHOOLBRIDGE_BACKUP_DIR", "./backups"))
    retention = int(retention_days if retention_days is not None else os.getenv("SCHOOLBRIDGE_BACKUP_RETENTION_DAYS", "30"))
    if retention < 1:
        raise ValueError("Backup retention must be at least one day.")
    directory.mkdir(parents=True, exist_ok=True)
    if url.get_backend_name() == "postgresql":
        return create_postgres_backup(str(url), str(directory), retention, now=now)
    if url.get_backend_name() != "sqlite":
        raise ValueError("Automatic backups support SQLite and PostgreSQL only.")
    if not url.database or url.database == ":memory:":
        raise ValueError("A persistent SQLite database file is required for scheduled backups.")
    source = Path(unquote(url.database))
    if not source.is_absolute():
        source = Path.cwd() / source
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    destination = directory / f"schoolbridge-sqlite-{stamp}.sqlite3"
    fd, temporary_name = tempfile.mkstemp(prefix=".schoolbridge-sqlite-", suffix=".partial", dir=directory)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        create_sqlite_backup(str(source), str(temporary))
        os.chmod(temporary, 0o600)
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    removed = prune_sqlite_backups(directory, retention, now)
    return {"path": str(destination), "size_bytes": destination.stat().st_size, "removed_old_backups": len(removed)}


def run_scheduler(interval_hours=None):
    interval = float(interval_hours if interval_hours is not None else os.getenv("SCHOOLBRIDGE_BACKUP_INTERVAL_HOURS", "24"))
    if interval < 1:
        raise ValueError("Backup interval must be at least one hour.")
    while True:
        try:
            result = create_scheduled_backup()
            logger.info("Verified backup created: %s (%s bytes); expired archives removed: %s",
                        result["path"], result["size_bytes"], result["removed_old_backups"])
        except Exception:
            logger.exception("Scheduled SchoolBridge backup failed; the next attempt will retry.")
        time.sleep(interval * 3600)


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("SCHOOLBRIDGE_BACKUP_LOG_LEVEL", "INFO"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Create one verified backup and exit.")
    args = parser.parse_args()
    if args.once:
        result = create_scheduled_backup()
        logger.info("Verified backup created: %s (%s bytes)", result["path"], result["size_bytes"])
    else:
        run_scheduler()

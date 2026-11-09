"""Create and verify a PostgreSQL custom-format backup."""
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote

from dotenv import load_dotenv
from sqlalchemy.engine import make_url

load_dotenv()

BACKUP_PREFIX = "schoolbridge-postgres-"
BACKUP_SUFFIX = ".dump"
BACKUP_PATTERN = re.compile(r"^schoolbridge-postgres-\d{8}T\d{6}Z\.dump$")


def _connection_environment(url):
    env = os.environ.copy()
    if url.password is not None:
        env["PGPASSWORD"] = unquote(url.password)
    if url.query.get("sslmode"):
        env["PGSSLMODE"] = str(url.query["sslmode"])
    return env


def _connection_args(url):
    args = []
    if url.host:
        args.extend(["--host", url.host])
    if url.port:
        args.extend(["--port", str(url.port)])
    if url.username:
        args.extend(["--username", unquote(url.username)])
    if not url.database:
        raise ValueError("The PostgreSQL database name is missing from SCHOOLBRIDGE_DATABASE_URL.")
    return args


def prune_old_backups(directory, retention_days=30, now=None):
    """Remove only SchoolBridge backup files older than the retention window."""
    if retention_days < 1:
        raise ValueError("Backup retention must be at least one day.")
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days)
    removed = []
    for path in Path(directory).iterdir():
        if not path.is_file() or not BACKUP_PATTERN.fullmatch(path.name):
            continue
        timestamp = datetime.strptime(path.stem.removeprefix(BACKUP_PREFIX), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        if timestamp < cutoff:
            path.unlink()
            removed.append(path)
    return removed


def create_postgres_backup(database_url=None, backup_directory=None, retention_days=None, runner=None):
    """Dump PostgreSQL to a verified temporary archive, then atomically publish it."""
    from app.database import DATABASE_URL

    url = make_url(database_url or DATABASE_URL)
    if url.get_backend_name() != "postgresql":
        raise ValueError("PostgreSQL backup requires a PostgreSQL database URL.")

    directory = Path(backup_directory or os.getenv("SCHOOLBRIDGE_BACKUP_DIR", "/backups"))
    retention = int(
        retention_days if retention_days is not None
        else os.getenv("SCHOOLBRIDGE_BACKUP_RETENTION_DAYS", "30")
    )
    if retention < 1:
        raise ValueError("Backup retention must be at least one day.")
    directory.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    destination = directory / f"{BACKUP_PREFIX}{stamp}{BACKUP_SUFFIX}"
    temporary = directory / f".{destination.name}.partial"
    if destination.exists():
        raise FileExistsError("A backup already exists for this timestamp; retry shortly.")

    command = [
        "pg_dump", "--no-password", "--format=custom", "--no-owner", "--no-acl",
        "--file", str(temporary), *_connection_args(url), url.database,
    ]
    execute = runner or subprocess.run
    env = _connection_environment(url)
    try:
        execute(command, check=True, capture_output=True, text=True, env=env)
        if not temporary.is_file() or temporary.stat().st_size == 0:
            raise RuntimeError("pg_dump did not produce a non-empty backup archive.")
        execute(
            ["pg_restore", "--list", str(temporary)],
            check=True, capture_output=True, text=True, env=env,
        )
        os.chmod(temporary, 0o600)
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise

    removed = prune_old_backups(directory, retention, now)
    return {"path": str(destination), "size_bytes": destination.stat().st_size, "removed_old_backups": len(removed)}


if __name__ == "__main__":
    result = create_postgres_backup()
    print(f"Verified PostgreSQL backup: {result['path']} ({result['size_bytes']} bytes)")
    print(f"Old backups removed: {result['removed_old_backups']}")

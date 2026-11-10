"""Restore a verified PostgreSQL archive into a new, separate database."""
import argparse
import os
import re
import subprocess
from pathlib import Path

from sqlalchemy.engine import make_url

from backup_postgres import _connection_args, _connection_environment

_DATABASE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


def restore_postgres_backup(archive_path, target_database, database_url=None, runner=None):
    from app.database import DATABASE_URL

    archive = Path(archive_path)
    if not archive.is_file() or archive.stat().st_size == 0:
        raise FileNotFoundError("A non-empty PostgreSQL backup archive is required.")
    if not _DATABASE_NAME.fullmatch(target_database):
        raise ValueError("Target database name must be a simple PostgreSQL identifier.")
    url = make_url(database_url or DATABASE_URL)
    if url.get_backend_name() != "postgresql":
        raise ValueError("PostgreSQL restore requires a PostgreSQL database URL.")
    if target_database == url.database:
        raise ValueError("Restore target must be a new database, not the active production database.")

    execute = runner or subprocess.run
    env = _connection_environment(url)
    connection_args = _connection_args(url)
    execute(["pg_restore", "--list", str(archive)], check=True, capture_output=True, text=True, env=env)
    created = False
    try:
        execute(["createdb", "--no-password", *connection_args, "--owner", url.username or "", target_database],
                check=True, capture_output=True, text=True, env=env)
        created = True
        execute(["pg_restore", "--no-password", "--exit-on-error", "--no-owner", "--no-acl",
                 "--dbname", target_database, *connection_args, str(archive)],
                check=True, capture_output=True, text=True, env=env)
        validation = execute(
            ["psql", "--no-password", "--dbname", target_database, *connection_args,
             "--tuples-only", "--no-align", "-c",
             "SELECT (to_regclass('public.users') IS NOT NULL AND to_regclass('public.students') IS NOT NULL)::text"],
            check=True, capture_output=True, text=True, env=env,
        )
        if str(getattr(validation, "stdout", "")).strip().lower() != "true":
            raise RuntimeError("Restored database is missing required SchoolBridge tables.")
    except Exception:
        if created:
            try:
                execute(["dropdb", "--no-password", *connection_args, target_database],
                        check=True, capture_output=True, text=True, env=env)
            except Exception:
                pass
        raise
    return {"database": target_database, "validated": True, "source_archive": archive.name}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Restore a backup into a new PostgreSQL database without replacing the active database.")
    parser.add_argument("archive")
    parser.add_argument("target_database")
    args = parser.parse_args()
    print(restore_postgres_backup(args.archive, args.target_database))

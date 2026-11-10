"""Real PostgreSQL backup/restore integration test (enabled in CI)."""
import os
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from backup_postgres import create_postgres_backup
from restore_postgres import restore_postgres_backup


DATABASE_URL = os.getenv("SCHOOLBRIDGE_POSTGRES_INTEGRATION_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="Set SCHOOLBRIDGE_POSTGRES_INTEGRATION_URL to run the real PostgreSQL recovery drill.",
)


def test_real_postgres_backup_restores_records_into_isolated_database(tmp_path):
    source_url = make_url(DATABASE_URL)
    source_engine = create_engine(source_url)
    target_database = f"schoolbridge_restore_{uuid4().hex[:12]}"
    target_url = source_url.set(database=target_database)
    target_engine = None

    try:
        with source_engine.begin() as connection:
            connection.execute(text("DROP TABLE IF EXISTS students"))
            connection.execute(text("DROP TABLE IF EXISTS users"))
            connection.execute(text(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(80) NOT NULL)"
            ))
            connection.execute(text(
                "CREATE TABLE students (id INTEGER PRIMARY KEY, full_name VARCHAR(120) NOT NULL)"
            ))
            connection.execute(text(
                "INSERT INTO users (id, username) VALUES (1, 'restore-drill-admin')"
            ))
            connection.execute(text(
                "INSERT INTO students (id, full_name) VALUES (1, 'Restore Drill Student')"
            ))

        backup = create_postgres_backup(
            database_url=source_url.render_as_string(hide_password=False),
            backup_directory=tmp_path,
            retention_days=30,
        )
        archive = Path(backup["path"])
        assert archive.is_file() and archive.stat().st_size > 0
        assert archive.stat().st_mode & 0o777 == 0o600

        restored = restore_postgres_backup(
            archive_path=archive,
            target_database=target_database,
            database_url=source_url.render_as_string(hide_password=False),
        )
        assert restored["validated"] is True
        assert restored["database"] == target_database

        target_engine = create_engine(target_url)
        with target_engine.connect() as connection:
            assert connection.execute(
                text("SELECT username FROM users WHERE id = 1")
            ).scalar_one() == "restore-drill-admin"
            assert connection.execute(
                text("SELECT full_name FROM students WHERE id = 1")
            ).scalar_one() == "Restore Drill Student"
    finally:
        if target_engine is not None:
            target_engine.dispose()
        # Restore creates a separate database; always remove it after verification.
        from sqlalchemy import create_engine as make_engine
        admin_engine = make_engine(source_url.set(database="postgres"))
        try:
            with admin_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
                connection.execute(text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database AND pid <> pg_backend_pid()"
                ), {"database": target_database})
                connection.execute(text(f'DROP DATABASE IF EXISTS "{target_database}"'))
        finally:
            admin_engine.dispose()
            source_engine.dispose()

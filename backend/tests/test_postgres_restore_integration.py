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



def test_fresh_postgres_install_runs_owner_activation_and_school_setup(tmp_path, monkeypatch):
    import base64
    import json
    from datetime import datetime, timezone

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from fastapi.testclient import TestClient

    source_url = make_url(DATABASE_URL)
    target_database = f"schoolbridge_setup_{uuid4().hex[:12]}"
    target_url = source_url.set(database=target_database)
    restored_database = f"schoolbridge_setup_restore_{uuid4().hex[:12]}"
    admin_engine = create_engine(source_url.set(database="postgres"))
    application_engine = None
    restored_engine = None

    try:
        with admin_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(text(f'CREATE DATABASE "{target_database}"'))

        private_key = Ed25519PrivateKey.generate()
        public_key = private_key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        monkeypatch.setenv("SCHOOLBRIDGE_DATABASE_URL", target_url.render_as_string(hide_password=False))
        monkeypatch.setenv("SCHOOLBRIDGE_SECRET_KEY", "postgres-setup-test-secret-not-for-production")
        monkeypatch.setenv("SCHOOLBRIDGE_LICENSE_PUBLIC_KEY", base64.b64encode(public_key).decode("ascii"))
        monkeypatch.setenv("SCHOOLBRIDGE_SEED_DEMO_DATA", "false")

        from app.database import SessionLocal, engine
        from app.main import app

        application_engine = engine
        with TestClient(app) as client:
            status = client.get("/api/setup/status")
            assert status.status_code == 200
            installation_id = status.json()["installation_id"]
            claims = {
                "product": "SchoolBridge",
                "installation_id": installation_id,
                "license_id": "postgres-fresh-install-001",
                "issued_at": int(datetime.now(timezone.utc).timestamp()),
                "action": "activate",
            }
            payload = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode()
            encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
            license_token = "CHRISTIAN:" + encode(payload) + "." + encode(private_key.sign(payload))

            activated = client.post("/api/setup/activate", json={"license": license_token})
            assert activated.status_code == 200, activated.text
            setup = client.post("/api/setup/complete", json={
                "activation_license": license_token,
                "school_name": "PostgreSQL Integration School",
                "school_type": "Combined",
                "country": "Uganda",
                "school_structure": "Both",
                "address": "Kampala",
                "motto": "Learn and grow",
                "house_names": "Lions\\nEagles",
                "admin_username": "postgres-admin",
                "admin_email": "postgres-admin@example.invalid",
                "admin_password": "LongTestPassword123!",
            })
            assert setup.status_code == 200, setup.text
            login = client.post("/api/auth/login", data={
                "username": "postgres-admin",
                "password": "LongTestPassword123!",
            })
            assert login.status_code == 200, login.text

        with SessionLocal() as db:
            from app import models
            profile = db.get(models.SchoolProfile, 1)
            state = db.get(models.SchoolSetupState, 1)
            admin = db.query(models.User).filter_by(username="postgres-admin").one()
            identity = json.loads(state.original_identity_json)
            assert profile.name == "PostgreSQL Integration School"
            assert profile.school_type == "Combined"
            assert profile.country == "Uganda"
            assert profile.school_structure == "Both"
            assert profile.house_names == "Lions\\nEagles"
            assert state.activated_at is not None
            assert state.setup_completed_at is not None
            assert state.activation_license_hash
            assert identity["installation_id"] == installation_id
            assert admin.hashed_password != "LongTestPassword123!"
            assert db.query(models.Student).count() == 0

        backup = create_postgres_backup(
            database_url=target_url.render_as_string(hide_password=False),
            backup_directory=tmp_path / "setup-backups",
            retention_days=30,
        )
        restored = restore_postgres_backup(
            archive_path=backup["path"],
            target_database=restored_database,
            database_url=target_url.render_as_string(hide_password=False),
        )
        assert restored["validated"] is True
        restored_engine = create_engine(target_url.set(database=restored_database))
        with restored_engine.connect() as connection:
            restored_state = connection.execute(text(
                "SELECT setup_completed_at, activation_license_hash, original_identity_json "
                "FROM school_setup_state WHERE id=1"
            )).one()
            restored_profile = connection.execute(text(
                "SELECT name, school_type, house_names FROM school_profile WHERE id=1"
            )).one()
            restored_admin = connection.execute(text(
                "SELECT username FROM users WHERE username='postgres-admin'"
            )).scalar_one()
        restored_identity = json.loads(restored_state[2])
        assert restored_state[0] is not None
        assert restored_state[1]
        assert restored_identity["installation_id"] == installation_id
        assert restored_profile[0] == "PostgreSQL Integration School"
        assert restored_profile[1] == "Combined"
        assert restored_profile[2] == "Lions\\nEagles"
        assert restored_admin == "postgres-admin"
    finally:
        if application_engine is not None:
            application_engine.dispose()
        if restored_engine is not None:
            restored_engine.dispose()
        with admin_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            for database in (target_database, restored_database):
                connection.execute(text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database AND pid <> pg_backend_pid()"
                ), {"database": database})
                connection.execute(text(f'DROP DATABASE IF EXISTS "{database}"'))
        admin_engine.dispose()


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
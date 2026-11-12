import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.migrations import upgrade_database


def test_tenant_registry_is_created_for_fresh_school(tmp_path):
    database_path = tmp_path / "fresh-school.sqlite3"
    database_url = f"sqlite:///{database_path}"

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        row = connection.execute(
            "SELECT public_id, installation_id, name, status FROM school_tenants"
        ).fetchone()
    finally:
        connection.close()

    assert row is not None
    assert len(row[0]) == 36
    assert row[1] is None
    assert row[2] == "My School"
    assert row[3] == "pending_setup"


def test_tenant_registry_backfills_legacy_school_identity(tmp_path):
    database_path = tmp_path / "legacy-school.sqlite3"
    database_url = f"sqlite:///{database_path}"

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        connection.execute(
            "INSERT INTO school_profile (id, name, school_type) VALUES (1, ?, ?)",
            ("Legacy Academy", "Secondary"),
        )
        connection.execute(
            """
            INSERT INTO school_setup_state
                (id, installation_id, setup_completed_at)
            VALUES (1, ?, CURRENT_TIMESTAMP)
            """,
            ("legacy-installation-uuid",),
        )
        connection.commit()
    finally:
        connection.close()

    # Re-run the new revision against a pre-registry database to verify that
    # existing installation and school identity are preserved.
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    command.downgrade(config, "0030_optional_admission_no")
    command.upgrade(config, "head")

    connection = sqlite3.connect(database_path)
    try:
        row = connection.execute(
            "SELECT installation_id, name, status FROM school_tenants"
        ).fetchone()
    finally:
        connection.close()

    assert row == ("legacy-installation-uuid", "Legacy Academy", "active")

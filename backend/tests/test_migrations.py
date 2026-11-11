import pytest
from sqlalchemy import create_engine, inspect, insert, select

from app.database import Base
from app.migrations import upgrade_database
from app import models


@pytest.fixture(scope="module")
def migrated_database(tmp_path_factory):
    """Build the full fresh schema once for read-only migration assertions."""
    database_path = tmp_path_factory.mktemp("migrated-database") / "school.sqlite3"
    database_url = f"sqlite:///{database_path}"
    upgrade_database(database_url)
    return database_url


def test_fresh_database_is_created_and_versioned(migrated_database):
    database_url = migrated_database

    inspector = inspect(create_engine(database_url))
    tables = set(inspector.get_table_names())
    assert "alembic_version" in tables
    assert "students" in tables
    assert "fee_payments" in tables
    assert "teacher_duties" in tables
    assert "verified" in {column["name"] for column in inspector.get_columns("marks")}
    assert "staff_attendance" in tables
    assert "timetable_entries" in tables
    assert "school_setup_state" in tables
    assert "school_identity_corrections" in tables


def test_baseline_adds_missing_tables_without_losing_existing_records(tmp_path):
    database_path = tmp_path / "existing-school.sqlite3"
    database_url = f"sqlite:///{database_path}"
    engine = create_engine(database_url)
    classes = Base.metadata.tables["classes"]

    # Simulate a school database that already has real records but has never
    # been enrolled in Alembic's version tracking.
    classes.create(bind=engine)
    with engine.begin() as connection:
        connection.execute(
            insert(classes).values(name="Primary 1", section="East")
        )

    upgrade_database(database_url)
    # Running the migration command again must be safe and idempotent.
    upgrade_database(database_url)

    with engine.connect() as connection:
        rows = connection.execute(
            select(classes.c.name, classes.c.section)
        ).all()

    tables = set(inspect(engine).get_table_names())
    engine.dispose()

    assert rows == [("Primary 1", "East")]
    assert "students" in tables
    assert "fee_charges" in tables
    assert "alembic_version" in tables



def test_existing_database_is_backed_up_before_pending_migrations(tmp_path):
    import sqlite3

    database_path = tmp_path / "legacy-school.sqlite3"
    database_url = f"sqlite:///{database_path}"
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("CREATE TABLE legacy_records (value TEXT NOT NULL)")
        connection.execute("INSERT INTO legacy_records(value) VALUES ('keep-me')")
        connection.commit()
    finally:
        connection.close()

    upgrade_database(database_url)

    backups = list(tmp_path.glob("legacy-school.sqlite3.pre_migration_*.bak"))
    assert len(backups) == 1
    backup = sqlite3.connect(backups[0])
    try:
        assert backup.execute("SELECT value FROM legacy_records").fetchone() == ("keep-me",)
        assert "alembic_version" not in {
            row[0] for row in backup.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
    finally:
        backup.close()


def test_current_database_does_not_create_redundant_migration_backup(tmp_path):
    database_path = tmp_path / "current-school.sqlite3"
    database_url = f"sqlite:///{database_path}"
    upgrade_database(database_url)

    upgrade_database(database_url)

    assert list(tmp_path.glob("current-school.sqlite3.pre_migration_*.bak")) == []


def test_fresh_database_includes_user_scoped_sync_device_registry(migrated_database):
    database_url = migrated_database

    engine = create_engine(database_url)
    inspector = inspect(engine)
    assert "sync_devices" in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns("sync_devices")}
    assert {
        "id", "user_id", "device_id", "device_name",
        "created_at", "last_seen_at", "revoked_at",
    }.issubset(columns)
    unique_constraints = inspector.get_unique_constraints("sync_devices")
    assert any(
        set(item["column_names"]) == {"user_id", "device_id"}
        for item in unique_constraints
    )
    engine.dispose()



def test_fresh_database_includes_sync_change_journal(migrated_database):
    database_url = migrated_database

    engine = create_engine(database_url)
    inspector = inspect(engine)
    assert "sync_changes" in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns("sync_changes")}
    assert {"id", "entity_type", "entity_id", "operation", "changed_at"}.issubset(columns)
    engine.dispose()



def test_sync_device_checkpoint_column_is_migrated(migrated_database):
    database_url = migrated_database

    engine = create_engine(database_url)
    columns = {column["name"] for column in inspect(engine).get_columns("sync_devices")}
    assert {"last_sync_sequence", "last_issued_sequence"}.issubset(columns)
    engine.dispose()


def test_sync_change_proposals_migration(migrated_database):
    url = migrated_database
    engine=create_engine(url)
    inspector=inspect(engine)
    assert "sync_change_proposals" in inspector.get_table_names()
    cols={c["name"] for c in inspector.get_columns("sync_change_proposals")}
    assert {"user_id","device_id","idempotency_key","entity_type","entity_id","operation","payload_json","base_sequence","status","conflict_sequence","submitted_at","resolved_at","resolution"}.issubset(cols)
    engine.dispose()



def test_sync_change_journal_migrates_historical_scope_column(migrated_database):
    url = migrated_database
    engine = create_engine(url)
    columns = {item["name"] for item in inspect(engine).get_columns("sync_changes")}
    assert "scope_json" in columns
    engine.dispose()



def test_legacy_school_with_users_is_grandfathered_by_setup_migration(tmp_path):
    import json
    import sqlite3

    database_path = tmp_path / "legacy-active-school.sqlite3"
    database_url = f"sqlite:///{database_path}"
    connection = sqlite3.connect(database_path)
    try:
        # Model an older deployed schema so forward migrations, rather than
        # create_all, add the newer user and profile columns.
        connection.execute("""
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username VARCHAR(80) NOT NULL UNIQUE,
                email VARCHAR(150) NOT NULL UNIQUE,
                hashed_password VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL DEFAULT 'teacher',
                is_active BOOLEAN NOT NULL DEFAULT 1
            )
        """)
        connection.execute("""
            CREATE TABLE school_profile (
                id INTEGER PRIMARY KEY,
                name VARCHAR(160) NOT NULL,
                address VARCHAR(255),
                phone VARCHAR(40),
                email VARCHAR(150),
                motto VARCHAR(200),
                school_type VARCHAR(20) NOT NULL DEFAULT 'Secondary'
            )
        """)
        connection.execute(
            "INSERT INTO users (id, username, email, hashed_password, role, is_active) VALUES (1, ?, ?, ?, ?, 1)",
            ("legacy-admin", "legacy-admin@example.invalid", "existing-password-hash", "admin"),
        )
        connection.execute(
            "INSERT INTO school_profile (id, name, school_type) VALUES (1, ?, ?)",
            ("Legacy Academy", "Secondary"),
        )
        connection.commit()
    finally:
        connection.close()

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        state = connection.execute(
            "SELECT installation_id, activated_at, setup_completed_at, activation_license_hash, original_identity_json FROM school_setup_state WHERE id=1"
        ).fetchone()
        existing_user = connection.execute(
            "SELECT username FROM users WHERE id=1"
        ).fetchone()[0]
    finally:
        connection.close()

    import uuid
    identity = json.loads(state[4])
    assert existing_user == "legacy-admin"
    assert str(uuid.UUID(state[0])) == state[0]
    assert identity["installation_id"] == state[0]
    assert state[1] is not None
    assert state[2] is not None
    assert state[3] is None
    assert identity["school_name"] == "Legacy Academy"
    assert identity["school_type"] == "Secondary"
    assert identity["country"] is None
    assert identity["school_structure"] is None



def test_legacy_school_profile_without_users_is_grandfathered(tmp_path):
    import sqlite3

    database_path = tmp_path / "legacy-profile-only.sqlite3"
    database_url = f"sqlite:///{database_path}"
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("""
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username VARCHAR(80) NOT NULL UNIQUE,
                email VARCHAR(150) NOT NULL UNIQUE,
                hashed_password VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL DEFAULT 'teacher',
                is_active BOOLEAN NOT NULL DEFAULT 1
            )
        """)
        connection.execute("""
            CREATE TABLE school_profile (
                id INTEGER PRIMARY KEY,
                name VARCHAR(160) NOT NULL,
                school_type VARCHAR(20) NOT NULL DEFAULT 'Secondary'
            )
        """)
        connection.execute(
            "INSERT INTO school_profile (id, name, school_type) VALUES (1, ?, ?)",
            ("Configured School Without Accounts", "Primary"),
        )
        connection.commit()
    finally:
        connection.close()

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        state = connection.execute(
            "SELECT activated_at, setup_completed_at, original_identity_json FROM school_setup_state WHERE id=1"
        ).fetchone()
    finally:
        connection.close()

    assert state[0] is not None
    assert state[1] is not None
    assert "Configured School Without Accounts" in state[2]



def test_partial_school_setup_state_table_gets_missing_activation_columns(tmp_path):
    import sqlite3

    database_path = tmp_path / "partial-school-setup.sqlite3"
    database_url = f"sqlite:///{database_path}"
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("""
            CREATE TABLE school_setup_state (
                id INTEGER PRIMARY KEY,
                installation_id VARCHAR(36) NOT NULL UNIQUE,
                activated_at DATETIME,
                activation_license_hash VARCHAR(64),
                activation_locked_until DATETIME,
                setup_completed_at DATETIME,
                original_identity_json TEXT
            )
        """)
        connection.execute(
            "INSERT INTO school_setup_state (id, installation_id) VALUES (1, ?)",
            ("existing-installation-id",),
        )
        connection.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        connection.execute(
            "INSERT INTO alembic_version (version_num) VALUES (?)",
            ("0025_first_school_setup",),
        )
        connection.commit()
    finally:
        connection.close()

    upgrade_database(database_url)

    connection = sqlite3.connect(database_path)
    try:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(school_setup_state)")
        }
        attempts = connection.execute(
            "SELECT activation_attempts FROM school_setup_state WHERE id=1"
        ).fetchone()[0]
        installation_id = connection.execute(
            "SELECT installation_id FROM school_setup_state WHERE id=1"
        ).fetchone()[0]
        revision = connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone()[0]
    finally:
        connection.close()

    assert "activation_attempts" in columns
    assert "activation_locked_until" in columns
    assert attempts == 0
    assert installation_id == "existing-installation-id"
    assert revision == "0026_repair_school_setup_state"


def test_user_session_version_column_is_migrated(migrated_database):
    engine = create_engine(migrated_database)
    columns = {item["name"]: item for item in inspect(engine).get_columns("users")}
    engine.dispose()
    assert "token_version" in columns
    assert columns["token_version"]["nullable"] is False
    assert columns["token_version"]["default"] in {"0", "'0'"}

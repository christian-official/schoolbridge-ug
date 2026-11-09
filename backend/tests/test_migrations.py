from sqlalchemy import create_engine, inspect, insert, select

from app.database import Base
from app.migrations import upgrade_database


def test_fresh_database_is_created_and_versioned(tmp_path):
    database_path = tmp_path / "fresh-school.sqlite3"
    database_url = f"sqlite:///{database_path}"

    upgrade_database(database_url)

    inspector = inspect(create_engine(database_url))
    tables = set(inspector.get_table_names())
    assert "alembic_version" in tables
    assert "students" in tables
    assert "fee_payments" in tables
    assert "teacher_duties" in tables
    assert "verified" in {column["name"] for column in inspector.get_columns("marks")}
    assert "staff_attendance" in tables
    assert "timetable_entries" in tables


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


def test_fresh_database_includes_user_scoped_sync_device_registry(tmp_path):
    database_path = tmp_path / "sync-devices.sqlite3"
    database_url = f"sqlite:///{database_path}"

    upgrade_database(database_url)

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



def test_fresh_database_includes_sync_change_journal(tmp_path):
    database_path = tmp_path / "sync-changes.sqlite3"
    database_url = f"sqlite:///{database_path}"
    upgrade_database(database_url)

    engine = create_engine(database_url)
    inspector = inspect(engine)
    assert "sync_changes" in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns("sync_changes")}
    assert {"id", "entity_type", "entity_id", "operation", "changed_at"}.issubset(columns)
    engine.dispose()



def test_sync_device_checkpoint_column_is_migrated(tmp_path):
    database_path = tmp_path / "sync-device-checkpoint.sqlite3"
    database_url = f"sqlite:///{database_path}"
    upgrade_database(database_url)

    engine = create_engine(database_url)
    columns = {column["name"] for column in inspect(engine).get_columns("sync_devices")}
    assert {"last_sync_sequence", "last_issued_sequence"}.issubset(columns)
    engine.dispose()


def test_sync_change_proposals_migration(tmp_path):
    url=f"sqlite:///{tmp_path / 'sync-proposals.sqlite3'}"
    upgrade_database(url)
    engine=create_engine(url)
    inspector=inspect(engine)
    assert "sync_change_proposals" in inspector.get_table_names()
    cols={c["name"] for c in inspector.get_columns("sync_change_proposals")}
    assert {"user_id","device_id","idempotency_key","entity_type","entity_id","operation","payload_json","base_sequence","status","conflict_sequence","submitted_at","resolved_at","resolution"}.issubset(cols)
    engine.dispose()

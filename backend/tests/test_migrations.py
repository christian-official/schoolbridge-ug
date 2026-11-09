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

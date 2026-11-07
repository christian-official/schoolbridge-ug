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

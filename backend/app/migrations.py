"""Database migration entry point with automatic SQLite pre-migration snapshots."""
import os
from pathlib import Path
from time import time_ns

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from .database import create_sqlite_backup


def _backup_sqlite_before_migration(database_url: str, config: Config) -> str | None:
    """Snapshot an existing SQLite file before applying any pending migration."""
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        return None

    database_path = os.path.abspath(url.database)
    if not os.path.isfile(database_path):
        return None

    script = ScriptDirectory.from_config(config)
    expected_revisions = set(script.get_heads())
    migration_engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with migration_engine.connect() as connection:
            current_revisions = set(MigrationContext.configure(connection).get_current_heads())
    finally:
        migration_engine.dispose()

    if current_revisions == expected_revisions:
        return None

    backup_path = database_path + ".pre_migration_" + str(time_ns()) + ".bak"
    create_sqlite_backup(database_path, backup_path)
    return backup_path


def upgrade_database(database_url: str | None = None) -> None:
    """Apply pending migrations, preserving an existing SQLite snapshot first."""
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    if database_url:
        # Alembic's ConfigParser treats percent signs as interpolation markers.
        config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    effective_url = database_url or config.get_main_option("sqlalchemy.url")
    _backup_sqlite_before_migration(effective_url, config)
    command.upgrade(config, "head")

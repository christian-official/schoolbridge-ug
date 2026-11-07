"""Database migration entry point used by SchoolBridge startup and tests."""
from pathlib import Path

from alembic import command
from alembic.config import Config


def upgrade_database(database_url: str | None = None) -> None:
    """Apply pending migrations without recreating or dropping existing tables."""
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    if database_url:
        # Alembic's ConfigParser treats percent signs as interpolation markers.
        config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(config, "head")

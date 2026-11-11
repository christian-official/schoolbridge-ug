"""Persistent per-user database location for the installed desktop application."""
import os
from pathlib import Path

from sqlalchemy.engine import URL


def configure_desktop_database() -> Path | None:
    """Point desktop builds at LOCALAPPDATA; leave server/dev configuration untouched."""
    configured_directory = os.getenv("SCHOOLBRIDGE_DATA_DIR")
    if not configured_directory:
        return None

    data_directory = Path(configured_directory).expanduser()
    data_directory.mkdir(parents=True, exist_ok=True)
    database_path = (data_directory / "schoolbridge.sqlite3").resolve()
    database_location = str(database_path)
    if os.name == "nt":
        database_location = database_location.replace("\\", "/")
    os.environ["SCHOOLBRIDGE_DATABASE_URL"] = URL.create(
        "sqlite", database=database_location
    ).render_as_string(hide_password=False)
    return database_path

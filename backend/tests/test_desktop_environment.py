import ast
from pathlib import Path

import os

from sqlalchemy.engine import make_url

from app.desktop_storage import configure_desktop_database


def test_desktop_database_is_created_under_the_per_user_data_directory(tmp_path, monkeypatch):
    data_directory = tmp_path / "SchoolBridge" / "data"
    monkeypatch.setenv("SCHOOLBRIDGE_DATA_DIR", str(data_directory))
    monkeypatch.setenv("SCHOOLBRIDGE_DATABASE_URL", "sqlite:///./usb-install/schoolbridge.db")

    database_path = configure_desktop_database()

    assert database_path == (data_directory / "schoolbridge.sqlite3").resolve()
    assert data_directory.is_dir()
    assert Path(database_path).parent == data_directory.resolve()
    configured_url = make_url(os.environ["SCHOOLBRIDGE_DATABASE_URL"])
    assert configured_url.database.replace("\\", "/") == str(database_path).replace("\\", "/")
    assert not Path("usb-install/schoolbridge.db").exists()


def test_non_desktop_configuration_is_left_unchanged(monkeypatch):
    monkeypatch.delenv("SCHOOLBRIDGE_DATA_DIR", raising=False)
    monkeypatch.setenv("SCHOOLBRIDGE_DATABASE_URL", "sqlite:///./development.db")

    assert configure_desktop_database() is None
    assert os.environ["SCHOOLBRIDGE_DATABASE_URL"] == "sqlite:///./development.db"


def test_dotenv_and_desktop_database_are_configured_before_database_module_import():
    main_path = Path(__file__).parents[1] / "app" / "main.py"
    module = ast.parse(main_path.read_text(encoding="utf-8"))

    dotenv_call = next(
        index for index, node in enumerate(module.body)
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "load_dotenv"
    )
    desktop_storage_call = next(
        index for index, node in enumerate(module.body)
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "configure_desktop_database"
    )
    database_import = next(
        index for index, node in enumerate(module.body)
        if isinstance(node, ast.ImportFrom) and node.module == "database"
        and node.level == 1
    )

    assert dotenv_call < desktop_storage_call < database_import, (
        "Load .env and select the per-user desktop database before importing app.database"
    )

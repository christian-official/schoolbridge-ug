import ast
from pathlib import Path


def test_dotenv_is_loaded_before_database_module_import():
    """The desktop .env selects the persistent data/ SQLite path at import time."""
    main_path = Path(__file__).parents[1] / "app" / "main.py"
    module = ast.parse(main_path.read_text(encoding="utf-8"))

    dotenv_call = next(
        index for index, node in enumerate(module.body)
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "load_dotenv"
    )
    database_import = next(
        index for index, node in enumerate(module.body)
        if isinstance(node, ast.ImportFrom) and node.module == "database"
        and node.level == 1
    )

    assert dotenv_call < database_import, (
        "load_dotenv() must run before app.database captures SCHOOLBRIDGE_DATABASE_URL"
    )

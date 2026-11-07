# SchoolBridge backend

## Run locally

From the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8001
```

On Windows PowerShell, activate with:

```powershell
.venv\Scripts\Activate.ps1
```

Health check: `/api/health`

Interactive API documentation: `/docs`

## Database migrations

SchoolBridge applies pending Alembic migrations automatically when the backend
starts. The first baseline migration creates tables that are missing from an
existing database and records the migration version. It does not drop existing
tables or rewrite existing records.

**Back up the school's database before deploying any application update.**
The baseline is intentionally not reversible because an automatic downgrade
could destroy school data. Future schema changes must use reviewed,
forward-only migration files.

To create a migration after changing SQLAlchemy models, run from the repository
root:

```bash
PYTHONPATH=backend alembic -c backend/alembic.ini revision --autogenerate -m "describe the schema change"
```

Review the generated migration carefully before committing it. Apply pending
migrations manually when needed with:

```bash
PYTHONPATH=backend alembic -c backend/alembic.ini upgrade head
```

On Windows PowerShell, set the import path for the command session first:

```powershell
$env:PYTHONPATH = "backend"
alembic -c backend/alembic.ini upgrade head
```

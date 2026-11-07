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

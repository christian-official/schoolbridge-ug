# Desktop backend lifecycle

The desktop executable and native backend package are installed side by side in one
installation directory. The required layout is:

- `SchoolBridge.exe`
- `run-native-windows.ps1` (retained for the standalone native launcher)
- `runtime/python.exe`
- `backend/app/` and `backend/app/static/`
- `.env`

The Tauri application starts the bundled Python runtime directly. It does not
launch a browser or invoke the PowerShell browser launcher. The backend binds
only to `127.0.0.1`, uses the configured `SCHOOLBRIDGE_PORT` (default 8080),
and must answer the existing `/api/health` endpoint before desktop startup
continues.

The desktop process owns the backend child process. On Windows, the child is
assigned to a Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`,
so the backend cannot remain running if the desktop process terminates
unexpectedly. Normal application exit also terminates and reaps the child.
The backend log is written to
`%LOCALAPPDATA%\SchoolBridge\logs\backend.log`.

The manager refuses to attach to an unrelated process already listening on the
configured port. It never binds the backend to a LAN interface; local-network
access is a separate, explicitly secured project task.

This lifecycle foundation does not by itself package the runtime, configure
frontend API routing, or establish Windows 8/8.1 compatibility. Those remain
separate delivery and validation requirements.

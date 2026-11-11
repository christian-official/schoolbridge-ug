# Desktop frontend-to-backend connection

The packaged Windows desktop app uses a fixed local API endpoint:
`http://127.0.0.1:8080`. The Tauri v2 Windows WebView identifies its
application origin as `http://tauri.localhost`; desktop development uses
`http://localhost:5173`.

The frontend detects the Tauri runtime and selects the loopback API before
considering any hosted API build setting. Login, password recovery, setup,
health checks, backups and the shared authenticated API helper all use the
same resolved API base URL.

The desktop lifecycle manager requires `SCHOOLBRIDGE_PORT=8080` and starts
Uvicorn on `127.0.0.1` only. It overrides the backend CORS allowlist for that
process with only the packaged Tauri origin and the loopback Vite development
origin. Credentials are not enabled for cross-origin requests. This override
is process-scoped: it does not change CORS policy for the hosted service or
the standalone native LAN launcher.

A port already owned by another process is rejected by the lifecycle manager;
the desktop app never attaches to an unrelated local server. The browser/PWA
deployment keeps its existing API-origin resolution.

This task connects the desktop frontend to the managed backend. It does not
yet package the Python runtime/database, implement the final offline storage
experience, or establish Windows 8/8.1 compatibility.

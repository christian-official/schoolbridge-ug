# Desktop backend lifecycle

The Tauri installer places the desktop executable and immutable backend/Python
resources in the application installation. The backend and runtime are resolved
from Tauri's resource directory, not by assuming that the executable's parent
directory is writable or contains the resources.

The packaged resource layout is:

- `SchoolBridge.exe`
- `runtime/python.exe` and its provisioned `Lib/site-packages`
- `backend/app/`, `backend/migrations/`, and `backend/app/static/`

Mutable files are stored separately under the current Windows user's
`%LOCALAPPDATA%\\SchoolBridge` directory:

- `config/.env` — persistent application configuration and generated secret
- `data/schoolbridge.sqlite3` — local school database
- `logs/backend.log` — backend diagnostics

The app creates the configuration on first launch and passes its exact path to
the backend as `SCHOOLBRIDGE_CONFIG_FILE`. The backend loads it before importing
the database module. Application upgrades must preserve this per-user directory.

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
configured loopback port. The loopback backend remains bound only to
`127.0.0.1`; optional school-network access uses the separate HTTPS LAN listener
described below.

This lifecycle foundation does not by itself package the runtime, configure
frontend API routing, or establish Windows 8/8.1 compatibility. Those remain
separate delivery and validation requirements.


## Optional school Wi-Fi access (HTTPS only)

The normal desktop backend remains bound to `127.0.0.1:8080`. LAN access is
disabled unless `.env` explicitly enables a second listener. When enabled,
the desktop manager starts a separate Uvicorn process bound only to the
configured private Wi-Fi IPv4 address and HTTPS port (default `8443`). Both
listeners use the same per-user SQLite database and are owned by the desktop
process; closing SchoolBridge stops both.

Example configuration (replace the address and certificate paths with values
issued for the school's network):

```dotenv
SCHOOLBRIDGE_LAN_ENABLED=true
SCHOOLBRIDGE_LAN_BIND_IP=192.168.1.20
SCHOOLBRIDGE_LAN_PORT=8443
SCHOOLBRIDGE_LAN_CERT_FILE=C:\\Users\\SchoolAdmin\\AppData\\Local\\SchoolBridge\\certs\\lan-cert.pem
SCHOOLBRIDGE_LAN_KEY_FILE=C:\\Users\\SchoolAdmin\\AppData\\Local\\SchoolBridge\\certs\\lan-key.pem
```

The bind address must be a private, non-loopback IPv4 address. Certificate and
key paths must be separate existing absolute paths. The certificate must
contain the configured IP address as an IP Subject Alternative Name (SAN), and
its issuing CA must be trusted by each authorised phone/computer. Keep the
private key on the host computer, outside the USB installation, and restrict
its Windows file permissions. SchoolBridge does not generate certificates or
install trust on client devices automatically.

The LAN listener uses an exact HTTPS CORS origin and a Host-header allow-list
for the configured IP. It does not open Windows Firewall rules. An administrator
must permit the selected TCP port only on the Windows **Private** network
profile and restrict the rule to the school's trusted local subnet. Do not
enable this on public Wi-Fi, guest networks, or internet-facing interfaces.

Clients open `https://192.168.1.20:8443` (using the configured address).
They still need valid SchoolBridge credentials; API requests retain token-version,
role, permission, and registered-device checks. The SQLite database is never
shared as a network file. This is single-host application access over HTTPS,
not multi-host database deployment.

If LAN configuration is incomplete, invalid, or points to a non-private address,
desktop startup fails closed rather than silently starting an insecure HTTP
listener. With `SCHOOLBRIDGE_LAN_ENABLED=false` (the default), only the normal
loopback backend starts.

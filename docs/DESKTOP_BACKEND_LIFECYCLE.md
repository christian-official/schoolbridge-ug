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

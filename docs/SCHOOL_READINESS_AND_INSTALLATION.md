# SchoolBridge school readiness and first installation

## Agreed architecture

SchoolBridge is local-first. Each school has its own local database, and its frontend/backend run on the school's computer. Render is a preview/development service only. Internet is not required for ordinary local operations.

A school can operate on one standalone computer with no internet, router, Wi-Fi or LAN. A local network is optional and is needed only if additional devices must connect to the host. The database remains on the host computer's local disk; client devices never connect directly to the database.

## Honest release status

Two Windows installation paths exist and must not be confused:

1. **Docker-free native Windows package:** bundles CPython 3.12, the application, frontend and offline dependency wheels; uses local SQLite. CI run [#934](https://github.com/christian-official/schoolbridge-ug/actions/runs/42998487404) passed all seven jobs, including installation and boot on a Windows Server 2022 runner. This verifies the automated package path, but does not replace acceptance on a clean physical Windows 10 22H2 or Windows 11 23H2+ computer.
2. **Docker/WSL2 USB package:** uses Docker Desktop, WSL2 and PostgreSQL. It is a separate route and still needs its own clean-machine acceptance.

The native package currently supports a single-computer loopback host only. LAN hosting, automatic upgrades, unattended service recovery and installer signing are not included. The service worker caches the application shell only; offline record access and writes across every module are not implemented.

## 1. Choose and prepare the host

For the Docker-free route, use a 64-bit Windows 10 22H2 or Windows 11 23H2-or-newer computer. The installer bundles Python and backend dependencies; Docker, WSL2, Node.js and a preinstalled Python are not required on the school computer.

Download the `SchoolBridge-Native-Windows` artifact from a successful [SchoolBridge CI workflow run](https://github.com/christian-official/schoolbridge-ug/actions/workflows/ci.yml). Open the run, scroll to **Artifacts**, and download the native Windows package. The artifact is temporary and must be retained securely by the release owner.

For the separate Docker/WSL2 route, follow [USB installation](USB_INSTALLATION.md) and [Windows runtime preparation](WINDOWS_RUNTIME_PREPARATION.md). That route has additional Docker Desktop, WSL2, virtualization and licensing requirements.

## 2. Information to collect from the school

Confirm with an authorised school representative:

**Required by the first-school setup**
- Official school name.
- School type: Primary, Secondary or Combined.
- School structure: Day, Boarding or Both.
- Country.
- First administrator username, email and password (at least 12 characters).

**Optional**
- Physical address, official telephone, school email, motto, logo (PNG/JPEG/WebP under 1.4 MB), and house names.

**Prepare for later configuration**
- Academic year and terms; classes, streams and subjects; staff/student registers; admission numbers; fees and opening balances; parent/guardian contacts and consent procedures.

Do not put real student data in development/test environments or send it through chat. Test imports with synthetic data first.

## 3. Install the native package

1. Copy the complete extracted package to a local folder on the school computer; do not run it from the USB drive.
2. Open an elevated PowerShell window in that package folder.
3. Run `./install-native-windows.ps1`.
4. When prompted, enter the owner's **Base64 Ed25519 public verification key**. This is public material; never enter or copy the private signing key or its passphrase.
5. After installation, start **SchoolBridge** from the Windows Start Menu shortcut.
6. Open the local address shown by the launcher (default: `http://127.0.0.1:8080`).

The installer stores the application under `%ProgramData%\SchoolBridge` and the SQLite database under `%ProgramData%\SchoolBridge\data`. The native host binds to loopback; other computers cannot connect to it.

The installer deliberately refuses to replace an existing installation directory. Do not delete or overwrite an existing installation to perform an upgrade; a tested in-place upgrade procedure is not yet available.

## 4. Owner verification and first-school setup

Owner verification is performed by the software owner on a trusted computer using the local SchoolBridge owner-license utility. The school browser displays a unique installation ID and accepts the signed activation code. The private signing key and passphrase never go to the school host, GitHub, Render or school staff.

1. Generate the owner keypair once on the trusted owner computer following [CHRISTIAN Owner Key provisioning](CHRISTIAN_OWNER_KEY.md).
2. Keep the encrypted private key and passphrase secure and separate; retain an offline backup.
3. Configure only the Base64 public key in the school's local `.env` as `SCHOOLBRIDGE_LICENSE_PUBLIC_KEY`.
4. At the school, copy the unique installation ID from the first-time setup page.
5. On the trusted owner computer, sign that exact ID. The resulting activation code begins `CHRISTIAN:`.
6. Paste the code into the school's activation page and complete the school's first-time setup, including creation of its first administrator.

The first school administrator is separate from the software owner's signing authority. Never share the private key or passphrase.

## 5. Backups and handover

Before handover, verify owner activation, school setup, administrator login, student/staff record creation, database persistence after restart, a successful backup and a tested restore. Test the required workflows with internet disconnected. Use synthetic data until the school has accepted the installation.

For the native package, stop SchoolBridge before making a manual copy of the `data` directory and retain the complete backup on a separate, protected drive. The database uses SQLite WAL mode; copying only the main database file while the application is running may omit committed WAL data. Prefer the application's verified backup function where available.

Do not declare production readiness until clean-machine Windows 10/11 installation and the required school workflow, restart, backup and restore acceptance tests pass.

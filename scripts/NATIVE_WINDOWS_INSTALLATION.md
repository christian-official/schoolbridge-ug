# SchoolBridge native Windows package

This package runs SchoolBridge directly on a 64-bit Windows computer using bundled CPython 3.12 and local SQLite. The school computer does not need Docker, WSL2, Node.js, a preinstalled Python, or internet access.

## Download the package

The package is published as the `SchoolBridge-Native-Windows` artifact by the [SchoolBridge CI workflow](https://github.com/christian-official/schoolbridge-ug/actions/workflows/ci.yml). Open successful run [#937](https://github.com/christian-official/schoolbridge-ug/actions/runs/43000294374), scroll to **Artifacts**, and download `SchoolBridge-Native-Windows`. This run passed all seven CI jobs. GitHub artifacts expire; keep an approved release copy in the project's controlled release storage.

The package is built and smoke-tested on a Windows Server 2022 runner. A clean physical Windows 10/11 acceptance test is still required before school deployment.

## Installation

1. Use a 64-bit Windows 10 22H2 or Windows 11 23H2-or-newer host.
2. Extract the complete package to a local folder on that computer. Do not install from the USB drive.
3. Open PowerShell **as Administrator** in the extracted package folder.
4. Run `./install-native-windows.ps1`.
5. When prompted, enter the owner's Base64 Ed25519 **public** verification key. Never put the private signing key or passphrase on the school computer.
6. Start **SchoolBridge** from the Windows Start Menu shortcut.
7. Open `http://127.0.0.1:8080` (or the configured local port), complete owner activation and create the school's first administrator.

The application is installed under `%ProgramData%\SchoolBridge`; the SQLite database is stored under `%ProgramData%\SchoolBridge\data`. The host binds to loopback only, so this first version is for one computer and does not provide LAN access.

## Data safety and limitations

- The installer verifies the package's SHA-256 manifest and installs dependencies only from its bundled wheelhouse.
- It creates a random application secret and a local SQLite database.
- It refuses to overwrite an existing `%ProgramData%\SchoolBridge` directory. There is no tested in-place upgrade path yet.
- Back up the school's data before moving, replacing or repairing an installation. Prefer the application's verified backup function; do not copy only the main SQLite file while SchoolBridge is running because WAL data may be present.
- This first iteration does not provide unattended service recovery, automatic upgrades, LAN hosting or a signed installer.
- Windows 8 and 8.1 are not certified by this package.

The CI install-and-boot job is useful evidence, but it is not the final school acceptance test. Before deployment, test on a clean Windows 10/11 computer: owner activation, first-school setup, administrator login, key school workflows, restart persistence, backup and restore.

# SchoolBridge native Windows package

This package runs SchoolBridge directly on a 64-bit Windows computer using bundled CPython 3.12 and local SQLite. The school computer does not need Docker, WSL2, Node.js, a preinstalled Python, or internet access.

## Preparation and installation

1. On an internet-connected preparation computer, stage the official 64-bit CPython 3.12 embeddable ZIP and official get-pip.py.
2. Run prepare-native-windows.ps1 with the two staged file paths. It builds the frontend and resolves binary Windows wheels into an offline wheelhouse.
3. Copy the complete SchoolBridge-Native-Windows package to USB.
4. On the school computer, open elevated PowerShell in the package folder and run install-native-windows.ps1.
5. Start SchoolBridge using the Start Menu shortcut and open http://127.0.0.1:8080.

The initial native package is a single-computer host and binds to loopback only. It does not expose the database or enable LAN access. Its initial host target is 64-bit Windows 10/11.

## Release limits

This is not a certification of Windows 8/8.1. Those systems remain unsupported pending separate runtime, browser, security and clean-machine acceptance. This first iteration does not yet provide unattended service recovery, automatic upgrades, LAN hosting, or a signed installer.

The installer verifies the SHA-256 manifest and installs dependencies only from the bundled wheelhouse. It creates random application secrets and stores SQLite under the installation directory. Back up the data directory before replacing or moving an installation.
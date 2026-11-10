# Preparing the Windows runtime for an offline school installation

## What is included in the USB package

Run `scripts/prepare-usb.ps1` on the online preparation computer. The script downloads the official Docker Desktop Windows x64 installer and the latest stable Microsoft WSL x64 MSI when they are not already staged in the repository's `runtime` folder. It checks both installers' Authenticode signatures and expected publishers before packaging them.

The preparation computer must have PowerShell, Docker Engine/Desktop and Compose v2 available and running. It pulls PostgreSQL, builds the SchoolBridge backend and frontend images, exports those images, and copies the runtime installers and installation guides into `dist/SchoolBridge-USB`. It creates `SHA256SUMS.txt` for the package files.

Do not place the owner's private signing key or passphrase in the repository or USB package. Only the public verification key is entered into the school's local configuration.

## School computer readiness

The school computer needs supported 64-bit Windows 10 22H2 or Windows 11 23H2 or later, at least 8 GB RAM, hardware virtualization enabled, WSL 2.1.5 or later, and a compatible Docker Desktop installation. These are the current project preflight baselines; check Docker and Microsoft requirements before deployment because vendor requirements can change.

From an elevated PowerShell window in the USB package folder, run:

```powershell
.\prepare-school-host.ps1
```

The script enables Windows Subsystem for Linux and Virtual Machine Platform, installs the staged WSL MSI if the required WSL version is not ready, and launches the official Docker Desktop installer when Docker Desktop is not installed in its expected machine-wide location. The authorised school operator must complete Docker's interactive setup and accept its licence terms. Restart Windows if requested, open Docker Desktop, and wait for its engine to become ready.

Then run:

```powershell
.\check-school-host.ps1
```

Every preflight check must pass before installing SchoolBridge. If Docker is already installed but the preflight cannot find its CLI or engine, resolve that host setup issue before continuing.

## Network requirements

No internet or LAN is required to install or run SchoolBridge on one computer once the local Windows runtime is ready and all application/database images are on the USB. The runtime installers and image archive are staged in advance.

A local router, Wi-Fi hotspot or wired LAN is optional and is needed only when additional devices must connect to the host computer. Internet is not required for that local connection.

## Licensing and support boundary

Docker Desktop terms must be reviewed and accepted by the authorised school/host operator. The preparation and installation scripts do not silently accept third-party licence terms. Confirm Docker Desktop licensing suitability for each deploying organisation. If Docker Desktop is unsuitable, a different supported local runtime must be implemented and tested before promising installation on that computer.

## Official references

- [Docker Desktop for Windows: system requirements and installation](https://docs.docker.com/desktop/setup/install/windows-install/)
- [Docker Desktop offline use FAQ](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/general/)
- [Docker Desktop WSL 2 backend requirements](https://docs.docker.com/desktop/features/wsl/)
- [Microsoft WSL releases](https://github.com/microsoft/WSL/releases)

# Preparing the Windows runtime for an offline school installation

## What is included in the USB package

Run `scripts/prepare-usb.ps1` on the online preparation computer. The script downloads the official Docker Desktop Windows x64 installer and the latest stable Microsoft WSL x64 MSI when they are not already staged in the repository's `runtime` folder. It checks both installers' Authenticode signatures and expected publishers before packaging them.

The preparation computer must have PowerShell, Docker Engine/Desktop and Compose v2 available and running. It pulls PostgreSQL, builds the SchoolBridge backend and frontend images, exports those images, and copies the runtime installers and installation guides into `dist/SchoolBridge-USB`. It creates `SHA256SUMS.txt` for the package files.

Do not place the owner's private signing key or passphrase in the repository or USB package. Only the public verification key is entered into the school's local configuration.

## School computer readiness

The school computer needs a currently supported 64-bit Windows release that Docker Desktop supports, at least 8 GB RAM, hardware virtualization enabled, WSL 2.1.5 or later, and a compatible Docker Desktop installation. The scripts enforce the project's current minimum Windows build checks; before deployment, also confirm that the school's Windows edition and release are still within Microsoft's servicing timeline and Docker's support policy.

From an elevated PowerShell window in the USB package folder, run:

```powershell
.\prepare-school-host.ps1
```

The script enables Windows Subsystem for Linux and Virtual Machine Platform, installs the staged WSL MSI if the required WSL version is not ready, and checks both Docker Desktop's recommended per-user installation location and its all-users installation location. If Docker Desktop is not found in either location, it launches the official installer. The authorised school operator must complete Docker's interactive setup and accept its licence terms. Restart Windows if requested, open Docker Desktop, and wait for its engine to become ready.

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


## Why Windows 8 is not supported

Windows 8 and 8.1 are outside the supported operating-system baseline for this deployment. The current package runs SchoolBridge in Linux containers through Docker Desktop and its WSL 2 backend. That runtime requires modern Windows virtualization and WSL 2 support; Windows 8 cannot provide the supported WSL 2/Docker Desktop environment required by this package. The installer therefore rejects older Windows versions instead of allowing a setup that cannot be reliably installed, secured or maintained.

This is a deployment-runtime limitation, not a limitation in the SchoolBridge web application itself. Supporting Windows 8 would require a separately engineered legacy deployment (for example, a compatible native Windows service/runtime and database arrangement), plus dedicated installation, security, update, backup and recovery testing. It must not be advertised as supported until those tests pass. The current project prioritises one reliable, repeatable Windows deployment rather than adding an unverified legacy path.

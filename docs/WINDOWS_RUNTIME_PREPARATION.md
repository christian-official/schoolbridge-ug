# Preparing the Windows runtime for an offline school visit

The USB application archive contains SchoolBridge's frontend, backend and PostgreSQL images. Those images run under a local container engine. The current package does not bundle the Windows container runtime by default.

## Before the visit

On the preparation computer, create a folder named `runtime` in the repository root and place the following official installers inside it:

- `Docker Desktop Installer.exe` — the Windows x64 installer obtained from Docker's official Windows installation page.
- `wsl.msi` — the current stable WSL MSI from Microsoft's official WSL GitHub Releases page, when the school computer needs an offline WSL installation/update.

The USB preparation script copies this folder into the USB package. It does not download or redistribute third-party installers automatically. Confirm the installers' integrity and licence terms before including them. Docker Desktop terms must be accepted by the school/host operator; do not silently accept them on another person's behalf.

## School computer readiness

Current Docker Desktop Windows requirements include a supported Windows 10/11 release, WSL 2.1.5 or later for the WSL backend, at least 8 GB RAM and hardware virtualization enabled. Check the current official documentation because requirements change.

First run `./prepare-school-host.ps1` from an elevated PowerShell window on the school computer. It checks the supported Windows version, memory and hardware virtualisation; enables the WSL and Virtual Machine Platform Windows features; installs the staged WSL MSI when needed; and launches the official Docker Desktop installer. The Docker setup remains interactive so the authorised school operator can review and accept its licence terms. The script does not silently accept third-party terms or force a restart. If Windows requests a restart, restart and open Docker Desktop, wait for its engine, then run `./check-school-host.ps1` again.

## Important

- No internet or LAN is required to install or run SchoolBridge once the local Windows runtime is ready and all images are on the USB.
- A single-computer installation needs no router, Wi-Fi or LAN.
- Multi-device access uses an optional local network.
- Docker Desktop's licensing and hardware requirements must be checked for each school. If Docker Desktop is unsuitable, the SchoolBridge team must provide and test a different supported local runtime before promising installation on that computer.

## Official references

- [Docker Desktop for Windows: system requirements and installation](https://docs.docker.com/desktop/setup/install/windows-install/)
- [Docker Desktop offline use FAQ](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/general/)
- [Docker Desktop WSL 2 backend requirements](https://docs.docker.com/desktop/features/wsl/)
- [Microsoft WSL releases](https://github.com/microsoft/WSL/releases)

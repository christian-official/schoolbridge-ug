# Existing Docker/WSL2 USB prototype — not the final desktop installer

## Status and boundary

This document describes the existing Docker Desktop + WSL2 prototype only. It is **not** the agreed final SchoolBridge installer: it requires a modern Windows host, launches the frontend in a separately opened browser, and does not meet the Windows 8 starting-compatibility requirement. Do not present this route as the completed USB deliverable. The final USB must carry the complete desktop application and runtime, install and launch it without internet, and support Windows 8 first, then Windows 8.1 and newer releases.

## Agreed architecture and installation boundary

SchoolBridge is local-first. Each school has its own local database and runs the frontend and backend on its own computer. Render is a preview/development service only. Internet is not required for local installation, login or ordinary school operations. A LAN/router is optional and is needed only when additional devices must connect to the host; one-computer operation requires no network equipment.

When installed locally, the frontend, API and database run together. The service-worker cache is only a fallback app shell; it does not provide all school records or editing workflows when the local server is stopped.

**Offline USB status:** the preparation computer downloads the Docker Desktop installer from Docker's official Windows distribution endpoint and resolves the latest stable x64 WSL MSI from Microsoft's official WSL releases. It verifies both Authenticode signatures before packaging. The school computer receives these installers, prebuilt SchoolBridge/PostgreSQL images, installation guides and a SHA-256 file-integrity manifest on USB; it does not download them. Docker setup remains interactive for licence acceptance and Windows may require a restart. A clean Windows computer with internet disconnected must still pass the acceptance test below before this installer can be certified for school-wide release.

## 1. Prepare the USB package

On a preparation computer with Docker Engine/Desktop, Compose v2, PowerShell and internet for the initial build, run from the repository root:

    .\scripts\prepare-usb.ps1

The script downloads the official Docker and WSL runtime installers if they are not already present, verifies their Microsoft/Docker signatures, builds the frontend and backend images, pulls PostgreSQL on the preparation computer, exports all three images, copies the runtime installers and guides, and creates SHA256SUMS.txt. It starts with a clean output folder so stale files cannot make an incomplete package appear valid. Copy the complete dist\SchoolBridge-USB folder to an exFAT or NTFS USB drive.

Never put the owner's private signing key or passphrase on the USB. Only the public verification key belongs in the school's local .env.

## 2. Prototype installation on one computer without LAN or internet

1. On the school computer, open an elevated PowerShell window in the USB package folder and run prepare-school-host.ps1. Complete the interactive Docker Desktop setup and licence acceptance. Restart Windows if requested, start Docker Desktop and wait for its engine.
2. Run check-school-host.ps1 and confirm every check passes.
3. Copy the complete package folder to a local folder, such as C:\SchoolBridge. Do not run the database from the USB itself.
4. Open PowerShell in that local folder and run install-schoolbridge.ps1.
5. The installer verifies required package files and their SHA-256 hashes, rechecks host readiness, creates a local .env with fresh random database/application secrets, asks for the owner's Base64 public verification key, validates it, imports the saved images, and asks you to type START before starting services.
6. Open http://localhost:8080 on the same computer in a separate browser (this is a prototype limitation, not the required desktop experience). Complete owner activation using the unique installation ID and signed CHRISTIAN: code generated on the trusted owner computer, then complete the school's first-time setup.
7. Restart the computer and confirm records remain available. Complete a backup and restore test before handover.

No router, LAN, Wi-Fi or internet is required for the intended single-computer mode once the supported local runtime is installed.

## 3. Optional multi-device access

If teachers need other devices, connect them to a local Wi-Fi router, hotspot or wired network and open http://HOST-IP:8080. Internet is still not required. This optional local connection is not an installation prerequisite.

## 4. Daily operation and backups

- Start: docker compose up -d
- Stop: docker compose down
- Status: docker compose ps
- Backend logs: docker compose logs -f backend
- Manual PostgreSQL backup: docker compose exec backend python backup_postgres.py

Database and backups use persistent Docker volumes. Never run docker compose down -v unless intentionally deleting those volumes. Keep a second encrypted backup on a separate drive and test recovery.

## 5. Phase 5 acceptance gate

On a clean supported Windows computer with internet disconnected and no LAN/router, verify the USB SHA-256 manifest, runtime installation, image import, startup, owner activation, school setup, login, record creation, restart persistence and backup restore. Then test optional local multi-device access.

Also test the supported offline synchronisation workflows: encrypted authorised read-only snapshots, teacher marks drafts/submission and class-attendance drafts/submission; verify expiry, revoked-device handling and conflict protection. Other modules do not yet support unrestricted offline writes. Do not describe the product as fully offline across every module until that separate scope is implemented and tested.

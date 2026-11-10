# SchoolBridge USB preparation and first installation

## Agreed architecture and current status

SchoolBridge is local-first. Each school has its own local database and runs the frontend and backend on its own computer. Render is a preview/development service only. Internet is not required for local installation, login or ordinary school operations. A LAN/router is optional and is needed only when additional devices must connect to the host; one-computer operation requires no network equipment.

**Important distinction:** when SchoolBridge is installed on a school computer, its local frontend, API and database run together. Login and ordinary school work use that local API/database; they do not depend on Render, internet, Wi-Fi or a LAN. LAN is only for connecting additional computers or phones. The service-worker browser cache is a different fallback: if the local SchoolBridge server itself is stopped or unreachable, it currently provides the app shell and limited encrypted snapshots/drafts, not every record and every editing workflow.

**Current installation status:** the USB package exports the frontend, backend and PostgreSQL images, and includes a Windows runtime-preparation helper. The helper can enable WSL features, install a staged WSL MSI and launch the staged Docker Desktop installer, but Docker setup remains interactive for licence acceptance and Windows may require a restart. The official Docker/WSL installers must be staged in the repository `runtime` folder before preparing the USB; they are not downloaded automatically. A clean Windows computer with internet disconnected has not yet passed the complete acceptance test, so this is not yet a certified turnkey offline installer.

## 1. Prepare the USB package

On a preparation computer with Docker Engine/Desktop, Compose v2, PowerShell and internet for the initial build, run from the repository root:

```powershell
.\scripts\prepare-usb.ps1
```

The script builds the frontend and backend images, pulls the PostgreSQL image on the preparation computer, exports all three images to `dist\SchoolBridge-USB\schoolbridge-images.tar`, and copies the Compose file and school installer. Copy the complete `dist\SchoolBridge-USB` folder to a USB drive formatted as exFAT or NTFS.

Never put the owner's private signing key or passphrase on the USB. Only the public verification key belongs in the school's local `.env`.

## 2. Install on one computer without LAN or internet

1. Run `./prepare-school-host.ps1` from an elevated PowerShell window on the school computer. It uses the official installers staged in the USB `runtime` folder. Complete Docker Desktop setup and licence acceptance, and restart Windows if requested. Then run `./check-school-host.ps1` and confirm every check passes.
2. Copy the USB's `SchoolBridge-USB` folder to a local folder on the computer, such as `C:\\SchoolBridge`. Do not run the database from the USB itself.
3. Open PowerShell in that local folder and run `./install-schoolbridge.ps1`.
4. The installer rechecks host readiness, creates a local `.env` with fresh random database/application secrets, asks for the owner's Base64 **public** verification key, validates it, imports the saved images, and asks you to type `START` before starting services. It does not need the owner's private key or passphrase.
5. Open `http://localhost:8080` on the same computer. Complete owner activation using the unique installation ID and signed `CHRISTIAN:` code generated on the trusted owner computer, then complete the school's first-time setup.
6. Restart the computer and confirm that the school records remain available. Complete a backup and restore test before handover.

No router, LAN, Wi-Fi or internet is required for the intended single-computer mode once the supported local runtime is installed.
## 3. Optional multi-device access

If teachers need other devices, connect them to a local Wi-Fi router, hotspot or wired network and open `http://HOST-IP:8080`. Internet is still not required. This optional local connection is not an installation prerequisite.

## 4. Daily operation and backups

- Start: `docker compose up -d`
- Stop: `docker compose down`
- Status: `docker compose ps`
- Backend logs: `docker compose logs -f backend`
- Manual PostgreSQL backup: `docker compose exec backend python backup_postgres.py`

Database and backups use persistent Docker volumes. Never run `docker compose down -v` unless intentionally deleting those volumes. Keep a second encrypted backup on a separate drive and test recovery.

## 5. Production acceptance gate

On a clean supported Windows computer with internet disconnected and no LAN/router, test runtime installation, image import, startup, owner activation, school setup, login, record creation, restart persistence and backup restore. Then test optional local multi-device access. Separately verify offline reading and writing for every required module. Until these tests pass, do not describe the product as a completed offline USB installer.

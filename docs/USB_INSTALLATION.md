# SchoolBridge USB preparation and first installation

## Agreed architecture and installation boundary

SchoolBridge is local-first. Each school has its own local database and runs the frontend and backend on its own computer. Render is a preview/development service only. Internet is not required for local installation, login or ordinary school operations. A LAN/router is optional and is needed only when additional devices must connect to the host; one-computer operation requires no network equipment.

When installed locally, the frontend, API and database run together. The service-worker cache is only a fallback app shell; it does not provide all school records or editing workflows when the local server is stopped.

**Offline USB status:** the preparation script now refuses to label a package complete unless the official Docker Desktop installer and WSL MSI are staged in the repository's `runtime` folder. The package includes those installers, the prebuilt SchoolBridge/PostgreSQL images, installation guides and a SHA-256 manifest. Docker setup remains interactive for licence acceptance and Windows may require a restart. A clean Windows computer with internet disconnected must still pass the acceptance test below before this installer can be certified for school-wide release.

## 1. Prepare the USB package

On a preparation computer with Docker Engine/Desktop, Compose v2, PowerShell and internet for the initial build, place the official installers at these exact paths:

- `runtime/Docker Desktop Installer.exe`
- `runtime/wsl.msi`

Then run from the repository root:

```powershell
.\scripts\prepare-usb.ps1
```

The script builds the frontend and backend images, pulls PostgreSQL on the preparation computer, exports all three images, copies the runtime installers and guides, and creates `SHA256SUMS.txt`. It starts with a clean output folder so stale files cannot make an incomplete package appear valid. Copy the complete `dist\SchoolBridge-USB` folder to an exFAT or NTFS USB drive.

Never put the owner's private signing key or passphrase on the USB. Only the public verification key belongs in the school's local `.env`.

## 2. Install on one computer without LAN or internet

1. On the school computer, open an elevated PowerShell window in the USB package folder and run `./prepare-school-host.ps1`. Complete the interactive Docker Desktop setup and licence acceptance. Restart Windows if requested, start Docker Desktop and wait for its engine.
2. Run `./check-school-host.ps1` and confirm every check passes.
3. Copy the complete package folder to a local folder, such as `C:\SchoolBridge`. Do not run the database from the USB itself.
4. Open PowerShell in that local folder and run `./install-schoolbridge.ps1`.
5. The installer verifies required package files and runtime installers, rechecks host readiness, creates a local `.env` with fresh random database/application secrets, asks for the owner's Base64 **public** verification key, validates it, imports the saved images, and asks you to type `START` before starting services.
6. Open `http://localhost:8080` on the same computer. Complete owner activation using the unique installation ID and signed `CHRISTIAN:` code generated on the trusted owner computer, then complete the school's first-time setup.
7. Restart the computer and confirm records remain available. Complete a backup and restore test before handover.

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

## 5. Phase 5 acceptance gate

On a clean supported Windows computer with internet disconnected and no LAN/router, verify the USB SHA-256 manifest, runtime installation, image import, startup, owner activation, school setup, login, record creation, restart persistence and backup restore. Then test optional local multi-device access.

Also test the supported offline synchronisation workflows: encrypted authorised read-only snapshots, teacher marks drafts/submission and class-attendance drafts/submission; verify expiry, revoked-device handling and conflict protection. Other modules do not yet support unrestricted offline writes. Do not describe the product as fully offline across every module until that separate scope is implemented and tested.
